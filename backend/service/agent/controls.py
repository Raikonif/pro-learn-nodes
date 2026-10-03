"""What a session's agent offers to control, and how its permission modes rank.

Options are found by category, the one thing both measured agents agree on
(`model`, `thought_level`, `model_config`, `mode`); their ids differ. Modes are
grouped by what they let the agent do here, where every permission request
is refused: a mode that asks is effectively read-only, and only a mode that
does not ask lets the agent act. An unknown mode is put in the most
permissive group — assumed to allow the most, never the least.
"""

from __future__ import annotations

from typing import Any

from service.agent.contract import AvailableCommand, ConfigOption

__all__ = ["CONTROL_OF_CATEGORY", "MODE_GROUPS", "mode_group", "serialize_commands", "serialize_options", "offer"]

# category reported by the agent -> the control it is shown as
CONTROL_OF_CATEGORY = {"model": "model", "thought_level": "effort", "model_config": "fast", "mode": "mode"}

MODE_GROUPS: dict[str, str] = {
    # Asks before acting (refused here): effectively read-only.
    "default": "asks", "plan": "asks", "read-only": "asks", "agent": "asks",
    # Edits the session's folder without asking.
    "acceptEdits": "edits", "workspace-write": "edits",
    # Acts on the learner's system without asking.
    "auto": "unasked", "bypassPermissions": "unasked", "agent-full-access": "unasked",
}


def mode_group(value: str | None) -> str | None:
    if value is None:
        return None
    return MODE_GROUPS.get(value, "unasked")


def serialize_options(options: list[ConfigOption]) -> list[dict[str, Any]]:
    """The offered controls, for storage: only the four categories, never others."""

    out = []
    for option in options:
        control = CONTROL_OF_CATEGORY.get(option.category or "")
        if control is None:
            continue
        out.append({
            "control": control,
            "id": option.id,
            "name": option.name,
            "current": option.current,
            "values": [
                {"value": v.value, "name": v.name or v.value, "description": v.description,
                 **({"group": mode_group(v.value)} if control == "mode" else {})}
                for v in option.values
            ],
        })
    return out


def serialize_commands(commands: list[AvailableCommand]) -> list[dict[str, Any]]:
    return [{"name": c.name, "description": c.description, "inputHint": c.input_hint} for c in commands]


def offer(offered_options: list[dict[str, Any]] | None, offered_commands: list[dict[str, Any]] | None) -> dict[str, Any]:
    """`GET /agents/{id}/offer`'s shape."""

    by_control = {o["control"]: o for o in offered_options or []}

    def option(control: str) -> dict[str, Any] | None:
        stored = by_control.get(control)
        if stored is None:
            return None
        return {"id": stored["id"], "name": stored["name"], "current": stored["current"], "values": stored["values"]}

    return {
        "known": offered_options is not None,
        "model": option("model"),
        "effort": option("effort"),
        "fast": option("fast"),
        "mode": option("mode"),
        "commands": list(offered_commands or []),
    }
