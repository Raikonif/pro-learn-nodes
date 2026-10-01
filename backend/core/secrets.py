"""Secret storage for values that must not live in the database.

The active-session pointer is kept here rather than in a table because
`core/migrations.py:backup_database` copies the database before every
migration: a session held in a row would be duplicated into every backup
and would travel with a database copied to another machine. The Keychain
also scopes the value to the operating-system user rather than to the data
file, which is the closest thing to a session boundary a local-first app
has.

Storage sits behind a protocol for one concrete reason, not for symmetry:
CI runs on Linux, where the `security` CLI does not exist, so a direct
Keychain call would make the backend suite unrunnable there. The seam
follows the precedent of `configure_database` taking a `data_dir` instead
of reading a global.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path
from typing import Protocol

from core.config import settings

# The account (`-a`) carries the individual key; Keychain items are identified
# by the service/account pair, so a stable service is what lets
# `delete-generic-password` find what `set` wrote.
KEYCHAIN_SERVICE = "com.learn-nodes.app"

# `security` uses this for "the item you asked about is not in the keychain",
# which is an ordinary answer here — a learner who has never signed in has no
# session — while any other non-zero status is a real fault worth raising.
_ERR_SEC_ITEM_NOT_FOUND = 44


class SecretStore(Protocol):
    """The storage contract sign-in and sign-out are written against."""

    def get(self, key: str) -> str | None: ...

    def set(self, key: str, value: str) -> None: ...

    def delete(self, key: str) -> None: ...


class InMemorySecretStore:
    """Process-lifetime storage, for tests and for non-macOS hosts.

    Deliberately not durable: nothing here should look like a backend an
    installed app could rely on.
    """

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._values.get(key)

    def set(self, key: str, value: str) -> None:
        self._values[key] = value

    def delete(self, key: str) -> None:
        # Absence is the state the caller asked for, so reaching it is not a
        # failure — sign-out has to succeed after a half-finished sign-in.
        self._values.pop(key, None)


class KeychainSecretStore:
    """macOS login-keychain storage, driven through the `security` CLI.

    The CLI rather than a Python binding keeps the backend free of a native
    dependency that would have to survive PyInstaller bundling into the
    Tauri sidecar.
    """

    def __init__(self, service: str = KEYCHAIN_SERVICE) -> None:
        self._service = service

    def get(self, key: str) -> str | None:
        result = self._run(["find-generic-password", "-s", self._service, "-a", key, "-w"])
        if result.returncode == _ERR_SEC_ITEM_NOT_FOUND:
            return None
        self._require_success(result, f"read secret {key!r}")
        # `-w` prints the password followed by a newline of its own. Strip
        # exactly that one, not every trailing newline, so a value is
        # returned as it was stored.
        stdout = result.stdout
        return stdout[:-1] if stdout.endswith("\n") else stdout

    def set(self, key: str, value: str) -> None:
        # `-U` updates an existing item; without it a second sign-in fails
        # with "item already exists" instead of replacing the pointer. The
        # value goes on argv because `add-generic-password` reads a password
        # from nowhere else — omitting `-w` makes it prompt interactively,
        # which a headless sidecar can never answer. It is briefly visible to
        # `ps` on the same machine, which already has read access to the data
        # directory this protects; see the design's *Risks*.
        result = self._run(
            ["add-generic-password", "-U", "-s", self._service, "-a", key, "-w", value]
        )
        self._require_success(result, f"store secret {key!r}")

    def delete(self, key: str) -> None:
        result = self._run(["delete-generic-password", "-s", self._service, "-a", key])
        if result.returncode == _ERR_SEC_ITEM_NOT_FOUND:
            return
        self._require_success(result, f"delete secret {key!r}")

    @staticmethod
    def _run(arguments: list[str]) -> subprocess.CompletedProcess[str]:
        # `check=False` throughout: a missing item is signalled by exit code,
        # and letting `CalledProcessError` escape would turn "no session" into
        # a startup crash.
        return subprocess.run(
            ["security", *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    @staticmethod
    def _require_success(
        result: subprocess.CompletedProcess[str], action: str
    ) -> None:
        if result.returncode != 0:
            raise RuntimeError(
                f"Keychain refused to {action} (exit {result.returncode}): "
                f"{result.stderr.strip()}"
            )


# One instance, because a fresh store per call would make every read miss and
# a signed-in learner would read as signed out on the next request.
_fallback_store = InMemorySecretStore()


def keychain_service_for(data_dir: Path) -> str:
    """Name the Keychain item after the data it points into.

    The session pointer is a profile id, and profile ids only mean anything
    inside one database. A single service name for every install therefore let
    three backends — the E2E suite, `pnpm dev`, and a real install — read and
    write one another's pointer: running the E2E suite signed the developer
    out, because the id it left behind named a profile that existed only in
    the E2E database. Scoping by directory matches what `configure_database`
    already does with the database itself.

    The path is hashed rather than embedded: a data directory is an absolute
    path that may contain spaces, `/`, and the user's name, none of which
    belong in an identifier that appears in `security` output.
    """

    digest = hashlib.sha256(str(data_dir.resolve()).encode("utf-8")).hexdigest()
    return f"{KEYCHAIN_SERVICE}.{digest[:16]}"


def get_secret_store() -> SecretStore:
    """Pick the store this host can actually use.

    The app is macOS-first; the non-darwin branch exists so the suite runs on
    a Linux CI runner and is *not* a supported durable backend. Anything
    stored there is gone when the process exits.

    `settings` is read here rather than at import so the store follows whatever
    `LEARN_NODES_DATA_DIR` the process was launched with, the same way
    `_default_cors_origins` reads its port at instantiation.
    """

    if sys.platform == "darwin":
        return KeychainSecretStore(service=keychain_service_for(settings.data_dir))
    return _fallback_store
