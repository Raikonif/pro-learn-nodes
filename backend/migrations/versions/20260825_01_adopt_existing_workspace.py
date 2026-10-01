"""adopt the pre-account workspace into a local profile

Revision ID: 20260825_01
Revises: 20260824_01
Create Date: 2026-08-25

A data migration rather than startup code, and the ordering is what forces it:
`core/runtime.py:initialize_local_data` calls `migrate_database` before
anything else could adopt, so a runtime backfill would only ever be reached
*after* the following non-nullable revision had already failed on the exact
rows it was meant to repair. Alembic's version table also makes "adoption
happens once" a property of the mechanism rather than an idempotence check
someone has to remember to write.

Everything below is core SQL against the connection. Importing
`models.profile` would tie this revision to whatever that class looks like in
the future, and surviving exactly that kind of drift is what migrations exist
for — a column renamed in the model six months from now must not change what
this file did to a database it already ran against.
"""

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa

revision = "20260825_01"
down_revision = "20260824_01"
branch_labels = None
depends_on = None

# The identity of the adopted account, and permanently so: `(provider,
# subject)` is the database identity enforced by `uq_profile_identity`, so
# changing either value after this has shipped would enroll a second account
# and leave the learner's graph attached to the first.
ADOPTED_PROVIDER = "local"
ADOPTED_SUBJECT = "adopted-workspace"

# Fixed rather than generated so that re-running this revision against a
# restored backup reproduces the same row, and so the id is recognizable in a
# support session as "the account adoption created" rather than an opaque UUID
# indistinguishable from an enrolled one.
ADOPTED_PROFILE_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    connection = op.get_bind()

    # Conditional on there being something to adopt. An unconditional insert
    # would hand every fresh installation an account nobody signed in to, and
    # the sign-in gate would then have to explain a profile the learner never
    # created.
    unowned = connection.execute(
        sa.text("SELECT COUNT(*) FROM workspaces WHERE profile_id IS NULL")
    ).scalar_one()
    if not unowned:
        return

    # Reused rather than inserted blindly: `uq_profile_identity` makes a
    # duplicate a hard failure, which would surface as a crash on launch for
    # anyone who already holds a `local` profile — and an upgrade that cannot
    # run is strictly worse than one that adopts into an existing account.
    profile_id = connection.execute(
        sa.text("SELECT id FROM profiles WHERE provider = :provider AND subject = :subject"),
        {"provider": ADOPTED_PROVIDER, "subject": ADOPTED_SUBJECT},
    ).scalar()

    if profile_id is None:
        profile_id = ADOPTED_PROFILE_ID
        connection.execute(
            sa.text(
                "INSERT INTO profiles (id, provider, subject, email, display_name,"
                " avatar_url, created_at)"
                " VALUES (:id, :provider, :subject, NULL, :display_name, NULL, :created_at)"
            ).bindparams(
                # Typed explicitly because a bare `text()` hands the value
                # straight to the DBAPI, and sqlite3 no longer adapts a
                # `datetime` on its own. Binding through SQLAlchemy's own type
                # is what makes this row read back in the same format as every
                # row the application writes.
                sa.bindparam("created_at", type_=sa.DateTime(timezone=True))
            ),
            {
                "id": profile_id,
                "provider": ADOPTED_PROVIDER,
                "subject": ADOPTED_SUBJECT,
                # Named for what it is, so the account affordance shows the
                # learner something meaningful instead of a blank chip.
                "display_name": "Local",
                "created_at": datetime.now(UTC),
            },
        )

    # Every unowned row, not just the one this device is expected to have: a
    # second null would fail the next revision, and failing at that point would
    # abort the upgrade with adoption already committed.
    connection.execute(
        sa.text("UPDATE workspaces SET profile_id = :profile_id WHERE profile_id IS NULL"),
        {"profile_id": profile_id},
    )


def downgrade() -> None:
    connection = op.get_bind()

    # Ownership is released before the profile is deleted; the reverse order
    # would leave `workspaces.profile_id` naming a row that no longer exists,
    # which is the state the foreign key exists to prevent.
    connection.execute(
        sa.text(
            "UPDATE workspaces SET profile_id = NULL WHERE profile_id ="
            " (SELECT id FROM profiles WHERE provider = :provider AND subject = :subject)"
        ),
        {"provider": ADOPTED_PROVIDER, "subject": ADOPTED_SUBJECT},
    )
    # A `local` profile that predated adoption is indistinguishable here from
    # the one adoption inserted, so this removes either. That is acceptable
    # only because the documented rollback in the Migration Plan is restoring
    # the timestamped copy `backup_database` takes before every migration;
    # this path exists so a rollback attempted first does not raise.
    connection.execute(
        sa.text("DELETE FROM profiles WHERE provider = :provider AND subject = :subject"),
        {"provider": ADOPTED_PROVIDER, "subject": ADOPTED_SUBJECT},
    )
