"""The contract for a stateless conversation backend — defined, not implemented.

A `Provider` is handed the full conversation on every turn and holds nothing
between them. That is what lets the application own context: fork points,
corrections, and drillable compaction all rest on assembling `messages`
itself. The BYOK adapters of roadmap Phase 4 implement it.

It is written now, beside `service/agent/contract.py:Agent`, because a seam
designed against one implementation is shaped by that implementation.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from service.agent.contract import TurnEvent

__all__ = ["ProviderMessage", "Provider"]


@dataclass(frozen=True)
class ProviderMessage:
    role: Literal["system", "learner", "agent"]
    content: str


class Provider(Protocol):
    def stream_chat(
        self,
        messages: Sequence[ProviderMessage],
        tools: Sequence[object],
        model: str,
        skills: Sequence[str],
    ) -> AsyncIterator[TurnEvent]:
        """Stream one turn over the complete `messages`. Ends with `TurnEnded`."""
