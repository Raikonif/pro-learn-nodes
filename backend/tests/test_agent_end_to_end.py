"""The whole path, with nothing replaced but the agent binary.

Route → turn service → supervisor → ACP client → a real subprocess speaking
ACP. Every other test swaps one of these for a double; this one proves they
fit together, including across an application restart.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from core.secrets import InMemorySecretStore
from main import create_app
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@asynccontextmanager
async def running_app(
    data_dir: Path, store: InMemorySecretStore, *, context_server: bool = False
) -> AsyncIterator[AsyncClient]:
    app = create_app(data_dir, context_server=context_server)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client


def _events(body: str) -> list[tuple[str, dict]]:
    return [
        (block.split("\n")[0][len("event: "):], json.loads(block.split("\n")[1][len("data: "):]))
        for block in body.strip().split("\n\n")
    ]


async def test_a_conversation_streams_and_survives_a_restart(tmp_path, fake_agent_command):
    store = InMemorySecretStore()
    command, *args = fake_agent_command("--chunks", "2", "--sessions-dir", str(tmp_path / "agent-store"))
    ProfileService(store)  # the store is shared across both app lifetimes

    async with running_app(tmp_path, store) as client:
        ProfileService(store).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
        registered = await client.post("/agents", json={"name": "Fake", "command": command, "args": args})
        assert registered.status_code == 200, registered.text
        tested = (await client.post(f"/agents/{registered.json()['id']}/test")).json()
        graph = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]
        thread = graph["threads"][-1]["id"]
        first = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "a"})).text)

    assert tested["ok"] is True and tested["capabilities"]["loadSession"] is True
    assert [name for name, _ in first][0] == "turn.started"
    assert first[-1][1]["outcome"] == "completed"
    assert "".join(d["text"] for n, d in first if n == "text") == "chunk 0 chunk 1 "

    # A restart: a new app, a new supervisor, a new agent process.
    async with running_app(tmp_path, store) as client:
        second = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "recall"})).text)
        messages = (await client.get("/workspace/bootstrap")).json()["graph"]["messages"]

    assert "continuity.seam" not in [name for name, _ in second], "loadSession should have resumed it"
    assert "previously: a" in "".join(d["text"] for n, d in second if n == "text")
    assert [m["outcome"] for m in messages if m["role"] == "agent"] == ["completed", "completed"]


async def test_switching_agents_and_back_across_a_restart_needs_no_replay(tmp_path, fake_agent_command):
    """Two real agent processes; the first is returned to after a restart.

    The fake agent answers `recall` with every prompt its own session has
    received, so the last answer shows exactly what the returning agent was
    given: its own first prompt, then the catch-up — and no replayed copy.
    """

    store = InMemorySecretStore()
    first_cmd, *first_args = fake_agent_command("--sessions-dir", str(tmp_path / "first-store"))
    second_cmd, *second_args = fake_agent_command("--sessions-dir", str(tmp_path / "second-store"))

    async with running_app(tmp_path, store) as client:
        ProfileService(store).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
        first = (await client.post("/agents", json={"name": "First", "command": first_cmd, "args": first_args})).json()
        second = (await client.post("/agents", json={"name": "Second", "command": second_cmd, "args": second_args})).json()
        graph = (await client.post("/workspace/nodes", json={"title": "N"})).json()["graph"]
        node, thread = graph["nodes"][-1]["id"], graph["threads"][-1]["id"]
        await client.post("/chat/turn", json={"threadId": thread, "text": "alpha"})
        await client.put(f"/workspace/nodes/{node}/backend", json={"agentId": second["id"]})
        await client.post("/chat/turn", json={"threadId": thread, "text": "beta"})

    async with running_app(tmp_path, store) as client:
        await client.put(f"/workspace/nodes/{node}/backend", json={"agentId": first["id"]})
        back = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "gamma"})).text)
        # Missed nothing since, so this prompt arrives bare and the fake
        # answers with every prompt its own session has received.
        recall = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "recall"})).text)

    assert "continuity.seam" not in [name for name, _ in back]
    answer = "".join(d["text"] for n, d in recall if n == "text")
    history = answer.removeprefix("previously: ").split(" | ")
    assert len(history) == 2, answer
    assert history[0] == "alpha", "the first agent's own session continued"
    catch_up = history[1]
    assert "beta" in catch_up and catch_up.endswith("gamma"), "it was given what it missed"
    assert "alpha" not in catch_up, "nothing it already had was re-sent"



async def test_an_agent_reaches_the_context_server_and_again_after_a_restart(tmp_path, fake_agent_command):
    """A real agent process calls the context server with its session's credential."""

    store = InMemorySecretStore()
    command, *args = fake_agent_command("--sessions-dir", str(tmp_path / "agent-store"))

    async with running_app(tmp_path, store, context_server=True) as client:
        ProfileService(store).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
        await client.post("/agents", json={"name": "Fake", "command": command, "args": args})
        # A quick start: no title chosen, so the agent may title it.
        graph = (await client.post("/workspace/nodes", json={})).json()["graph"]
        thread = graph["threads"][-1]["id"]
        first = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "mcp:set_session_title {\"title\": \"Named by the agent\"}"})).text)
        messages = (await client.get("/workspace/bootstrap")).json()["graph"]["messages"]

    assert "Named by the agent" in "".join(d["text"] for n, d in first if n == "text")
    assert [n for n, _ in first].count("tool") == 2
    tool = next(m for m in messages if m["kind"] == "tool")
    assert (tool["content"], tool["outcome"]) == ("mcp.learn-nodes.set_session_title", "completed")

    # A restart: a new context server on a new port, old credentials gone.
    async with running_app(tmp_path, store, context_server=True) as client:
        second = _events((await client.post("/chat/turn", json={"threadId": thread, "text": "mcp:set_session_title {\"title\": \"Named by the agent\"}"})).text)

    # The title is now the agent's own ("auto"), so it may set it again.
    assert "Named by the agent" in "".join(d["text"] for n, d in second if n == "text")
