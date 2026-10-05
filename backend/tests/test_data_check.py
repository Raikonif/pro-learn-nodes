"""Whether the data folder is usable, checked before anything writes to it."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

import core.runtime as runtime_module
from core.data_check import DataStatus, DataUnusable, check_data
from core.runtime import initialize_local_data
from main import create_app


def _healthy_database(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    database = folder / "workspace.sqlite3"
    connection = sqlite3.connect(database)
    connection.execute("CREATE TABLE t (x)")
    connection.execute("INSERT INTO t VALUES (1)")
    connection.commit()
    connection.close()
    return database


def _damaged_database(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    database = folder / "workspace.sqlite3"
    database.write_bytes(b"this is not a database" * 100)
    return database


# --- check_data ----------------------------------------------------------------


def test_a_first_start_folder_is_ok_and_not_created(tmp_path):
    folder = tmp_path / "fresh"

    assert check_data(folder, require_existing=False).status is DataStatus.OK
    assert not folder.exists()


def test_a_chosen_folder_that_is_gone_is_missing(tmp_path):
    report = check_data(tmp_path / "unplugged", require_existing=True)

    assert report.status is DataStatus.MISSING
    assert "unplugged" in report.detail


def test_a_folder_without_a_database_yet_is_ok(tmp_path):
    (tmp_path / "agent-workspaces").mkdir()

    assert check_data(tmp_path, require_existing=True).status is DataStatus.OK


def test_a_healthy_database_is_ok(tmp_path):
    _healthy_database(tmp_path)

    assert check_data(tmp_path, require_existing=True).status is DataStatus.OK


def test_a_file_that_is_not_a_database_is_damaged(tmp_path):
    _damaged_database(tmp_path)

    report = check_data(tmp_path, require_existing=True)

    assert report.status is DataStatus.DAMAGED
    assert "cannot be opened" in report.detail or "integrity" in report.detail


def test_a_file_where_the_folder_should_be_is_damaged(tmp_path):
    target = tmp_path / "data"
    target.write_text("not a folder")

    assert check_data(target, require_existing=True).status is DataStatus.DAMAGED


# --- initialize_local_data -------------------------------------------------------


def test_a_damaged_database_is_not_backed_up_or_migrated(tmp_path):
    database = _damaged_database(tmp_path)
    before = database.read_bytes()

    with pytest.raises(DataUnusable) as raised:
        initialize_local_data(tmp_path, require_existing=True)

    assert raised.value.report.status is DataStatus.DAMAGED
    # The damage must never become the newest "good" copy in backups/.
    assert not (tmp_path / "backups").exists()
    assert database.read_bytes() == before


def test_a_missing_chosen_folder_is_not_created(tmp_path):
    folder = tmp_path / "unplugged"

    with pytest.raises(DataUnusable) as raised:
        initialize_local_data(folder, require_existing=True)

    assert raised.value.report.status is DataStatus.MISSING
    assert not folder.exists()


# --- /ready ---------------------------------------------------------------------


async def _ready(data_dir: Path) -> tuple[int, dict]:
    app = create_app(data_dir)
    app.state.context_server_enabled = False
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/ready")
    return response.status_code, response.json()


async def test_ready_reports_usable_data(tmp_path):
    status, body = await _ready(tmp_path)

    assert status == 200
    assert body == {"status": "ready", "backend": "fastapi", "data": {"status": "ok", "detail": None}}


async def test_ready_reports_a_damaged_database(tmp_path):
    _damaged_database(tmp_path)

    status, body = await _ready(tmp_path)

    assert status == 503
    assert body["detail"]["data"]["status"] == "damaged"
    assert body["detail"]["message"]


async def test_ready_reports_a_missing_chosen_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(
        runtime_module, "settings", runtime_module.settings.model_copy(update={"require_existing_data": True})
    )
    folder = tmp_path / "unplugged"

    status, body = await _ready(folder)

    assert status == 503
    assert body["detail"]["data"]["status"] == "missing"
    assert not folder.exists()


# --- A moved folder ---------------------------------------------------------------


def test_a_folder_copied_elsewhere_opens_with_everything_and_no_path_into_the_old_one(tmp_path):
    import shutil

    from core.database import configure_database, database_path, session_scope
    from core.migrations import migrate_database
    from core.secrets import InMemorySecretStore
    from repository import permission_repo
    from service import practice_service, workspace
    from service.agent.sessions import node_directory
    from service.identity.protocol import Identity
    from service.profile_service import ProfileService

    old, new = tmp_path / "old-place", tmp_path / "new-place"
    configure_database(old)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(Identity(provider="dev", subject="ada", display_name="Ada"))
    ws = workspace.ensure_default_workspace(profile.id).id
    node = workspace.create_root_node(ws, "Loops")["graph"]["nodes"][-1]["id"]
    exercise = practice_service.author_item(ws, node, {"kind": "code_exercise", "prompt": "Print 1 to 3"})["id"]
    practice_service.save_sandbox(ws, node, "for i in range(1, 4):\n    print(i)\n", exercise)
    with session_scope() as session:
        permission_repo.remember(session, ws, node, "agent-1", "edit", True)
    (node_directory(old, node) / "loops.py").write_text("print('mine')\n")

    shutil.copytree(old, new, symlinks=True)
    shutil.rmtree(old)
    configure_database(new)
    initialize_local_data(new, require_existing=True)

    assert old.as_posix().encode() not in (new / "workspace.sqlite3").read_bytes()
    assert workspace.bootstrap(ws)["graph"]["nodes"][-1]["title"] == "Loops"
    practice = practice_service.node_practice(ws, node)
    assert [item["prompt"] for item in practice["items"]] == ["Print 1 to 3"]
    assert practice_service.read_sandbox(ws, node, exercise)["code"].startswith("for i in range(1, 4)")
    with session_scope() as session:
        assert permission_repo.find(session, ws, node, "agent-1", "edit") is not None
    assert (node_directory(new, node) / "loops.py").read_text() == "print('mine')\n"


# --- The keychain item follows the data, not its path ---------------------------


class _DictStore:
    def __init__(self, shelf: dict, service: str) -> None:
        self._shelf, self._service = shelf, service

    def get(self, key):
        return self._shelf.get((self._service, key))

    def set(self, key, value):
        self._shelf[(self._service, key)] = value

    def delete(self, key):
        self._shelf.pop((self._service, key), None)


def test_a_moved_folder_keeps_its_keychain_name(tmp_path):
    import shutil

    from core.secrets import ensure_data_identity, keychain_service_for

    old, new = tmp_path / "old", tmp_path / "new"
    old.mkdir()
    ensure_data_identity(old, store_for=lambda service: _DictStore({}, service))
    before = keychain_service_for(old)

    shutil.copytree(old, new)

    assert keychain_service_for(new) == before
    assert keychain_service_for(tmp_path / "another-install") != before


def test_an_existing_folders_pointer_is_carried_to_its_new_name(tmp_path):
    from core.secrets import _legacy_service_for, ensure_data_identity, keychain_service_for

    shelf: dict = {}
    _DictStore(shelf, _legacy_service_for(tmp_path)).set("active-profile", "profile-1")

    ensure_data_identity(tmp_path, store_for=lambda service: _DictStore(shelf, service))

    assert _DictStore(shelf, keychain_service_for(tmp_path)).get("active-profile") == "profile-1"
    assert _DictStore(shelf, _legacy_service_for(tmp_path)).get("active-profile") is None


def test_an_identity_is_made_once(tmp_path):
    from core.secrets import ensure_data_identity

    first = ensure_data_identity(tmp_path, store_for=lambda service: _DictStore({}, service))

    assert ensure_data_identity(tmp_path, store_for=lambda service: _DictStore({}, service)) == first
