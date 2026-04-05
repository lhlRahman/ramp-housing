import logging
import re

import browser as shared_browser
from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

BASE_URL = "https://www.renthop.com"


def _build_url(city_slug: str, min_price: int, max_price: int, bedrooms: list[int], no_fee: bool) -> str:
    bed_params = "&".join(f"bedrooms[]={b}" for b in bedrooms)
    fee_param = "&has_fee=0" if no_fee else ""
    return f"{BASE_URL}/apartments-for-rent/{city_slug}?{bed_params}&min_price={min_price}&max_price={max_price}{fee_param}"


def _parse_listing(text: str, href: str) -> dict | None:
    if not text or len(text) < 30:
        return None

    lines = [l.strip() for l in text.split("\n") if l.strip()]

    address = ""
    for line in lines:
        if re.match(r"\d+", line) and len(line) > 5:
            address = line
            break

    neighborhood = ""
    for line in lines:
        if "," in line and not re.match(r"\d", line) and len(line) > 5:
            neighborhood = line
            break

    price_match = re.search(r"\$([0-9,]+)", text)
    if not price_match:
        return None
    price = int(price_match.group(1).replace(",", ""))

    no_fee = "no fee" in text.lower()

    bed_match = re.search(r"(\d+)\s*Bed", text, re.IGNORECASE)
    bath_match = re.search(r"([\d.]+)\s*Bath", text, re.IGNORECASE)
    studio_match = re.search(r"studio", text, re.IGNORECASE)

    beds = 0 if studio_match else (int(bed_match.group(1)) if bed_match else 1)
    baths = float(bath_match.group(1)) if bath_match else 1.0

    return {
        "address": address,
        "neighborhood": neighborhood,
        "price": price,
        "no_fee": no_fee,
        "beds": beds,
        "baths": baths,
        "url": href,
    }


async def scrape(city_slug: str | None, min_price: int, max_price: int, bedrooms: list[int], no_fee: bool) -> list[Listing]:
    if not city_slug:
        return []

    listings: list[Listing] = []
    url = _build_url(city_slug, min_price, max_price, bedrooms, no_fee)
    pages_scraped = 0
    consecutive_timeouts = 0

    from config import SCRAPER_MAX_PAGES, USER_AGENT
    br = await shared_browser._ensure_browser()

    try:
        pg = 0
        while pg < SCRAPER_MAX_PAGES:
            pg += 1
            page_url = url if pg == 1 else url + f"&page={pg}"

            ctx = await br.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1280, "height": 900},
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await ctx.new_page()

            try:
                await page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(4000)

                raw_listings = await page.evaluate("""
                    () => {
                        const cards = document.querySelectorAll('.search-listing');
                        return [...cards].map(card => {
                            const link = card.querySelector('a[href*="/listings/"]') ||
                                         card.querySelector('a[href*="/apartments/"]') ||
                                         card.querySelector('a[href]');
                            const img = card.querySelector('img');
                            return {
                                text: card.innerText || '',
                                href: link ? link.href : '',
                                photo: (img && img.src) ? img.src : '',
                            };
                        }).filter(c => c.text.includes('$'));
                    }
                """)

                if not raw_listings:
                    break

                for raw in raw_listings:
                    parsed = _parse_listing(raw["text"], raw["href"])
                    if not parsed:
                        continue
                    if parsed["beds"] not in bedrooms:
                        continue
                    if parsed["price"] < min_price or parsed["price"] > max_price:
                        continue
                    if no_fee and not parsed["no_fee"]:
                        continue

                    listings.append(Listing(
                        id=make_id("renthop", parsed["url"]),
                        source="renthop",
                        title=f"{parsed['beds'] if parsed['beds'] else 'Studio'} BR - {parsed['address']}",
                        address=parsed["address"],
                        neighborhood=parsed["neighborhood"],
                        price_min=parsed["price"],
                        price_max=parsed["price"],
                        bedrooms=parsed["beds"],
                        bathrooms=parsed["baths"],
                        furnished=False,
                        available_from=None,
                        available_to=None,
                        no_fee=parsed["no_fee"],
                        url=parsed["url"] or url,
                        photo_url=raw.get("photo") or None,
                        photos=[raw["photo"]] if raw.get("photo") else [],
                        listing_type="apartment",
                    ))

                log.debug("Page %d: %d cards, %d total", pg, len(raw_listings), len(listings))
                pages_scraped = pg
                consecutive_timeouts = 0

            except Exception as e:
                log.warning("Page %d error: %s", pg, e)
                consecutive_timeouts += 1
                if consecutive_timeouts >= 2:
                    log.warning("2 consecutive timeouts, stopping early")
                    break
            finally:
                await ctx.close()

    except Exception as e:
        log.error("Scrape error: %s", e)

    log.info("%d listings (scraped %d pages)", len(listings), pages_scraped)
    return listings
