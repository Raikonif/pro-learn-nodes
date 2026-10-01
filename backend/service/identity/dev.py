"""Sign-in that enrolls an account with nothing but the request itself.

This is the first implementation of `IdentityProvider`, not a stub standing in
for one: the account system is built and tested against it, and the eventual
Google and GitHub adapters are additional files satisfying the same protocol.
It is also what lets the Playwright suite sign in at all, since browser
automation cannot pass a hosted consent screen.

Nothing here touches the network, spawns a process, or reads a credential — the
adapter has to work on a device that has never been online. `tests/
test_identity_dev.py` nails those doors shut while it runs so the property is
asserted structurally rather than believed.
"""

from __future__ import annotations

import hashlib

from service.identity.protocol import Identity, SignInRequest

# Stored in `ProfileRecord.provider`, so it is half the database identity of
# every account enrolled this way: it can never change once one exists, and it
# is what makes such an account identifiable to the learner as a development
# account without any privilege or role distinguishing it.
DEV_PROVIDER_NAME = "dev"

# The seed used when the learner supplied nothing. Repeated "just sign me in"
# clicks then land on one account rather than accumulating anonymous ones.
_ANONYMOUS_SEED = "anonymous"

# Half a SHA-256 is far past collision concerns for a handful of local accounts
# and keeps the value short enough to read in a log line while debugging.
_SUBJECT_LENGTH = 32


def _subject_for(request: SignInRequest) -> str:
    """Derive a subject that is the same every time for the same request.

    Determinism is the whole point: `profile_service` enrolls by
    `(provider, subject)`, so a fresh subject per sign-in would enroll a new
    account on every launch and the learner's graph would appear to vanish.

    `hashlib` rather than the built-in `hash()`, which is randomized per process
    by PYTHONHASHSEED — subjects would then survive a session but not a restart,
    the most confusing possible version of this bug.

    The email seeds it in preference to the display name because a display name
    is refreshed from the request on every sign-in and must not identify anyone;
    seeding from it would make renaming yourself indistinguishable from being
    someone else. Case-folded so that the same address typed with different
    capitalization is the same account.
    """

    seed = (request.email or request.display_name or _ANONYMOUS_SEED).strip().casefold()
    # Hashed rather than used directly so the subject — which is written to a
    # row, returned by the API, and printed in logs — does not carry the address
    # the learner typed.
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:_SUBJECT_LENGTH]


class DevelopmentIdentityProvider:
    """The development sign-in mechanism.

    Stateless, so the registry can build one per call and two instances always
    agree; nothing here would survive a restart if it were not.
    """

    name = DEV_PROVIDER_NAME

    def authenticate(self, request: SignInRequest) -> Identity:
        # The requested display fields are passed through untouched: with no
        # upstream directory to consult, what the learner typed is the only
        # information there is, and `Identity` already normalizes blanks to
        # absence so an empty request yields a profile with null display fields
        # rather than empty-string ones.
        return Identity(
            provider=DEV_PROVIDER_NAME,
            subject=_subject_for(request),
            display_name=request.display_name,
            email=request.email,
        )
