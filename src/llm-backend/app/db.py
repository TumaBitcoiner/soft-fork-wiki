import sqlite3
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS explanations (
    bip_number INTEGER NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bip_number, model, prompt_version)
);

CREATE TABLE IF NOT EXISTS answers (
    bip_number INTEGER NOT NULL,
    question TEXT NOT NULL,
    question_hash TEXT NOT NULL,
    answer TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bip_number, question_hash, model, prompt_version)
);

CREATE TABLE IF NOT EXISTS last_answers (
    bip_number INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bip_number, model, prompt_version)
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
