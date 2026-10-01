"""account profiles and workspace ownership

Revision ID: 20260824_01
Revises: 20260821_01
Create Date: 2026-08-24
"""

from alembic import op
import sqlalchemy as sa

revision = "20260824_01"
down_revision = "20260821_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_profile_identity", "profiles", ["provider", "subject"], unique=True)
    # SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so a plain `add_column`
    # carrying a ForeignKey fails outright. `recreate="always"` makes Alembic
    # copy the table through a new definition that names the constraint in its
    # `CREATE TABLE`, which is the only way the FK actually exists afterwards.
    # Enforcement is off on the migration connection (only `core/database.py`
    # sets `PRAGMA foreign_keys = ON`), so the drop-and-rename this performs
    # does not trip over the nine child tables pointing at `workspaces`.
    with op.batch_alter_table("workspaces", recreate="always") as batch:
        # Nullable on purpose: workspaces created before accounts existed have
        # no owner yet. Startup adoption attaches them, and a later migration
        # tightens the column once that is proven.
        batch.add_column(
            sa.Column(
                "profile_id",
                sa.String(),
                # Batch mode rejects an unnamed constraint outright, since it
                # rebuilds the table by name rather than by object identity.
                sa.ForeignKey("profiles.id", name="fk_workspaces_profile"),
                nullable=True,
            )
        )
    op.create_index("ix_workspaces_profile_id", "workspaces", ["profile_id"])


def downgrade() -> None:
    op.drop_index("ix_workspaces_profile_id", table_name="workspaces")
    # The column goes before the table it points at: reflecting `workspaces`
    # while its foreign key names a table that no longer exists is how the
    # rebuild would fail halfway through a rollback.
    with op.batch_alter_table("workspaces", recreate="always") as batch:
        batch.drop_column("profile_id")
    op.drop_index("uq_profile_identity", table_name="profiles")
    op.drop_table("profiles")
