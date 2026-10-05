"""An in-memory `Agent` for service tests.

The subprocess-level fake (`tests/fixtures/fake_acp_agent.py`) proves the ACP
client; this one proves the rules above it — registration, session mapping,
turn recording — without a process, so those tests stay fast and say exactly
which rule failed.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path

from service.agent.contract import (
    AgentCommand,
    AgentInfo,
    AgentLaunchError,
    AgentNotAuthenticated,
    Negotiation,
    PermissionAnswered,
    PermissionOption,
    PermissionRequest,
    SessionLoadFailed,
    TextChunk,
    TurnEnded,
    TurnEvent,
)


@dataclass(eq=False)
class FakeAgent:
    load_supported: bool = True
    authenticated: bool = True
    script: Callable[[str, str], list[TurnEvent]] | None = None
    sessions: dict[str, list[str]] = field(default_factory=dict)
    cwds: dict[str, Path] = field(default_factory=dict)
    loaded: list[str] = field(default_factory=list)
    closed: bool = False
    cancelled: list[str] = field(default_factory=list)
    gate: asyncio.Event | None = None
    mcp: dict[str, list] = field(default_factory=dict)
    # Session controls: the options a new session reports, values set, commands.
    offered: list = field(default_factory=list)
    commands: list = field(default_factory=list)
    settings: dict[str, dict[str, str]] = field(default_factory=dict)
    set_calls: list = field(default_factory=list)
    mcp_loads: dict[str, list] = field(default_factory=dict)
    # Permission requests asked, and the option each was answered with.
    answers: list = field(default_factory=list)

    @property
    def negotiation(self) -> Negotiation:
        return Negotiation(
            protocol_version=1,
            info=AgentInfo(name="fake-agent", title="Fake", version="1.0"),
            load_session=self.load_supported,
        )

    @property
    def alive(self) -> bool:
        return not self.closed

    async def new_session(self, cwd: Path, mcp_servers=()) -> str:
        if not self.authenticated:
            raise AgentNotAuthenticated("Authentication required")
        session_id = f"s{len(self.sessions) + 1}"
        self.sessions[session_id] = []
        self.cwds[session_id] = cwd
        self.mcp[session_id] = list(mcp_servers)
        return session_id

    async def load_session(self, session_id: str, cwd: Path, mcp_servers=()) -> None:
        if not self.load_supported or session_id not in self.sessions:
            raise SessionLoadFailed(f"unknown session {session_id}")
        self.loaded.append(session_id)
        self.mcp_loads[session_id] = list(mcp_servers)

    async def prompt(self, session_id: str, text: str) -> AsyncIterator[TurnEvent]:
        self.sessions[session_id].append(text)
        events = self.script(session_id, text) if self.script else [TextChunk("pong")]
        for event in events:
            if self.gate is not None:
                await self.gate.wait()
            if session_id in self.cancelled:
                yield TurnEnded("cancelled")
                return
            if isinstance(event, PermissionRequest):
                # Like the ACP client: waiting before the request is seen, so a
                # cancel that follows it always finds it.
                self._waiting.setdefault(session_id, []).append(event.decision)
            yield event
            if isinstance(event, PermissionRequest):
                option_id = await event.decision
                self.answers.append((event.title, option_id))
                yield PermissionAnswered(event, option_id)
        yield TurnEnded("completed")

    def config_options(self, session_id: str) -> list:
        from service.agent.contract import ConfigOption

        current = self.settings.get(session_id, {})
        return [ConfigOption(o.id, o.name, o.category, current.get(o.id, o.current), o.values) for o in self.offered]

    def available_commands(self, session_id: str) -> list:
        return list(self.commands)

    async def set_config_option(self, session_id: str, option_id: str, value: str) -> list:
        self.set_calls.append((session_id, option_id, value))
        self.settings.setdefault(session_id, {})[option_id] = value
        return self.config_options(session_id)

    async def cancel(self, session_id: str) -> None:
        self.cancelled.append(session_id)
        for decision in self._waiting.pop(session_id, []):
            if not decision.done():
                decision.set_result(None)
        if self.gate is not None:
            self.gate.set()

    async def close(self) -> None:
        self.closed = True

    @property
    def _waiting(self) -> dict[str, list]:
        waiting = self.__dict__.setdefault("_waiting_decisions", {})
        return waiting


ONCE_OPTIONS = (
    PermissionOption("allow", "Allow", "allow_once"),
    PermissionOption("always", "Always allow", "allow_always"),
    PermissionOption("reject", "Reject", "reject_once"),
)


def asks(kind: str | None, title: str, locations: tuple[str, ...] = (), options=ONCE_OPTIONS) -> PermissionRequest:
    """A permission request, made inside a running turn (for `FakeAgent.script`)."""

    return PermissionRequest(
        "call-perm", title, kind, locations, options, asyncio.get_running_loop().create_future()
    )


def launcher_for(agent: FakeAgent | None = None, *, fail: bool = False):
    launched: list[AgentCommand] = []

    async def launch(command: AgentCommand) -> FakeAgent:
        launched.append(command)
        if fail:
            raise AgentLaunchError(f"No such file or directory: {command.command!r}")
        return agent or FakeAgent()

    launch.launched = launched  # type: ignore[attr-defined]
    return launch


def offered_options(default_mode: str = "default"):
    """Options shaped like both measured agents': model, effort, mode, fast."""

    from service.agent.contract import ConfigOption, ConfigValue

    def option(oid, category, current, values):
        return ConfigOption(oid, oid.title(), category, current, tuple(ConfigValue(v, v.title()) for v in values))

    return [
        option("model", "model", "fast-1", ["fast-1", "smart-2"]),
        option("effort", "thought_level", "medium", ["low", "medium", "high"]),
        option("mode", "mode", default_mode, ["default", "acceptEdits", "bypassPermissions", "weird-mode"]),
        option("fast", "model_config", "off", ["off", "on"]),
    ]
