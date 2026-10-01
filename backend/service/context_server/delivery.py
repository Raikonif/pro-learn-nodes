"""Practice an agent added, on its way from the context server to the turn.

A tool call arrives on the context server's connection; the turn that caused
it is streaming on another. The bus joins them: a write publishes a
`Delivery` for its `(node_id, thread_id)`, and the turn for that thread,
while it runs, takes them off and tells the window. Both servers run on one
event loop, but publishing is made thread-safe anyway, so a tool handler the
SDK ever runs in a worker thread cannot corrupt a queue.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field

__all__ = ["Delivery", "DeliveryBus", "TOOL_OF_KIND"]

# Which rail tool a practice item belongs to.
TOOL_OF_KIND = {"free_response": "qa", "multiple_choice": "quiz", "code_exercise": "code"}


@dataclass(frozen=True)
class Delivery:
    node_id: str
    thread_id: str
    tool: str
    item_ids: tuple[str, ...]
    agent_name: str


@dataclass
class DeliveryBus:
    _queues: dict[tuple[str, str], list[asyncio.Queue[Delivery]]] = field(default_factory=lambda: defaultdict(list))
    _loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self, node_id: str, thread_id: str) -> asyncio.Queue[Delivery]:
        self._loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Delivery] = asyncio.Queue()
        self._queues[(node_id, thread_id)].append(queue)
        return queue

    def unsubscribe(self, node_id: str, thread_id: str, queue: asyncio.Queue[Delivery]) -> None:
        queues = self._queues.get((node_id, thread_id), [])
        if queue in queues:
            queues.remove(queue)
        if not queues:
            self._queues.pop((node_id, thread_id), None)

    def publish(self, delivery: Delivery) -> None:
        for queue in list(self._queues.get((delivery.node_id, delivery.thread_id), [])):
            if self._loop is not None and self._loop.is_running():
                try:
                    running = asyncio.get_running_loop()
                except RuntimeError:
                    running = None
                if running is self._loop:
                    queue.put_nowait(delivery)
                else:
                    self._loop.call_soon_threadsafe(queue.put_nowait, delivery)
