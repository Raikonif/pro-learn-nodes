"""Which features a node can offer, decided by the kind of backend it runs on.

A session-stateful agent manages its own context and will not hand back the
records these features need. They are declared unavailable there rather than
approximated — a locally summarised "compaction" presented as the drill-down
the mission promises would be a feature that looks like principle 9 and is not.
"""

from __future__ import annotations

from typing import Literal

__all__ = ["BackendKind", "CONTEXT_FEATURES", "feature_availability"]

BackendKind = Literal["stateless", "session_stateful"]

# Features that require the application to assemble the context it sends.
CONTEXT_FEATURES: dict[str, str] = {
    "compaction": "Hierarchical compaction",
    "skill_merging": "Inference-time skill merging",
}


def feature_availability(kind: BackendKind) -> dict[str, bool]:
    return {feature: kind == "stateless" for feature in CONTEXT_FEATURES}
