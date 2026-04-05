import logging

import httpx

from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

BASE = "https://junehomes.com/api"


async def scrape(city_slug: str | None, check_in: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    if not city_slug:
        return []

    listings: list[Listing] = []
    seen_urls: set[str] = set()
    page = 1
    empty_pages = 0

    async with httpx.AsyncClient(timeout=15) as client:
        while page <= 100 and empty_pages < 5:  # scrape all pages, stop after 5 consecutive dupes
            params: dict = {
                "city": city_slug,
                "page": page,
                "minPrice": min_price,
                "maxPrice": max_price,
            }
            if check_in:
                params["availableFrom"] = check_in

            try:
                resp = await client.get(f"{BASE}/listings", params=params)
                data = resp.json()
            except Exception as e:
                log.warning("Page %d error: %s", page, e)
                break

            items = data if isinstance(data, list) else data.get("items") or data.get("listings") or data.get("results") or []
            if not items:
                log.debug("Page %d: no items found. Keys: %s", page, list(data.keys()) if isinstance(data, dict) else "list")
                break

            new_this_page = 0
            for item in items:
                beds = int(item.get("bedrooms") or item.get("bedroomsCount") or 1)
                if beds not in bedrooms:
                    continue

                price = float(item.get("price") or 0)
                url = item.get("url") or "https://junehomes.com"
                if not url.startswith("http"):
                    url = f"https://junehomes.com{url}"

                if url in seen_urls:
                    continue
                seen_urls.add(url)
                new_this_page += 1

                photos_raw = item.get("photos", [])
                photo_urls = []
                for p in photos_raw:
                    if isinstance(p, str):
                        photo_urls.append(p)
                    elif isinstance(p, dict):
                        previews = p.get("previews") or []
                        if previews and isinstance(previews, list):
                            photo_urls.append(previews[0])
                        else:
                            url_val = p.get("preview") or p.get("url") or p.get("src") or ""
                            if url_val:
                                photo_urls.append(url_val)

                area = item.get("area") or {}
                city_obj = item.get("city") or {}

                amenities = []
                for tag in item.get("tags", []):
                    if isinstance(tag, str):
                        amenities.append(tag)
                    elif isinstance(tag, dict):
                        amenities.append(tag.get("name") or tag.get("title") or "")

                listings.append(Listing(
                    id=make_id("june_homes", url),
                    source="june_homes",
                    title=item.get("name") or item.get("systemName") or "June Homes",
                    address=item.get("address") or "",
                    neighborhood=area.get("title") or city_obj.get("name") or "",
                    price_min=int(price),
                    price_max=int(price),
                    bedrooms=beds,
                    bathrooms=float(item.get("bathrooms") or item.get("bathroomsCount") or 1),
                    furnished=str(item.get("furnishingStatus") or "").lower() == "furnished",
                    available_from=item.get("availableFrom"),
                    available_to=None,
                    no_fee=False,
                    url=url,
                    photo_url=photo_urls[0] if photo_urls else None,
                    photos=photo_urls,
                    listing_type="room",
                    description=item.get("description"),
                    amenities=[a for a in amenities if a],
                ))

            if new_this_page == 0:
                empty_pages += 1
            else:
                empty_pages = 0

            has_more = data.get("next") if isinstance(data, dict) else False
            if not has_more and new_this_page == 0:
                break
            page += 1

    log.info("%d unique listings (scanned %d pages)", len(listings), page - 1)
    return listings
