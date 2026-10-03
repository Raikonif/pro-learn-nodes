"""agent session controls: per-node choices and state, per-agent offer

Revision ID: 20261004_01
Revises: 20261003_01
Create Date: 2026-10-04

Four nullable JSON columns, added in place. Existing sessions have no
choices and run on their agent's defaults, as before.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261004_01"
down_revision = "20261003_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_nodes", sa.Column("agent_settings", sa.JSON(), nullable=True))
    op.add_column("workspace_nodes", sa.Column("agent_state", sa.JSON(), nullable=True))
    op.add_column("agent_registrations", sa.Column("offered_options", sa.JSON(), nullable=True))
    op.add_column("agent_registrations", sa.Column("offered_commands", sa.JSON(), nullable=True))


def downgrade() -> None:
    for table, column in (("agent_registrations", "offered_commands"), ("agent_registrations", "offered_options"),
                          ("workspace_nodes", "agent_state"), ("workspace_nodes", "agent_settings")):
        op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
