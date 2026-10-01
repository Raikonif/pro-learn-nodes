"""The learner's memory: decide proposals, edit, remove, export.

Every route is scoped by the active account. Another account's memory is
answered exactly as one that does not exist — 404 either way. Agents never
reach these routes; they propose and recall through the context server.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from api.dependencies.auth import ActiveProfile
from api.dependencies.runtime import RuntimeDep
from core.exceptions import NotFoundError, ValidationError
from service import memory_service

router = APIRouter(prefix="/memory", tags=["memory"])


class AcceptInput(BaseModel):
    text: str | None = None


class EditInput(BaseModel):
    text: str


def _http(error: NotFoundError | ValidationError) -> HTTPException:
    if isinstance(error, NotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    return HTTPException(status_code=422, detail=str(error))


@router.get("")
async def list_memory(_runtime: RuntimeDep, profile: ActiveProfile) -> dict[str, Any]:
    return memory_service.list_for_learner(profile.id)


@router.get("/export")
async def export_memory(_runtime: RuntimeDep, profile: ActiveProfile) -> Response:
    return Response(
        content=memory_service.export_markdown(profile.id),
        media_type="text/markdown; charset=utf-8",
    )


@router.post("/{memory_id}/accept")
async def accept_memory(
    memory_id: str, _runtime: RuntimeDep, profile: ActiveProfile, payload: AcceptInput | None = None
) -> dict[str, Any]:
    try:
        return memory_service.accept(profile.id, memory_id, payload.text if payload else None)
    except (NotFoundError, ValidationError) as error:
        raise _http(error)


@router.post("/{memory_id}/reject")
async def reject_memory(memory_id: str, _runtime: RuntimeDep, profile: ActiveProfile) -> dict[str, Any]:
    try:
        return memory_service.reject(profile.id, memory_id)
    except (NotFoundError, ValidationError) as error:
        raise _http(error)


@router.put("/{memory_id}")
async def edit_memory(
    memory_id: str, payload: EditInput, _runtime: RuntimeDep, profile: ActiveProfile
) -> dict[str, Any]:
    try:
        return memory_service.edit(profile.id, memory_id, payload.text)
    except (NotFoundError, ValidationError) as error:
        raise _http(error)


@router.delete("/{memory_id}", status_code=204)
async def remove_memory(memory_id: str, _runtime: RuntimeDep, profile: ActiveProfile) -> Response:
    try:
        memory_service.remove(profile.id, memory_id)
    except (NotFoundError, ValidationError) as error:
        raise _http(error)
    return Response(status_code=204)
