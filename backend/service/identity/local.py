"""Sign-in that enrolls an account from a name the learner types.

This is the mechanism that guarantees the application is enterable. Every
other adapter is optional: the development one is deliberately absent from a
distributed build, and a hosted provider needs a console, a network, and a
consent screen the learner may not be able to reach. This one is registered
unconditionally, so no build can reach the state where a sign-in surface has
nothing to offer.

It is not a relaxed development sign-in. The two differ in what they are for,
and the difference shows up in the subject: `dev` is a test seam that must
resolve the same request to the same account, while `local` is a product
surface where creating a profile is a deliberate act. See `_new_subject`.

Nothing here touches the network, spawns a process, or reads a credential —
the adapter has to work on a device that has never been online.
`tests/test_identity_local.py` nails those doors shut while it runs so the
property is asserted structurally rather than believed.
"""

from __future__ import annotations

import secrets

from service.identity.protocol import Identity, SignInRequest

# Stored in `ProfileRecord.provider`, so it is half the database identity of
# every account enrolled this way and can never change once one exists.
#
# It is also, already, the provider of the account that
# `migrations/versions/20260825_01_adopt_existing_workspace.py` creates when it
# adopts a pre-account workspace. That is the intended outcome rather than a
# collision to work around: the adopted account *is* a local account — created
# without an external service, belonging to whoever runs this install — so once
# the picker exists it appears there like any other, with no adoption-specific
# handling anywhere.
LOCAL_PROVIDER_NAME = "local"

# Bytes of randomness behind each subject. Sixteen renders as the same 32-char
# string the development adapter's truncated digest produces, which keeps the
# column's values a uniform width in a log line, and is far past collision
# concerns for a handful of accounts on one device.
_SUBJECT_BYTES = 16


def _new_subject() -> str:
    """Mint a subject that belongs to this enrollment and to no other.

    Deliberately the inverse of `dev._subject_for`, which hashes the request so
    the same request always resolves to the same account. The reasoning
    inverts because the return path does: a development sign-in gets you back
    to your account by re-deriving the subject, so determinism is load-bearing
    there, while a local account is returned to by selecting it from the
    picker, so determinism buys nothing here — and costs two things.

    Deriving from the display name would make renaming yourself
    indistinguishable from being someone else, which is the reason the
    development adapter already prefers email over display name as its seed.
    And it would collapse two learners on one install who both typed "Alice"
    into a single graph, silently, with no error to notice.

    `secrets` rather than `random`: the value is an account identifier that
    ends up in URLs and log lines, and a predictable one is a worse default
    than an unpredictable one for no gain.
    """

    return secrets.token_hex(_SUBJECT_BYTES)


class LocalIdentityProvider:
    """The local sign-in mechanism.

    Stateless, so the registry can build one per call and two instances always
    agree — nothing here would survive a restart if it were not.
    """

    name = LOCAL_PROVIDER_NAME

    def authenticate(self, request: SignInRequest) -> Identity:
        # The display fields are passed through untouched: with no upstream
        # directory to consult, what the learner typed is the only information
        # there is, and `Identity` already normalizes a blank to absence, so an
        # empty request yields null display fields rather than empty-string
        # ones. A name is genuinely optional — the spec requires enrollment
        # without one to succeed and be listed under a fallback label.
        return Identity(
            provider=LOCAL_PROVIDER_NAME,
            subject=_new_subject(),
            display_name=request.display_name,
            email=request.email,
        )
