"""require a project on every node

Revision ID: 20261006_03
Revises: 20261006_02
Create Date: 2026-10-06

Separate from the backfill so the tightening can be re-run on its own. SQLite
has no `ALTER COLUMN`, so the table is rebuilt (`recreate="always"`), and the
rebuild is also where the foreign key to `projects` is added.

Batch mode reflects the live table, so the plain indexes survive the copy
(`ix_workspace_nodes_workspace_id`, `..._last_activity_at`, `..._project_id`);
`tests/test_node_projects_migration.py` re-proves that, and that the tables
pointing at `workspace_nodes` still point at it afterwards. Enforcement is off
on the migration connection, so the brief absence of the table trips nothing.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261006_03"
down_revision = "20261006_02"
branch_labels = None
depends_on = None

_FK = "fk_workspace_nodes_project_id"


def upgrade() -> None:
    with op.batch_alter_table("workspace_nodes", recreate="always") as batch:
        batch.alter_column(
            "project_id", existing_type=sa.String(), nullable=False, existing_nullable=True
        )
        batch.create_foreign_key(_FK, "projects", ["project_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("workspace_nodes", recreate="always") as batch:
        batch.drop_constraint(_FK, type_="foreignkey")
        batch.alter_column(
            "project_id", existing_type=sa.String(), nullable=True, existing_nullable=False
        )
