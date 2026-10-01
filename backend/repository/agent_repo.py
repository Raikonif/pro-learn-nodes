"""Data access for registered agents.

Every query is filtered by `profile_id`, including lookups by id: a
registration of another account is answered exactly as one that does not
exist, so a caller learns nothing about what another account has registered.
Like `repository/profile_repo.py`, every function takes the caller's
`Session`; the transaction boundary is the service's.
"""

from __future__ import annotations

from sqlmodel import Session, select

from models.agent import AgentRegistrationRecord
from models.workspace import WorkspaceNodeRecord, WorkspaceRecord


def list_for(session: Session, profile_id: str) -> list[AgentRegistrationRecord]:
    return list(
        session.exec(
            select(AgentRegistrationRecord)
            .where(AgentRegistrationRecord.profile_id == profile_id)
            .order_by(AgentRegistrationRecord.created_at)
        ).all()
    )


def get(session: Session, profile_id: str, agent_id: str) -> AgentRegistrationRecord | None:
    return session.exec(
        select(AgentRegistrationRecord).where(
            AgentRegistrationRecord.id == agent_id,
            AgentRegistrationRecord.profile_id == profile_id,
        )
    ).first()


def default_for(session: Session, profile_id: str) -> AgentRegistrationRecord | None:
    return session.exec(
        select(AgentRegistrationRecord).where(
            AgentRegistrationRecord.profile_id == profile_id,
            AgentRegistrationRecord.is_default == True,  # noqa: E712 — SQL, not Python
        )
    ).first()


def create(
    session: Session,
    *,
    profile_id: str,
    name: str,
    command: str,
    args: list[str],
    env: dict[str, str],
) -> AgentRegistrationRecord:
    """Insert a registration. The account's first becomes its default."""

    record = AgentRegistrationRecord(
        profile_id=profile_id,
        name=name,
        command=command,
        args=list(args),
        env=dict(env),
        is_default=default_for(session, profile_id) is None,
    )
    session.add(record)
    session.flush()
    return record


def set_default(session: Session, profile_id: str, agent_id: str) -> AgentRegistrationRecord | None:
    record = get(session, profile_id, agent_id)
    if record is None:
        return None
    current = default_for(session, profile_id)
    if current is not None and current.id != record.id:
        current.is_default = False
        # Flushed before the new default is set: the partial unique index is
        # checked per statement, so two rows may never both be default even
        # inside the transaction.
        session.flush()
    record.is_default = True
    session.flush()
    return record


def remove(session: Session, profile_id: str, agent_id: str) -> bool:
    """Delete a registration and release every node that ran on it.

    Those nodes fall back to the account default on their next turn. Their
    recorded conversations are untouched — the spec's "removing an agent does
    not remove history". A removed default is replaced by the oldest remaining
    registration, so an account with agents is never left without a default.
    """

    record = get(session, profile_id, agent_id)
    if record is None:
        return False
    nodes = session.exec(
        select(WorkspaceNodeRecord)
        .join(WorkspaceRecord, WorkspaceRecord.id == WorkspaceNodeRecord.workspace_id)
        .where(
            WorkspaceRecord.profile_id == profile_id,
            WorkspaceNodeRecord.backend_agent_id == agent_id,
        )
    ).all()
    for node in nodes:
        node.backend_agent_id = None
    was_default = record.is_default
    session.delete(record)
    session.flush()
    if was_default:
        remaining = list_for(session, profile_id)
        if remaining:
            remaining[0].is_default = True
            session.flush()
    return True
