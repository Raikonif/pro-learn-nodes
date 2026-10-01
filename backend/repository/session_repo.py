"""Finding sessions by what was said in them.

Message text is indexed by `message_fts`, which triggers keep in step with
`chat_messages` (see the `20261001_01` migration) — so every writer is
covered without any of them knowing. Queries are shaped like
`service/retrieval.py`'s: each word quoted, so learner input can never be
read as FTS syntax, and ANDed; always filtered by workspace.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

# Words only. Quoting each one makes the FTS query literal, and FTS5's own
# operators typed as words ("AND", "NOT") are dropped rather than quoted,
# since a query of nothing but operators should find nothing.
_WORD = re.compile(r"\w+", re.UNICODE)
_OPERATORS = {"and", "or", "not", "near"}


def terms_of(query: str) -> list[str]:
    return [w for w in _WORD.findall(query) if w.lower() not in _OPERATORS]


def search(
    session: Session, workspace_id: str, query: str, *, include_archived: bool, limit: int = 30
) -> list[dict[str, Any]]:
    terms = terms_of(query)
    if not terms:
        return []
    archived_filter = "" if include_archived else "AND n.archived_at IS NULL"

    # Title matches first: a session named for the thing is the best answer.
    title_rows = session.execute(
        text(
            "SELECT n.id AS node_id, n.title, n.archived_at, n.last_activity_at "
            "FROM workspace_nodes n WHERE n.workspace_id = :ws "
            + "".join(f"AND lower(n.title) LIKE :t{i} " for i in range(len(terms)))
            + archived_filter
            + " ORDER BY n.last_activity_at DESC LIMIT :limit"
        ),
        {"ws": workspace_id, "limit": limit, **{f"t{i}": f"%{t.lower()}%" for i, t in enumerate(terms)}},
    ).mappings().all()

    message_rows = session.execute(
        text(
            "SELECT f.message_id, f.thread_id, n.id AS node_id, n.title, n.archived_at, "
            "n.last_activity_at, snippet(message_fts, 3, '', '', '…', 16) AS snippet "
            "FROM message_fts f "
            "JOIN chat_threads t ON t.id = f.thread_id "
            "JOIN workspace_nodes n ON n.id = t.node_id "
            "WHERE f.workspace_id = :ws AND message_fts MATCH :q "
            + archived_filter
            + " ORDER BY bm25(message_fts) LIMIT :scan"
        ),
        {"ws": workspace_id, "q": " AND ".join(f'"{t}"' for t in terms), "scan": limit * 5},
    ).mappings().all()

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in title_rows:
        seen.add(row["node_id"])
        results.append(_result(row, thread_id=None, message_id=None, snippet=None))
    # One entry per session: its best-ranked passage.
    for row in message_rows:
        if row["node_id"] in seen:
            continue
        seen.add(row["node_id"])
        results.append(
            _result(row, thread_id=row["thread_id"], message_id=row["message_id"], snippet=row["snippet"])
        )
    return results[:limit]


def _result(row: Any, *, thread_id: str | None, message_id: str | None, snippet: str | None) -> dict[str, Any]:
    return {
        "nodeId": row["node_id"],
        "title": row["title"],
        "archived": row["archived_at"] is not None,
        "threadId": thread_id,
        "messageId": message_id,
        "snippet": snippet,
        # Raw SQL returns SQLite's stored text; the service formats it the
        # way bootstrap does, so the two can be compared.
        "lastActivityAt": row["last_activity_at"],
    }
