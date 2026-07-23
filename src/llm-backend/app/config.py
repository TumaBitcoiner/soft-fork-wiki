import json
from dataclasses import dataclass
from pathlib import Path


CONFIG_PATH = Path("config.json")


@dataclass
class LlmConfig:
    bips_db_path: Path
    explain_db_path: Path
    ppq_api_key: str
    ppq_model: str
    prompt_version: str
    summary_words: int


def load_config() -> LlmConfig:
    if not CONFIG_PATH.exists():
        raise RuntimeError("Missing config.json in repo root")
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    bips_db_path = Path(data.get("bips_db_path", "./bips.sqlite")).expanduser().resolve()
    explain_db_path = Path(data.get("explain_db_path", "./bips_explain.sqlite")).expanduser().resolve()
    if not bips_db_path.exists():
        raise RuntimeError(f"bips_db_path does not exist: {bips_db_path}")
    ppq_api_key = data.get("ppq_api_key", "")
    if not ppq_api_key:
        raise RuntimeError("ppq_api_key is required in config.json")
    return LlmConfig(
        bips_db_path=bips_db_path,
        explain_db_path=explain_db_path,
        ppq_api_key=ppq_api_key,
        ppq_model=data.get("ppq_model", "ppq-default"),
        prompt_version=data.get("prompt_version", "v1"),
        summary_words=int(data.get("summary_words", 250)),
    )
