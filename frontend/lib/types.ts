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

export interface SourceStatus {
  status: "pending" | "scraping" | "done" | "error";
  count: number;
  cached: boolean;
}

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

// ── Renter Profile & Outreach ─────────────────────────────────

export interface RenterProfile {
  phone: string;
  name: string | null;
  current_city: string | null;
  move_in_date: string | null;
  budget_max: number | null;
  income_range: string | null;
  credit_score_range: string | null;
  pets: string | null;
  smoker: boolean;
  guarantor: boolean;
  dealbreakers: string | null;
  free_text_context: string | null;
}

export interface OutreachItem {
  outreach_id: string;
  renter_phone: string;
  listing_id: string;
  listing: Record<string, any>;
  landlord_phone: string | null;
  channel: string;
  custom_message: string | null;
  status: string;
  conversation_id: string | null;
  scam_flags: string | null;
  negotiation_result: string | null;
  tour_time: string | null;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

export const OUTREACH_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  contacted: "Contacted",
  responded: "Responded",
  touring: "Tour Scheduled",
  ghosted: "Ghosted",
  rejected: "Rejected",
  scam_flagged: "Scam Flagged",
  no_phone: "No Phone",
  error: "Error",
};

export const OUTREACH_STATUS_COLORS: Record<string, string> = {
  pending: "#6b7280",
  contacted: "#3b82f6",
  responded: "#10b981",
  touring: "#8b5cf6",
  ghosted: "#6b7280",
  rejected: "#ef4444",
  scam_flagged: "#f59e0b",
  no_phone: "#6b7280",
  error: "#ef4444",
};
