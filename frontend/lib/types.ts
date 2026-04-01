export interface Listing {
  id: string;
  source: string;
  title: string;
  address: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  price_min: number;
  price_max: number;
  bedrooms: number;
  bathrooms: number;
  furnished: boolean;
  available_from: string | null;
  available_to: string | null;
  no_fee: boolean;
  url: string;
  photo_url: string | null;
  photos: string[];
  listing_type: "room" | "apartment" | "house";
  description: string | null;
  sqft: number | null;
  lease_term: string | null;
  deposit: string | null;
  amenities: string[];
}

export interface ListingDetail {
  photos: string[];
  description: string | null;
  lease_term: string | null;
  deposit: string | null;
  amenities: string[];
  sqft: number | null;
  phone_numbers: string[];
  error?: string;
}

export interface SearchFilters {
  checkIn: string;
  checkOut: string;
  minPrice: number;
  maxPrice: number;
  bedrooms: number[];
  furnished: boolean;
  noFee: boolean;
  sources: string[];
}

export interface SearchResult {
  listings: Listing[];
  stats: {
    total_scraped: number;
    geocoded: number;
    in_polygon: number;
    returned: number;
    skipped_no_coords: number;
  };
  available_sources: string[];
  detected_location: string | null;
  city_id: string | null;
  message?: string;
}

export type SortOption = "price_asc" | "price_desc" | "bedrooms" | "source";

export const SOURCE_LABELS: Record<string, string> = {
  june_homes: "June Homes",
  alohause: "Alohause",
  blueground: "Blueground",
  furnished_finder: "Furnished Finder",
  leasebreak: "Leasebreak",
  renthop: "RentHop",
  zumper: "Zumper",
  craigslist: "Craigslist",
};

export const SOURCE_COLORS: Record<string, string> = {
  june_homes: "#6366f1",
  alohause: "#f59e0b",
  blueground: "#10b981",
  furnished_finder: "#ef4444",
  leasebreak: "#8b5cf6",
  renthop: "#3b82f6",
  zumper: "#14b8a6",
  craigslist: "#a855f7",
};
