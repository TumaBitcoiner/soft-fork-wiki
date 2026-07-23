import logging
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query

from . import db, ingest
from .config import load_config


logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("soft_fork_bips")


def init_app() -> FastAPI:
    app = FastAPI(title="Soft Fork BIPs API")
    config = load_config()
    repo_path = config.bips_repo_path
    db_path = config.bips_db_path
    logger.info("Using BIP repo at %s", repo_path)

    connection = db.connect(db_path)
    db.init_db(connection)
    cursor = connection.cursor()
    cursor.execute("SELECT COUNT(*) FROM bips")
    row = cursor.fetchone()
    existing_count = row[0] if row else 0
    if existing_count == 0:
        ingested = ingest.ingest_repo(connection, repo_path)
        logger.info("Ingested %s BIPs into %s", ingested, db_path)
    else:
        logger.info("Using existing DB with %s BIPs at %s", existing_count, db_path)
    connection.close()

    def db_dependency():
        connection = db.connect(db_path)
        try:
            yield connection
        finally:
            connection.close()

    @app.get("/bips")
    def list_bips(
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        connection=Depends(db_dependency),
    ) -> List[dict]:
        cursor = connection.cursor()
        if status:
            cursor.execute(
                """
                SELECT * FROM bips
                WHERE status = ?
                ORDER BY bip_number ASC
                LIMIT ? OFFSET ?
                """,
                (status, limit, offset),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM bips
                ORDER BY bip_number ASC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    @app.get("/bips/meta")
    def list_bips_meta(
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        connection=Depends(db_dependency),
    ) -> List[dict]:
        cursor = connection.cursor()
        columns = "bip_number, title, status, layer, type, authors, created, file_path, ingested_at"
        if status:
            cursor.execute(
                f"""
                SELECT {columns} FROM bips
                WHERE status = ?
                ORDER BY bip_number ASC
                LIMIT ? OFFSET ?
                """,
                (status, limit, offset),
            )
        else:
            cursor.execute(
                f"""
                SELECT {columns} FROM bips
                ORDER BY bip_number ASC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    @app.get("/bips/{bip_number}")
    def get_bip(
        bip_number: int,
        connection=Depends(db_dependency),
    ) -> dict:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT * FROM bips
            WHERE bip_number = ?
            """,
            (bip_number,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="BIP not found")
        return dict(row)

    @app.get("/bips/{bip_number}/meta")
    def get_bip_meta(
        bip_number: int,
        connection=Depends(db_dependency),
    ) -> dict:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT bip_number, title, status, layer, type, authors, created, file_path, ingested_at
            FROM bips
            WHERE bip_number = ?
            """,
            (bip_number,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="BIP not found")
        return dict(row)

    return app


app = init_app()
