"""Enrollment, activation, and removal of the accounts held on this device.

The three operations a learner thinks of as one — sign in, switch account,
sign out — are deliberately separate here, because only the first needs an
identity provider. `enroll` is the only entry point that takes an `Identity`;
`activate` works from a profile id alone, which is what makes returning to an
enrolled account instant and possible with no network. Nothing in this module
imports an identity adapter, and `tests/test_profile_service.py` nails those
doors shut while it runs so the property is asserted rather than assumed.

Which profile is active is a `SecretStore` entry rather than a row. See the
design's *Sessions are local records*: `core/migrations.py:backup_database`
copies the database before every migration, so a session held in a table would
be duplicated into every backup and would travel with a database copied to
another machine.

Sign-out and removal are kept as far apart as two operations can be. Sign-out
touches the pointer and nothing else; removal destroys rows and demands an
explicit confirmation to do it. Conflating them is how a learner loses a graph
by clicking the wrong item in a menu.
"""

from __future__ import annotations

from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from core.database import session_scope
from core.exceptions import NotFoundError, ValidationError
from core.secrets import SecretStore, get_secret_store
from models.profile import ProfileRecord
from models.project import ProjectRecord
from models.workspace import (
    ChatMessageRecord,
    ChatThreadRecord,
    NodeLinkRecord,
    SelectionAnchorRecord,
    SourceChunkRecord,
    SourceRecord,
    WorkspaceContextRecord,
    WorkspaceNodeRecord,
    WorkspaceRecord,
)
from repository import profile_repo
from service.identity import Identity
from service.workspace import ensure_default_workspace

# One key for the whole app: "at most one account is active" is expressed by
# there being a single slot to hold one, so no code path can leave two.
ACTIVE_PROFILE_KEY = "active-profile"

# Named in the refusal so the learner is told what is destroyed before they
# confirm, rather than after.
_REMOVAL_CONSEQUENCE = (
    "removes the account from this device and permanently destroys its "
    "workspace, nodes, conversations, and sources"
)


def _purge_workspace(session: Session, workspace_id: str) -> None:
    """Delete every row belonging to one workspace.

    `chat_messages → chat_threads → selection_anchors → chat_messages` is a
    genuine foreign-key cycle, so with `core/database.py`'s
    `PRAGMA foreign_keys = ON` no delete order satisfies it. The one nullable
    edge, `chat_threads.anchor_id`, cannot be used to break it either:
    clearing it collides with `uq_main_thread_per_node`, the partial unique
    index that permits a single anchor-less thread per node.

    `defer_foreign_keys` is the mechanism SQLite provides for exactly this. It
    holds enforcement until COMMIT — where the constraints are checked in
    full, so a row missed below still fails rather than being written
    inconsistently — and SQLite clears the pragma itself at the end of the
    transaction, leaving `foreign_keys` untouched for every other caller.

    `source_chunk_fts` is separate work because it is an FTS5 virtual table
    with no foreign keys at all: nothing cascades to it, and a row left there
    would keep a removed account's passages findable through
    `service/retrieval.py:search`.
    """

    session.execute(text("PRAGMA defer_foreign_keys = ON"))
    session.execute(
        text("DELETE FROM source_chunk_fts WHERE workspace_id = :workspace_id"),
        {"workspace_id": workspace_id},
    )
    for model in (
        SourceChunkRecord,
        SourceRecord,
        NodeLinkRecord,
        SelectionAnchorRecord,
        ChatMessageRecord,
        ChatThreadRecord,
        WorkspaceContextRecord,
        WorkspaceNodeRecord,
        ProjectRecord,
    ):
        session.execute(delete(model).where(model.workspace_id == workspace_id))
    session.execute(delete(WorkspaceRecord).where(WorkspaceRecord.id == workspace_id))


class ProfileService:
    """Account operations over one secret store and the configured database.

    The store is a constructor argument rather than a module-level lookup so
    a caller can hold the service across calls without the session pointer
    living in this process: two instances built over the same store agree,
    which is what makes "the active account survives a restart" testable
    without a real restart. It also keeps the suite off the developer's own
    login keychain, following `configure_database(data_dir)`'s precedent of
    taking its dependency instead of reading a global.
    """

    def __init__(self, store: SecretStore | None = None) -> None:
        self._store = store if store is not None else get_secret_store()

    # --- Enrollment and activation ---------------------------------------

    def enroll(self, identity: Identity) -> ProfileRecord:
        """Find or create the account this identity names, and make it active.

        Sign-in is enrollment: the first one creates the profile, every later
        one lands on the same row, so a learner's graph is where they left it.
        """

        try:
            profile = self._store_identity(identity)
        except IntegrityError:
            # `uq_profile_identity` refused the insert, which means another
            # sign-in enrolled this same account between our read and our
            # write. The retry has to run in a *new* transaction: SQLite's
            # read snapshot opened before the winner committed, so re-reading
            # inside the failed one would find no row a second time and
            # attempt the same doomed insert.
            profile = self._store_identity(identity)
        self.activate(profile.id)
        return profile

    def activate(self, profile_id: str) -> ProfileRecord:
        """Make an already-enrolled account the active one.

        Takes an id, never an `Identity`, and so reaches no provider: this is
        the path an account switch and a return after sign-out take, and both
        must work on a device that is offline.
        """

        with session_scope() as session:
            profile = profile_repo.get_by_id(session, profile_id)
            if profile is None:
                raise NotFoundError(f"Unknown profile: {profile_id}")

        # Provisioned before the pointer moves. A session naming an account
        # with no workspace would leave every workspace route refusing, with
        # nothing the learner could do about it from the signed-in state.
        ensure_default_workspace(profile_id=profile.id)
        self._store.set(ACTIVE_PROFILE_KEY, profile.id)
        return profile

    def active_profile(self) -> ProfileRecord | None:
        """The account in force, or `None` when signed out.

        A pointer naming a profile that no longer exists is signed out, not an
        error: a database restored from a backup taken before the account
        enrolled says exactly that, and raising would hide the sign-in surface
        that is the only way out of it. The stale value is cleared on the way
        past so the miss is paid once rather than on every request.
        """

        profile_id = self._store.get(ACTIVE_PROFILE_KEY)
        if profile_id is None:
            return None

        with session_scope() as session:
            profile = profile_repo.get_by_id(session, profile_id)

        if profile is None:
            self._store.delete(ACTIVE_PROFILE_KEY)
            return None
        return profile

    def list_profiles(self) -> list[ProfileRecord]:
        """Every enrolled account, oldest first.

        A thin pass-through, but it exists so the presentation layer never
        reaches the repository directly. The alternative — letting the route
        open its own session — puts a transaction boundary in the one layer
        that has no business owning one.
        """

        with session_scope() as session:
            return profile_repo.list_all(session)

    def sign_out(self) -> None:
        """End the session, keeping the enrollment and all of its data.

        Idempotent, because signing out has to succeed after a half-finished
        sign-in — otherwise the learner is stuck in a state they cannot leave.
        """

        self._store.delete(ACTIVE_PROFILE_KEY)

    # --- Removal ----------------------------------------------------------

    def delete_profile(self, profile_id: str, *, confirmed: bool = False) -> None:
        """Destroy one account and everything it owns.

        `confirmed` is keyword-only and defaults to refusing, so removal
        cannot be reached by a caller that meant to sign out: the difference
        between the two is a learner's entire graph, and it should not hinge
        on the order of two positional arguments.
        """

        if not confirmed:
            raise ValidationError(f"Confirmation is required: this {_REMOVAL_CONSEQUENCE}.")

        with session_scope() as session:
            if profile_repo.get_by_id(session, profile_id) is None:
                raise NotFoundError(f"Unknown profile: {profile_id}")
            workspace_ids = session.exec(
                select(WorkspaceRecord.id).where(WorkspaceRecord.profile_id == profile_id)
            ).all()
            for workspace_id in workspace_ids:
                _purge_workspace(session, workspace_id)
            profile_repo.delete(session, profile_id)

        # After the rows are gone, and only for the account just removed. The
        # session is cleared here rather than first because a removal that
        # failed mid-transaction would otherwise sign the learner out of an
        # account that still exists, and never for a different account, whose
        # session removing this one has no business ending.
        if self._store.get(ACTIVE_PROFILE_KEY) == profile_id:
            self._store.delete(ACTIVE_PROFILE_KEY)

    # --- Internals --------------------------------------------------------

    def _store_identity(self, identity: Identity) -> ProfileRecord:
        """Insert the account, or refresh the display fields of the existing one."""

        with session_scope() as session:
            profile = profile_repo.get_by_identity(
                session, identity.provider, identity.subject
            )
            if profile is None:
                return profile_repo.create(
                    session,
                    provider=identity.provider,
                    subject=identity.subject,
                    email=identity.email,
                    display_name=identity.display_name,
                    avatar_url=identity.avatar_url,
                )

            # Overwritten rather than merged: the provider is authoritative on
            # what it reports, and these fields identify nobody. A learner who
            # renamed themselves upstream must come back to the same graph, so
            # a difference here is an update and never a second account.
            profile.email = identity.email
            profile.display_name = identity.display_name
            profile.avatar_url = identity.avatar_url
            session.add(profile)
            return profile
