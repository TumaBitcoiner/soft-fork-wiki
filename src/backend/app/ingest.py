import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional


HEADER_RE = re.compile(r"^\s*([A-Za-z0-9 -]+):\s*(.*)$")
HEADER_START_RE = re.compile(r"^\s*<pre>\s*$", re.IGNORECASE)
HEADER_END_RE = re.compile(r"^\s*</pre>\s*$", re.IGNORECASE)
SUPPORTED_STATUSES = {"Draft", "Complete", "Deployed"}
TARGET_LAYER = "Consensus (soft fork)"


@dataclass
class BipRecord:
    bip_number: int
    title: str
    status: str
    layer: str
    type: Optional[str]
    authors: Optional[str]
    created: Optional[str]
    file_path: str
    content: str
    ingested_at: str


def scan_bip_files(repo_path: Path) -> List[Path]:
    patterns = ["bip-*.md", "bip-*.mediawiki"]
    matches: List[Path] = []
    for pattern in patterns:
        matches.extend(repo_path.rglob(pattern))
    return matches


def parse_header(content: str) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    lines = content.splitlines()
    in_pre_block = False

    for line in lines:
        if HEADER_START_RE.match(line):
            in_pre_block = True
            continue
        if HEADER_END_RE.match(line):
            break
        if not in_pre_block and not line.strip():
            break
        if not in_pre_block and not headers and not HEADER_RE.match(line):
            continue
        if not in_pre_block and headers and not HEADER_RE.match(line):
            break
        match = HEADER_RE.match(line)
        if not match:
            continue
        key = match.group(1).strip().lower()
        value = match.group(2).strip()
        headers[key] = value

    return headers


def build_record(file_path: Path, content: str) -> Optional[BipRecord]:
    headers = parse_header(content)
    layer = headers.get("layer")
    status = headers.get("status")
    if not layer or not status:
        return None
    if layer.strip() != TARGET_LAYER:
        return None
    status_value = status.strip()
    if status_value not in SUPPORTED_STATUSES:
        return None
    bip_raw = headers.get("bip")
    if not bip_raw or not bip_raw.isdigit():
        return None
    ingested_at = datetime.now(timezone.utc).isoformat()
    return BipRecord(
        bip_number=int(bip_raw),
        title=headers.get("title", ""),
        status=status_value,
        layer=layer.strip(),
        type=headers.get("type"),
        authors=headers.get("author") or headers.get("authors"),
        created=headers.get("created"),
        file_path=str(file_path),
        content=content,
        ingested_at=ingested_at,
    )


def load_records(repo_path: Path) -> List[BipRecord]:
    records: List[BipRecord] = []
    for file_path in scan_bip_files(repo_path):
        content = file_path.read_text(encoding="utf-8", errors="replace")
        record = build_record(file_path, content)
        if record:
            records.append(record)
    return records


def upsert_records(connection: sqlite3.Connection, records: Iterable[BipRecord]) -> int:
    cursor = connection.cursor()
    count = 0
    for record in records:
        cursor.execute(
            """
            INSERT INTO bips (
                bip_number,
                title,
                status,
                layer,
                type,
                authors,
                created,
                file_path,
                content,
                ingested_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bip_number) DO UPDATE SET
                title=excluded.title,
                status=excluded.status,
                layer=excluded.layer,
                type=excluded.type,
                authors=excluded.authors,
                created=excluded.created,
                file_path=excluded.file_path,
                content=excluded.content,
                ingested_at=excluded.ingested_at
            """,
            (
                record.bip_number,
                record.title,
                record.status,
                record.layer,
                record.type,
                record.authors,
                record.created,
                record.file_path,
                record.content,
                record.ingested_at,
            ),
        )
        count += 1
    connection.commit()
    return count


def ingest_repo(connection: sqlite3.Connection, repo_path: Path) -> int:
    records = load_records(repo_path)
    return upsert_records(connection, records)
