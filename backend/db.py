import json
import logging
import sqlite3
import time

from config import DB_PATH

log = logging.getLogger(__name__)

SCRAPE_CACHE_TTL = 4 * 60 * 60  # 4 hours in seconds


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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scrape_cache (
            cache_key TEXT PRIMARY KEY,
            listings_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()
    log.info("DB initialized at %s", DB_PATH)


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


def get_cached_scrape(source: str, city: str, params_hash: str) -> list[dict] | None:
    """Get cached scraper results if they exist and are within TTL."""
    cache_key = f"{source}:{city}:{params_hash}"
    conn = get_conn()
    row = conn.execute(
        "SELECT listings_json, cached_at FROM scrape_cache WHERE cache_key = ?",
        (cache_key,),
    ).fetchone()
    conn.close()

    if row:
        age = int(time.time()) - row["cached_at"]
        if age < SCRAPE_CACHE_TTL:
            log.info("Cache HIT for %s (age: %dm)", cache_key, age // 60)
            return json.loads(row["listings_json"])
        log.debug("Cache EXPIRED for %s (age: %dm)", cache_key, age // 60)

    return None


def cache_scrape(source: str, city: str, params_hash: str, listings: list[dict]):
    """Cache scraper results."""
    cache_key = f"{source}:{city}:{params_hash}"
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO scrape_cache (cache_key, listings_json, cached_at) VALUES (?, ?, ?)",
        (cache_key, json.dumps(listings), int(time.time())),
    )
    conn.commit()
    conn.close()
    log.info("Cached %d listings for %s", len(listings), cache_key)
