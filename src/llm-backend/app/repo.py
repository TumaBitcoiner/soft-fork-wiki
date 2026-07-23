import sqlite3
from pathlib import Path
from typing import Optional


def get_bip_content(db_path: Path, bip_number: int) -> Optional[str]:
    connection = sqlite3.connect(db_path)
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT content FROM bips WHERE bip_number = ?", (bip_number,))
        row = cursor.fetchone()
        if not row:
            return None
        return row[0]
    finally:
        connection.close()
