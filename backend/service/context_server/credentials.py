"""Bearer credentials for the context server: minted per agent session, held in memory.

A credential is the only source of a call's scope. The registry lives in
process memory, so a restart invalidates every credential; a session gets a
fresh one when it is loaded again, because `session/load` carries
`mcpServers` too.
"""

from __future__ import annotations

import secrets
import threading
from dataclasses import dataclass

__all__ = ["CredentialRegistry", "Scope"]


@dataclass(frozen=True)
class Scope:
    profile_id: str
    workspace_id: str
    node_id: str
    thread_id: str
    agent_id: str
    agent_name: str


class CredentialRegistry:
    def __init__(self) -> None:
        self._by_token: dict[str, Scope] = {}
        self._by_session: dict[tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def mint(self, scope: Scope) -> str:
        """Issue a credential for one thread's session with one agent.

        Minting again for the same thread and agent — a reload — revokes the
        previous credential, so at most one is live per agent session.
        """

        token = secrets.token_urlsafe(32)
        key = (scope.thread_id, scope.agent_id)
        with self._lock:
            previous = self._by_session.get(key)
            if previous is not None:
                self._by_token.pop(previous, None)
            self._by_token[token] = scope
            self._by_session[key] = token
        return token

    def resolve(self, token: str | None) -> Scope | None:
        if not token:
            return None
        with self._lock:
            return self._by_token.get(token)

    def revoke(self, token: str) -> None:
        with self._lock:
            scope = self._by_token.pop(token, None)
            if scope is not None:
                self._by_session.pop((scope.thread_id, scope.agent_id), None)

    def token_for(self, thread_id: str, agent_id: str) -> str | None:
        with self._lock:
            return self._by_session.get((thread_id, agent_id))
