"""Canonical local workspace and retrieval persistence records."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Column, Index, JSON, String, Text, text
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class WorkspaceRecord(SQLModel, table=True):
    __tablename__ = "workspaces"

    id: str = Field(default_factory=new_id, primary_key=True)
    # Nullable only until adoption runs. The workspace that predates accounts
    # has no owner to name at migration time, so a later migration tightens
    # this to non-nullable once every row has been attached to a profile.
    profile_id: str | None = Field(default=None, foreign_key="profiles.id", index=True)
    revision: int = Field(default=0, nullable=False)
    created_at: datetime = Field(default_factory=now, nullable=False)


class WorkspaceContextRecord(SQLModel, table=True):
    __tablename__ = "workspace_contexts"
    __table_args__ = (Index("uq_workspace_context_workspace", "workspace_id", unique=True),)

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False)
    last_open_node_id: str | None = Field(default=None)
    viewport: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class WorkspaceNodeRecord(SQLModel, table=True):
    __tablename__ = "workspace_nodes"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    title: str = Field(sa_column=Column(String, nullable=False))
    mode: str = Field(sa_column=Column(String, nullable=False))
    body: str = Field(default="", sa_column=Column(Text, nullable=False))
    active_skills: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    mcp_servers: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    # The agent this node's conversation runs on. Null until the first turn
    # resolves the account's default and records it here, so changing the
    # default later never silently moves an existing conversation. No foreign
    # key: removing a registration clears this in the same transaction
    # (`repository/agent_repo.py:remove`), and adding a constrained column to
    # an existing SQLite table would mean rebuilding it.
    backend_agent_id: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    # Where the title came from, so an automatic title never overwrites one a
    # learner chose: "provisional" (a quick start, awaiting its first
    # message), "auto" (derived from that message), "topic", or "learner".
    title_source: str = Field(
        default="topic", sa_column=Column(String, nullable=False, server_default="topic")
    )
    # Retired, not deleted: hidden from the history and the graph, restorable.
    # The column `node-projects-and-archive` specifies, pulled forward.
    archived_at: datetime | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=now, nullable=False)
    last_opened_at: datetime = Field(default_factory=now, nullable=False)
    # Bumped when the node is opened and whenever a message is recorded in any
    # of its threads — what the session history is ordered by.
    last_activity_at: datetime = Field(default_factory=now, nullable=False)


class SelectionAnchorRecord(SQLModel, table=True):
    __tablename__ = "selection_anchors"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    source_message_id: str = Field(foreign_key="chat_messages.id", nullable=False)
    start_offset: int = Field(ge=0, nullable=False)
    end_offset: int = Field(ge=0, nullable=False)
    excerpt: str = Field(sa_column=Column(Text, nullable=False))


class NodeLinkRecord(SQLModel, table=True):
    __tablename__ = "node_links"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    parent_id: str = Field(foreign_key="workspace_nodes.id", nullable=False)
    child_id: str = Field(foreign_key="workspace_nodes.id", nullable=False)
    anchor_id: str | None = Field(default=None, foreign_key="selection_anchors.id")


class ChatThreadRecord(SQLModel, table=True):
    __tablename__ = "chat_threads"
    __table_args__ = (
        Index(
            "uq_main_thread_per_node",
            "node_id",
            unique=True,
            sqlite_where=text("anchor_id IS NULL"),
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    node_id: str = Field(foreign_key="workspace_nodes.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    anchor_id: str | None = Field(default=None, foreign_key="selection_anchors.id")


class AgentSessionRecord(SQLModel, table=True):
    """One agent's own session for one thread — a cache, never the record.

    A thread keeps a session per agent that has run it, so returning to an
    agent continues its session instead of replaying the conversation.
    `synced_through` is the `created_at` of the last recorded message that
    agent has been given; what came after it is what it missed.
    """

    __tablename__ = "agent_sessions"
    __table_args__ = (Index("uq_agent_session_per_thread", "thread_id", "agent_id", unique=True),)

    id: str = Field(default_factory=new_id, primary_key=True)
    thread_id: str = Field(foreign_key="chat_threads.id", nullable=False, index=True)
    # No foreign key: removing a registration leaves its sessions as inert
    # history rather than cascading into the conversation's tables.
    agent_id: str = Field(sa_column=Column(String, nullable=False))
    session_id: str = Field(sa_column=Column(String, nullable=False))
    synced_through: datetime | None = Field(default=None, nullable=True)


class ChatMessageRecord(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    thread_id: str = Field(foreign_key="chat_threads.id", nullable=False, index=True)
    role: str = Field(sa_column=Column(String, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    # "message", or a record of what happened around one: "tool" activity, a
    # "permission_refused" request, a "continuity_seam" where the agent's
    # session could not be resumed.
    kind: str = Field(
        default="message",
        sa_column=Column(String, nullable=False, server_default="message"),
    )
    # How an agent turn ended. "incomplete" from the moment the turn starts,
    # so a turn whose connection dropped reads as incomplete on reopening
    # rather than as a finished answer. Null for learner messages and for
    # agent messages that predate streaming.
    outcome: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    # Structured detail for a non-message kind — a delivery's tool and item
    # ids — so the record still leads somewhere after a restart.
    data: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=now, nullable=False)


class SourceRecord(SQLModel, table=True):
    __tablename__ = "sources"

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    title: str = Field(sa_column=Column(String, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    metadata_json: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    index_status: str = Field(default="pending", sa_column=Column(String, nullable=False, index=True))
    index_error: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=now, nullable=False)


class SourceChunkRecord(SQLModel, table=True):
    __tablename__ = "source_chunks"
    __table_args__ = (Index("uq_source_chunk_ordinal", "source_id", "ordinal", unique=True),)

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    source_id: str = Field(foreign_key="sources.id", nullable=False, index=True)
    ordinal: int = Field(nullable=False)
    start_offset: int = Field(nullable=False)
    end_offset: int = Field(nullable=False)
    content: str = Field(sa_column=Column(Text, nullable=False))
