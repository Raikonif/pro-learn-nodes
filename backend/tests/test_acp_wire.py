"""The permission request's wire shape: what the agent offers, and how it is answered."""

from __future__ import annotations

from service.agent.acp import wire


def test_a_request_carries_its_options_and_locations():
    request = wire.RequestPermissionParams.model_validate(
        {
            "sessionId": "s1",
            "toolCall": {
                "toolCallId": "call-1",
                "title": "Write notes.md",
                "kind": "edit",
                "locations": [{"path": "/tmp/node/notes.md", "line": 3}],
            },
            "options": [
                {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                {"optionId": "always", "name": "Always", "kind": "allow_always"},
                {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
            ],
        }
    )

    assert request.tool_call.kind == "edit"
    assert [location.path for location in request.tool_call.locations] == ["/tmp/node/notes.md"]
    assert [(o.option_id, o.kind) for o in request.options] == [
        ("allow", "allow_once"), ("always", "allow_always"), ("reject", "reject_once"),
    ]


def test_an_unknown_option_kind_and_missing_fields_are_tolerated():
    request = wire.RequestPermissionParams.model_validate(
        {
            "sessionId": "s1",
            "toolCall": {"toolCallId": "call-1"},
            "options": [{"optionId": "maybe", "kind": "ask_my_manager", "extra": 1}],
        }
    )

    assert request.tool_call.locations == []
    assert request.tool_call.kind is None
    assert request.options[0].kind == "ask_my_manager"


def test_a_request_without_options_parses():
    request = wire.RequestPermissionParams.model_validate({"sessionId": "s1"})

    assert request.options == []


def test_answers_select_an_option_or_cancel():
    assert wire.selected_permission("allow") == {"outcome": {"outcome": "selected", "optionId": "allow"}}
    assert wire.CANCELLED_PERMISSION == {"outcome": {"outcome": "cancelled"}}
