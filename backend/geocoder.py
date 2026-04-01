import asyncio
import logging
import time

import httpx

from config import NOMINATIM_USER_AGENT
from db import get_cached_coords, cache_coords

log = logging.getLogger(__name__)

PHOTON_API = "https://photon.komoot.io/api"
PHOTON_REVERSE = "https://photon.komoot.io/reverse"

_last_request = 0.0
_lock = asyncio.Lock()
_MIN_INTERVAL = 0.2  # Photon is more lenient, but be polite


async def _throttle():
    """Ensure minimum interval between requests."""
    global _last_request
    async with _lock:
        wait = _MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request = time.monotonic()


async def geocode(address: str) -> tuple[float, float] | None:
    """Forward-geocode an address to (lat, lng). Cached in SQLite.
    Failures are also cached so they are never retried."""
    cached = get_cached_coords(address)
    if cached is not None:
        lat, lng = cached
        return (lat, lng) if lat is not None else None  # None,None = cached failure

    await _throttle()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                PHOTON_API,
                params={"q": address, "limit": 1},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
            if resp.status_code != 200:
                log.debug("Photon returned %d for '%s'", resp.status_code, address)
                cache_coords(address, None, None)  # Cache failure — don't retry
                return None
            data = resp.json()
            features = data.get("features", [])
            if features:
                coords = features[0]["geometry"]["coordinates"]  # [lng, lat]
                lat, lng = coords[1], coords[0]
                cache_coords(address, lat, lng)
                return lat, lng
            log.debug("No geocode result for '%s'", address)
            cache_coords(address, None, None)  # Cache failure — don't retry
    except Exception as e:
        log.warning("Geocode failed for '%s': %s", address, e)
        # Don't cache network/timeout errors — they may be transient

    return None


async def reverse_geocode(lat: float, lng: float) -> dict | None:
    """Reverse-geocode (lat, lng) to {city, state, country_code, display_name}.
    Uses Nominatim with zoom=10 (city level) to reliably get city names
    instead of nearby POIs like restaurants."""
    await _throttle()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 10},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
            if resp.status_code != 200:
                log.warning("Nominatim reverse returned %d", resp.status_code)
                return None
            data = resp.json()
            addr = data.get("address", {})
            return {
                "city": addr.get("city") or addr.get("town") or addr.get("municipality") or addr.get("village") or addr.get("county"),
                "state": addr.get("state"),
                "country": addr.get("country"),
                "country_code": (addr.get("country_code") or "").lower(),
                "display_name": data.get("display_name", ""),
            }
    except Exception as e:
        log.warning("Reverse geocode failed for (%s, %s): %s", lat, lng, e)

    return None
