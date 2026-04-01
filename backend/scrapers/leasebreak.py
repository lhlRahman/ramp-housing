import logging
import re

import browser as shared_browser
from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

BASE_URL = "https://www.leasebreak.com"

PAGES = [
    f"{BASE_URL}/short-term-rentals/Manhattan",
    f"{BASE_URL}/short-term-rentals/Brooklyn",
    f"{BASE_URL}/furnished-rentals/Manhattan",
    f"{BASE_URL}/furnished-rentals/Brooklyn",
    f"{BASE_URL}/sublets/Manhattan",
    f"{BASE_URL}/sublets/Brooklyn",
]


def _parse_item(item_text: str, item_html: str, item_id: str) -> dict | None:
    price_matches = re.findall(r"\$([0-9,]+)", item_text)
    if not price_matches:
        return None
    price_min = int(price_matches[0].replace(",", ""))
    price_max = int(price_matches[1].replace(",", "")) if len(price_matches) > 1 else price_min

    beds_match = re.search(r"BEDROOMS:\s*(\d+)", item_text, re.IGNORECASE)
    beds = int(beds_match.group(1)) if beds_match else 1

    baths_match = re.search(r"BATHROOMS:\s*([\d.]+)", item_text, re.IGNORECASE)
    baths = float(baths_match.group(1)) if baths_match else 1.0

    decor_match = re.search(r"DECOR:\s*([^\n]+)", item_text, re.IGNORECASE)
    decor = decor_match.group(1).strip() if decor_match else ""
    furnished = "furnished" in decor.lower()

    lines = [l.strip() for l in item_text.split("\n") if l.strip()]
    address = ""
    for line in lines:
        if re.search(r"\d+\s+\w+\s+(?:St|Ave|Blvd|Dr|Rd|Lane|Ln|Court|Ct|Place|Pl|Street|Avenue|Broadway|Way|Terrace|Ter)", line, re.IGNORECASE):
            address = line
            break

    neighborhood_match = re.search(r"([A-Za-z'.\- ]+),\s*(Manhattan|Brooklyn)", item_text)
    neighborhood = neighborhood_match.group(0).strip() if neighborhood_match else "Manhattan"

    move_in_match = re.search(r"EARLIEST MOVE-IN\s+([0-9/]+)", item_text, re.IGNORECASE)
    move_in = move_in_match.group(1) if move_in_match else None

    url = ""  # will be set from href extracted in JS

    listing_type_match = re.search(r"LISTING TYPE:\s*([^\n]+)", item_text, re.IGNORECASE)
    lt = listing_type_match.group(1).strip().lower() if listing_type_match else "rental"
    listing_type = "room" if "room" in lt else "apartment"

    return {
        "price_min": price_min,
        "price_max": price_max,
        "beds": beds,
        "baths": baths,
        "furnished": furnished,
        "address": address,
        "neighborhood": neighborhood,
        "available_from": move_in,
        "url": url,
        "listing_type": listing_type,
    }


async def _scrape_page(page, url: str, min_price: int, max_price: int, bedrooms: list[int], furnished_only: bool) -> list[Listing]:
    results: list[Listing] = []
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=35000)
        await page.wait_for_timeout(3000)

        items = await page.evaluate("""
            () => {
                const els = document.querySelectorAll('.search-item');
                return [...els].map(el => {
                    const img = el.querySelector('img');
                    const bgEl = el.querySelector('[style*="background-image"]');
                    let photo = (img && img.src) ? img.src : '';
                    if (!photo && bgEl) {
                        const m = bgEl.style.backgroundImage.match(/url\\(["']?(https?[^"')]+)["']?\\)/);
                        if (m) photo = m[1];
                    }
                    // Extract the real detail page URL
                    const detailLink = el.querySelector('a[href*="-details/"]') ||
                                       el.querySelector('a[href*="-rental-"]') ||
                                       el.querySelector('a.js-track-search-click');
                    const href = detailLink ? detailLink.href : '';

                    return {
                        id: el.id || '',
                        text: el.innerText || '',
                        html: el.innerHTML.slice(0, 500),
                        photo: photo,
                        href: href,
                    };
                }).filter(e => e.text.includes('$'));
            }
        """)

        for item in items:
            item_id = item["id"].replace("listing", "")
            parsed = _parse_item(item["text"], item["html"], item_id)
            if not parsed:
                continue
            if parsed["price_min"] < min_price or parsed["price_min"] > max_price:
                continue
            if parsed["beds"] not in bedrooms:
                continue
            if furnished_only and not parsed["furnished"]:
                continue

            # Use the real detail URL extracted from the page
            detail_url = item.get("href") or f"{BASE_URL}/listing/{item_id}"

            results.append(Listing(
                id=make_id("leasebreak", detail_url),
                source="leasebreak",
                title=f"{parsed['beds']}BR in {parsed['neighborhood']}",
                address=parsed["address"] or parsed["neighborhood"],
                neighborhood=parsed["neighborhood"],
                price_min=parsed["price_min"],
                price_max=parsed["price_max"],
                bedrooms=parsed["beds"],
                bathrooms=parsed["baths"],
                furnished=parsed["furnished"],
                available_from=parsed["available_from"],
                available_to=None,
                no_fee=False,
                url=detail_url,
                photo_url=item.get("photo") or None,
                photos=[item["photo"]] if item.get("photo") else [],
                listing_type=parsed["listing_type"],
            ))
    except Exception as e:
        log.warning("Error on %s: %s", url, e)

    return results


async def scrape(min_price: int, max_price: int, bedrooms: list[int], furnished: bool) -> list[Listing]:
    all_listings: list[Listing] = []

    async with shared_browser.new_page() as page:
        for url in PAGES:
            page_listings = await _scrape_page(page, url, min_price, max_price, bedrooms, furnished)
            all_listings.extend(page_listings)

    log.info("%d listings", len(all_listings))
    return all_listings
