"""Practice rules: what may be authored, how answers are recorded, what a branch gets."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlmodel import select

from core.database import configure_database, database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.practice import PracticeAttemptRecord, PracticeItemRecord
from models.workspace import ChatThreadRecord, NodeLinkRecord, WorkspaceNodeRecord
from service import practice_service as practice
from service import workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService

MC = [{"text": "foldr", "correct": True}, {"text": "map", "correct": False}]


def _account(subject: str) -> str:
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject=subject, display_name=subject)
    )
    return workspace.ensure_default_workspace(profile.id).id


@pytest.fixture
def ws(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    return _account("ada")


def _node(ws: str, title: str = "Folds") -> str:
    return workspace.create_root_node(ws, title)["graph"]["nodes"][-1]["id"]


def _count(model) -> int:
    with session_scope() as session:
        return len(session.exec(select(model)).all())


# --- 2. Authoring ---------------------------------------------------------------


def test_free_response_needs_only_a_prompt(ws):
    node = _node(ws)
    item = practice.author_item(ws, node, {"kind": "free_response", "prompt": "What is a fold?"})

    assert (item["kind"], item["prompt"], item["referenceAnswer"], item["options"]) == (
        "free_response", "What is a fold?", None, []
    )
    with_reference = practice.author_item(
        ws, node, {"kind": "free_response", "prompt": "Why?", "referenceAnswer": "Because"}
    )
    assert with_reference["referenceAnswer"] == "Because"


@pytest.mark.parametrize("prompt", ["", "   ", "\n\t"])
def test_an_empty_prompt_is_refused_with_the_reason(ws, prompt):
    node = _node(ws)
    with pytest.raises(ValidationError, match="prompt"):
        practice.author_item(ws, node, {"kind": "free_response", "prompt": prompt})
    assert _count(PracticeItemRecord) == 0


def test_multiple_choice_with_one_correct_option_is_created(ws):
    item = practice.author_item(ws, _node(ws), {"kind": "multiple_choice", "prompt": "Which reduces?", "options": MC})
    assert item["options"] == MC


@pytest.mark.parametrize(
    ("options", "reason"),
    [
        ([{"text": "only", "correct": True}], "two options"),
        ([{"text": "a", "correct": False}, {"text": "b", "correct": False}], "exactly one"),
        ([{"text": "a", "correct": True}, {"text": "b", "correct": True}], "exactly one"),
        ([{"text": " ", "correct": True}, {"text": "b", "correct": False}], "empty"),
    ],
)
def test_malformed_multiple_choice_is_refused_with_the_reason(ws, options, reason):
    node = _node(ws)
    with pytest.raises(ValidationError, match=reason):
        practice.author_item(ws, node, {"kind": "multiple_choice", "prompt": "Q?", "options": options})
    assert _count(PracticeItemRecord) == 0


def test_authoring_on_another_accounts_node_is_not_found(ws):
    theirs = _node(_account("grace"), "Theirs")
    with pytest.raises(NotFoundError):
        practice.author_item(ws, theirs, {"kind": "free_response", "prompt": "Mine?"})
    assert _count(PracticeItemRecord) == 0


# --- 3. Attempts ------------------------------------------------------------------


def test_a_free_response_attempt_records_text_and_no_score(ws):
    node = _node(ws)
    item = practice.author_item(ws, node, {"kind": "free_response", "prompt": "What is a fold?"})

    attempt = practice.record_attempt(ws, item["id"], {"response": "It reduces"})

    assert (attempt["itemId"], attempt["nodeId"], attempt["response"]) == (item["id"], node, "It reduces")
    assert (attempt["correct"], attempt["score"], attempt["chosenOption"]) == (None, None, None)
    assert attempt["createdAt"]


def test_a_multiple_choice_attempt_records_whether_it_matched(ws):
    item = practice.author_item(ws, _node(ws), {"kind": "multiple_choice", "prompt": "Q?", "options": MC})

    right = practice.record_attempt(ws, item["id"], {"chosenOption": 0})
    wrong = practice.record_attempt(ws, item["id"], {"chosenOption": 1})

    assert (right["chosenOption"], right["correct"]) == (0, True)
    assert (wrong["chosenOption"], wrong["correct"]) == (1, False)


@pytest.mark.parametrize(
    ("kind", "answer"),
    [("free_response", {"chosenOption": 0}), ("free_response", {"response": "  "}),
     ("multiple_choice", {"response": "foldr"}), ("multiple_choice", {"chosenOption": 7})],
)
def test_an_answer_of_the_wrong_shape_is_refused(ws, kind, answer):
    fields = {"kind": kind, "prompt": "Q?", **({"options": MC} if kind == "multiple_choice" else {})}
    item = practice.author_item(ws, _node(ws), fields)
    with pytest.raises(ValidationError):
        practice.record_attempt(ws, item["id"], answer)
    assert _count(PracticeAttemptRecord) == 0


def test_answering_again_adds_and_edits_nothing(ws):
    item = practice.author_item(ws, _node(ws), {"kind": "free_response", "prompt": "Q?"})
    first = practice.record_attempt(ws, item["id"], {"response": "first"})

    practice.record_attempt(ws, item["id"], {"response": "second"})

    material = practice.node_practice(ws, item["nodeId"])
    assert [a["response"] for a in material["attempts"]] == ["second", "first"]
    assert material["attempts"][1] == first
    assert not any(name.startswith(("update", "edit", "delete")) for name in dir(practice)), (
        "no path exists to edit or remove a stored attempt"
    )


def test_a_nodes_practice_is_read_in_one_and_only_its_own(ws):
    node, other = _node(ws, "Mine"), _node(ws, "Other")
    item = practice.author_item(ws, node, {"kind": "free_response", "prompt": "Q?"})
    practice.record_attempt(ws, item["id"], {"response": "A"})
    practice.save_sandbox(ws, node, "print('mine')")
    practice.author_item(ws, other, {"kind": "free_response", "prompt": "Other Q?"})

    material = practice.node_practice(ws, node)

    assert material["nodeId"] == node
    assert [i["prompt"] for i in material["items"]] == ["Q?"]
    assert [a["response"] for a in material["attempts"]] == ["A"]
    assert material["sandbox"]["code"] == "print('mine')"


# --- 4. Sandbox and branching -------------------------------------------------------


def test_the_sandbox_replaces_and_starts_empty(ws):
    node = _node(ws)
    assert practice.node_practice(ws, node)["sandbox"] == {"code": "", "updatedAt": None}

    practice.save_sandbox(ws, node, "print(1)")
    saved = practice.save_sandbox(ws, node, "print(2)")

    assert saved["code"] == "print(2)" and saved["updatedAt"]
    assert practice.node_practice(ws, node)["sandbox"]["code"] == "print(2)"


def test_a_branch_inherits_no_practice_and_leaves_the_source_alone(ws):
    source = _node(ws, "Source")
    thread = workspace.bootstrap(ws)["graph"]["threads"][-1]["id"]
    message = workspace.append_message(ws, thread, "learner", "A passage to branch from")["graph"]["messages"][-1]
    item = practice.author_item(ws, source, {"kind": "free_response", "prompt": "Q?"})
    practice.record_attempt(ws, item["id"], {"response": "A"})
    practice.save_sandbox(ws, source, "print('source')")
    before = practice.node_practice(ws, source)

    child = workspace.create_branch_node(
        ws, source, {"messageId": message["id"], "start": 0, "end": 9, "excerpt": "A passage"}
    )["graph"]["nodes"][-1]["id"]

    assert practice.node_practice(ws, child) == {
        "nodeId": child, "items": [], "attempts": [], "sandbox": {"code": "", "updatedAt": None}
    }
    assert practice.node_practice(ws, source) == before


def test_practice_creates_no_node_link_or_thread(ws):
    node = _node(ws)
    counts = (_count(WorkspaceNodeRecord), _count(NodeLinkRecord), _count(ChatThreadRecord))

    item = practice.author_item(ws, node, {"kind": "free_response", "prompt": "Q?"})
    practice.record_attempt(ws, item["id"], {"response": "A"})

    assert (_count(WorkspaceNodeRecord), _count(NodeLinkRecord), _count(ChatThreadRecord)) == counts
