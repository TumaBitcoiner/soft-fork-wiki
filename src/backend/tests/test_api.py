from pathlib import Path

import httpx
import pytest

from app.config import AppConfig
from app.main import create_app


def _write_bip(repo_path: Path, number: int = 119) -> None:
    repo_path.mkdir()
    (repo_path / f"bip-{number:04d}.mediawiki").write_text(
        f"""<pre>
  BIP: {number}
  Layer: Consensus (soft fork)
  Title: Local test BIP
  Author: Test Author
  Status: Draft
  Created: 2026-07-23
</pre>

==Abstract==
Local test content.
""",
        encoding="utf-8",
    )


def _app(tmp_path: Path):
    repo_path = tmp_path / "bitcoin-bips"
    _write_bip(repo_path)
    database_url = f"sqlite:///{tmp_path / 'app.sqlite'}"
    config = AppConfig(
        bips_repo_path=repo_path,
        database_url=database_url,
        db_path=tmp_path / "app.sqlite",
        admin_token="test-token",
        cors_origins=(
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ),
        llm_base_url="http://localhost:8001",
    )
    return create_app(config)


@pytest.mark.anyio
async def test_health_and_bip_list(tmp_path: Path) -> None:
    app = _app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            health = await client.get("/health")
            response = await client.get("/api/bips")

    assert health.status_code == 200
    assert health.json()["bipCount"] == 1
    assert response.status_code == 200
    assert response.json()[0] == {
        "number": 119,
        "title": "Local test BIP",
        "authors": ["Test Author"],
        "status": "Draft",
        "layer": "Consensus (soft fork)",
        "created": "2026-07-23",
        "content": response.json()[0]["content"],
        "sourceUrl": "https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki",
        "plainSummary": "",
        "summary": "",
        "inPlainTerms": "",
        "whatItChanges": [],
        "caseFor": [],
        "caseAgainst": [],
        "stillUnclear": [],
        "whyItMatters": "",
        "whatChanged": "",
        "risks": "",
        "topic": "Consensus",
        "era": "",
        "difficulty": "Advanced",
        "tags": ["soft-fork", "draft"],
        "relatedBips": [],
        "citations": [{
            "id": "bip-119-source",
            "label": "BIP 119",
            "section": "Source",
            "url": "https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki",
            "excerpt": "",
        }],
        "generationStatus": "missing",
    }


@pytest.mark.anyio
async def test_bip_detail_metadata_and_missing_response(tmp_path: Path) -> None:
    app = _app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            detail = await client.get("/api/bips/119")
            metadata = await client.get("/api/bips/119/meta")
            missing = await client.get("/api/bips/999")

    assert detail.status_code == 200
    assert "Local test content" in detail.json()["content"]
    assert metadata.status_code == 200
    assert metadata.json()["content"] == ""
    assert missing.status_code == 404
    assert missing.json() == {"detail": "BIP not found"}


@pytest.mark.anyio
async def test_local_cors_origin(tmp_path: Path) -> None:
    app = _app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            response = await client.options(
                "/api/bips",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "GET",
                },
            )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
