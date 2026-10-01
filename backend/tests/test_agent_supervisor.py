"""Agent processes do not outlive the application, nor pile up across reloads.

Processes are found by a unique `--tag` in their argv — the fake agent passes
it on to the child it forks — so a count is exact even with other tests'
agents running on the machine.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import uuid

import pytest

import core.runtime as runtime_module
from core.runtime import RuntimeState, local_data_lifespan
from service.agent.contract import AgentCommand, TurnEnded
from service.agent.supervisor import AgentSupervisor


def tagged_pids(tag: str) -> set[int]:
    output = subprocess.run(
        ["ps", "-axo", "pid=,command="], capture_output=True, text=True, check=True
    ).stdout
    return {
        int(line.split(None, 1)[0])
        for line in output.splitlines()
        if tag in line and "ps -axo" not in line
    }


async def wait_for_count(tag: str, expected: int, timeout: float = 3.0) -> int:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        count = len(tagged_pids(tag))
        if count == expected or loop.time() >= deadline:
            return count
        await asyncio.sleep(0.05)


@pytest.fixture
def tag():
    value = f"fake-acp-{uuid.uuid4().hex}"
    yield value
    for pid in tagged_pids(value):  # Never leak into the next test.
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass


@pytest.fixture
def tagged_command(fake_agent_command, tag):
    def build(*flags: str) -> AgentCommand:
        argv = fake_agent_command("--tag", tag, *flags)
        return AgentCommand(argv[0], tuple(argv[1:]))

    return build


@pytest.fixture
def app_with_agents(monkeypatch, tmp_path):
    """An app whose lifespan runs everything but the database work."""

    from fastapi import FastAPI

    monkeypatch.setattr(runtime_module, "initialize_local_data", lambda _data_dir: None)
    monkeypatch.setattr(runtime_module, "resume_unfinished_indexing", lambda: None)

    def build() -> FastAPI:
        app = FastAPI()
        app.state.runtime = RuntimeState()
        app.state.data_dir = tmp_path
        return app

    return build


# --- the supervisor alone ---------------------------------------------


async def test_get_starts_lazily_and_reuses_the_connection(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        assert tagged_pids(tag) == set()
        first = await supervisor.get(("profile", "agent"), tagged_command())
        second = await supervisor.get(("profile", "agent"), tagged_command())
        assert first is second
        assert len(tagged_pids(tag)) == 1
    finally:
        await supervisor.close_all()


async def test_concurrent_gets_start_one_process(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        agents = await asyncio.gather(
            *(supervisor.get("key", tagged_command()) for _ in range(5))
        )
        assert len({id(agent) for agent in agents}) == 1
        assert len(tagged_pids(tag)) == 1
    finally:
        await supervisor.close_all()


async def test_different_keys_get_different_agents(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        first = await supervisor.get(("ada", "codex"), tagged_command())
        second = await supervisor.get(("grace", "codex"), tagged_command())
        assert first is not second
        assert len(tagged_pids(tag)) == 2
    finally:
        await supervisor.close_all()


async def test_close_all_leaves_no_agent_or_child_running(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    await supervisor.get("a", tagged_command("--spawn-child"))
    await supervisor.get("b", tagged_command("--spawn-child"))
    assert len(tagged_pids(tag)) == 4  # two agents, each with a child

    await supervisor.close_all()

    assert await wait_for_count(tag, 0) == 0
    assert json.loads((tmp_path / "agent-pids.json").read_text()) == []


async def test_a_crashed_agent_is_replaced_on_the_next_get(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        crashing = await supervisor.get("key", tagged_command("--crash-mid-turn"))
        session_id = await crashing.new_session(tmp_path)
        events = [event async for event in crashing.prompt(session_id, "hello")]
        assert events[-1].outcome == "failed"
        assert not crashing.alive

        replacement = await supervisor.get("key", tagged_command("--crash-mid-turn"))

        assert replacement is not crashing
        assert replacement.alive
    finally:
        await supervisor.close_all()


async def test_a_changed_command_restarts_the_agent(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        first = await supervisor.get("key", tagged_command("--chunks", "1"))
        second = await supervisor.get("key", tagged_command("--chunks", "2"))
        assert first is not second and not first.alive
        assert await wait_for_count(tag, 1) == 1
    finally:
        await supervisor.close_all()


async def test_discard_stops_one_agent(tmp_path, tagged_command, tag):
    supervisor = AgentSupervisor(tmp_path)
    try:
        dropped = await supervisor.get("a", tagged_command())
        kept = await supervisor.get("b", tagged_command())
        await supervisor.discard("a")
        assert not dropped.alive and kept.alive
        assert await wait_for_count(tag, 1) == 1
    finally:
        await supervisor.close_all()


async def test_reap_stale_kills_an_abandoned_runs_agents(tmp_path, tagged_command, tag):
    # A run that never unwound: its supervisor is simply dropped, as a
    # killed `--reload` worker drops it.
    abandoned = AgentSupervisor(tmp_path)
    await abandoned.get("key", tagged_command("--spawn-child"))
    assert len(tagged_pids(tag)) == 2

    fresh = AgentSupervisor(tmp_path)
    reaped = await fresh.reap_stale()

    assert reaped == 1
    assert await wait_for_count(tag, 0) == 0
    assert json.loads((tmp_path / "agent-pids.json").read_text()) == []


async def test_reap_stale_spares_a_recycled_pid(tmp_path):
    # A record whose pid now belongs to an unrelated process — started at a
    # different time — must not be killed.
    bystander = subprocess.Popen(["sleep", "30"], start_new_session=True)
    try:
        (tmp_path / "agent-pids.json").write_text(
            json.dumps(
                [
                    {
                        "pid": bystander.pid,
                        "started": "Thu Jan  1 00:00:00 1970",
                        "run": "previous",
                        "owner": 999_999_999,
                    }
                ]
            )
        )

        assert await AgentSupervisor(tmp_path).reap_stale() == 0
        assert bystander.poll() is None
    finally:
        bystander.kill()
        bystander.wait()


async def test_reap_stale_spares_another_live_backends_agents(tmp_path, tagged_command, tag):
    other = AgentSupervisor(tmp_path)
    await other.get("key", tagged_command())
    records = json.loads((tmp_path / "agent-pids.json").read_text())
    # Pretend a different, still-running backend process owns the record.
    records[0]["owner"] = os.getppid()
    (tmp_path / "agent-pids.json").write_text(json.dumps(records))

    try:
        assert await AgentSupervisor(tmp_path).reap_stale() == 0
        assert len(tagged_pids(tag)) == 1
    finally:
        await other.close_all()


async def test_reap_stale_tolerates_a_corrupt_record(tmp_path):
    (tmp_path / "agent-pids.json").write_text("{not json")
    assert await AgentSupervisor(tmp_path).reap_stale() == 0


# --- the lifespan -----------------------------------------------------


async def test_no_agent_survives_lifespan_exit(app_with_agents, tagged_command, tag):
    app = app_with_agents()

    async with local_data_lifespan(app):
        supervisor = app.state.runtime.agents
        assert isinstance(supervisor, AgentSupervisor)
        agent = await supervisor.get("key", tagged_command("--spawn-child"))
        session_id = await agent.new_session(app.state.data_dir)
        events = [event async for event in agent.prompt(session_id, "hello")]
        assert events[-1] == TurnEnded("completed")
        assert len(tagged_pids(tag)) == 2

    assert await wait_for_count(tag, 0) == 0


async def test_repeated_reloads_do_not_accumulate_agents(app_with_agents, tagged_command, tag):
    for _ in range(3):
        # A clean lifespan cycle...
        app = app_with_agents()
        async with local_data_lifespan(app):
            await app.state.runtime.agents.get("key", tagged_command("--spawn-child"))
        # ...and a run that died without unwinding, leaving its agent behind.
        leaked = AgentSupervisor(app.state.data_dir)
        await leaked.get("key", tagged_command("--spawn-child"))

    # The next startup reaps whatever the previous run left.
    app = app_with_agents()
    async with local_data_lifespan(app):
        assert await wait_for_count(tag, 0) == 0
        await app.state.runtime.agents.get("key", tagged_command("--spawn-child"))
        assert len(tagged_pids(tag)) == 2

    assert await wait_for_count(tag, 0) == 0
