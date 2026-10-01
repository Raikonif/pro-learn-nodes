"""Data access for memories.

Every query is filtered by `profile_id`, including lookups by id: another
account's memory is answered exactly as one that does not exist. Every
function takes the caller's `Session`; the transaction boundary is the
service's.
"""

from __future__ import annotations

from sqlmodel import Session, col, select

from models.memory import MemoryRecord
from models.workspace import WorkspaceNodeRecord, WorkspaceRecord


def get(session: Session, profile_id: str, memory_id: str) -> MemoryRecord | None:
    return session.exec(
        select(MemoryRecord).where(
            MemoryRecord.id == memory_id,
            MemoryRecord.profile_id == profile_id,
        )
    ).first()


def accepted_on_topic(session: Session, profile_id: str, topic: str) -> MemoryRecord | None:
    return session.exec(
        select(MemoryRecord).where(
            MemoryRecord.profile_id == profile_id,
            MemoryRecord.topic == topic,
            MemoryRecord.status == "accepted",
        )
    ).first()


def pending(session: Session, profile_id: str) -> list[MemoryRecord]:
    """Pending proposals, newest first."""

    return list(
        session.exec(
            select(MemoryRecord)
            .where(MemoryRecord.profile_id == profile_id, MemoryRecord.status == "pending")
            .order_by(col(MemoryRecord.created_at).desc())
        ).all()
    )


def accepted(session: Session, profile_id: str, topic: str | None = None) -> list[MemoryRecord]:
    """Accepted memories, newest decided first, optionally on one topic."""

    query = select(MemoryRecord).where(
        MemoryRecord.profile_id == profile_id, MemoryRecord.status == "accepted"
    )
    if topic is not None:
        query = query.where(MemoryRecord.topic == topic)
    query = query.order_by(
        col(MemoryRecord.decided_at).desc(), col(MemoryRecord.created_at).desc()
    )
    return list(session.exec(query).all())


def create(
    session: Session,
    *,
    profile_id: str,
    text: str,
    topic: str | None,
    status: str,
    proposed_by_name: str,
    source_node_id: str | None,
    revises_id: str | None = None,
    decided_at=None,
) -> MemoryRecord:
    record = MemoryRecord(
        profile_id=profile_id,
        text=text,
        topic=topic,
        status=status,
        proposed_by_name=proposed_by_name,
        source_node_id=source_node_id,
        revises_id=revises_id,
        decided_at=decided_at,
    )
    session.add(record)
    session.flush()
    return record


def node_titles(session: Session, profile_id: str, node_ids: set[str]) -> dict[str, str]:
    """Titles of those nodes the account owns; others are simply absent."""

    if not node_ids:
        return {}
    rows = session.exec(
        select(WorkspaceNodeRecord.id, WorkspaceNodeRecord.title)
        .join(WorkspaceRecord, WorkspaceRecord.id == WorkspaceNodeRecord.workspace_id)
        .where(
            WorkspaceRecord.profile_id == profile_id,
            col(WorkspaceNodeRecord.id).in_(node_ids),
        )
    ).all()
    return {node_id: title for node_id, title in rows}
