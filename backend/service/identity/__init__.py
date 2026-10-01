"""Which sign-in mechanisms this process actually offers.

The registry is the one place the development gate is consulted, so a route or
a session report asks "is it available" instead of re-reading a setting and
each getting the answer slightly wrong. Registration is also the mechanism
behind the spec's 404: an absent provider gives the route nothing to expose,
rather than a present one it has to remember to refuse.
"""

from __future__ import annotations

from core.config import settings
from service.identity.dev import DEV_PROVIDER_NAME, DevelopmentIdentityProvider
from service.identity.local import LOCAL_PROVIDER_NAME, LocalIdentityProvider
from service.identity.protocol import Identity, IdentityProvider, SignInRequest

__all__ = [
    "DEV_PROVIDER_NAME",
    "LOCAL_PROVIDER_NAME",
    "DevelopmentIdentityProvider",
    "LocalIdentityProvider",
    "Identity",
    "IdentityProvider",
    "SignInRequest",
    "available_providers",
]


def available_providers() -> dict[str, IdentityProvider]:
    """The mechanisms offered right now, keyed by provider name.

    Built per call rather than resolved once at import, for two reasons. The
    gate is read from `settings`, which the suite replaces to exercise both
    sides of it — a module-level dict would freeze whichever value happened to
    be in force when the first test imported this. And a fresh dict means a
    caller that mutates what it receives cannot install a provider for every
    other caller, which would route around the gate entirely.
    """

    providers: dict[str, IdentityProvider] = {}

    # Unconditional, and the only entry that is. This is what makes the
    # returned mapping never empty, which is what makes the sign-in surface
    # always have something to offer. A gate on this one would reintroduce the
    # state where a default build cannot be entered at all.
    providers[LOCAL_PROVIDER_NAME] = LocalIdentityProvider()

    # Registration, not a refusal at call time: a build with the gate shut has
    # no development provider to expose, so the route can 404 the way it would
    # for an endpoint that was never written.
    if settings.dev_auth_enabled:
        providers[DEV_PROVIDER_NAME] = DevelopmentIdentityProvider()

    return providers
