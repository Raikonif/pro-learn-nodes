"""practice: items, append-only attempts, one sandbox buffer per node

Revision ID: 20261002_01
Revises: 20261001_01
Create Date: 2026-10-02

Three new tables; no existing table is touched, so there is nothing to
backfill and no existing row at risk.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261002_01"
down_revision = "20261001_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("reference_answer", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_practice_items_workspace_id", "practice_items", ["workspace_id"])
    op.create_index("ix_practice_items_node_id", "practice_items", ["node_id"])
    op.create_table(
        "practice_attempts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("item_id", sa.String(), sa.ForeignKey("practice_items.id"), nullable=False),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("chosen_option", sa.Integer(), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_practice_attempts_workspace_id", "practice_attempts", ["workspace_id"])
    op.create_index("ix_practice_attempts_node_id", "practice_attempts", ["node_id"])
    op.create_index("ix_practice_attempts_item_id", "practice_attempts", ["item_id"])
    op.create_table(
        "sandbox_buffers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False, unique=True),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_sandbox_buffers_workspace_id", "sandbox_buffers", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("sandbox_buffers")
    op.drop_table("practice_attempts")
    op.drop_table("practice_items")
