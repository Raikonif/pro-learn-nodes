"""Classifying and recording what an agent offers."""

from service.agent.controls import mode_group, offer, serialize_commands, serialize_options
from service.agent.contract import AvailableCommand, ConfigOption, ConfigValue
from tests.agent_doubles import offered_options


def test_modes_are_grouped_and_the_unknown_is_most_permissive():
    assert [mode_group(m) for m in ("default", "plan", "read-only", "agent")] == ["asks"] * 4
    assert [mode_group(m) for m in ("acceptEdits", "workspace-write")] == ["edits"] * 2
    assert [mode_group(m) for m in ("auto", "bypassPermissions", "agent-full-access")] == ["unasked"] * 3
    assert mode_group("weird-mode") == "unasked"


def test_only_the_four_categories_are_kept():
    options = offered_options() + [ConfigOption("collaboration_mode", "Collab", "collaboration_mode", "default", (ConfigValue("plan"),))]
    stored = serialize_options(options)
    assert [o["control"] for o in stored] == ["model", "effort", "mode", "fast"]
    mode = next(o for o in stored if o["control"] == "mode")
    assert {v["value"]: v["group"] for v in mode["values"]} == {
        "default": "asks", "acceptEdits": "edits", "bypassPermissions": "unasked", "weird-mode": "unasked",
    }
    assert all("group" not in v for o in stored if o["control"] != "mode" for v in o["values"])


def test_the_offer_shape_and_unknown_until_reached():
    assert offer(None, None) == {"known": False, "model": None, "effort": None, "fast": None, "mode": None, "commands": []}
    shaped = offer(serialize_options(offered_options()), serialize_commands([AvailableCommand("compact", "Free context")]))
    assert shaped["known"] is True
    assert shaped["model"]["current"] == "fast-1" and [v["value"] for v in shaped["model"]["values"]] == ["fast-1", "smart-2"]
    assert shaped["commands"] == [{"name": "compact", "description": "Free context", "inputHint": None}]
