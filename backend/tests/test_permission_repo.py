"""Remembered permission decisions: one per key, and never another account's."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from repository import permission_repo
from service import workspace
from service.identity.protocol import Identity
from service.profile_service import ProfileService


@pytest.fixture
def two_accounts(tmp_path: Path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profiles = ProfileService(InMemorySecretStore())
    workspaces = []
    for subject in ("ada", "grace"):
        profile = profiles.enroll(Identity(provider="dev", subject=subject, display_name=subject))
        workspace_id = workspace.ensure_default_workspace(profile.id).id
        node = workspace.create_root_node(workspace_id, "Node")["graph"]["nodes"][-1]["id"]
        workspaces.append((workspace_id, node))
    return workspaces


def test_remembering_the_same_key_replaces_the_answer(two_accounts):
    (ws, node), _ = two_accounts
    with session_scope() as session:
        permission_repo.remember(session, ws, node, "agent-1", "edit", True)
        permission_repo.remember(session, ws, node, "agent-1", "edit", False)
    with session_scope() as session:
        decisions = permission_repo.list_for(session, ws)
        assert [(d.kind, d.allow) for d in decisions] == [("edit", False)]


def test_find_matches_only_the_exact_key(two_accounts):
    (ws, node), _ = two_accounts
    with session_scope() as session:
        permission_repo.remember(session, ws, node, "agent-1", "edit", True)
    with session_scope() as session:
        assert permission_repo.find(session, ws, node, "agent-1", "edit") is not None
        assert permission_repo.find(session, ws, node, "agent-2", "edit") is None
        assert permission_repo.find(session, ws, node, "agent-1", "execute") is None


def test_another_accounts_decision_is_invisible_and_cannot_be_revoked(two_accounts):
    (ada_ws, ada_node), (grace_ws, _) = two_accounts
    with session_scope() as session:
        decision_id = permission_repo.remember(session, ada_ws, ada_node, "agent-1", "edit", True).id
    with session_scope() as session:
        assert permission_repo.list_for(session, grace_ws) == []
        assert permission_repo.find(session, grace_ws, ada_node, "agent-1", "edit") is None
        assert permission_repo.revoke(session, grace_ws, decision_id) is False
    with session_scope() as session:
        assert permission_repo.revoke(session, ada_ws, decision_id) is True
    with session_scope() as session:
        assert permission_repo.list_for(session, ada_ws) == []
