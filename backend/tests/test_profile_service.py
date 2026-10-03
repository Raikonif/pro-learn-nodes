"""Enrollment, activation, sign-out, and removal of local accounts.

Four claims carry the weight here. Enrollment is idempotent even when a
concurrent sign-in wins the race, because the unique index — not a
read-then-write — is what decides identity. Activation survives a restart,
which is asserted by rebuilding the service over the same store and database
rather than by trusting in-process state. Signing back in reaches no identity
provider at all, which is nailed shut while the test runs instead of merely
inferred from the outcome. And removal destroys one account's rows and only
that account's, including the FTS projection that `service/retrieval.py`
searches — a row left behind there would keep a deleted learner's passages
findable.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlmodel import select

from repository import project_repo
from core.database import configure_database, database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
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
from service import identity as identity_registry
from service.identity.dev import DevelopmentIdentityProvider
from service.identity.protocol import Identity
from service.profile_service import ACTIVE_PROFILE_KEY, ProfileService

LEARNER = Identity(
    provider="dev",
    subject="subject-1",
    display_name="Ada",
    email="ada@example.com",
)
OTHER_LEARNER = Identity(provider="dev", subject="subject-2", display_name="Grace")


@pytest.fixture
def migrated_database(tmp_path: Path) -> Path:
    """Point the process-wide engine at an empty, fully migrated database.

    The engine is global state the whole session shares, so each test
    re-points it at its own `tmp_path`; skipping this would let one test's
    profiles and workspaces leak into another's counts.
    """

    configure_database(tmp_path)
    migrate_database(database_path())
    return tmp_path


@pytest.fixture
def store() -> InMemorySecretStore:
    """The session pointer's storage, isolated per test.

    Never `get_secret_store()`: on a developer's macOS machine that is the
    real login keychain, and a suite that wrote to it would leave residue
    behind and would collide with the developer's own signed-in account.
    """

    return InMemorySecretStore()


@pytest.fixture
def service(migrated_database: Path, store: InMemorySecretStore) -> ProfileService:
    return ProfileService(store)


# Every table an account's data lives in, paired with the column that ties a
# row to one workspace. Removal is asserted against the whole list rather than
# a sample, so a table added later without a matching delete fails here.
_SCOPED_TABLES = (
    WorkspaceContextRecord,
    WorkspaceNodeRecord,
    NodeLinkRecord,
    ChatThreadRecord,
    ChatMessageRecord,
    SelectionAnchorRecord,
    SourceRecord,
    SourceChunkRecord,
)


def _workspace_id_of(profile_id: str) -> str:
    with session_scope() as session:
        return session.exec(
            select(WorkspaceRecord.id).where(WorkspaceRecord.profile_id == profile_id)
        ).one()


def _row_counts(workspace_id: str) -> dict[str, int]:
    """How many rows each scoped table holds for one workspace, plus the FTS rows."""

    counts: dict[str, int] = {}
    with session_scope() as session:
        counts["workspaces"] = len(
            session.exec(select(WorkspaceRecord).where(WorkspaceRecord.id == workspace_id)).all()
        )
        for model in _SCOPED_TABLES:
            rows = session.exec(select(model).where(model.workspace_id == workspace_id)).all()
            counts[model.__tablename__] = len(rows)
        counts["source_chunk_fts"] = session.execute(
            text("SELECT COUNT(*) FROM source_chunk_fts WHERE workspace_id = :workspace_id"),
            {"workspace_id": workspace_id},
        ).scalar_one()
    return counts


def _populate(workspace_id: str) -> None:
    """Fill a workspace with one row in every table an account owns.

    Deliberately includes a thread anchored to a message and a link anchored
    to the same message: `chat_messages → chat_threads → selection_anchors →
    chat_messages` is a foreign-key cycle, and removal that ignored it would
    pass against a workspace holding only nodes.
    """

    with session_scope() as session:
        parent = WorkspaceNodeRecord(workspace_id=workspace_id,
            project_id=project_repo.default_for(session, workspace_id).id, title="Root", mode="Explore")
        child = WorkspaceNodeRecord(workspace_id=workspace_id,
            project_id=project_repo.default_for(session, workspace_id).id, title="Branch", mode="Explore")
        session.add(parent)
        session.add(child)
        session.flush()
        main = ChatThreadRecord(workspace_id=workspace_id, node_id=parent.id, name="main")
        child_main = ChatThreadRecord(workspace_id=workspace_id, node_id=child.id, name="main")
        session.add(main)
        session.add(child_main)
        session.flush()
        message = ChatMessageRecord(
            workspace_id=workspace_id,
            thread_id=main.id,
            role="learner",
            content="hello there",
        )
        session.add(message)
        session.flush()
        anchor = SelectionAnchorRecord(
            workspace_id=workspace_id,
            source_message_id=message.id,
            start_offset=0,
            end_offset=5,
            excerpt="hello",
        )
        session.add(anchor)
        session.flush()
        session.add(
            ChatThreadRecord(
                workspace_id=workspace_id,
                node_id=parent.id,
                name="aside",
                anchor_id=anchor.id,
            )
        )
        session.add(
            NodeLinkRecord(
                workspace_id=workspace_id,
                parent_id=parent.id,
                child_id=child.id,
                anchor_id=anchor.id,
            )
        )
        source = SourceRecord(workspace_id=workspace_id, title="Notes", content="a passage")
        session.add(source)
        session.flush()
        chunk = SourceChunkRecord(
            workspace_id=workspace_id,
            source_id=source.id,
            ordinal=0,
            start_offset=0,
            end_offset=9,
            content="a passage",
        )
        session.add(chunk)
        session.flush()
        session.execute(
            text(
                "INSERT INTO source_chunk_fts (chunk_id, workspace_id, source_id, content) "
                "VALUES (:chunk_id, :workspace_id, :source_id, :content)"
            ),
            {
                "chunk_id": chunk.id,
                "workspace_id": workspace_id,
                "source_id": source.id,
                "content": chunk.content,
            },
        )


def _all_profile_ids() -> set[str]:
    with session_scope() as session:
        return {profile.id for profile in profile_repo.list_all(session)}


# --- Enrollment -----------------------------------------------------------


def test_enrolling_a_new_identity_creates_a_profile(service: ProfileService):
    profile = service.enroll(LEARNER)

    assert (profile.provider, profile.subject) == ("dev", "subject-1")
    assert profile.display_name == "Ada"
    assert profile.email == "ada@example.com"
    assert _all_profile_ids() == {profile.id}


def test_enrolling_the_same_identity_twice_returns_the_existing_profile(service: ProfileService):
    first = service.enroll(LEARNER)
    second = service.enroll(LEARNER)

    assert second.id == first.id
    assert _all_profile_ids() == {first.id}


def test_changed_display_information_updates_the_existing_profile(service: ProfileService):
    """Email and display name are display fields, never identity.

    A learner who changes their name upstream must come back to the same
    graph, not to a second empty account.
    """

    first = service.enroll(LEARNER)
    renamed = service.enroll(
        Identity(
            provider="dev",
            subject="subject-1",
            display_name="Ada Lovelace",
            email="ada.lovelace@example.com",
            avatar_url="https://example.com/ada.png",
        )
    )

    assert renamed.id == first.id
    assert renamed.display_name == "Ada Lovelace"
    assert renamed.email == "ada.lovelace@example.com"
    assert renamed.avatar_url == "https://example.com/ada.png"
    assert _all_profile_ids() == {first.id}


def test_the_same_subject_from_a_different_provider_is_a_distinct_profile(service: ProfileService):
    dev_profile = service.enroll(Identity(provider="dev", subject="shared"))
    google_profile = service.enroll(Identity(provider="google", subject="shared"))

    assert google_profile.id != dev_profile.id
    assert _all_profile_ids() == {dev_profile.id, google_profile.id}


def test_a_lost_race_to_enroll_resolves_to_the_existing_profile(
    service: ProfileService, monkeypatch: pytest.MonkeyPatch
):
    """Two sign-ins racing on a new account must not enroll it twice.

    The lookup is made to report absence once, which is exactly what the
    losing sign-in sees when it reads before the winner commits. Only the
    unique index can catch that, so this is the test that proves enrollment
    recovers from the `IntegrityError` rather than surfacing it.
    """

    existing = service.enroll(LEARNER)
    real_lookup = profile_repo.get_by_identity
    calls: list[int] = []

    def lookup_missing_once(*args: Any, **kwargs: Any):
        calls.append(1)
        if len(calls) == 1:
            return None
        return real_lookup(*args, **kwargs)

    monkeypatch.setattr(profile_repo, "get_by_identity", lookup_missing_once)

    recovered = service.enroll(LEARNER)

    assert recovered.id == existing.id
    assert _all_profile_ids() == {existing.id}


# --- Activation -----------------------------------------------------------


def test_enrolling_activates_the_profile(service: ProfileService, store: InMemorySecretStore):
    profile = service.enroll(LEARNER)

    assert store.get(ACTIVE_PROFILE_KEY) == profile.id
    assert service.active_profile().id == profile.id


def test_activating_replaces_the_previously_active_profile(service: ProfileService):
    first = service.enroll(LEARNER)
    second = service.enroll(OTHER_LEARNER)

    assert service.active_profile().id == second.id

    service.activate(first.id)

    assert service.active_profile().id == first.id


def test_the_active_profile_survives_a_restart(
    migrated_database: Path, store: InMemorySecretStore
):
    """A restart is a fresh service over the same store and database.

    Keeping the pointer in memory would pass a test that only called the same
    instance twice, which is the bug this is written to catch.
    """

    profile = ProfileService(store).enroll(LEARNER)

    after_restart = ProfileService(store).active_profile()

    assert after_restart is not None
    assert after_restart.id == profile.id


def test_no_stored_pointer_reads_as_signed_out(service: ProfileService):
    assert service.active_profile() is None


def test_a_pointer_to_a_missing_profile_reads_as_signed_out(
    service: ProfileService, store: InMemorySecretStore
):
    """A database restored from a backup can be missing the account it names.

    Raising there would make the app unbootable for a learner whose only
    recovery is the very sign-in surface the failure hides, so the stale
    pointer is treated as signed out and cleared on the way past.
    """

    store.set(ACTIVE_PROFILE_KEY, "profile-that-was-deleted")

    assert service.active_profile() is None
    assert store.get(ACTIVE_PROFILE_KEY) is None


def test_activating_an_unknown_profile_is_refused(
    service: ProfileService, store: InMemorySecretStore
):
    active = service.enroll(LEARNER)

    with pytest.raises(NotFoundError):
        service.activate("never-enrolled")

    assert store.get(ACTIVE_PROFILE_KEY) == active.id


# --- Sign-out -------------------------------------------------------------


def test_signing_out_clears_the_session(service: ProfileService, store: InMemorySecretStore):
    service.enroll(LEARNER)

    service.sign_out()

    assert store.get(ACTIVE_PROFILE_KEY) is None
    assert service.active_profile() is None


def test_signing_out_preserves_the_enrollment_and_its_data(service: ProfileService):
    profile = service.enroll(LEARNER)
    workspace_id = _workspace_id_of(profile.id)
    _populate(workspace_id)
    before = _row_counts(workspace_id)

    service.sign_out()

    assert _all_profile_ids() == {profile.id}
    assert _row_counts(workspace_id) == before


def test_signing_out_while_signed_out_is_not_an_error(service: ProfileService):
    """A half-finished sign-in must still leave the learner able to sign out."""

    service.sign_out()
    service.sign_out()

    assert service.active_profile() is None


def test_signing_back_in_reaches_no_identity_provider(
    service: ProfileService, monkeypatch: pytest.MonkeyPatch
):
    """Returning to an enrolled account must work with no network at all.

    Asserted structurally: every route to a provider is made to raise while
    the test runs, so a service that consulted one fails here instead of
    passing on an outcome that happened to look right.
    """

    profile = service.enroll(LEARNER)
    service.sign_out()

    def forbidden(*_args: Any, **_kwargs: Any):
        raise AssertionError("Re-activating an enrolled account contacted a provider")

    monkeypatch.setattr(identity_registry, "available_providers", forbidden)
    monkeypatch.setattr(DevelopmentIdentityProvider, "authenticate", forbidden)

    service.activate(profile.id)

    assert service.active_profile().id == profile.id


def test_the_graph_is_unchanged_after_signing_out_and_back_in(service: ProfileService):
    profile = service.enroll(LEARNER)
    workspace_id = _workspace_id_of(profile.id)
    _populate(workspace_id)
    before = _row_counts(workspace_id)

    service.sign_out()
    service.activate(profile.id)

    assert _workspace_id_of(profile.id) == workspace_id
    assert _row_counts(workspace_id) == before


# --- Removal --------------------------------------------------------------


def test_removal_without_confirmation_is_refused(service: ProfileService):
    """The confirmation flag is the whole difference between sign-out and loss."""

    profile = service.enroll(LEARNER)
    workspace_id = _workspace_id_of(profile.id)
    _populate(workspace_id)
    before = _row_counts(workspace_id)

    with pytest.raises(ValidationError):
        service.delete_profile(profile.id)

    assert _all_profile_ids() == {profile.id}
    assert _row_counts(workspace_id) == before


def test_removal_destroys_the_named_profiles_data(service: ProfileService):
    profile = service.enroll(LEARNER)
    workspace_id = _workspace_id_of(profile.id)
    _populate(workspace_id)
    assert all(count > 0 for count in _row_counts(workspace_id).values())

    service.delete_profile(profile.id, confirmed=True)

    assert _all_profile_ids() == set()
    assert set(_row_counts(workspace_id).values()) == {0}


def test_removal_leaves_every_other_profiles_data_untouched(service: ProfileService):
    doomed = service.enroll(LEARNER)
    doomed_workspace = _workspace_id_of(doomed.id)
    _populate(doomed_workspace)
    kept = service.enroll(OTHER_LEARNER)
    kept_workspace = _workspace_id_of(kept.id)
    _populate(kept_workspace)
    before = _row_counts(kept_workspace)

    service.delete_profile(doomed.id, confirmed=True)

    assert _all_profile_ids() == {kept.id}
    assert _row_counts(kept_workspace) == before
    assert set(_row_counts(doomed_workspace).values()) == {0}


def test_removing_the_active_profile_clears_the_session(
    service: ProfileService, store: InMemorySecretStore
):
    profile = service.enroll(LEARNER)

    service.delete_profile(profile.id, confirmed=True)

    assert store.get(ACTIVE_PROFILE_KEY) is None
    assert service.active_profile() is None


def test_removing_another_profile_leaves_the_session_alone(
    service: ProfileService, store: InMemorySecretStore
):
    doomed = service.enroll(OTHER_LEARNER)
    active = service.enroll(LEARNER)

    service.delete_profile(doomed.id, confirmed=True)

    assert store.get(ACTIVE_PROFILE_KEY) == active.id
    assert service.active_profile().id == active.id


def test_removing_an_unknown_profile_is_refused(service: ProfileService):
    with pytest.raises(NotFoundError):
        service.delete_profile("never-enrolled", confirmed=True)


# --- Per-profile workspace provisioning -----------------------------------


def test_first_activation_provisions_an_empty_workspace_and_default_context(
    service: ProfileService,
):
    profile = service.enroll(LEARNER)

    workspace_id = _workspace_id_of(profile.id)
    counts = _row_counts(workspace_id)

    assert counts["workspaces"] == 1
    assert counts["workspace_contexts"] == 1
    assert counts["workspace_nodes"] == 0
    assert counts["chat_threads"] == 0


def test_a_second_profile_starts_empty_beside_a_populated_one(service: ProfileService):
    """Provisioning one account's data must not read or alter another's."""

    first = service.enroll(LEARNER)
    first_workspace = _workspace_id_of(first.id)
    _populate(first_workspace)
    before = _row_counts(first_workspace)

    second = service.enroll(OTHER_LEARNER)
    second_workspace = _workspace_id_of(second.id)

    assert second_workspace != first_workspace
    assert _row_counts(second_workspace)["workspace_nodes"] == 0
    assert _row_counts(second_workspace)["workspace_contexts"] == 1
    assert _row_counts(first_workspace) == before


def test_returning_to_a_profile_provisions_nothing_further(service: ProfileService):
    profile = service.enroll(LEARNER)
    workspace_id = _workspace_id_of(profile.id)

    service.sign_out()
    service.enroll(LEARNER)
    service.activate(profile.id)

    with session_scope() as session:
        workspaces = session.exec(
            select(WorkspaceRecord).where(WorkspaceRecord.profile_id == profile.id)
        ).all()

    assert [workspace.id for workspace in workspaces] == [workspace_id]
