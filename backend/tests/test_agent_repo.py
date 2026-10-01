"""Registered agents belong to one account and are reached only through it."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlmodel import select

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from models.workspace import WorkspaceNodeRecord
from repository import agent_repo
from service import workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
def profiles(tmp_path: Path) -> tuple[str, str]:
    configure_database(tmp_path)
    migrate_database(database_path())
    service = ProfileService(InMemorySecretStore())
    ada = service.enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    grace = service.enroll(Identity(provider="dev", subject="grace", display_name="Grace"))
    return ada.id, grace.id


def _register(profile_id: str, name: str) -> str:
    with session_scope() as session:
        return agent_repo.create(
            session, profile_id=profile_id, name=name, command="codex-acp", args=[], env={}
        ).id


def test_the_first_registration_becomes_the_default(profiles):
    ada, _ = profiles
    first = _register(ada, "Codex")
    _register(ada, "Claude")

    with session_scope() as session:
        assert agent_repo.default_for(session, ada).id == first
        assert [a.name for a in agent_repo.list_for(session, ada)] == ["Codex", "Claude"]


def test_another_accounts_registrations_are_invisible(profiles):
    ada, grace = profiles
    adas = _register(ada, "Codex")

    with session_scope() as session:
        assert agent_repo.list_for(session, grace) == []
        assert agent_repo.get(session, grace, adas) is None
        assert agent_repo.default_for(session, grace) is None
        assert agent_repo.set_default(session, grace, adas) is None
        assert agent_repo.remove(session, grace, adas) is False
        assert agent_repo.get(session, ada, adas) is not None


def test_setting_a_default_moves_it(profiles):
    ada, _ = profiles
    _register(ada, "Codex")
    claude = _register(ada, "Claude")

    with session_scope() as session:
        agent_repo.set_default(session, ada, claude)
    with session_scope() as session:
        defaults = [a.id for a in agent_repo.list_for(session, ada) if a.is_default]
    assert defaults == [claude]


def test_removing_releases_nodes_and_keeps_a_default(profiles):
    ada, _ = profiles
    codex = _register(ada, "Codex")
    claude = _register(ada, "Claude")
    created = workspace.create_root_node(workspace.ensure_default_workspace(ada).id, "N")
    node_id = created["graph"]["nodes"][-1]["id"]
    with session_scope() as session:
        session.get(WorkspaceNodeRecord, node_id).backend_agent_id = codex

    with session_scope() as session:
        assert agent_repo.remove(session, ada, codex) is True

    with session_scope() as session:
        assert session.get(WorkspaceNodeRecord, node_id).backend_agent_id is None
        assert agent_repo.default_for(session, ada).id == claude
