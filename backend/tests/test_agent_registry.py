"""Registering an agent tests it first, and never touches a credential."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlmodel import select

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import ChatMessageRecord, ChatThreadRecord, WorkspaceNodeRecord
from service.agent import registry
from service.agent.contract import AgentCommand
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.agent_doubles import FakeAgent, launcher_for


@pytest.fixture
def profile_id(tmp_path: Path) -> str:
    configure_database(tmp_path)
    migrate_database(database_path())
    return ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    ).id


def _conversation_rows() -> int:
    with session_scope() as session:
        return sum(
            len(session.exec(select(model)).all())
            for model in (WorkspaceNodeRecord, ChatThreadRecord, ChatMessageRecord)
        )


async def test_a_working_agent_is_tested_then_saved(profile_id):
    agent = FakeAgent()
    saved = await registry.register(
        profile_id, name="Codex", command="codex-acp", args=[], env={}, launch=launcher_for(agent)
    )

    assert saved["isDefault"] is True
    assert agent.closed, "the probe must not leave the agent running"
    assert [a["id"] for a in registry.list_agents(profile_id)["agents"]] == [saved["id"]]


async def test_a_command_that_will_not_launch_is_refused_with_the_error(profile_id):
    with pytest.raises(registry.RegistrationRefused) as refused:
        await registry.register(
            profile_id, name="Typo", command="codx", args=[], env={}, launch=launcher_for(fail=True)
        )

    assert refused.value.stage == "launch"
    assert "codx" in refused.value.message
    assert registry.list_agents(profile_id)["agents"] == []


async def test_an_unauthenticated_agent_is_saved_and_reported(profile_id):
    agent = FakeAgent(authenticated=False)
    saved = await registry.register(
        profile_id, name="Claude", command="claude-acp", args=[], env={}, launch=launcher_for(agent)
    )
    result = await registry.test_registered(profile_id, saved["id"], launcher_for(FakeAgent(authenticated=False)))

    assert result["ok"] is False
    assert result["stage"] == "authenticate"


async def test_the_connection_test_names_each_failing_stage_and_creates_nothing(profile_id):
    before = _conversation_rows()
    command = AgentCommand(command="x")

    launch = await registry.test_connection(command, launcher_for(fail=True))
    unauthenticated = await registry.test_connection(command, launcher_for(FakeAgent(authenticated=False)))
    working = await registry.test_connection(command, launcher_for(FakeAgent()))

    assert (launch["stage"], unauthenticated["stage"], working["stage"]) == ("launch", "authenticate", None)
    assert working["ok"] is True
    assert working["agent"]["name"] == "fake-agent"
    assert working["capabilities"] == {"loadSession": True}
    assert _conversation_rows() == before


def test_presets_are_commands_only():
    for preset in registry.PRESETS:
        assert set(preset) == {"key", "name", "command", "args", "loginHint"}
