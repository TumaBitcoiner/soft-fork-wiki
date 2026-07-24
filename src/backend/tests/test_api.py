from pathlib import Path

import httpx
import pytest
from httpx import Request, Response

from app.config import AppConfig
from app.main import create_app
import app.main as main_module


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


class _MockLLMTransport(httpx.AsyncBaseTransport):
    async def handle_async_request(self, request: Request) -> Response:
        if "overview" in request.url.path:
            return Response(
                200,
                json={
                    "bipNumber": 119,
                    "plainSummary": {
                        "text": "A concise sourced summary.",
                        "basis": "stated",
                        "citations": [{
                            "bipNumber": 119,
                            "section": "Abstract",
                            "excerpt": "Local test content.",
                            "sourceUrl": "https://example.test/bip-0119.mediawiki",
                        }],
                    },
                    "inPlainTerms": {
                        "text": "A longer sourced explanation.",
                        "basis": "stated",
                        "citations": [{
                            "bipNumber": 119,
                            "section": "Abstract",
                            "excerpt": "Local test content.",
                            "sourceUrl": "https://example.test/bip-0119.mediawiki",
                        }],
                    },
                    "whatItChanges": [],
                    "benefits": [],
                    "tradeoffs": [],
                    "openQuestions": [],
                    "relatedBips": [],
                    "analyzedBips": [119],
                    "generationStatus": "ai-generated",
                    "model": "test-model",
                    "promptVersion": "overview-v1",
                    "sourceHash": "abc123",
                    "createdAt": "2026-07-24T00:00:00Z",
                    "updatedAt": "2026-07-24T00:00:00Z",
                    "cached": request.method == "GET",
                },
            )
        if "last-answer" in request.url.path:
            return Response(
                200,
                json={
                    "bip_number": 119,
                    "question": "What should I understand about BIP 119?",
                    "answer": "Latest cached answer.",
                    "model": "test-model",
                    "prompt_version": "v1",
                    "created_at": "2026-07-24T00:00:00Z",
                    "updated_at": "2026-07-24T00:00:00Z",
                },
            )
        return Response(404, json={"detail": "Not found"})


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


@pytest.mark.anyio
async def test_last_answer_proxy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    original_async_client = httpx.AsyncClient

    def _client_factory(*args, **kwargs):
        return original_async_client(transport=_MockLLMTransport(), base_url="http://llm")

    monkeypatch.setattr(main_module.httpx, "AsyncClient", _client_factory)

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            response = await client.get("/api/last-answer/119")

    assert response.status_code == 200
    assert response.json()["answer"] == "Latest cached answer."


@pytest.mark.anyio
async def test_overview_read_generate_and_admin_refresh_proxy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app(tmp_path)
    transport = httpx.ASGITransport(app=app)
    original_async_client = httpx.AsyncClient

    def _client_factory(*args, **kwargs):
        return original_async_client(transport=_MockLLMTransport(), base_url="http://llm")

    monkeypatch.setattr(main_module.httpx, "AsyncClient", _client_factory)

    async with app.router.lifespan_context(app):
        async with original_async_client(
            transport=transport,
            base_url="http://test",
        ) as client:
            cached = await client.get("/api/bips/119/overview")
            generated = await client.post("/api/bips/119/overview")
            denied = await client.post("/api/admin/bips/119/overview/refresh")
            refreshed = await client.post(
                "/api/admin/bips/119/overview/refresh",
                headers={"X-Admin-Token": "test-token"},
            )

    assert cached.status_code == 200
    assert cached.json()["cached"] is True
    assert generated.status_code == 200
    assert generated.json()["cached"] is False
    assert denied.status_code == 401
    assert refreshed.status_code == 200
