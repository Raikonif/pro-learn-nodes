"""Data access for enrolled account profiles.

Every function takes the `Session` it works in and never opens one. The
transaction boundary belongs to the service layer's `session_scope()`, so that
a caller can compose several of these into one unit of work — a repository that
committed on its own would decide that for everyone. This mirrors
`service/workspace.py`'s `_node` and `_thread` helpers, which take a session
for the same reason.

Enrollment and workspace provisioning are deliberately *not* one transaction:
provisioning happens on activation, which also runs for an already-enrolled
profile. Nesting its `session_scope` inside enrollment's would open a second
SQLite connection and stall on the write lock. The intermediate state is not
user-visible because the active-profile pointer is written only after
provisioning succeeds — a failure leaves the learner signed out, and the next
activation repairs it.

Data access only: no activation, no `SecretStore`, no idempotent-enrollment
rule. Those are `service/profile_service.py`'s job.
"""

from __future__ import annotations

from sqlmodel import Session, select

from models.profile import ProfileRecord


def create(
    session: Session,
    *,
    provider: str,
    subject: str,
    email: str | None = None,
    display_name: str | None = None,
    avatar_url: str | None = None,
) -> ProfileRecord:
    """Insert a profile and return it with its generated id populated.

    The flush is deliberate: it both makes `id` available to the caller before
    the surrounding transaction commits and surfaces a duplicate
    `(provider, subject)` here rather than at some unrelated later commit,
    where the traceback would point at the wrong operation.
    """

    profile = ProfileRecord(
        provider=provider,
        subject=subject,
        email=email,
        display_name=display_name,
        avatar_url=avatar_url,
    )
    session.add(profile)
    session.flush()
    return profile


def get_by_identity(session: Session, provider: str, subject: str) -> ProfileRecord | None:
    """Look up the account by the pair that identifies it.

    Never by email: an address can be reassigned to a different person, which
    would hand one learner another's graph.
    """

    statement = select(ProfileRecord).where(
        ProfileRecord.provider == provider,
        ProfileRecord.subject == subject,
    )
    return session.exec(statement).one_or_none()


def get_by_id(session: Session, profile_id: str) -> ProfileRecord | None:
    return session.get(ProfileRecord, profile_id)


def list_all(session: Session) -> list[ProfileRecord]:
    """Every enrolled profile, oldest first.

    `id` breaks ties on `created_at`: two profiles enrolled within the same
    clock tick would otherwise order differently between calls, and the
    account list is rendered.
    """

    statement = select(ProfileRecord).order_by(ProfileRecord.created_at, ProfileRecord.id)
    return list(session.exec(statement).all())


def delete(session: Session, profile_id: str) -> bool:
    """Remove the profile row, reporting whether there was one to remove.

    Returning a flag rather than raising lets the caller distinguish a real
    removal from a no-op without a second query; removing an account that a
    concurrent sign-out already dealt with is not an error.
    """

    profile = session.get(ProfileRecord, profile_id)
    if profile is None:
        return False
    session.delete(profile)
    return True
