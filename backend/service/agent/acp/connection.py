"""One agent subprocess and the JSON-RPC 2.0 conversation over its stdio.

The framing is newline-delimited JSON on stdin/stdout. Three streams need
attention for the lifetime of the process, and each has a failure it exists
to prevent:

- **stdout** is read by one task that correlates responses to requests by id,
  hands notifications and agent→client requests to the owner, and — on EOF —
  fails every pending request, so a dead agent never leaves a caller waiting.
- **stderr** is drained continuously to the log. An undrained pipe fills, the
  agent blocks writing its own diagnostics, and a turn hangs with no error.
  The last lines are kept, because an agent that dies at launch usually says
  why there.
- **the process group.** The agent is started in its own session, so it and
  everything it starts (an `npx` wrapper's node child, a tool's shell) share
  one group that is signalled as a unit. Killing only the direct child is how
  an `npx`-launched agent is orphaned.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
from collections import deque
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from service.agent.environment import agent_path
from service.agent.contract import AgentExited, AgentLaunchError, AgentTimeout

logger = logging.getLogger(__name__)

# Agents put whole tool outputs on one line; asyncio's 64 KiB default is too
# small for a single `tool_call_update`.
LINE_LIMIT = 16 * 1024 * 1024
STDERR_TAIL = 20

NotificationHandler = Callable[[str, dict[str, Any]], None]
RequestHandler = Callable[[str, dict[str, Any]], Awaitable[Any]]


class Deferred:
    """A handler's answer that is not ready yet: sent when `answer` completes.

    The handler still runs inline, so whatever it reports lands in stream
    order; only the reply waits — on a learner, say — while the connection
    keeps reading. `answer` returns the result or raises `RpcError`.
    """

    def __init__(self, answer: Awaitable[Any]) -> None:
        self.answer = answer


class RpcError(Exception):
    """A JSON-RPC error response, from the agent or to it."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_wire(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            error["data"] = self.data
        return error


class AcpConnection:
    """The pipes and the process group. Knows JSON-RPC, not ACP."""

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        *,
        on_notification: NotificationHandler,
        on_request: RequestHandler,
        name: str,
    ) -> None:
        self._process = process
        self._on_notification = on_notification
        self._on_request = on_request
        self._name = name
        self._next_id = 0
        self._pending: dict[int, asyncio.Future[Any]] = {}
        # Replies still being worked out (`Deferred`), held so they are not
        # collected mid-flight and can be stopped when the process ends.
        self._answering: set[asyncio.Task[None]] = set()
        self._stderr_tail: deque[str] = deque(maxlen=STDERR_TAIL)
        self._closed = False
        self._exit_reason: str | None = None
        self._reader = asyncio.create_task(self._read_stdout(), name=f"acp-stdout-{name}")
        self._stderr = asyncio.create_task(self._drain_stderr(), name=f"acp-stderr-{name}")

    @classmethod
    async def spawn(
        cls,
        argv: Sequence[str],
        *,
        env: Mapping[str, str] | None = None,
        on_notification: NotificationHandler,
        on_request: RequestHandler,
    ) -> AcpConnection:
        # The login-shell PATH, so a command the learner's terminal finds is
        # found here too; an explicit PATH in the registration still wins.
        merged_env = {**os.environ, "PATH": agent_path(), **(env or {})}
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=merged_env,
                limit=LINE_LIMIT,
                start_new_session=True,
            )
        except OSError as error:
            raise AgentLaunchError(f"Could not start {argv[0]!r}: {error.strerror or error}") from error
        name = os.path.basename(argv[0]) or "agent"
        return cls(process, on_notification=on_notification, on_request=on_request, name=name)

    # --- state ---------------------------------------------------------

    @property
    def pid(self) -> int:
        return self._process.pid

    @property
    def alive(self) -> bool:
        return not self._closed and self._process.returncode is None

    @property
    def exit_reason(self) -> str:
        """Why the connection ended, with the agent's last words if it had any."""

        reason = self._exit_reason or "the agent process exited"
        if self._process.returncode is not None and "code" not in reason:
            reason = f"{reason} (exit code {self._process.returncode})"
        if self._stderr_tail:
            reason = f"{reason}: {self._stderr_tail[-1]}"
        return reason

    @property
    def stderr_tail(self) -> list[str]:
        return list(self._stderr_tail)

    # --- outgoing ------------------------------------------------------

    async def request(self, method: str, params: dict[str, Any], *, timeout: float | None) -> Any:
        """Send a request and return its result; raise `RpcError` on an error response.

        Raises `AgentExited` if the process ends first and `AgentTimeout` if
        no response arrives within `timeout` seconds.
        """

        if not self.alive:
            raise AgentExited(self.exit_reason)
        self._next_id += 1
        request_id = self._next_id
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            async with asyncio.timeout(timeout):
                return await future
        except TimeoutError as error:
            raise AgentTimeout(f"{method} got no response within {timeout:g}s") from error
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        if not self.alive:
            raise AgentExited(self.exit_reason)
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def _send(self, message: dict[str, Any]) -> None:
        stdin = self._process.stdin
        assert stdin is not None
        try:
            stdin.write((json.dumps(message) + "\n").encode())
            await stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as error:
            raise AgentExited(self.exit_reason) from error

    # --- incoming ------------------------------------------------------

    async def _read_stdout(self) -> None:
        stdout = self._process.stdout
        assert stdout is not None
        try:
            while True:
                try:
                    line = await stdout.readline()
                except ValueError:
                    # A line over LINE_LIMIT: the framing is lost for good.
                    self._exit_reason = "the agent sent a message too large to read"
                    break
                if not line:
                    break
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug("%s: ignoring non-JSON stdout line %r", self._name, line[:200])
                    continue
                if isinstance(message, dict):
                    await self._dispatch(message)
        except asyncio.CancelledError:
            raise
        except Exception:  # A bug in a handler must not strand every caller.
            logger.exception("%s: reader failed", self._name)
            self._exit_reason = "the connection to the agent failed"
        finally:
            await self._finish()

    async def _dispatch(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method is None:
            future = self._pending.get(message.get("id"))  # type: ignore[arg-type]
            if future is None or future.done():
                return  # Late answer to a request already abandoned.
            if "error" in message:
                error = message["error"] or {}
                future.set_exception(
                    RpcError(
                        int(error.get("code", -32603)),
                        str(error.get("message", "unknown error")),
                        error.get("data"),
                    )
                )
            else:
                future.set_result(message.get("result"))
            return

        params = message.get("params") or {}
        if "id" not in message:
            self._on_notification(method, params)
            return

        # Handled inline, in stream order, so whatever the handler reports
        # lands between the updates it arrived between. A handler that must
        # wait returns `Deferred`, and only its reply is sent later: reading
        # never stops, or a dead agent or a cancel could not be noticed.
        try:
            result = await self._on_request(method, params)
        except Exception as error:
            await self._reply(message["id"], method, error)
            return
        if isinstance(result, Deferred):
            task = asyncio.create_task(self._reply_later(message["id"], method, result.answer))
            self._answering.add(task)
            task.add_done_callback(self._answering.discard)
            return
        await self._reply(message["id"], method, result)

    async def _reply_later(self, request_id: Any, method: str, answer: Awaitable[Any]) -> None:
        try:
            result = await answer
        except asyncio.CancelledError:
            raise
        except Exception as error:
            result = error
        await self._reply(request_id, method, result)

    async def _reply(self, request_id: Any, method: str, result: Any) -> None:
        if isinstance(result, RpcError):
            reply: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "error": result.to_wire()}
        elif isinstance(result, Exception):
            logger.error("%s: handler for %s failed", self._name, method, exc_info=result)
            reply = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32603, "message": f"internal error: {result}"},
            }
        else:
            reply = {"jsonrpc": "2.0", "id": request_id, "result": result}
        with contextlib.suppress(AgentExited):
            await self._send(reply)

    async def _drain_stderr(self) -> None:
        stderr = self._process.stderr
        assert stderr is not None
        with contextlib.suppress(Exception):
            while True:
                try:
                    line = await stderr.readline()
                except ValueError:
                    continue
                if not line:
                    return
                text = line.decode(errors="replace").rstrip()
                if text:
                    self._stderr_tail.append(text)
                    logger.debug("%s stderr: %s", self._name, text)

    async def _finish(self) -> None:
        self._closed = True
        # Let the exit code and the last stderr lines land in the reason.
        with contextlib.suppress(TimeoutError):
            async with asyncio.timeout(0.5):
                await self._process.wait()
                await asyncio.shield(self._stderr)
        for task in list(self._answering):
            task.cancel()
        exited = AgentExited(self.exit_reason)
        for future in self._pending.values():
            if not future.done():
                future.set_exception(exited)
        self._pending.clear()

    # --- shutdown ------------------------------------------------------

    def mark_failed(self, reason: str) -> None:
        """Declare the connection unusable, ahead of the process stopping."""

        if self._exit_reason is None:
            self._exit_reason = reason
        self._closed = True

    async def close(self, *, grace: float = 2.0) -> None:
        """Terminate the process group, then kill it if it outlives `grace`."""

        self.mark_failed("the agent was stopped")
        await terminate_group(self._process, grace=grace)
        self._reader.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._reader
        if not self._stderr.done():
            self._stderr.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await self._stderr
        for task in list(self._answering):
            task.cancel()
        exited = AgentExited(self.exit_reason)
        for future in self._pending.values():
            if not future.done():
                future.set_exception(exited)
        self._pending.clear()


def group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def signal_group(pgid: int, sig: signal.Signals) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pgid, sig)


async def terminate_group(process: asyncio.subprocess.Process, *, grace: float) -> None:
    """SIGTERM the process's group, SIGKILL whatever remains after `grace`.

    The agent leads its own group (`start_new_session=True`), so its pid is
    the group id. The group is checked, not only the leader: a wrapper that
    exits promptly on SIGTERM can leave a child that does not.
    """

    pgid = process.pid
    if process.stdin is not None and not process.stdin.is_closing():
        process.stdin.close()
    signal_group(pgid, signal.SIGTERM)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + grace
    while loop.time() < deadline:
        if process.returncode is not None and not group_exists(pgid):
            break
        await asyncio.sleep(0.02)
    else:
        signal_group(pgid, signal.SIGKILL)
    with contextlib.suppress(TimeoutError):
        async with asyncio.timeout(grace):
            await process.wait()
