"""local sessions: activity, titles, archive, per-agent sessions, message search

Revision ID: 20261001_01
Revises: 20260930_01
Create Date: 2026-10-01

Nothing is rebuilt. Columns are added and dropped with SQLite's own
`ALTER TABLE` (DROP COLUMN since 3.35; the bundled library is 3.50), so
`chat_threads` keeps its partial unique index `uq_main_thread_per_node`
exactly as it was — a batch rebuild would have to reconstruct that `WHERE`
clause from reflection, which is where partial indexes go missing.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261001_01"
down_revision = "20260930_01"
branch_labels = None
depends_on = None

# Conversation only: tool activity, refused permissions, and continuity
# seams are records about a conversation, not things a learner said.
_INDEXED = "new.kind = 'message'"


def upgrade() -> None:
    # 1. Nodes: activity, title source, archive.
    op.add_column("workspace_nodes", sa.Column("last_activity_at", sa.DateTime(), nullable=True))
    op.add_column(
        "workspace_nodes",
        sa.Column("title_source", sa.String(), nullable=False, server_default="topic"),
    )
    op.add_column("workspace_nodes", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.execute(
        """
        UPDATE workspace_nodes SET last_activity_at = MAX(
            last_opened_at,
            COALESCE((
                SELECT MAX(m.created_at) FROM chat_messages m
                JOIN chat_threads t ON t.id = m.thread_id
                WHERE t.node_id = workspace_nodes.id
            ), last_opened_at)
        )
        """
    )
    op.create_index("ix_workspace_nodes_last_activity_at", "workspace_nodes", ["last_activity_at"])

    # 2. One agent session per (thread, agent).
    op.create_table(
        "agent_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("thread_id", sa.String(), sa.ForeignKey("chat_threads.id"), nullable=False),
        sa.Column("agent_id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("synced_through", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_agent_sessions_thread_id", "agent_sessions", ["thread_id"])
    op.create_index(
        "uq_agent_session_per_thread", "agent_sessions", ["thread_id", "agent_id"], unique=True
    )
    op.execute(
        """
        INSERT INTO agent_sessions (id, thread_id, agent_id, session_id, synced_through)
        SELECT lower(hex(randomblob(16))), t.id, t.agent_id, t.agent_session_id,
               (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.thread_id = t.id)
        FROM chat_threads t
        WHERE t.agent_id IS NOT NULL AND t.agent_session_id IS NOT NULL
        """
    )
    op.execute("ALTER TABLE chat_threads DROP COLUMN agent_session_id")
    op.execute("ALTER TABLE chat_threads DROP COLUMN agent_id")

    # 3. Message search, kept in step by triggers so no writer can forget it.
    op.execute(
        "CREATE VIRTUAL TABLE message_fts USING fts5("
        "message_id UNINDEXED, thread_id UNINDEXED, workspace_id UNINDEXED, content)"
    )
    op.execute(
        "INSERT INTO message_fts (message_id, thread_id, workspace_id, content) "
        "SELECT id, thread_id, workspace_id, content FROM chat_messages WHERE kind = 'message'"
    )
    op.execute(
        f"""
        CREATE TRIGGER message_fts_insert AFTER INSERT ON chat_messages WHEN {_INDEXED}
        BEGIN
            INSERT INTO message_fts (message_id, thread_id, workspace_id, content)
            VALUES (new.id, new.thread_id, new.workspace_id, new.content);
        END
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER message_fts_update AFTER UPDATE OF content, kind ON chat_messages
        BEGIN
            DELETE FROM message_fts WHERE message_id = old.id;
            INSERT INTO message_fts (message_id, thread_id, workspace_id, content)
            SELECT new.id, new.thread_id, new.workspace_id, new.content WHERE {_INDEXED};
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER message_fts_delete AFTER DELETE ON chat_messages
        BEGIN
            DELETE FROM message_fts WHERE message_id = old.id;
        END
        """
    )


def downgrade() -> None:
    for trigger in ("message_fts_insert", "message_fts_update", "message_fts_delete"):
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.execute("DROP TABLE IF EXISTS message_fts")

    op.add_column("chat_threads", sa.Column("agent_id", sa.String(), nullable=True))
    op.add_column("chat_threads", sa.Column("agent_session_id", sa.String(), nullable=True))
    # One session per thread again: the most recently synced one wins.
    op.execute(
        """
        UPDATE chat_threads SET
            agent_id = (SELECT s.agent_id FROM agent_sessions s WHERE s.thread_id = chat_threads.id
                        ORDER BY s.synced_through DESC LIMIT 1),
            agent_session_id = (SELECT s.session_id FROM agent_sessions s
                                WHERE s.thread_id = chat_threads.id
                                ORDER BY s.synced_through DESC LIMIT 1)
        """
    )
    op.drop_index("uq_agent_session_per_thread", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_thread_id", table_name="agent_sessions")
    op.drop_table("agent_sessions")

    op.drop_index("ix_workspace_nodes_last_activity_at", table_name="workspace_nodes")
    op.execute("ALTER TABLE workspace_nodes DROP COLUMN archived_at")
    op.execute("ALTER TABLE workspace_nodes DROP COLUMN title_source")
    op.execute("ALTER TABLE workspace_nodes DROP COLUMN last_activity_at")
