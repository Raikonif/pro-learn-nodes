"""SQLite engine lifecycle for the local sidecar.

The engine is configured deliberately at application startup instead of at
module import. That makes each test able to use its own data directory and
lets the production sidecar receive its app-data directory from Tauri.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, event
from sqlmodel import Session, create_engine

_engine: Engine | None = None
_database_path: Path | None = None


def configure_database(data_dir: Path) -> Engine:
    """Create (or reuse) the SQLite engine rooted in ``data_dir``."""

    global _database_path, _engine
    database_path = data_dir / "workspace.sqlite3"
    if _engine is not None and _database_path == database_path:
        return _engine

    if _engine is not None:
        _engine.dispose()
    data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False, "timeout": 5},
    )

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.close()

    _engine = engine
    _database_path = database_path
    return engine


def database_path() -> Path:
    if _database_path is None:
        raise RuntimeError("Database has not been configured")
    return _database_path


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database has not been configured")
    return _engine


@contextmanager
def session_scope() -> Iterator[Session]:
    """Commit a complete domain operation or roll it back as one unit."""

    with Session(get_engine(), expire_on_commit=False) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def get_session() -> Iterator[Session]:
    """FastAPI dependency for a ready application's request scope."""

    with Session(get_engine(), expire_on_commit=False) as session:
        yield session
