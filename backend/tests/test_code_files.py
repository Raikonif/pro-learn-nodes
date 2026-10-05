"""The Code tab's files: what a node's working directory holds, read-only and bounded by it."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.database import configure_database, database_path
from core.exceptions import NotFoundError
from core.migrations import migrate_database
from core.secrets import InMemorySecretStore
from service import code_files, workspace
from service.agent.sessions import node_directory
from service.identity.protocol import Identity
from service.profile_service import ProfileService
from tests.test_workspace_scoping import LEARNER, OTHER_LEARNER, scoped_client


@pytest.fixture
def node(tmp_path: Path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    ws = workspace.ensure_default_workspace(profile.id).id
    node_id = workspace.create_root_node(ws, "Loops")["graph"]["nodes"][-1]["id"]
    folder = node_directory(tmp_path, node_id)
    folder.mkdir(parents=True)
    return ws, node_id, folder


def _paths(ws: str, node_id: str) -> list[str]:
    return [f["path"] for f in code_files.list_files(ws, node_id)["files"]]


def test_a_missing_directory_lists_nothing(tmp_path):
    configure_database(tmp_path)
    migrate_database(database_path())
    profile = ProfileService(InMemorySecretStore()).enroll(
        Identity(provider="dev", subject="ada", display_name="Ada")
    )
    ws = workspace.ensure_default_workspace(profile.id).id
    node_id = workspace.create_root_node(ws, "Empty")["graph"]["nodes"][-1]["id"]

    assert code_files.list_files(ws, node_id) == {"files": []}


def test_code_files_are_listed_recursively_with_their_language(node):
    ws, node_id, folder = node
    (folder / "loops.py").write_text("for i in range(3):\n    print(i)\n")
    (folder / "web").mkdir()
    (folder / "web" / "app.ts").write_text("const x: number = 1\n")
    (folder / "notes.txt").write_text("plain")
    (folder / "image.png").write_bytes(b"\x89PNG")

    files = code_files.list_files(ws, node_id)["files"]

    assert [(f["path"], f["language"], f["viewable"]) for f in files] == [
        ("loops.py", "python", True), ("notes.txt", None, True), ("web/app.ts", "typescript", True),
    ]
    assert files[0]["size"] == len("for i in range(3):\n    print(i)\n")


def test_the_practice_mirror_and_tool_folders_are_left_out(node):
    ws, node_id, folder = node
    (folder / "practice" / "ab12-loop").mkdir(parents=True)
    (folder / "practice" / "ab12-loop" / "solution.py").write_text("print(1)")
    (folder / "node_modules" / "pkg").mkdir(parents=True)
    (folder / "node_modules" / "pkg" / "index.js").write_text("x")
    (folder / "main.py").write_text("print(2)")

    assert _paths(ws, node_id) == ["main.py"]
    with pytest.raises(NotFoundError):
        code_files.read_file(ws, node_id, "practice/ab12-loop/solution.py")


def test_a_link_leaving_the_folder_is_neither_listed_nor_read(node, tmp_path):
    ws, node_id, folder = node
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.py").write_text("TOKEN = 'x'")
    (folder / "escape").symlink_to(outside)
    (folder / "leak.py").symlink_to(outside / "secret.py")

    assert _paths(ws, node_id) == []
    for path in ("escape/secret.py", "leak.py", "../outside/secret.py", str(outside / "secret.py")):
        with pytest.raises(NotFoundError):
            code_files.read_file(ws, node_id, path)


def test_large_and_binary_files_are_listed_with_the_reason_and_not_read(node):
    ws, node_id, folder = node
    (folder / "big.txt").write_text("a" * (code_files.MAX_BYTES + 1))
    (folder / "data.json").write_bytes(b'{"a": 1}\x00\x01')

    files = {f["path"]: f for f in code_files.list_files(ws, node_id)["files"]}

    assert (files["big.txt"]["viewable"], files["big.txt"]["reason"]) == (False, "too_large")
    assert (files["data.json"]["viewable"], files["data.json"]["reason"]) == (False, "not_text")
    with pytest.raises(code_files.NotViewable) as refused:
        code_files.read_file(ws, node_id, "big.txt")
    assert refused.value.reason == "too_large"


def test_a_file_is_read_with_its_language(node):
    ws, node_id, folder = node
    (folder / "loops.py").write_text("print('hola')\n")

    assert code_files.read_file(ws, node_id, "loops.py") == {
        "path": "loops.py", "language": "python", "content": "print('hola')\n",
    }


def test_an_unknown_node_is_not_found(node):
    ws, _, _ = node
    with pytest.raises(NotFoundError):
        code_files.list_files(ws, "no-such-node")


# --- Routes -------------------------------------------------------------------


async def test_routes_list_read_and_refuse_another_accounts_node(tmp_path):
    store = InMemorySecretStore()
    async with scoped_client(tmp_path, store) as client:
        service = ProfileService(store)
        service.enroll(OTHER_LEARNER)
        graph = (await client.post("/workspace/nodes", json={"title": "Grace's"})).json()["graph"]
        graces = graph["nodes"][-1]["id"]
        node_directory(tmp_path, graces).mkdir(parents=True)
        (node_directory(tmp_path, graces) / "g.py").write_text("x = 1")

        service.enroll(LEARNER)
        graph = (await client.post("/workspace/nodes", json={"title": "Ada's"})).json()["graph"]
        adas = graph["nodes"][-1]["id"]
        folder = node_directory(tmp_path, adas)
        folder.mkdir(parents=True)
        (folder / "a.py").write_text("print(1)\n")
        (folder / "big.txt").write_text("a" * (code_files.MAX_BYTES + 1))

        listing = (await client.get(f"/workspace/nodes/{adas}/code")).json()
        read = (await client.get(f"/workspace/nodes/{adas}/code/file", params={"path": "a.py"})).json()
        too_large = await client.get(f"/workspace/nodes/{adas}/code/file", params={"path": "big.txt"})
        missing = await client.get(f"/workspace/nodes/{adas}/code/file", params={"path": "nope.py"})
        foreign_list = await client.get(f"/workspace/nodes/{graces}/code")
        foreign_read = await client.get(f"/workspace/nodes/{graces}/code/file", params={"path": "g.py"})

    assert [f["path"] for f in listing["files"]] == ["a.py", "big.txt"]
    assert read == {"path": "a.py", "language": "python", "content": "print(1)\n"}
    assert (too_large.status_code, too_large.json()["detail"]) == (422, {"reason": "too_large"})
    assert missing.status_code == 404
    assert (foreign_list.status_code, foreign_read.status_code) == (404, 404)
