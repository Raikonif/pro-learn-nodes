"""Where a conversation came from, cut exactly at the branch point."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import ChatMessageRecord, NodeLinkRecord, WorkspaceNodeRecord
from service import workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
def ws(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    return workspace.ensure_default_workspace(profile.id).id


def _say(ws: str, thread: str, *lines: str) -> list[str]:
    ids = []
    for line in lines:
        graph = workspace.append_message(ws, thread, "learner" if len(ids) % 2 == 0 else "agent", line)["graph"]
        ids.append(graph["messages"][-1]["id"])
    return ids


def _root(ws: str, title: str) -> tuple[str, str]:
    graph = workspace.create_root_node(ws, title)["graph"]
    node = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
    return node, next(t["id"] for t in graph["threads"] if t["nodeId"] == node and t["anchor"] is None)


def _main_thread(ws: str, node: str) -> str:
    return next(t["id"] for t in workspace.bootstrap(ws)["graph"]["threads"] if t["nodeId"] == node and t["anchor"] is None)


def _anchor(message_id: str, excerpt: str) -> dict:
    return {"messageId": message_id, "start": 0, "end": len(excerpt), "excerpt": excerpt}


def test_a_branch_inherits_up_to_and_including_the_passage_message(ws):
    parent, thread = _root(ws, "Folds")
    first, cut, _after = _say(ws, thread, "What is a fold?", "A fold reduces a structure.", "Later message")
    graph = workspace.create_branch_node(ws, parent, _anchor(cut, "reduces a structure"))["graph"]
    child = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]

    origin = workspace.conversation_origin(ws, _main_thread(ws, child))

    assert (origin.parent_title, origin.passage) == ("Folds", "reduces a structure")
    assert [m["content"] for m in origin.messages] == ["What is a fold?", "A fold reduces a structure."]
    assert origin.omitted is False


def test_a_whole_node_child_inherits_the_parent_as_it_stood(ws):
    parent, thread = _root(ws, "Folds")
    _say(ws, thread, "Before the child")
    child = workspace.create_child_node(ws, parent)["graph"]["nodes"][-1]["id"]
    with session_scope() as session:  # the parent continues after the child exists
        node = session.get(WorkspaceNodeRecord, child)
        session.add(ChatMessageRecord(workspace_id=ws, thread_id=thread, role="learner", content="After the child",
                                      created_at=node.created_at + timedelta(seconds=5)))

    origin = workspace.conversation_origin(ws, _main_thread(ws, child))

    assert origin.passage is None
    assert [m["content"] for m in origin.messages] == ["Before the child"]


def test_a_side_thread_inherits_its_main_thread_up_to_its_anchor(ws):
    node, thread = _root(ws, "Monads")
    _first, cut, _later = _say(ws, thread, "Explain bind.", "Bind sequences effects.", "Something later")
    graph = workspace.create_thread(ws, node, _anchor(cut, "sequences effects"), None)["graph"]
    side = next(t["id"] for t in graph["threads"] if t["anchor"] is not None)

    origin = workspace.conversation_origin(ws, side)

    assert (origin.parent_title, origin.passage, origin.side_thread) == ("Monads", "sequences effects", True)
    assert [m["content"] for m in origin.messages] == ["Explain bind.", "Bind sequences effects."]


def test_roots_have_no_origin(ws):
    _, thread = _root(ws, "Alone")
    _say(ws, thread, "hi")
    assert workspace.conversation_origin(ws, thread) is None


def test_the_first_link_is_the_origin_even_with_a_second_parent(ws):
    first_parent, first_thread = _root(ws, "First parent")
    _say(ws, first_thread, "from the first")
    second_parent, _ = _root(ws, "Second parent")
    child = workspace.create_child_node(ws, first_parent)["graph"]["nodes"][-1]["id"]
    with session_scope() as session:
        session.add(NodeLinkRecord(workspace_id=ws, parent_id=second_parent, child_id=child))

    origin = workspace.conversation_origin(ws, _main_thread(ws, child))

    assert origin.parent_title == "First parent"


def test_a_long_parent_keeps_the_newest_messages_and_the_cut(ws):
    parent, thread = _root(ws, "Long")
    ids = _say(ws, thread, *[f"message {i} " + "x" * 3_000 for i in range(20)])
    graph = workspace.create_branch_node(ws, parent, _anchor(ids[-1], "message 19"))["graph"]
    child = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]

    origin = workspace.conversation_origin(ws, _main_thread(ws, child))

    assert origin.omitted is True
    assert origin.messages[-1]["content"].startswith("message 19")
    assert sum(len(m["content"]) for m in origin.messages) <= workspace.ORIGIN_BUDGET
    assert origin.messages[0]["content"].startswith("message 1") and len(origin.messages) < 20


def test_a_single_huge_cut_message_is_kept_from_its_end(ws):
    parent, thread = _root(ws, "Huge")
    [cut] = _say(ws, thread, "start " + "y" * 40_000 + " the end")
    graph = workspace.create_branch_node(ws, parent, _anchor(cut, "the end"))["graph"]
    child = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]

    origin = workspace.conversation_origin(ws, _main_thread(ws, child))

    assert origin.omitted is True and len(origin.messages) == 1
    assert origin.messages[0]["content"].endswith("the end")
    assert len(origin.messages[0]["content"]) <= workspace.ORIGIN_BUDGET
