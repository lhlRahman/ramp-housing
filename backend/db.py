import json
import logging
import sqlite3
import time
from typing import Any

from config import DB_PATH

log = logging.getLogger(__name__)

SCRAPE_CACHE_TTL = 4 * 60 * 60  # 4 hours


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_conn()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS renter_profiles (
                phone TEXT PRIMARY KEY,
                name TEXT,
                current_city TEXT,
                move_in_date TEXT,
                budget_max INTEGER,
                income_range TEXT,
                credit_score_range TEXT,
                pets TEXT,
                smoker INTEGER DEFAULT 0,
                guarantor INTEGER DEFAULT 0,
                dealbreakers TEXT,
                free_text_context TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS outreach (
                outreach_id TEXT PRIMARY KEY,
                renter_phone TEXT NOT NULL,
                listing_id TEXT NOT NULL,
                listing_json TEXT NOT NULL,
                landlord_phone TEXT,
                channel TEXT NOT NULL,
                custom_message TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                conversation_id TEXT,
                scam_flags TEXT,
                negotiation_result TEXT,
                tour_time TEXT,
                summary TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS outreach_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                outreach_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                detail TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (outreach_id) REFERENCES outreach(outreach_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_outreach_renter ON outreach(renter_phone)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_outreach_landlord ON outreach(landlord_phone)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_outreach_status_channel ON outreach(channel, status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_outreach_events ON outreach_events(outreach_id, created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_outreach_updated ON outreach(updated_at)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS retell_conversations (
                conversation_id TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                event_type TEXT,
                from_number TEXT,
                to_number TEXT,
                agent_id TEXT,
                status TEXT,
                transcript TEXT,
                recording_url TEXT,
                payload_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS retell_escalations (
                escalation_id TEXT PRIMARY KEY,
                conversation_id TEXT,
                renter_phone TEXT,
                question TEXT NOT NULL,
                answer TEXT,
                status TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                answered_at INTEGER
            )
        """)
        # Clean up stale caches
        now = int(time.time())
        n_scrape = conn.execute("DELETE FROM scrape_cache WHERE cached_at < ?", (now - SCRAPE_CACHE_TTL,)).rowcount
        n_geo = conn.execute("DELETE FROM geocache WHERE lat IS NULL AND cached_at < ?", (now - 86400,)).rowcount
        conn.commit()
    finally:
        conn.close()
    if n_scrape or n_geo:
        log.info("Cache cleanup: %d expired scrapes, %d failed geocodes removed", n_scrape, n_geo)
    log.info("DB initialized at %s", DB_PATH)


def get_cached_coords(address: str) -> tuple[float, float] | None:
    conn = get_conn()
    try:
        row = conn.execute("SELECT lat, lng FROM geocache WHERE address = ?", (address,)).fetchone()
        if row:
            return row["lat"], row["lng"]
        return None
    finally:
        conn.close()


def cache_coords(address: str, lat: float | None, lng: float | None):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO geocache (address, lat, lng) VALUES (?, ?, ?)",
            (address, lat, lng),
        )
        conn.commit()
    finally:
        conn.close()


def get_cached_scrape(source: str, city: str, params_hash: str) -> list[dict] | None:
    cache_key = f"{source}:{city}:{params_hash}"
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT listings_json, cached_at FROM scrape_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
        if row:
            age = int(time.time()) - row["cached_at"]
            if age < SCRAPE_CACHE_TTL:
                log.info("Cache HIT for %s (age: %dm)", cache_key, age // 60)
                return json.loads(row["listings_json"])
        return None
    finally:
        conn.close()


def cache_scrape(source: str, city: str, params_hash: str, listings: list[dict]):
    cache_key = f"{source}:{city}:{params_hash}"
    conn = get_conn()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO scrape_cache (cache_key, listings_json, cached_at) VALUES (?, ?, ?)",
            (cache_key, json.dumps(listings), int(time.time())),
        )
        conn.commit()
    finally:
        conn.close()
    log.info("Cached %d listings for %s", len(listings), cache_key)


def upsert_retell_conversation(
    *,
    conversation_id: str,
    channel: str,
    payload: dict[str, Any],
    event_type: str | None = None,
    from_number: str | None = None,
    to_number: str | None = None,
    agent_id: str | None = None,
    status: str | None = None,
    transcript: str | None = None,
    recording_url: str | None = None,
):
    now = int(time.time())
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO retell_conversations (
                conversation_id, channel, event_type, from_number, to_number, agent_id,
                status, transcript, recording_url, payload_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                channel = excluded.channel,
                event_type = excluded.event_type,
                from_number = COALESCE(excluded.from_number, retell_conversations.from_number),
                to_number = COALESCE(excluded.to_number, retell_conversations.to_number),
                agent_id = COALESCE(excluded.agent_id, retell_conversations.agent_id),
                status = COALESCE(excluded.status, retell_conversations.status),
                transcript = COALESCE(excluded.transcript, retell_conversations.transcript),
                recording_url = COALESCE(excluded.recording_url, retell_conversations.recording_url),
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (
                conversation_id,
                channel,
                event_type,
                from_number,
                to_number,
                agent_id,
                status,
                transcript,
                recording_url,
                json.dumps(payload),
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_retell_conversation(conversation_id: str) -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM retell_conversations WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
        if not row:
            return None
        return {
            **dict(row),
            "payload": json.loads(row["payload_json"]),
        }
    finally:
        conn.close()


def list_retell_conversations(limit: int = 50) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM retell_conversations
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                **dict(row),
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]
    finally:
        conn.close()


def create_retell_escalation(
    *,
    escalation_id: str,
    conversation_id: str | None,
    renter_phone: str | None,
    question: str,
    metadata: dict[str, Any] | None = None,
):
    now = int(time.time())
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO retell_escalations (
                escalation_id, conversation_id, renter_phone, question, answer,
                status, metadata_json, created_at, updated_at, answered_at
            ) VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?, NULL)
            """,
            (
                escalation_id,
                conversation_id,
                renter_phone,
                question,
                json.dumps(metadata or {}),
                now,
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def answer_retell_escalation(escalation_id: str, answer: str) -> bool:
    now = int(time.time())
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            UPDATE retell_escalations
            SET answer = ?, status = 'answered', updated_at = ?, answered_at = ?
            WHERE escalation_id = ?
            """,
            (answer, now, now, escalation_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_retell_escalation(escalation_id: str) -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM retell_escalations WHERE escalation_id = ?",
            (escalation_id,),
        ).fetchone()
        if not row:
            return None
        return {
            **dict(row),
            "metadata": json.loads(row["metadata_json"]),
        }
    finally:
        conn.close()


# ── Renter profiles ──────────────────────────────────────────────────────


def upsert_renter_profile(
    *,
    phone: str,
    name: str | None = None,
    current_city: str | None = None,
    move_in_date: str | None = None,
    budget_max: int | None = None,
    income_range: str | None = None,
    credit_score_range: str | None = None,
    pets: str | None = None,
    smoker: bool = False,
    guarantor: bool = False,
    dealbreakers: str | None = None,
    free_text_context: str | None = None,
) -> dict[str, Any]:
    now = int(time.time())
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO renter_profiles (
                phone, name, current_city, move_in_date, budget_max,
                income_range, credit_score_range, pets, smoker, guarantor,
                dealbreakers, free_text_context, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(phone) DO UPDATE SET
                name = COALESCE(excluded.name, renter_profiles.name),
                current_city = COALESCE(excluded.current_city, renter_profiles.current_city),
                move_in_date = COALESCE(excluded.move_in_date, renter_profiles.move_in_date),
                budget_max = COALESCE(excluded.budget_max, renter_profiles.budget_max),
                income_range = COALESCE(excluded.income_range, renter_profiles.income_range),
                credit_score_range = COALESCE(excluded.credit_score_range, renter_profiles.credit_score_range),
                pets = COALESCE(excluded.pets, renter_profiles.pets),
                smoker = excluded.smoker,
                guarantor = excluded.guarantor,
                dealbreakers = COALESCE(excluded.dealbreakers, renter_profiles.dealbreakers),
                free_text_context = COALESCE(excluded.free_text_context, renter_profiles.free_text_context),
                updated_at = excluded.updated_at
            """,
            (
                phone, name, current_city, move_in_date, budget_max,
                income_range, credit_score_range, pets,
                int(smoker), int(guarantor),
                dealbreakers, free_text_context, now, now,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return get_renter_profile(phone)  # type: ignore[return-value]


def get_renter_profile(phone: str) -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM renter_profiles WHERE phone = ?", (phone,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["smoker"] = bool(d["smoker"])
        d["guarantor"] = bool(d["guarantor"])
        return d
    finally:
        conn.close()


# ── Outreach ─────────────────────────────────────────────────────────────


def create_outreach(
    *,
    outreach_id: str,
    renter_phone: str,
    listing_id: str,
    listing_json: str,
    landlord_phone: str | None,
    channel: str,
    custom_message: str | None,
) -> dict[str, Any]:
    now = int(time.time())
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO outreach (
                outreach_id, renter_phone, listing_id, listing_json,
                landlord_phone, channel, custom_message, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                outreach_id, renter_phone, listing_id, listing_json,
                landlord_phone, channel, custom_message, now, now,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return get_outreach(outreach_id)  # type: ignore[return-value]


def get_outreach(outreach_id: str) -> dict[str, Any] | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM outreach WHERE outreach_id = ?", (outreach_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["listing"] = json.loads(d.pop("listing_json"))
        return d
    finally:
        conn.close()


def list_outreach_for_renter(renter_phone: str, limit: int = 100) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM outreach
            WHERE renter_phone = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (renter_phone, limit),
        ).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["listing"] = json.loads(d.pop("listing_json"))
            result.append(d)
        return result
    finally:
        conn.close()


def update_outreach(
    outreach_id: str,
    *,
    status: str | None = None,
    conversation_id: str | None = None,
    scam_flags: str | None = None,
    negotiation_result: str | None = None,
    tour_time: str | None = None,
    summary: str | None = None,
) -> bool:
    now = int(time.time())
    conn = get_conn()
    try:
        sets = ["updated_at = ?"]
        vals: list[Any] = [now]
        if status is not None:
            sets.append("status = ?")
            vals.append(status)
        if conversation_id is not None:
            sets.append("conversation_id = ?")
            vals.append(conversation_id)
        if scam_flags is not None:
            sets.append("scam_flags = ?")
            vals.append(scam_flags)
        if negotiation_result is not None:
            sets.append("negotiation_result = ?")
            vals.append(negotiation_result)
        if tour_time is not None:
            sets.append("tour_time = ?")
            vals.append(tour_time)
        if summary is not None:
            sets.append("summary = ?")
            vals.append(summary)
        vals.append(outreach_id)
        cur = conn.execute(
            f"UPDATE outreach SET {', '.join(sets)} WHERE outreach_id = ?",
            vals,
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def add_outreach_event(outreach_id: str, event_type: str, detail: str | None = None):
    now = int(time.time())
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO outreach_events (outreach_id, event_type, detail, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (outreach_id, event_type, detail, now),
        )
        conn.commit()
    finally:
        conn.close()


def list_outreach_events(outreach_id: str) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM outreach_events WHERE outreach_id = ? ORDER BY created_at ASC",
            (outreach_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def batch_list_outreach_events(outreach_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Fetch events for multiple outreach IDs in one query (avoids N+1)."""
    if not outreach_ids:
        return {}
    conn = get_conn()
    try:
        placeholders = ",".join("?" for _ in outreach_ids)
        rows = conn.execute(
            f"SELECT * FROM outreach_events WHERE outreach_id IN ({placeholders}) ORDER BY created_at ASC",
            outreach_ids,
        ).fetchall()
        result: dict[str, list[dict[str, Any]]] = {oid: [] for oid in outreach_ids}
        for row in rows:
            d = dict(row)
            result[d["outreach_id"]].append(d)
        return result
    finally:
        conn.close()


def list_retell_escalations(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = get_conn()
    try:
        if status:
            rows = conn.execute(
                """
                SELECT * FROM retell_escalations
                WHERE status = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM retell_escalations
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                **dict(row),
                "metadata": json.loads(row["metadata_json"]),
            }
            for row in rows
        ]
    finally:
        conn.close()
