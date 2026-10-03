"""A branched conversation's agent is told what it branched from — once per agent session."""

from __future__ import annotations

from service import workspace
from tests.agent_doubles import FakeAgent
from tests.test_agent_sessions import _register, _run, _service, account  # noqa: F401 — fixture


def _root(ws: str, title: str) -> tuple[str, str]:
    graph = workspace.create_root_node(ws, title)["graph"]
    node = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
    return node, next(t["id"] for t in graph["threads"] if t["nodeId"] == node and t["anchor"] is None)


def _say(ws: str, thread: str, *lines: str) -> list[str]:
    return [workspace.append_message(ws, thread, "learner", line)["graph"]["messages"][-1]["id"] for line in lines]


def _branch(ws: str, parent: str, message_id: str, excerpt: str) -> str:
    graph = workspace.create_branch_node(ws, parent, {"messageId": message_id, "start": 0, "end": len(excerpt), "excerpt": excerpt})["graph"]
    child = max(graph["nodes"], key=lambda n: n["createdAt"])["id"]
    return next(t["id"] for t in graph["threads"] if t["nodeId"] == child and t["anchor"] is None)


async def test_a_branch_tells_its_agent_the_parent_conversation_and_passage_once(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    parent, thread = _root(ws, "Folds")
    _, cut, _ = _say(ws, thread, "What is a fold?", "A fold reduces a structure.", "An unrelated later remark")
    child_thread = _branch(ws, parent, cut, "reduces a structure")
    agent = FakeAgent()
    service = _service(data_dir, {agent_id: agent})

    await _run(service, account, child_thread, "Go deeper here")
    await _run(service, account, child_thread, "And then?")

    session = next(s for s in agent.sessions.values() if s and s[-1] == "And then?")
    first, second = session
    assert "Folds" in first and "What is a fold?" in first and "A fold reduces a structure." in first
    assert "reduces a structure" in first and "An unrelated later remark" not in first
    assert first.endswith("Go deeper here")
    assert second == "And then?"


async def test_a_side_thread_is_told_its_main_thread_up_to_the_anchor(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _root(ws, "Monads")
    _, cut, _ = _say(ws, thread, "Explain bind.", "Bind sequences effects.", "Later")
    graph = workspace.create_thread(ws, node, {"messageId": cut, "start": 0, "end": 17, "excerpt": "sequences effects"}, None)["graph"]
    side = next(t["id"] for t in graph["threads"] if t["anchor"] is not None)
    agent = FakeAgent()

    await _run(_service(data_dir, {agent_id: agent}), account, side, "Why?")

    [prompt] = next(s for s in agent.sessions.values() if s)
    assert "Explain bind." in prompt and "sequences effects" in prompt and "Later" not in prompt


async def test_switching_agents_in_a_branch_gives_the_new_agent_the_origin_and_the_childs_own_talk(account):
    profile_id, ws, data_dir = account
    codex, claude = _register(profile_id, "Codex"), _register(profile_id, "Claude")
    parent, thread = _root(ws, "Folds")
    [cut] = _say(ws, thread, "A fold reduces a structure.")
    child_thread = _branch(ws, parent, cut, "reduces")
    child = next(t["nodeId"] for t in workspace.bootstrap(ws)["graph"]["threads"] if t["id"] == child_thread)
    agents = {codex: FakeAgent(), claude: FakeAgent()}
    service = _service(data_dir, agents)
    await _run(service, account, child_thread, "first in child")

    workspace.set_node_backend(ws, child, claude)
    await _run(service, account, child_thread, "second in child")

    [prompt] = agents[claude].sessions["s1"]
    assert "A fold reduces a structure." in prompt, "the origin"
    assert "first in child" in prompt, "the child's own conversation"
    assert prompt.index("A fold reduces") < prompt.index("first in child") < prompt.rindex("second in child")


async def test_a_root_session_gets_no_origin(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _root(ws, "Alone")
    agent = FakeAgent()

    await _run(_service(data_dir, {agent_id: agent}), account, thread, "hello")

    assert agent.sessions["s1"] == ["hello"]


async def test_a_command_in_a_branch_keeps_the_origin_outside_what_the_learner_asked(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    parent, thread = _root(ws, "Folds")
    [cut] = _say(ws, thread, "A fold reduces a structure.")
    child_thread = _branch(ws, parent, cut, "reduces")
    agent = FakeAgent()
    profile, workspace_id, _ = account

    [_ async for _ in _service(data_dir, {agent_id: agent}).run_turn(profile, workspace_id, child_thread, "/quiz folds", command="quiz")]

    [prompt] = next(s for s in agent.sessions.values() if s)
    asked = prompt.index("The learner asked:")
    assert prompt.index("A fold reduces a structure.") < asked
    assert "A fold reduces" not in prompt[asked:]


async def test_a_long_parent_is_cut_and_the_agent_is_told(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    parent, thread = _root(ws, "Long")
    ids = _say(ws, thread, *[f"message {i} " + "x" * 3_000 for i in range(20)])
    child_thread = _branch(ws, parent, ids[-1], "message 19")
    agent = FakeAgent()

    await _run(_service(data_dir, {agent_id: agent}), account, child_thread, "go")

    [prompt] = next(s for s in agent.sessions.values() if s)
    assert "earlier messages were left out" in prompt
    assert "message 19" in prompt and "message 0 " not in prompt
