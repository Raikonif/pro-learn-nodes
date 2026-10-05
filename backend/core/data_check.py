"""Is the data folder usable? Answered before anything writes to it.

The desktop shell restores from another copy when the answer is no
(`data-location`), so the check must run before the pre-migration backup:
backing up a damaged database would make the damage the newest "good" copy.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

DATABASE_NAME = "workspace.sqlite3"


class DataStatus(StrEnum):
    PENDING = "pending"
    OK = "ok"
    MISSING = "missing"
    DAMAGED = "damaged"


@dataclass(frozen=True)
class DataReport:
    status: DataStatus
    detail: str | None = None


class DataUnusable(Exception):
    """The data folder is missing or its database is damaged."""

    def __init__(self, report: DataReport) -> None:
        super().__init__(report.detail or report.status)
        self.report = report


def check_data(data_dir: Path, *, require_existing: bool) -> DataReport:
    """`ok`, `missing`, or `damaged`, without changing anything on disk.

    A database that does not exist yet is fine — a first start, or a folder
    that has only ever held agent directories. A folder that does not exist is
    fine too, unless it is one the learner chose: then it is `missing`.
    """

    if not data_dir.exists():
        if require_existing:
            return DataReport(DataStatus.MISSING, f"The data folder {data_dir} does not exist or is not connected.")
        return DataReport(DataStatus.OK)
    if not data_dir.is_dir():
        return DataReport(DataStatus.DAMAGED, f"{data_dir} is not a folder.")
    database = data_dir / DATABASE_NAME
    if not database.exists():
        return DataReport(DataStatus.OK)
    try:
        # Read-only, so a damaged file is never "repaired" into something else.
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=5)
        try:
            rows = connection.execute("PRAGMA quick_check").fetchall()
        finally:
            connection.close()
    except sqlite3.Error as error:
        return DataReport(DataStatus.DAMAGED, f"The database cannot be opened: {error}")
    problems = [row[0] for row in rows if row and row[0] != "ok"]
    if problems:
        return DataReport(DataStatus.DAMAGED, f"The database failed its integrity check: {problems[0]}")
    return DataReport(DataStatus.OK)
