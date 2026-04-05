import logging
import re
import json

import httpx

from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
}

# Craigslist uses city-specific subdomains
# Major metros map: state_abbr → craigslist subdomain
CL_SUBDOMAINS: dict[str, dict[str, str]] = {
    "ny": {"new york": "newyork", "buffalo": "buffalo", "albany": "albany", "rochester": "rochester", "syracuse": "syracuse"},
    "ca": {"san francisco": "sfbay", "los angeles": "losangeles", "san diego": "sandiego", "san jose": "sfbay", "sacramento": "sacramento", "fresno": "fresno"},
    "il": {"chicago": "chicago"},
    "tx": {"houston": "houston", "dallas": "dallas", "austin": "austin", "san antonio": "sanantonio"},
    "az": {"phoenix": "phoenix", "tucson": "tucson"},
    "pa": {"philadelphia": "philadelphia", "pittsburgh": "pittsburgh"},
    "fl": {"miami": "miami", "orlando": "orlando", "tampa": "tampa", "jacksonville": "jacksonville"},
    "oh": {"columbus": "columbus", "cleveland": "cleveland", "cincinnati": "cincinnati"},
    "ga": {"atlanta": "atlanta"},
    "nc": {"charlotte": "charlotte", "raleigh": "raleigh"},
    "mi": {"detroit": "detroit"},
    "wa": {"seattle": "seattle"},
    "ma": {"boston": "boston"},
    "co": {"denver": "denver"},
    "or": {"portland": "portland"},
    "mn": {"minneapolis": "minneapolis"},
    "mo": {"st louis": "stlouis", "kansas city": "kansascity"},
    "tn": {"nashville": "nashville", "memphis": "memphis"},
    "md": {"baltimore": "baltimore"},
    "wi": {"milwaukee": "milwaukee"},
    "in": {"indianapolis": "indianapolis"},
    "dc": {"washington": "washingtondc"},
    "nv": {"las vegas": "lasvegas"},
    "va": {"richmond": "richmond"},
    "la": {"new orleans": "neworleans"},
    "ky": {"louisville": "louisville"},
    "ok": {"oklahoma city": "oklahomacity"},
    "ct": {"hartford": "hartford", "new haven": "newhaven"},
    "ut": {"salt lake city": "saltlakecity"},
    "hi": {"honolulu": "honolulu"},
    "nm": {"albuquerque": "albuquerque"},
    "ne": {"omaha": "omaha"},
    "id": {"boise": "boise"},
}


def get_subdomain(city: str, state: str) -> str | None:
    """Get craigslist subdomain for a city/state combo."""
    state_cities = CL_SUBDOMAINS.get(state.lower())
    if not state_cities:
        return None
    # Try exact match first
    subdomain = state_cities.get(city.lower())
    if subdomain:
        return subdomain
    # Try partial match
    for cl_city, sub in state_cities.items():
        if cl_city in city.lower() or city.lower() in cl_city:
            return sub
    return None


CL_MAX_PAGES = 10  # 120 results per page → up to ~1200 listings
CL_PAGE_SIZE = 120


def _parse_page(text: str, city: str, state: str, base_url: str, min_price: int, max_price: int, bedrooms: list[int], seen_urls: set[str]) -> list[Listing]:
    """Parse a single Craigslist search results page and return new listings."""
    results: list[Listing] = []

    ld_matches = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', text, re.DOTALL)
    ld_items: list[dict] = []
    for m in ld_matches:
        try:
            data = json.loads(m)
            if isinstance(data, dict) and data.get("itemListElement"):
                ld_items = data["itemListElement"]
                break
        except Exception:
            continue

    price_map: dict[str, int] = {}
    cards = re.findall(
        r'<li class="cl-static-search-result"[^>]*>.*?<a href="([^"]+)".*?<div class="price">\$?([\d,]+)</div>',
        text, re.DOTALL,
    )
    for href, price_str in cards:
        price_map[href] = int(price_str.replace(",", ""))

    location_map: dict[str, str] = {}
    loc_cards = re.findall(
        r'<a href="([^"]+)".*?<div class="location">\s*([^<]+)',
        text, re.DOTALL,
    )
    for href, loc in loc_cards:
        location_map[href] = loc.strip()

    listing_urls = re.findall(r'href="(https://[^"]*craigslist[^"]*\.html)"', text)
    url_set = list(dict.fromkeys(listing_urls))

    for i, ld_entry in enumerate(ld_items):
        item = ld_entry.get("item", {})
        listing_url = url_set[i] if i < len(url_set) else ""

        if listing_url in seen_urls:
            continue

        lat = item.get("latitude")
        lng = item.get("longitude")
        name = item.get("name", "")
        beds = item.get("numberOfBedrooms")
        baths = item.get("numberOfBathroomsTotal", 1)
        addr_obj = item.get("address", {})
        locality = addr_obj.get("addressLocality", "")
        region = addr_obj.get("addressRegion", "")

        price = price_map.get(listing_url, 0)
        if not price:
            price_match = re.search(r"\$(\d[\d,]*)", name)
            if price_match:
                price = int(price_match.group(1).replace(",", ""))

        if not price:
            continue
        if price < min_price or price > max_price:
            continue

        beds = int(beds) if beds else 1
        if beds not in bedrooms:
            continue

        neighborhood = location_map.get(listing_url, locality)
        if listing_url:
            seen_urls.add(listing_url)

        results.append(Listing(
            id=make_id("craigslist", listing_url or f"cl-{i}"),
            source="craigslist",
            title=name[:100] if name else f"Craigslist - {locality}",
            address=f"{locality}, {region}" if locality else f"{city}, {state.upper()}",
            neighborhood=neighborhood or locality,
            lat=float(lat) if lat else None,
            lng=float(lng) if lng else None,
            price_min=price,
            price_max=price,
            bedrooms=beds,
            bathrooms=float(baths) if baths else 1.0,
            furnished=False,
            available_from=None,
            available_to=None,
            no_fee=False,
            url=listing_url or base_url,
            photo_url=None,
            photos=[],
            listing_type="apartment",
        ))

    return results


async def scrape(city: str, state: str, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    subdomain = get_subdomain(city, state)
    if not subdomain:
        log.info("No craigslist subdomain for %s, %s", city, state)
        return []

    listings: list[Listing] = []
    seen_urls: set[str] = set()
    base_url = f"https://{subdomain}.craigslist.org/search/apa"

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for page in range(CL_MAX_PAGES):
            offset = page * CL_PAGE_SIZE
            url = base_url if page == 0 else f"{base_url}?s={offset}"

            try:
                resp = await client.get(url, headers=HEADERS)
            except Exception as e:
                log.error("Failed to load %s page %d: %s", base_url, page, e)
                break

            new = _parse_page(resp.text, city, state, base_url, min_price, max_price, bedrooms, seen_urls)
            listings.extend(new)
            log.debug("CL page %d: %d new listings (total: %d)", page, len(new), len(listings))

            # Stop if page returned no new results (end of listings)
            if not new:
                break

    log.info("%d listings from %s.craigslist.org (%d pages)", len(listings), subdomain, min(len(listings) // max(CL_PAGE_SIZE, 1) + 1, CL_MAX_PAGES))
    return listings
