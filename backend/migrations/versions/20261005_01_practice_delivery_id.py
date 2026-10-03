"""practice delivery id: each item names the delivery that brought it

Revision ID: 20261005_01
Revises: 20261004_01
Create Date: 2026-10-05

`practice_items.delivery_id` holds the id of the `practice_delivered`
message an agent's item arrived with, so practice can be grouped the way it
arrived without reading the conversation. It is a plain string, not a
foreign key: messages are never deleted, and a constraint into
`chat_messages` would only raise a cascade question with no answer.

Existing deliveries already list their items in `data.itemIds`, so the
column is backfilled from them. Items the learner authored were never
delivered and stay null.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261005_01"
down_revision = "20261004_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("practice_items", sa.Column("delivery_id", sa.String(), nullable=True))
    op.create_index("ix_practice_items_delivery_id", "practice_items", ["delivery_id"])
    # One delivery record per (turn, tool), and an item is delivered once, so
    # each item matches at most one message; `LIMIT 1` only keeps a damaged
    # database from failing the upgrade.
    op.execute(
        """
        UPDATE practice_items SET delivery_id = (
            SELECT m.id FROM chat_messages AS m, json_each(m.data, '$.itemIds') AS delivered
            WHERE m.kind = 'practice_delivered'
              AND m.workspace_id = practice_items.workspace_id
              AND delivered.value = practice_items.id
            ORDER BY m.created_at
            LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_practice_items_delivery_id", table_name="practice_items")
    op.execute("ALTER TABLE practice_items DROP COLUMN delivery_id")
