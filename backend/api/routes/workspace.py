"""Ready-gated workspace and local retrieval API.

BREAKING: no route accepts a `workspaceId` any more. The scope arrives as
`WorkspaceScope` from `api/dependencies/auth.py`, resolved from the active
account, so a caller cannot name the data a request reaches. A `workspaceId`
still sent by an older client is inert rather than rejected — the server was
never going to honour it, and 422-ing every mutation would break a client that
is merely out of date instead of doing anything wrong.
"""

from __future__ import annotations

from typing import Any, Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies.auth import ActiveProfile, WorkspaceScope
from api.dependencies.runtime import RuntimeDep
from core.exceptions import NotFoundError, ValidationError
from core.runtime import RuntimeState
from service import projects, retrieval, workspace
from service.agent import registry as agent_registry

router = APIRouter(prefix="/workspace", tags=["workspace"])


class InputModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AnchorInput(InputModel):
    message_id: str = Field(alias="messageId")
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    excerpt: str = Field(min_length=1)


class BranchNodeInput(InputModel):
    source_node_id: str = Field(alias="sourceNodeId")
    anchor: AnchorInput
    overrides: dict[str, Any] | None = None
    # Absent: the new node joins the source node's project.
    project_id: str | None = Field(default=None, alias="projectId")


class RootNodeInput(InputModel):
    # Absent for a quick start: the session is titled from its first message.
    title: str | None = None
    mode: Literal["Deepen", "Review", "Practice", "Quiz", "Explore"] = "Explore"
    body: str = ""
    active_skills: list[str] = Field(default_factory=list, alias="activeSkills")
    mcp_servers: list[str] = Field(default_factory=list, alias="mcpServers")
    # Absent: the workspace's default project.
    project_id: str | None = Field(default=None, alias="projectId")


class ChildNodeInput(InputModel):
    parent_node_id: str = Field(alias="parentNodeId")


class ProjectInput(InputModel):
    name: str


class ProjectChangeInput(InputModel):
    name: str | None = None
    instructions: str | None = None


class NodeProjectInput(InputModel):
    project_id: str = Field(alias="projectId")


class ThreadInput(InputModel):
    node_id: str = Field(alias="nodeId")
    anchor: AnchorInput
    name: str | None = None


class MessageInput(InputModel):
    thread_id: str = Field(alias="threadId")
    role: Literal["learner", "agent"]
    content: str = Field(min_length=1)


class TitleInput(InputModel):
    title: str = Field(min_length=1)


class BackendInput(InputModel):
    agent_id: str = Field(alias="agentId")


class AgentSettingsInput(InputModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    model: str | None = None
    effort: str | None = None
    fast: str | None = None
    mode: str | None = None
    confirmed_unasked: bool = Field(default=False, alias="confirmedUnasked")


class ContextInput(InputModel):
    last_open_node_id: str | None = Field(alias="lastOpenNodeId")
    viewport: dict[str, Any] = Field(default_factory=dict)


class SourceInput(InputModel):
    title: str = Field(min_length=1)
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


def _domain_error(error: Exception) -> HTTPException:
    if isinstance(error, NotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, ValidationError):
        return HTTPException(status_code=422, detail=str(error))
    raise error


# `RuntimeDep` is declared before `WorkspaceScope` on every route below, and the
# order is load-bearing: FastAPI solves dependencies in declaration order, so a
# request that arrives before the database is open answers 503 rather than
# asking an unconfigured engine who is signed in.


@router.get("/bootstrap")
async def get_bootstrap(_runtime: RuntimeDep, workspace_id: WorkspaceScope) -> dict[str, Any]:
    try:
        return workspace.bootstrap(workspace_id)
    except Exception as error:
        raise _domain_error(error)


@router.post("/nodes/branch")
async def branch_node(
    payload: BranchNodeInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.create_branch_node(
            workspace_id,
            payload.source_node_id,
            payload.anchor.model_dump(by_alias=True),
            payload.overrides,
            payload.project_id,
        )
    except Exception as error:
        raise _domain_error(error)


@router.post("/nodes")
async def root_node(
    payload: RootNodeInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.create_root_node(
            workspace_id,
            payload.title,
            payload.mode,
            payload.body,
            payload.active_skills,
            payload.mcp_servers,
            payload.project_id,
        )
    except Exception as error:
        raise _domain_error(error)


@router.post("/nodes/child")
async def child_node(
    payload: ChildNodeInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.create_child_node(workspace_id, payload.parent_node_id)
    except Exception as error:
        raise _domain_error(error)


@router.put("/nodes/{node_id}/backend")
async def node_backend(
    node_id: str,
    payload: BackendInput,
    _runtime: RuntimeDep,
    profile: ActiveProfile,
    workspace_id: WorkspaceScope,
) -> dict[str, Any]:
    try:
        return agent_registry.set_node_backend(profile.id, workspace_id, node_id, payload.agent_id)
    except Exception as error:
        raise _domain_error(error)


@router.put("/nodes/{node_id}/agent-settings")
async def node_agent_settings(
    node_id: str,
    payload: AgentSettingsInput,
    _runtime: RuntimeDep,
    profile: ActiveProfile,
    workspace_id: WorkspaceScope,
) -> dict[str, Any]:
    # Only keys the caller sent change; a key sent as null returns that
    # control to the agent's default.
    changes = payload.model_dump(exclude_unset=True, exclude={"confirmed_unasked"})
    try:
        return agent_registry.set_node_agent_settings(
            profile.id, workspace_id, node_id, changes, confirmed_unasked=payload.confirmed_unasked
        )
    except Exception as error:
        raise _domain_error(error)


@router.put("/nodes/{node_id}/title")
async def node_title(
    node_id: str, payload: TitleInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.rename_node(workspace_id, node_id, payload.title)
    except Exception as error:
        raise _domain_error(error)


# Archive and restore, never delete: the history retires sessions without
# losing them. Deletion stays a separate, confirmed action that this router
# deliberately does not offer.
@router.post("/nodes/{node_id}/archive")
async def archive_node(node_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope) -> dict[str, Any]:
    try:
        return workspace.archive_node(workspace_id, node_id)
    except Exception as error:
        raise _domain_error(error)


@router.post("/nodes/{node_id}/restore")
async def restore_node(node_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope) -> dict[str, Any]:
    try:
        return workspace.restore_node(workspace_id, node_id)
    except Exception as error:
        raise _domain_error(error)


@router.post("/projects")
async def create_project(
    payload: ProjectInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return projects.create(workspace_id, payload.name)
    except Exception as error:
        raise _domain_error(error)


@router.get("/projects/archived")
async def archived_projects(_runtime: RuntimeDep, workspace_id: WorkspaceScope) -> dict[str, Any]:
    try:
        return projects.list_archived(workspace_id)
    except Exception as error:
        raise _domain_error(error)


@router.patch("/projects/{project_id}")
async def change_project(
    project_id: str,
    payload: ProjectChangeInput,
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
) -> dict[str, Any]:
    try:
        return projects.update(workspace_id, project_id, payload.name, payload.instructions)
    except Exception as error:
        raise _domain_error(error)


@router.post("/projects/{project_id}/archive")
async def archive_project(
    project_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return projects.archive(workspace_id, project_id)
    except Exception as error:
        raise _domain_error(error)


@router.post("/projects/{project_id}/restore")
async def restore_project(
    project_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return projects.restore(workspace_id, project_id)
    except Exception as error:
        raise _domain_error(error)


# Distinct from archiving, and the only place a project is destroyed. It never
# deletes a session: they move to the default project.
@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return projects.delete(workspace_id, project_id)
    except Exception as error:
        raise _domain_error(error)


@router.put("/nodes/{node_id}/project")
async def node_project(
    node_id: str, payload: NodeProjectInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return projects.move_node(workspace_id, node_id, payload.project_id)
    except Exception as error:
        raise _domain_error(error)


@router.get("/sessions/search")
async def search_sessions(
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
    q: str = "",
    include_archived: Annotated[bool, Query(alias="includeArchived")] = False,
) -> dict[str, Any]:
    return workspace.search_sessions(workspace_id, q, include_archived)


@router.post("/threads")
async def new_thread(
    payload: ThreadInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.create_thread(
            workspace_id,
            payload.node_id,
            payload.anchor.model_dump(by_alias=True),
            payload.name,
        )
    except Exception as error:
        raise _domain_error(error)


@router.post("/messages")
async def new_message(
    payload: MessageInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.append_message(
            workspace_id, payload.thread_id, payload.role, payload.content
        )
    except Exception as error:
        raise _domain_error(error)


@router.put("/context")
async def save_context(
    payload: ContextInput, _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return workspace.update_context(
            workspace_id, payload.last_open_node_id, payload.viewport
        )
    except Exception as error:
        raise _domain_error(error)


@router.post("/sources")
async def add_source(
    payload: SourceInput,
    background_tasks: BackgroundTasks,
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
) -> dict[str, Any]:
    try:
        source = retrieval.create_source(
            workspace_id, payload.title, payload.content, payload.metadata
        )
    except Exception as error:
        raise _domain_error(error)
    background_tasks.add_task(retrieval.index_source, source.id)
    return {"id": source.id, "status": source.index_status}


@router.get("/sources")
async def get_source_status(
    _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, Any]:
    try:
        return {"sources": retrieval.source_status(workspace_id)}
    except Exception as error:
        raise _domain_error(error)


@router.post("/retrieval/rebuild")
async def rebuild_retrieval(
    _runtime: RuntimeDep, workspace_id: WorkspaceScope
) -> dict[str, str]:
    try:
        retrieval.rebuild_workspace_index(workspace_id)
        return {"status": "completed"}
    except Exception as error:
        raise _domain_error(error)


@router.get("/retrieval")
async def retrieve(
    _runtime: RuntimeDep,
    workspace_id: WorkspaceScope,
    query: str = Query(min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    return {"results": retrieval.search(workspace_id, query, limit)}
