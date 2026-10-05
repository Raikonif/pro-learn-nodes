"""Permission decisions a learner asked to have remembered."""

from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from models.workspace import new_id, now


class PermissionDecisionRecord(SQLModel, table=True):
    """"Always allow edits in this node, on this agent" — one kind of action, answered once.

    Keyed by the account's workspace, the node, the agent, and the tool call's
    kind, so a decision never applies to another account, node, or agent (see
    the change design, "A remembered decision is one kind of action, in one
    node, on one agent"). `agent_id` carries no foreign key: a decision for an
    agent since removed matches nothing, and is listed until revoked.
    """

    __tablename__ = "permission_decisions"
    __table_args__ = (
        UniqueConstraint("workspace_id", "node_id", "agent_id", "kind", name="uq_permission_decision_key"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    node_id: str = Field(foreign_key="workspace_nodes.id", nullable=False)
    agent_id: str = Field(nullable=False)
    kind: str = Field(nullable=False)
    allow: bool = Field(nullable=False)
    created_at: datetime = Field(default_factory=now, nullable=False)
