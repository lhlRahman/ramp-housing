import hashlib
from shapely.geometry import Point, Polygon
from models import Listing


def make_id(source: str, url: str) -> str:
    return hashlib.md5(f"{source}:{url}".encode()).hexdigest()


def point_in_polygon(lat: float, lng: float, polygon: list[list[float]]) -> bool:
    """polygon is list of [lat, lng] pairs."""
    # Shapely uses (x=lng, y=lat)
    pt = Point(lng, lat)
    poly = Polygon([(p[1], p[0]) for p in polygon])
    return poly.contains(pt)


def deduplicate(listings: list[Listing]) -> list[Listing]:
    """Remove duplicates. Uses listing ID (hash of source+URL) as primary key,
    with a secondary cross-source dedup by address+price+bedrooms."""
    seen_ids: set[str] = set()
    seen_cross: set[str] = set()
    result: list[Listing] = []
    for listing in listings:
        # Same source+URL = exact dupe
        if listing.id in seen_ids:
            continue
        seen_ids.add(listing.id)

        # Cross-source: same address + price + bedrooms on different source
        cross_key = f"{listing.address.lower().strip()}:{listing.price_min}:{listing.bedrooms}"
        if cross_key in seen_cross:
            continue
        seen_cross.add(cross_key)

        result.append(listing)
    return result


def polygon_centroid(polygon: list[list[float]]) -> tuple[float, float]:
    """Compute centroid of polygon. polygon is list of [lat, lng] pairs. Returns (lat, lng)."""
    poly = Polygon([(p[1], p[0]) for p in polygon])
    centroid = poly.centroid
    return centroid.y, centroid.x


def bounding_box(polygon: list[list[float]]) -> tuple[float, float, float, float]:
    """Returns (min_lat, min_lng, max_lat, max_lng)."""
    lats = [p[0] for p in polygon]
    lngs = [p[1] for p in polygon]
    return min(lats), min(lngs), max(lats), max(lngs)
