import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import browser
import config
import db
import geocoder
from cities import get_all_cities, match_city
from models import Listing
from utils import deduplicate, point_in_polygon, polygon_centroid
from scrapers import blueground as bg_scraper
from scrapers import june_homes, alohause, furnished_finder, leasebreak, renthop

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ramp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    asyncio.create_task(bg_scraper.refresh_session())
    log.info("Backend ready")
    yield
    await browser.shutdown()


app = FastAPI(
    title="Ramp Housing API",
    description="Aggregates housing listings globally from multiple sources",
    version="2.0.0",
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
    for listing in listings:
        if listing.lat is None or listing.lng is None:
            addr = listing.address
            if addr and geocode_suffix and geocode_suffix.lower() not in addr.lower():
                addr = addr + geocode_suffix
            coords = await geocoder.geocode(addr)
            if coords:
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

    return tasks


@app.get("/api/cities")
async def list_cities():
    return get_all_cities()


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
    # Validate polygon
    try:
        poly = json.loads(polygon)
        if not isinstance(poly, list) or len(poly) < 3:
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid polygon — need JSON array of ≥3 [lat,lng] pairs")

    # Auto-detect city from polygon centroid
    centroid_lat, centroid_lng = polygon_centroid(poly)
    location = await geocoder.reverse_geocode(centroid_lat, centroid_lng)

    detected_name = None
    city_match = None
    if location:
        detected_name = location.get("city") or location.get("display_name", "Unknown area")
        city_match = match_city(location)

    if not city_match:
        return {
            "listings": [],
            "stats": {"total_scraped": 0, "geocoded": 0, "in_polygon": 0, "returned": 0, "skipped_no_coords": 0},
            "available_sources": [],
            "detected_location": detected_name or "Unknown area",
            "city_id": None,
            "message": f"No sources available for this area ({detected_name or 'unknown location'})",
        }

    city_id, city_data = city_match
    city_slugs = city_data.get("slugs", {})
    geocode_suffix = city_data.get("geocode_suffix", "")
    available_sources = list(city_slugs.keys())

    log.info("Detected city: %s (%s) — %d sources available", city_data["name"], city_id, len(available_sources))

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
            "detected_location": city_data["name"],
            "city_id": city_id,
        }

    named_tasks = _build_scraper_tasks(
        city_slugs, check_in, check_out, min_price, max_price, bed_list, source_list, furnished, no_fee,
    )
    results = await asyncio.gather(*[t[1] for t in named_tasks], return_exceptions=True)

    all_listings: list[Listing] = []
    for (src_name, _), result in zip(named_tasks, results):
        if isinstance(result, Exception):
            log.error("Scraper %s failed: %s", src_name, result)
            continue
        log.info("Scraper %s returned %d listings", src_name, len(result))
        all_listings.extend(result)

    if furnished:
        all_listings = [l for l in all_listings if l.furnished]

    all_listings = await geocode_listings(all_listings, geocode_suffix)

    with_coords = [l for l in all_listings if l.lat is not None and l.lng is not None]
    without_coords = len(all_listings) - len(with_coords)

    in_polygon = [l for l in with_coords if point_in_polygon(l.lat, l.lng, poly)]
    final = deduplicate(in_polygon)

    log.info(
        "Search [%s]: %d scraped → %d geocoded → %d in polygon → %d returned",
        city_id, len(all_listings), len(with_coords), len(in_polygon), len(final),
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
        "detected_location": city_data["name"],
        "city_id": city_id,
    }


@app.get("/api/listing/detail")
async def listing_detail(url: str = Query(..., description="Original listing URL")) -> dict[str, Any]:
    from scrapers import detail_scraper
    try:
        return await detail_scraper.scrape_detail(url)
    except Exception as e:
        log.error("Detail scrape failed for %s: %s", url, e)
        raise HTTPException(status_code=502, detail=f"Failed to scrape listing detail: {e}")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
