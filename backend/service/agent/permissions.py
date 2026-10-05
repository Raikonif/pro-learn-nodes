"""An agent's request to act: what is decided without asking, and what waits for the learner.

Three parts, each from the change design:

- **Policy.** A read whose every named location resolves inside the node's
  own directory is granted; a remembered decision for the same account,
  node, agent, and kind of action answers too. Everything else is asked.
- **The reply.** The learner's answer goes back as the agent's *once* option,
  so the agent never remembers on the learner's behalf; where it offers
  none, the prompt says that it will ("The agent's own 'always' options").
  A decision made without asking is only ever made with a once option.
- **The registry.** One pending request, two places to answer it — inline
  and the workspace indicator. It is decided exactly once, and withdrawn
  when its turn ends.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from core.database import session_scope
from core.exceptions import NotFoundError
from repository import permission_repo
from service.agent.contract import PermissionOption, PermissionRequest

__all__ = [
    "AlreadyDecided",
    "PendingPermission",
    "PermissionRegistry",
    "automatic_option",
    "inside",
    "reply_for",
]

# How many answered requests are remembered so a late second answer is told
# "already answered" (409) rather than "unknown" (404).
_ANSWERED_KEPT = 256

_ONCE = {True: "allow_once", False: "reject_once"}
_ALWAYS = {True: "allow_always", False: "reject_always"}


class AlreadyDecided(Exception):
    """The request was answered already — elsewhere, or by its turn ending."""


# --- Policy ---------------------------------------------------------------


def inside(location: str, directory: Path) -> bool:
    """Whether `location` resolves — links followed — to a path within `directory`.

    A relative location is taken relative to the directory, which is the
    agent's working directory. `..` and links that leave it are outside.
    """

    root = directory.resolve()
    path = Path(location)
    if not path.is_absolute():
        path = root / path
    return path.resolve().is_relative_to(root)


def reply_for(options: tuple[PermissionOption, ...], allow: bool) -> tuple[str | None, bool]:
    """The option to answer with, and whether answering makes the agent remember.

    The once option of the decided polarity; failing that, the always one,
    flagged; failing both, `None` — which cancels the request.
    """

    by_kind = {option.kind: option.option_id for option in options}
    if _ONCE[allow] in by_kind:
        return by_kind[_ONCE[allow]], False
    if _ALWAYS[allow] in by_kind:
        return by_kind[_ALWAYS[allow]], True
    return None, False


def agent_remembers(options: tuple[PermissionOption, ...]) -> bool:
    """Whether some answer the learner could give would make the agent remember it."""

    return any(reply_for(options, allow)[1] for allow in (True, False))


def automatic_option(
    request: PermissionRequest, node_dir: Path, workspace_id: str, node_id: str, agent_id: str
) -> str | None:
    """The option this request is answered with without asking, or `None` to ask.

    Never an option that makes the agent remember: a decision the learner did
    not make must not outlive this request in a place they cannot revoke it.
    """

    allow: bool | None = None
    if request.kind == "read" and request.locations and all(
        inside(location, node_dir) for location in request.locations
    ):
        allow = True
    elif request.kind:
        with session_scope() as session:
            remembered = permission_repo.find(session, workspace_id, node_id, agent_id, request.kind)
            allow = remembered.allow if remembered is not None else None
    if allow is None:
        return None
    option_id, remembers = reply_for(request.options, allow)
    return option_id if option_id is not None and not remembers else None


# --- Registry -------------------------------------------------------------


@dataclass(eq=False)
class PendingPermission:
    request: PermissionRequest
    turn_id: str
    workspace_id: str
    node_id: str
    thread_id: str
    agent_id: str
    agent_name: str
    node_title: str
    id: str = field(default_factory=lambda: str(uuid4()))
    # (allow, remembered), once the learner answered.
    decision: tuple[bool, bool] | None = None

    @property
    def rememberable(self) -> bool:
        return bool(self.request.kind)

    @property
    def agent_remembers(self) -> bool:
        return agent_remembers(self.request.options)

    def describe(self) -> dict:
        request = self.request
        return {
            "requestId": self.id,
            "nodeId": self.node_id,
            "threadId": self.thread_id,
            "nodeTitle": self.node_title,
            "agentName": self.agent_name,
            "toolCallId": request.tool_call_id,
            "title": request.title,
            "kind": request.kind,
            "locations": list(request.locations),
            "rememberable": self.rememberable,
            "agentRemembers": self.agent_remembers,
        }


class PermissionRegistry:
    """The requests waiting on a learner, shared by the stream and the decision route.

    In memory and per process, like the turns it belongs to: a request lives
    no longer than the turn that raised it.
    """

    def __init__(self) -> None:
        self._pending: dict[str, PendingPermission] = {}
        # request id -> workspace id, for requests already answered or withdrawn.
        self._answered: OrderedDict[str, str] = OrderedDict()

    def register(self, entry: PendingPermission) -> PendingPermission:
        self._pending[entry.id] = entry
        return entry

    def pending(self, workspace_id: str) -> list[PendingPermission]:
        return [
            entry
            for entry in self._pending.values()
            if entry.workspace_id == workspace_id and entry.decision is None
        ]

    def of_request(self, request: PermissionRequest) -> PendingPermission | None:
        return next((e for e in self._pending.values() if e.request is request), None)

    def decide(self, workspace_id: str, request_id: str, allow: bool, remember: bool) -> PendingPermission:
        """Answer one request. Raises `NotFoundError` or `AlreadyDecided`.

        Another account's request is answered exactly as one that does not
        exist. Remembering is recorded before the agent is told, so the next
        request of the same kind already finds it.
        """

        entry = self._pending.get(request_id)
        if entry is None and self._answered.get(request_id) == workspace_id:
            raise AlreadyDecided("This request was already answered")
        if entry is None or entry.workspace_id != workspace_id:
            raise NotFoundError("Unknown permission request")
        if entry.decision is not None or entry.request.decision.done():
            raise AlreadyDecided("This request was already answered")
        remembered = remember and entry.rememberable
        entry.decision = (allow, remembered)
        if remembered:
            with session_scope() as session:
                permission_repo.remember(
                    session, workspace_id, entry.node_id, entry.agent_id, entry.request.kind, allow
                )
        option_id, _ = reply_for(entry.request.options, allow)
        entry.request.decision.set_result(option_id)
        return entry

    def settle(self, request: PermissionRequest) -> PendingPermission | None:
        """Forget a request the agent has been told about, returning its entry."""

        entry = self.of_request(request)
        if entry is not None:
            self._forget(entry)
        return entry

    def withdraw_turn(self, turn_id: str) -> None:
        """A turn ended: every request it still waits on is cancelled and forgotten."""

        for request_id, entry in list(self._pending.items()):
            if entry.turn_id != turn_id:
                continue
            if not entry.request.decision.done():
                entry.request.decision.set_result(None)
            self._forget(entry)

    def _forget(self, entry: PendingPermission) -> None:
        self._pending.pop(entry.id, None)
        self._answered[entry.id] = entry.workspace_id
        while len(self._answered) > _ANSWERED_KEPT:
            self._answered.popitem(last=False)


def new_decision() -> asyncio.Future[str | None]:
    return asyncio.get_running_loop().create_future()
