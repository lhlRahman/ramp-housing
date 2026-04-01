import logging
import sqlite3

from config import DB_PATH

log = logging.getLogger(__name__)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS geocache (
            address TEXT PRIMARY KEY,
            lat REAL,
            lng REAL,
            cached_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    """)
    conn.commit()
    conn.close()
    log.info("Geocache DB initialized at %s", DB_PATH)


def get_cached_coords(address: str) -> tuple[float, float] | None:
    conn = get_conn()
    row = conn.execute("SELECT lat, lng FROM geocache WHERE address = ?", (address,)).fetchone()
    conn.close()
    if row:
        return row["lat"], row["lng"]
    return None


def cache_coords(address: str, lat: float, lng: float):
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO geocache (address, lat, lng) VALUES (?, ?, ?)",
        (address, lat, lng),
    )
    conn.commit()
    conn.close()
