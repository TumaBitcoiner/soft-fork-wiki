import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator

import httpx
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ValidationError

from . import db, llm, overview, repo
from .config import LlmConfig, load_config


logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("soft_fork_bips_llm")
OVERVIEW_PROMPT_VERSION = "overview-v2"


def validation_error_summary(error: Exception) -> str:
    if isinstance(error, ValidationError):
        return "; ".join(
            ".".join(str(part) for part in item["loc"]) + f": {item['type']}"
            for item in error.errors(include_input=False)
        )
    return str(error)


class ExplainRequest(BaseModel):
    bip_number: int


class AskRequest(BaseModel):
    bip_number: int
    question: str


class OverviewRequest(BaseModel):
    bip_number: int


def normalize_question(question: str) -> str:
    return " ".join(question.strip().lower().split())


def question_hash(question: str) -> str:
    normalized = normalize_question(question)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def init_app(config_override: LlmConfig | None = None) -> FastAPI:
    app = FastAPI(title="Soft Fork BIPs LLM API")
    config = config_override or load_config()
    explain_db_path = config.explain_db_path
    connection = db.connect(explain_db_path)
    db.init_db(connection)
    connection.close()
    logger.info("LLM cache DB at %s", explain_db_path)

    async def db_dependency() -> AsyncGenerator:
        connection = db.connect(explain_db_path)
        try:
            yield connection
        finally:
            connection.close()

    def get_bundle(bip_number: int) -> overview.SourceBundle:
        try:
            return overview.build_source_bundle(
                config.bips_repo_path,
                bip_number,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def cached_overview(
        connection,
        bundle: overview.SourceBundle,
    ) -> overview.OverviewResponse | None:
        row = connection.execute(
            """
            SELECT payload_json, created_at, updated_at
            FROM overview_enrichments
            WHERE bip_number = ? AND model = ? AND prompt_version = ?
              AND source_hash = ?
            """,
            (
                bundle.target_bip,
                config.ppq_model,
                OVERVIEW_PROMPT_VERSION,
                bundle.source_hash,
            ),
        ).fetchone()
        if not row:
            return None
        payload = json.loads(row["payload_json"])
        return overview.OverviewResponse(
            **payload,
            model=config.ppq_model,
            promptVersion=OVERVIEW_PROMPT_VERSION,
            sourceHash=bundle.source_hash,
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            cached=True,
        )

    async def generate_overview(
        connection,
        bundle: overview.SourceBundle,
    ) -> overview.OverviewResponse:
        source_text = bundle.prompt_text()
        raw = await llm.request_overview(
            source_text,
            bundle.target_bip,
            config.ppq_model,
            config.ppq_api_key,
        )
        try:
            draft = overview.OverviewDraft.model_validate(
                overview.parse_json_object(raw)
            )
            overview.validate_overview(draft, bundle)
        except (ValueError, json.JSONDecodeError) as first_error:
            logger.warning(
                "Overview %s initial validation failed: %s",
                bundle.target_bip,
                validation_error_summary(first_error),
            )
            repaired = await llm.request_overview_repair(
                source_text,
                bundle.target_bip,
                raw,
                str(first_error),
                config.ppq_model,
                config.ppq_api_key,
            )
            try:
                draft = overview.OverviewDraft.model_validate(
                    overview.parse_json_object(repaired)
                )
                overview.validate_overview(draft, bundle)
            except (ValueError, json.JSONDecodeError) as repair_error:
                logger.warning(
                    "Overview %s repair validation failed: %s",
                    bundle.target_bip,
                    validation_error_summary(repair_error),
                )
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Overview validation failed: "
                        f"{validation_error_summary(repair_error)}"
                    ),
                ) from repair_error

        verifier_raw = await llm.request_overview_verification(
            source_text,
            draft.model_dump_json(),
            bundle.target_bip,
            config.ppq_model,
            config.ppq_api_key,
        )
        try:
            verification = overview.VerificationDraft.model_validate(
                overview.parse_json_object(verifier_raw)
            )
            verified_draft = overview.apply_verification(draft, verification)
            payload = overview.validate_overview(verified_draft, bundle)
        except (ValueError, json.JSONDecodeError) as exc:
            logger.warning(
                "Overview %s verification failed: %s",
                bundle.target_bip,
                validation_error_summary(exc),
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Overview verification failed: "
                    f"{validation_error_summary(exc)}"
                ),
            ) from exc

        payload.update(
            {
                "bipNumber": bundle.target_bip,
                "relatedBips": bundle.related_bips,
                "analyzedBips": bundle.analyzed_bips,
                "generationStatus": "ai-generated",
            }
        )
        timestamp = datetime.now(timezone.utc).isoformat()
        connection.execute(
            """
            INSERT INTO overview_enrichments (
                bip_number, model, prompt_version, source_hash, payload_json,
                source_bips_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bip_number, model, prompt_version, source_hash)
            DO UPDATE SET
                payload_json=excluded.payload_json,
                source_bips_json=excluded.source_bips_json,
                updated_at=excluded.updated_at
            """,
            (
                bundle.target_bip,
                config.ppq_model,
                OVERVIEW_PROMPT_VERSION,
                bundle.source_hash,
                json.dumps(payload),
                json.dumps(bundle.analyzed_bips),
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT created_at, updated_at
            FROM overview_enrichments
            WHERE bip_number = ? AND model = ? AND prompt_version = ?
              AND source_hash = ?
            """,
            (
                bundle.target_bip,
                config.ppq_model,
                OVERVIEW_PROMPT_VERSION,
                bundle.source_hash,
            ),
        ).fetchone()
        return overview.OverviewResponse(
            **payload,
            model=config.ppq_model,
            promptVersion=OVERVIEW_PROMPT_VERSION,
            sourceHash=bundle.source_hash,
            createdAt=row["created_at"],
            updatedAt=row["updated_at"],
            cached=False,
        )

    async def run_overview(
        connection,
        bip_number: int,
        force: bool = False,
    ) -> overview.OverviewResponse:
        bundle = get_bundle(bip_number)
        if not force:
            cached = cached_overview(connection, bundle)
            if cached:
                return cached
        if not config.ppq_api_key or config.ppq_api_key == "API-KEY-HERE":
            raise HTTPException(
                status_code=503,
                detail="LLM API key is not configured",
            )
        try:
            return await generate_overview(connection, bundle)
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504,
                detail="Overview generation timed out",
            ) from exc
        except httpx.HTTPStatusError as exc:
            status = 401 if exc.response.status_code == 401 else 502
            detail = (
                "LLM API key was rejected"
                if status == 401
                else "LLM provider rejected Overview generation"
            )
            raise HTTPException(status_code=status, detail=detail) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503,
                detail="LLM provider unavailable",
            ) from exc

    @app.post("/explain")
    def explain(
        payload: ExplainRequest,
        connection=Depends(db_dependency),
    ) -> dict:
        content = repo.get_bip_content(config.bips_db_path, payload.bip_number)
        if not content:
            raise HTTPException(status_code=404, detail="BIP not found")

        model = config.ppq_model
        prompt_version = config.prompt_version
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT summary, created_at, updated_at
            FROM explanations
            WHERE bip_number = ? AND model = ? AND prompt_version = ?
            """,
            (payload.bip_number, model, prompt_version),
        )
        row = cursor.fetchone()
        if row:
            return {
                "bip_number": payload.bip_number,
                "summary": row[0],
                "model": model,
                "prompt_version": prompt_version,
                "created_at": row[1],
                "updated_at": row[2],
                "cached": True,
            }

        summary = llm.request_summary(content, model, config.summary_words, config.ppq_api_key)
        summary = llm.trim_words(summary, config.summary_words)
        timestamp = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            """
            INSERT INTO explanations (
                bip_number, model, prompt_version, summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (payload.bip_number, model, prompt_version, summary, timestamp, timestamp),
        )
        connection.commit()
        return {
            "bip_number": payload.bip_number,
            "summary": summary,
            "model": model,
            "prompt_version": prompt_version,
            "created_at": timestamp,
            "updated_at": timestamp,
            "cached": False,
        }

    @app.post("/ask")
    def ask(
        payload: AskRequest,
        connection=Depends(db_dependency),
    ) -> dict:
        content = repo.get_bip_content(config.bips_db_path, payload.bip_number)
        if not content:
            raise HTTPException(status_code=404, detail="BIP not found")

        model = config.ppq_model
        prompt_version = config.prompt_version
        query_hash = question_hash(payload.question)
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT answer, question, created_at, updated_at
            FROM answers
            WHERE bip_number = ? AND question_hash = ? AND model = ? AND prompt_version = ?
            """,
            (payload.bip_number, query_hash, model, prompt_version),
        )
        row = cursor.fetchone()
        timestamp = datetime.now(timezone.utc).isoformat()
        if row:
            cursor.execute(
                """
                INSERT INTO last_answers (
                    bip_number, question, answer, model, prompt_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bip_number, model, prompt_version) DO UPDATE SET
                    question=excluded.question,
                    answer=excluded.answer,
                    updated_at=excluded.updated_at
                """,
                (payload.bip_number, row[1], row[0], model, prompt_version, timestamp, timestamp),
            )
            connection.commit()
            return {
                "bip_number": payload.bip_number,
                "question": row[1],
                "answer": row[0],
                "model": model,
                "prompt_version": prompt_version,
                "created_at": row[2],
                "updated_at": row[3],
                "cached": True,
            }

        answer = llm.request_answer(content, payload.question, model, config.ppq_api_key)
        timestamp = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            """
            INSERT INTO answers (
                bip_number, question, question_hash, answer, model, prompt_version,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.bip_number,
                payload.question,
                query_hash,
                answer,
                model,
                prompt_version,
                timestamp,
                timestamp,
            ),
        )
        cursor.execute(
            """
            INSERT INTO last_answers (
                bip_number, question, answer, model, prompt_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bip_number, model, prompt_version) DO UPDATE SET
                question=excluded.question,
                answer=excluded.answer,
                updated_at=excluded.updated_at
            """,
            (
                payload.bip_number,
                payload.question,
                answer,
                model,
                prompt_version,
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
        return {
            "bip_number": payload.bip_number,
            "question": payload.question,
            "answer": answer,
            "model": model,
            "prompt_version": prompt_version,
            "created_at": timestamp,
            "updated_at": timestamp,
            "cached": False,
        }

    @app.post("/explain/refresh")
    def explain_refresh(
        payload: ExplainRequest,
        connection=Depends(db_dependency),
    ) -> dict:
        content = repo.get_bip_content(config.bips_db_path, payload.bip_number)
        if not content:
            raise HTTPException(status_code=404, detail="BIP not found")

        model = config.ppq_model
        prompt_version = config.prompt_version
        summary = llm.request_summary(content, model, config.summary_words, config.ppq_api_key)
        summary = llm.trim_words(summary, config.summary_words)
        timestamp = datetime.now(timezone.utc).isoformat()
        cursor = connection.cursor()
        cursor.execute(
            """
            INSERT INTO explanations (
                bip_number, model, prompt_version, summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(bip_number, model, prompt_version) DO UPDATE SET
                summary=excluded.summary,
                updated_at=excluded.updated_at
            """,
            (payload.bip_number, model, prompt_version, summary, timestamp, timestamp),
        )
        connection.commit()
        return {
            "bip_number": payload.bip_number,
            "summary": summary,
            "model": model,
            "prompt_version": prompt_version,
            "created_at": timestamp,
            "updated_at": timestamp,
            "cached": False,
        }

    @app.get("/last-answer/{bip_number}")
    def last_answer(
        bip_number: int,
        connection=Depends(db_dependency),
    ) -> dict:
        model = config.ppq_model
        prompt_version = config.prompt_version
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT question, answer, created_at, updated_at
            FROM last_answers
            WHERE bip_number = ? AND model = ? AND prompt_version = ?
            """,
            (bip_number, model, prompt_version),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Last answer not found")
        return {
            "bip_number": bip_number,
            "question": row[0],
            "answer": row[1],
            "model": model,
            "prompt_version": prompt_version,
            "created_at": row[2],
            "updated_at": row[3],
        }

    @app.get(
        "/overview/{bip_number}",
        response_model=overview.OverviewResponse,
    )
    async def get_overview(
        bip_number: int,
        connection=Depends(db_dependency),
    ) -> overview.OverviewResponse:
        bundle = get_bundle(bip_number)
        cached = cached_overview(connection, bundle)
        if not cached:
            raise HTTPException(status_code=404, detail="Overview not generated")
        return cached

    @app.post("/overview", response_model=overview.OverviewResponse)
    async def create_overview(
        payload: OverviewRequest,
        connection=Depends(db_dependency),
    ) -> overview.OverviewResponse:
        return await run_overview(connection, payload.bip_number)

    @app.post("/overview/refresh", response_model=overview.OverviewResponse)
    async def refresh_overview(
        payload: OverviewRequest,
        connection=Depends(db_dependency),
    ) -> overview.OverviewResponse:
        return await run_overview(connection, payload.bip_number, force=True)

    return app


app = init_app()
