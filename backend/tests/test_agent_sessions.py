"""A node's conversation on an agent: recorded here, cached there.

Each test names the spec scenario it proves. The agent is the in-memory
double, so what is exercised is the mapping between the application's record
and the agent's session — not the wire.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from sqlmodel import select

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import (
    AgentSessionRecord,
    ChatMessageRecord,
    ChatThreadRecord,
    WorkspaceNodeRecord,
)
from repository import agent_repo
from service import workspace
from service.agent.contract import (
    PermissionRefused,
    TextChunk,
    ToolActivity,
    TurnEnded,
    Usage,
)
from service.agent.sessions import TurnService, node_directory
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.agent_doubles import FakeAgent


@pytest.fixture
def account(tmp_path: Path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    workspace_id = workspace.ensure_default_workspace(profile.id).id
    return profile.id, workspace_id, tmp_path


def _register(profile_id: str, name: str = "Codex") -> str:
    with session_scope() as session:
        return agent_repo.create(
            session, profile_id=profile_id, name=name, command="x", args=[], env={}
        ).id


def _node(workspace_id: str, title: str = "Node") -> tuple[str, str]:
    graph = workspace.create_root_node(workspace_id, title)["graph"]
    node = graph["nodes"][-1]["id"]
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
    return node, thread


def _service(data_dir: Path, agents: dict[str, FakeAgent]) -> TurnService:
    async def provide(profile_id, registration):
        return agents[registration.id]

    return TurnService(data_dir, provide)


async def _run(service: TurnService, account, thread: str, text: str) -> list[tuple[str, dict]]:
    profile_id, workspace_id, _ = account
    return [event async for event in service.run_turn(profile_id, workspace_id, thread, text)]


def _messages(thread: str) -> list[ChatMessageRecord]:
    with session_scope() as session:
        return list(
            session.exec(
                select(ChatMessageRecord)
                .where(ChatMessageRecord.thread_id == thread)
                .order_by(ChatMessageRecord.created_at)
            ).all()
        )


# --- Resolving the backend -----------------------------------------------


async def test_no_agent_registered_records_the_message_and_directs_to_settings(account):
    _, workspace_id, data_dir = account
    _, thread = _node(workspace_id)

    events = await _run(_service(data_dir, {}), account, thread, "hello")

    assert [name for name, _ in events] == ["turn.started", "turn.ended"]
    assert events[-1][1]["outcome"] == "failed" and events[-1][1]["reason"] == "no_agent"
    learner, reply = _messages(thread)
    assert (learner.role, learner.content) == ("learner", "hello")
    assert reply.outcome == "failed" and "Settings" in reply.content


async def test_a_new_node_runs_on_the_default_and_records_it(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(workspace_id)

    events = await _run(_service(data_dir, {agent_id: FakeAgent()}), account, thread, "hi")

    assert events[-1] == ("turn.ended", {"outcome": "completed", "reason": None})
    with session_scope() as session:
        assert session.get(WorkspaceNodeRecord, node).backend_agent_id == agent_id


async def test_changing_the_default_does_not_move_an_existing_conversation(account):
    profile_id, workspace_id, data_dir = account
    first = _register(profile_id, "Codex")
    second = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    agents = {first: FakeAgent(), second: FakeAgent()}
    service = _service(data_dir, agents)
    await _run(service, account, thread, "one")

    with session_scope() as session:
        agent_repo.set_default(session, profile_id, second)
    await _run(service, account, thread, "two")

    assert agents[first].sessions["s1"] == ["one", "two"]
    assert agents[second].sessions == {}


# --- Streaming and recording ---------------------------------------------


async def test_a_turn_streams_and_records_its_outcome(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent(script=lambda s, t: [TextChunk("Hel"), TextChunk("lo"), Usage(total_tokens=9)])

    events = await _run(_service(data_dir, {agent_id: agent}), account, thread, "hi")

    assert [name for name, _ in events] == ["turn.started", "text", "text", "usage", "turn.ended"]
    reply = _messages(thread)[-1]
    assert (reply.content, reply.outcome, reply.kind) == ("Hello", "completed", "message")


async def test_tool_activity_and_refused_permissions_are_recorded_distinctly(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent(
        script=lambda s, t: [
            ToolActivity("call-1", title="Read notes.md", kind="read", status="pending"),
            ToolActivity("call-1", status="completed"),
            PermissionRefused(title="Write answer.py", tool_call_id="call-2"),
            TextChunk("done"),
        ]
    )

    events = await _run(_service(data_dir, {agent_id: agent}), account, thread, "hi")

    names = [name for name, _ in events]
    assert names.count("tool") == 2 and "permission.refused" in names
    by_kind = {m.kind: m for m in _messages(thread)}
    assert (by_kind["tool"].content, by_kind["tool"].outcome) == ("Read notes.md", "completed")
    assert by_kind["permission_refused"].content == "Write answer.py"
    assert by_kind["permission_refused"].outcome == "refused"


async def test_an_abandoned_stream_keeps_what_arrived_marked_incomplete(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent(script=lambda s, t: [TextChunk("partial "), TextChunk("never seen")])
    profile_id, workspace_id, _ = account

    stream = _service(data_dir, {agent_id: agent}).run_turn(profile_id, workspace_id, thread, "hi")
    async for name, _ in stream:
        if name == "text":
            break
    await stream.aclose()

    reply = _messages(thread)[-1]
    assert (reply.content, reply.outcome) == ("partial ", "incomplete")
    assert agent.cancelled == ["s1"]


async def test_cancelling_a_turn_keeps_the_partial_content(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent(script=lambda s, t: [TextChunk("partial"), TextChunk("rest")])
    agent.gate = asyncio.Event()
    service = _service(data_dir, {agent_id: agent})

    events: list[tuple[str, dict]] = []

    async def consume():
        async for event in service.run_turn(profile_id, workspace_id, thread, "hi"):
            events.append(event)
            if event[0] == "turn.started":
                agent.gate.set()
            if event[0] == "text":
                agent.gate.clear()
                await service.cancel(events[0][1]["turnId"])

    await consume()

    assert events[-1][1]["outcome"] == "cancelled"
    assert _messages(thread)[-1].outcome == "cancelled"
    assert await service.cancel(events[0][1]["turnId"]) is False


# --- Continuity -------------------------------------------------------------


async def test_the_open_session_is_prompted_directly_on_the_next_turn(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent()
    service = _service(data_dir, {agent_id: agent})

    await _run(service, account, thread, "one")
    await _run(service, account, thread, "two")

    assert agent.sessions == {"s1": ["one", "two"]} and agent.loaded == []


async def test_resuming_after_a_restart_loads_the_session_without_a_seam(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    before = FakeAgent()
    await _run(_service(data_dir, {agent_id: before}), account, thread, "remember 42")

    # A new process: a fresh service and a fresh agent object whose own store
    # still holds the session, as the spike measured for both real agents.
    after = FakeAgent(sessions=before.sessions)
    events = await _run(_service(data_dir, {agent_id: after}), account, thread, "what number?")

    assert after.loaded == ["s1"]
    assert "continuity.seam" not in [name for name, _ in events]
    assert after.sessions["s1"][-1] == "what number?"


async def test_an_agent_that_cannot_resume_is_replayed_and_the_seam_shown(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    await _run(_service(data_dir, {agent_id: FakeAgent()}), account, thread, "remember 42")

    after = FakeAgent(load_supported=False)
    events = await _run(_service(data_dir, {agent_id: after}), account, thread, "what number?")

    assert "continuity.seam" in [name for name, _ in events]
    replayed = after.sessions["s1"][0]
    assert "remember 42" in replayed and "pong" in replayed and replayed.endswith("what number?")
    kinds = [m.kind for m in _messages(thread)]
    seam_at = kinds.index("continuity_seam")
    assert _messages(thread)[seam_at + 1].content == "what number?", "seam precedes the message"


async def test_switching_the_backend_replays_rather_than_loading_a_foreign_session(account):
    profile_id, workspace_id, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    agents = {codex: FakeAgent(), claude: FakeAgent()}
    service = _service(data_dir, agents)
    await _run(service, account, thread, "one")

    workspace.set_node_backend(workspace_id, node, claude)
    events = await _run(service, account, thread, "two")

    assert agents[claude].loaded == []
    assert "continuity.seam" in [name for name, _ in events]
    with session_scope() as session:
        owners = session.exec(
            select(AgentSessionRecord.agent_id).where(AgentSessionRecord.thread_id == thread)
        ).all()
    assert sorted(owners) == sorted([codex, claude]), "each agent keeps its own session"


async def test_an_unauthenticated_agent_fails_the_turn_with_directions(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)

    events = await _run(
        _service(data_dir, {agent_id: FakeAgent(authenticated=False)}), account, thread, "hi"
    )

    assert events[-1][1]["reason"] == "not_authenticated"
    assert "sign" in _messages(thread)[-1].content.lower()


# --- Isolation ----------------------------------------------------------------


async def test_two_nodes_on_one_agent_get_separate_sessions_and_directories(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    first_node, first = _node(workspace_id, "A")
    second_node, second = _node(workspace_id, "B")
    agent = FakeAgent()
    service = _service(data_dir, {agent_id: agent})

    await _run(service, account, first, "about A")
    await _run(service, account, second, "about B")

    assert agent.sessions == {"s1": ["about A"], "s2": ["about B"]}
    assert agent.cwds["s1"] == node_directory(data_dir, first_node)
    assert agent.cwds["s2"] == node_directory(data_dir, second_node)
    assert agent.cwds["s1"].is_dir() and not any(agent.cwds["s1"].iterdir())
    # Neither directory contains the data store or the other node's.
    for cwd in agent.cwds.values():
        assert cwd not in database_path().parents
    assert agent.cwds["s1"] not in agent.cwds["s2"].parents
    assert agent.cwds["s2"] not in agent.cwds["s1"].parents


# --- Inheritance ---------------------------------------------------------------


def test_children_and_branches_inherit_the_backend_even_if_unreachable(account):
    """The parent's agent may not be installed here; the child keeps it anyway."""

    profile_id, workspace_id, _ = account
    agent_id = _register(profile_id)
    node, thread = _node(workspace_id)
    workspace.set_node_backend(workspace_id, node, agent_id)
    message = workspace.append_message(workspace_id, thread, "agent", "A passage to branch from")
    message_id = message["graph"]["messages"][-1]["id"]

    child = workspace.create_child_node(workspace_id, node)["graph"]["nodes"][-1]
    branch = workspace.create_branch_node(
        workspace_id,
        node,
        {"messageId": message_id, "start": 0, "end": 9, "excerpt": "A passage"},
    )["graph"]["nodes"][-1]

    assert child["backendAgentId"] == agent_id
    assert branch["backendAgentId"] == agent_id


# --- One session per agent -----------------------------------------------------


async def test_returning_to_an_agent_continues_its_own_session_with_only_what_it_missed(account):
    profile_id, workspace_id, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    agents = {
        codex: FakeAgent(script=lambda s, t: [TextChunk("codex answer")]),
        claude: FakeAgent(script=lambda s, t: [TextChunk("claude answer")]),
    }
    service = _service(data_dir, agents)

    await _run(service, account, thread, "first, to codex")
    workspace.set_node_backend(workspace_id, node, claude)
    await _run(service, account, thread, "second, to claude")
    workspace.set_node_backend(workspace_id, node, codex)
    events = await _run(service, account, thread, "third, back to codex")

    assert "continuity.seam" not in [name for name, _ in events]
    first_prompt, back_prompt = agents[codex].sessions["s1"]
    assert first_prompt == "first, to codex"
    assert "second, to claude" in back_prompt and "claude answer" in back_prompt
    assert "first, to codex" not in back_prompt and "codex answer" not in back_prompt
    assert back_prompt.endswith("third, back to codex")
    assert len(agents[codex].sessions) == 1, "no new session was opened for codex"


async def test_after_catching_up_the_next_turn_carries_only_the_new_message(account):
    profile_id, workspace_id, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    agents = {codex: FakeAgent(), claude: FakeAgent()}
    service = _service(data_dir, agents)
    await _run(service, account, thread, "one")
    workspace.set_node_backend(workspace_id, node, claude)
    await _run(service, account, thread, "two")
    workspace.set_node_backend(workspace_id, node, codex)
    await _run(service, account, thread, "three")

    await _run(service, account, thread, "four")

    assert agents[codex].sessions["s1"][-1] == "four"


async def test_catch_up_survives_a_restart_through_load(account):
    profile_id, workspace_id, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    codex_before = FakeAgent()
    await _run(_service(data_dir, {codex: codex_before, claude: FakeAgent()}), account, thread, "one")
    workspace.set_node_backend(workspace_id, node, claude)
    await _run(_service(data_dir, {codex: codex_before, claude: FakeAgent()}), account, thread, "two")

    # A new process: codex's session is loaded, then topped up.
    codex_after = FakeAgent(sessions=codex_before.sessions)
    workspace.set_node_backend(workspace_id, node, codex)
    events = await _run(_service(data_dir, {codex: codex_after, claude: FakeAgent()}), account, thread, "three")

    assert codex_after.loaded == ["s1"]
    assert "continuity.seam" not in [name for name, _ in events]
    assert "two" in codex_after.sessions["s1"][-1] and codex_after.sessions["s1"][-1].endswith("three")


async def test_a_removed_agent_leaves_the_session_continuable_on_another(account):
    profile_id, workspace_id, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(workspace_id)
    agents = {codex: FakeAgent(), claude: FakeAgent()}
    service = _service(data_dir, agents)
    workspace.set_node_backend(workspace_id, node, codex)
    await _run(service, account, thread, "one")

    with session_scope() as session:
        agent_repo.remove(session, profile_id, codex)
    events = await _run(service, account, thread, "two")

    assert events[-1][1]["outcome"] == "completed"
    assert [m.content for m in _messages(thread) if m.kind == "message"] == ["one", "pong", "two", "pong"]


# --- The context server is handed to every session ---------------------------------


class _Context:
    """The parts of `ContextServer` the turn service uses."""

    def __init__(self):
        from service.context_server.credentials import CredentialRegistry

        self.credentials = CredentialRegistry()
        self.port = 4321
        self.url = "http://127.0.0.1:4321/mcp"


def _bearer(servers) -> str:
    [server] = servers
    assert (server.name, server.url) == ("learn-nodes", "http://127.0.0.1:4321/mcp")
    [(header, value)] = server.headers
    assert header == "Authorization" and value.startswith("Bearer ")
    return value.removeprefix("Bearer ")


def _service_with_context(data_dir, agents, context):
    async def provide(profile_id, registration):
        return agents[registration.id]

    return TurnService(data_dir, provide, context=context)


async def test_a_new_session_gets_the_context_server_with_a_scoped_credential(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(workspace_id)
    agent, context = FakeAgent(), _Context()

    await _run(_service_with_context(data_dir, {agent_id: agent}, context), account, thread, "hi")

    token = _bearer(agent.mcp["s1"])
    scope = context.credentials.resolve(token)
    assert (scope.profile_id, scope.workspace_id, scope.node_id, scope.thread_id, scope.agent_id) == (
        profile_id, workspace_id, node, thread, agent_id,
    )
    assert scope.agent_name == "Codex"


async def test_loading_mints_a_fresh_credential_and_revokes_the_old(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    context = _Context()
    before = FakeAgent()
    await _run(_service_with_context(data_dir, {agent_id: before}, context), account, thread, "one")
    old_token = _bearer(before.mcp["s1"])

    after = FakeAgent(sessions=before.sessions)
    await _run(_service_with_context(data_dir, {agent_id: after}, context), account, thread, "two")

    new_token = _bearer(after.mcp_loads["s1"])
    assert new_token != old_token
    assert context.credentials.resolve(old_token) is None
    assert context.credentials.resolve(new_token) is not None


async def test_an_open_session_keeps_its_credential(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent, context = FakeAgent(), _Context()
    service = _service_with_context(data_dir, {agent_id: agent}, context)

    await _run(service, account, thread, "one")
    token = _bearer(agent.mcp["s1"])
    await _run(service, account, thread, "two")

    assert context.credentials.resolve(token) is not None
    assert agent.mcp_loads == {}


async def test_the_orientation_note_is_sent_once_per_new_agent_session(account):
    from service.context_server.orientation import ORIENTATION_NOTE

    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    before = FakeAgent()
    service = _service_with_context(data_dir, {agent_id: before}, _Context())
    await _run(service, account, thread, "one")
    await _run(service, account, thread, "two")
    after = FakeAgent(sessions=before.sessions)
    await _run(_service_with_context(data_dir, {agent_id: after}, _Context()), account, thread, "three")

    first, second, third = after.sessions["s1"]
    assert first.startswith(ORIENTATION_NOTE) and first.endswith("one")
    assert second == "two", "not on later turns"
    assert third == "three", "not when a session is loaded"


async def test_without_a_context_server_sessions_run_as_before(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent()

    events = await _run(_service(data_dir, {agent_id: agent}), account, thread, "hi")

    assert events[-1][1]["outcome"] == "completed"
    assert agent.mcp["s1"] == [] and agent.sessions["s1"] == ["hi"]


# --- Delivery and commands ----------------------------------------------------------


class _ContextWithBus(_Context):
    def __init__(self):
        super().__init__()
        from service.context_server.delivery import DeliveryBus

        self.deliveries = DeliveryBus()


def _delivering_agent(context, *deliveries):
    """An agent whose turn publishes deliveries, as a context-server write would."""

    from service.context_server.delivery import Delivery

    class Delivering(FakeAgent):
        async def prompt(self, session_id, text):
            self.sessions[session_id].append(text)
            yield ToolActivity("call-1", title="mcp.learn-nodes.add_question", status="pending")
            for node, thread, tool, ids in deliveries:
                context.deliveries.publish(Delivery(node, thread, tool, ids, "Codex"))
            yield ToolActivity("call-1", status="completed")
            yield TextChunk("done")
            yield TurnEnded("completed")

    return Delivering()


async def test_a_delivery_during_the_turn_is_streamed_and_recorded(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(workspace_id)
    context = _ContextWithBus()
    agent = _delivering_agent(context, (node, thread, "quiz", ("i1",)), (node, thread, "quiz", ("i2",)),
                              (node, thread, "code", ("e1",)))

    events = await _run(_service_with_context(data_dir, {agent_id: agent}, context), account, thread, "quiz me")

    delivered = [d for n, d in events if n == "practice.delivered"]
    assert [(d["tool"], d["itemIds"]) for d in delivered] == [("quiz", ["i1"]), ("quiz", ["i1", "i2"]), ("code", ["e1"])]
    assert delivered[0]["messageId"] == delivered[1]["messageId"] != delivered[2]["messageId"]
    assert delivered[0]["agentName"] == "Codex"
    records = [m for m in _messages(thread) if m.kind == "practice_delivered"]
    assert [(r.data, r.content) for r in records] == [
        ({"tool": "quiz", "itemIds": ["i1", "i2"]}, "Codex sent 2 questions to Quiz"),
        ({"tool": "code", "itemIds": ["e1"]}, "Codex sent an exercise to Code"),
    ]


async def test_a_delivery_for_another_thread_is_not_streamed_here(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(workspace_id)
    context = _ContextWithBus()
    agent = _delivering_agent(context, (node, "another-thread", "qa", ("x",)))

    events = await _run(_service_with_context(data_dir, {agent_id: agent}, context), account, thread, "hi")

    assert "practice.delivered" not in [n for n, _ in events]
    assert not [m for m in _messages(thread) if m.kind == "practice_delivered"]


async def test_a_command_adds_the_instruction_but_records_what_was_typed(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    agent = FakeAgent()
    service = _service_with_context(data_dir, {agent_id: agent}, _ContextWithBus())

    [_ async for _ in service.run_turn(profile_id, workspace_id, thread, "/quiz five on folds", command="quiz")]

    sent = agent.sessions["s1"][0]
    assert "add_question" in sent and "multiple_choice" in sent and sent.rstrip().endswith("five on folds")
    assert _messages(thread)[0].content == "/quiz five on folds"


async def test_a_command_turn_that_delivers_nothing_says_so(account):
    profile_id, workspace_id, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(workspace_id)
    service = _service_with_context(data_dir, {agent_id: FakeAgent()}, _ContextWithBus())

    [_ async for _ in service.run_turn(profile_id, workspace_id, thread, "/code a loop", command="code")]

    [notice] = [m for m in _messages(thread) if m.kind == "practice_not_delivered"]
    assert notice.data == {"tool": "code"} and "Code" in notice.content
