"""Agent processes, owned: started lazily, replaced when dead, never leaked.

The backend is the parent of every agent process and inherits the orphan
hazard `scripts/backend.mjs` documents: a process that outlives its parent
holds resources nobody will release. Three mechanisms cover the three ways a
backend stops:

- **Clean shutdown.** `close_all()` runs in the lifespan's `finally` and
  terminates each agent's process group — the group, because an `npx`
  wrapper's node child is a separate process that killing the wrapper alone
  would orphan.
- **Abnormal termination**, including a `--reload` worker killed without
  unwinding. Every spawned agent is recorded in `agent-pids.json` in the local
  data dir, and `reap_stale()` at the next startup kills what a dead run left
  behind. A record is trusted only while its pid still names the process that
  was recorded (same start time) or its group still exists — a recycled pid
  belongs to someone else and is never signalled.
- **A crash mid-conversation.** A dead agent is dropped on the next `get()`
  and a fresh one started, so the learner's next turn reconnects without the
  node or thread being recreated.

One agent per key. The key is opaque here; callers use
`(profile_id, registration_id)` so two accounts never share a process.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import subprocess
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Hashable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from service.agent.acp import AcpAgent
from service.agent.acp.connection import group_exists, signal_group
from service.agent.contract import Agent, AgentCommand

logger = logging.getLogger(__name__)

__all__ = ["AgentSupervisor", "PID_FILE_NAME"]

PID_FILE_NAME = "agent-pids.json"

Launcher = Callable[[AgentCommand], Awaitable[Agent]]


@dataclass
class _Entry:
    agent: Agent
    command: AgentCommand


class AgentSupervisor:
    """Holds one live agent per key for the lifetime of the backend process."""

    def __init__(
        self,
        state_dir: Path | None,
        *,
        launch: Launcher = AcpAgent.start,
        reap_grace: float = 1.0,
    ) -> None:
        self._pid_file = state_dir / PID_FILE_NAME if state_dir is not None else None
        self._launch = launch
        self._reap_grace = reap_grace
        self._run = uuid.uuid4().hex
        self._entries: dict[Hashable, _Entry] = {}
        self._locks: dict[Hashable, asyncio.Lock] = {}
        # PID-file updates run in worker threads and are read-modify-write.
        self._file_lock = threading.Lock()

    async def get(self, key: Hashable, command: AgentCommand) -> Agent:
        """The live agent for `key`, starting one if there is none.

        A dead agent is dropped and replaced; so is one started from a
        different command (the registration was edited). Launch and
        negotiation errors propagate unchanged.
        """

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            entry = self._entries.get(key)
            if entry is not None:
                if entry.agent.alive and entry.command == command:
                    return entry.agent
                await self._stop(key)
            agent = await self._launch(command)
            self._entries[key] = _Entry(agent, command)
            pid = getattr(agent, "pid", None)
            if pid is not None:
                await asyncio.to_thread(self._record, pid)
            return agent

    async def discard(self, key: Hashable) -> None:
        """Stop and forget the agent for `key`, if any (e.g. unregistered)."""

        async with self._locks.setdefault(key, asyncio.Lock()):
            await self._stop(key)

    async def close_all(self) -> None:
        """Stop every agent this supervisor started."""

        keys = list(self._entries)
        await asyncio.gather(*(self.discard(key) for key in keys), return_exceptions=True)

    async def _stop(self, key: Hashable) -> None:
        entry = self._entries.pop(key, None)
        if entry is None:
            return
        pid = getattr(entry.agent, "pid", None)
        try:
            await entry.agent.close()
        except Exception:
            logger.exception("Stopping agent %r failed", key)
        if pid is not None:
            await asyncio.to_thread(self._forget, pid)

    # --- PID records ---------------------------------------------------

    async def reap_stale(self) -> int:
        """Kill agent groups a previous, now-dead run left behind.

        Returns how many groups were signalled. Records of a backend process
        that is still running (another app instance on the same data dir) are
        left alone.
        """

        return await asyncio.to_thread(self._reap_stale_sync)

    def _reap_stale_sync(self) -> int:
        if self._pid_file is None:
            return 0
        with self._file_lock:
            return self._reap_stale_locked()

    def _reap_stale_locked(self) -> int:
        kept: list[dict[str, Any]] = []
        stale: list[int] = []
        for record in self._read():
            if record.get("run") == self._run:
                kept.append(record)
                continue
            owner = record.get("owner")
            if isinstance(owner, int) and owner != os.getpid() and _pid_alive(owner):
                kept.append(record)
                continue
            pid = record.get("pid")
            if isinstance(pid, int) and _still_ours(pid, record.get("started")):
                stale.append(pid)
        for pgid in stale:
            logger.warning("Stopping agent process group %d left by a previous run", pgid)
            signal_group(pgid, signal.SIGTERM)
        _wait_groups_gone(stale, self._reap_grace)
        for pgid in stale:
            if group_exists(pgid):
                signal_group(pgid, signal.SIGKILL)
        self._write(kept)
        return len(stale)

    def _record(self, pid: int) -> None:
        if self._pid_file is None:
            return
        record = {"pid": pid, "started": _start_time(pid), "run": self._run, "owner": os.getpid()}
        with self._file_lock:
            records = [r for r in self._read() if r.get("pid") != pid]
            self._write([*records, record])

    def _forget(self, pid: int) -> None:
        if self._pid_file is None:
            return
        with self._file_lock:
            self._write([r for r in self._read() if r.get("pid") != pid])

    def _read(self) -> list[dict[str, Any]]:
        assert self._pid_file is not None
        try:
            records = json.loads(self._pid_file.read_text())
        except (OSError, ValueError):
            return []
        if not isinstance(records, list):
            return []
        return [r for r in records if isinstance(r, dict)]

    def _write(self, records: list[dict[str, Any]]) -> None:
        assert self._pid_file is not None
        self._pid_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._pid_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(records))
        temporary.replace(self._pid_file)


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _start_time(pid: int) -> str | None:
    """The process's start time as `ps` prints it — an identity a reused pid lacks."""

    with contextlib.suppress(OSError, subprocess.SubprocessError):
        output = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        return output or None
    return None


def _still_ours(pgid: int, started: object) -> bool:
    """Whether the recorded group is still the one this backend started.

    The leader alive with the recorded start time: ours. The leader gone but
    its group still populated: ours too, because a pid cannot be reused as a
    group id while that group has members — which is exactly the orphaned
    `npx` child this exists to catch. The leader alive with a different start
    time: a recycled pid, not ours.
    """

    if _pid_alive(pgid):
        return started is not None and _start_time(pgid) == started
    return group_exists(pgid)


def _wait_groups_gone(pgids: list[int], grace: float) -> None:
    deadline = time.monotonic() + grace
    while pgids and time.monotonic() < deadline:
        if not any(group_exists(pgid) for pgid in pgids):
            return
        time.sleep(0.02)
