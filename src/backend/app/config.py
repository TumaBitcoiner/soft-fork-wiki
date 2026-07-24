import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = REPO_ROOT / "config.json"
load_dotenv(REPO_ROOT / ".env")


def _load_legacy_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path.resolve()


def _sqlite_path(database_url: str) -> Path:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise RuntimeError(
            "Only SQLite DATABASE_URL values are supported locally in Phase 1 "
            "(for example sqlite:///./data/app.sqlite)"
        )
    return _resolve_path(database_url.removeprefix(prefix))


@dataclass(frozen=True)
class AppConfig:
    bips_repo_path: Path
    database_url: str
    db_path: Path
    admin_token: str
    cors_origins: tuple[str, ...]
    llm_base_url: str


def load_config() -> AppConfig:
    legacy = _load_legacy_config()
    repo_value = os.getenv(
        "BIPS_REPO_PATH",
        str(legacy.get("bips_repo_path", "./data/bitcoin-bips")),
    )
    database_url = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{legacy.get('bips_db_path', './data/app.sqlite')}",
    )
    cors_origins = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    )
    return AppConfig(
        bips_repo_path=_resolve_path(repo_value),
        database_url=database_url,
        db_path=_sqlite_path(database_url),
        admin_token=os.getenv("ADMIN_TOKEN", "change-me"),
        cors_origins=cors_origins,
        llm_base_url=os.getenv("LLM_BASE_URL", "http://localhost:8001"),
    )
