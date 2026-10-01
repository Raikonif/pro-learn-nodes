"""The context server's MCP app, behind a guard, on a loopback listener.

Listens on `127.0.0.1` at a port the OS assigns, because the production
backend's Unix socket is unreachable for an agent. Three things make a
loopback port acceptable (design: "Loopback HTTP"): every call needs a
bearer credential the application issued; a request carrying a browser
`Origin` is refused, closing DNS rebinding from a web page; and nothing
reachable is destructive.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import uvicorn
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from service.context_server.credentials import CredentialRegistry, Scope
from service.context_server.delivery import DeliveryBus
from service.context_server.tools import register_tools

__all__ = ["ContextServer", "scope_of"]

logger = logging.getLogger(__name__)

ASGIApp = Callable[[dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]], Awaitable[None]]


def _bearer(headers: Any) -> str | None:
    value = None
    if isinstance(headers, list):  # raw ASGI headers
        for name, raw in headers:
            if name.lower() == b"authorization":
                value = raw.decode("latin-1")
    elif headers is not None:
        value = headers.get("authorization") or headers.get("Authorization")
    if value and value.lower().startswith("bearer "):
        return value[7:].strip()
    return None


def scope_of(ctx: Context, credentials: CredentialRegistry) -> Scope:
    """The calling session's scope, read from this request's own headers.

    Resolved inside each tool rather than passed down from the guard, so it
    cannot depend on the SDK running the handler in the guard's task.
    """

    scope = credentials.resolve(_bearer(ctx.headers))
    if scope is None:  # The guard already refused this; never reached in practice.
        raise PermissionError("No valid credential for this call")
    return scope


def _guard(inner: ASGIApp, credentials: CredentialRegistry) -> ASGIApp:
    async def app(scope: dict, receive, send) -> None:
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return
        headers = scope.get("headers", [])
        if any(name.lower() == b"origin" for name, _ in headers):
            await _refuse(send, 403, "Requests from a browser are not accepted")
            return
        if credentials.resolve(_bearer(headers)) is None:
            await _refuse(send, 401, "A valid credential is required")
            return
        await inner(scope, receive, send)

    return app


async def _refuse(send, status: int, message: str) -> None:
    body = json.dumps({"error": message}).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class ContextServer:
    """The MCP server, its credentials, and the loopback listener serving it."""

    def __init__(self, credentials: CredentialRegistry | None = None) -> None:
        self.credentials = credentials or CredentialRegistry()
        self.mcp = MCPServer(name="learn-nodes", instructions="Learn Nodes: the learner's sessions, practice, and memory.")
        self.deliveries = DeliveryBus()
        self.port: int | None = None
        self._server: uvicorn.Server | None = None
        self._task: asyncio.Task[None] | None = None
        register_tools(self.mcp, self.credentials, self.deliveries)

    def asgi(self) -> ASGIApp:
        inner = self.mcp.streamable_http_app(
            stateless_http=True,
            json_response=True,
            # Our guard refuses any Origin and requires a credential; the SDK's
            # own host check would need the port before it is assigned.
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        )
        return _guard(inner, self.credentials)

    @property
    def url(self) -> str:
        if self.port is None:
            raise RuntimeError("The context server is not listening")
        return f"http://127.0.0.1:{self.port}/mcp"

    async def start(self) -> int:
        config = uvicorn.Config(self.asgi(), host="127.0.0.1", port=0, log_level="warning", lifespan="on")
        self._server = uvicorn.Server(config)
        self._task = asyncio.create_task(self._server.serve(), name="learn-nodes-context-server")
        while not self._server.started:
            if self._task.done():
                self._task.result()  # surfaces the startup error
            await asyncio.sleep(0.01)
        self.port = self._server.servers[0].sockets[0].getsockname()[1]
        logger.info("context server listening on 127.0.0.1:%d", self.port)
        return self.port

    async def stop(self) -> None:
        """Close the listener now rather than at uvicorn's next 0.1s tick."""

        if self._server is not None:
            self._server.should_exit = True
            try:
                await self._server.shutdown()
            except Exception:
                logger.debug("context server shutdown raised", exc_info=True)
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except BaseException:  # cancelled, or already finished with an error
                pass
        self.port = None
