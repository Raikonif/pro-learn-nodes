"""Data access for projects and their members.

Every lookup by id is filtered by `workspace_id`, so a project of another
account is answered exactly as one that does not exist. Like the other
repositories, each function takes the caller's `Session`; the transaction
boundary is the service's.
"""

from __future__ import annotations

from sqlalchemy import func, text
from sqlmodel import Session, select

from models.project import ProjectRecord
from models.workspace import WorkspaceNodeRecord

DEFAULT_PROJECT_NAME = "General"


def get(session: Session, workspace_id: str, project_id: str) -> ProjectRecord | None:
    return session.exec(
        select(ProjectRecord).where(
            ProjectRecord.id == project_id, ProjectRecord.workspace_id == workspace_id
        )
    ).first()


def default_for(session: Session, workspace_id: str) -> ProjectRecord:
    """The workspace's default project, created if somehow absent.

    Creation with the workspace and the migration backfill mean it is normally
    there; making absence repairable here keeps a node from ever having no
    project to belong to.
    """

    existing = session.exec(
        select(ProjectRecord).where(
            ProjectRecord.workspace_id == workspace_id, ProjectRecord.is_default == True  # noqa: E712
        )
    ).first()
    if existing is not None:
        return existing
    return create(session, workspace_id, DEFAULT_PROJECT_NAME, is_default=True)


def create(
    session: Session, workspace_id: str, name: str, *, is_default: bool = False
) -> ProjectRecord:
    project = ProjectRecord(workspace_id=workspace_id, name=name, is_default=is_default)
    session.add(project)
    session.flush()
    return project


def list_active(session: Session, workspace_id: str) -> list[ProjectRecord]:
    """Unarchived projects: the default first, then by creation."""

    return list(
        session.exec(
            select(ProjectRecord)
            .where(ProjectRecord.workspace_id == workspace_id, ProjectRecord.archived_at.is_(None))
            # `rowid` breaks a tie between projects created in the same tick.
            .order_by(ProjectRecord.is_default.desc(), ProjectRecord.created_at, text("projects.rowid"))
        ).all()
    )


def list_archived(session: Session, workspace_id: str) -> list[tuple[ProjectRecord, int]]:
    """Archived projects with how many sessions each holds, newest archive first."""

    counts = dict(
        session.exec(
            select(WorkspaceNodeRecord.project_id, func.count())
            .where(WorkspaceNodeRecord.workspace_id == workspace_id)
            .group_by(WorkspaceNodeRecord.project_id)
        ).all()
    )
    projects = session.exec(
        select(ProjectRecord)
        .where(ProjectRecord.workspace_id == workspace_id, ProjectRecord.archived_at.is_not(None))
        .order_by(ProjectRecord.archived_at.desc(), text("projects.rowid"))
    ).all()
    return [(p, counts.get(p.id, 0)) for p in projects]


def members(session: Session, workspace_id: str, project_id: str) -> list[WorkspaceNodeRecord]:
    """Every node whose membership is this project, archived or not."""

    return list(
        session.exec(
            select(WorkspaceNodeRecord).where(
                WorkspaceNodeRecord.workspace_id == workspace_id,
                WorkspaceNodeRecord.project_id == project_id,
            )
        ).all()
    )


def delete(session: Session, project: ProjectRecord) -> None:
    session.delete(project)
    session.flush()
