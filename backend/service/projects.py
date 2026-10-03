"""Projects: grouping nodes without containing them.

A node belongs to exactly one project (`workspace_nodes.project_id`), and
that is all a project is to the graph: no link is refused, rewritten, or
severed because its ends are in different projects, and "in this project"
always means membership, never reachability.

Every operation takes the `workspace_id` the route derived from the active
account. A project that belongs to another account and one that does not
exist are refused identically.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from core.database import session_scope
from core.exceptions import NotFoundError, ValidationError
from models.project import ProjectRecord
from models.workspace import WorkspaceContextRecord, now
from repository import project_repo
from service import workspace
from service.workspace import _bump_revision, _node, _timestamp, _workspace

_DEFAULT_REASON = (
    "The default project receives sessions that have no chosen project, so it "
    "cannot be {action}. Rename it instead."
)


def _resolve(session: Session, workspace_id: str, project_id: str) -> ProjectRecord:
    project = project_repo.get(session, workspace_id, project_id)
    if project is None:
        raise NotFoundError(f"Unknown project: {project_id}")
    return project


def resolve(workspace_id: str, project_id: str) -> ProjectRecord:
    """Confirm a named project belongs to the workspace, or refuse it as unknown."""

    with session_scope() as session:
        return _resolve(session, workspace_id, project_id)


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise ValidationError("A project name cannot be empty")
    return cleaned


def create(workspace_id: str, name: str) -> dict[str, Any]:
    cleaned = _clean_name(name)
    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        project_repo.create(session, workspace_id, cleaned)
        _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def update(
    workspace_id: str, project_id: str, name: str | None = None, instructions: str | None = None
) -> dict[str, Any]:
    """Rename a project and/or set its instructions; only what is given changes.

    The default project may be renamed. Nothing about a node, message, or link
    changes: an agent hears of the edit on its next turn
    (`service/agent/sessions.py`), not here.
    """

    cleaned = _clean_name(name) if name is not None else None
    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        project = _resolve(session, workspace_id, project_id)
        if cleaned is not None:
            project.name = cleaned
        if instructions is not None:
            project.instructions = instructions
        _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def list_archived(workspace_id: str) -> dict[str, Any]:
    with session_scope() as session:
        _workspace(session, workspace_id)
        return {
            "projects": [
                {
                    "id": project.id,
                    "name": project.name,
                    "archivedAt": _timestamp(project.archived_at),
                    "nodeCount": count,
                }
                for project, count in project_repo.list_archived(session, workspace_id)
            ]
        }


def move_node(workspace_id: str, node_id: str, project_id: str) -> dict[str, Any]:
    """Change a node's membership and nothing else.

    Its content and links are untouched. Moving out of an archived project
    clears the node's "archived with its project" marker and leaves it
    archived, so it is archived on its own from then on.
    """

    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        node = _node(session, workspace_id, node_id)
        target = _resolve(session, workspace_id, project_id)
        if target.archived_at is not None:
            raise ValidationError(f"The project {target.name} is archived; restore it first")
        if node.project_id != target.id:
            node.project_id = target.id
            node.archived_with_project_id = None
            _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def archive(workspace_id: str, project_id: str) -> dict[str, Any]:
    """Archive a project and, in the same transaction, the nodes it holds.

    Only nodes not already archived are taken, and only those are marked, so
    restoring the project reverses exactly this and leaves a node that was
    archived on its own where it was.
    """

    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        project = _resolve(session, workspace_id, project_id)
        if project.is_default:
            raise ValidationError(_DEFAULT_REASON.format(action="archived"))
        if project.archived_at is None:
            stamp = now()
            project.archived_at = stamp
            taken = set()
            for node in project_repo.members(session, workspace_id, project.id):
                if node.archived_at is None:
                    node.archived_at = stamp
                    node.archived_with_project_id = project.id
                    taken.add(node.id)
            context = session.exec(
                select(WorkspaceContextRecord).where(WorkspaceContextRecord.workspace_id == workspace_id)
            ).one()
            if context.last_open_node_id in taken:
                context.last_open_node_id = None
            _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def restore(workspace_id: str, project_id: str) -> dict[str, Any]:
    """Unarchive a project and exactly the nodes it archived."""

    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        project = _resolve(session, workspace_id, project_id)
        if project.archived_at is not None:
            project.archived_at = None
            for node in project_repo.members(session, workspace_id, project.id):
                if node.archived_with_project_id == project.id:
                    node.archived_at = None
                    node.archived_with_project_id = None
            _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def delete(workspace_id: str, project_id: str) -> dict[str, Any]:
    """Remove a project; its nodes, archived or not, move to the default project.

    A node is never deleted. Its archive state is kept, but the marker is
    cleared: the project that archived it no longer exists to restore it.
    """

    with session_scope() as session:
        ws = _workspace(session, workspace_id)
        project = _resolve(session, workspace_id, project_id)
        if project.is_default:
            raise ValidationError(_DEFAULT_REASON.format(action="deleted"))
        default = project_repo.default_for(session, workspace_id)
        for node in project_repo.members(session, workspace_id, project.id):
            node.project_id = default.id
            node.archived_with_project_id = None
        session.flush()
        project_repo.delete(session, project)
        _bump_revision(ws)
    return workspace.bootstrap(workspace_id)


def node_project(workspace_id: str, node_id: str) -> dict[str, Any]:
    """The project a node belongs to, as the agent is told about it."""

    with session_scope() as session:
        node = _node(session, workspace_id, node_id)
        project = _resolve(session, workspace_id, node.project_id)
        return {"projectId": project.id, "name": project.name, "instructions": project.instructions}
