"""A session's life: created, titled, active, renamed, archived, restored."""

from __future__ import annotations

from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import WorkspaceNodeRecord
from repository import agent_repo
from service import workspace
from service.agent.sessions import TurnService
from service.workspace import derive_title
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.agent_doubles import FakeAgent


@pytest.fixture
def ws(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    return workspace.ensure_default_workspace(profile.id).id


def _new(ws: str, title: str | None = None, mode: str = "Explore") -> dict:
    graph = workspace.create_root_node(ws, title, mode)["graph"]
    node = graph["nodes"][-1]
    thread = next(t for t in graph["threads"] if t["nodeId"] == node["id"])
    return {**node, "threadId": thread["id"]}


def _node(ws: str, node_id: str) -> dict | None:
    return next((n for n in workspace.bootstrap(ws)["graph"]["nodes"] if n["id"] == node_id), None)


def _age(node_id: str, days: int) -> None:
    with session_scope() as session:
        node = session.get(WorkspaceNodeRecord, node_id)
        node.last_activity_at = datetime.now(UTC) - timedelta(days=days)


# --- Titles ----------------------------------------------------------------


def test_a_quick_session_is_provisional_until_its_first_message(ws):
    session = _new(ws)

    assert (session["title"], session["titleSource"]) == ("New session", "provisional")

    workspace.append_message(ws, session["threadId"], "learner", "  How do   monads compose?  ")
    titled = _node(ws, session["id"])
    assert (titled["title"], titled["titleSource"]) == ("How do monads compose?", "auto")


def test_only_the_first_message_titles_a_session(ws):
    session = _new(ws)
    workspace.append_message(ws, session["threadId"], "learner", "First question")
    workspace.append_message(ws, session["threadId"], "learner", "Second question")

    assert _node(ws, session["id"])["title"] == "First question"


def test_derived_titles_are_cut_at_a_word_boundary():
    long = "Explain the difference between applicative functors and monads in plain words please"
    title = derive_title(long)

    assert len(title) <= 60 and long.startswith(title.rstrip("…"))
    assert not title.rstrip("…").endswith(" ")
    assert derive_title("x" * 80) == "x" * 59 + "…"


def test_topic_and_learner_titles_are_never_replaced(ws):
    topical = _new(ws, "Category theory", "Deepen")
    workspace.append_message(ws, topical["threadId"], "learner", "Where do I start?")
    renamed = _new(ws)
    workspace.rename_node(ws, renamed["id"], "My own name")
    workspace.append_message(ws, renamed["threadId"], "learner", "Where do I start?")

    assert (_node(ws, topical["id"])["title"], topical["mode"]) == ("Category theory", "Deepen")
    assert _node(ws, topical["id"])["titleSource"] == "topic"
    assert (_node(ws, renamed["id"])["title"], _node(ws, renamed["id"])["titleSource"]) == (
        "My own name",
        "learner",
    )


def test_an_empty_rename_is_refused(ws):
    session = _new(ws, "Kept")
    with pytest.raises(ValidationError):
        workspace.rename_node(ws, session["id"], "   ")
    assert _node(ws, session["id"])["title"] == "Kept"


# --- Activity --------------------------------------------------------------


def test_opening_a_session_moves_its_activity(ws):
    older = _new(ws, "Older")
    _age(older["id"], 3)
    before = _node(ws, older["id"])["lastActivityAt"]

    workspace.update_context(ws, older["id"], {})

    assert _node(ws, older["id"])["lastActivityAt"] > before


def test_recording_a_message_moves_its_activity(ws):
    older = _new(ws, "Older")
    _age(older["id"], 3)
    before = _node(ws, older["id"])["lastActivityAt"]

    workspace.append_message(ws, older["threadId"], "learner", "Back to this")

    assert _node(ws, older["id"])["lastActivityAt"] > before


async def test_a_streamed_turn_moves_activity_and_titles_the_session(ws, tmp_path):
    with session_scope() as session:
        profile_id = session.get(__import__("models.workspace", fromlist=["WorkspaceRecord"]).WorkspaceRecord, ws).profile_id
        agent_id = agent_repo.create(
            session, profile_id=profile_id, name="Codex", command="x", args=[], env={}
        ).id
    session_node = _new(ws)
    _age(session_node["id"], 5)
    before = _node(ws, session_node["id"])["lastActivityAt"]

    async def provide(profile, registration):
        return FakeAgent()

    service = TurnService(tmp_path, provide)
    [_ async for _ in service.run_turn(profile_id, ws, session_node["threadId"], "What is a fold?")]

    after = _node(ws, session_node["id"])
    assert after["lastActivityAt"] > before
    assert (after["title"], after["titleSource"]) == ("What is a fold?", "auto")
    assert agent_id


# --- Archive ---------------------------------------------------------------


def test_archiving_hides_a_session_and_its_links_but_keeps_its_children(ws):
    parent = _new(ws, "Parent")
    workspace.append_message(ws, parent["threadId"], "learner", "Kept message")
    child_graph = workspace.create_child_node(ws, parent["id"])["graph"]
    child = child_graph["nodes"][-1]

    graph = workspace.archive_node(ws, parent["id"])["graph"]

    assert parent["id"] not in {n["id"] for n in graph["nodes"]}
    assert child["id"] in {n["id"] for n in graph["nodes"]}
    assert all(parent["id"] not in (l["parentId"], l["childId"]) for l in graph["links"])
    assert parent["threadId"] not in {t["id"] for t in graph["threads"]}


def test_restoring_brings_back_the_session_intact(ws):
    parent = _new(ws, "Parent")
    workspace.append_message(ws, parent["threadId"], "learner", "Kept message")
    workspace.create_child_node(ws, parent["id"])
    workspace.archive_node(ws, parent["id"])

    graph = workspace.restore_node(ws, parent["id"])["graph"]

    assert parent["id"] in {n["id"] for n in graph["nodes"]}
    assert len(graph["links"]) == 1
    assert [m["content"] for m in graph["messages"] if m["threadId"] == parent["threadId"]] == [
        "Kept message"
    ]


def test_archive_and_rename_do_not_reach_another_workspace(ws):
    other_profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="grace", display_name="Grace")
    )
    other_ws = workspace.ensure_default_workspace(other_profile.id).id
    theirs = _new(other_ws, "Theirs")

    for act in (
        lambda: workspace.archive_node(ws, theirs["id"]),
        lambda: workspace.restore_node(ws, theirs["id"]),
        lambda: workspace.rename_node(ws, theirs["id"], "Mine now"),
    ):
        with pytest.raises(NotFoundError):
            act()
    assert _node(other_ws, theirs["id"])["title"] == "Theirs"
