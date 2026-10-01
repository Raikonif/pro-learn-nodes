"""Alembic migration entry point with a recoverable pre-migration backup."""

from datetime import UTC, datetime
from pathlib import Path
import shutil

from alembic import command
from alembic.config import Config


def backup_database(database_path: Path) -> Path | None:
    """Create a timestamped copy before changing an existing database."""

    if not database_path.exists() or database_path.stat().st_size == 0:
        return None
    backup_dir = database_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"{database_path.stem}-{stamp}{database_path.suffix}"
    shutil.copy2(database_path, backup_path)
    return backup_path


def migrate_database(database_path: Path) -> None:
    """Upgrade a local database to head without relying on process CWD."""

    backup_database(database_path)
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path}")
    command.upgrade(config, "head")
