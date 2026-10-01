"""Shared memory: agents propose, the learner decides, agents recall what was accepted.

A proposal is not yet a memory — `recall` returns only accepted rows. A
proposal under a topic that already has an accepted memory is a revision of
it; accepting a revision supersedes the previous row in the same transaction,
and the superseded rows are that memory's history. Nothing is deleted:
rejected, removed and superseded rows stay, each with the status that says
why it is no longer recalled.

Every function is scoped by profile. Another account's memory raises
`NotFoundError`, exactly as one that does not exist.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session

from core.database import session_scope
from core.exceptions import NotFoundError, ValidationError
from models.memory import MemoryRecord
from models.workspace import now
from repository import memory_repo

__all__ = [
    "accept",
    "edit",
    "export_markdown",
    "list_for_learner",
    "propose",
    "recall",
    "reject",
    "remove",
]

RECALL_MAX = 50
RECALL_TEXT_MAX = 500
LEARNER = "You"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    stamped = value if value.tzinfo else value.replace(tzinfo=UTC)
    return stamped.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _text(text: str | None) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValidationError("A memory needs some text")
    return cleaned


def _topic(topic: str | None) -> str | None:
    cleaned = "-".join((topic or "").strip().lower().split())
    return cleaned or None


def _history(session: Session, profile_id: str, record: MemoryRecord) -> list[dict[str, Any]]:
    """The superseded predecessors of an accepted memory, oldest first."""

    chain: list[dict[str, Any]] = []
    seen = {record.id}
    previous_id = record.revises_id
    while previous_id and previous_id not in seen:
        previous = memory_repo.get(session, profile_id, previous_id)
        if previous is None or previous.status != "superseded":
            break
        seen.add(previous.id)
        chain.append({"text": previous.text, "decidedAt": _iso(previous.decided_at)})
        previous_id = previous.revises_id
    chain.reverse()
    return chain


def _serialize(
    session: Session, profile_id: str, record: MemoryRecord, titles: dict[str, str] | None = None
) -> dict[str, Any]:
    if titles is None:
        titles = memory_repo.node_titles(
            session, profile_id, {record.source_node_id} if record.source_node_id else set()
        )
    revises = None
    history: list[dict[str, Any]] = []
    if record.status == "pending" and record.topic is not None:
        # Shown beside whatever is accepted on the topic now — what accepting
        # would replace — rather than what was accepted when it was proposed.
        current = memory_repo.accepted_on_topic(session, profile_id, record.topic)
        if current is not None:
            revises = {"id": current.id, "text": current.text}
    elif record.status == "accepted":
        history = _history(session, profile_id, record)
    return {
        "id": record.id,
        "text": record.text,
        "topic": record.topic,
        "status": record.status,
        "proposedBy": record.proposed_by_name,
        "sourceNodeId": record.source_node_id,
        "sourceTitle": titles.get(record.source_node_id) if record.source_node_id else None,
        "createdAt": _iso(record.created_at),
        "decidedAt": _iso(record.decided_at),
        "revises": revises,
        "history": history,
    }


def _owned(session: Session, profile_id: str, memory_id: str) -> MemoryRecord:
    record = memory_repo.get(session, profile_id, memory_id)
    if record is None:
        raise NotFoundError("Memory not found")
    return record


# --- agents ------------------------------------------------------------------


def propose(
    profile_id: str,
    *,
    text: str,
    topic: str | None,
    proposed_by_name: str,
    source_node_id: str | None,
) -> dict[str, Any]:
    """Record a proposal; on a topic that has an accepted memory, a revision of it."""

    cleaned = _text(text)
    key = _topic(topic)
    with session_scope() as session:
        current = memory_repo.accepted_on_topic(session, profile_id, key) if key else None
        record = memory_repo.create(
            session,
            profile_id=profile_id,
            text=cleaned,
            topic=key,
            status="pending",
            proposed_by_name=proposed_by_name,
            source_node_id=source_node_id,
            revises_id=current.id if current else None,
        )
        return _serialize(session, profile_id, record)


def _matches(record: MemoryRecord, words: list[str]) -> bool:
    haystack = f"{record.text}\n{record.topic or ''}".lower()
    return all(word in haystack for word in words)


def recall(
    profile_id: str, *, query: str | None = None, topic: str | None = None, limit: int = 20
) -> dict[str, Any]:
    """Accepted memories only, newest decided first, bounded."""

    bound = max(1, min(limit, RECALL_MAX))
    key = _topic(topic)
    words = (query or "").lower().split()
    with session_scope() as session:
        rows = memory_repo.accepted(session, profile_id, key)
    found = [row for row in rows if _matches(row, words)]
    truncated = len(found) > bound
    memories = []
    for row in found[:bound]:
        text = row.text
        if len(text) > RECALL_TEXT_MAX:
            text = text[:RECALL_TEXT_MAX] + "…"
            truncated = True
        memories.append(
            {
                "id": row.id,
                "text": text,
                "topic": row.topic,
                "proposedBy": row.proposed_by_name,
                "decidedAt": _iso(row.decided_at),
            }
        )
    return {"memories": memories, "truncated": truncated}


# --- the learner -------------------------------------------------------------


def list_for_learner(profile_id: str) -> dict[str, list[dict[str, Any]]]:
    with session_scope() as session:
        pending = memory_repo.pending(session, profile_id)
        accepted = memory_repo.accepted(session, profile_id)
        titles = memory_repo.node_titles(
            session,
            profile_id,
            {r.source_node_id for r in pending + accepted if r.source_node_id},
        )
        return {
            "pending": [_serialize(session, profile_id, r, titles) for r in pending],
            "accepted": [_serialize(session, profile_id, r, titles) for r in accepted],
        }


def accept(profile_id: str, memory_id: str, text: str | None) -> dict[str, Any]:
    """Accept a proposal, optionally with edited text.

    If its topic already has an accepted memory — the revision it was
    proposed as, or one accepted since — that memory is superseded in the
    same transaction and becomes this one's history. Otherwise it is
    accepted plain.
    """

    with session_scope() as session:
        record = _owned(session, profile_id, memory_id)
        if record.status != "pending":
            raise ValidationError(f"Only a pending proposal can be accepted; this one is {record.status}")
        if text is not None:
            record.text = _text(text)
        decided = now()
        current = (
            memory_repo.accepted_on_topic(session, profile_id, record.topic)
            if record.topic is not None
            else None
        )
        if current is not None:
            current.status = "superseded"
            current.decided_at = decided
            # Flushed first: the one-accepted-per-topic index is checked per
            # statement, so the two rows are never both accepted.
            session.flush()
            record.revises_id = current.id
        else:
            record.revises_id = None
        record.status = "accepted"
        record.decided_at = decided
        session.flush()
        return _serialize(session, profile_id, record)


def reject(profile_id: str, memory_id: str) -> dict[str, Any]:
    with session_scope() as session:
        record = _owned(session, profile_id, memory_id)
        if record.status != "pending":
            raise ValidationError(f"Only a pending proposal can be rejected; this one is {record.status}")
        record.status = "rejected"
        record.decided_at = now()
        session.flush()
        return _serialize(session, profile_id, record)


def edit(profile_id: str, memory_id: str, text: str) -> dict[str, Any]:
    """The learner rewrites an accepted memory; the old text joins its history."""

    cleaned = _text(text)
    with session_scope() as session:
        record = _owned(session, profile_id, memory_id)
        if record.status != "accepted":
            raise ValidationError(f"Only an accepted memory can be edited; this one is {record.status}")
        decided = now()
        record.status = "superseded"
        record.decided_at = decided
        session.flush()
        successor = memory_repo.create(
            session,
            profile_id=profile_id,
            text=cleaned,
            topic=record.topic,
            status="accepted",
            proposed_by_name=LEARNER,
            source_node_id=record.source_node_id,
            revises_id=record.id,
            decided_at=decided,
        )
        return _serialize(session, profile_id, successor)


def remove(profile_id: str, memory_id: str) -> None:
    with session_scope() as session:
        record = _owned(session, profile_id, memory_id)
        if record.status != "accepted":
            raise ValidationError(f"Only an accepted memory can be removed; this one is {record.status}")
        record.status = "removed"
        record.decided_at = now()
        session.flush()


def export_markdown(profile_id: str) -> str:
    with session_scope() as session:
        rows = memory_repo.accepted(session, profile_id)
        titles = memory_repo.node_titles(
            session, profile_id, {r.source_node_id for r in rows if r.source_node_id}
        )
    lines = ["# Memory", ""]
    if not rows:
        lines.append("_No accepted memories._")
    for row in rows:
        line = f"- {' '.join(row.text.split())}"
        if row.topic:
            line += f" `{row.topic}`"
        title = titles.get(row.source_node_id) if row.source_node_id else None
        line += f" — from *{title}*" if title else " — source session unavailable"
        lines.append(line)
    return "\n".join(lines) + "\n"
