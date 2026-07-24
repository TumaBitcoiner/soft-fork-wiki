import json
import logging
import sqlite3
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import db, ingest, repository
from .config import AppConfig, load_config
from .models import (
    AskRequest,
    AskResponse,
    BipOverviewResponse,
    BipResponse,
    ExplainRequest,
    ExplainResponse,
    HealthResponse,
    LastAnswerResponse,
    RefreshResponse,
)


logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("soft_fork_bips")


def _response_from_row(row: sqlite3.Row, include_content: bool = True) -> BipResponse:
    authors_raw = row["authors"]
    try:
        authors = json.loads(authors_raw) if authors_raw else []
    except json.JSONDecodeError:
        authors = [part.strip() for part in authors_raw.split(",") if part.strip()]
    source_url = row["source_url"]
    return BipResponse(
        number=row["bip_number"],
        title=row["title"],
        authors=authors,
        status=row["status"],
        layer=row["layer"],
        type=row["type"],
        created=row["created"],
        discussion=row["discussion"],
        license=row["license"],
        content=row["content"] if include_content else "",
        sourceUrl=source_url,
        tags=["soft-fork", row["status"].lower()],
        citations=(
            [{
                "id": f"bip-{row['bip_number']}-source",
                "label": f"BIP {row['bip_number']}",
                "section": "Source",
                "url": source_url or "",
                "excerpt": "",
            }]
            if source_url
            else []
        ),
    )


def create_app(config: Optional[AppConfig] = None) -> FastAPI:
    app_config = config or load_config()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        cloned = repository.ensure_bips_repo(app_config.bips_repo_path)
        connection = db.connect(app_config.db_path)
        try:
            db.init_db(connection)
            changed = ingest.ingest_repo(connection, app_config.bips_repo_path)
        finally:
            connection.close()
        logger.info(
            "%s bitcoin/bips; indexed %s changed BIPs in %s",
            "Cloned" if cloned else "Found",
            changed,
            app_config.db_path,
        )
        yield

    app = FastAPI(title="Soft Fork BIPs API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_config.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Admin-Token"],
    )

    async def db_dependency() -> AsyncIterator[sqlite3.Connection]:
        connection = db.connect(app_config.db_path)
        try:
            yield connection
        finally:
            connection.close()

    async def llm_request(
        method: str,
        path: str,
        payload: Optional[dict] = None,
        timeout: float = 60.0,
    ) -> dict:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(
                    method,
                    app_config.llm_base_url.rstrip("/") + path,
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503,
                detail="LLM backend unavailable",
            ) from exc
        if response.status_code != 200:
            try:
                detail = response.json().get("detail", response.text)
            except (ValueError, AttributeError):
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=detail)
        try:
            data = response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="Invalid LLM response")
        return data

    @app.get("/health", response_model=HealthResponse)
    async def health(connection: sqlite3.Connection = Depends(db_dependency)) -> HealthResponse:
        count = connection.execute("SELECT COUNT(*) FROM bips").fetchone()[0]
        return HealthResponse(
            status="ok",
            database=app_config.database_url,
            bipCount=count,
        )

    def list_bips(
        connection: sqlite3.Connection,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        include_content: bool = True,
    ) -> list[BipResponse]:
        query = "SELECT * FROM bips"
        params: list[object] = []
        if status:
            query += " WHERE lower(status) = ?"
            params.append(ingest.normalize_status_filter(status))
        query += " ORDER BY bip_number ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = connection.execute(query, params).fetchall()
        return [_response_from_row(row, include_content) for row in rows]

    def get_bip(
        bip_number: int,
        connection: sqlite3.Connection,
        include_content: bool = True,
    ) -> BipResponse:
        row = connection.execute(
            "SELECT * FROM bips WHERE bip_number = ?",
            (bip_number,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="BIP not found")
        return _response_from_row(row, include_content)

    @app.get(
        "/api/bips",
        response_model=list[BipResponse],
        response_model_exclude_none=True,
    )
    async def api_list_bips(
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        connection: sqlite3.Connection = Depends(db_dependency),
    ) -> list[BipResponse]:
        return list_bips(connection, status, limit, offset, True)

    @app.get(
        "/api/bips/meta",
        response_model=list[BipResponse],
        response_model_exclude_none=True,
    )
    async def api_list_bips_meta(
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        connection: sqlite3.Connection = Depends(db_dependency),
    ) -> list[BipResponse]:
        return list_bips(connection, status, limit, offset, False)

    @app.get(
        "/api/bips/{bip_number}",
        response_model=BipResponse,
        response_model_exclude_none=True,
    )
    async def api_get_bip(
        bip_number: int,
        connection: sqlite3.Connection = Depends(db_dependency),
    ) -> BipResponse:
        return get_bip(bip_number, connection, True)

    @app.get(
        "/api/bips/{bip_number}/meta",
        response_model=BipResponse,
        response_model_exclude_none=True,
    )
    async def api_get_bip_meta(
        bip_number: int,
        connection: sqlite3.Connection = Depends(db_dependency),
    ) -> BipResponse:
        return get_bip(bip_number, connection, False)

    @app.post("/api/admin/refresh-bips", response_model=RefreshResponse)
    async def refresh_bips(
        x_admin_token: Optional[str] = Header(default=None),
        connection: sqlite3.Connection = Depends(db_dependency),
    ) -> RefreshResponse:
        if not x_admin_token or x_admin_token != app_config.admin_token:
            raise HTTPException(status_code=401, detail="Invalid admin token")
        try:
            repository.refresh_bips_repo(app_config.bips_repo_path)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return RefreshResponse(
            changed=ingest.ingest_repo(connection, app_config.bips_repo_path)
        )

    @app.post("/api/explain", response_model=ExplainResponse)
    async def explain(payload: ExplainRequest) -> ExplainResponse:
        data = await llm_request("POST", "/explain", payload.model_dump())
        try:
            return ExplainResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    @app.post("/api/ask", response_model=AskResponse)
    async def ask(payload: AskRequest) -> AskResponse:
        data = await llm_request("POST", "/ask", payload.model_dump())
        try:
            return AskResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    @app.get("/api/last-answer/{bip_number}", response_model=LastAnswerResponse)
    async def last_answer(bip_number: int) -> LastAnswerResponse:
        data = await llm_request("GET", f"/last-answer/{bip_number}")
        try:
            return LastAnswerResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    @app.get(
        "/api/bips/{bip_number}/overview",
        response_model=BipOverviewResponse,
    )
    async def get_bip_overview(bip_number: int) -> BipOverviewResponse:
        data = await llm_request("GET", f"/overview/{bip_number}", timeout=300.0)
        try:
            return BipOverviewResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    @app.post(
        "/api/bips/{bip_number}/overview",
        response_model=BipOverviewResponse,
    )
    async def generate_bip_overview(bip_number: int) -> BipOverviewResponse:
        data = await llm_request(
            "POST",
            "/overview",
            {"bip_number": bip_number},
            timeout=300.0,
        )
        try:
            return BipOverviewResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    @app.post(
        "/api/admin/bips/{bip_number}/overview/refresh",
        response_model=BipOverviewResponse,
    )
    async def refresh_bip_overview(
        bip_number: int,
        x_admin_token: Optional[str] = Header(default=None),
    ) -> BipOverviewResponse:
        if not x_admin_token or x_admin_token != app_config.admin_token:
            raise HTTPException(status_code=401, detail="Invalid admin token")
        data = await llm_request(
            "POST",
            "/overview/refresh",
            {"bip_number": bip_number},
            timeout=300.0,
        )
        try:
            return BipOverviewResponse(**data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid LLM response") from exc

    return app


app = create_app()
