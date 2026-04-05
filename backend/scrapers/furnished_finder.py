import logging
import re

import browser as shared_browser
from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

BASE_URL = "https://www.furnishedfinder.com"


async def scrape(city_slug: str | None, check_in: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    if not city_slug:
        return []

    listings: list[Listing] = []
    search_url = f"{BASE_URL}/housing/{city_slug}"

    async with shared_browser.new_page() as page:
        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(5000)

            cards = await page.evaluate("""
                () => {
                    const cards = document.querySelectorAll('.property-card');
                    if (cards.length === 0) {
                        const links = document.querySelectorAll('a[href*="/property/"]');
                        return [...links].map(a => {
                            const img = a.querySelector('img') || a.parentElement.querySelector('img');
                            return {
                                href: a.href,
                                text: a.innerText || '',
                                photo: (img && img.src) ? img.src : '',
                            };
                        }).filter(c => c.text.length > 20);
                    }
                    return [...cards].map(card => {
                        const link = card.querySelector('a[href*="/property/"]');
                        const img = card.querySelector('img');
                        return {
                            href: link ? link.href : '',
                            text: card.innerText || '',
                            photo: (img && img.src) ? img.src : '',
                        };
                    }).filter(c => c.text.length > 20 && c.href);
                }
            """)

            log.debug("Found %d cards on page", len(cards))

            for card in cards:
                text = card.get("text", "")
                href = card.get("href", "")

                price_match = re.search(r"\$([0-9,]+)/month", text)
                if not price_match:
                    continue
                price = int(price_match.group(1).replace(",", ""))

                if price < min_price or price > max_price:
                    continue

                beds_match = re.search(r"(\d+)\s+Bedroom", text, re.IGNORECASE)
                baths_match = re.search(r"([\d.]+)\s+Bathroom", text, re.IGNORECASE)
                beds = int(beds_match.group(1)) if beds_match else 1
                baths = float(baths_match.group(1)) if baths_match else 1.0

                if beds not in bedrooms:
                    continue

                lines = [l.strip() for l in text.strip().split("\n") if l.strip()]

                listing_type_raw = lines[0].lower() if lines else "apartment"
                if "room" in listing_type_raw:
                    listing_type = "room"
                elif "house" in listing_type_raw:
                    listing_type = "house"
                else:
                    listing_type = "apartment"

                title = lines[1] if len(lines) > 1 else "Furnished Finder"
                location = lines[2] if len(lines) > 2 else ""

                listings.append(Listing(
                    id=make_id("furnished_finder", href),
                    source="furnished_finder",
                    title=title,
                    address=location,
                    neighborhood=location,
                    price_min=price,
                    price_max=price,
                    bedrooms=beds,
                    bathrooms=baths,
                    furnished=True,
                    available_from=check_in,
                    available_to=None,
                    no_fee=False,
                    url=href,
                    photo_url=card.get("photo") or None,
                    photos=[card["photo"]] if card.get("photo") else [],
                    listing_type=listing_type,
                ))

        except Exception as e:
            log.error("Scrape error: %s", e)

    log.info("%d listings", len(listings))
    return listings
