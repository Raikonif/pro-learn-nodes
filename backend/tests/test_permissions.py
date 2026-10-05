"""What is decided without asking, how an answer is sent, and the pending-request registry."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from core.database import configure_database, database_path, session_scope
from core.exceptions import NotFoundError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from repository import permission_repo
from service import workspace
from service.agent.contract import PermissionOption, PermissionRequest
from service.agent.permissions import (
    AlreadyDecided,
    PendingPermission,
    PermissionRegistry,
    automatic_option,
    inside,
    reply_for,
)
from service.identity.protocol import Identity
from service.profile_service import ProfileService

ONCE = (
    PermissionOption("allow", "Allow", "allow_once"),
    PermissionOption("always", "Always", "allow_always"),
    PermissionOption("reject", "Reject", "reject_once"),
)
ALWAYS_ONLY = (
    PermissionOption("always", "Always", "allow_always"),
    PermissionOption("never", "Never", "reject_always"),
)


@pytest.fixture
def account(tmp_path: Path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    workspace_id = workspace.ensure_default_workspace(profile.id).id
    node = workspace.create_root_node(workspace_id, "Node")["graph"]["nodes"][-1]["id"]
    node_dir = tmp_path / "agent-workspaces" / node
    node_dir.mkdir(parents=True)
    return workspace_id, node, node_dir


def _request(kind: str | None, locations: tuple[str, ...] = (), options=ONCE) -> PermissionRequest:
    loop = asyncio.get_event_loop_policy().get_event_loop()
    return PermissionRequest("call-1", f"{kind} something", kind, locations, options, loop.create_future())


# --- Where a location is ----------------------------------------------------


def test_a_location_inside_the_directory_is_inside(tmp_path):
    assert inside(str(tmp_path / "notes.md"), tmp_path)
    assert inside("practice/solution.py", tmp_path)


def test_dot_dot_and_absolute_paths_elsewhere_are_outside(tmp_path):
    node = tmp_path / "node"
    node.mkdir()
    assert not inside(str(node / ".." / "other" / "x"), node)
    assert not inside("../other/x", node)
    assert not inside("/etc/hosts", node)


def test_a_link_leading_out_of_the_directory_is_outside(tmp_path):
    node, elsewhere = tmp_path / "node", tmp_path / "elsewhere"
    node.mkdir()
    elsewhere.mkdir()
    (elsewhere / "secret.txt").write_text("x")
    (node / "escape").symlink_to(elsewhere)

    assert not inside(str(node / "escape" / "secret.txt"), node)


# --- The reply ----------------------------------------------------------------


def test_the_once_option_is_chosen_and_the_agent_remembers_nothing():
    assert reply_for(ONCE, True) == ("allow", False)
    assert reply_for(ONCE, False) == ("reject", False)


def test_without_a_once_option_the_always_one_is_flagged():
    assert reply_for(ALWAYS_ONLY, True) == ("always", True)
    assert reply_for(ALWAYS_ONLY, False) == ("never", True)


def test_no_option_of_the_polarity_cancels():
    assert reply_for((PermissionOption("allow", None, "allow_once"),), False) == (None, False)


# --- Automatic decisions ------------------------------------------------------


async def test_a_read_inside_the_node_is_granted(account):
    ws, node, node_dir = account
    request = _request("read", (str(node_dir / "practice" / "README.md"),))

    assert automatic_option(request, node_dir, ws, node, "agent-1") == "allow"


@pytest.mark.parametrize(
    "kind, where",
    [
        ("read", "/etc/hosts"),  # outside
        ("read", None),  # names no location
        ("edit", "inside"),  # writing is asked even inside
        ("execute", "inside"),  # execution is always asked
        (None, "inside"),  # no kind: never auto
    ],
)
async def test_everything_else_is_asked(account, kind, where):
    ws, node, node_dir = account
    locations = () if where is None else ((str(node_dir / "f") if where == "inside" else where),)

    assert automatic_option(_request(kind, locations), node_dir, ws, node, "agent-1") is None


async def test_a_read_is_asked_when_granting_it_would_make_the_agent_remember(account):
    ws, node, node_dir = account
    request = _request("read", (str(node_dir / "f"),), options=ALWAYS_ONLY)

    assert automatic_option(request, node_dir, ws, node, "agent-1") is None


async def test_a_remembered_decision_answers_for_the_same_node_agent_and_kind_only(account):
    ws, node, node_dir = account
    with session_scope() as session:
        permission_repo.remember(session, ws, node, "agent-1", "edit", False)

    assert automatic_option(_request("edit"), node_dir, ws, node, "agent-1") == "reject"
    assert automatic_option(_request("edit"), node_dir, ws, node, "agent-2") is None
    assert automatic_option(_request("execute"), node_dir, ws, node, "agent-1") is None
    assert automatic_option(_request("edit"), node_dir, ws, "other-node", "agent-1") is None


# --- The registry -------------------------------------------------------------


def _entry(request: PermissionRequest, ws: str, node: str, turn: str = "turn-1") -> PendingPermission:
    return PendingPermission(request, turn, ws, node, "thread-1", "agent-1", "Codex", "Node")


async def test_a_request_is_decided_once_and_leaves_the_pending_list(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    request = _request("edit")
    entry = registry.register(_entry(request, ws, node))

    assert [e.id for e in registry.pending(ws)] == [entry.id]
    registry.decide(ws, entry.id, allow=True, remember=False)

    assert request.decision.result() == "allow"
    assert registry.pending(ws) == []
    with pytest.raises(AlreadyDecided):
        registry.decide(ws, entry.id, allow=False, remember=False)
    assert request.decision.result() == "allow"


async def test_two_surfaces_answering_at_once_decide_it_once(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    request = _request("edit")
    entry = registry.register(_entry(request, ws, node))

    async def answer(allow: bool):
        await asyncio.sleep(0)
        return registry.decide(ws, entry.id, allow=allow, remember=False)

    results = await asyncio.gather(answer(True), answer(False), return_exceptions=True)

    assert sum(isinstance(r, AlreadyDecided) for r in results) == 1
    assert request.decision.result() == "allow"


async def test_another_accounts_request_is_unknown(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    entry = registry.register(_entry(_request("edit"), ws, node))

    assert registry.pending("other-workspace") == []
    with pytest.raises(NotFoundError):
        registry.decide("other-workspace", entry.id, allow=True, remember=False)


async def test_remembering_records_the_kind_for_this_node_and_agent(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    entry = registry.register(_entry(_request("edit"), ws, node))

    registry.decide(ws, entry.id, allow=True, remember=True)

    with session_scope() as session:
        decision = permission_repo.find(session, ws, node, "agent-1", "edit")
        assert decision is not None and decision.allow is True
    assert entry.decision == (True, True)


async def test_a_request_without_a_kind_cannot_be_remembered(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    entry = registry.register(_entry(_request(None), ws, node))

    registry.decide(ws, entry.id, allow=True, remember=True)

    assert entry.decision == (True, False)
    with session_scope() as session:
        assert permission_repo.list_for(session, ws) == []


async def test_withdrawing_a_turn_cancels_only_its_requests(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    mine, other = _request("edit"), _request("execute")
    registry.register(_entry(mine, ws, node, turn="turn-1"))
    kept = registry.register(_entry(other, ws, node, turn="turn-2"))

    registry.withdraw_turn("turn-1")

    assert mine.decision.result() is None
    assert not other.decision.done()
    assert [e.id for e in registry.pending(ws)] == [kept.id]


async def test_answering_after_the_agent_was_told_is_already_answered_not_unknown(account):
    ws, node, _ = account
    registry = PermissionRegistry()
    request = _request("edit")
    entry = registry.register(_entry(request, ws, node))
    registry.decide(ws, entry.id, allow=True, remember=False)
    registry.settle(request)

    with pytest.raises(AlreadyDecided):
        registry.decide(ws, entry.id, allow=False, remember=False)
    with pytest.raises(NotFoundError):
        registry.decide("other-workspace", entry.id, allow=False, remember=False)
