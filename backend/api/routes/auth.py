"""Sign-in, sign-out, and the account list.

These are the only routes reachable while signed out. Every workspace route
refuses without an active account (`api/dependencies/auth.py`); if these did
the same there would be no way to ever acquire one.

Each sign-in route is *registered* from `service/identity`'s registry rather
than written unconditionally and refused at call time. That is what makes a
closed gate answer 404: an unregistered path is indistinguishable from one that
was never written, which is what the spec asks for so a distributed build does
not advertise an endpoint that enrols accounts with no credentials. It also
keeps the gate consulted in exactly one place — a second reading of
`settings.dev_auth_enabled` here is a second place for it to be read wrongly.

The registry is never empty, because the local mechanism is registered
unconditionally. That is what makes at least one sign-in route exist in every
build, and it is the difference between a sign-in surface with an option and
one that can only report that it has none.

Reading, listing, and activating are separate from all of it and reach no
adapter at all. An account's rows are on disk; getting back to one must not
depend on whether the mechanism that created it is registered today.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from api.dependencies.auth import ProfileServiceDep
from core.exceptions import DomainError, NotFoundError, ValidationError
from models.profile import ProfileRecord
from service.identity import (
    DEV_PROVIDER_NAME,
    LOCAL_PROVIDER_NAME,
    IdentityProvider,
    SignInRequest,
    available_providers,
)

# The URL segment each mechanism signs in under. A mapping rather than a
# per-adapter attribute because a path is a presentation concern: the identity
# contract deliberately admits nothing about HTTP, and adding a `path` to it
# would be the first field `profile_service` could branch on.
_SIGN_IN_PATHS = {
    LOCAL_PROVIDER_NAME: "/local/signin",
    DEV_PROVIDER_NAME: "/dev/signin",
}


class WireModel(BaseModel):
    """camelCase on the wire, snake_case in Python.

    The frontend's Zod schemas in `features/account/account-api.ts` are the
    other half of this contract; a field renamed on one side has to be renamed
    on the other or validation there fails loudly rather than silently
    dropping the value.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ProfileOut(WireModel):
    id: str
    provider: str
    subject: str
    email: str | None
    display_name: str | None
    avatar_url: str | None


class SessionOut(WireModel):
    profile: ProfileOut | None
    # Reported by the server because which mechanisms exist is decided when the
    # app is constructed. The client's only alternative would be to call each
    # sign-in endpoint and read the 404 — that is, to offer controls before
    # knowing whether they lead anywhere.
    #
    # A list rather than one boolean per mechanism: a flag each would mean a
    # wire change on both sides for every adapter ever added, and the client
    # would accumulate a branch per flag. Order is the registry's, so the
    # always-registered mechanism comes first and a client rendering them in
    # order leads with the one that cannot fail to exist.
    mechanisms: list[str]


class SignOutOut(WireModel):
    status: str


class SignInInput(WireModel):
    """Hints, never identity.

    Both optional, and for different reasons per adapter: the development one
    derives a stable subject from whatever it is given, including nothing at
    all, while the local one ignores them when minting a subject and keeps them
    only as display fields. A hosted provider will ignore them entirely and
    report what it knows.
    """

    display_name: str | None = None
    email: str | None = None


def _serialize(profile: ProfileRecord) -> ProfileOut:
    return ProfileOut(
        id=profile.id,
        provider=profile.provider,
        subject=profile.subject,
        email=profile.email,
        display_name=profile.display_name,
        avatar_url=profile.avatar_url,
    )


def _http_error(error: DomainError) -> HTTPException:
    """Translate a domain refusal at the boundary, where HTTP is allowed to exist."""

    if isinstance(error, NotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, ValidationError):
        # The literal matches `api/routes/workspace.py`; the named Starlette
        # constant for 422 is deprecated and renaming it there is not this
        # change's business.
        return HTTPException(status_code=422, detail=str(error))
    raise error


# Routes that must answer whether or not anyone is signed in. Declared `def`
# rather than `async def` throughout: each one reads the Keychain through a
# subprocess and then queries SQLite, and doing that on the event loop would
# stall every other request for the duration.
_session_routes = APIRouter()


@_session_routes.get("/session")
def read_session(service: ProfileServiceDep) -> SessionOut:
    """Report who is signed in, or that nobody is.

    Never 401. This is the route that *reports* the signed-out state, so
    refusing it would leave the frontend with no way to learn it should render
    the sign-in surface — the one screen a signed-out learner can act on.
    """

    profile = service.active_profile()
    return SessionOut(
        profile=_serialize(profile) if profile is not None else None,
        mechanisms=list(available_providers()),
    )


@_session_routes.post("/signout")
def sign_out(service: ProfileServiceDep) -> SignOutOut:
    """End the session, keeping every row the account owns.

    Idempotent, because signing out has to succeed from a half-finished
    sign-in as well as from a good one; a learner who cannot sign out is stuck
    in a state with no exit.
    """

    service.sign_out()
    return SignOutOut(status="signed-out")


@_session_routes.get("/profiles")
def list_profiles(service: ProfileServiceDep) -> list[ProfileOut]:
    """Every account enrolled on this device, oldest first.

    Reachable while signed out, like the rest of `/auth`: an account picker
    that required an account would have nothing to offer the learner who has
    just signed out of the only one.
    """

    return [_serialize(profile) for profile in service.list_profiles()]


@_session_routes.post("/profiles/{profile_id}/activate")
def activate_profile(profile_id: str, service: ProfileServiceDep) -> ProfileOut:
    """Open an already-enrolled account without signing in again.

    Reachable while signed out, and deliberately reaching no adapter: this is
    what the picker calls, and it must work offline, and for an account whose
    originating mechanism is not registered in this process. Requiring the
    adapter here would strand a development account on the next launch with
    the gate shut — an account whose rows are on disk and perfectly readable.
    """

    try:
        return _serialize(service.activate(profile_id))
    except DomainError as error:
        raise _http_error(error)


@_session_routes.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(
    profile_id: str,
    service: ProfileServiceDep,
    confirm: bool = Query(default=False),
) -> Response:
    """Destroy one account and everything it owns.

    The confirmation flag is required rather than assumed, and the refusal
    without it names what would have been destroyed. Sign-out and removal
    differ by a learner's entire graph, so removal must not be reachable by a
    caller that meant the other one.
    """

    try:
        service.delete_profile(profile_id, confirmed=confirm)
    except DomainError as error:
        raise _http_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _sign_in_routes(path: str, provider: IdentityProvider) -> APIRouter:
    """Build one mechanism's sign-in route, bound to the registered adapter.

    The provider is captured here instead of looked up per request so the
    registry is consulted once, at the moment the route is registered. A
    per-request lookup would be a second reading of the same state, and two
    readings are two chances to disagree about whether this endpoint exists.

    One factory for every mechanism rather than one function each: the body is
    identical because the identity contract made it so, and a second copy would
    be a place for the two to drift on error handling.
    """

    routes = APIRouter()

    @routes.post(path)
    def sign_in(payload: SignInInput, service: ProfileServiceDep) -> ProfileOut:
        try:
            identity = provider.authenticate(
                SignInRequest(display_name=payload.display_name, email=payload.email)
            )
            profile = service.enroll(identity)
        except DomainError as error:
            raise _http_error(error)
        return _serialize(profile)

    return routes


def create_router() -> APIRouter:
    """Assemble the auth surface this process actually offers.

    A factory rather than a module-level router because which routes exist
    depends on the gate, and a router built at import would freeze whichever
    answer happened to hold when the module was first imported — including in
    the suite, which builds apps on both sides of the gate.
    """

    router = APIRouter(prefix="/auth", tags=["auth"])
    router.include_router(_session_routes)

    # Driven by the registry rather than by a list written here, so adding an
    # adapter is one registration and one path entry, and a mechanism that is
    # not registered has no route rather than a route that refuses.
    for name, provider in available_providers().items():
        path = _SIGN_IN_PATHS.get(name)
        if path is not None:
            router.include_router(_sign_in_routes(path, provider))

    return router
