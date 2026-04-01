import asyncio
import logging
import time

import httpx

from config import NOMINATIM_URL, NOMINATIM_REVERSE_URL, NOMINATIM_RATE_LIMIT, NOMINATIM_USER_AGENT
from db import get_cached_coords, cache_coords

log = logging.getLogger(__name__)

_last_request = 0.0
_lock = asyncio.Lock()


async def geocode(address: str) -> tuple[float, float] | None:
    """Convert address string to (lat, lng). Caches in SQLite, rate-limits to Nominatim."""
    cached = get_cached_coords(address)
    if cached:
        return cached

    global _last_request
    async with _lock:
        wait = NOMINATIM_RATE_LIMIT - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request = time.monotonic()

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    NOMINATIM_URL,
                    params={"q": address, "format": "json", "limit": 1},
                    headers={"User-Agent": NOMINATIM_USER_AGENT},
                )
                data = resp.json()
                if data:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    cache_coords(address, lat, lng)
                    return lat, lng
                log.debug("No geocode result for '%s'", address)
        except Exception as e:
            log.warning("Geocode failed for '%s': %s", address, e)

    return None


async def reverse_geocode(lat: float, lng: float) -> dict | None:
    """Reverse-geocode (lat, lng) to {city, state, country, display_name} via Nominatim."""
    global _last_request
    async with _lock:
        wait = NOMINATIM_RATE_LIMIT - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request = time.monotonic()

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    NOMINATIM_REVERSE_URL,
                    params={"lat": lat, "lon": lng, "format": "json", "zoom": 10},
                    headers={"User-Agent": NOMINATIM_USER_AGENT},
                )
                data = resp.json()
                addr = data.get("address", {})
                return {
                    "city": addr.get("city") or addr.get("town") or addr.get("municipality") or addr.get("village"),
                    "state": addr.get("state"),
                    "country": addr.get("country"),
                    "display_name": data.get("display_name", ""),
                }
        except Exception as e:
            log.warning("Reverse geocode failed for (%s, %s): %s", lat, lng, e)

    return None
