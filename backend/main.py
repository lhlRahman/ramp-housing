import asyncio
import datetime
import hashlib
import json
import logging
import re
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import browser
import config
import db
from db import get_cached_scrape, cache_scrape
import geocoder
from cities import resolve_location
from models import Listing
from utils import deduplicate, point_in_polygon, polygon_centroid
from scrapers import blueground as bg_scraper
from scrapers import june_homes, alohause, furnished_finder, leasebreak, renthop, zumper, craigslist

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ramp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    await geocoder.startup()
    asyncio.create_task(bg_scraper.refresh_session())
    log.info("Backend ready")
    yield
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

        async def _process_and_send(src_name: str, batch: list[Listing]) -> None:
            nonlocal total_stats
            if furnished:
                batch = [l for l in batch if l.furnished]
            batch = await geocode_listings(batch, geocode_suffix)
            with_coords = [l for l in batch if l.lat is not None and l.lng is not None]
            in_poly = [l for l in with_coords if l.lat is not None and l.lng is not None and point_in_polygon(l.lat, l.lng, poly)]
            final = deduplicate(in_poly)
            # Cross-batch dedup
            final = [l for l in final if l.id not in seen_ids]
            for l in final:
                seen_ids.add(l.id)
            total_stats["total_scraped"] += len(batch)
            total_stats["geocoded"] += len(with_coords)
            total_stats["in_polygon"] += len(in_poly)
            total_stats["returned"] += len(final)
            total_stats["skipped_no_coords"] += len(batch) - len(with_coords)
            if final:
                await websocket.send_json({
                    "type": "listings",
                    "source": src_name,
                    "listings": [l.model_dump() for l in final],
                })

        # Serve cached sources immediately
        uncached_sources = []
        for src in source_list:
            cached = get_cached_scrape(src, city_key, params_hash)
            if cached is not None:
                batch = [Listing(**l) for l in cached]
                await _process_and_send(src, batch)
                await websocket.send_json({"type": "source_status", "source": src, "status": "done", "count": len(batch), "cached": True})
            else:
                uncached_sources.append(src)
                await websocket.send_json({"type": "source_status", "source": src, "status": "scraping", "count": 0, "cached": False})

        # Scrape uncached sources concurrently, stream as each finishes
        if uncached_sources:
            named_tasks = _build_scraper_tasks(
                city_slugs, check_in, check_out, min_price, max_price, bed_list, uncached_sources, furnished, no_fee,
            )
            task_to_src: dict[asyncio.Task, str] = {}
            for src_name, coro in named_tasks:
                t = asyncio.create_task(coro)
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
                    cache_scrape(src_name, city_key, params_hash, [l.model_dump() for l in result])
                    await _process_and_send(src_name, result)
                    await websocket.send_json({"type": "source_status", "source": src_name, "status": "done", "count": len(result), "cached": False})

        await websocket.send_json({"type": "done", "stats": total_stats})

    except WebSocketDisconnect:
        log.info("WS client disconnected")
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

    # Scrape only uncached sources
    if uncached_sources:
        named_tasks = _build_scraper_tasks(
            city_slugs, check_in, check_out, min_price, max_price, bed_list, uncached_sources, furnished, no_fee,
        )
        results = await asyncio.gather(*[t[1] for t in named_tasks], return_exceptions=True)

        for (src_name, _), result in zip(named_tasks, results):
            if isinstance(result, Exception):
                log.error("Scraper %s failed: %s", src_name, result)
                continue
            log.info("Scraper %s returned %d listings", src_name, len(result))
            # Cache the results
            cache_scrape(src_name, city_key, params_hash, [l.model_dump() for l in result])
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
                "model": "grok-3-mini",
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
