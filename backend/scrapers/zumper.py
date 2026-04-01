import logging

import httpx

from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

API_URL = "https://www.zumper.com/api/t/1/pages/listables"
IMG_BASE = "https://img.zumpercdn.com"
PAGE_SIZE = 50


def _img_url(image_id: int) -> str:
    return f"{IMG_BASE}/{image_id}/1280x960"


async def scrape(city_slug: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    if not city_slug:
        return []

    listings: list[Listing] = []
    offset = 0

    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            try:
                resp = await client.post(API_URL, json={
                    "url": f"/apartments-for-rent/{city_slug}",
                    "limit": PAGE_SIZE,
                    "offset": offset,
                })
                data = resp.json()
            except Exception as e:
                log.warning("API error at offset %d: %s", offset, e)
                break

            items = data.get("listables", [])
            if not items:
                break

            for item in items:
                price_min = item.get("min_price") or item.get("base_min_price") or 0
                price_max = item.get("max_price") or item.get("base_max_price") or price_min

                if not price_min and not price_max:
                    continue
                if price_min and (price_min < min_price or price_min > max_price):
                    continue

                beds_min = item.get("min_bedrooms", 1)
                beds_max = item.get("max_bedrooms", beds_min)
                # Check if any of the listing's bedroom range overlaps with requested
                if not any(b >= beds_min and b <= beds_max for b in bedrooms):
                    # Also allow if beds_min is 0 (studio) and 0 is in bedrooms
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
                    no_fee=item.get("leasing_fee") == 0,
                    url=listing_url,
                    photo_url=photo_urls[0] if photo_urls else None,
                    photos=photo_urls,
                    listing_type="apartment",
                    amenities=amenity_tags[:15],
                ))

            offset += PAGE_SIZE
            total = data.get("matching", 0)

            # Cap at 500 listings to keep response times reasonable
            if offset >= total or offset >= 500:
                break

    log.info("%d listings", len(listings))
    return listings
