"""Where a request's data scope is decided — and the only place it is.

Every workspace route used to take a `workspaceId` from the caller. That was
harmless while one account existed and is an insecure direct object reference
the moment two share a database, so the scope is resolved here instead:
active session -> profile -> that profile's workspace. A route asks for
`WorkspaceScope` and receives an id it cannot influence.

The value of concentrating it is that the entitlement check exists in one
function with one test rather than as a convention every future route has to
remember. `WorkspaceScope` is therefore the only exported way to obtain a
workspace id: a route that wanted a client-supplied one would have to write
the parameter itself, which is visible in review in a way a missing check is
not.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status

from models.profile import ProfileRecord
from service.profile_service import ProfileService
from service.workspace import ensure_default_workspace

__all__ = [
    "ActiveProfile",
    "ProfileServiceDep",
    "WorkspaceScope",
    "get_profile_service",
    "require_active_profile",
    "require_workspace_scope",
]

# Distinguished from a missing-data 404 on purpose: the frontend needs to tell
# "sign in" apart from "that node is gone", because only one of them has an
# action the learner can take.
_SIGNED_OUT_DETAIL = "Sign in to continue: this request requires an active account."


def get_profile_service() -> ProfileService:
    """Build the service a request's account operations run through.

    A dependency rather than a module-level instance so the suite can install
    one over an `InMemorySecretStore`. `ProfileService()` defaults its store to
    `core.secrets.get_secret_store()`, which on macOS is the developer's real
    login keychain — a route that constructed the service itself would leave a
    session behind in it on every test run, and would collide with whatever
    account the developer is actually signed in as.

    Fresh per request because both of its dependencies — the Keychain and the
    configured engine — hold the state; the service itself holds none, so a
    cached instance would only pin the engine from before `configure_database`
    re-pointed it.
    """

    return ProfileService()


ProfileServiceDep = Annotated[ProfileService, Depends(get_profile_service)]


def require_active_profile(service: ProfileServiceDep) -> ProfileRecord:
    """The account this request acts as, or a refusal telling the caller to sign in.

    Declared `def` rather than `async def` so FastAPI runs it in a worker
    thread: resolving the session reads the Keychain through a subprocess and
    then queries SQLite, and both would stall the event loop for every other
    request if this coroutine did them inline.

    Nothing here consults an expiry. `active_profile()` reads a pointer that
    sign-out deletes outright, so the refusal after signing out is immediate
    rather than eventual — there is no interval during which a cleared session
    still works.
    """

    profile = service.active_profile()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_SIGNED_OUT_DETAIL,
        )
    return profile


ActiveProfile = Annotated[ProfileRecord, Depends(require_active_profile)]


def require_workspace_scope(profile: ActiveProfile) -> str:
    """The workspace id every scoped service call for this request receives.

    `ensure_default_workspace` is asked for the workspace rather than merely
    looked up, and always with a `profile_id`. Activation already provisions
    one, so this is normally a read; provisioning here as well means a database
    restored from a backup taken before the workspace existed answers requests
    instead of refusing every one of them with nothing the learner can do from
    the signed-in state.

    Passing the id unconditionally is also what keeps
    `service/workspace.py:bootstrap` off its `workspace_id is None` fallback,
    which returns the oldest workspace on the device regardless of owner — the
    exact crossing this dependency exists to prevent.
    """

    return ensure_default_workspace(profile_id=profile.id).id


WorkspaceScope = Annotated[str, Depends(require_workspace_scope)]
