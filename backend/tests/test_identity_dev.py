"""The identity contract, and the development adapter that first implements it.

Two claims carry the weight here. An `Identity` that reached the repository
without a subject would be written into `uq_profile_identity` as a row nothing
could ever look up again, so the value rejects it at construction rather than
trusting each adapter to check. And the development adapter's promise is that
it works on a machine with no network and no external service — a promise a
test that only inspected the returned value would not actually exercise, so
the network and subprocess doors are nailed shut while it runs.
"""

from __future__ import annotations

import socket
import subprocess

import pytest

from core.config import Settings
from core.exceptions import ValidationError
from service import identity as identity_registry
from service.identity import available_providers
from service.identity.dev import DEV_PROVIDER_NAME, DevelopmentIdentityProvider
from service.identity.protocol import Identity, SignInRequest

DEV_AUTH_ENV_VAR = "LEARN_NODES_DEV_AUTH"


def test_an_identity_carries_the_fields_enrollment_needs():
    identity = Identity(
        provider="dev",
        subject="abc123",
        display_name="Ada",
        email="ada@example.com",
        avatar_url="https://example.com/a.png",
    )

    assert (identity.provider, identity.subject) == ("dev", "abc123")
    assert identity.display_name == "Ada"
    assert identity.email == "ada@example.com"
    assert identity.avatar_url == "https://example.com/a.png"


def test_the_display_fields_are_optional():
    """A provider may withhold any of them, and the dev adapter has no directory."""

    identity = Identity(provider="dev", subject="abc123")

    assert (identity.display_name, identity.email, identity.avatar_url) == (None, None, None)


@pytest.mark.parametrize("subject", ["", "   ", "\n\t"])
def test_an_identity_without_a_usable_subject_is_rejected(subject: str):
    with pytest.raises(ValidationError):
        Identity(provider="dev", subject=subject)


@pytest.mark.parametrize("provider", ["", "   "])
def test_an_identity_without_a_provider_name_is_rejected(provider: str):
    """`(provider, subject)` is the identity; half of it is not an identity."""

    with pytest.raises(ValidationError):
        Identity(provider=provider, subject="abc123")


def test_rejection_is_a_domain_error_the_api_layer_can_translate():
    """Not an `AssertionError`: those vanish under `python -O` and read as bugs.

    The spec requires a failed sign-in to surface as a recoverable failure, and
    the API layer only knows how to turn `DomainError` into a response.
    """

    with pytest.raises(ValidationError) as raised:
        Identity(provider="dev", subject="")

    assert "subject" in str(raised.value)


def test_surrounding_whitespace_does_not_create_a_second_account():
    """`uq_profile_identity` compares bytes, so ` abc` and `abc` are two rows."""

    assert Identity(provider=" dev ", subject=" abc123\n").subject == "abc123"
    assert Identity(provider=" dev ", subject=" abc123\n").provider == "dev"


def test_a_blank_display_field_is_absence_rather_than_an_empty_string():
    """`ProfileRecord` already spells "unknown" as NULL; `""` would be a second
    spelling every reader would have to handle."""

    identity = Identity(provider="dev", subject="abc123", display_name="  ", email="")

    assert identity.display_name is None
    assert identity.email is None


@pytest.fixture
def offline(monkeypatch):
    """A machine that cannot reach anything, which is the adapter's advertised home.

    Patching the constructors rather than asserting on the result is what makes
    this a structural proof: an adapter that grew an HTTP call or shelled out to
    a helper would fail here even if it still returned a conforming identity.
    """

    def no_network(*args: object, **kwargs: object):
        raise AssertionError("development sign-in must not open a socket")

    def no_subprocess(*args: object, **kwargs: object):
        raise AssertionError("development sign-in must not spawn a process")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(subprocess, "run", no_subprocess)
    monkeypatch.setattr(subprocess, "Popen", no_subprocess)
    return monkeypatch


def test_development_sign_in_works_with_no_network_and_no_subprocess(offline):
    identity = DevelopmentIdentityProvider().authenticate(
        SignInRequest(display_name="Ada", email="ada@example.com")
    )

    assert identity.subject
    assert identity.display_name == "Ada"
    assert identity.email == "ada@example.com"


def test_development_sign_in_needs_no_requested_details_at_all(offline):
    """The route's body is entirely optional, so an empty request must still enroll."""

    identity = DevelopmentIdentityProvider().authenticate(SignInRequest())

    assert identity.subject


def test_the_development_provider_is_named_distinctly():
    """The learner has to be able to tell a dev account from a real one."""

    provider = DevelopmentIdentityProvider()

    assert provider.name == DEV_PROVIDER_NAME == "dev"
    assert provider.authenticate(SignInRequest()).provider == DEV_PROVIDER_NAME


def test_the_same_requested_identity_resolves_to_the_same_subject(offline):
    """Otherwise every dev sign-in enrolls another account instead of returning
    to the one already there."""

    request = SignInRequest(display_name="Ada", email="ada@example.com")

    first = DevelopmentIdentityProvider().authenticate(request)
    second = DevelopmentIdentityProvider().authenticate(request)

    assert first.subject == second.subject


def test_a_changed_display_name_still_resolves_to_the_same_account(offline):
    """Display fields are refreshed on every sign-in and never identify anyone."""

    ada = SignInRequest(display_name="Ada", email="ada@example.com")
    renamed = SignInRequest(display_name="Ada L.", email="ada@example.com")

    assert (
        DevelopmentIdentityProvider().authenticate(ada).subject
        == DevelopmentIdentityProvider().authenticate(renamed).subject
    )


def test_different_requested_identities_do_not_collide(offline):
    ada = SignInRequest(email="ada@example.com")
    grace = SignInRequest(email="grace@example.com")

    assert (
        DevelopmentIdentityProvider().authenticate(ada).subject
        != DevelopmentIdentityProvider().authenticate(grace).subject
    )


def test_the_subject_does_not_leak_the_requested_email():
    """The subject is written to a row and shown in logs; the seed need not be."""

    identity = DevelopmentIdentityProvider().authenticate(
        SignInRequest(email="ada@example.com")
    )

    assert "ada@example.com" not in identity.subject


@pytest.fixture
def gate(monkeypatch):
    """Rebuild `settings` from a controlled environment.

    `settings` is a frozen singleton read at import, and its validator re-reads
    `os.environ`, so the only way to move the gate is to set the variable and
    construct a fresh `Settings` — the same approach `test_dev_auth_setting.py`
    takes.
    """

    def set_gate(*, open_gate: bool) -> None:
        if open_gate:
            monkeypatch.setenv(DEV_AUTH_ENV_VAR, "1")
        else:
            monkeypatch.delenv(DEV_AUTH_ENV_VAR, raising=False)
        monkeypatch.setattr(identity_registry, "settings", Settings())

    return set_gate


def test_the_registry_offers_development_sign_in_when_the_gate_is_open(gate):
    gate(open_gate=True)

    providers = available_providers()

    assert DEV_PROVIDER_NAME in providers
    assert providers[DEV_PROVIDER_NAME].name == DEV_PROVIDER_NAME


def test_the_registry_hides_development_sign_in_by_default(gate):
    """This is the test that keeps the gate shut in a distributed build: a suite
    that only exercised the enabled path would pass with the gate deleted."""

    gate(open_gate=False)

    assert DEV_PROVIDER_NAME not in available_providers()


def test_the_registry_is_read_at_call_time_not_at_import(gate):
    """A registry frozen at import would keep answering with whatever the gate
    said when the module first loaded, which is not what the route asks about."""

    gate(open_gate=True)
    assert DEV_PROVIDER_NAME in available_providers()

    gate(open_gate=False)
    assert DEV_PROVIDER_NAME not in available_providers()


def test_the_returned_registry_cannot_be_mutated_into_an_open_gate(gate):
    """Handing out the live mapping would let one caller install a provider for
    every other caller, gate or no gate."""

    gate(open_gate=True)
    available_providers().clear()

    assert DEV_PROVIDER_NAME in available_providers()
