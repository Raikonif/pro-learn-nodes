"""The local sign-in mechanism, and the guarantee that a door always exists.

Two claims carry the weight. The adapter must work on a machine that has never
been online — asserted structurally, by nailing the network and subprocess
doors shut while it runs, the same way `test_identity_dev.py` proves the same
property of the development adapter. And the adapter must be registered with
the development gate both open and shut, because that registration is the
whole reason a freshly installed application is enterable at all.

The subject deserves its own note, because this adapter deliberately inverts
what the development one does. `dev` derives a stable subject from the request
so that repeated sign-ins land on one account. `local` generates a fresh
opaque subject per enrollment, because the way back to a local account is the
picker, not re-derivation — and derivation would make renaming yourself
indistinguishable from being someone else, and would silently collapse two
learners who both typed "Alice" into one graph.
"""

from __future__ import annotations

import importlib.util
import socket
import subprocess
from pathlib import Path

import pytest

from core.config import Settings
from service import identity as identity_registry
from service.identity import available_providers
from service.identity.dev import DEV_PROVIDER_NAME
from service.identity.local import LOCAL_PROVIDER_NAME, LocalIdentityProvider
from service.identity.protocol import SignInRequest

DEV_AUTH_ENV_VAR = "LEARN_NODES_DEV_AUTH"


def _adopted_subject() -> str:
    """Read the sentinel from the migration that owns it.

    Loaded by path because a revision filename begins with a digit and is not
    an importable module name. Worth the four lines: copying the literal here
    would leave the test agreeing with a value it no longer reads, which is the
    one failure mode a collision test must not have.
    """

    revision = (
        Path(__file__).resolve().parents[1]
        / "migrations"
        / "versions"
        / "20260825_01_adopt_existing_workspace.py"
    )
    spec = importlib.util.spec_from_file_location("_adopt_revision", revision)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ADOPTED_SUBJECT


@pytest.fixture
def offline(monkeypatch):
    """A machine that cannot reach anything, which is this adapter's home.

    Patching the constructors rather than asserting on the result is what makes
    this structural: an adapter that grew an HTTP call or shelled out to a
    helper would fail here even while still returning a conforming identity.
    """

    def no_network(*args: object, **kwargs: object):
        raise AssertionError("local sign-in must not open a socket")

    def no_subprocess(*args: object, **kwargs: object):
        raise AssertionError("local sign-in must not spawn a process")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(subprocess, "run", no_subprocess)
    monkeypatch.setattr(subprocess, "Popen", no_subprocess)
    return monkeypatch


def test_local_sign_in_works_with_no_network_and_no_subprocess(offline):
    identity = LocalIdentityProvider().authenticate(SignInRequest(display_name="Ada"))

    assert identity.provider == LOCAL_PROVIDER_NAME == "local"
    assert identity.subject
    assert identity.display_name == "Ada"


def test_local_sign_in_needs_no_details_at_all(offline):
    """Enrolling without a name must still succeed, per the spec's fallback."""

    identity = LocalIdentityProvider().authenticate(SignInRequest())

    assert identity.subject
    assert identity.display_name is None


def test_the_same_name_twice_enrolls_two_separate_accounts(offline):
    """The inversion of the development adapter, and the reason it exists.

    Two learners on one install who both type "Alice" must get two graphs.
    Deriving the subject from the name would silently merge them.
    """

    request = SignInRequest(display_name="Alice")

    first = LocalIdentityProvider().authenticate(request)
    second = LocalIdentityProvider().authenticate(request)

    assert first.subject != second.subject


def test_the_subject_does_not_carry_the_supplied_name(offline):
    """The subject is written to a row and printed in logs; a name need not be.

    It is also what makes renaming safe: a subject containing the name would
    have to change when the name did, and changing it enrolls a second account.
    """

    identity = LocalIdentityProvider().authenticate(
        SignInRequest(display_name="Ada Lovelace", email="ada@example.com")
    )

    assert "Ada" not in identity.subject
    assert "ada" not in identity.subject.casefold()
    assert "example.com" not in identity.subject


def test_a_generated_subject_never_collides_with_the_adopted_workspace(offline):
    """`20260825_01` already wrote `("local", "adopted-workspace")`.

    That row is the pre-account workspace, adopted into an ordinary local
    account so the picker lists it like any other. A generated subject that
    could equal the sentinel would attach a newly created profile to the
    adopted graph — the one collision `uq_profile_identity` cannot warn about,
    because it would look like a legitimate return to an existing account.
    """

    provider = LocalIdentityProvider()
    subjects = {provider.authenticate(SignInRequest()).subject for _ in range(64)}

    assert _adopted_subject() not in subjects
    assert len(subjects) == 64, "every enrollment must yield a distinct subject"


@pytest.fixture
def gate(monkeypatch):
    """Rebuild `settings` from a controlled environment.

    `settings` is a frozen singleton read at import and its validator re-reads
    `os.environ`, so moving the gate means setting the variable and building a
    fresh `Settings` — the approach `test_identity_dev.py` already takes.
    """

    def set_gate(*, open_gate: bool) -> None:
        if open_gate:
            monkeypatch.setenv(DEV_AUTH_ENV_VAR, "1")
        else:
            monkeypatch.delenv(DEV_AUTH_ENV_VAR, raising=False)
        monkeypatch.setattr(identity_registry, "settings", Settings())

    return set_gate


def test_local_sign_in_is_registered_with_the_gate_shut(gate):
    """The test that keeps the application enterable.

    A default build registers no development adapter. If it registered nothing
    else either, `available_providers()` would be empty, the sign-in surface
    would have nothing to offer, and there would be no way into the app — the
    exact state this change exists to remove.
    """

    gate(open_gate=False)

    providers = available_providers()

    assert LOCAL_PROVIDER_NAME in providers
    assert DEV_PROVIDER_NAME not in providers


def test_local_sign_in_is_registered_with_the_gate_open(gate):
    """Opening the development gate adds a mechanism; it never replaces one."""

    gate(open_gate=True)

    providers = available_providers()

    assert LOCAL_PROVIDER_NAME in providers
    assert DEV_PROVIDER_NAME in providers


def test_at_least_one_mechanism_is_always_offered(gate):
    """The spec's requirement stated directly, so it fails if it stops holding."""

    for open_gate in (True, False):
        gate(open_gate=open_gate)
        assert available_providers(), "a build with no sign-in mechanism is unenterable"
