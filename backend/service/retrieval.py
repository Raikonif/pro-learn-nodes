"""Rebuildable local FTS retrieval projection for workspace source content."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlmodel import select

from core.database import session_scope
from core.exceptions import NotFoundError
from models.workspace import SourceChunkRecord, SourceRecord, WorkspaceRecord

CHUNK_SIZE = 900


def chunk_text(content: str, chunk_size: int = CHUNK_SIZE) -> list[tuple[int, int, str]]:
    """Split text at whitespace while retaining immutable source offsets."""

    chunks: list[tuple[int, int, str]] = []
    start = 0
    length = len(content)
    while start < length:
        end = min(start + chunk_size, length)
        if end < length:
            boundary = content.rfind(" ", start, end)
            if boundary > start:
                end = boundary
        passage = content[start:end].strip()
        if passage:
            leading = len(content[start:end]) - len(content[start:end].lstrip())
            trailing_end = end - len(content[start:end]) + len(content[start:end].rstrip())
            chunks.append((start + leading, trailing_end, passage))
        start = max(end, start + 1)
        while start < length and content[start].isspace():
            start += 1
    return chunks


def create_source(
    workspace_id: str, title: str, content: str, metadata: dict[str, Any] | None = None,
) -> SourceRecord:
    with session_scope() as session:
        if session.get(WorkspaceRecord, workspace_id) is None:
            raise NotFoundError(f"Unknown workspace: {workspace_id}")
        source = SourceRecord(
            workspace_id=workspace_id,
            title=title,
            content=content,
            metadata_json=metadata or {},
        )
        session.add(source)
        session.flush()
        return source


def index_source(source_id: str) -> None:
    """Idempotently replace one source's derived chunks and FTS rows."""

    with session_scope() as session:
        source = session.get(SourceRecord, source_id)
        if source is None:
            raise NotFoundError(f"Unknown source: {source_id}")
        source.index_status = "running"
        source.index_error = None
        session.flush()
        session.execute(text("DELETE FROM source_chunk_fts WHERE source_id = :source_id"), {"source_id": source.id})
        session.execute(text("DELETE FROM source_chunks WHERE source_id = :source_id"), {"source_id": source.id})
        for ordinal, (start, end, passage) in enumerate(chunk_text(source.content)):
            chunk = SourceChunkRecord(
                workspace_id=source.workspace_id,
                source_id=source.id,
                ordinal=ordinal,
                start_offset=start,
                end_offset=end,
                content=passage,
            )
            session.add(chunk)
            session.flush()
            session.execute(
                text(
                    "INSERT INTO source_chunk_fts (chunk_id, workspace_id, source_id, content) "
                    "VALUES (:chunk_id, :workspace_id, :source_id, :content)"
                ),
                {
                    "chunk_id": chunk.id,
                    "workspace_id": source.workspace_id,
                    "source_id": source.id,
                    "content": passage,
                },
            )
        source.index_status = "completed"


def resume_unfinished_indexing() -> None:
    """Make abandoned work retryable, then synchronously index pending sources."""

    with session_scope() as session:
        abandoned = session.exec(
            select(SourceRecord).where(SourceRecord.index_status == "running")
        ).all()
        for source in abandoned:
            source.index_status = "pending"
        pending = session.exec(
            select(SourceRecord).where(SourceRecord.index_status == "pending")
        ).all()
        pending_ids = [source.id for source in pending]
    for source_id in pending_ids:
        try:
            index_source(source_id)
        except Exception as error:
            with session_scope() as session:
                source = session.get(SourceRecord, source_id)
                if source is not None:
                    source.index_status = "failed"
                    source.index_error = f"{type(error).__name__}: {error}"


def rebuild_workspace_index(workspace_id: str) -> None:
    with session_scope() as session:
        if session.get(WorkspaceRecord, workspace_id) is None:
            raise NotFoundError(f"Unknown workspace: {workspace_id}")
        sources = session.exec(
            select(SourceRecord).where(SourceRecord.workspace_id == workspace_id)
        ).all()
        for source in sources:
            source.index_status = "pending"
            source.index_error = None
        source_ids = [source.id for source in sources]
    for source_id in source_ids:
        index_source(source_id)


def source_status(workspace_id: str) -> list[dict[str, Any]]:
    with session_scope() as session:
        sources = session.exec(
            select(SourceRecord)
            .where(SourceRecord.workspace_id == workspace_id)
            .order_by(SourceRecord.created_at)
        ).all()
        return [
            {
                "id": source.id,
                "title": source.title,
                "status": source.index_status,
                "error": source.index_error,
            }
            for source in sources
        ]


def search(workspace_id: str, query: str, limit: int = 10) -> list[dict[str, Any]]:
    terms = re.findall(r"[\w]+", query, re.UNICODE)
    if not terms:
        return []
    fts_query = " AND ".join(f'"{term}"' for term in terms)
    with session_scope() as session:
        rows = session.execute(
            text(
                "SELECT c.id AS chunk_id, c.source_id, c.start_offset, c.end_offset, "
                "c.content, s.title "
                "FROM source_chunk_fts f "
                "JOIN source_chunks c ON c.id = f.chunk_id "
                "JOIN sources s ON s.id = c.source_id "
                "WHERE f.workspace_id = :workspace_id "
                "AND source_chunk_fts MATCH :query "
                "AND s.index_status = 'completed' "
                "ORDER BY bm25(source_chunk_fts) LIMIT :limit"
            ),
            {"workspace_id": workspace_id, "query": fts_query, "limit": min(max(limit, 1), 50)},
        ).mappings().all()
        return [
            {
                "chunkId": row["chunk_id"],
                "sourceId": row["source_id"],
                "sourceTitle": row["title"],
                "startOffset": row["start_offset"],
                "endOffset": row["end_offset"],
                "content": row["content"],
            }
            for row in rows
        ]
