"""Agents a learner has registered — a command to launch, never a credential.

Owned by a profile, like every other workspace datum: another account's
registrations and default are not in effect, so a learner who signs in as
someone else never finds their agents, or their subscription, behind it.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, Index, JSON, String, text
from sqlmodel import Field, SQLModel

from models.workspace import new_id, now


class AgentRegistrationRecord(SQLModel, table=True):
    __tablename__ = "agent_registrations"
    # At most one default per account, held by the database rather than by a
    # clear-then-set in the service that two concurrent requests could
    # interleave into two defaults.
    __table_args__ = (
        Index(
            "uq_default_agent_per_profile",
            "profile_id",
            unique=True,
            sqlite_where=text("is_default = 1"),
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    profile_id: str = Field(foreign_key="profiles.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    command: str = Field(sa_column=Column(String, nullable=False))
    args: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    # Environment the agent needs to launch (a PATH, a config directory) —
    # not a place for secrets. The agent authenticates through its own
    # mechanism, and nothing here ever asks for a key to put in this map.
    env: dict[str, str] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    is_default: bool = Field(default=False, nullable=False)
    # What the agent last reported offering on this device: its session
    # config options and its commands. Recorded, never configured.
    offered_options: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    offered_commands: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=now, nullable=False)
