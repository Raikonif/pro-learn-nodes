"""Searching what was said, on the device, within the account."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import WorkspaceRecord
from repository import agent_repo
from service import workspace
from service.agent.contract import TextChunk
from service.agent.sessions import TurnService
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.agent_doubles import FakeAgent


def _account(subject: str) -> tuple[str, str]:
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject=subject, display_name=subject)
    )
    return profile.id, workspace.ensure_default_workspace(profile.id).id


@pytest.fixture
def ws(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    return _account("ada")[1]


def _session(ws: str, title: str, *said: str) -> tuple[str, str]:
    graph = workspace.create_root_node(ws, title)["graph"]
    node = graph["nodes"][-1]["id"]
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
    for text in said:
        workspace.append_message(ws, thread, "learner", text)
    return node, thread


def test_a_phrase_said_only_in_a_message_finds_its_session(ws):
    node, thread = _session(ws, "Haskell", "Laziness means thunks are evaluated on demand")
    _session(ws, "Rust", "Ownership and borrowing")

    [result] = workspace.search_sessions(ws, "thunks demand")["results"]

    assert (result["nodeId"], result["threadId"]) == (node, thread)
    assert result["messageId"] is not None
    assert "thunks" in result["snippet"]
    assert result["archived"] is False
    bootstrap_node = next(n for n in workspace.bootstrap(ws)["graph"]["nodes"] if n["id"] == node)
    assert result["lastActivityAt"] == bootstrap_node["lastActivityAt"], "same format as bootstrap"


def test_a_title_match_has_no_message(ws):
    node, _ = _session(ws, "Category theory basics")

    [result] = workspace.search_sessions(ws, "category")["results"]

    assert (result["nodeId"], result["messageId"], result["snippet"]) == (node, None, None)


def test_a_session_is_listed_once_even_with_many_matches(ws):
    _session(ws, "Folds", "a fold reduces", "another fold example", "fold again")

    results = workspace.search_sessions(ws, "fold")["results"]

    assert len(results) == 1


async def test_a_streamed_reply_is_findable_after_its_turn(ws, tmp_path):
    with session_scope() as session:
        profile_id = session.get(WorkspaceRecord, ws).profile_id
        agent_repo.create(session, profile_id=profile_id, name="A", command="x", args=[], env={})
    node, thread = _session(ws, "Streams")
    agent = FakeAgent(script=lambda s, t: [TextChunk("Catamorphisms "), TextChunk("generalise folds")])

    async def provide(profile, registration):
        return agent

    [_ async for _ in TurnService(tmp_path, provide).run_turn(profile_id, ws, thread, "explain")]

    [result] = workspace.search_sessions(ws, "catamorphisms generalise")["results"]
    assert result["nodeId"] == node


def test_archived_sessions_are_found_only_when_asked_for(ws):
    node, _ = _session(ws, "Retired", "an old zygohistomorphic idea")
    workspace.archive_node(ws, node)

    assert workspace.search_sessions(ws, "zygohistomorphic")["results"] == []
    [result] = workspace.search_sessions(ws, "zygohistomorphic", include_archived=True)["results"]
    assert (result["nodeId"], result["archived"]) == (node, True)


def test_another_accounts_content_is_never_returned(ws):
    _, other_ws = _account("grace")
    _session(other_ws, "Grace's", "a private paramorphism note")

    assert workspace.search_sessions(ws, "paramorphism")["results"] == []
    assert workspace.search_sessions(ws, "paramorphism", include_archived=True)["results"] == []


@pytest.mark.parametrize("query", ["", "   ", "!!!", '"', "AND OR NOT", "*"])
def test_empty_or_operator_only_queries_return_nothing_without_error(ws, query):
    _session(ws, "Anything", "some text AND more")

    assert workspace.search_sessions(ws, query)["results"] == []
