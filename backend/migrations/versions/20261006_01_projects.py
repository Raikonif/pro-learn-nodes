"""projects: the table, the one-default rule, and what an agent session was told

Revision ID: 20261006_01
Revises: 20261005_01
Create Date: 2026-10-06

Only additions: a new table and one nullable column. Nodes do not learn
about projects until `20261006_02`, so this step changes no existing row.
`uq_default_project_per_workspace` is a partial unique index, created here
rather than reflected from anything, so nothing can lose its `WHERE`.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261006_01"
down_revision = "20261005_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"])
    op.create_index(
        "uq_default_project_per_workspace",
        "projects",
        ["workspace_id"],
        unique=True,
        sqlite_where=sa.text("is_default = 1"),
    )
    op.add_column("agent_sessions", sa.Column("project_context", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.execute("ALTER TABLE agent_sessions DROP COLUMN project_context")
    op.drop_index("uq_default_project_per_workspace", table_name="projects")
    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_table("projects")
