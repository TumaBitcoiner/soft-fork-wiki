import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


HEADER_RE = re.compile(r"^\s*([A-Za-z0-9 -]+):\s*(.*)$")
HEADER_START_RE = re.compile(r"^\s*<pre>\s*$", re.IGNORECASE)
HEADER_END_RE = re.compile(r"^\s*</pre>\s*$", re.IGNORECASE)
HEADER_FENCE_RE = re.compile(r"^\s*```")
TARGET_LAYER = "Consensus (soft fork)"


@dataclass(frozen=True)
class BipRecord:
    bip_number: int
    title: str
    status: str
    layer: str
    type: Optional[str]
    authors: list[str]
    created: Optional[str]
    discussion: Optional[str]
    license: Optional[str]
    file_path: str
    source_url: str
    content: str
    content_hash: str
    ingested_at: str


def normalize_status_filter(status: str) -> str:
    return status.strip().lower()


def scan_bip_files(repo_path: Path) -> list[Path]:
    matches: list[Path] = []
    for pattern in ("bip-*.md", "bip-*.mediawiki"):
        matches.extend(repo_path.rglob(pattern))
    return sorted(matches)


def parse_header(content: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    in_pre_block = False
    in_fenced_block = False
    last_key: Optional[str] = None

    for line in content.splitlines():
        if HEADER_START_RE.match(line):
            in_pre_block = True
            continue
        if HEADER_END_RE.match(line):
            break
        if HEADER_FENCE_RE.match(line):
            if in_fenced_block:
                break
            in_fenced_block = True
            continue
        if not in_pre_block and not line.strip():
            if headers:
                break
            continue
        match = HEADER_RE.match(line)
        if not match:
            if (in_pre_block or in_fenced_block) and last_key and line[:1].isspace() and line.strip():
                headers[last_key] = f"{headers[last_key]} {line.strip()}"
            if headers and not (in_pre_block or in_fenced_block):
                break
            continue
        last_key = match.group(1).strip().lower()
        headers[last_key] = match.group(2).strip()

    return headers


def _parse_authors(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    return [
        author.strip()
        for author in re.split(r"\s*,\s*(?![^<]*>)|\s+and\s+", raw)
        if author.strip()
    ]


def build_record(
    file_path: Path,
    content: str,
    repo_path: Optional[Path] = None,
) -> Optional[BipRecord]:
    headers = parse_header(content)
    layer = headers.get("layer", "").strip()
    if layer.casefold() != TARGET_LAYER.casefold():
        return None
    bip_raw = headers.get("bip", "")
    if not bip_raw.isdigit():
        return None

    relative_path = (
        file_path.resolve().relative_to(repo_path.resolve()).as_posix()
        if repo_path
        else file_path.name
    )
    status_raw = headers.get("status", "").strip()
    if not status_raw:
        status_raw = "Unknown"
    return BipRecord(
        bip_number=int(bip_raw),
        title=headers.get("title", "").strip() or f"BIP {int(bip_raw)}",
        status=status_raw,
        layer=TARGET_LAYER,
        type=headers.get("type"),
        authors=_parse_authors(headers.get("author") or headers.get("authors")),
        created=headers.get("created") or headers.get("assigned"),
        discussion=headers.get("comments-uri") or headers.get("discussion"),
        license=headers.get("license"),
        file_path=relative_path,
        source_url=f"https://github.com/bitcoin/bips/blob/master/{relative_path}",
        content=content,
        content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
        ingested_at=datetime.now(timezone.utc).isoformat(),
    )


def load_records(repo_path: Path) -> list[BipRecord]:
    records: list[BipRecord] = []
    for file_path in scan_bip_files(repo_path):
        content = file_path.read_text(encoding="utf-8", errors="replace")
        record = build_record(file_path, content, repo_path)
        if record:
            records.append(record)
    return records


def upsert_records(
    connection: sqlite3.Connection,
    records: Iterable[BipRecord],
) -> int:
    changed = 0
    for record in records:
        before = connection.total_changes
        connection.execute(
            """
            INSERT INTO bips (
                bip_number, title, status, layer, type, authors, created,
                discussion, license, file_path, source_url, content,
                content_hash, ingested_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bip_number) DO UPDATE SET
                title=excluded.title,
                status=excluded.status,
                layer=excluded.layer,
                type=excluded.type,
                authors=excluded.authors,
                created=excluded.created,
                discussion=excluded.discussion,
                license=excluded.license,
                file_path=excluded.file_path,
                source_url=excluded.source_url,
                content=excluded.content,
                content_hash=excluded.content_hash,
                ingested_at=excluded.ingested_at
            WHERE bips.content_hash != excluded.content_hash
            """,
            (
                record.bip_number,
                record.title,
                record.status,
                record.layer,
                record.type,
                json.dumps(record.authors),
                record.created,
                record.discussion,
                record.license,
                record.file_path,
                record.source_url,
                record.content,
                record.content_hash,
                record.ingested_at,
            ),
        )
        changed += connection.total_changes - before
    connection.commit()
    return changed


def ingest_repo(connection: sqlite3.Connection, repo_path: Path) -> int:
    return upsert_records(connection, load_records(repo_path))
