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
    authors TEXT NOT NULL DEFAULT '[]',
    created TEXT,
    discussion TEXT,
    license TEXT,
    file_path TEXT NOT NULL,
    source_url TEXT,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    ingested_at TEXT NOT NULL
);
"""

MIGRATION_COLUMNS = {
    "discussion": "TEXT",
    "license": "TEXT",
    "source_url": "TEXT",
    "content_hash": "TEXT NOT NULL DEFAULT ''",
}


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(bips)").fetchall()
    }
    for name, definition in MIGRATION_COLUMNS.items():
        if name not in columns:
            connection.execute(f"ALTER TABLE bips ADD COLUMN {name} {definition}")
    connection.commit()


def stream_rows(cursor: sqlite3.Cursor) -> Iterator[sqlite3.Row]:
    yield from cursor
