"""require an owner on every workspace

Revision ID: 20260825_02
Revises: 20260825_01
Create Date: 2026-08-25

Separate from the backfill on purpose. Keeping the tightening in its own
revision means a defect in adoption is correctable by editing one migration
and re-running it, with no schema rollback in between — and a rollback that
stops here needs no data change at all, because a nullable column happily
holds the values the backfill wrote.
"""

from alembic import op
import sqlalchemy as sa

revision = "20260825_02"
down_revision = "20260825_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite has no `ALTER TABLE ... ALTER COLUMN`, so the only way to change
    # nullability is to copy the table through a new definition.
    # `recreate="always"` says so outright rather than leaving Alembic to
    # decide, which is what makes the operation behave the same on every SQLite
    # version this ships against.
    #
    # The rebuild drops `workspaces` and renames a copy into its place. SQLite
    # rewrites foreign keys in *other* tables on a rename, so the eight child
    # tables pointing here are the real risk; `tests/test_workspace_adoption.py`
    # re-proves each of them with `PRAGMA foreign_key_list` afterwards rather
    # than trusting that the previous rebuild in `20260824_01` means this one
    # is safe too. Enforcement is off on the migration connection — only
    # `core/database.py` sets `PRAGMA foreign_keys = ON` — so the drop does not
    # trip over those children while the table is briefly absent.
    with op.batch_alter_table("workspaces", recreate="always") as batch:
        batch.alter_column(
            "profile_id",
            existing_type=sa.String(),
            nullable=False,
            # The `existing_*` pair is what the rebuild copies forward. Batch
            # mode reconstructs the column from what it is told, not from the
            # live schema, so omitting them is how a rebuild emits a column
            # whose type no longer matches the values already in it.
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("workspaces", recreate="always") as batch:
        batch.alter_column(
            "profile_id",
            existing_type=sa.String(),
            nullable=True,
            existing_nullable=False,
        )
