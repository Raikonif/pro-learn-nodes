"""The spike, as a test: real agents, real subscriptions. Opt-in only.

    LEARN_NODES_REAL_AGENTS=1 uv run pytest -m real_agents

Requires `codex` and `claude` installed and logged in, and `npx` on PATH. It
spends a little of the learner's quota — two short turns per agent — which is
why it never runs by default. Adapter versions are pinned to the ones the
spike measured; bump them here when design.md's "Spike results" moves.
"""

from __future__ import annotations

import os

import pytest

from service.agent.acp import AcpAgent
from service.agent.contract import AgentCommand, TextChunk

pytestmark = [
    pytest.mark.real_agents,
    pytest.mark.skipif(
        os.environ.get("LEARN_NODES_REAL_AGENTS") != "1",
        reason="talks to real agents; set LEARN_NODES_REAL_AGENTS=1",
    ),
]

AGENTS = {
    "codex": AgentCommand("npx", ("-y", "@agentclientprotocol/codex-acp@2.0.1")),
    "claude": AgentCommand("npx", ("-y", "@agentclientprotocol/claude-agent-acp@0.84.0")),
}


async def turn(agent: AcpAgent, session_id: str, text: str) -> tuple[str, object]:
    events = [event async for event in agent.prompt(session_id, text)]
    reply = "".join(event.text for event in events if isinstance(event, TextChunk))
    return reply, events[-1]


@pytest.mark.parametrize("name", sorted(AGENTS))
async def test_initialize_prompt_restart_load_recall(name, tmp_path):
    command = AGENTS[name]

    first = await AcpAgent.start(command, idle_timeout=120)
    try:
        assert first.negotiation.load_session, f"{name} no longer reports loadSession"
        session_id = await first.new_session(tmp_path)
        reply, ended = await turn(
            first, session_id, "Reply with exactly the word: pong. Remember the number 42."
        )
        assert ended.outcome == "completed", ended
        assert "pong" in reply.lower()
    finally:
        await first.close()

    # A fresh process: the context must come back through session/load.
    second = await AcpAgent.start(command, idle_timeout=120)
    try:
        await second.load_session(session_id, tmp_path)
        reply, ended = await turn(
            second,
            session_id,
            "What number did I ask you to remember? Answer with the number only.",
        )
        assert ended.outcome == "completed", ended
        assert "42" in reply
        # The replayed history was discarded: only this turn's answer arrived.
        assert "pong" not in reply.lower()
    finally:
        await second.close()
