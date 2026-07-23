import json
from dataclasses import dataclass
from pathlib import Path


CONFIG_PATH = Path("config.json")


@dataclass
class AppConfig:
    bips_repo_path: Path
    bips_db_path: Path


def load_config() -> AppConfig:
    if not CONFIG_PATH.exists():
        raise RuntimeError("Missing config.json in repo root")
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    repo_path = Path(data["bips_repo_path"]).expanduser().resolve()
    db_path = Path(data.get("bips_db_path", "./bips.sqlite")).expanduser().resolve()
    if not repo_path.exists():
        raise RuntimeError(f"bips_repo_path does not exist: {repo_path}")
    return AppConfig(bips_repo_path=repo_path, bips_db_path=db_path)
