"""The single contract every sign-in mechanism satisfies.

Enrollment, activation, and data scoping are written against `Identity` alone,
which is what lets a mechanism be added without touching any of them. That only
holds if nothing mechanism-specific reaches this far: no tokens, no redirect
URLs, no browser or socket concepts appear here, because a field carrying one
would be a field `profile_service` eventually branches on — and the branch is
exactly the coupling the protocol exists to prevent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from core.exceptions import ValidationError


def _required(value: str | None, field: str) -> str:
    """Normalize a field that identity depends on, or refuse the identity.

    Whitespace is stripped rather than tolerated because `(provider, subject)`
    is compared byte-for-byte by `uq_profile_identity`: a provider that returned
    a trailing newline once would enroll a second account for the same person
    and strand the first one's graph.
    """

    normalized = (value or "").strip()
    if not normalized:
        raise ValidationError(
            f"An identity requires a non-empty {field}; sign-in cannot continue."
        )
    return normalized


def _optional(value: str | None) -> str | None:
    """Collapse a blank display field to absence.

    `ProfileRecord` already spells "the provider withheld this" as NULL. Letting
    `""` through would make a second spelling of the same state, and every
    renderer downstream would have to know about both.
    """

    normalized = (value or "").strip()
    return normalized or None


@dataclass(frozen=True, slots=True)
class Identity:
    """Who signed in, in the only terms the rest of the system knows.

    Frozen because it is handed to enrollment and then to scoping: a value that
    could be edited in between would let the account a request is scoped to
    differ from the account it was authenticated as.

    Validation lives on the value rather than in each adapter so that an invalid
    identity is unconstructable — an adapter cannot forget a check it is not
    responsible for performing.
    """

    provider: str
    subject: str
    display_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None

    def __post_init__(self) -> None:
        # `object.__setattr__` is how a frozen dataclass normalizes in
        # `__post_init__`; assigning normally would raise on its own field.
        object.__setattr__(self, "provider", _required(self.provider, "provider"))
        object.__setattr__(self, "subject", _required(self.subject, "subject"))
        object.__setattr__(self, "display_name", _optional(self.display_name))
        object.__setattr__(self, "email", _optional(self.email))
        object.__setattr__(self, "avatar_url", _optional(self.avatar_url))


@dataclass(frozen=True, slots=True)
class SignInRequest:
    """What the learner supplied when starting a sign-in, all of it optional.

    Hints only, never identity: an adapter backed by a real provider ignores
    these and reports what the provider says. They exist because the development
    adapter has no upstream directory to read a name from, and because the route
    contract in `design.md` accepts `{displayName?, email?}`.
    """

    display_name: str | None = None
    email: str | None = None


class IdentityProvider(Protocol):
    """A sign-in mechanism, from the account system's point of view.

    A `Protocol` rather than a base class for the same reason `SecretStore` is
    one: adapters are selected at runtime and share no implementation, so an
    inheritance edge would buy nothing and would make an adapter that lives in
    another module import this one to be usable.
    """

    # The value stored in `ProfileRecord.provider`, so it is half of the
    # database identity of every account enrolled through this mechanism and
    # can never change once accounts exist.
    name: str

    def authenticate(self, request: SignInRequest) -> Identity:
        """Resolve the request to an identity, or raise a `DomainError`.

        Returning `None` for a failure is deliberately not part of the contract:
        the spec requires a failed sign-in to enroll nothing and surface as a
        recoverable failure, and a sentinel return is the shape callers forget
        to check.
        """
        ...
