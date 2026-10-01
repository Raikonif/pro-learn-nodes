"""The gate on development sign-in.

Development sign-in enrolls an account with no credentials at all, so the
only thing standing between it and a distributed build is this flag being
off by default and unreachable from anything that ships inside the bundle.
These tests are the reason the gate stays shut: a suite that only exercised
the enabled path would pass with the default flipped.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi import FastAPI

from core import runtime
from core.config import Settings
from core.runtime import RuntimeState, local_data_lifespan

DEV_AUTH_ENV_VAR = "LEARN_NODES_DEV_AUTH"


@pytest.fixture
def unconfigured_env(monkeypatch):
    for name in (DEV_AUTH_ENV_VAR, "DEV_AUTH", "DEV_AUTH_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_dev_auth_is_off_when_nothing_asks_for_it(unconfigured_env):
    assert Settings().dev_auth_enabled is False


@pytest.mark.parametrize("raw", ["1", "true", "True", "yes", "on"])
def test_dev_auth_follows_the_environment(unconfigured_env, raw):
    unconfigured_env.setenv(DEV_AUTH_ENV_VAR, raw)

    assert Settings().dev_auth_enabled is True


@pytest.mark.parametrize("name", ["DEV_AUTH", "DEV_AUTH_ENABLED"])
def test_an_unprefixed_env_var_cannot_open_the_gate(unconfigured_env, name):
    """The alias is the whole gate, so only the exact name may open it."""

    unconfigured_env.setenv(name, "1")

    assert Settings().dev_auth_enabled is False


@pytest.fixture
def quiet_startup(monkeypatch, tmp_path: Path) -> FastAPI:
    """A lifespan that announces, without migrating or opening a database.

    The warning is a startup announcement rather than data work, and keeping
    this test off the migration path means a schema change cannot make it
    fail for a reason that has nothing to do with the gate.
    """

    monkeypatch.setattr(runtime, "initialize_local_data", lambda _data_dir: None)

    app = FastAPI()
    app.state.runtime = RuntimeState()
    app.state.data_dir = tmp_path
    return app


def _dev_auth_warnings(records: list[logging.LogRecord]) -> list[str]:
    return [
        record.getMessage()
        for record in records
        if record.levelno >= logging.WARNING and "development sign-in" in record.getMessage().lower()
    ]


async def test_startup_announces_an_open_gate(
    unconfigured_env, quiet_startup: FastAPI, caplog
):
    unconfigured_env.setenv(DEV_AUTH_ENV_VAR, "1")
    unconfigured_env.setattr(runtime, "settings", Settings())

    with caplog.at_level(logging.WARNING):
        async with local_data_lifespan(quiet_startup):
            pass

    assert _dev_auth_warnings(caplog.records)


async def test_startup_is_silent_when_the_gate_is_shut(
    unconfigured_env, quiet_startup: FastAPI, caplog
):
    unconfigured_env.setattr(runtime, "settings", Settings())

    with caplog.at_level(logging.WARNING):
        async with local_data_lifespan(quiet_startup):
            pass

    assert _dev_auth_warnings(caplog.records) == []


def test_a_dotenv_file_alone_cannot_open_the_gate(unconfigured_env, tmp_path: Path):
    """A `.env` is exactly the shape of thing that ships inside a bundle.

    `Settings.model_config` sets `env_file=".env"`, and pydantic-settings
    resolves dotenv entries through the same aliases as the process
    environment — so without an explicit check, a stray `.env` beside the
    sidecar would enrol accounts with no credentials on a learner's machine.
    The spec requires the gate be openable only by configuration supplied at
    launch, which a file carried in the build is not.
    """

    (tmp_path / ".env").write_text(f"{DEV_AUTH_ENV_VAR}=1\n")
    unconfigured_env.chdir(tmp_path)

    assert Settings().dev_auth_enabled is False


def test_a_dotenv_file_does_not_suppress_a_real_environment_variable(
    unconfigured_env, tmp_path: Path
):
    """The check narrows the sources, it does not add a second condition."""

    (tmp_path / ".env").write_text(f"{DEV_AUTH_ENV_VAR}=0\n")
    unconfigured_env.chdir(tmp_path)
    unconfigured_env.setenv(DEV_AUTH_ENV_VAR, "1")

    assert Settings().dev_auth_enabled is True
