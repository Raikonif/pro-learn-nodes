"""Registering agents and testing them.

Every route is scoped by the active account. An agent of another account is
answered exactly as one that does not exist — 404 either way.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from api.dependencies.agents import LauncherDep
from api.dependencies.auth import ActiveProfile
from api.dependencies.runtime import RuntimeDep
from core.exceptions import NotFoundError
from service.agent import registry

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1)
    command: str = Field(min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


@router.get("")
async def list_agents(_runtime: RuntimeDep, profile: ActiveProfile) -> dict[str, Any]:
    return registry.list_agents(profile.id)


@router.post("")
async def register_agent(
    payload: AgentInput, _runtime: RuntimeDep, profile: ActiveProfile, launch: LauncherDep
) -> dict[str, Any]:
    try:
        return await registry.register(
            profile.id,
            name=payload.name,
            command=payload.command,
            args=payload.args,
            env=payload.env,
            launch=launch,
        )
    except registry.RegistrationRefused as refused:
        raise HTTPException(
            status_code=422, detail={"stage": refused.stage, "message": refused.message}
        )


@router.delete("/{agent_id}", status_code=204)
async def remove_agent(agent_id: str, _runtime: RuntimeDep, profile: ActiveProfile) -> Response:
    try:
        registry.remove(profile.id, agent_id)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return Response(status_code=204)


@router.put("/{agent_id}/default")
async def make_default(
    agent_id: str, _runtime: RuntimeDep, profile: ActiveProfile
) -> dict[str, Any]:
    try:
        return registry.set_default(profile.id, agent_id)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.post("/{agent_id}/test")
async def test_agent(
    agent_id: str, _runtime: RuntimeDep, profile: ActiveProfile, launch: LauncherDep
) -> dict[str, Any]:
    try:
        return await registry.test_registered(profile.id, agent_id, launch)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
