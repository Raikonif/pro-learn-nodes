"""Practice records: items, append-only attempts, and one sandbox buffer per node."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.practice import PracticeAttemptRecord
from repository import practice_repo
from service import workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
def two_nodes(tmp_path: Path) -> tuple[str, str, str]:
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    ws = workspace.ensure_default_workspace(profile.id).id
    first = workspace.create_root_node(ws, "First")["graph"]["nodes"][-1]["id"]
    second = workspace.create_root_node(ws, "Second")["graph"]["nodes"][-1]["id"]
    return ws, first, second


def _item(ws: str, node: str, **fields) -> str:
    with session_scope() as session:
        return practice_repo.create_item(
            session,
            workspace_id=ws,
            node_id=node,
            kind=fields.get("kind", "free_response"),
            prompt=fields.get("prompt", "What is a fold?"),
            options=fields.get("options", []),
            reference_answer=fields.get("reference_answer"),
        ).id


# --- 1.1 Items ---------------------------------------------------------------


def test_a_free_response_item_reads_back_by_node(two_nodes):
    ws, first, _ = two_nodes
    item_id = _item(ws, first, reference_answer="A reduction over a structure")

    with session_scope() as session:
        [item] = practice_repo.items_for_node(session, ws, first)

    assert (item.id, item.kind, item.prompt, item.reference_answer) == (
        item_id,
        "free_response",
        "What is a fold?",
        "A reduction over a structure",
    )
    assert item.options == []


def test_a_multiple_choice_item_keeps_its_options_and_correct_one(two_nodes):
    ws, first, _ = two_nodes
    options = [{"text": "foldr", "correct": True}, {"text": "map", "correct": False}]
    _item(ws, first, kind="multiple_choice", prompt="Which reduces?", options=options)

    with session_scope() as session:
        [item] = practice_repo.items_for_node(session, ws, first)

    assert item.options == options


def test_items_stay_with_their_node(two_nodes):
    ws, first, second = two_nodes
    _item(ws, first)

    with session_scope() as session:
        assert practice_repo.items_for_node(session, ws, second) == []


# --- 1.3 Attempts --------------------------------------------------------------


def test_attempts_are_appended_and_never_rewritten(two_nodes):
    ws, first, _ = two_nodes
    item = _item(ws, first)
    with session_scope() as session:
        earlier = practice_repo.insert_attempt(
            session, workspace_id=ws, node_id=first, item_id=item, response="a guess",
            chosen_option=None, correct=None,
        )
        earlier_id = earlier.id
    # Read back as stored, so the comparison below is store-to-store: SQLite
    # keeps the instant but not the tzinfo the in-memory object carried.
    with session_scope() as session:
        stored = session.get(PracticeAttemptRecord, earlier_id)
        earlier_row = (stored.id, stored.response, stored.created_at)
    with session_scope() as session:
        practice_repo.insert_attempt(
            session, workspace_id=ws, node_id=first, item_id=item, response="a better answer",
            chosen_option=None, correct=None,
        )

    with session_scope() as session:
        attempts = practice_repo.attempts_for_node(session, ws, first)
        first_again = session.get(PracticeAttemptRecord, earlier_row[0])

    assert [a.response for a in attempts] == ["a better answer", "a guess"], "newest first"
    assert (first_again.id, first_again.response, first_again.created_at) == earlier_row
    assert attempts[0].created_at is not None


# --- 1.4 Sandbox buffer ----------------------------------------------------------


def test_a_node_without_code_reads_as_empty(two_nodes):
    ws, first, _ = two_nodes
    with session_scope() as session:
        assert practice_repo.sandbox_for_node(session, ws, first) is None


def test_writing_twice_replaces_and_keeps_one_row(two_nodes):
    ws, first, _ = two_nodes
    with session_scope() as session:
        practice_repo.upsert_sandbox(session, ws, first, "print(1)")
    with session_scope() as session:
        practice_repo.upsert_sandbox(session, ws, first, "print(2)")

    with session_scope() as session:
        buffer = practice_repo.sandbox_for_node(session, ws, first)
        rows = practice_repo.count_sandbox_rows(session, first)

    assert buffer.code == "print(2)"
    assert rows == 1
