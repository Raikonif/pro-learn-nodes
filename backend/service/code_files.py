"""The code files in a node's working directory, listed and read for the Code tab.

Read-only, and bounded by the directory: every path is resolved — links
followed — and kept only if it lies inside the node's own directory, the same
test the permission policy uses (`service/agent/permissions.py:inside`).
`practice/` is left out because it is a projection of the practice record,
which the Code tab lists from the record itself.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlmodel import select

from core.database import database_path, session_scope
from core.exceptions import NotFoundError, ValidationError
from models.workspace import WorkspaceNodeRecord
from service.agent.permissions import inside

__all__ = ["MAX_BYTES", "NotViewable", "list_files", "read_file"]

MAX_BYTES = 1024 * 1024

# Extension -> the language the viewer colours it as; None is shown as plain text.
LANGUAGES: dict[str, str | None] = {
    "py": "python",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript", "jsx": "javascript",
    "ts": "typescript", "tsx": "typescript",
    "json": "json",
    "html": "html", "htm": "html",
    "css": "css",
    "md": "markdown",
    "txt": None, "toml": None, "yaml": None, "yml": None, "sh": None, "sql": None,
}

_SKIPPED_DIRS = {"practice"}
# Never descend into these, however many files they hold.
_IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".mypy_cache", ".pytest_cache"}
_SNIFF = 8192


class NotViewable(ValidationError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _node_dir(workspace_id: str, node_id: str) -> Path:
    from service.agent.sessions import node_directory

    with session_scope() as session:
        node = session.exec(
            select(WorkspaceNodeRecord).where(
                WorkspaceNodeRecord.id == node_id, WorkspaceNodeRecord.workspace_id == workspace_id
            )
        ).first()
        if node is None:
            raise NotFoundError("Node not found")
    return node_directory(database_path().parent, node_id)


def _language(path: Path) -> tuple[bool, str | None]:
    extension = path.suffix.lower().lstrip(".")
    return extension in LANGUAGES, LANGUAGES.get(extension)


def _unviewable(path: Path, size: int) -> str | None:
    if size > MAX_BYTES:
        return "too_large"
    with path.open("rb") as handle:
        head = handle.read(_SNIFF)
    if b"\x00" in head:
        return "not_text"
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as error:
        # A multi-byte character cut by the sniff window is still text.
        if error.start < len(head) - 4:
            return "not_text"
    return None


def list_files(workspace_id: str, node_id: str) -> dict[str, Any]:
    root = _node_dir(workspace_id, node_id)
    if not root.is_dir():
        return {"files": []}
    files: list[dict[str, Any]] = []
    stack = [root]
    while stack:
        folder = stack.pop()
        try:
            entries = sorted(folder.iterdir())
        except OSError:
            continue
        for entry in entries:
            if not inside(str(entry), root):
                continue  # A link that leaves the node's directory.
            relative = entry.relative_to(root)
            if entry.is_dir():
                if entry.name in _IGNORED_DIRS or (folder == root and entry.name in _SKIPPED_DIRS):
                    continue
                stack.append(entry)
                continue
            recognised, language = _language(entry)
            if not recognised or not entry.is_file():
                continue
            try:
                size = entry.stat().st_size
                reason = _unviewable(entry, size)
            except OSError:
                continue
            files.append({
                "path": relative.as_posix(),
                "size": size,
                "language": language,
                "viewable": reason is None,
                "reason": reason,
            })
    files.sort(key=lambda f: f["path"])
    return {"files": files}


def read_file(workspace_id: str, node_id: str, path: str) -> dict[str, Any]:
    root = _node_dir(workspace_id, node_id)
    target = root / path
    relative = Path(path)
    if (
        not path
        or relative.is_absolute()
        or not inside(str(target), root)
        or (relative.parts and relative.parts[0] in _SKIPPED_DIRS)
    ):
        raise NotFoundError("File not found")
    recognised, language = _language(target)
    if not recognised or not target.is_file():
        raise NotFoundError("File not found")
    reason = _unviewable(target, target.stat().st_size)
    if reason is not None:
        raise NotViewable(reason)
    return {
        "path": relative.as_posix(),
        "language": language,
        "content": target.read_text(encoding="utf-8", errors="replace"),
    }
