from pydantic import BaseModel, Field
from typing import Literal, Optional


Source = Literal["june_homes", "alohause", "blueground", "furnished_finder", "leasebreak", "renthop"]
ListingType = Literal["room", "apartment", "house"]
ALL_SOURCES: list[str] = list(Source.__args__)  # type: ignore[attr-defined]


class Listing(BaseModel):
    id: str
    source: Source
    title: str
    address: str
    neighborhood: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    price_min: int = Field(ge=0, description="Monthly USD")
    price_max: int = Field(ge=0)
    bedrooms: int = Field(ge=0, description="0 = studio")
    bathrooms: float = Field(ge=0)
    furnished: bool
    available_from: Optional[str] = None
    available_to: Optional[str] = None
    no_fee: bool
    url: str
    photo_url: Optional[str] = None
    photos: list[str] = []
    listing_type: ListingType
    description: Optional[str] = None
    sqft: Optional[int] = Field(default=None, ge=0)
    lease_term: Optional[str] = None
    deposit: Optional[str] = None
    amenities: list[str] = []


class SearchParams(BaseModel):
    polygon: list[list[float]]
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    min_price: int = Field(default=0, ge=0)
    max_price: int = Field(default=20000, ge=0)
    bedrooms: list[int] = [0, 1, 2, 3]
    furnished: bool = False
    no_fee: bool = False
    sources: list[str] = ALL_SOURCES
