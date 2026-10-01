from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path
import sys

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlmodel import SQLModel  # noqa: E402
import models.profile  # noqa: F401, E402
import models.workspace  # noqa: F401, E402
import models.agent  # noqa: F401, E402
import models.practice  # noqa: F401, E402
import models.memory  # noqa: F401, E402

config = context.config
if config.config_file_name is not None:
    # `disable_existing_loggers` defaults to True, which would set `disabled`
    # on every logger already built at import — including `core.runtime`'s.
    # The sidecar migrates during startup, so the default would silence the
    # application's own logging for the rest of the process, and the first
    # casualty is the warning that development sign-in is enabled.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
