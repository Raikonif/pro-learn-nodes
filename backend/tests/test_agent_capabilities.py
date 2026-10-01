from service.agent.capabilities import CONTEXT_FEATURES, feature_availability


def test_context_features_are_available_only_on_stateless_backends():
    assert feature_availability("stateless") == {name: True for name in CONTEXT_FEATURES}
    assert feature_availability("session_stateful") == {name: False for name in CONTEXT_FEATURES}


def test_both_named_features_are_covered():
    assert {"compaction", "skill_merging"} <= set(CONTEXT_FEATURES)
