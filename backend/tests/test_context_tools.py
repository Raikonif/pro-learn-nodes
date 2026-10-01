"""The context server's tools, called over HTTP as an agent calls them."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import WorkspaceNodeRecord
from service import memory_service, practice_service, workspace
from service.context_server.app import ContextServer
from service.context_server.credentials import Scope
from service.context_server.tools import TOOL_NAMES
from service.identity.protocol import Identity
from service.profile_service import ProfileService


def _account(subject: str) -> tuple[str, str]:
    profile = ProfileService(InMemorySecretStore()).enroll(Identity(provider="dev", subject=subject, display_name=subject))
    return profile.id, workspace.ensure_default_workspace(profile.id).id


def _session(ws: str, title: str | None, *said: str) -> tuple[str, str]:
    graph = workspace.create_root_node(ws, title)["graph"]
    node = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
    for text in said:
        workspace.append_message(ws, thread, "learner", text)
    return node, thread


@pytest.fixture
async def world(tmp_path: Path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile, ws = _account("ada")
    node, thread = _session(ws, None)
    server = ContextServer()
    await server.start()
    token = server.credentials.mint(Scope(profile, ws, node, thread, "agent-1", "Codex"))

    async def call(tool: str, **arguments):
        async with httpx.AsyncClient() as client:
            response = await client.post(
                server.url,
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": arguments}},
                headers={"accept": "application/json, text/event-stream", "authorization": f"Bearer {token}"},
            )
        result = response.json()["result"]
        return result.get("structuredContent", {}).get("result", result.get("structuredContent"))

    yield {"call": call, "profile": profile, "ws": ws, "node": node, "thread": thread, "server": server}
    await server.stop()


# --- 4.3 The exact tool set --------------------------------------------------------


async def test_the_tool_set_is_exactly_the_designed_one(world):
    listed = {t.name for t in await world["server"].mcp.list_tools()}
    assert listed == TOOL_NAMES == {
        "current_session", "list_sessions", "search_sessions", "read_session", "get_messages",
        "get_practice", "recall_memory",
        "add_question", "add_code_exercise", "propose_memory", "set_session_title",
    }
    assert not any(n.startswith(("update", "delete", "remove", "edit", "set_buffer")) for n in listed)


# --- 3.1 Reading -------------------------------------------------------------------


async def test_current_and_listed_sessions(world):
    other, _ = _session(world["ws"], "Category theory")
    current = await world["call"]("current_session")
    listed = await world["call"]("list_sessions")

    assert (current["id"], current["you"]) == (world["node"], "Codex")
    assert [s["id"] for s in listed["sessions"]][:2] == [other, world["node"]]


async def test_archived_sessions_are_not_listed_or_searchable(world):
    gone, _ = _session(world["ws"], "Retired", "a zygomorphic thought")
    workspace.archive_node(world["ws"], gone)

    listed = await world["call"]("list_sessions")
    found = await world["call"]("search_sessions", query="zygomorphic")
    outline = await world["call"]("read_session", session_id=gone)

    assert gone not in {s["id"] for s in listed["sessions"]}
    assert found["results"] == []
    assert outline == {"error": "Not found."}


async def test_reading_is_progressive_from_search_to_full_text(world):
    long_message = "Catamorphisms generalise folds. " + "detail " * 100
    node, _ = _session(world["ws"], "Schemes", long_message, "short follow-up")

    found = await world["call"]("search_sessions", query="catamorphisms")
    outline = await world["call"]("read_session", session_id=node)
    long_preview = next(m for m in outline["messages"] if m["preview"].startswith("Catamorphisms"))
    full = await world["call"]("get_messages", message_ids=[long_preview["id"]])

    assert found["results"][0]["nodeId"] == node
    assert long_preview["shortened"] is True and len(long_preview["preview"]) <= 200
    assert [m["preview"] for m in outline["messages"]][0] == "short follow-up", "newest first"
    assert full["messages"][0]["content"] == long_message


async def test_a_long_session_is_outlined_in_pages(world):
    node, _ = _session(world["ws"], "Long", *[f"message {i}" for i in range(60)])

    first = await world["call"]("read_session", session_id=node)
    second = await world["call"]("read_session", session_id=node, cursor=first["next"])

    assert (len(first["messages"]), first["partial"]) == (50, True)
    assert (len(second["messages"]), second["partial"], second["next"]) == (10, False, None)


async def test_full_text_is_capped_at_ten_messages(world):
    node, thread = _session(world["ws"], "Many", *[f"m{i}" for i in range(12)])
    ids = [m["id"] for m in (await world["call"]("read_session", session_id=node))["messages"]]

    full = await world["call"]("get_messages", message_ids=ids)

    assert len(full["messages"]) == 10 and full["truncated"] is True


async def test_another_accounts_material_answers_as_not_found(world):
    _, theirs_ws = _account("grace")
    theirs, theirs_thread = _session(theirs_ws, "Theirs", "a private paramorphism")
    their_message = workspace.bootstrap(theirs_ws)["graph"]["messages"][-1]["id"]

    assert await world["call"]("read_session", session_id=theirs) == {"error": "Not found."}
    assert await world["call"]("get_practice", session_id=theirs) == {"error": "Not found."}
    assert (await world["call"]("get_messages", message_ids=[their_message]))["messages"] == []
    assert (await world["call"]("search_sessions", query="paramorphism"))["results"] == []


async def test_practice_and_accepted_memory_are_readable(world):
    item = practice_service.author_item(world["ws"], world["node"], {"kind": "free_response", "prompt": "Why fold?"})
    practice_service.record_attempt(world["ws"], item["id"], {"response": "To reduce"})
    pending = memory_service.propose(world["profile"], text="Knows folds", topic="fp/folds", proposed_by_name="Claude", source_node_id=None)
    proposed_only = memory_service.propose(world["profile"], text="Not yet", topic=None, proposed_by_name="Claude", source_node_id=None)
    memory_service.accept(world["profile"], pending["id"], None)

    practice = await world["call"]("get_practice")
    memory = await world["call"]("recall_memory")

    assert practice["items"][0]["prompt"] == "Why fold?" and practice["attempts"][0]["response"] == "To reduce"
    assert [m["text"] for m in memory["memories"]] == ["Knows folds"]
    assert proposed_only["id"] not in {m["id"] for m in memory["memories"]}


# --- 4.1 / 4b.5 Writing ---------------------------------------------------------------


async def test_questions_and_exercises_land_on_the_own_session_attributed(world):
    other, _ = _session(world["ws"], "Elsewhere")
    q = await world["call"]("add_question", prompt="What is a fold?")
    mc = await world["call"]("add_question", prompt="Which reduces?", kind="multiple_choice",
                             options=[{"text": "foldr", "correct": True}, {"text": "map", "correct": False}])
    ex = await world["call"]("add_code_exercise", prompt="Sum with a fold.", starter_code="def s(xs): ...", expected_output="6")

    mine = practice_service.node_practice(world["ws"], world["node"])
    assert [(i["id"], i["kind"]) for i in mine["items"]] == [
        (q["added"], "free_response"), (mc["added"], "multiple_choice"), (ex["added"], "code_exercise"),
    ]
    assert all(i["authoredBy"] == {"agentId": "agent-1", "name": "Codex"} for i in mine["items"])
    assert (q["shownIn"], mc["shownIn"], ex["shownIn"]) == ("Q&A", "Quiz", "Code")
    assert practice_service.node_practice(world["ws"], other)["items"] == []


async def test_authoring_rules_apply_to_agents_too(world):
    empty = await world["call"]("add_question", prompt="  ")
    bad = await world["call"]("add_question", prompt="Q?", kind="multiple_choice",
                              options=[{"text": "a", "correct": True}, {"text": "b", "correct": True}])
    wrong_kind = await world["call"]("add_question", prompt="Q?", kind="code_exercise")

    assert "prompt" in empty["error"] and "exactly one" in bad["error"] and "add_code_exercise" in wrong_kind["error"]
    assert practice_service.node_practice(world["ws"], world["node"])["items"] == []


async def test_a_proposed_memory_is_pending_and_a_known_topic_is_a_revision(world):
    first = await world["call"]("propose_memory", fact="Haskell is lazy", topic="haskell/laziness")
    memory_service.accept(world["profile"], first["proposed"], None)
    revision = await world["call"]("propose_memory", fact="Haskell evaluates thunks on demand", topic="haskell/laziness")

    listing = memory_service.list_for_learner(world["profile"])
    assert first["isRevision"] is False and revision["isRevision"] is True
    assert [m["text"] for m in listing["pending"]] == ["Haskell evaluates thunks on demand"]
    assert listing["pending"][0]["proposedBy"] == "Codex"


async def test_a_title_is_set_only_when_no_one_chose_it(world):
    titled = await world["call"]("set_session_title", title="Folds and friends")
    with session_scope() as session:
        assert session.get(WorkspaceNodeRecord, world["node"]).title == "Folds and friends"

    workspace.rename_node(world["ws"], world["node"], "My name")
    refused = await world["call"]("set_session_title", title="Agent's name")

    assert titled["title"] == "Folds and friends"
    assert "chosen by the learner" in refused["error"]
    with session_scope() as session:
        assert session.get(WorkspaceNodeRecord, world["node"]).title == "My name"
