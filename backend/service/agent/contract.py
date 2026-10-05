"""The contract for a session-stateful conversation backend.

An `Agent` owns its conversation: it is handed only what is new on each turn
and keeps everything before it. That is the difference from
`service/provider/contract.py:Provider`, which is handed the whole transcript
every time and keeps nothing — and it is why the two are separate contracts
rather than one with an adapter hiding the gap. See the change design,
"Two contracts, because the difference is real".

Nothing here names ACP. The ACP client in `service/agent/acp/` is the one
implementation; everything above this module asks for an `Agent` and never
learns which wire it speaks.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

__all__ = [
    "Agent",
    "AgentCommand",
    "AvailableCommand",
    "ConfigOption",
    "ConfigValue",
    "ContextUsage",
    "McpServer",
    "AgentError",
    "AgentExited",
    "AgentInfo",
    "AgentLaunchError",
    "AgentNegotiationError",
    "AgentNotAuthenticated",
    "AgentTimeout",
    "AuthMethod",
    "Negotiation",
    "PermissionAnswered",
    "PermissionOption",
    "PermissionRefused",
    "PermissionRequest",
    "PlanEntry",
    "PlanUpdate",
    "SessionLoadFailed",
    "TextChunk",
    "ThoughtChunk",
    "ToolActivity",
    "TurnEnded",
    "TurnEvent",
    "TurnOutcome",
    "Usage",
]


# --- Configuration --------------------------------------------------------


@dataclass(frozen=True)
class AgentCommand:
    """How to launch an agent: the learner's command, never a credential."""

    command: str
    args: tuple[str, ...] = ()
    env: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class McpServer:
    """An MCP server handed to an agent for one session: the context server."""

    name: str
    url: str
    headers: tuple[tuple[str, str], ...] = ()


# --- Session controls (ACP session config options and commands) ----------------


@dataclass(frozen=True)
class ConfigValue:
    value: str
    name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class ConfigOption:
    """One of an agent's session config options, as it reported it."""

    id: str
    name: str | None
    category: str | None
    current: str | None
    values: tuple[ConfigValue, ...] = ()


@dataclass(frozen=True)
class AvailableCommand:
    """A command the agent announced — its own, or the learner's installed skill."""

    name: str
    description: str | None = None
    input_hint: str | None = None


# --- Negotiation ----------------------------------------------------------


@dataclass(frozen=True)
class AgentInfo:
    name: str
    title: str | None = None
    version: str | None = None


@dataclass(frozen=True)
class AuthMethod:
    """How the agent says it can be authenticated — shown as guidance only.

    Nothing in this application acts on one. The learner authenticates through
    the agent's own mechanism (`codex login`, Claude Code's `/login`), and the
    list exists so the workspace can say which.
    """

    id: str
    name: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class Negotiation:
    """What one connection reported at `initialize`, and nothing remembered.

    Re-read on every connection: a stored result from an earlier version of
    the same agent is exactly the assumption the spec forbids.
    """

    protocol_version: int
    info: AgentInfo
    load_session: bool = False
    auth_methods: tuple[AuthMethod, ...] = ()
    capabilities: dict[str, object] = field(default_factory=dict)


# --- Turn events ----------------------------------------------------------

TurnOutcome = Literal["completed", "cancelled", "refused", "failed"]


@dataclass(frozen=True)
class TextChunk:
    text: str


@dataclass(frozen=True)
class ThoughtChunk:
    text: str


@dataclass(frozen=True)
class ToolActivity:
    """A tool the agent invoked, or a later status change to one."""

    tool_call_id: str
    title: str | None = None
    kind: str | None = None
    status: str | None = None


@dataclass(frozen=True)
class PlanEntry:
    content: str
    status: str | None = None


@dataclass(frozen=True)
class PlanUpdate:
    entries: tuple[PlanEntry, ...]


@dataclass(frozen=True)
class PermissionRefused:
    """A permission request refused because there was nobody to ask.

    Only a request that arrives outside any turn has no conversation to be
    presented in; inside a turn it is a `PermissionRequest`. Emitted so a
    refusal is still recorded where the learner can see it — "never
    silently decided".
    """

    title: str
    tool_call_id: str | None = None


@dataclass(frozen=True)
class PermissionOption:
    """One answer the agent offers: `allow_once`, `allow_always`, `reject_once`, `reject_always`."""

    option_id: str
    name: str | None = None
    kind: str | None = None


@dataclass(frozen=True, eq=False)
class PermissionRequest:
    """The agent asks to act, and waits for `decision`.

    Whoever consumes the turn must resolve `decision` exactly once: with the
    id of one of `options`, or `None` to cancel. The agent does not continue
    until it is resolved, and it is resolved with `None` when the turn ends
    first. `locations` are the paths the action names, as the agent gave them.
    """

    tool_call_id: str | None
    title: str
    kind: str | None
    locations: tuple[str, ...]
    options: tuple[PermissionOption, ...]
    decision: asyncio.Future[str | None] = field(repr=False)


@dataclass(frozen=True, eq=False)
class PermissionAnswered:
    """`request` was answered and the agent has been told; the turn goes on."""

    request: PermissionRequest
    option_id: str | None


@dataclass(frozen=True)
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    model: str | None = None


@dataclass(frozen=True)
class ContextUsage:
    """How much of the agent's context window the session is using, in tokens."""

    used: int
    size: int


@dataclass(frozen=True)
class TurnEnded:
    """Always the last event of a turn. `reason` explains any non-completion."""

    outcome: TurnOutcome
    reason: str | None = None


TurnEvent = (
    TextChunk
    | ThoughtChunk
    | ToolActivity
    | PlanUpdate
    | PermissionRequest
    | PermissionAnswered
    | PermissionRefused
    | Usage
    | ContextUsage
    | TurnEnded
)


# --- Failures -------------------------------------------------------------


class AgentError(Exception):
    """Base for every failure reaching an agent. `stage` names where it broke."""

    stage: Literal["launch", "negotiate", "authenticate", "session", "turn"] = "turn"


class AgentLaunchError(AgentError):
    stage = "launch"


class AgentNegotiationError(AgentError):
    stage = "negotiate"


class AgentNotAuthenticated(AgentError):
    stage = "authenticate"

    def __init__(self, message: str, auth_methods: tuple[AuthMethod, ...] = ()) -> None:
        super().__init__(message)
        self.auth_methods = auth_methods


class SessionLoadFailed(AgentError):
    stage = "session"


class AgentExited(AgentError):
    """The process ended. Chunks already delivered stand; the turn does not."""


class AgentTimeout(AgentError):
    """The process stopped answering without exiting."""


# --- The contract ---------------------------------------------------------


@runtime_checkable
class Agent(Protocol):
    """A connected, negotiated agent. One per (account, registration)."""

    @property
    def negotiation(self) -> Negotiation: ...

    @property
    def alive(self) -> bool: ...

    async def new_session(self, cwd: Path, mcp_servers: Sequence[McpServer] = ()) -> str:
        """Open a session rooted at `cwd`. Raises `AgentNotAuthenticated`."""

    async def load_session(
        self, session_id: str, cwd: Path, mcp_servers: Sequence[McpServer] = ()
    ) -> None:
        """Resume a session. Only valid when `negotiation.load_session`.

        The history the agent replays while loading is discarded, never
        yielded: the application's transcript already holds it.
        Raises `SessionLoadFailed`.
        """

    def prompt(self, session_id: str, text: str) -> AsyncIterator[TurnEvent]:
        """Send one turn. Always ends with exactly one `TurnEnded`.

        Never raises once iteration starts: an agent that exits or stops
        answering mid-turn ends the turn `failed`, after whatever it had
        already produced.
        """

    def config_options(self, session_id: str) -> list[ConfigOption]:
        """The session's options as last reported (empty if none were)."""

    def available_commands(self, session_id: str) -> list[AvailableCommand]:
        """The commands the agent last announced for the session."""

    async def set_config_option(self, session_id: str, option_id: str, value: str) -> list[ConfigOption]:
        """Change one option; returns every option as it now stands."""

    async def cancel(self, session_id: str) -> None:
        """Ask the agent to stop; the running `prompt` ends `cancelled`."""

    async def close(self) -> None:
        """Stop the process and everything it started."""
