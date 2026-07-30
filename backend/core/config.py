"""Application settings.

Backed by `pydantic-settings`, which lets configuration come from the
process environment (and an optional `.env` file) with the same typed
validation the rest of the app uses via Pydantic models. Defaults below
match the Phase 1 dev loop so the suite stays green without any extra
setup.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Tauri convention: the bundled webview and the Vite dev server both
    # reach the FastAPI sidecar over loopback. `127.0.0.1` and `localhost`
    # are distinct origins to the CORS middleware, so both must be listed.
    cors_origins: tuple[str, ...] = Field(
        default=(
            "http://localhost:1420",
            "http://127.0.0.1:1420",
        ),
    )


settings = Settings()