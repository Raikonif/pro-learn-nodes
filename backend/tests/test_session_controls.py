"""A session's model, effort, fast mode, and permission mode: offered, chosen, applied."""

from __future__ import annotations

import pytest

from core.database import session_scope
from core.exceptions import NotFoundError, ValidationError
from models.agent import AgentRegistrationRecord
from models.workspace import ChatMessageRecord, WorkspaceNodeRecord
from service import workspace
from service.agent import registry
from sqlmodel import select
from tests.agent_doubles import FakeAgent, offered_options
from tests.test_agent_sessions import _node, _register, _run, _service, account  # noqa: F401 — fixture


def _agent(default_mode: str = "default") -> FakeAgent:
    from service.agent.contract import AvailableCommand

    return FakeAgent(offered=offered_options(default_mode), commands=[AvailableCommand("compact", "Free context")])


def _settings(node: str) -> tuple[dict | None, dict | None]:
    with session_scope() as session:
        n = session.get(WorkspaceNodeRecord, node)
        return n.agent_settings, n.agent_state


# --- 2.2 The offer is recorded --------------------------------------------------


async def test_a_turn_records_what_the_agent_offers(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(ws)

    assert registry.agent_offer(profile_id, agent_id)["known"] is False
    await _run(_service(data_dir, {agent_id: _agent()}), account, thread, "hi")

    offer = registry.agent_offer(profile_id, agent_id)
    assert offer["known"] is True
    assert [v["value"] for v in offer["model"]["values"]] == ["fast-1", "smart-2"]
    assert {v["value"]: v["group"] for v in offer["mode"]["values"]}["bypassPermissions"] == "unasked"
    assert offer["commands"] == [{"name": "compact", "description": "Free context", "inputHint": None}]


async def test_another_accounts_offer_is_not_found(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    with pytest.raises(NotFoundError):
        registry.agent_offer("someone-else", agent_id)


# --- 3.1 Choices are applied ------------------------------------------------------


async def test_choices_are_applied_only_where_they_differ(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)
    agent = _agent()
    service = _service(data_dir, {agent_id: agent})
    await _run(service, account, thread, "learn the offer")

    registry.set_node_agent_settings(profile_id, ws, node, {"model": "smart-2", "effort": "medium"}, confirmed_unasked=False)
    events = await _run(service, account, thread, "now with choices")

    assert agent.set_calls == [("s1", "model", "smart-2")], "effort already medium: not set again"
    state = next(d for n, d in events if n == "session.state")
    assert (state["model"], state["effort"], state["mode"], state["modeGroup"]) == ("smart-2", "medium", "default", "asks")
    assert _settings(node)[1]["model"] == "smart-2"


async def test_choices_are_applied_after_a_load_too(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)
    before = _agent()
    await _run(_service(data_dir, {agent_id: before}), account, thread, "one")
    registry.set_node_agent_settings(profile_id, ws, node, {"fast": "on"}, confirmed_unasked=False)

    after = _agent()
    after.sessions = before.sessions  # a new process that loads the session
    await _run(_service(data_dir, {agent_id: after}), account, thread, "two")

    assert after.loaded == ["s1"] and ("s1", "fast", "on") in after.set_calls


async def test_no_choice_sets_nothing_and_the_application_never_picks_a_mode(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)
    agent = _agent()

    await _run(_service(data_dir, {agent_id: agent}), account, thread, "hi")

    assert agent.set_calls == []


async def test_an_agents_own_permissive_default_is_reported_as_such(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)

    events = await _run(_service(data_dir, {agent_id: _agent(default_mode="auto")}), account, thread, "hi")

    state = next(d for n, d in events if n == "session.state")
    assert (state["mode"], state["modeGroup"]) == ("auto", "unasked")


async def test_a_value_no_longer_offered_is_skipped_with_a_notice(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)
    agent = _agent()
    service = _service(data_dir, {agent_id: agent})
    await _run(service, account, thread, "learn the offer")
    with session_scope() as session:  # chosen earlier, since withdrawn by the agent
        session.get(WorkspaceNodeRecord, node).agent_settings = {"model": "retired-0"}

    await _run(service, account, thread, "go")

    assert agent.set_calls == []
    with session_scope() as session:
        notices = session.exec(select(ChatMessageRecord).where(ChatMessageRecord.kind == "settings_notice")).all()
    assert len(notices) == 1 and "retired-0" in notices[0].content


async def test_context_usage_is_streamed(account):
    from service.agent.contract import ContextUsage, TextChunk

    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    _, thread = _node(ws)
    agent = FakeAgent(script=lambda s, t: [ContextUsage(1234, 200000), TextChunk("ok")])

    events = await _run(_service(data_dir, {agent_id: agent}), account, thread, "hi")

    assert ("context.usage", {"used": 1234, "size": 200000}) in events


# --- 3.2 Choosing -------------------------------------------------------------------


async def test_choosing_validates_against_the_offer_and_guards_unasked_modes(account):
    profile_id, ws, data_dir = account
    agent_id = _register(profile_id)
    node, thread = _node(ws)
    await _run(_service(data_dir, {agent_id: _agent()}), account, thread, "learn the offer")

    with pytest.raises(ValidationError, match="not offered"):
        registry.set_node_agent_settings(profile_id, ws, node, {"model": "nope"}, confirmed_unasked=False)
    with pytest.raises(ValidationError, match="without asking"):
        registry.set_node_agent_settings(profile_id, ws, node, {"mode": "bypassPermissions"}, confirmed_unasked=False)
    with pytest.raises(ValidationError, match="without asking"):
        registry.set_node_agent_settings(profile_id, ws, node, {"mode": "weird-mode"}, confirmed_unasked=False)
    registry.set_node_agent_settings(profile_id, ws, node, {"mode": "acceptEdits"}, confirmed_unasked=False)
    registry.set_node_agent_settings(profile_id, ws, node, {"mode": "bypassPermissions"}, confirmed_unasked=True)
    assert _settings(node)[0] == {"mode": "bypassPermissions"}

    registry.set_node_agent_settings(profile_id, ws, node, {"mode": None, "model": "smart-2"}, confirmed_unasked=False)
    assert _settings(node)[0] == {"model": "smart-2"}, "null returns a control to the agent's default"


async def test_choosing_before_the_agent_was_reached_is_refused(account):
    profile_id, ws, data_dir = account
    _register(profile_id)
    node, _ = _node(ws)
    with pytest.raises(ValidationError, match="reached"):
        registry.set_node_agent_settings(profile_id, ws, node, {"model": "smart-2"}, confirmed_unasked=False)


# --- 3.3 Inheritance and switching ----------------------------------------------------


async def test_children_inherit_and_switching_agents_clears(account):
    profile_id, ws, data_dir = account
    codex = _register(profile_id, "Codex")
    claude = _register(profile_id, "Claude")
    node, thread = _node(ws)
    await _run(_service(data_dir, {codex: _agent(), claude: _agent()}), account, thread, "learn the offer")
    registry.set_node_agent_settings(profile_id, ws, node, {"model": "smart-2"}, confirmed_unasked=False)

    child = workspace.create_child_node(ws, node)["graph"]["nodes"][-1]["id"]
    assert _settings(child)[0] == {"model": "smart-2"}

    workspace.set_node_backend(ws, node, claude)
    assert _settings(node) == (None, None)
