import hashlib
import logging
from datetime import datetime, timezone
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from . import db, llm, repo
from .config import load_config


logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("soft_fork_bips_llm")

class ExplainRequest(BaseModel):
    bip_number: int


class AskRequest(BaseModel):
    bip_number: int
    question: str


def normalize_question(question: str) -> str:
    return " ".join(question.strip().lower().split())


def question_hash(question: str) -> str:
    normalized = normalize_question(question)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def init_app() -> FastAPI:
    app = FastAPI(title="Soft Fork BIPs LLM API")
    config = load_config()
    explain_db_path = config.explain_db_path
    connection = db.connect(explain_db_path)
    db.init_db(connection)
    connection.close()
    logger.info("LLM cache DB at %s", explain_db_path)

    def db_dependency() -> Generator:
        connection = db.connect(explain_db_path)
        try:
            yield connection
        finally:
            connection.close()

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

    return app


app = init_app()
