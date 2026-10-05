"""`AcpAgent`: the `Agent` contract, spoken over ACP.

This is where protocol meaning lives; `connection.py` below it knows only
JSON-RPC and processes. Three rules from the change design shape it:

- **Updates belong to a turn or to nobody.** A `session/update` is delivered
  only while a `prompt` for its session is running. Everything else —
  notably the history an agent replays during `session/load` — is dropped,
  because the application's transcript already holds it.
- **Permission is always answered.** A request inside a turn becomes a
  `PermissionRequest` for whoever runs the turn, and the agent is answered
  with what they decide — while the connection keeps reading, and with the
  idle timeout suspended, because a learner thinking is not a hung agent.
  The turn ending first answers it `cancelled`. A request outside any turn
  has nobody to ask and is refused at once.
- **A turn never raises.** Process exit, a silent agent, or a protocol error
  mid-turn all become `TurnEnded("failed", reason)` after whatever was already
  yielded. A hung agent is also marked dead so the supervisor replaces it
  rather than handing it the next turn.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from service.agent.acp import wire
from service.agent.acp.connection import AcpConnection, Deferred, RpcError
from service.agent.contract import (
    AgentError,
    AvailableCommand,
    ConfigOption,
    ConfigValue,
    ContextUsage,
    McpServer,
    AgentCommand,
    AgentError,
    AgentExited,
    AgentInfo,
    AgentLaunchError,
    AgentNegotiationError,
    AgentNotAuthenticated,
    AgentTimeout,
    AuthMethod,
    Negotiation,
    PermissionAnswered,
    PermissionOption,
    PermissionRequest,
    PlanEntry,
    PlanUpdate,
    SessionLoadFailed,
    TextChunk,
    ThoughtChunk,
    ToolActivity,
    TurnEnded,
    TurnEvent,
    Usage,
)

logger = logging.getLogger(__name__)

__all__ = ["AcpAgent", "SessionOpenFailed"]

# Negotiation and session requests: generous, because `npx -y` may download
# the adapter on first launch.
DEFAULT_REQUEST_TIMEOUT = 120.0
# The longest a turn may go without *any* message from the agent. A tool call
# can run a long time; an agent that says nothing for five minutes is hung.
DEFAULT_IDLE_TIMEOUT = 300.0
DEFAULT_KILL_GRACE = 2.0

_DONE = object()


class SessionOpenFailed(AgentError):
    """`session/new` failed for a reason other than authentication."""

    stage = "session"


class AcpAgent:
    """One negotiated ACP agent process. Create with `await AcpAgent.start(...)`."""

    def __init__(
        self,
        *,
        request_timeout: float,
        idle_timeout: float,
        kill_grace: float,
    ) -> None:
        self._connection: AcpConnection | None = None
        self._negotiation: Negotiation | None = None
        self._turns: dict[str, asyncio.Queue[Any]] = {}
        # Per session, kept whether or not a turn is running: commands are
        # announced right after `session/new`, before any prompt.
        self._options: dict[str, list[ConfigOption]] = {}
        self._commands: dict[str, list[AvailableCommand]] = {}
        # Permission requests each session's running turn is waiting on.
        self._waiting: dict[str, set[asyncio.Future[str | None]]] = {}
        self._request_timeout = request_timeout
        self._idle_timeout = idle_timeout
        self._kill_grace = kill_grace
        self._closing: asyncio.Task[None] | None = None

    @classmethod
    async def start(
        cls,
        command: AgentCommand,
        *,
        request_timeout: float = DEFAULT_REQUEST_TIMEOUT,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
        kill_grace: float = DEFAULT_KILL_GRACE,
    ) -> AcpAgent:
        """Launch `command` and negotiate.

        Raises `AgentLaunchError` when the process cannot start or exits
        before answering, and `AgentNegotiationError` when it answers
        `initialize` with an error, garbage, an unsupported protocol version,
        or not at all.
        """

        agent = cls(request_timeout=request_timeout, idle_timeout=idle_timeout, kill_grace=kill_grace)
        agent._connection = await AcpConnection.spawn(
            [command.command, *command.args],
            env=dict(command.env),
            on_notification=agent._on_notification,
            on_request=agent._on_request,
        )
        try:
            agent._negotiation = await agent._initialize()
        except BaseException:
            await agent.close()
            raise
        return agent

    async def _initialize(self) -> Negotiation:
        connection = self._require_connection()
        try:
            raw = await connection.request(
                "initialize", wire.InitializeParams().dump(), timeout=self._request_timeout
            )
        except AgentExited as error:
            raise AgentLaunchError(f"The agent exited before negotiating: {error}") from error
        except AgentTimeout as error:
            raise AgentNegotiationError(f"The agent did not answer initialize: {error}") from error
        except RpcError as error:
            raise AgentNegotiationError(f"The agent refused initialize: {error.message}") from error
        try:
            result = wire.InitializeResult.model_validate(raw)
        except ValidationError as error:
            raise AgentNegotiationError(f"The agent's initialize answer is malformed: {error}") from error
        if result.protocol_version != wire.PROTOCOL_VERSION:
            raise AgentNegotiationError(
                f"The agent speaks ACP protocol version {result.protocol_version}; "
                f"this application speaks {wire.PROTOCOL_VERSION}."
            )
        info = result.agent_info
        return Negotiation(
            protocol_version=result.protocol_version,
            info=AgentInfo(name=info.name, title=info.title, version=info.version)
            if info is not None
            else AgentInfo(name="unknown"),
            load_session=result.agent_capabilities.load_session,
            auth_methods=tuple(
                AuthMethod(id=method.id, name=method.name, description=method.description)
                for method in result.auth_methods
            ),
            capabilities=result.agent_capabilities.model_dump(by_alias=True),
        )

    # --- contract: state -----------------------------------------------

    @property
    def negotiation(self) -> Negotiation:
        assert self._negotiation is not None, "AcpAgent is created by start()"
        return self._negotiation

    @property
    def alive(self) -> bool:
        return self._connection is not None and self._connection.alive

    @property
    def pid(self) -> int | None:
        """The agent's pid, which is also its process group id."""

        return self._connection.pid if self._connection is not None else None

    def _require_connection(self) -> AcpConnection:
        assert self._connection is not None
        return self._connection

    # --- contract: sessions --------------------------------------------

    async def new_session(self, cwd: Path, mcp_servers: Sequence[McpServer] = ()) -> str:
        params = wire.NewSessionParams(cwd=str(cwd), mcp_servers=_acp_servers(mcp_servers)).dump()
        try:
            raw = await self._require_connection().request(
                "session/new", params, timeout=self._request_timeout
            )
        except RpcError as error:
            if _is_auth_error(error):
                raise AgentNotAuthenticated(
                    f"The agent is not signed in: {error.message}", self.negotiation.auth_methods
                ) from error
            raise SessionOpenFailed(f"The agent could not open a session: {error.message}") from error
        try:
            session_id = wire.NewSessionResult.model_validate(raw).session_id
            self._remember_options(session_id, raw)
            return session_id
        except ValidationError as error:
            raise SessionOpenFailed(f"The agent's session/new answer is malformed: {error}") from error

    async def load_session(
        self, session_id: str, cwd: Path, mcp_servers: Sequence[McpServer] = ()
    ) -> None:
        if not self.negotiation.load_session:
            raise SessionLoadFailed("The agent does not support loading sessions.")
        params = wire.LoadSessionParams(
            session_id=session_id, cwd=str(cwd), mcp_servers=_acp_servers(mcp_servers)
        ).dump()
        # No turn is registered for `session_id`, so the history the agent
        # replays while loading falls through `_on_notification` unrecorded.
        try:
            loaded = await self._require_connection().request(
                "session/load", params, timeout=self._request_timeout
            )
            self._remember_options(session_id, loaded)
        except RpcError as error:
            if _is_auth_error(error):
                raise AgentNotAuthenticated(
                    f"The agent is not signed in: {error.message}", self.negotiation.auth_methods
                ) from error
            raise SessionLoadFailed(f"The agent could not load the session: {error.message}") from error
        except (AgentExited, AgentTimeout) as error:
            raise SessionLoadFailed(str(error)) from error

    # --- contract: turns -----------------------------------------------

    async def prompt(self, session_id: str, text: str) -> AsyncIterator[TurnEvent]:
        if session_id in self._turns:
            yield TurnEnded("failed", "A turn is already running in this session.")
            return

        connection = self._require_connection()
        queue: asyncio.Queue[Any] = asyncio.Queue()
        self._turns[session_id] = queue
        params = wire.PromptParams(
            session_id=session_id, prompt=[wire.TextContent(text=text)]
        ).dump()
        request = asyncio.create_task(connection.request("session/prompt", params, timeout=None))
        request.add_done_callback(lambda _: queue.put_nowait(_DONE))
        try:
            while True:
                # Silence while a request waits on the learner is the learner's.
                idle = None if self._waiting.get(session_id) else self._idle_timeout
                try:
                    async with asyncio.timeout(idle):
                        item = await queue.get()
                except TimeoutError:
                    self._abandon_hung(f"no message for {self._idle_timeout:g}s")
                    yield TurnEnded(
                        "failed",
                        f"The agent did not respond for {self._idle_timeout:g}s.",
                    )
                    return
                if item is _DONE:
                    for event in _ending(request):
                        yield event
                    return
                yield item
        finally:
            self._turns.pop(session_id, None)
            self._release(session_id)
            if not request.done():
                # Abandoned by the consumer, or timed out: stop the agent's
                # work too, so the next turn is not queued behind it.
                request.cancel()
                if connection.alive:
                    with contextlib.suppress(AgentError):
                        await connection.notify(
                            "session/cancel", wire.CancelParams(session_id=session_id).dump()
                        )

    async def cancel(self, session_id: str) -> None:
        # ACP: on cancel, every pending permission request is answered `cancelled`.
        self._release(session_id)
        connection = self._require_connection()
        if not connection.alive:
            return
        with contextlib.suppress(AgentError):
            await connection.notify("session/cancel", wire.CancelParams(session_id=session_id).dump())

    def _release(self, session_id: str) -> None:
        for decision in self._waiting.pop(session_id, set()):
            if not decision.done():
                decision.set_result(None)

    def _abandon_hung(self, reason: str) -> None:
        connection = self._require_connection()
        connection.mark_failed(f"the agent stopped responding ({reason})")
        if self._closing is None:
            self._closing = asyncio.create_task(self._close_connection())

    # --- contract: shutdown --------------------------------------------

    async def close(self) -> None:
        if self._closing is None:
            self._closing = asyncio.create_task(self._close_connection())
        await asyncio.shield(self._closing)

    async def _close_connection(self) -> None:
        if self._connection is not None:
            await self._connection.close(grace=self._kill_grace)

    # --- contract: session controls ------------------------------------

    def config_options(self, session_id: str) -> list[ConfigOption]:
        return list(self._options.get(session_id, []))

    def available_commands(self, session_id: str) -> list[AvailableCommand]:
        return list(self._commands.get(session_id, []))

    async def set_config_option(self, session_id: str, option_id: str, value: str) -> list[ConfigOption]:
        try:
            answer = await self._require_connection().request(
                "session/set_config_option",
                {"sessionId": session_id, "configId": option_id, "value": value},
                timeout=self._request_timeout,
            )
        except RpcError as error:
            raise AgentError(f"The agent could not change {option_id}: {error.message}") from error
        # The answer carries every option as it now stands (measured).
        self._remember_options(session_id, answer)
        return self.config_options(session_id)

    def _remember_options(self, session_id: str, raw: Any) -> None:
        if isinstance(raw, dict) and isinstance(raw.get("configOptions"), list):
            self._options[session_id] = _parse_options(raw["configOptions"])

    # --- agent → client ------------------------------------------------

    def _on_notification(self, method: str, params: dict[str, Any]) -> None:
        if method != "session/update":
            return
        try:
            notification = wire.SessionNotification.model_validate(params)
        except ValidationError:
            return
        update = notification.update
        kind = update.get("sessionUpdate") if isinstance(update, dict) else None
        if kind == "available_commands_update":
            self._commands[notification.session_id] = _parse_commands(update.get("availableCommands"))
            return
        if kind == "config_option_update":
            self._remember_options(notification.session_id, update)
            return
        queue = self._turns.get(notification.session_id)
        if queue is None:
            return  # Replay during load, or an update after its turn ended.
        if kind == "usage_update":
            used, size = update.get("used"), update.get("size")
            if isinstance(used, int) and isinstance(size, int):
                queue.put_nowait(ContextUsage(used, size))
            return
        event = _translate(notification.update)
        if event is not None:
            queue.put_nowait(event)

    async def _on_request(self, method: str, params: dict[str, Any]) -> Any:
        if method == "session/request_permission":
            try:
                request = wire.RequestPermissionParams.model_validate(params)
            except ValidationError:
                return wire.CANCELLED_PERMISSION
            call = request.tool_call
            title = call.title or call.kind or "an unnamed action"
            queue = self._turns.get(request.session_id)
            if queue is None:
                logger.info("Refused a permission request outside any turn: %s", title)
                return wire.CANCELLED_PERMISSION
            options = tuple(PermissionOption(o.option_id, o.name, o.kind) for o in request.options)
            asked = PermissionRequest(
                tool_call_id=call.tool_call_id,
                title=title,
                kind=call.kind,
                locations=tuple(location.path for location in call.locations),
                options=options,
                decision=asyncio.get_running_loop().create_future(),
            )
            self._waiting.setdefault(request.session_id, set()).add(asked.decision)
            queue.put_nowait(asked)
            return Deferred(self._answer(request.session_id, asked))
        # No `fs` or `terminal` capability is advertised, so a well-behaved
        # agent never asks; one that does is answered, not left pending.
        raise RpcError(wire.METHOD_NOT_FOUND, f"Method not found: {method}")


    async def _answer(self, session_id: str, asked: PermissionRequest) -> dict[str, Any]:
        """Wait for the decision, tell the turn it was made, and answer the agent."""

        try:
            option_id = await asked.decision
        finally:
            self._waiting.get(session_id, set()).discard(asked.decision)
        if option_id not in {option.option_id for option in asked.options}:
            option_id = None
        queue = self._turns.get(session_id)
        if queue is not None:
            queue.put_nowait(PermissionAnswered(asked, option_id))
        return wire.CANCELLED_PERMISSION if option_id is None else wire.selected_permission(option_id)


def _parse_options(raw: list[Any]) -> list[ConfigOption]:
    options = []
    for item in raw:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        values = tuple(
            ConfigValue(str(v.get("value")), v.get("name"), v.get("description"))
            for v in item.get("options") or []
            if isinstance(v, dict) and v.get("value") is not None
        )
        current = item.get("currentValue")
        options.append(ConfigOption(str(item["id"]), item.get("name"), item.get("category"),
                                    None if current is None else str(current), values))
    return options


def _parse_commands(raw: Any) -> list[AvailableCommand]:
    commands = []
    for item in raw or []:
        if isinstance(item, dict) and item.get("name"):
            hint = (item.get("input") or {}).get("hint") if isinstance(item.get("input"), dict) else None
            commands.append(AvailableCommand(str(item["name"]), item.get("description"), hint))
    return commands


def _is_auth_error(error: RpcError) -> bool:
    return error.code == wire.AUTH_REQUIRED or "auth" in error.message.lower()


def _translate(update: dict[str, Any]) -> TurnEvent | None:
    parsed = wire.parse_update(update)
    match parsed:
        case wire.MessageChunk(content=content) if content.text:
            return TextChunk(content.text)
        case wire.ThoughtChunkWire(content=content) if content.text:
            return ThoughtChunk(content.text)
        case wire.ToolCall():
            return ToolActivity(
                tool_call_id=parsed.tool_call_id,
                title=parsed.title,
                kind=parsed.kind,
                status=parsed.status,
            )
        case wire.Plan(entries=entries):
            return PlanUpdate(tuple(PlanEntry(e.content, e.status) for e in entries))
    return None


_STOP_REASONS: dict[str, TurnEnded] = {
    "end_turn": TurnEnded("completed"),
    "max_tokens": TurnEnded("completed", "max_tokens"),
    "max_turn_requests": TurnEnded("completed", "max_turn_requests"),
    "refusal": TurnEnded("refused"),
    "cancelled": TurnEnded("cancelled"),
}


def _ending(request: asyncio.Task[Any]) -> list[TurnEvent]:
    """The final events of a turn whose `session/prompt` request has settled."""

    if request.cancelled():
        return [TurnEnded("failed", "The turn was abandoned.")]
    error = request.exception()
    if isinstance(error, AgentExited):
        return [TurnEnded("failed", f"The agent exited mid-turn: {error}")]
    if isinstance(error, RpcError):
        return [TurnEnded("failed", f"The agent reported an error: {error.message}")]
    if error is not None:
        return [TurnEnded("failed", f"{type(error).__name__}: {error}")]
    try:
        result = wire.PromptResult.model_validate(request.result())
    except ValidationError as validation:
        return [TurnEnded("failed", f"The agent's prompt answer is malformed: {validation}")]
    events: list[TurnEvent] = []
    if result.usage is not None:
        events.append(
            Usage(
                input_tokens=result.usage.input_tokens,
                output_tokens=result.usage.output_tokens,
                total_tokens=result.usage.total_tokens,
            )
        )
    events.append(
        _STOP_REASONS.get(result.stop_reason, TurnEnded("completed", result.stop_reason))
    )
    return events


def _acp_servers(servers: Sequence[McpServer]) -> list[dict]:
    """ACP's HTTP MCP server shape, as both measured agents accept it."""

    return [
        {
            "type": "http",
            "name": server.name,
            "url": server.url,
            "headers": [{"name": name, "value": value} for name, value in server.headers],
        }
        for server in servers
    ]
