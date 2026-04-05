import asyncio
import base64
import datetime
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

import browser
import config
import db
from db import get_cached_scrape, cache_scrape
from db import answer_retell_escalation, get_retell_conversation, get_retell_escalation
from db import list_retell_conversations, list_retell_escalations
from db import (
    upsert_renter_profile,
    get_renter_profile,
    create_outreach,
    get_outreach,
    list_outreach_for_renter,
    update_outreach,
    add_outreach_event,
    list_outreach_events,
    batch_list_outreach_events,
)
import geocoder
from cities import resolve_location
from models import Listing
from retell_integration import (
    RetellClient,
    RetellEscalationReplyRequest,
    RetellEscalationRequest,
    RetellFunctionEnvelope,
    RetellOutboundCallRequest,
    RetellOutboundSMSRequest,
    RetellSearchRequest,
    check_escalation,
    create_escalation,
    persist_retell_event,
    search_city_listings,
    unwrap_function_args,
)
from utils import deduplicate, point_in_polygon, polygon_centroid
from scrapers import blueground as bg_scraper
from scrapers import june_homes, alohause, furnished_finder, leasebreak, renthop, zumper, craigslist

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ramp")


FOLLOWUP_INTERVAL = 60 * 60  # check every hour
FOLLOWUP_AFTER_SECS = 24 * 60 * 60  # nudge after 24h silence
GHOST_AFTER_SECS = 72 * 60 * 60  # mark ghosted after 72h silence
MAX_FOLLOWUPS = 2  # max nudge messages per outreach

# Per-outreach locks to prevent race conditions when multiple SMS arrive simultaneously
_outreach_locks: dict[str, asyncio.Lock] = {}

# ── Background scrape registry ─────────────────────────────────────────
# Maps cache_key -> Task[list[Listing]] so scrapes survive client disconnects
# and concurrent requests for the same city/params reuse in-flight work.
_inflight_scrapes: dict[str, asyncio.Task] = {}


async def _background_scrape(
    cache_key: str,
    src_name: str,
    city_key: str,
    params_hash: str,
    coro,
) -> list[Listing]:
    """Run a scraper, cache the result, and clean up the registry."""
    try:
        result: list[Listing] = await coro
        cache_scrape(src_name, city_key, params_hash, [l.model_dump() for l in result])
        log.info("Background scrape %s finished: %d listings cached", cache_key, len(result))
        return result
    except Exception as exc:
        log.error("Background scrape %s failed: %s", cache_key, exc)
        raise
    finally:
        _inflight_scrapes.pop(cache_key, None)


def _get_or_start_scrape(
    cache_key: str,
    src_name: str,
    city_key: str,
    params_hash: str,
    coro,
) -> asyncio.Task:
    """Return an existing in-flight task or start a new background scrape."""
    existing = _inflight_scrapes.get(cache_key)
    if existing is not None and not existing.done():
        log.info("Reusing in-flight scrape for %s", cache_key)
        return existing
    task = asyncio.create_task(
        _background_scrape(cache_key, src_name, city_key, params_hash, coro)
    )
    _inflight_scrapes[cache_key] = task
    return task


async def _sms_followup_loop():
    """Background loop: send follow-ups for stale SMS outreach, mark ghosted ones."""
    await asyncio.sleep(30)  # let server finish startup
    while True:
        try:
            now = int(time.time())
            conn = db.get_conn()
            try:
                # Find SMS outreach that's been "contacted" or "responded" for a while
                rows = conn.execute(
                    """SELECT outreach_id, renter_phone, landlord_phone, status, updated_at, listing_json
                       FROM outreach
                       WHERE channel='text' AND status IN ('contacted', 'responded')
                       AND updated_at < ?
                       ORDER BY updated_at ASC LIMIT 20""",
                    (now - FOLLOWUP_AFTER_SECS,),
                ).fetchall()
            finally:
                conn.close()

            for row in rows:
                oid = row["outreach_id"]
                age = now - row["updated_at"]
                events = list_outreach_events(oid)
                followup_count = sum(1 for e in events if e["event_type"] == "followup_sent")

                # If no reply after 72h and we've already followed up, mark ghosted
                if age > GHOST_AFTER_SECS and followup_count >= MAX_FOLLOWUPS:
                    update_outreach(oid, status="ghosted")
                    add_outreach_event(oid, "auto_ghosted", f"No reply after {age // 3600}h and {followup_count} follow-ups")
                    listing = json.loads(row["listing_json"])
                    asyncio.create_task(_notify_renter(row["renter_phone"], oid, "ghosted", listing))
                    log.info("Marked outreach %s as ghosted", oid)
                    continue

                # Send a follow-up nudge if under the cap
                if followup_count < MAX_FOLLOWUPS:
                    try:
                        listing = json.loads(row["listing_json"])
                        profile = get_renter_profile(row["renter_phone"])
                        renter_name = profile.get("name", "the renter") if profile else "the renter"

                        followup_prompt = (
                            f"Write a brief, polite follow-up SMS (under 200 chars) for a renter's assistant.\n"
                            f"We reached out about {listing.get('title', 'a listing')} at {listing.get('address', '')} "
                            f"on behalf of {renter_name} but haven't heard back in {age // 3600} hours.\n"
                            f"This is follow-up #{followup_count + 1}. Keep it short and friendly. Don't be pushy."
                        )
                        async with httpx.AsyncClient() as http:
                            resp = await http.post(
                                "https://api.x.ai/v1/chat/completions",
                                headers={"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"},
                                json={"model": "grok-3", "messages": [{"role": "user", "content": followup_prompt}], "max_tokens": 150},
                                timeout=10,
                            )
                            resp.raise_for_status()
                            followup_text = resp.json()["choices"][0]["message"]["content"].strip()

                        await _send_twilio_sms(row["landlord_phone"], followup_text)
                        add_outreach_event(oid, "followup_sent", json.dumps({"body": followup_text, "followup_num": followup_count + 1}))
                        update_outreach(oid, status=row["status"])  # touch updated_at
                        log.info("Sent follow-up #%d for outreach %s", followup_count + 1, oid)
                    except Exception as exc:
                        log.error("Follow-up failed for %s: %s", oid, exc)

        except asyncio.CancelledError:
            break
        except Exception as exc:
            log.error("Follow-up loop error: %s", exc)

        await asyncio.sleep(FOLLOWUP_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    await geocoder.startup()
    asyncio.create_task(bg_scraper.refresh_session())
    followup_task = asyncio.create_task(_sms_followup_loop())
    log.info("Backend ready")
    yield
    followup_task.cancel()
    await geocoder.shutdown()
    await browser.shutdown()


app = FastAPI(
    title="Ramp Housing API",
    description="Aggregates US housing listings from multiple sources",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def geocode_listings(listings: list[Listing], geocode_suffix: str) -> list[Listing]:
    pending_by_address: dict[str, list[Listing]] = {}

    for listing in listings:
        if listing.lat is not None and listing.lng is not None:
            continue

        addr = listing.address
        if not addr:
            continue  # Skip empty addresses — they always fail and can't be cached
        if geocode_suffix and geocode_suffix.lower() not in addr.lower():
            addr = addr + geocode_suffix
        pending_by_address.setdefault(addr, []).append(listing)

    if not pending_by_address:
        return listings

    coords_by_address = await geocoder.geocode_many(
        list(pending_by_address.keys()),
        concurrency=config.GEOCODER_CONCURRENCY,
    )

    for address, matching_listings in pending_by_address.items():
        coords = coords_by_address.get(address)
        if not coords:
            continue
        for listing in matching_listings:
            listing.lat, listing.lng = coords

    return listings


def _count_listings_with_coords(listings: list[Listing]) -> int:
    return sum(1 for listing in listings if listing.lat is not None and listing.lng is not None)


async def _send_listings_in_chunks(
    websocket: WebSocket,
    source: str,
    listings: list[Listing],
    chunk_size: int = 200,
    msg_type: str = "listings",
) -> None:
    for start in range(0, len(listings), chunk_size):
        chunk = listings[start:start + chunk_size]
        await websocket.send_json({
            "type": msg_type,
            "source": source,
            "listings": [listing.model_dump() for listing in chunk],
        })


def _build_scraper_tasks(
    city_slugs: dict[str, Any],
    check_in: str | None,
    check_out: str | None,
    min_price: int,
    max_price: int,
    bed_list: list[int],
    source_list: list[str],
    furnished: bool,
    no_fee: bool,
) -> list[tuple[str, Any]]:
    tasks = []

    if "june_homes" in source_list and "june_homes" in city_slugs:
        slug = city_slugs["june_homes"] if isinstance(city_slugs["june_homes"], str) else None
        tasks.append(("june_homes", june_homes.scrape(slug, check_in, min_price, max_price, bed_list)))

    if "alohause" in source_list and "alohause" in city_slugs:
        tasks.append(("alohause", alohause.scrape(check_in, check_out, min_price, max_price, bed_list)))

    if "blueground" in source_list and "blueground" in city_slugs:
        slug = city_slugs["blueground"] if isinstance(city_slugs["blueground"], str) else None
        tasks.append(("blueground", bg_scraper.scrape(slug, check_in, check_out, min_price, max_price, bed_list)))

    if "furnished_finder" in source_list and "furnished_finder" in city_slugs:
        slug = city_slugs["furnished_finder"] if isinstance(city_slugs["furnished_finder"], str) else None
        tasks.append(("furnished_finder", furnished_finder.scrape(slug, check_in, min_price, max_price, bed_list)))

    if "leasebreak" in source_list and "leasebreak" in city_slugs:
        tasks.append(("leasebreak", leasebreak.scrape(min_price, max_price, bed_list, furnished)))

    if "renthop" in source_list and "renthop" in city_slugs:
        slug = city_slugs["renthop"] if isinstance(city_slugs["renthop"], str) else None
        tasks.append(("renthop", renthop.scrape(slug, min_price, max_price, bed_list, no_fee)))

    if "zumper" in source_list and "zumper" in city_slugs:
        slug = city_slugs["zumper"] if isinstance(city_slugs["zumper"], str) else None
        tasks.append(("zumper", zumper.scrape(slug, min_price, max_price, bed_list)))

    if "craigslist" in source_list and "craigslist" in city_slugs:
        cl_data = city_slugs["craigslist"]
        if isinstance(cl_data, dict):
            tasks.append(("craigslist", craigslist.scrape(cl_data["city"], cl_data["state"], min_price, max_price, bed_list)))

    return tasks


@app.websocket("/api/ws/search")
async def ws_search(websocket: WebSocket):
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        params = json.loads(raw)
    except Exception:
        await websocket.close(code=1003)
        return

    try:
        poly = params.get("polygon", [])
        if not isinstance(poly, list) or len(poly) < 3:
            await websocket.send_json({"type": "error", "message": "Invalid polygon"})
            return

        check_in = params.get("check_in")
        check_out = params.get("check_out")
        min_price = int(params.get("min_price", 0))
        max_price = int(params.get("max_price", 50000))
        bed_list = [int(b) for b in params.get("bedrooms", "0,1,2,3").split(",") if str(b).strip().isdigit()]
        furnished = params.get("furnished", False)
        no_fee = params.get("no_fee", False)
        sources_param = params.get("sources", "")

        centroid_lat, centroid_lng = polygon_centroid(poly)
        location = await geocoder.reverse_geocode(centroid_lat, centroid_lng)

        if not location:
            await websocket.send_json({"type": "error", "message": "Could not determine location"})
            return

        resolved = resolve_location(location)
        if not resolved:
            area_name = location.get("city") or location.get("display_name", "this area")
            await websocket.send_json({"type": "error", "message": f"Only US cities are supported. Detected: {area_name}"})
            return

        city_slugs = resolved["slugs"]
        geocode_suffix = resolved["geocode_suffix"]
        available_sources = list(city_slugs.keys())

        if sources_param:
            source_list = [s.strip() for s in sources_param.split(",") if s.strip() in available_sources]
        else:
            source_list = available_sources

        await websocket.send_json({
            "type": "init",
            "detected_location": resolved["name"],
            "available_sources": available_sources,
        })

        if not source_list:
            await websocket.send_json({"type": "done", "stats": {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0}})
            return

        params_hash = hashlib.md5(json.dumps({
            "ci": check_in, "co": check_out, "min": min_price, "max": max_price,
            "beds": sorted(bed_list), "furn": furnished, "nofee": no_fee,
        }, sort_keys=True).encode()).hexdigest()[:12]
        city_key = f"{resolved['city']}:{resolved['state']}"

        total_stats = {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0}
        seen_ids: set[str] = set()

        async def _process_and_send(src_name: str, batch: list[Listing], *, persist_processed_cache: bool = False) -> int:
            nonlocal total_stats
            original_with_coords = _count_listings_with_coords(batch)
            if furnished:
                batch = [l for l in batch if l.furnished]
            batch = await geocode_listings(batch, geocode_suffix)
            if persist_processed_cache and _count_listings_with_coords(batch) > original_with_coords:
                cache_scrape(src_name, city_key, params_hash, [listing.model_dump() for listing in batch])
            with_coords = [l for l in batch if l.lat is not None and l.lng is not None]
            no_coords = [l for l in batch if l.lat is None or l.lng is None]
            if no_coords:
                log.warning("%s: %d/%d listings missing coords after geocoding", src_name, len(no_coords), len(batch))
            in_poly = [l for l in with_coords if l.lat is not None and l.lng is not None and point_in_polygon(l.lat, l.lng, poly)]
            final = deduplicate(in_poly)
            # Cross-batch dedup
            final = [l for l in final if l.id not in seen_ids]
            for l in final:
                seen_ids.add(l.id)
            # Also dedup no-coord listings and send them separately
            unmapped = deduplicate(no_coords)
            unmapped = [l for l in unmapped if l.id not in seen_ids]
            for l in unmapped:
                seen_ids.add(l.id)
            total_stats["total_scraped"] += len(batch)
            total_stats["geocoded"] += len(with_coords)
            total_stats["in_polygon"] += len(in_poly)
            total_stats["returned"] += len(final) + len(unmapped)
            total_stats["skipped_no_coords"] += len(no_coords)
            if final:
                await _send_listings_in_chunks(websocket, src_name, final)
            if unmapped:
                await _send_listings_in_chunks(websocket, src_name, unmapped, msg_type="unmapped_listings")
            return len(batch)

        # Serve cached sources immediately
        uncached_sources = []
        cached_sources: list[tuple[str, list[Listing]]] = []
        for src in source_list:
            cached = get_cached_scrape(src, city_key, params_hash)
            if cached is not None:
                batch = [Listing(**l) for l in cached]
                cached_sources.append((src, batch))
                await websocket.send_json({"type": "source_status", "source": src, "status": "scraping", "count": len(batch), "cached": True})
            else:
                uncached_sources.append(src)
                await websocket.send_json({"type": "source_status", "source": src, "status": "scraping", "count": 0, "cached": False})

        if cached_sources:
            # Favor sources that already have coordinates and smaller batches so useful
            # results appear quickly instead of being blocked behind a large geocode job.
            cached_sources.sort(
                key=lambda item: (
                    -_count_listings_with_coords(item[1]),
                    len(item[1]),
                )
            )
            task_to_meta: dict[asyncio.Task[int], tuple[str, bool]] = {}
            for src_name, batch in cached_sources:
                task = asyncio.create_task(_process_and_send(src_name, batch, persist_processed_cache=True))
                task_to_meta[task] = (src_name, True)

            pending = set(task_to_meta.keys())
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    src_name, cached_flag = task_to_meta[task]
                    try:
                        count = task.result()
                    except Exception as exc:
                        log.error("Cached source %s failed during processing: %s", src_name, exc)
                        await websocket.send_json({
                            "type": "source_status",
                            "source": src_name,
                            "status": "error",
                            "count": 0,
                            "cached": cached_flag,
                        })
                        continue
                    await websocket.send_json({
                        "type": "source_status",
                        "source": src_name,
                        "status": "done",
                        "count": count,
                        "cached": cached_flag,
                    })

        # Scrape uncached sources via background tasks (survive client disconnect)
        if uncached_sources:
            named_tasks = _build_scraper_tasks(
                city_slugs, check_in, check_out, min_price, max_price, bed_list, uncached_sources, furnished, no_fee,
            )
            task_to_src: dict[asyncio.Task, str] = {}
            for src_name, coro in named_tasks:
                ck = f"{src_name}:{city_key}:{params_hash}"
                t = _get_or_start_scrape(ck, src_name, city_key, params_hash, coro)
                task_to_src[t] = src_name

            pending = set(task_to_src.keys())
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    src_name = task_to_src[task]
                    try:
                        result: list[Listing] = task.result()
                    except Exception as exc:
                        log.error("Scraper %s failed: %s", src_name, exc)
                        await websocket.send_json({"type": "source_status", "source": src_name, "status": "error", "count": 0, "cached": False})
                        continue
                    log.info("Scraper %s returned %d listings", src_name, len(result))
                    await _process_and_send(src_name, result)
                    await websocket.send_json({"type": "source_status", "source": src_name, "status": "done", "count": len(result), "cached": False})

        await websocket.send_json({"type": "done", "stats": total_stats})

    except WebSocketDisconnect:
        log.info("WS client disconnected — in-flight scrapes will continue caching in background")
    except Exception as e:
        log.error("WS search error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


@app.get("/api/search")
async def search(
    polygon: str = Query(..., description="JSON array of [lat, lng] pairs"),
    check_in: str | None = Query(None),
    check_out: str | None = Query(None),
    min_price: int = Query(0, ge=0),
    max_price: int = Query(50000, ge=0),
    bedrooms: str = Query("0,1,2,3"),
    furnished: bool = Query(False),
    no_fee: bool = Query(False),
    sources: str = Query(""),
) -> dict[str, Any]:
    try:
        poly = json.loads(polygon)
        if not isinstance(poly, list) or len(poly) < 3:
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid polygon — need JSON array of ≥3 [lat,lng] pairs")

    # Auto-detect location from polygon centroid
    centroid_lat, centroid_lng = polygon_centroid(poly)
    location = await geocoder.reverse_geocode(centroid_lat, centroid_lng)

    if not location:
        return {
            "listings": [],
            "stats": {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0},
            "available_sources": [],
            "detected_location": "Unknown location",
            "message": "Could not determine location from the drawn area",
        }

    resolved = resolve_location(location)

    if not resolved:
        area_name = location.get("city") or location.get("display_name", "this area")
        return {
            "listings": [],
            "stats": {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0},
            "available_sources": [],
            "detected_location": area_name,
            "message": f"Only US cities are currently supported. Detected: {location.get('display_name', area_name)}",
        }

    city_slugs = resolved["slugs"]
    geocode_suffix = resolved["geocode_suffix"]
    available_sources = list(city_slugs.keys())

    log.info("Detected: %s — %d sources (%s)", resolved["name"], len(available_sources), ", ".join(available_sources))

    bed_list = [int(b) for b in bedrooms.split(",") if b.strip().isdigit()]

    if sources:
        source_list = [s.strip() for s in sources.split(",") if s.strip() in available_sources]
    else:
        source_list = available_sources

    if not source_list:
        return {
            "listings": [],
            "stats": {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0},
            "available_sources": available_sources,
            "detected_location": resolved["name"],
        }

    # Build a hash of the search params for cache key
    params_hash = hashlib.md5(json.dumps({
        "ci": check_in, "co": check_out, "min": min_price, "max": max_price,
        "beds": sorted(bed_list), "furn": furnished, "nofee": no_fee,
    }, sort_keys=True).encode()).hexdigest()[:12]

    city_key = f"{resolved['city']}:{resolved['state']}"

    # Check cache first, only scrape sources that aren't cached
    all_listings: list[Listing] = []
    uncached_sources: list[str] = []

    for src in source_list:
        cached = get_cached_scrape(src, city_key, params_hash)
        if cached is not None:
            all_listings.extend([Listing(**l) for l in cached])
        else:
            uncached_sources.append(src)

    # Scrape only uncached sources (via background tasks that survive disconnects)
    if uncached_sources:
        named_tasks = _build_scraper_tasks(
            city_slugs, check_in, check_out, min_price, max_price, bed_list, uncached_sources, furnished, no_fee,
        )
        tasks_with_names: list[tuple[str, asyncio.Task]] = []
        for src_name, coro in named_tasks:
            ck = f"{src_name}:{city_key}:{params_hash}"
            t = _get_or_start_scrape(ck, src_name, city_key, params_hash, coro)
            tasks_with_names.append((src_name, t))

        results = await asyncio.gather(*[t for _, t in tasks_with_names], return_exceptions=True)

        for (src_name, _), result in zip(tasks_with_names, results):
            if isinstance(result, BaseException):
                log.error("Scraper %s failed: %s", src_name, result)
                continue
            log.info("Scraper %s returned %d listings", src_name, len(result))
            all_listings.extend(result)
    else:
        log.info("All %d sources served from cache", len(source_list))

    if furnished:
        all_listings = [l for l in all_listings if l.furnished]

    all_listings = await geocode_listings(all_listings, geocode_suffix)

    # Write coords back into scrape cache so future searches skip geocoding entirely
    listings_by_source: dict[str, list[Listing]] = {}
    for l in all_listings:
        listings_by_source.setdefault(l.source, []).append(l)
    for src, src_listings in listings_by_source.items():
        if src in source_list:
            cache_scrape(src, city_key, params_hash, [l.model_dump() for l in src_listings])

    with_coords = [l for l in all_listings if l.lat is not None and l.lng is not None]
    without_coords = len(all_listings) - len(with_coords)

    in_polygon = [l for l in with_coords if point_in_polygon(l.lat, l.lng, poly)]
    final = deduplicate(in_polygon)

    log.info(
        "Search [%s]: %d scraped → %d geocoded → %d in polygon → %d returned",
        resolved["name"], len(all_listings), len(with_coords), len(in_polygon), len(final),
    )

    return {
        "listings": [l.model_dump() for l in final],
        "stats": {
            "total_scraped": len(all_listings),
            "geocoded": len(with_coords),
            "in_polygon": len(in_polygon),
            "returned": len(final),
            "skipped_no_coords": without_coords,
        },
        "available_sources": available_sources,
        "detected_location": resolved["name"],
    }


@app.get("/api/listing/detail")
async def listing_detail(url: str = Query(..., description="Original listing URL")) -> dict[str, Any]:
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL — must start with http:// or https://")
    from scrapers import detail_scraper
    try:
        return await detail_scraper.scrape_detail(url)
    except Exception as e:
        log.error("Detail scrape failed for %s: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to scrape listing detail")


class ParseFiltersRequest(BaseModel):
    prompt: str


@app.post("/api/parse-filters")
async def parse_filters(body: ParseFiltersRequest) -> dict[str, Any]:
    prompt_text = body.prompt.strip()
    if not prompt_text:
        return {"filters": {}, "summary": ""}

    if not config.XAI_API_KEY:
        raise HTTPException(status_code=503, detail="XAI_API_KEY not configured")

    today = datetime.date.today().isoformat()
    system = f"""You are a housing search filter parser. Extract structured filters from natural language.

Return ONLY a valid JSON object. Include only fields that are clearly mentioned:
- checkIn: "YYYY-MM-DD"
- checkOut: "YYYY-MM-DD"
- minPrice: number (monthly rent)
- maxPrice: number (monthly rent)
- bedrooms: array of ints (0=studio, 1, 2, 3) — include all that match, e.g. "1 or 2 BR" → [1,2]
- furnished: true/false
- noFee: true/false
- summary: short human-readable label, e.g. "Furnished 1BR · $2–3k · Jun–Aug"

Today is {today}. Interpret relative dates (e.g. "this summer", "next month") accordingly."""

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.XAI_API_KEY}"},
            json={
                "model": "grok-3",
                "max_tokens": 300,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt_text},
                ],
            },
        )
        resp.raise_for_status()

    text = resp.json()["choices"][0]["message"]["content"].strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response")

    summary = data.pop("summary", "")
    return {"filters": data, "summary": summary}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/cache/clear")
async def clear_scrape_cache(source: str = Query(""), city: str = Query("")):
    """Clear scrape cache. Optional filters: source, city. No params = clear all."""
    conn = db.get_conn()
    try:
        if source and city:
            n = conn.execute("DELETE FROM scrape_cache WHERE cache_key LIKE ?", (f"{source}:{city}%",)).rowcount
        elif source:
            n = conn.execute("DELETE FROM scrape_cache WHERE cache_key LIKE ?", (f"{source}:%",)).rowcount
        elif city:
            n = conn.execute("DELETE FROM scrape_cache WHERE cache_key LIKE ?", (f"%:{city}:%",)).rowcount
        else:
            n = conn.execute("DELETE FROM scrape_cache").rowcount
        conn.commit()
    finally:
        conn.close()
    log.info("Cleared %d scrape cache entries (source=%s, city=%s)", n, source or "*", city or "*")
    return {"deleted": n}


@app.post("/api/retell/tools/search-listings")
async def retell_search_listings(request: Request) -> dict[str, Any]:
    payload = await request.json()
    args, _ = unwrap_function_args(payload)
    body = RetellSearchRequest.model_validate(args)
    return await search_city_listings(body)


@app.post("/api/retell/tools/escalate-to-human")
async def retell_escalate_to_human(request: Request) -> dict[str, Any]:
    payload = await request.json()
    args, context = unwrap_function_args(payload)
    if context:
        args.setdefault("conversation_id", context.get("call_id") or context.get("chat_id"))
        args.setdefault("renter_phone", context.get("from_number") or context.get("to_number"))
    body = RetellEscalationRequest.model_validate(args)
    return await create_escalation(body)


@app.get("/api/retell/tools/check-escalation/{escalation_id}")
async def retell_check_escalation(escalation_id: str) -> dict[str, Any]:
    return check_escalation(escalation_id)


async def _send_post_call_followup(outreach_id: str, landlord_phone: str, transcript: str, metadata: dict) -> None:
    """After a call ends, text the landlord a short follow-up with details discussed."""
    renter_name = metadata.get("renter_name") or "the renter"
    outreach = get_outreach(outreach_id)
    listing = outreach.get("listing", {}) if outreach else {}
    listing_title = listing.get("title", "the listing")

    prompt = (
        f"A call just ended between an assistant (Alex) and a landlord about a rental listing.\n\n"
        f"Listing: {listing_title}\n"
        f"Renter: {renter_name}\n\n"
        f"Call transcript:\n{transcript[:3000]}\n\n"
        f"Write a SHORT follow-up text message (under 300 chars) to the landlord. "
        f"Thank them for the call, confirm any key details discussed (tour time, availability, fees), "
        f"and say {renter_name} will be in touch. "
        f"If the call went badly or they said it's unavailable, just thank them for their time. "
        f"Casual, natural tone. No emojis. Return ONLY the message text, nothing else."
    )
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"},
                json={"model": "grok-3", "messages": [{"role": "user", "content": prompt}], "max_tokens": 200},
                timeout=10,
            )
            resp.raise_for_status()
            followup_text = resp.json()["choices"][0]["message"]["content"].strip().strip('"')
    except Exception as exc:
        log.warning("Post-call followup generation failed: %s", exc)
        followup_text = f"Thanks for chatting about {listing_title}. {renter_name} will follow up shortly."

    try:
        await _send_twilio_sms(landlord_phone, followup_text)
        add_outreach_event(outreach_id, "followup_sms", followup_text)
        log.info("Post-call followup SMS sent for outreach %s", outreach_id)
    except Exception as exc:
        log.error("Post-call followup SMS failed for %s: %s", outreach_id, exc)


@app.post("/api/retell/webhook")
async def retell_webhook(request: Request) -> dict[str, Any]:
    payload = await request.json()
    fields = persist_retell_event(payload)

    # If this call/chat is tied to an outreach, update the outreach record
    event_type = payload.get("event") or payload.get("event_type")
    detail = payload.get("call") if isinstance(payload.get("call"), dict) else payload.get("chat")
    source = detail if isinstance(detail, dict) else payload
    metadata = source.get("metadata") or {}
    outreach_id = metadata.get("outreach_id")

    if outreach_id:
        call_status = source.get("call_status") or source.get("chat_status") or ""
        transcript = source.get("transcript") or ""
        analysis = source.get("call_analysis") or {}
        summary = analysis.get("call_summary") or ""
        recording = source.get("recording_url") or ""

        if event_type in ("call_ended", "chat_ended"):
            outreach_status = "responded" if analysis.get("call_successful") else "contacted"
            update_outreach(outreach_id, status=outreach_status, summary=summary)
            add_outreach_event(outreach_id, "call_ended", json.dumps({
                "transcript": transcript[:5000],
                "summary": summary,
                "sentiment": analysis.get("user_sentiment"),
                "recording_url": recording,
                "duration_ms": source.get("duration_ms"),
                "successful": analysis.get("call_successful"),
            }))
            log.info("Outreach %s updated from webhook: %s", outreach_id, outreach_status)

            # Send post-call follow-up SMS to landlord
            landlord_phone = source.get("to_number") or metadata.get("landlord_phone")
            if landlord_phone and transcript:
                asyncio.create_task(_send_post_call_followup(outreach_id, landlord_phone, transcript, metadata))
        elif event_type in ("call_started", "chat_started"):
            update_outreach(outreach_id, status="contacted")
            add_outreach_event(outreach_id, "call_started")

    return {
        "ok": True,
        "conversation_id": fields["conversation_id"],
        "channel": fields["channel"],
    }


@app.get("/api/retell/admin/conversations")
async def retell_list_conversations(limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    return {"conversations": list_retell_conversations(limit=limit)}


@app.get("/api/retell/admin/conversations/{conversation_id}")
async def retell_get_conversation(conversation_id: str) -> dict[str, Any]:
    record = get_retell_conversation(conversation_id)
    if not record:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return record


@app.get("/api/retell/admin/escalations")
async def retell_list_escalations(
    status: str | None = Query(None, pattern="^(pending|answered)$"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    return {"escalations": list_retell_escalations(status=status, limit=limit)}


@app.get("/api/retell/admin/escalations/{escalation_id}")
async def retell_get_escalation(escalation_id: str) -> dict[str, Any]:
    record = get_retell_escalation(escalation_id)
    if not record:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return record


@app.post("/api/retell/admin/escalations/{escalation_id}/reply")
async def retell_reply_escalation(escalation_id: str, body: RetellEscalationReplyRequest) -> dict[str, Any]:
    if not answer_retell_escalation(escalation_id, body.answer.strip()):
        raise HTTPException(status_code=404, detail="Escalation not found")
    return {
        "ok": True,
        "escalation_id": escalation_id,
        "status": "answered",
    }


@app.post("/api/retell/actions/outbound-sms")
async def retell_outbound_sms(body: RetellOutboundSMSRequest) -> dict[str, Any]:
    client = RetellClient()
    return await client.create_sms_chat(body)


@app.post("/api/retell/actions/outbound-call")
async def retell_outbound_call(body: RetellOutboundCallRequest) -> dict[str, Any]:
    client = RetellClient()
    return await client.create_phone_call(body)


# ── Renter Profile ──────────────────────────────────────────────────────


_PHONE_RE = re.compile(r"^\+?1?\d{10,15}$")
VALID_OUTREACH_STATUSES = {
    "pending", "contacted", "responded", "touring",
    "ghosted", "rejected", "scam_flagged", "no_phone", "error",
}


class RenterProfileRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    name: str | None = Field(default=None, max_length=200)
    current_city: str | None = Field(default=None, max_length=200)
    move_in_date: str | None = Field(default=None, max_length=20)
    budget_max: int | None = Field(default=None, ge=0, le=100_000)
    income_range: str | None = Field(default=None, max_length=100)
    credit_score_range: str | None = Field(default=None, max_length=50)
    pets: str | None = Field(default=None, max_length=200)
    smoker: bool = False
    guarantor: bool = False
    dealbreakers: str | None = Field(default=None, max_length=1000)
    free_text_context: str | None = Field(default=None, max_length=2000)


@app.post("/api/renter/profile")
async def api_upsert_renter_profile(body: RenterProfileRequest) -> dict[str, Any]:
    cleaned_phone = body.phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not _PHONE_RE.match(cleaned_phone):
        raise HTTPException(status_code=400, detail="Invalid phone number format")
    profile = upsert_renter_profile(
        phone=cleaned_phone,
        name=body.name,
        current_city=body.current_city,
        move_in_date=body.move_in_date,
        budget_max=body.budget_max,
        income_range=body.income_range,
        credit_score_range=body.credit_score_range,
        pets=body.pets,
        smoker=body.smoker,
        guarantor=body.guarantor,
        dealbreakers=body.dealbreakers,
        free_text_context=body.free_text_context,
    )
    return {"ok": True, "profile": profile}


@app.get("/api/renter/profile/{phone}")
async def api_get_renter_profile(phone: str) -> dict[str, Any]:
    profile = get_renter_profile(phone)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile


# ── Outreach ─────────────────────────────────────────────────────────────


class OutreachListingItem(BaseModel):
    listing_id: str = Field(max_length=200)
    listing: dict[str, Any]
    landlord_phone: str | None = Field(default=None, max_length=20)


class StartOutreachRequest(BaseModel):
    renter_phone: str = Field(min_length=10, max_length=20)
    listings: list[OutreachListingItem] = Field(min_length=1, max_length=25)
    channel: str = Field(pattern="^(call|text)$")
    custom_message: str | None = Field(default=None, max_length=2000)


async def _send_twilio_sms(to_number: str, body: str, http: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """Send an SMS via Twilio REST API. Pass an existing client to reuse connections."""
    sid = config.TWILIO_ACCOUNT_SID
    token = config.TWILIO_AUTH_TOKEN
    from_num = config.TWILIO_FROM_NUMBER or config.RETELL_DEFAULT_FROM_NUMBER
    if not sid or not token or not from_num:
        raise RuntimeError("Twilio credentials not configured")
    # Ensure E.164 format
    if not to_number.startswith("+"):
        to_number = f"+{to_number}" if to_number.startswith("1") else f"+1{to_number}"
    if not from_num.startswith("+"):
        from_num = f"+{from_num}" if from_num.startswith("1") else f"+1{from_num}"
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()

    async def _do_send(client: httpx.AsyncClient) -> dict[str, Any]:
        resp = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            headers={"Authorization": f"Basic {auth}"},
            data={"To": to_number, "From": from_num, "Body": body},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    if http:
        return await _do_send(http)
    async with httpx.AsyncClient() as client:
        return await _do_send(client)


async def _send_sms_parts(to_number: str, parts: list[str], delay: float = 1.5) -> list[dict]:
    """Send multiple SMS parts with a realistic delay, reusing one HTTP connection."""
    results = []
    async with httpx.AsyncClient() as http:
        for i, part in enumerate(parts):
            if i > 0:
                await asyncio.sleep(delay)
            results.append(await _send_twilio_sms(to_number, part, http=http))
    return results


async def _notify_renter(renter_phone: str, outreach_id: str, event: str, listing: dict, detail: str = ""):
    """Send an update notification to the renter about their outreach."""
    title = listing.get("title", "a listing")
    addr = listing.get("address", "")
    loc = f" at {addr}" if addr else ""

    messages = {
        "responded": [
            f"Update on {title}{loc}:",
            f"The landlord responded! {detail}" if detail else "The landlord just responded to your inquiry.",
            "We're continuing the conversation on your behalf. Check your dashboard for details."
        ],
        "touring": [
            f"Great news about {title}{loc}!",
            f"The landlord is open to showing the place. {detail}" if detail else "The landlord is open to showing the place!",
            "When are you free for a tour? Reply with your availability and we'll coordinate with the landlord."
        ],
        "scam_flagged": [
            f"Heads up about {title}{loc}:",
            f"We detected some red flags in this listing. {detail}" if detail else "This listing showed some scam warning signs.",
            "We've stopped the conversation. You may want to avoid this one."
        ],
        "ghosted": [
            f"Update on {title}{loc}:",
            "The landlord hasn't responded after multiple follow-ups. We've moved this to ghosted.",
            "You might want to try other listings."
        ],
        "rejected": [
            f"Update on {title}{loc}:",
            f"Unfortunately the landlord isn't moving forward. {detail}" if detail else "The landlord declined or the listing is no longer available.",
        ],
    }

    parts = messages.get(event)
    if not parts:
        return

    try:
        await _send_sms_parts(renter_phone, parts)
        add_outreach_event(outreach_id, "renter_notified", json.dumps({"event": event, "parts": len(parts)}))
        log.info("Notified renter %s about %s for outreach %s", renter_phone, event, outreach_id)
    except Exception as exc:
        log.error("Failed to notify renter %s: %s", renter_phone, exc)


async def _build_sms_parts(dyn_vars: dict[str, str]) -> list[str]:
    """Use Grok to generate natural multi-part SMS messages for landlord outreach."""
    custom = dyn_vars.get("custom_message", "").strip()
    pets = dyn_vars.get("renter_pets", "none")
    dealbreakers = dyn_vars.get("renter_dealbreakers", "")
    move_in = dyn_vars.get("move_in_date") or dyn_vars.get("renter_move_in", "flexible")

    # Build context about what we already know vs what to ask
    listing_title = dyn_vars.get("listing_title", "your listing")
    listing_addr = dyn_vars.get("listing_address", "")
    listing_price = dyn_vars.get("listing_price", "")
    renter_name = dyn_vars.get("renter_name", "a renter")

    known_parts = []
    if listing_price:
        known_parts.append(f"${listing_price}/mo")
    if dyn_vars.get("listing_bedrooms"):
        known_parts.append(f"{dyn_vars['listing_bedrooms']}BR")

    questions_to_ask = ["are utilities included or separate", "any additional fees (broker, deposit, application)"]
    if not dyn_vars.get("listing_furnished"):
        questions_to_ask.append("furnished or unfurnished")

    prompt = (
        f"You're texting a landlord on behalf of {renter_name}. Write 2-3 SHORT separate text messages.\n\n"
        f"Listing: {listing_title}" + (f" at {listing_addr}" if listing_addr else "") + "\n"
        f"Already known about listing: {', '.join(known_parts) if known_parts else 'just the title'}\n"
        f"Move-in: {move_in}\n\n"
        f"IMPORTANT: Do NOT ask about things we already know ({', '.join(known_parts) if known_parts else 'nothing known'}).\n"
        f"Instead ask about: {', '.join(questions_to_ask)}\n"
    )
    if pets and pets.lower() != "none":
        prompt += f"Mention they have {pets}\n"
    if dealbreakers:
        prompt += f"Dealbreakers: {dealbreakers}\n"
    if custom:
        prompt += f"Renter specifically wants to ask: {custom}\n"

    prompt += (
        f"\nRules:\n"
        f"- First message: brief intro + ask if available\n"
        f"- Second message: ask about fees, utilities, and unknowns\n"
        f"- Optional third message ONLY if renter has custom questions or pets\n"
        f"- Each message under 160 chars (single SMS segment)\n"
        f"- Casual, natural tone — like a real person texting\n"
        f"- No emojis, no 'I hope this message finds you well' type stuff\n"
        f"- NEVER suggest or pick specific days/times for tours\n"
        f"- Return ONLY a JSON array of strings, e.g. [\"msg1\", \"msg2\"]\n"
    )
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"},
                json={"model": "grok-3", "messages": [{"role": "user", "content": prompt}], "max_tokens": 400},
                timeout=10,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"].strip()
            match = re.search(r"\[.*\]", text, re.DOTALL)
            if match:
                parts = json.loads(match.group())
                if isinstance(parts, list) and all(isinstance(p, str) for p in parts):
                    return [p.strip() for p in parts if p.strip()][:4]
    except Exception as exc:
        log.warning("Grok SMS parts generation failed, using fallback: %s", exc)

    # Fallback: two simple messages
    name = dyn_vars.get("renter_name", "a renter")
    title = dyn_vars.get("listing_title", "your listing")
    addr = dyn_vars.get("listing_address", "")
    parts = [f"Hi, reaching out on behalf of {name} about {title}" + (f" at {addr}" if addr else "") + ". Is it still available?"]
    extras = []
    if move_in and move_in != "flexible":
        extras.append(f"looking to move in around {move_in}")
    if pets and pets.lower() != "none":
        extras.append(f"has {pets}")
    if extras:
        parts.append(f"They're {' and '.join(extras)}. Would that work?")
    if custom:
        parts.append(custom[:160])
    return parts


@app.post("/api/outreach/start")
async def api_start_outreach(body: StartOutreachRequest) -> dict[str, Any]:
    """Start parallel outreach to multiple landlords on behalf of the renter."""
    cleaned_phone = body.renter_phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if not _PHONE_RE.match(cleaned_phone):
        raise HTTPException(status_code=400, detail="Invalid renter phone number")
    profile = get_renter_profile(cleaned_phone)
    if not profile:
        raise HTTPException(status_code=400, detail="Renter profile required before outreach")

    async def _dispatch_one(item: OutreachListingItem) -> dict[str, Any]:
        oid = f"out_{uuid.uuid4().hex[:16]}"
        listing_payload = json.dumps(item.listing)
        if len(listing_payload) > 50_000:
            raise HTTPException(status_code=400, detail=f"Listing payload too large for {item.listing_id}")
        if item.landlord_phone:
            lp = item.landlord_phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
            if not _PHONE_RE.match(lp):
                raise HTTPException(status_code=400, detail=f"Invalid landlord phone for listing {item.listing_id}")
            # Normalize to E.164: ensure +1 prefix for US numbers
            lp = lp.lstrip("+")
            if len(lp) == 10:
                lp = f"+1{lp}"
            elif lp.startswith("1") and len(lp) == 11:
                lp = f"+{lp}"
            else:
                lp = f"+{lp}"
            item.landlord_phone = lp
        create_outreach(
            outreach_id=oid,
            renter_phone=cleaned_phone,
            listing_id=item.listing_id,
            listing_json=listing_payload,
            landlord_phone=item.landlord_phone,
            channel=body.channel,
            custom_message=body.custom_message,
        )
        add_outreach_event(oid, "created", f"Channel: {body.channel}")

        # If landlord phone is available, dispatch the agent
        if item.landlord_phone:
            # Build a concise, listing-specific call script
            renter_name = profile.get("name") or "a renter"
            listing_title = item.listing.get("title", "your listing")
            listing_addr = item.listing.get("address", "")
            listing_price = item.listing.get("price_min") or item.listing.get("price", "")
            listing_beds = item.listing.get("bedrooms", "")
            move_in = profile.get("move_in_date") or "as soon as possible"

            addr_part = f" at {listing_addr}" if listing_addr else ""

            # Build follow-up questions for things NOT already known
            known_facts = []
            unknown_questions = []
            if listing_price:
                known_facts.append(f"${listing_price}/month")
            if listing_beds:
                known_facts.append(f"{listing_beds} bedroom")
            if item.listing.get("furnished"):
                known_facts.append("furnished")
            if item.listing.get("no_fee"):
                known_facts.append("no broker fee")

            # Always ask about these since listings rarely include them
            unknown_questions.append("Are utilities included or separate?")
            unknown_questions.append("Are there any additional fees like broker fees, move-in deposits, or application fees?")
            if not item.listing.get("available_from"):
                unknown_questions.append(f"Is it available for move-in around {move_in}?")
            if not item.listing.get("furnished"):
                unknown_questions.append("Does it come furnished or unfurnished?")

            known_str = ", ".join(known_facts) if known_facts else "the listing"
            questions_str = " ".join(unknown_questions)

            call_script = (
                f"Hi, my name is Alex and I'm calling on behalf of {renter_name} "
                f"about the {listing_title}{addr_part}. "
                f"I see it's listed as {known_str}. Is this unit still available? "
                f"If so, I have a few quick questions: {questions_str} "
                f"And could we schedule a viewing for {renter_name}?"
            )

            custom_note = body.custom_message or ""
            if custom_note:
                call_script += f" {custom_note}"

            dyn_vars = {
                "call_script": call_script,
                "renter_name": renter_name,
                "listing_title": listing_title,
                "listing_address": listing_addr,
                "listing_price": str(listing_price),
                "listing_bedrooms": str(listing_beds),
                "listing_furnished": "yes" if item.listing.get("furnished") else "",
                "move_in_date": move_in,
                "custom_message": body.custom_message or "",
                "renter_pets": profile.get("pets") or "none",
                "renter_dealbreakers": profile.get("dealbreakers") or "",
                "outreach_id": oid,
                "renter_phone": cleaned_phone,
            }
            try:
                if body.channel == "call":
                    client = RetellClient()
                    resp = await client.create_phone_call(RetellOutboundCallRequest(
                        to_number=item.landlord_phone,
                        retell_llm_dynamic_variables=dyn_vars,
                        metadata={"outreach_id": oid, "renter_phone": cleaned_phone},
                    ))
                else:
                    sms_parts = await _build_sms_parts(dyn_vars)
                    sms_results = await _send_sms_parts(item.landlord_phone, sms_parts)
                    sms_sid = sms_results[0].get("sid", "") if sms_results else ""
                    update_outreach(oid, status="contacted", conversation_id=sms_sid)
                    for part in sms_parts:
                        add_outreach_event(oid, "contacted", json.dumps({"sms_sid": sms_sid, "body": part}))
                    return get_outreach(oid)  # type: ignore[return-value]
                conv_id = resp.get("call_id") or resp.get("chat_id") or resp.get("conversation_id")
                update_outreach(oid, status="contacted", conversation_id=conv_id)
                add_outreach_event(oid, "contacted", f"Conversation: {conv_id}")
            except Exception as exc:
                log.error("Outreach dispatch failed for %s: %s", oid, exc)
                update_outreach(oid, status="error")
                add_outreach_event(oid, "error", str(exc))
        else:
            update_outreach(oid, status="no_phone")
            add_outreach_event(oid, "no_phone", "No landlord phone available")

        return get_outreach(oid)  # type: ignore[return-value]

    # Dispatch all outreach in parallel
    tasks = [_dispatch_one(item) for item in body.listings]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    outreach_results = []
    for r in results:
        if isinstance(r, Exception):
            log.error("Outreach error: %s", r)
            outreach_results.append({"error": str(r)})
        else:
            outreach_results.append(r)

    return {"ok": True, "outreach": outreach_results}


async def _analyze_sms_conversation(conversation: str, landlord_reply: str, listing: dict) -> dict[str, Any]:
    """Use Grok to analyze the landlord's reply for intent, scam signals, and next action."""
    prompt = (
        f"Analyze this landlord's latest SMS reply in a housing outreach conversation.\n\n"
        f"Listing: {listing.get('title', '')} at {listing.get('address', '')}, ${listing.get('price_min') or listing.get('price', '?')}/mo\n"
        f"Conversation:\n{conversation}\n\n"
        f"Latest landlord reply: \"{landlord_reply}\"\n\n"
        f"Return ONLY a JSON object with these fields:\n"
        f"- \"intent\": one of \"available\", \"unavailable\", \"touring\", \"negotiating\", \"scam\", \"unclear\"\n"
        f"- \"should_reply\": true/false (false if rejected, scam, or conversation is done)\n"
        f"- \"status\": one of \"responded\", \"touring\", \"rejected\", \"scam_flagged\"\n"
        f"- \"tour_time\": extracted tour date/time string if mentioned, else null\n"
        f"- \"scam_flags\": string describing red flags if any (asking for wire transfer, upfront payment before seeing unit, won't show in person, too-good-to-be-true), else null\n"
        f"- \"summary\": 1-sentence summary of where the conversation stands\n"
    )
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"},
                json={"model": "grok-3", "messages": [{"role": "user", "content": prompt}], "max_tokens": 300},
                timeout=10,
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"].strip()
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                return json.loads(match.group())
    except Exception as exc:
        log.warning("SMS analysis failed: %s", exc)
    return {"intent": "unclear", "should_reply": True, "status": "responded", "tour_time": None, "scam_flags": None, "summary": ""}


def _validate_twilio_signature(request: Request, form_data: dict[str, str]) -> bool:
    """Validate Twilio webhook signature to prevent spoofed requests."""
    auth_token = config.TWILIO_AUTH_TOKEN
    if not auth_token:
        return True  # skip validation if no token configured
    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        return False
    url = str(request.url)
    # Twilio signs over URL + sorted POST params
    data_str = url + "".join(f"{k}{form_data[k]}" for k in sorted(form_data.keys()))
    expected = base64.b64encode(
        hmac.HMAC(auth_token.encode(), data_str.encode(), hashlib.sha1).digest()
    ).decode()
    return hmac.compare_digest(signature, expected)


@app.post("/api/twilio/sms-webhook")
async def twilio_sms_webhook(request: Request):
    """Handle inbound SMS from Twilio — landlord replies to our outreach texts."""
    form = await request.form()
    form_dict = {k: str(v) for k, v in form.items()}
    from_number = form_dict.get("From", "").strip()
    body_text = form_dict.get("Body", "").strip()
    sms_sid = form_dict.get("MessageSid", "")

    # Twilio expects TwiML — empty response means "no auto-reply from Twilio side"
    empty_twiml = Response(content="<Response/>", media_type="application/xml")

    if not _validate_twilio_signature(request, form_dict):
        log.warning("Invalid Twilio signature from %s", request.client.host if request.client else "unknown")
        return empty_twiml

    if not from_number or not body_text:
        return empty_twiml

    # Normalize phone to E.164 for matching
    from_clean = from_number.replace("-", "").replace(" ", "").replace("(", "").replace(")", "")
    if not from_clean.startswith("+"):
        from_clean = f"+{from_clean}" if from_clean.startswith("1") else f"+1{from_clean}"

    # Find the most recent outreach to this landlord phone
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT outreach_id, renter_phone, status, channel FROM outreach WHERE landlord_phone = ? ORDER BY created_at DESC LIMIT 1",
            (from_clean,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        log.info("Inbound SMS from %s with no matching outreach", from_number)
        return empty_twiml

    oid = row["outreach_id"]
    current_status = row["status"]

    # Don't process replies for conversations that are done
    if current_status in ("rejected", "scam_flagged"):
        log.info("Ignoring SMS for %s — conversation is %s", oid, current_status)
        add_outreach_event(oid, "sms_reply_ignored", json.dumps({"from": from_number, "body": body_text, "reason": f"conversation {current_status}"}))
        return empty_twiml

    # Per-outreach lock prevents race conditions when multiple SMS arrive fast
    if oid not in _outreach_locks:
        _outreach_locks[oid] = asyncio.Lock()
    async with _outreach_locks[oid]:
        add_outreach_event(oid, "sms_reply", json.dumps({
            "from": from_number,
            "body": body_text,
            "sms_sid": sms_sid,
        }))
        log.info("Inbound SMS matched outreach %s: %s", oid, body_text[:100])

        try:
            # Re-read status under lock in case it changed
            outreach = get_outreach(oid)
            if not outreach:
                return empty_twiml
            current_status = outreach.get("status", current_status)

            events = list_outreach_events(oid)

            # If this outreach started as a call, include the call transcript for context
            conversation_parts = []
            for e in events:
                if e["event_type"] == "call_ended":
                    try:
                        call_data = json.loads(e["detail"])
                        transcript = call_data.get("transcript", "")
                        if transcript:
                            conversation_parts.append(f"[Call transcript]: {transcript[:2000]}")
                    except (json.JSONDecodeError, TypeError):
                        pass
                elif e["event_type"] in ("contacted", "sms_sent", "followup_sent", "followup_sms"):
                    conversation_parts.append(f"Us: {_extract_sms_body(e['detail'])}")
                elif e["event_type"] == "sms_reply":
                    conversation_parts.append(f"Landlord: {_extract_sms_body(e['detail'])}")
            conversation = "\n".join(conversation_parts)
            profile = get_renter_profile(row["renter_phone"])
            listing = json.loads(outreach.get("listing_json", "{}")) if outreach else {}

            # Analyze the reply for intent
            analysis = await _analyze_sms_conversation(conversation, body_text, listing)
            new_status = analysis.get("status", "responded")
            if new_status not in VALID_OUTREACH_STATUSES:
                new_status = "responded"

            # Update outreach with analysis results
            update_outreach(
                oid,
                status=new_status,
                summary=analysis.get("summary") or body_text[:500],
                scam_flags=analysis.get("scam_flags"),
                tour_time=analysis.get("tour_time"),
            )
            add_outreach_event(oid, "analysis", json.dumps(analysis))

            # Notify renter on important status changes
            if new_status != current_status and new_status in ("responded", "touring", "scam_flagged", "rejected"):
                notify = False
                if new_status == "responded" and current_status == "contacted":
                    notify = True
                elif new_status in ("touring", "scam_flagged", "rejected"):
                    notify = True
                if notify:
                    asyncio.create_task(_notify_renter(
                        row["renter_phone"], oid, new_status, listing,
                        detail=analysis.get("summary", ""),
                    ))

            # Only auto-reply if analysis says we should
            if analysis.get("should_reply", True):
                msg_count = sum(1 for e in events if e["event_type"] in ("sms_sent", "contacted"))
                if msg_count >= 20:
                    log.info("Outreach %s hit 20-message cap, stopping auto-reply", oid)
                    add_outreach_event(oid, "auto_reply_capped", "Reached 20-message limit")
                else:
                    renter_name = profile.get("name", "the renter") if profile else "the renter"
                    pets_info = profile.get("pets", "none") if profile else "none"
                    dealbreakers = profile.get("dealbreakers", "") if profile else ""

                    reply_prompt = (
                        f"You're texting a landlord on behalf of a renter. Write 1-2 SHORT separate texts (like how people actually text).\n\n"
                        f"Listing: {listing.get('title', '')} at {listing.get('address', '')}\n"
                        f"Renter: {renter_name}, budget ${profile.get('budget_max', 'flexible') if profile else 'flexible'}, "
                        f"move-in {profile.get('move_in_date', 'flexible') if profile else 'flexible'}\n"
                        f"Pets: {pets_info}\n"
                        f"Dealbreakers: {dealbreakers or 'none'}\n"
                        f"Conversation so far:\n{conversation}\n\n"
                        f"Analysis: intent={analysis.get('intent')}, tour={analysis.get('tour_time')}\n\n"
                        f"Rules:\n"
                        f"- Each message under 160 chars\n"
                        f"- If a tour was proposed, say you'll check with {renter_name} on their availability and get back to them — NEVER confirm a specific day/time without asking the renter first\n"
                        f"- If the landlord asks when the renter is free or suggests times, say you need to check with {renter_name} and will follow up\n"
                        f"- NEVER invent or suggest specific dates/times for tours — only the renter can decide their schedule\n"
                        f"- If unavailable, thank them politely\n"
                        f"- If scam flags, disengage politely\n"
                        f"- Ask about key stuff not yet covered: lease term, utilities, pets, move-in flexibility\n"
                        f"- Push toward scheduling a tour if one isn't set yet, but say you'll confirm times with the renter\n"
                        f"- Do NOT repeat questions already answered\n"
                        f"- Do NOT make up info about the renter\n"
                        f"- Return ONLY a JSON array of strings, e.g. [\"msg1\", \"msg2\"]\n"
                    )
                    async with httpx.AsyncClient() as http:
                        grok_resp = await http.post(
                            "https://api.x.ai/v1/chat/completions",
                            headers={"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"},
                            json={"model": "grok-3", "messages": [{"role": "user", "content": reply_prompt}], "max_tokens": 300},
                            timeout=10,
                        )
                        grok_resp.raise_for_status()
                        reply_raw = grok_resp.json()["choices"][0]["message"]["content"].strip()

                    reply_parts = [reply_raw]
                    try:
                        match = re.search(r"\[.*\]", reply_raw, re.DOTALL)
                        if match:
                            parsed = json.loads(match.group())
                            if isinstance(parsed, list) and all(isinstance(p, str) for p in parsed):
                                reply_parts = [p.strip() for p in parsed if p.strip()][:3]
                    except (json.JSONDecodeError, TypeError):
                        pass

                    await _send_sms_parts(from_number, reply_parts)
                    for part in reply_parts:
                        add_outreach_event(oid, "sms_sent", json.dumps({"body": part}))
                    log.info("Auto-replied (%d parts) to %s for outreach %s (intent: %s)", len(reply_parts), from_number, oid, analysis.get("intent"))
            else:
                log.info("Not replying to %s — analysis says should_reply=false (intent: %s)", oid, analysis.get("intent"))
                add_outreach_event(oid, "auto_reply_skipped", json.dumps({"reason": analysis.get("intent")}))
                if new_status in ("rejected", "scam_flagged") and new_status == current_status:
                    asyncio.create_task(_notify_renter(
                        row["renter_phone"], oid, new_status, listing,
                        detail=analysis.get("summary", ""),
                    ))

        except Exception as exc:
            log.error("SMS processing failed for outreach %s: %s", oid, exc)

    # Clean up lock if no longer needed
    if oid in _outreach_locks and not _outreach_locks[oid].locked():
        _outreach_locks.pop(oid, None)

    return empty_twiml


def _extract_sms_body(detail: str | None) -> str:
    """Extract SMS body text from an event detail JSON string."""
    if not detail:
        return ""
    try:
        d = json.loads(detail)
        return d.get("body", "")
    except (json.JSONDecodeError, TypeError):
        return detail


@app.get("/api/outreach/dashboard/{phone}")
async def api_outreach_dashboard(phone: str) -> dict[str, Any]:
    """Get all outreach for a renter — the dashboard view with events."""
    phone = phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")","").replace("+","")
    items = list_outreach_for_renter(phone)
    if items:
        events_map = batch_list_outreach_events([i["outreach_id"] for i in items])
        for item in items:
            item["events"] = events_map.get(item["outreach_id"], [])
    return {"phone": phone, "count": len(items), "outreach": items}


@app.get("/api/outreach/{outreach_id}")
async def api_get_outreach(outreach_id: str) -> dict[str, Any]:
    record = get_outreach(outreach_id)
    if not record:
        raise HTTPException(status_code=404, detail="Outreach not found")
    record["events"] = list_outreach_events(outreach_id)
    return record


class OutreachUpdateRequest(BaseModel):
    status: str | None = None
    scam_flags: str | None = Field(default=None, max_length=1000)
    negotiation_result: str | None = Field(default=None, max_length=1000)
    tour_time: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=2000)


@app.post("/api/outreach/{outreach_id}/update")
async def api_update_outreach(outreach_id: str, body: OutreachUpdateRequest) -> dict[str, Any]:
    if body.status and body.status not in VALID_OUTREACH_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_OUTREACH_STATUSES))}")
    ok = update_outreach(
        outreach_id,
        status=body.status,
        scam_flags=body.scam_flags,
        negotiation_result=body.negotiation_result,
        tour_time=body.tour_time,
        summary=body.summary,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Outreach not found")
    if body.status:
        add_outreach_event(outreach_id, "status_change", body.status)
    return {"ok": True}
