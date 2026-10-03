"""node projects: membership, the archive marker, and a default project everywhere

Revision ID: 20261006_02
Revises: 20261006_01
Create Date: 2026-10-06

Nullable on purpose: the column is added and filled here, and made required
in `20261006_03`, so a defect in the backfill is correctable by editing this
one step and re-running it, and a rollback that stops between the two needs
no data change. `project_id` carries no foreign key yet for the same reason
SQLite's `DROP COLUMN` would otherwise refuse the downgrade; the next step
adds it while it rebuilds the table anyway.

The backfill is idempotent: a workspace that already has a default project
gets no second one, and only nodes still without a project are touched.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261006_02"
down_revision = "20261006_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_nodes", sa.Column("project_id", sa.String(), nullable=True))
    op.add_column("workspace_nodes", sa.Column("archived_with_project_id", sa.String(), nullable=True))
    op.create_index("ix_workspace_nodes_project_id", "workspace_nodes", ["project_id"])
    op.execute(
        """
        INSERT INTO projects (id, workspace_id, name, instructions, is_default, archived_at, created_at)
        SELECT lower(hex(randomblob(16))), w.id, 'General', '', 1, NULL, w.created_at
        FROM workspaces w
        WHERE NOT EXISTS (
            SELECT 1 FROM projects p WHERE p.workspace_id = w.id AND p.is_default = 1
        )
        """
    )
    op.execute(
        """
        UPDATE workspace_nodes SET project_id = (
            SELECT p.id FROM projects p
            WHERE p.workspace_id = workspace_nodes.workspace_id AND p.is_default = 1
        )
        WHERE project_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_nodes_project_id", table_name="workspace_nodes")
    op.execute("ALTER TABLE workspace_nodes DROP COLUMN archived_with_project_id")
    op.execute("ALTER TABLE workspace_nodes DROP COLUMN project_id")
