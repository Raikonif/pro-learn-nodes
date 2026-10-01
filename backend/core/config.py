"""Application settings.

Backed by `pydantic-settings`, which lets configuration come from the
process environment (and an optional `.env` file) with the same typed
validation the rest of the app uses via Pydantic models. Defaults below
match the dev loop so the suite stays green without any extra setup.
"""

import os
from pathlib import Path
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Kept in sync with `scripts/dev-ports.mjs`. The launcher allocates both
# ports up front and exports them, so these literals are only reached when
# the backend is started on its own — `uv run uvicorn`, a bare sidecar, or
# the test suite.
DEFAULT_FRONTEND_PORT = 5177
DEFAULT_BACKEND_PORT = 8009


def _default_cors_origins() -> tuple[str, ...]:
    """Build the fallback allowlist from the allocated frontend port.

    Read at instantiation rather than import so the value tracks whatever
    the launcher allocated, including when the default port was taken and
    the allocator moved on. A browser treats `localhost` and `127.0.0.1`
    as different origins, so a single entry would strand whichever half
    the developer happened to type.
    """

    raw = os.environ.get("LEARN_NODES_FRONTEND_PORT", "")
    try:
        port = int(raw)
    except ValueError:
        # A malformed injection is not worth failing startup over: the
        # allowlist is a bypass-the-proxy fallback, not the request path.
        port = DEFAULT_FRONTEND_PORT

    return (f"http://localhost:{port}", f"http://127.0.0.1:{port}")


class Settings(BaseSettings):
    """Process-wide settings.

    The model is effectively immutable: `model_config.frozen = True` blocks
    post-init mutation, and `Settings()` is instantiated once at module
    import time and re-exported as `settings`.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = Field(default="Learn Nodes API")

    # The production Tauri shell supplies this explicitly. Keeping a stable
    # development default makes manual runs predictable while tests override
    # it with a temporary directory.
    data_dir: Path = Field(
        default_factory=lambda: Path.cwd() / ".learn-nodes-data",
        validation_alias=AliasChoices("LEARN_NODES_DATA_DIR"),
    )

    # Alias-only (hence no `populate_by_name`): a stray `PORT` in the
    # environment — CI runners and process managers set one freely — must
    # not silently move the port the frontend proxy was told to target.
    port: int = Field(
        default=DEFAULT_BACKEND_PORT,
        validation_alias=AliasChoices("LEARN_NODES_BACKEND_PORT"),
    )

    # Gates a sign-in that enrolls an account with no credentials at all, so
    # it must never be true in a distributed build. Alias-only like `port`
    # and for a sharper reason: without `populate_by_name` the field name is
    # not a binding key, so nothing that names the setting the way the code
    # does — a config file, a serialized `Settings` dump — can turn it on.
    # Opening the gate takes the deliberate, launch-time act of exporting
    # `LEARN_NODES_DEV_AUTH`, which is what `local_data_lifespan` warns about.
    dev_auth_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("LEARN_NODES_DEV_AUTH"),
    )

    @field_validator("dev_auth_enabled", mode="after")
    @classmethod
    def _require_process_environment(cls, value: bool) -> bool:
        """Let only the real process environment open the gate.

        The alias keeps the field name from being a binding key, but it does
        not narrow which *source* may supply the alias: `model_config` sets
        `env_file=".env"`, and pydantic-settings resolves dotenv entries
        through the same aliases as the environment. A `.env` sitting beside
        the bundled sidecar would therefore enrol accounts with no
        credentials on a learner's machine — the one thing this flag exists
        to prevent. Re-reading `os.environ` here is the narrowing: whatever
        source proposed `True`, it stands only if the process was actually
        launched with the variable set.
        """

        if value and not os.environ.get("LEARN_NODES_DEV_AUTH"):
            return False
        return value

    # In the normal dev loop the browser never reaches this middleware —
    # Vite proxies `/api/*` server-side, so traffic is same-origin. This
    # list exists for the developer who deliberately points the frontend
    # at the backend origin directly. `NoDecode` keeps the env value a
    # plain comma-separated string instead of requiring JSON.
    cors_origins: Annotated[tuple[str, ...], NoDecode] = Field(
        default_factory=_default_cors_origins,
        validation_alias=AliasChoices(
            "LEARN_NODES_CORS_ORIGINS",
            "CORS_ORIGINS",
        ),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return value

    @field_validator("cors_origins", mode="after")
    @classmethod
    def _reject_wildcard(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        """Refuse `*` outright instead of trusting convention.

        This app holds BYOK provider keys, so any local process being able
        to call the API is a real exposure. Disabling `allow_credentials`
        (see `main.py`) makes a wildcard legal to a browser, which removes
        the accident that would otherwise have caught it — hence the
        explicit check.
        """

        if any("*" in origin for origin in value):
            raise ValueError(
                "cors_origins must be an explicit list of origins, never a "
                f"wildcard; got {value!r}"
            )
        return value


settings = Settings()
