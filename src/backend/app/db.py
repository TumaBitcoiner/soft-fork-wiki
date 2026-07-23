import sqlite3
from pathlib import Path
from typing import Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS bips (
    bip_number INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    layer TEXT NOT NULL,
    type TEXT,
    authors TEXT,
    created TEXT,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    ingested_at TEXT NOT NULL
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)
    connection.commit()


def stream_rows(cursor: sqlite3.Cursor) -> Iterator[sqlite3.Row]:
    for row in cursor:
        yield row
