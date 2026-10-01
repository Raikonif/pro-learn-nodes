"""Opt-in: what real agents do with the context server (task 7.1).

    LEARN_NODES_REAL_AGENTS=1 uv run pytest -m real_agents tests/test_real_agents_context.py -s

Spends a few short turns of the learner's subscriptions. Prints what each
agent did rather than asserting model behaviour strictly — the result is a
measurement recorded in design.md, not a contract.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import ChatMessageRecord
from repository import agent_repo
from service import practice_service, workspace
from service.agent.acp.agent import AcpAgent
from service.agent.sessions import TurnService
from service.context_server.app import ContextServer
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from sqlmodel import select

pytestmark = [
    pytest.mark.real_agents,
    pytest.mark.skipif(os.environ.get("LEARN_NODES_REAL_AGENTS") != "1", reason="talks to real agents"),
]

AGENTS = {
    "codex": ("npx", ["-y", "@agentclientprotocol/codex-acp@2.0.1"]),
    "claude": ("npx", ["-y", "@agentclientprotocol/claude-agent-acp@0.84.0"]),
}


async def _measure(tmp_path: Path, name: str, *, orientation: bool, text: str, command: str | None = None):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    ws = workspace.ensure_default_workspace(profile.id).id
    old = workspace.create_root_node(ws, "Haskell basics")["graph"]
    old_thread = old["threads"][-1]["id"]
    workspace.append_message(ws, old_thread, "learner", "Last week we covered lazy evaluation, thunks, and why foldl leaks memory.")
    graph = workspace.create_root_node(ws, None)["graph"]
    node = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
    thread = next(t["id"] for t in graph["threads"] if t["nodeId"] == node)
    command_name, args = AGENTS[name]
    with session_scope() as session:
        registration = agent_repo.create(session, profile_id=profile.id, name=name, command=command_name, args=args, env={})
        session.expunge(registration)

    context = ContextServer()
    await context.start()
    agents: dict = {}

    async def provide(profile_id, reg):
        if reg.id not in agents:
            from service.agent.contract import AgentCommand

            agents[reg.id] = await AcpAgent.start(AgentCommand(command_name, tuple(args)))
        return agents[reg.id]

    try:
        service = TurnService(tmp_path, provide, context=context, orientation=orientation)
        events = [e async for e in service.run_turn(profile.id, ws, thread, text, command=command)]
    finally:
        for agent in agents.values():
            await agent.close()
        await context.stop()
    tools = [d.get("title") for n, d in events if n == "tool" and d.get("title")]
    delivered = [d for n, d in events if n == "practice.delivered"]
    reply = "".join(d["text"] for n, d in events if n == "text")
    with session_scope() as session:
        kinds = [m.kind for m in session.exec(select(ChatMessageRecord).where(ChatMessageRecord.thread_id == thread)).all()]
    items = practice_service.node_practice(ws, node)["items"]
    print(f"\n[{name} orientation={orientation} command={command}] tools={tools}\n  delivered={[(d['tool'], len(d['itemIds'])) for d in delivered]} items={[i['kind'] for i in items]} kinds={kinds}\n  reply={reply[:160]!r}")
    return tools, delivered, items


@pytest.mark.parametrize("name", list(AGENTS))
@pytest.mark.parametrize("orientation", [True, False])
async def test_recalling_earlier_work(tmp_path, name, orientation):
    tools, _, _ = await _measure(tmp_path, name, orientation=orientation,
                                 text="What did we cover about Haskell last week? Keep it short.")
    if orientation:
        assert any("search_sessions" in t or "list_sessions" in t or "read_session" in t for t in tools)


@pytest.mark.parametrize("name", list(AGENTS))
async def test_a_quiz_command_is_delivered(tmp_path, name):
    _, delivered, items = await _measure(tmp_path, name, orientation=True,
                                         text="/quiz two quick questions on Python list comprehensions", command="quiz")
    assert delivered and delivered[-1]["tool"] == "quiz"
    assert len(items) >= 2 and all(i["kind"] == "multiple_choice" and i["authoredBy"] for i in items)
