"""City catalog — maps city IDs to scraper-specific slugs, map coordinates, and geocoder context."""

from __future__ import annotations

import re
import unicodedata

CITIES: dict[str, dict] = {
    # === US Cities ===
    "new-york": {
        "name": "New York, NY",
        "country": "USA",
        "center": [40.7549, -73.984],
        "zoom": 12,
        "geocode_suffix": ", New York, NY, USA",
        "slugs": {
            "june_homes": "new-york",
            "alohause": True,  # NYC-only, no slug needed
            "blueground": "new-york-usa",
            "furnished_finder": "us--ny--new-york",
            "leasebreak": True,  # NYC-only
            "renthop": "new-york-ny",
        },
    },
    "san-francisco": {
        "name": "San Francisco, CA",
        "country": "USA",
        "center": [37.7749, -122.4194],
        "zoom": 13,
        "geocode_suffix": ", San Francisco, CA, USA",
        "slugs": {
            "june_homes": "san-francisco",
            "blueground": "san-francisco-bay-area-usa",
            "furnished_finder": "us--ca--san-francisco",
            "renthop": "san-francisco-ca",
        },
    },
    "san-diego": {
        "name": "San Diego, CA",
        "country": "USA",
        "center": [32.7157, -117.1611],
        "zoom": 12,
        "geocode_suffix": ", San Diego, CA, USA",
        "slugs": {
            "blueground": "san-diego-usa",
            "furnished_finder": "us--ca--san-diego",
        },
    },
    "los-angeles": {
        "name": "Los Angeles, CA",
        "country": "USA",
        "center": [34.0522, -118.2437],
        "zoom": 11,
        "geocode_suffix": ", Los Angeles, CA, USA",
        "slugs": {
            "june_homes": "los-angeles",
            "blueground": "los-angeles-usa",
            "furnished_finder": "us--ca--los-angeles",
            "renthop": "los-angeles-ca",
        },
    },
    "chicago": {
        "name": "Chicago, IL",
        "country": "USA",
        "center": [41.8781, -87.6298],
        "zoom": 12,
        "geocode_suffix": ", Chicago, IL, USA",
        "slugs": {
            "june_homes": "chicago",
            "blueground": "chicago-usa",
            "furnished_finder": "us--il--chicago",
            "renthop": "chicago-il",
        },
    },
    "washington-dc": {
        "name": "Washington, DC",
        "country": "USA",
        "center": [38.9072, -77.0369],
        "zoom": 13,
        "geocode_suffix": ", Washington, DC, USA",
        "slugs": {
            "june_homes": "washington-dc",
            "blueground": "washington-dc-usa",
            "furnished_finder": "us--dc--washington",
            "renthop": "washington-dc",
        },
    },
    "boston": {
        "name": "Boston, MA",
        "country": "USA",
        "center": [42.3601, -71.0589],
        "zoom": 13,
        "geocode_suffix": ", Boston, MA, USA",
        "slugs": {
            "june_homes": "boston",
            "blueground": "boston-usa",
            "furnished_finder": "us--ma--boston",
            "renthop": "boston-ma",
        },
    },
    "miami": {
        "name": "Miami, FL",
        "country": "USA",
        "center": [25.7617, -80.1918],
        "zoom": 12,
        "geocode_suffix": ", Miami, FL, USA",
        "slugs": {
            "june_homes": "miami",
            "blueground": "miami-fl",
            "furnished_finder": "us--fl--miami",
            "renthop": "miami-fl",
        },
    },
    "austin": {
        "name": "Austin, TX",
        "country": "USA",
        "center": [30.2672, -97.7431],
        "zoom": 12,
        "geocode_suffix": ", Austin, TX, USA",
        "slugs": {
            "june_homes": "austin",
            "blueground": "austin-tx",
            "furnished_finder": "us--tx--austin",
        },
    },
    "seattle": {
        "name": "Seattle, WA",
        "country": "USA",
        "center": [47.6062, -122.3321],
        "zoom": 12,
        "geocode_suffix": ", Seattle, WA, USA",
        "slugs": {
            "june_homes": "seattle",
            "blueground": "seattle-usa",
            "furnished_finder": "us--wa--seattle",
        },
    },
    "denver": {
        "name": "Denver, CO",
        "country": "USA",
        "center": [39.7392, -104.9903],
        "zoom": 12,
        "geocode_suffix": ", Denver, CO, USA",
        "slugs": {
            "blueground": "denver-usa",
            "furnished_finder": "us--co--denver",
        },
    },
    "philadelphia": {
        "name": "Philadelphia, PA",
        "country": "USA",
        "center": [39.9526, -75.1652],
        "zoom": 12,
        "geocode_suffix": ", Philadelphia, PA, USA",
        "slugs": {
            "june_homes": "philadelphia",
            "furnished_finder": "us--pa--philadelphia",
            "renthop": "philadelphia-pa",
        },
    },
    "nashville": {
        "name": "Nashville, TN",
        "country": "USA",
        "center": [36.1627, -86.7816],
        "zoom": 12,
        "geocode_suffix": ", Nashville, TN, USA",
        "slugs": {
            "blueground": "nashville-tn",
            "furnished_finder": "us--tn--nashville",
        },
    },
    "atlanta": {
        "name": "Atlanta, GA",
        "country": "USA",
        "center": [33.749, -84.388],
        "zoom": 12,
        "geocode_suffix": ", Atlanta, GA, USA",
        "slugs": {
            "furnished_finder": "us--ga--atlanta",
        },
    },
    "dallas": {
        "name": "Dallas, TX",
        "country": "USA",
        "center": [32.7767, -96.797],
        "zoom": 11,
        "geocode_suffix": ", Dallas, TX, USA",
        "slugs": {
            "blueground": "dallas-tx",
            "furnished_finder": "us--tx--dallas",
        },
    },
    "houston": {
        "name": "Houston, TX",
        "country": "USA",
        "center": [29.7604, -95.3698],
        "zoom": 11,
        "geocode_suffix": ", Houston, TX, USA",
        "slugs": {
            "furnished_finder": "us--tx--houston",
        },
    },
    # === International (Blueground cities) ===
    "toronto": {
        "name": "Toronto, Canada",
        "country": "Canada",
        "center": [43.6532, -79.3832],
        "zoom": 12,
        "geocode_suffix": ", Toronto, ON, Canada",
        "slugs": {
            "blueground": "toronto-canada",
        },
    },
    "mexico-city": {
        "name": "Mexico City, Mexico",
        "country": "Mexico",
        "center": [19.4326, -99.1332],
        "zoom": 12,
        "geocode_suffix": ", Mexico City, Mexico",
        "slugs": {
            "blueground": "mexico-city",
        },
    },
    "sao-paulo": {
        "name": "São Paulo, Brazil",
        "country": "Brazil",
        "center": [-23.5505, -46.6333],
        "zoom": 12,
        "geocode_suffix": ", São Paulo, Brazil",
        "slugs": {
            "blueground": "sao-paulo",
        },
    },
    "rio-de-janeiro": {
        "name": "Rio de Janeiro, Brazil",
        "country": "Brazil",
        "center": [-22.9068, -43.1729],
        "zoom": 12,
        "geocode_suffix": ", Rio de Janeiro, Brazil",
        "slugs": {
            "blueground": "rio-de-janeiro",
        },
    },
    "athens": {
        "name": "Athens, Greece",
        "country": "Greece",
        "center": [37.9838, 23.7275],
        "zoom": 13,
        "geocode_suffix": ", Athens, Greece",
        "slugs": {
            "blueground": "athens-greece",
        },
    },
    "barcelona": {
        "name": "Barcelona, Spain",
        "country": "Spain",
        "center": [41.3874, 2.1686],
        "zoom": 13,
        "geocode_suffix": ", Barcelona, Spain",
        "slugs": {
            "blueground": "barcelona-es",
        },
    },
    "istanbul": {
        "name": "Istanbul, Turkey",
        "country": "Turkey",
        "center": [41.0082, 28.9784],
        "zoom": 12,
        "geocode_suffix": ", Istanbul, Turkey",
        "slugs": {
            "blueground": "istanbul-turkey",
        },
    },
    "dubai": {
        "name": "Dubai, UAE",
        "country": "UAE",
        "center": [25.2048, 55.2708],
        "zoom": 12,
        "geocode_suffix": ", Dubai, UAE",
        "slugs": {
            "blueground": "dubai-uae",
        },
    },
    "vienna": {
        "name": "Vienna, Austria",
        "country": "Austria",
        "center": [48.2082, 16.3738],
        "zoom": 13,
        "geocode_suffix": ", Vienna, Austria",
        "slugs": {
            "blueground": "vienna-austria",
        },
    },
}


def _normalize(s: str) -> str:
    """Lowercase, strip accents, remove punctuation."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9 ]", "", s.lower())
    return s.strip()


# Pre-build lookup: (normalized_city_name, city_id)
_CITY_NAMES: list[tuple[str, str]] = []
for _cid, _city in CITIES.items():
    _city_part = _city["name"].split(",")[0].strip()
    _CITY_NAMES.append((_normalize(_city_part), _cid))


def match_city(location: dict) -> tuple[str, dict] | None:
    """Given a reverse-geocoded location dict {city, state, country, display_name},
    find the best matching city_id in our catalog.
    Returns (city_id, city_data) or None."""
    rev_city = _normalize(location.get("city") or "")

    # Pass 1: exact match
    for norm_name, cid in _CITY_NAMES:
        if rev_city and rev_city == norm_name:
            return cid, CITIES[cid]

    # Pass 2: containment (handles "New York City" matching "new york")
    for norm_name, cid in _CITY_NAMES:
        if rev_city and (rev_city in norm_name or norm_name in rev_city):
            return cid, CITIES[cid]

    # Pass 3: check display_name
    norm_display = _normalize(location.get("display_name", ""))
    for norm_name, cid in _CITY_NAMES:
        if len(norm_name) > 3 and norm_name in norm_display:
            return cid, CITIES[cid]

    return None


def get_city(city_id: str) -> dict | None:
    return CITIES.get(city_id)


def get_available_sources(city_id: str) -> list[str]:
    city = CITIES.get(city_id)
    if not city:
        return []
    return list(city.get("slugs", {}).keys())


def get_all_cities() -> list[dict]:
    result = []
    for cid, city in CITIES.items():
        result.append({
            "id": cid,
            "name": city["name"],
            "country": city["country"],
            "center": city["center"],
            "zoom": city["zoom"],
            "sources": list(city.get("slugs", {}).keys()),
        })
    return result
