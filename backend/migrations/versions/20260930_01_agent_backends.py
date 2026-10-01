"""record which agent a conversation runs on

Revision ID: 20260930_01
Revises: 20260825_02
Create Date: 2026-09-30

Purely additive, so nothing is rebuilt: a new table, and nullable columns
added with `ALTER TABLE ... ADD COLUMN`, which SQLite does in place. Existing
nodes get no backend and resolve the account's default on their next turn;
existing messages become `kind = "message"` with no outcome, which is what
they were.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260930_01"
down_revision = "20260825_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_registrations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("profile_id", sa.String(), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("command", sa.String(), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("env", sa.JSON(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_agent_registrations_profile_id", "agent_registrations", ["profile_id"]
    )
    op.create_index(
        "uq_default_agent_per_profile",
        "agent_registrations",
        ["profile_id"],
        unique=True,
        sqlite_where=sa.text("is_default = 1"),
    )
    op.add_column("workspace_nodes", sa.Column("backend_agent_id", sa.String(), nullable=True))
    op.add_column("chat_threads", sa.Column("agent_id", sa.String(), nullable=True))
    op.add_column("chat_threads", sa.Column("agent_session_id", sa.String(), nullable=True))
    op.add_column(
        "chat_messages",
        sa.Column("kind", sa.String(), nullable=False, server_default="message"),
    )
    op.add_column("chat_messages", sa.Column("outcome", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_column("outcome")
        batch.drop_column("kind")
    with op.batch_alter_table("chat_threads") as batch:
        batch.drop_column("agent_session_id")
        batch.drop_column("agent_id")
    with op.batch_alter_table("workspace_nodes") as batch:
        batch.drop_column("backend_agent_id")
    op.drop_index("uq_default_agent_per_profile", table_name="agent_registrations")
    op.drop_index("ix_agent_registrations_profile_id", table_name="agent_registrations")
    op.drop_table("agent_registrations")
