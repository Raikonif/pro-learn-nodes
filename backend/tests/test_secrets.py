"""Secret storage.

The store holds the pointer to the active account, so its contract is what
sign-in and sign-out are built on: a value that survives being written, and
an absent value that reads as absent rather than as an error. The contract
tests run against the in-memory store; the Keychain store is exercised with
`subprocess` patched, because a test that really wrote to the developer's
login keychain would leave residue on the machine and would fail outright
on the Linux runner this indirection exists for.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

from core import secrets
from core.config import Settings
from core.secrets import (
    KEYCHAIN_SERVICE,
    InMemorySecretStore,
    KeychainSecretStore,
    SecretStore,
    get_secret_store,
)


@pytest.fixture
def store() -> SecretStore:
    return InMemorySecretStore()


def test_a_stored_secret_reads_back(store: SecretStore):
    store.set("active-profile", "profile-123")

    assert store.get("active-profile") == "profile-123"


def test_an_unknown_key_reads_as_absent(store: SecretStore):
    assert store.get("never-written") is None


def test_setting_an_existing_key_replaces_the_value(store: SecretStore):
    store.set("active-profile", "profile-123")
    store.set("active-profile", "profile-456")

    assert store.get("active-profile") == "profile-456"


def test_delete_removes_the_secret(store: SecretStore):
    store.set("active-profile", "profile-123")
    store.delete("active-profile")

    assert store.get("active-profile") is None


def test_deleting_an_unknown_key_is_not_an_error(store: SecretStore):
    """Sign-out must succeed when there was no session to clear.

    Otherwise a failed or half-finished sign-in leaves the learner unable to
    sign out of the state it left behind.
    """

    store.delete("never-written")


class _FakeCompletedProcess:
    def __init__(self, returncode: int, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@pytest.fixture
def keychain_calls(monkeypatch) -> list[list[str]]:
    """Record the `security` argv the store builds, answering every call OK."""

    calls: list[list[str]] = []

    def fake_run(argv: list[str], **_kwargs: object) -> _FakeCompletedProcess:
        calls.append(argv)
        return _FakeCompletedProcess(returncode=0, stdout="profile-123\n")

    monkeypatch.setattr(subprocess, "run", fake_run)
    return calls


def test_keychain_set_upserts_under_the_app_service(keychain_calls):
    KeychainSecretStore().set("active-profile", "profile-123")

    (argv,) = keychain_calls
    assert argv[:2] == ["security", "add-generic-password"]
    # Without `-U` a second sign-in fails with "item already exists" instead
    # of replacing the session pointer.
    assert "-U" in argv
    assert "-s" in argv and argv[argv.index("-s") + 1] == KEYCHAIN_SERVICE
    assert "-a" in argv and argv[argv.index("-a") + 1] == "active-profile"
    assert "-w" in argv and argv[argv.index("-w") + 1] == "profile-123"


def test_keychain_get_returns_the_password_without_its_trailing_newline(
    keychain_calls,
):
    value = KeychainSecretStore().get("active-profile")

    assert value == "profile-123"
    (argv,) = keychain_calls
    assert argv[:2] == ["security", "find-generic-password"]
    assert "-w" in argv


def test_keychain_get_reports_a_missing_item_as_absent(monkeypatch):
    """`security` exits 44 for a missing item; that is not a failure here."""

    def fake_run(_argv: list[str], **_kwargs: object) -> _FakeCompletedProcess:
        return _FakeCompletedProcess(returncode=44, stdout="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert KeychainSecretStore().get("never-written") is None


def test_keychain_delete_tolerates_a_missing_item(monkeypatch):
    def fake_run(_argv: list[str], **_kwargs: object) -> _FakeCompletedProcess:
        return _FakeCompletedProcess(returncode=44, stdout="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    KeychainSecretStore().delete("never-written")


def test_keychain_set_surfaces_a_real_failure(monkeypatch):
    """A locked or unwritable keychain must not look like a saved session."""

    def fake_run(_argv: list[str], **_kwargs: object) -> _FakeCompletedProcess:
        return _FakeCompletedProcess(returncode=1, stdout="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(RuntimeError):
        KeychainSecretStore().set("active-profile", "profile-123")


def test_the_selector_uses_the_keychain_on_macos(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")

    assert isinstance(get_secret_store(), KeychainSecretStore)


def test_the_selector_falls_back_off_macos(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")

    assert isinstance(get_secret_store(), InMemorySecretStore)


def test_the_fallback_store_is_shared_across_calls(monkeypatch):
    """Two calls off macOS must see one store, or CI has no session at all.

    A fresh store per call would make every read miss, which reads as "the
    learner is signed out" on the request after sign-in.
    """

    monkeypatch.setattr(sys, "platform", "linux")

    get_secret_store().set("active-profile", "profile-123")
    try:
        assert get_secret_store().get("active-profile") == "profile-123"
    finally:
        get_secret_store().delete("active-profile")


def test_the_keychain_item_is_scoped_to_the_data_directory(monkeypatch, tmp_path):
    """Two installs pointed at different data must not share one session.

    The database is already per-`data_dir`, but the active-profile pointer was
    not: a single service name meant the E2E backend, a `pnpm dev` backend, and
    a production install all read and wrote the same Keychain item. Running the
    E2E suite therefore signed the developer out of their dev session — the
    pointer it left behind named a profile that only existed in the E2E
    database. Deriving the service name from the data directory makes the
    pointer travel with the data it points into.
    """

    monkeypatch.setattr(sys, "platform", "darwin")

    def at_data_dir(name: str):
        # `settings` is a frozen singleton built at import, so a launched
        # process already holds the right directory; the suite swaps the whole
        # object the way `tests/test_dev_auth_setting.py` does.
        monkeypatch.setenv("LEARN_NODES_DATA_DIR", str(tmp_path / name))
        monkeypatch.setattr(secrets, "settings", Settings())
        return get_secret_store()

    first = at_data_dir("one")
    second = at_data_dir("two")

    assert first._service != second._service

    # Same directory, same item — a restart must find the session it left.
    assert at_data_dir("one")._service == first._service
