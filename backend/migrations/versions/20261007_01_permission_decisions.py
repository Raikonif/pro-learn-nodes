"""permission_decisions: what a learner asked to have remembered

Revision ID: 20261007_01
Revises: 20261006_03
Create Date: 2026-10-07

Only an addition: a new table, empty until a learner remembers a decision.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261007_01"
down_revision = "20261006_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "permission_decisions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("allow", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("workspace_id", "node_id", "agent_id", "kind", name="uq_permission_decision_key"),
    )
    op.create_index("ix_permission_decisions_workspace_id", "permission_decisions", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_permission_decisions_workspace_id", table_name="permission_decisions")
    op.drop_table("permission_decisions")
