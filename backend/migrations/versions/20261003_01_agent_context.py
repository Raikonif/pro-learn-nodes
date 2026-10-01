"""agent context: authorship, code exercises, per-exercise buffers, delivery data, memory

Revision ID: 20261003_01
Revises: 20261002_01
Create Date: 2026-10-03

`sandbox_buffers` is the one table rebuilt: its `node_id` carried a column
UNIQUE that SQLite cannot drop in place, and a node now has a buffer per
exercise beside its free one. It is new, small, and has no partial index
that a rebuild could lose. Every existing buffer becomes its node's free
buffer (`item_id` null). Everything else is added in place.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261003_01"
down_revision = "20261002_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in ("starter_code", "expected_output"):
        op.add_column("practice_items", sa.Column(column, sa.Text(), nullable=True))
    for column in ("authored_by_agent_id", "authored_by_name"):
        op.add_column("practice_items", sa.Column(column, sa.String(), nullable=True))
    op.add_column("practice_attempts", sa.Column("run_outcome", sa.String(), nullable=True))
    op.add_column("practice_attempts", sa.Column("run_output", sa.Text(), nullable=True))
    op.add_column("chat_messages", sa.Column("data", sa.JSON(), nullable=True))

    op.create_table(
        "sandbox_buffers_new",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("item_id", sa.String(), sa.ForeignKey("practice_items.id"), nullable=True),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.execute(
        "INSERT INTO sandbox_buffers_new (id, workspace_id, node_id, item_id, code, updated_at) "
        "SELECT id, workspace_id, node_id, NULL, code, updated_at FROM sandbox_buffers"
    )
    op.drop_table("sandbox_buffers")
    op.rename_table("sandbox_buffers_new", "sandbox_buffers")
    op.create_index("ix_sandbox_buffers_workspace_id", "sandbox_buffers", ["workspace_id"])
    op.create_index("uq_sandbox_buffer_per_item", "sandbox_buffers", ["node_id", "item_id"], unique=True)
    op.create_index(
        "uq_free_sandbox_buffer", "sandbox_buffers", ["node_id"], unique=True,
        sqlite_where=sa.text("item_id IS NULL"),
    )

    op.create_table(
        "memories",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("profile_id", sa.String(), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("topic", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("revises_id", sa.String(), sa.ForeignKey("memories.id"), nullable=True),
        sa.Column("proposed_by_name", sa.String(), nullable=False),
        sa.Column("source_node_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_memories_profile_id", "memories", ["profile_id"])
    op.create_index(
        "uq_accepted_memory_topic", "memories", ["profile_id", "topic"], unique=True,
        sqlite_where=sa.text("status = 'accepted' AND topic IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_accepted_memory_topic", table_name="memories")
    op.drop_index("ix_memories_profile_id", table_name="memories")
    op.drop_table("memories")
    op.create_table(
        "sandbox_buffers_old",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False, unique=True),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    # Exercise buffers have no place in the old shape; the free buffer survives.
    op.execute(
        "INSERT INTO sandbox_buffers_old (id, workspace_id, node_id, code, updated_at) "
        "SELECT id, workspace_id, node_id, code, updated_at FROM sandbox_buffers WHERE item_id IS NULL"
    )
    op.drop_table("sandbox_buffers")
    op.rename_table("sandbox_buffers_old", "sandbox_buffers")
    op.create_index("ix_sandbox_buffers_workspace_id", "sandbox_buffers", ["workspace_id"])
    for table, column in (("chat_messages", "data"), ("practice_attempts", "run_output"),
                          ("practice_attempts", "run_outcome"), ("practice_items", "authored_by_name"),
                          ("practice_items", "authored_by_agent_id"), ("practice_items", "expected_output"),
                          ("practice_items", "starter_code")):
        op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
