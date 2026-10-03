"""Opt-in: real agents honour model choices, and which commands answer over ACP (task 5.1).

    LEARN_NODES_REAL_AGENTS=1 uv run pytest -m real_agents tests/test_real_agents_controls.py -s
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from service.agent.acp.agent import AcpAgent
from service.agent.contract import AgentCommand, ContextUsage, TextChunk, TurnEnded, Usage

pytestmark = [
    pytest.mark.real_agents,
    pytest.mark.skipif(os.environ.get("LEARN_NODES_REAL_AGENTS") != "1", reason="talks to real agents"),
]

AGENTS = {
    "codex": (AgentCommand("npx", ("-y", "@agentclientprotocol/codex-acp@2.0.1")), ["/status"]),
    "claude": (AgentCommand("npx", ("-y", "@agentclientprotocol/claude-agent-acp@0.84.0")), ["/context", "/compact"]),
}


@pytest.mark.parametrize("name", list(AGENTS))
async def test_a_chosen_model_is_used_and_commands_answer(name):
    command, probes = AGENTS[name]
    agent = await AcpAgent.start(command)
    try:
        session_id = await agent.new_session(Path(tempfile.mkdtemp()))
        model = next(o for o in agent.config_options(session_id) if o.category == "model")
        target = next(v.value for v in model.values if v.value not in (model.current, "default"))
        after = await agent.set_config_option(session_id, model.id, target)
        assert next(o for o in after if o.category == "model").current == target

        events = [e async for e in agent.prompt(session_id, "Reply with exactly: ok")]
        usage = [e for e in events if isinstance(e, (Usage, ContextUsage))]
        print(f"\n[{name}] chose {target}; usage events: {usage}; ended: {events[-1]}")

        for probe in probes:
            out = [e async for e in agent.prompt(session_id, probe)]
            text = "".join(e.text for e in out if isinstance(e, TextChunk))
            ended = next(e for e in out if isinstance(e, TurnEnded))
            print(f"[{name}] {probe}: {ended.outcome} — {text[:140]!r}")
    finally:
        await agent.close()
