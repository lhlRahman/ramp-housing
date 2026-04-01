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
    """Forward-geocode an address to (lat, lng). Cached in SQLite."""
    cached = get_cached_coords(address)
    if cached:
        return cached

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
                return None
            data = resp.json()
            features = data.get("features", [])
            if features:
                coords = features[0]["geometry"]["coordinates"]  # [lng, lat]
                lat, lng = coords[1], coords[0]
                cache_coords(address, lat, lng)
                return lat, lng
            log.debug("No geocode result for '%s'", address)
    except Exception as e:
        log.warning("Geocode failed for '%s': %s", address, e)

    return None


async def reverse_geocode(lat: float, lng: float) -> dict | None:
    """Reverse-geocode (lat, lng) to {city, state, country_code, display_name}.
    Searches through multiple Photon results to find one with a city field,
    since the nearest result may be a POI (restaurant, shop) without city data."""
    await _throttle()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                PHOTON_REVERSE,
                params={"lat": lat, "lon": lng},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
            if resp.status_code != 200:
                log.warning("Photon reverse returned %d", resp.status_code)
                return None
            data = resp.json()
            features = data.get("features", [])

            # Search through results for one with a city field
            for feature in features:
                props = feature.get("properties", {})
                city = props.get("city") or props.get("town") or props.get("municipality") or props.get("village")
                if city:
                    return {
                        "city": city,
                        "state": props.get("state"),
                        "country": props.get("country"),
                        "country_code": (props.get("countrycode") or "").lower(),
                        "display_name": props.get("name", ""),
                    }

            # Fallback: use first result even without city (state/country may still work)
            if features:
                props = features[0].get("properties", {})
                return {
                    "city": props.get("district") or props.get("county") or props.get("name"),
                    "state": props.get("state"),
                    "country": props.get("country"),
                    "country_code": (props.get("countrycode") or "").lower(),
                    "display_name": props.get("name", ""),
                }
    except Exception as e:
        log.warning("Reverse geocode failed for (%s, %s): %s", lat, lng, e)

    return None
