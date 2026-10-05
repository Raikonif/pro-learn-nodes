"""Data access for remembered permission decisions.

Every query is filtered by `workspace_id`, so another account's decision is
answered exactly as one that does not exist. Like the other repositories,
each function takes the caller's `Session`; the transaction boundary is the
service's.
"""

from __future__ import annotations

from sqlmodel import Session, select

from models.permission import PermissionDecisionRecord


def find(
    session: Session, workspace_id: str, node_id: str, agent_id: str, kind: str
) -> PermissionDecisionRecord | None:
    return session.exec(
        select(PermissionDecisionRecord).where(
            PermissionDecisionRecord.workspace_id == workspace_id,
            PermissionDecisionRecord.node_id == node_id,
            PermissionDecisionRecord.agent_id == agent_id,
            PermissionDecisionRecord.kind == kind,
        )
    ).first()


def remember(
    session: Session, workspace_id: str, node_id: str, agent_id: str, kind: str, allow: bool
) -> PermissionDecisionRecord:
    """Record the decision, replacing the answer of one already remembered for the same key."""

    record = find(session, workspace_id, node_id, agent_id, kind)
    if record is None:
        record = PermissionDecisionRecord(
            workspace_id=workspace_id, node_id=node_id, agent_id=agent_id, kind=kind, allow=allow
        )
        session.add(record)
    else:
        record.allow = allow
    session.flush()
    return record


def list_for(session: Session, workspace_id: str) -> list[PermissionDecisionRecord]:
    return list(
        session.exec(
            select(PermissionDecisionRecord)
            .where(PermissionDecisionRecord.workspace_id == workspace_id)
            .order_by(PermissionDecisionRecord.created_at)
        ).all()
    )


def revoke(session: Session, workspace_id: str, decision_id: str) -> bool:
    record = session.exec(
        select(PermissionDecisionRecord).where(
            PermissionDecisionRecord.id == decision_id,
            PermissionDecisionRecord.workspace_id == workspace_id,
        )
    ).first()
    if record is None:
        return False
    session.delete(record)
    return True
