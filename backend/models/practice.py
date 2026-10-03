"""Practice material a learner works through on a node.

Three records, all node-scoped and none of them nodes: an item (a question),
an attempt (one answer to it, never rewritten), and the node's sandbox
buffer (its code, one per node). Kept apart from the graph deliberately —
see `practice-rail-foundation`'s design, "Attempts link to a node".
"""

from datetime import datetime
from typing import Any

from sqlalchemy import Column, Index, JSON, String, Text, text
from sqlmodel import Field, SQLModel

from models.workspace import new_id, now


class PracticeItemRecord(SQLModel, table=True):
    __tablename__ = "practice_items"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    node_id: str = Field(foreign_key="workspace_nodes.id", nullable=False, index=True)
    kind: str = Field(sa_column=Column(String, nullable=False))  # free_response | multiple_choice
    prompt: str = Field(sa_column=Column(Text, nullable=False))
    # `[{"text": ..., "correct": bool}]`; empty for free response. A flag per
    # option, not one index, so "two options marked correct" is an input
    # that can be refused rather than one that cannot be expressed.
    options: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    reference_answer: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # Code exercises only: what the learner starts from, and what a correct
    # program prints (optional — the only judgement the app computes).
    starter_code: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    expected_output: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # Null for the learner. The name is a snapshot, so an item still names
    # its author after that agent's registration is removed.
    authored_by_agent_id: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    authored_by_name: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    # The `practice_delivered` message this item arrived with; null for the
    # learner's own items. Not a foreign key — messages are never deleted.
    delivery_id: str | None = Field(default=None, sa_column=Column(String, nullable=True, index=True))
    created_at: datetime = Field(default_factory=now, nullable=False)


class PracticeAttemptRecord(SQLModel, table=True):
    """One answer, recorded once. Answering again inserts; nothing updates."""

    __tablename__ = "practice_attempts"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    node_id: str = Field(foreign_key="workspace_nodes.id", nullable=False, index=True)
    item_id: str = Field(foreign_key="practice_items.id", nullable=False, index=True)
    response: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    chosen_option: int | None = Field(default=None, nullable=True)
    # Computed only where it can be: multiple choice. Null otherwise.
    correct: bool | None = Field(default=None, nullable=True)
    # Reserved for Phase 12's grader; always null here.
    score: float | None = Field(default=None, nullable=True)
    # Code exercises: how the submitted run ended, and what it printed.
    run_outcome: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    run_output: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(default_factory=now, nullable=False)


class SandboxBufferRecord(SQLModel, table=True):
    """A node's code: its free buffer (`item_id` null), or one exercise's solution."""

    __tablename__ = "sandbox_buffers"
    __table_args__ = (
        Index("uq_sandbox_buffer_per_item", "node_id", "item_id", unique=True),
        # SQLite treats NULLs as distinct in a plain unique index, so the one
        # free buffer per node needs its own.
        Index("uq_free_sandbox_buffer", "node_id", unique=True, sqlite_where=text("item_id IS NULL")),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    node_id: str = Field(foreign_key="workspace_nodes.id", nullable=False)
    item_id: str | None = Field(default=None, foreign_key="practice_items.id", nullable=True)
    code: str = Field(default="", sa_column=Column(Text, nullable=False))
    updated_at: datetime = Field(default_factory=now, nullable=False)
