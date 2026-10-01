"""The routes a signed-out learner is allowed to reach.

Four claims carry the weight here. Development sign-in is *absent* rather than
refused when the gate is shut, byte for byte the answer an unwritten endpoint
gives — a suite that only exercised the open gate would pass with the gate
deleted. Reading the session never refuses, because it is the route that
reports the signed-out state and the sign-in surface cannot be rendered
without it. Signing out is idempotent and destroys nothing. And removal is
refused until it is confirmed, naming what it would have destroyed.

None of these tests may touch the real login keychain. `ProfileService()`
defaults its store to `get_secret_store()`, which on macOS is the developer's
own; every client below installs an `InMemorySecretStore` through
`app.dependency_overrides`, which is the reason `get_profile_service` exists as
a dependency at all.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from api.dependencies.auth import get_profile_service
from core.config import Settings
from core.secrets import InMemorySecretStore
from main import create_app
from service import identity as identity_registry
from service.profile_service import ProfileService

DEV_AUTH_ENV_VAR = "LEARN_NODES_DEV_AUTH"
DEV_SIGN_IN = "/auth/dev/signin"
LOCAL_SIGN_IN = "/auth/local/signin"


@pytest.fixture
def store() -> InMemorySecretStore:
    """The active-session pointer's storage, isolated per test."""

    return InMemorySecretStore()


@pytest.fixture
def gate(monkeypatch):
    """Open or shut the development gate for the app built after it is called.

    `settings` is a frozen singleton read at import and its validator re-reads
    `os.environ`, so both halves are needed: the variable makes the value
    legitimate, and rebuilding `Settings` is what lets the registry see it.
    """

    def configure(*, enabled: bool) -> None:
        if enabled:
            monkeypatch.setenv(DEV_AUTH_ENV_VAR, "1")
        else:
            monkeypatch.delenv(DEV_AUTH_ENV_VAR, raising=False)
        monkeypatch.setattr(identity_registry, "settings", Settings())

    return configure


@asynccontextmanager
async def auth_client(
    data_dir: Path, store: InMemorySecretStore
) -> AsyncIterator[AsyncClient]:
    """An app over a throwaway database, and a session pointer that is not the Keychain."""

    app = create_app(data_dir)
    app.dependency_overrides[get_profile_service] = lambda: ProfileService(store)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


async def test_development_sign_in_is_absent_while_the_gate_is_shut(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """A shut gate must not advertise that the endpoint exists.

    Compared against a path nobody ever wrote rather than merely asserted to
    be 404: the spec asks for indistinguishable, and a hand-written 404 with a
    different body would tell a probe that something is there.
    """

    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        refused = await client.post(DEV_SIGN_IN, json={})
        never_written = await client.post("/auth/dev/no-such-endpoint", json={})
        enrolled = await client.get("/auth/profiles")

    assert refused.status_code == never_written.status_code == 404
    assert refused.json() == never_written.json()
    assert enrolled.json() == []


async def test_session_reports_the_shut_gate_rather_than_leaving_it_to_be_guessed(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        session = await client.get("/auth/session")

    assert session.status_code == 200
    # Local remains, and is why the surface still has something to offer.
    assert session.json() == {"profile": None, "mechanisms": ["local"]}


async def test_reading_the_session_never_refuses_while_signed_out(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """401 here would leave the frontend unable to render the sign-in surface."""

    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        session = await client.get("/auth/session")

    assert session.status_code == 200
    # Order is the registry's, not alphabetical: the always-present mechanism
    # comes first so a client rendering them in order leads with the one that
    # cannot fail to exist.
    assert session.json() == {"profile": None, "mechanisms": ["local", "dev"]}


async def test_development_sign_in_enrols_activates_and_reports_camel_case(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        signed_in = await client.post(
            DEV_SIGN_IN, json={"displayName": "Ada", "email": "ada@example.com"}
        )
        session = await client.get("/auth/session")

    assert signed_in.status_code == 200
    profile = signed_in.json()
    # The wire names are the frontend's Zod contract in `account-api.ts`; a
    # snake_case key here fails validation there instead of in this suite.
    assert set(profile) == {
        "id",
        "provider",
        "subject",
        "email",
        "displayName",
        "avatarUrl",
    }
    assert profile["provider"] == "dev"
    assert profile["displayName"] == "Ada"
    # Activation is part of signing in: the very next read must find it.
    assert session.json() == {"profile": profile, "mechanisms": ["local", "dev"]}


async def test_signing_in_twice_lands_on_one_account(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        first = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        second = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        enrolled = await client.get("/auth/profiles")

    assert first.json()["id"] == second.json()["id"]
    assert len(enrolled.json()) == 1


async def test_sign_out_clears_the_session_keeps_the_account_and_repeats(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        first = await client.post("/auth/signout", json={})
        session = await client.get("/auth/session")
        # Idempotent: a learner who cannot sign out of a half-finished
        # sign-in has no way out of the state.
        second = await client.post("/auth/signout", json={})
        enrolled = await client.get("/auth/profiles")

    assert first.status_code == 200
    assert second.status_code == 200
    assert session.json()["profile"] is None
    # Signing out ends the session and nothing else.
    assert len(enrolled.json()) == 1


async def test_profiles_are_listed_oldest_first(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        first = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        second = await client.post(DEV_SIGN_IN, json={"email": "grace@example.com"})
        enrolled = await client.get("/auth/profiles")

    assert [profile["id"] for profile in enrolled.json()] == [
        first.json()["id"],
        second.json()["id"],
    ]


async def test_removal_is_refused_until_it_is_confirmed(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """Sign-out and removal differ by a learner's entire graph."""

    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        signed_in = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        profile_id = signed_in.json()["id"]
        unconfirmed = await client.delete(f"/auth/profiles/{profile_id}")
        survived = await client.get("/auth/profiles")
        confirmed = await client.delete(f"/auth/profiles/{profile_id}?confirm=true")
        remaining = await client.get("/auth/profiles")
        session = await client.get("/auth/session")

    assert unconfirmed.status_code == 422
    # The refusal names what would have been destroyed, before it is.
    assert "workspace" in unconfirmed.json()["detail"]
    assert [profile["id"] for profile in survived.json()] == [profile_id]
    assert confirmed.status_code == 204
    assert remaining.json() == []
    # Removing the active account ends its session too.
    assert session.json()["profile"] is None


async def test_removing_an_unknown_account_is_not_found(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        response = await client.delete("/auth/profiles/no-such-profile?confirm=true")

    assert response.status_code == 404


# --- The local mechanism, the picker, and activation -----------------------


async def test_local_sign_in_is_present_while_the_development_gate_is_shut(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """The test that proves a default build is enterable.

    Everything else about the gate is unchanged; what this asserts is that
    shutting it no longer removes the last way in.
    """

    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        signed_in = await client.post(LOCAL_SIGN_IN, json={"displayName": "Ada"})
        session = await client.get("/auth/session")

    assert signed_in.status_code == 200
    assert signed_in.json()["provider"] == "local"
    assert signed_in.json()["displayName"] == "Ada"
    assert session.json()["profile"] == signed_in.json()


async def test_local_sign_in_needs_no_name(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        signed_in = await client.post(LOCAL_SIGN_IN, json={})

    assert signed_in.status_code == 200
    assert signed_in.json()["displayName"] is None


async def test_two_local_profiles_with_one_name_stay_distinct(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """The behavior the random subject exists to produce.

    The development mechanism would return the same account twice here. This
    one must not, or two learners on a shared install share a graph.
    """

    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        first = await client.post(LOCAL_SIGN_IN, json={"displayName": "Alice"})
        second = await client.post(LOCAL_SIGN_IN, json={"displayName": "Alice"})
        enrolled = await client.get("/auth/profiles")

    assert first.json()["id"] != second.json()["id"]
    assert len(enrolled.json()) == 2


async def test_reading_the_session_enrols_nothing(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """Discovery must not require an attempt, per the spec."""

    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        await client.get("/auth/session")
        enrolled = await client.get("/auth/profiles")
        session = await client.get("/auth/session")

    assert enrolled.json() == []
    assert session.json()["profile"] is None


async def test_the_picker_lists_an_account_whose_mechanism_is_not_registered(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """A `dev` account must survive a launch with the gate shut.

    Its rows are on disk and activation reads one of them; nothing about
    reaching it depends on the adapter that created it. Filtering the list by
    what is registered would strand the account on the next launch — the same
    dead end this change exists to remove, one layer down.
    """

    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        enrolled_with_dev = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})

    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        session = await client.get("/auth/session")
        listed = await client.get("/auth/profiles")

    assert session.json()["mechanisms"] == ["local"]
    assert [entry["id"] for entry in listed.json()] == [enrolled_with_dev.json()["id"]]


async def test_activating_a_listed_account_opens_it_without_enrolling_a_second(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    """What selecting an account in the picker does.

    Activation takes an id and reaches no adapter, which is what makes
    returning to an account work offline and with the gate shut.
    """

    gate(enabled=True)
    async with auth_client(tmp_path, store) as client:
        ada = await client.post(DEV_SIGN_IN, json={"email": "ada@example.com"})
        await client.post("/auth/signout", json={})

    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        activated = await client.post(f"/auth/profiles/{ada.json()['id']}/activate", json={})
        session = await client.get("/auth/session")
        enrolled = await client.get("/auth/profiles")

    assert activated.status_code == 200
    assert activated.json()["id"] == ada.json()["id"]
    assert session.json()["profile"]["id"] == ada.json()["id"]
    assert len(enrolled.json()) == 1


async def test_activating_an_unknown_account_is_a_not_found(
    gate, tmp_path: Path, store: InMemorySecretStore
):
    gate(enabled=False)
    async with auth_client(tmp_path, store) as client:
        missing = await client.post("/auth/profiles/no-such-id/activate", json={})
        session = await client.get("/auth/session")

    assert missing.status_code == 404
    assert session.json()["profile"] is None
