"""local workspace and retrieval foundation

Revision ID: 20260821_01
Revises:
Create Date: 2026-08-21
"""

from alembic import op
import sqlalchemy as sa

revision = "20260821_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "workspace_contexts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("last_open_node_id", sa.String(), nullable=True),
        sa.Column("viewport", sa.JSON(), nullable=False),
    )
    op.create_index("uq_workspace_context_workspace", "workspace_contexts", ["workspace_id"], unique=True)
    op.create_table(
        "workspace_nodes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("active_skills", sa.JSON(), nullable=False),
        sa.Column("mcp_servers", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workspace_nodes_workspace_id", "workspace_nodes", ["workspace_id"])
    op.create_table(
        "chat_threads",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("anchor_id", sa.String(), nullable=True),
    )
    op.create_index("ix_chat_threads_workspace_id", "chat_threads", ["workspace_id"])
    op.create_index("ix_chat_threads_node_id", "chat_threads", ["node_id"])
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("thread_id", sa.String(), sa.ForeignKey("chat_threads.id"), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chat_messages_workspace_id", "chat_messages", ["workspace_id"])
    op.create_index("ix_chat_messages_thread_id", "chat_messages", ["thread_id"])
    op.create_table(
        "selection_anchors",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("source_message_id", sa.String(), sa.ForeignKey("chat_messages.id"), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False),
    )
    op.create_index("ix_selection_anchors_workspace_id", "selection_anchors", ["workspace_id"])
    op.create_table(
        "node_links",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("parent_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("child_id", sa.String(), sa.ForeignKey("workspace_nodes.id"), nullable=False),
        sa.Column("anchor_id", sa.String(), sa.ForeignKey("selection_anchors.id"), nullable=True),
    )
    op.create_index("ix_node_links_workspace_id", "node_links", ["workspace_id"])
    op.create_table(
        "sources",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("index_status", sa.String(), nullable=False),
        sa.Column("index_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sources_workspace_id", "sources", ["workspace_id"])
    op.create_index("ix_sources_index_status", "sources", ["index_status"])
    op.create_table(
        "source_chunks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("workspace_id", sa.String(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("source_id", sa.String(), sa.ForeignKey("sources.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.UniqueConstraint("source_id", "ordinal", name="uq_source_chunk_ordinal"),
    )
    op.create_index("ix_source_chunks_workspace_id", "source_chunks", ["workspace_id"])
    op.create_index("ix_source_chunks_source_id", "source_chunks", ["source_id"])
    op.execute("CREATE UNIQUE INDEX uq_main_thread_per_node ON chat_threads(node_id) WHERE anchor_id IS NULL")
    op.execute(
        "CREATE VIRTUAL TABLE source_chunk_fts USING fts5("
        "chunk_id UNINDEXED, workspace_id UNINDEXED, source_id UNINDEXED, content)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS source_chunk_fts")
    op.drop_table("source_chunks")
    op.drop_table("sources")
    op.drop_table("node_links")
    op.drop_table("selection_anchors")
    op.drop_table("chat_messages")
    op.drop_table("chat_threads")
    op.drop_table("workspace_nodes")
    op.drop_table("workspace_contexts")
    op.drop_table("workspaces")
