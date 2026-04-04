import logging
import re

import httpx
from bs4 import BeautifulSoup

from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

FIND_ROOM_URL = "https://www.alohause.com/find-room"
AVAIL_API = "https://portal.alohause.com/Alohause/getRtAvailability.php"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
}


async def scrape(check_in: str | None, check_out: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    listings: list[Listing] = []

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        try:
            resp = await client.get(FIND_ROOM_URL, headers=HEADERS)
            soup = BeautifulSoup(resp.text, "lxml")
        except Exception as e:
            log.error("Failed to load find-room page: %s", e)
            return []

        # Get available UUIDs for the date range
        available_ids: set[str] = set()
        if check_in and check_out:
            try:
                avail_resp = await client.get(
                    AVAIL_API,
                    params={"checkIn": check_in, "checkOut": check_out},
                    headers=HEADERS,
                )
                avail_data = avail_resp.json()
                available_ids = {str(item) if isinstance(item, str) else str(item.get("id", "")) for item in avail_data} if isinstance(avail_data, list) else set()
            except Exception as e:
                log.warning("Availability API error: %s", e)

        room_cards = soup.select("[data-booked-property-id]")
        log.debug("Found %d room cards in HTML", len(room_cards))

        for card in room_cards:
            prop_id = card.get("data-booked-property-id", "")

            if check_in and check_out and available_ids and prop_id not in available_ids:
                continue

            price_text = card.get_text()
            price_match = re.search(r"\$(\d[\d,]*)", price_text)
            if not price_match:
                continue
            price = int(price_match.group(1).replace(",", ""))

            if price < min_price or price > max_price:
                continue

            if 1 not in bedrooms and 0 not in bedrooms:
                continue

            lat_el = card.select_one(".hidden-lat")
            lng_el = card.select_one(".hidden-long")
            city_el = card.select_one(".hidden-city")
            neighborhood_el = card.select_one(".hidden-neighborhood")
            baths_el = card.select_one(".hidden-bathrooms")

            try:
                lat = float(lat_el.get_text(strip=True)) if lat_el and lat_el.get_text(strip=True) else None
            except (ValueError, TypeError):
                lat = None
            try:
                lng = float(lng_el.get_text(strip=True)) if lng_el and lng_el.get_text(strip=True) else None
            except (ValueError, TypeError):
                lng = None
            city = city_el.get_text(strip=True) if city_el else "Manhattan"
            neighborhood = neighborhood_el.get_text(strip=True) if neighborhood_el else "New York"
            try:
                baths = float(baths_el.get_text(strip=True)) if baths_el and baths_el.get_text(strip=True) else 1.0
            except (ValueError, TypeError):
                baths = 1.0

            content_el = card.select_one(".list-item-content")
            title_parts = []
            if content_el:
                for child in content_el.children:
                    if hasattr(child, "name") and child.name in ("h2", "h3", "h4", "div"):
                        t = child.get_text(strip=True)
                        if t and not t.startswith("$") and "Available" not in t:
                            title_parts.append(t)
                            if len(title_parts) == 1:
                                break

            title = title_parts[0] if title_parts else f"{neighborhood} Room"

            address = ""
            if content_el:
                for child in content_el.descendants:
                    if hasattr(child, "string") and child.string:
                        text = child.string.strip()
                        if re.match(r"\d+\s+\w+", text) and len(text) > 5 and "$" not in text:
                            address = text
                            break
            if not address:
                address = f"{neighborhood}, {city}"

            link_el = card.select_one("a[href]")
            url = link_el["href"] if link_el else FIND_ROOM_URL
            if url and not url.startswith("http"):
                url = f"https://www.alohause.com{url}"

            img_els = card.select("img[src]")
            photo_urls = [img["src"] for img in img_els if img.get("src")]
            photo_url = photo_urls[0] if photo_urls else None

            # Available date — walk individual text nodes to avoid concatenation
            avail_from = check_in
            for child in card.descendants:
                if hasattr(child, "string") and child.string:
                    text = child.string.strip()
                    am = re.match(r"Available\s+(?:from\s+)?(.+)", text, re.IGNORECASE)
                    if am and len(am.group(1)) < 40:
                        avail_from = am.group(1).strip()
                        break

            listings.append(Listing(
                id=make_id("alohause", url or prop_id),
                source="alohause",
                title=title,
                address=address,
                neighborhood=neighborhood,
                lat=lat,
                lng=lng,
                price_min=price,
                price_max=price,
                bedrooms=1,
                bathrooms=baths,
                furnished=True,
                available_from=avail_from,
                available_to=check_out,
                no_fee=True,
                url=url or FIND_ROOM_URL,
                photo_url=photo_url,
                photos=photo_urls,
                listing_type="room",
            ))

    log.info("%d listings", len(listings))
    return listings
