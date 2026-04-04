import logging
import asyncio

import httpx

from config import ZUMPER_PAGE_CONCURRENCY
from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

API_URL = "https://www.zumper.com/api/t/1/pages/listables"
IMG_BASE = "https://img.zumpercdn.com"
PAGE_SIZE = 50


def _img_url(image_id: int) -> str:
    return f"{IMG_BASE}/{image_id}/1280x960"


def _parse_items(
    items: list[dict],
    city_slug: str,
    min_price: int,
    max_price: int,
    bedrooms: list[int],
) -> list[Listing]:
    listings: list[Listing] = []

    for item in items:
        price_min = item.get("min_price") or item.get("base_min_price") or 0
        price_max = item.get("max_price") or item.get("base_max_price") or price_min

        if not price_min and not price_max:
            continue
        if price_min and (price_min < min_price or price_min > max_price):
            continue

        beds_min = item.get("min_bedrooms", 1)
        beds_max = item.get("max_bedrooms", beds_min)
        if not any(b >= beds_min and b <= beds_max for b in bedrooms):
            if beds_min != 0 or 0 not in bedrooms:
                continue

        lat = item.get("lat")
        lng = item.get("lng")
        address = item.get("address", "")
        city = item.get("city", "")
        state = item.get("state", "")
        neighborhood = item.get("neighborhood_name") or ""

        image_ids = item.get("image_ids", [])
        photo_urls = [_img_url(img_id) for img_id in image_ids[:10]]

        amenity_tags = item.get("amenity_tags") or []

        url_path = item.get("pb_url", "")
        pb_id = item.get("pb_id", "")
        listing_url = f"https://www.zumper.com/apartment-buildings/p{pb_id}/{url_path}" if pb_id else f"https://www.zumper.com/apartments-for-rent/{city_slug}"

        phone = item.get("phone")
        date_available = item.get("date_available")

        full_address = f"{address}, {city}, {state}" if address else f"{city}, {state}"

        listings.append(Listing(
            id=make_id("zumper", listing_url),
            source="zumper",
            title=item.get("building_name") or item.get("agent_name") or f"Zumper - {address}",
            address=full_address,
            neighborhood=neighborhood,
            lat=float(lat) if lat else None,
            lng=float(lng) if lng else None,
            price_min=int(price_min),
            price_max=int(price_max),
            bedrooms=beds_min,
            bathrooms=float(item.get("min_bathrooms") or 1.0),
            furnished=False,
            available_from=date_available,
            available_to=None,
            no_fee=item.get("leasing_fee", 0) in (0, None),
            url=listing_url,
            photo_url=photo_urls[0] if photo_urls else None,
            photos=photo_urls,
            listing_type="apartment",
            amenities=amenity_tags[:15],
        ))

    return listings


async def scrape(city_slug: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    if not city_slug:
        return []

    async with httpx.AsyncClient(timeout=20) as client:
        async def _fetch_page(offset: int) -> dict | None:
            try:
                resp = await client.post(API_URL, json={
                    "url": f"/apartments-for-rent/{city_slug}",
                    "limit": PAGE_SIZE,
                    "offset": offset,
                })
                return resp.json()
            except Exception as e:
                log.warning("API error at offset %d: %s", offset, e)
                return None

        first_page = await _fetch_page(0)
        if not first_page:
            return []

        listings = _parse_items(first_page.get("listables", []), city_slug, min_price, max_price, bedrooms)
        total = min(first_page.get("matching", 0), 500)  # cap to prevent excessive requests
        offsets = list(range(PAGE_SIZE, total, PAGE_SIZE))

        if not offsets:
            log.info("%d listings", len(listings))
            return listings

        semaphore = asyncio.Semaphore(max(1, ZUMPER_PAGE_CONCURRENCY))

        async def _bounded_fetch(offset: int) -> dict | None:
            async with semaphore:
                return await _fetch_page(offset)

        page_results = await asyncio.gather(*[_bounded_fetch(offset) for offset in offsets])
        for page in page_results:
            if not page:
                continue
            listings.extend(_parse_items(page.get("listables", []), city_slug, min_price, max_price, bedrooms))

    log.info("%d listings", len(listings))
    return listings
