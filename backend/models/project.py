"""Projects: named groups of a workspace's nodes."""

from datetime import datetime

from sqlalchemy import Index, Text, text, Column
from sqlmodel import Field, SQLModel

from models.workspace import new_id, now


class ProjectRecord(SQLModel, table=True):
    """A group a node belongs to, never a container a link must respect.

    Membership is the single `workspace_nodes.project_id` column; nothing in
    the graph compares two ends' projects. The default project is a real row,
    so no code path has an "unassigned" branch.
    """

    __tablename__ = "projects"
    __table_args__ = (
        # "Exactly one default per workspace" held by the database itself, not
        # only by the code that creates it.
        Index(
            "uq_default_project_per_workspace",
            "workspace_id",
            unique=True,
            sqlite_where=text("is_default = 1"),
        ),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    workspace_id: str = Field(foreign_key="workspaces.id", nullable=False, index=True)
    name: str = Field(nullable=False)
    instructions: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    is_default: bool = Field(default=False, nullable=False)
    # Set while the project is archived; the nodes it took with it carry
    # `archived_with_project_id` so restoring reverses exactly that.
    archived_at: datetime | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=now, nullable=False)
