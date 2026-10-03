"""The ACP client, against the fake agent running as a real subprocess.

Every test here crosses a real pipe: framing, id correlation, and process
death are what break, and a fake at the object level would test none of them.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
from pathlib import Path

import pytest

from service.agent.acp import AcpAgent
from service.agent.contract import (
    Agent,
    AgentCommand,
    AgentLaunchError,
    AgentNegotiationError,
    AgentNotAuthenticated,
    PermissionRefused,
    PlanUpdate,
    SessionLoadFailed,
    TextChunk,
    ThoughtChunk,
    ToolActivity,
    TurnEnded,
    Usage,
)


def command(argv: list[str]) -> AgentCommand:
    return AgentCommand(argv[0], tuple(argv[1:]))


@pytest.fixture
async def start(fake_agent_command):
    """Start a fake agent and guarantee it is stopped after the test."""

    started: list[AcpAgent] = []

    async def launch(*flags: str, **options) -> AcpAgent:
        agent = await AcpAgent.start(command(fake_agent_command(*flags)), **options)
        started.append(agent)
        return agent

    yield launch
    for agent in started:
        await agent.close()


async def collect(agent: AcpAgent, session_id: str, text: str) -> list:
    return [event async for event in agent.prompt(session_id, text)]


def text_of(events: list) -> str:
    return "".join(event.text for event in events if isinstance(event, TextChunk))


# --- negotiation ------------------------------------------------------


async def test_negotiation_reports_capabilities_and_agent_info(start):
    agent = await start()

    assert isinstance(agent, Agent)
    negotiation = agent.negotiation
    assert negotiation.protocol_version == 1
    assert negotiation.info.name == "fake-acp-agent"
    assert negotiation.info.title == "Fake Agent"
    assert negotiation.info.version == "0.0.1"
    assert negotiation.load_session is True
    assert negotiation.capabilities["loadSession"] is True
    assert agent.alive


async def test_negotiation_reports_absent_load_session(start):
    agent = await start("--no-load-session")
    assert agent.negotiation.load_session is False


async def test_a_command_that_does_not_exist_fails_at_launch(tmp_path):
    with pytest.raises(AgentLaunchError) as error:
        await AcpAgent.start(AgentCommand(str(tmp_path / "no-such-agent")))
    assert error.value.stage == "launch"


async def test_a_command_that_exits_before_answering_fails_at_launch(fake_agent_command):
    with pytest.raises(AgentLaunchError) as error:
        await AcpAgent.start(command(fake_agent_command("--exit-immediately")))
    # The agent's own complaint is the most useful thing to show.
    assert "refusing to start" in str(error.value)


async def test_an_initialize_error_fails_at_negotiation(fake_agent_command):
    with pytest.raises(AgentNegotiationError) as error:
        await AcpAgent.start(command(fake_agent_command("--broken-negotiation")))
    assert error.value.stage == "negotiate"


async def test_an_unsupported_protocol_version_fails_at_negotiation(fake_agent_command):
    with pytest.raises(AgentNegotiationError):
        await AcpAgent.start(command(fake_agent_command("--protocol-version", "99")))


async def test_an_unauthenticated_agent_is_reported_with_its_auth_methods(start, tmp_path):
    agent = await start("--unauthenticated")

    with pytest.raises(AgentNotAuthenticated) as error:
        await agent.new_session(tmp_path)

    assert error.value.stage == "authenticate"
    assert [method.id for method in error.value.auth_methods] == ["fake-login"]
    assert error.value.auth_methods[0].description == "Run `fake login` in a terminal"


async def test_command_environment_reaches_the_agent(fake_agent_command):
    # The learner's `env` is layered over the backend's own, so PATH survives.
    argv = fake_agent_command()
    agent = await AcpAgent.start(
        AgentCommand(argv[0], tuple(argv[1:]), env=(("FAKE_ACP_TITLE", "From env"),))
    )
    try:
        assert agent.negotiation.info.title == "From env"
    finally:
        await agent.close()


# --- turns ------------------------------------------------------------


async def test_a_turn_yields_text_chunks_in_order_then_completes(start, tmp_path):
    agent = await start("--chunks", "4")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    chunks = [event.text for event in events if isinstance(event, TextChunk)]
    assert chunks == ["chunk 0 ", "chunk 1 ", "chunk 2 ", "chunk 3 "]
    assert events[-1] == TurnEnded("completed")
    assert sum(isinstance(event, TurnEnded) for event in events) == 1


async def test_unknown_update_kinds_are_ignored(start, tmp_path):
    # The fake always opens a turn with `some_future_kind`.
    agent = await start("--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert events[-1] == TurnEnded("completed")
    assert all(
        isinstance(event, (TextChunk, Usage, TurnEnded)) for event in events
    ), events


async def test_usage_is_reported_before_the_turn_ends(start, tmp_path):
    agent = await start("--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert events[-2] == Usage(input_tokens=11, output_tokens=7, total_tokens=18)


async def test_thoughts_plans_and_tool_activity_are_translated(start, tmp_path):
    agent = await start("--tools", "--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert ThoughtChunk("thinking") in events
    assert any(
        isinstance(event, PlanUpdate) and event.entries[0].content == "Read notes"
        for event in events
    )
    tools = [event for event in events if isinstance(event, ToolActivity)]
    assert tools == [
        ToolActivity("call-1", title="Read notes.md", kind="read", status="pending"),
        ToolActivity("call-1", status="completed"),
    ]


@pytest.mark.parametrize(
    ("stop_reason", "outcome", "reason"),
    [
        ("end_turn", "completed", None),
        ("max_tokens", "completed", "max_tokens"),
        ("max_turn_requests", "completed", "max_turn_requests"),
        ("refusal", "refused", None),
    ],
)
async def test_stop_reasons_map_to_outcomes(start, tmp_path, stop_reason, outcome, reason):
    agent = await start("--chunks", "1", "--stop-reason", stop_reason)
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert events[-1] == TurnEnded(outcome, reason)


async def test_consecutive_turns_on_one_connection(start, tmp_path):
    agent = await start("--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    first = await collect(agent, session_id, "one")
    second = await collect(agent, session_id, "two")

    assert first[-1].outcome == second[-1].outcome == "completed"


async def test_two_sessions_on_one_connection_do_not_see_each_other(start, tmp_path):
    agent = await start("--chunks", "3", "--delay", "0.01")
    first_session = await agent.new_session(tmp_path)
    second_session = await agent.new_session(tmp_path)

    first, second = await asyncio.gather(
        collect(agent, first_session, "one"), collect(agent, second_session, "two")
    )

    assert text_of(first) == text_of(second) == "chunk 0 chunk 1 chunk 2 "


# --- agent → client requests ------------------------------------------


async def test_a_permission_request_is_refused_and_reported(start, tmp_path):
    agent = await start("--request-permission", "--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert PermissionRefused("Write notes.md", tool_call_id="call-perm") in events
    # The agent saw the refusal and carried on: the turn did not hang.
    assert "permission cancelled" in text_of(events)
    assert events[-1] == TurnEnded("completed")


async def test_an_unimplemented_client_method_is_answered_method_not_found(start, tmp_path):
    agent = await start("--unexpected-request", "--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert "fs error -32601" in text_of(events)
    assert events[-1] == TurnEnded("completed")


async def test_a_noisy_stderr_never_blocks_the_agent(start, tmp_path):
    # 512 KiB is far beyond any pipe buffer.
    agent = await start("--stderr-noise", "512", "--chunks", "1")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert events[-1] == TurnEnded("completed")


# --- cancellation -----------------------------------------------------


async def test_cancel_ends_the_turn_cancelled_and_the_connection_stays_usable(start, tmp_path):
    agent = await start("--chunks", "50", "--delay", "0.02")
    session_id = await agent.new_session(tmp_path)

    events = []
    async for event in agent.prompt(session_id, "long"):
        events.append(event)
        if isinstance(event, TextChunk) and len(events) == 2:
            await agent.cancel(session_id)

    assert events[-1] == TurnEnded("cancelled")
    assert 2 <= len([e for e in events if isinstance(e, TextChunk)]) < 50

    again = await asyncio.wait_for(collect(agent, session_id, "recall"), 5)
    assert again[-1] == TurnEnded("completed")


async def test_abandoning_a_turn_leaves_the_connection_usable(start, tmp_path):
    agent = await start("--chunks", "50", "--delay", "0.02")
    session_id = await agent.new_session(tmp_path)

    turn = agent.prompt(session_id, "long")
    async for event in turn:
        break
    await turn.aclose()

    # The abandoned turn is cancelled at the agent; a new one is accepted.
    events = await asyncio.wait_for(collect(agent, session_id, "recall"), 5)
    assert events[-1].outcome == "completed"


# --- failure ----------------------------------------------------------


async def test_process_exit_mid_turn_fails_the_turn_after_the_chunks_already_yielded(
    start, tmp_path
):
    agent = await start("--crash-mid-turn", "--chunks", "4")
    session_id = await agent.new_session(tmp_path)

    events = await collect(agent, session_id, "hello")

    assert [e.text for e in events if isinstance(e, TextChunk)] == ["chunk 0 ", "chunk 1 "]
    assert events[-1].outcome == "failed"
    assert "exit" in events[-1].reason
    assert not agent.alive


async def test_a_silent_agent_fails_the_turn_on_timeout(start, tmp_path):
    agent = await start("--hang", idle_timeout=0.3)
    session_id = await agent.new_session(tmp_path)

    events = await asyncio.wait_for(collect(agent, session_id, "hello"), 5)

    assert events[0] == TextChunk("hanging ")
    assert events[-1].outcome == "failed"
    assert "respond" in events[-1].reason
    # A hung agent is not handed the next turn.
    assert not agent.alive


async def test_prompting_a_dead_agent_fails_rather_than_raising(start, tmp_path):
    agent = await start()
    session_id = await agent.new_session(tmp_path)
    await agent.close()

    events = await collect(agent, session_id, "hello")

    assert events == [events[-1]] and events[-1].outcome == "failed"


# --- sessions ---------------------------------------------------------


async def test_load_session_in_a_fresh_process_recalls_and_discards_replay(start, tmp_path):
    sessions = tmp_path / "sessions"
    first = await start("--sessions-dir", str(sessions), "--chunks", "1")
    session_id = await first.new_session(tmp_path)
    await collect(first, session_id, "remember 42")
    await first.close()

    second = await start("--sessions-dir", str(sessions))
    await second.load_session(session_id, tmp_path)
    events = await collect(second, session_id, "recall")

    # Only this turn's content: the replayed history was discarded.
    assert text_of(events) == "previously: remember 42"


async def test_load_session_without_the_capability_fails(start, tmp_path):
    agent = await start("--no-load-session")

    with pytest.raises(SessionLoadFailed) as error:
        await agent.load_session("anything", tmp_path)
    assert error.value.stage == "session"


async def test_load_of_an_unknown_session_fails(start, tmp_path):
    agent = await start()

    with pytest.raises(SessionLoadFailed):
        await agent.load_session("fake-missing", tmp_path)


# --- process lifetime -------------------------------------------------


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def wait_dead(pid: int, timeout: float = 3.0) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if not alive(pid):
            return True
        await asyncio.sleep(0.02)
    return False


async def test_close_kills_the_agent_and_its_children(fake_agent_command, tmp_path):
    pid_file = tmp_path / "pids.json"
    agent = await AcpAgent.start(
        command(fake_agent_command("--spawn-child", "--pid-file", str(pid_file)))
    )
    pids = json.loads(pid_file.read_text())
    assert len(pids) == 2 and all(alive(pid) for pid in pids)

    await agent.close()

    assert not agent.alive
    for pid in pids:
        assert await wait_dead(pid), f"pid {pid} survived close()"


async def test_close_is_idempotent(start):
    agent = await start()
    await agent.close()
    await agent.close()
    assert not agent.alive


async def test_an_agent_ignoring_sigterm_is_killed_after_the_grace_period(
    fake_agent_command, tmp_path
):
    pid_file = tmp_path / "pids.json"
    agent = await AcpAgent.start(
        command(fake_agent_command("--pid-file", str(pid_file))), kill_grace=0.2
    )
    (pid,) = json.loads(pid_file.read_text())
    # Stop the agent in its tracks so SIGTERM is not acted on until SIGCONT;
    # SIGKILL still is.
    os.kill(pid, signal.SIGSTOP)

    await asyncio.wait_for(agent.close(), 3)

    assert await wait_dead(pid)


def test_the_agent_package_exports_the_client():
    from service.agent import acp

    assert acp.AcpAgent is AcpAgent
    assert Path(acp.__file__).parent.name == "acp"


# --- Session controls -----------------------------------------------------------


async def test_options_and_commands_are_reported_and_an_option_can_be_changed(fake_agent_command, tmp_path):
    from service.agent.acp.agent import AcpAgent
    from service.agent.contract import AgentCommand, ContextUsage, TextChunk

    command, *args = fake_agent_command("--config-options", "--sessions-dir", str(tmp_path / "s"))
    agent = await AcpAgent.start(AgentCommand(command, tuple(args)))
    try:
        session_id = await agent.new_session(tmp_path)
        await asyncio.sleep(0.2)  # commands are announced just after the answer
        options = {o.category: o for o in agent.config_options(session_id)}
        assert set(options) == {"model", "thought_level", "mode", "model_config"}
        assert (options["model"].current, [v.value for v in options["model"].values]) == ("fast-1", ["fast-1", "smart-2"])
        assert [c.name for c in agent.available_commands(session_id)] == ["compact", "context", "$archify"]

        after = await agent.set_config_option(session_id, "model", "smart-2")
        assert next(o for o in after if o.id == "model").current == "smart-2"

        events = [e async for e in agent.prompt(session_id, "whoami")]
        assert "model=smart-2" in "".join(e.text for e in events if isinstance(e, TextChunk))
        assert ContextUsage(1234, 200000) in events
    finally:
        await agent.close()


async def test_an_agent_without_config_options_says_so_clearly(fake_agent_command, tmp_path):
    from service.agent.acp.agent import AcpAgent
    from service.agent.contract import AgentCommand, AgentError

    command, *args = fake_agent_command()
    agent = await AcpAgent.start(AgentCommand(command, tuple(args)))
    try:
        session_id = await agent.new_session(tmp_path)
        assert agent.config_options(session_id) == []
        with pytest.raises(AgentError, match="could not change model"):
            await agent.set_config_option(session_id, "model", "x")
    finally:
        await agent.close()
