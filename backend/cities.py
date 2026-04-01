"""City/location resolution — dynamic slug generation for US cities + Blueground catalog overrides."""

from __future__ import annotations

import re
import unicodedata

# US state name → abbreviation mapping
US_STATES: dict[str, str] = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar",
    "california": "ca", "colorado": "co", "connecticut": "ct", "delaware": "de",
    "florida": "fl", "georgia": "ga", "hawaii": "hi", "idaho": "id",
    "illinois": "il", "indiana": "in", "iowa": "ia", "kansas": "ks",
    "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
    "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv",
    "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
    "north carolina": "nc", "north dakota": "nd", "ohio": "oh", "oklahoma": "ok",
    "oregon": "or", "pennsylvania": "pa", "rhode island": "ri", "south carolina": "sc",
    "south dakota": "sd", "tennessee": "tn", "texas": "tx", "utah": "ut",
    "vermont": "vt", "virginia": "va", "washington": "wa", "west virginia": "wv",
    "wisconsin": "wi", "wyoming": "wy", "district of columbia": "dc",
}

# Blueground slug overrides — their slugs are hand-curated and unpredictable
BLUEGROUND_SLUGS: dict[str, str] = {
    # Format: "city_lower:state_abbr" → blueground slug
    "new york:ny": "new-york-usa",
    "san francisco:ca": "san-francisco-bay-area-usa",
    "los angeles:ca": "los-angeles-usa",
    "chicago:il": "chicago-usa",
    "washington:dc": "washington-dc-usa",
    "boston:ma": "boston-usa",
    "miami:fl": "miami-fl",
    "austin:tx": "austin-tx",
    "seattle:wa": "seattle-usa",
    "denver:co": "denver-usa",
    "dallas:tx": "dallas-tx",
    "nashville:tn": "nashville-tn",
    "san diego:ca": "san-diego-usa",
    "portland:or": "portland-or",
}

# NYC-specific: these scrapers only work in New York
NYC_ONLY_SCRAPERS = {"alohause", "leasebreak"}

# Cities where we know the Nominatim "city" field is different from expected
CITY_ALIASES: dict[str, str] = {
    "new york city": "new york",
    "city of new york": "new york",
    "manhattan": "new york",
    "brooklyn": "new york",
    "queens": "new york",
    "bronx": "new york",
    "staten island": "new york",
}


def _slugify(name: str) -> str:
    """Convert city name to URL slug: lowercase, hyphenated, no special chars."""
    s = unicodedata.normalize("NFD", name)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]", "", s.lower())
    s = re.sub(r"\s+", "-", s.strip())
    return s


def _get_state_abbr(state_name: str) -> str | None:
    """Convert full state name to 2-letter abbreviation."""
    return US_STATES.get(state_name.lower().strip())


def resolve_location(location: dict) -> dict | None:
    """Given a Nominatim reverse-geocode result {city, state, country, country_code, display_name},
    resolve to scraper slugs, geocode suffix, and display name.

    Returns None if not in the US.
    Returns dict with: name, geocode_suffix, slugs, is_nyc
    """
    country_code = (location.get("country_code") or "").lower()
    if country_code != "us":
        return None

    raw_city = location.get("city") or location.get("town") or location.get("municipality") or location.get("village") or ""
    state_name = location.get("state") or ""

    if not raw_city:
        return None

    # Normalize city name via aliases
    city_lower = raw_city.lower().strip()
    city_lower = CITY_ALIASES.get(city_lower, city_lower)

    state_abbr = _get_state_abbr(state_name)
    if not state_abbr:
        return None

    city_slug = _slugify(city_lower)
    is_nyc = (city_lower == "new york" and state_abbr == "ny")

    # Build display name
    display_name = f"{raw_city}, {state_abbr.upper()}"
    geocode_suffix = f", {raw_city}, {state_abbr.upper()}, USA"

    # Build scraper slugs dynamically
    slugs: dict[str, str | bool] = {}

    # June Homes: simple city slug
    slugs["june_homes"] = city_slug

    # Furnished Finder: us--{state}--{city}
    slugs["furnished_finder"] = f"us--{state_abbr}--{city_slug}"

    # RentHop: {city}-{state} (special case: washington-dc not washington-dc-dc)
    if city_lower == "washington" and state_abbr == "dc":
        slugs["renthop"] = "washington-dc"
    else:
        slugs["renthop"] = f"{city_slug}-{state_abbr}"

    # Blueground: catalog lookup only
    bg_key = f"{city_lower}:{state_abbr}"
    if bg_key in BLUEGROUND_SLUGS:
        slugs["blueground"] = BLUEGROUND_SLUGS[bg_key]

    # NYC-only scrapers
    if is_nyc:
        slugs["alohause"] = True
        slugs["leasebreak"] = True

    return {
        "name": display_name,
        "geocode_suffix": geocode_suffix,
        "slugs": slugs,
        "is_nyc": is_nyc,
        "city": city_lower,
        "state": state_abbr,
    }


def get_all_cities() -> list[dict]:
    """Return the Blueground catalog cities for reference (optional endpoint)."""
    result = []
    for bg_key, bg_slug in BLUEGROUND_SLUGS.items():
        city, state = bg_key.split(":")
        result.append({
            "id": f"{_slugify(city)}-{state}",
            "name": f"{city.title()}, {state.upper()}",
            "blueground_slug": bg_slug,
        })
    return result
