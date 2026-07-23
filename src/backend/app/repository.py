import subprocess
from pathlib import Path


BIPS_REPO_URL = "https://github.com/bitcoin/bips.git"


def ensure_bips_repo(repo_path: Path) -> bool:
    if repo_path.exists():
        if any(repo_path.glob("bip-*.md")) or any(repo_path.glob("bip-*.mediawiki")):
            return False
        raise RuntimeError(
            f"BIPS_REPO_PATH exists but does not look like bitcoin/bips: {repo_path}"
        )

    repo_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", BIPS_REPO_URL, str(repo_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(
            "Could not clone bitcoin/bips. Clone it manually with "
            f"`git clone {BIPS_REPO_URL} {repo_path}` or set BIPS_REPO_PATH."
        ) from exc
    return True


def refresh_bips_repo(repo_path: Path) -> None:
    ensure_bips_repo(repo_path)
    if not (repo_path / ".git").exists():
        raise RuntimeError(
            f"BIPS_REPO_PATH is not a Git checkout and cannot be refreshed: {repo_path}"
        )
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "pull", "--ff-only"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(f"Could not refresh bitcoin/bips at {repo_path}") from exc
