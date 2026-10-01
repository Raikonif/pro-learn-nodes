"""Application lifecycle state for local data availability."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator

from fastapi import FastAPI

if TYPE_CHECKING:
    from service.context_server.app import ContextServer

from core.config import settings
from core.database import configure_database, database_path
from core.migrations import migrate_database
from service.agent.supervisor import AgentSupervisor
from service.retrieval import resume_unfinished_indexing
from service.workspace import validate_workspace_data

logger = logging.getLogger(__name__)


class DataState(StrEnum):
    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


@dataclass
class RuntimeState:
    data_state: DataState = DataState.PENDING
    error: str | None = None
    indexing_task: asyncio.Task[None] | None = None
    # Every agent process the backend starts, so shutdown can stop them all.
    agents: AgentSupervisor | None = None
    context: "ContextServer | None" = None

    @property
    def ready(self) -> bool:
        return self.data_state is DataState.READY


def initialize_local_data(data_dir: Path) -> None:
    """Migrate and validate whatever local data already exists."""

    configure_database(data_dir)
    migrate_database(database_path())
    # No workspace is provisioned here. Startup runs before anyone signs in,
    # so there is no account to own one, and `workspaces.profile_id` is not
    # nullable. Provisioning happens on first activation of a profile
    # instead — see `service/profile_service.py:activate`.
    validate_workspace_data()


@asynccontextmanager
async def local_data_lifespan(app: FastAPI) -> AsyncIterator[None]:
    runtime: RuntimeState = app.state.runtime

    # Announced before any data work so it is the first thing in the log of a
    # build that should never have had the gate open. It lives here rather
    # than in `main.py`, which is limited to app construction, middleware, and
    # router mounting — and here it fires once per process start rather than
    # once per import.
    if settings.dev_auth_enabled:
        logger.warning(
            "Development sign-in is enabled: any request can enrol and "
            "activate an account without credentials. Unset "
            "LEARN_NODES_DEV_AUTH outside development."
        )

    # Agents do not depend on the database, so they are supervised even when
    # local data fails to initialise. Reaping first means a `--reload` that
    # killed the previous worker without unwinding does not accumulate them.
    runtime.agents = AgentSupervisor(app.state.data_dir)
    try:
        reaped = await runtime.agents.reap_stale()
    except Exception:  # Never let housekeeping block startup.
        logger.exception("Could not reap agent processes left by a previous run")
    else:
        if reaped:
            logger.warning("Stopped %d agent process group(s) left by a previous run", reaped)

    try:
        await asyncio.to_thread(initialize_local_data, app.state.data_dir)
    except Exception as error:  # Keep liveness available for diagnostics.
        runtime.data_state = DataState.FAILED
        runtime.error = f"{type(error).__name__}: {error}"
    else:
        runtime.data_state = DataState.READY
        runtime.indexing_task = asyncio.create_task(
            asyncio.to_thread(resume_unfinished_indexing),
            name="learn-nodes-local-indexing",
        )
        # The context server reads local data, so it starts once data is
        # ready. A failure here is logged, not fatal: an agent session without
        # it still runs the conversation.
        if getattr(app.state, "context_server_enabled", True):
            from service.context_server.app import ContextServer

            context = ContextServer()
            try:
                await context.start()
            except Exception:
                logger.exception("The context server could not start; agents will run without it")
            else:
                runtime.context = context

    try:
        yield
    finally:
        if runtime.indexing_task is not None:
            runtime.indexing_task.cancel()
        if runtime.context is not None:
            await runtime.context.stop()
        if runtime.agents is not None:
            await runtime.agents.close_all()
