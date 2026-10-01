from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from repository import profile_repo


@pytest.fixture
def migrated_database(tmp_path: Path) -> Path:
    """Point the process-wide engine at an empty, fully migrated database.

    The engine is global state that every test in the session shares, so each
    test re-points it at its own `tmp_path`; skipping this would let one
    test's profiles leak into another's `list_all`.
    """

    configure_database(tmp_path)
    migrate_database(database_path())
    return tmp_path


def test_a_profile_is_read_back_by_its_identity(migrated_database: Path):
    with session_scope() as session:
        created = profile_repo.create(
            session,
            provider="dev",
            subject="subject-1",
            email="learner@example.com",
            display_name="Learner",
        )
        created_id = created.id

    with session_scope() as session:
        found = profile_repo.get_by_identity(session, "dev", "subject-1")

    assert found is not None
    assert found.id == created_id
    assert found.email == "learner@example.com"
    assert found.display_name == "Learner"
    assert found.avatar_url is None


def test_an_unknown_identity_reads_back_as_nothing(migrated_database: Path):
    with session_scope() as session:
        assert profile_repo.get_by_identity(session, "dev", "never-enrolled") is None
        assert profile_repo.get_by_id(session, "never-created") is None


def test_the_same_identity_cannot_enroll_twice(migrated_database: Path):
    with session_scope() as session:
        profile_repo.create(session, provider="dev", subject="subject-1")

    # The database is what refuses the duplicate. Enrollment is idempotent by
    # constraint rather than by a service-layer read-then-write, which a
    # concurrent second sign-in could interleave with.
    with pytest.raises(IntegrityError):
        with session_scope() as session:
            profile_repo.create(session, provider="dev", subject="subject-1")

    with session_scope() as session:
        assert len(profile_repo.list_all(session)) == 1


def test_the_same_subject_under_a_different_provider_is_a_distinct_profile(migrated_database: Path):
    with session_scope() as session:
        first = profile_repo.create(session, provider="dev", subject="shared-subject")
        second = profile_repo.create(session, provider="google", subject="shared-subject")
        first_id, second_id = first.id, second.id

    with session_scope() as session:
        assert profile_repo.get_by_identity(session, "dev", "shared-subject").id == first_id
        assert profile_repo.get_by_identity(session, "google", "shared-subject").id == second_id
        assert {profile.id for profile in profile_repo.list_all(session)} == {first_id, second_id}


def test_deleting_a_profile_leaves_every_other_profile_intact(migrated_database: Path):
    with session_scope() as session:
        doomed = profile_repo.create(session, provider="dev", subject="doomed")
        kept = profile_repo.create(session, provider="dev", subject="kept")
        doomed_id, kept_id = doomed.id, kept.id

    with session_scope() as session:
        assert profile_repo.delete(session, doomed_id) is True

    with session_scope() as session:
        assert profile_repo.get_by_id(session, doomed_id) is None
        assert profile_repo.get_by_id(session, kept_id) is not None
        # Deleting what is already gone is not an error: sign-out and removal
        # can race, and the caller only needs to know the row is absent.
        assert profile_repo.delete(session, doomed_id) is False
