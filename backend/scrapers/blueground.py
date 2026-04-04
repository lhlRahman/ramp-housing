import logging
import re

import browser as shared_browser
from models import Listing
from utils import make_id

log = logging.getLogger(__name__)

_session: dict = {"ready": False}


async def refresh_session():
    _session["ready"] = True
    log.info("Session marked ready")


async def scrape(city_slug: str | None, check_in: str | None, check_out: str | None, min_price: int, max_price: int, bedrooms: list[int]) -> list[Listing]:
    if not city_slug or not check_in or not check_out:
        log.info("Skipping — requires city_slug, check_in, and check_out")
        return []

    listings: list[Listing] = []
    map_data: dict = {}

    async with shared_browser.new_page() as page:
        async def on_response(resp):
            if "/api/sp/map" in resp.url:
                try:
                    data = await resp.json()
                    props = data.get("properties", {})
                    for pid, info in props.items():
                        map_data[str(pid)] = {
                            "lat": info.get("lat"),
                            "lng": info.get("lng"),
                        }
                    log.debug("Map API returned %d properties", len(props))
                except Exception as e:
                    log.warning("Map API parse error: %s", e)

        page.on("response", on_response)

        try:
            url = f"https://www.theblueground.com/furnished-apartments-{city_slug}?checkIn={check_in}&checkOut={check_out}"
            await page.goto(url, timeout=30000)
            await page.wait_for_timeout(5000)

            # Dismiss cookie consent
            try:
                accept_btn = page.locator('button:has-text("Accept")')
                if await accept_btn.count() > 0:
                    await accept_btn.first.click()
                    await page.wait_for_timeout(500)
            except Exception:
                pass

            for _ in range(15):
                await page.evaluate("window.scrollBy(0, 1500)")
                await page.wait_for_timeout(600)

            cards = await page.evaluate(r"""
                () => {
                    const results = [];
                    const seen = new Set();
                    const cardEls = document.querySelectorAll('[data-listing-property-id]');
                    for (const el of cardEls) {
                        const mapId = el.getAttribute('data-listing-property-id');
                        if (!mapId || seen.has(mapId)) continue;
                        seen.add(mapId);
                        const text = el.innerText || '';
                        const idMatch = text.match(/#(\d+)/);
                        const code = idMatch ? idMatch[1] : '';
                        const link = el.closest('a') || el.querySelector('a');
                        const href = link ? link.href : '';
                        const parent = el.closest('a') || el.parentElement;
                        const img = parent ? parent.querySelector('img') : el.querySelector('img');
                        const photo = (img && img.src) ? img.src : '';
                        results.push({ mapId, code, text, href, photo });
                    }
                    return results;
                }
            """)

            log.debug("Extracted %d listing cards", len(cards))

            for card in cards:
                text = card["text"]
                map_id = card["mapId"]
                prop_code = card["code"]

                price_match = re.search(r"\$([0-9,]+)\s*\n?\s*rent/mo", text)
                if not price_match:
                    # Try EUR or other currency
                    price_match = re.search(r"([0-9,.]+)\s*[€£]\s*\n?\s*rent/mo", text)
                    if not price_match:
                        price_match = re.search(r"[€£]\s*([0-9,.]+)\s*\n?\s*rent/mo", text)
                if not price_match:
                    continue
                price = int(price_match.group(1).replace(",", "").replace(".", ""))

                if price < min_price or price > max_price:
                    continue

                nums = re.findall(r"rent/mo\s*\n\s*(\d+)\s*\n\s*(\d+)", text)
                beds = int(nums[0][0]) if nums else 1
                baths = int(nums[0][1]) if nums else 1

                if beds not in bedrooms:
                    continue

                addr_match = re.search(r"#\d+\s*•\s*(.+)$", text, re.MULTILINE)
                address = addr_match.group(1).strip() if addr_match else ""

                parts = address.rsplit(",", 1)
                neighborhood = parts[-1].strip() if len(parts) > 1 else ""

                coords = map_data.get(map_id, {})
                lat = coords.get("lat")
                lng = coords.get("lng")

                listing_url = card.get("href") or (f"https://www.theblueground.com/p/furnished-apartments/{prop_code}" if prop_code else "")
                if not listing_url:
                    # No URL and no prop_code — use map_id as fallback identifier
                    listing_url = f"https://www.theblueground.com/p/{map_id}"

                listings.append(Listing(
                    id=make_id("blueground", listing_url),
                    source="blueground",
                    title=f"Blueground #{prop_code} - {address}" if address else f"Blueground #{prop_code}",
                    address=address,
                    neighborhood=neighborhood,
                    lat=float(lat) if lat else None,
                    lng=float(lng) if lng else None,
                    price_min=price,
                    price_max=price,
                    bedrooms=beds,
                    bathrooms=float(baths),
                    furnished=True,
                    available_from=check_in,
                    available_to=check_out,
                    no_fee=False,
                    url=listing_url,
                    photo_url=card.get("photo") or None,
                    photos=[card["photo"]] if card.get("photo") else [],
                    listing_type="apartment",
                ))

        except Exception as e:
            log.error("Scrape error: %s", e)

    _session["ready"] = True
    log.info("%d listings", len(listings))
    return listings
