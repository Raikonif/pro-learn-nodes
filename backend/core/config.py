"""Application settings.

Minimal placeholder using only the existing dependency set. Real configuration
loading (env files, secrets, provider keys) lands with the data-model and
provider phases, at which point this may move to pydantic-settings.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    app_name: str = "Learn Nodes API"
    cors_origins: tuple[str, ...] = field(default=("http://localhost:1420",))


settings = Settings()
