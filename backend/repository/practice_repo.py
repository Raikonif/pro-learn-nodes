"""Data access for practice material.

Every read is filtered by workspace as well as node, so a node id from
another account's workspace finds nothing. Attempts have an insert and no
update — the append-only rule lives in what this module does not offer.
Like the other repositories, functions take the caller's `Session`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from models.practice import PracticeAttemptRecord, PracticeItemRecord, SandboxBufferRecord
from models.workspace import now


def create_item(
    session: Session,
    *,
    workspace_id: str,
    node_id: str,
    kind: str,
    prompt: str,
    options: list[dict[str, Any]],
    reference_answer: str | None,
    starter_code: str | None = None,
    expected_output: str | None = None,
    authored_by_agent_id: str | None = None,
    authored_by_name: str | None = None,
) -> PracticeItemRecord:
    item = PracticeItemRecord(
        workspace_id=workspace_id,
        node_id=node_id,
        kind=kind,
        prompt=prompt,
        options=options,
        reference_answer=reference_answer,
        starter_code=starter_code,
        expected_output=expected_output,
        authored_by_agent_id=authored_by_agent_id,
        authored_by_name=authored_by_name,
    )
    session.add(item)
    session.flush()
    return item


def items_for_node(session: Session, workspace_id: str, node_id: str) -> list[PracticeItemRecord]:
    return list(
        session.exec(
            select(PracticeItemRecord)
            .where(
                PracticeItemRecord.workspace_id == workspace_id,
                PracticeItemRecord.node_id == node_id,
            )
            .order_by(PracticeItemRecord.created_at)
        ).all()
    )


def get_item(session: Session, workspace_id: str, item_id: str) -> PracticeItemRecord | None:
    return session.exec(
        select(PracticeItemRecord).where(
            PracticeItemRecord.id == item_id, PracticeItemRecord.workspace_id == workspace_id
        )
    ).first()


def insert_attempt(
    session: Session,
    *,
    workspace_id: str,
    node_id: str,
    item_id: str,
    response: str | None,
    chosen_option: int | None,
    correct: bool | None,
    run_outcome: str | None = None,
    run_output: str | None = None,
) -> PracticeAttemptRecord:
    attempt = PracticeAttemptRecord(
        workspace_id=workspace_id,
        node_id=node_id,
        item_id=item_id,
        response=response,
        chosen_option=chosen_option,
        correct=correct,
        run_outcome=run_outcome,
        run_output=run_output,
    )
    session.add(attempt)
    session.flush()
    return attempt


def attempts_for_node(
    session: Session, workspace_id: str, node_id: str
) -> list[PracticeAttemptRecord]:
    return list(
        session.exec(
            select(PracticeAttemptRecord)
            .where(
                PracticeAttemptRecord.workspace_id == workspace_id,
                PracticeAttemptRecord.node_id == node_id,
            )
            .order_by(PracticeAttemptRecord.created_at.desc())
        ).all()
    )


def sandbox_for_node(
    session: Session, workspace_id: str, node_id: str, item_id: str | None = None
) -> SandboxBufferRecord | None:
    """The node's free buffer, or — with `item_id` — that exercise's buffer."""

    item_filter = (
        SandboxBufferRecord.item_id.is_(None) if item_id is None else SandboxBufferRecord.item_id == item_id
    )
    return session.exec(
        select(SandboxBufferRecord).where(
            SandboxBufferRecord.workspace_id == workspace_id,
            SandboxBufferRecord.node_id == node_id,
            item_filter,
        )
    ).first()


def upsert_sandbox(
    session: Session, workspace_id: str, node_id: str, code: str, item_id: str | None = None
) -> SandboxBufferRecord:
    buffer = sandbox_for_node(session, workspace_id, node_id, item_id)
    if buffer is None:
        buffer = SandboxBufferRecord(workspace_id=workspace_id, node_id=node_id, item_id=item_id, code=code)
        session.add(buffer)
    else:
        buffer.code = code
        buffer.updated_at = now()
    session.flush()
    return buffer


def count_sandbox_rows(session: Session, node_id: str) -> int:
    return session.exec(
        select(func.count()).select_from(SandboxBufferRecord).where(SandboxBufferRecord.node_id == node_id)
    ).one()
