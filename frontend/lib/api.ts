import { SearchFilters, SearchResult, ListingDetail } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function searchListings(
  polygon: [number, number][],
  filters: SearchFilters,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    polygon: JSON.stringify(polygon),
    min_price: String(filters.minPrice),
    max_price: String(filters.maxPrice),
    bedrooms: filters.bedrooms.join(","),
    furnished: String(filters.furnished),
    no_fee: String(filters.noFee),
  });

  if (filters.sources.length > 0) params.set("sources", filters.sources.join(","));
  if (filters.checkIn) params.set("check_in", filters.checkIn);
  if (filters.checkOut) params.set("check_out", filters.checkOut);

  const resp = await fetch(`${API_BASE}/api/search?${params}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function fetchListingDetail(url: string): Promise<ListingDetail> {
  const params = new URLSearchParams({ url });
  const resp = await fetch(`${API_BASE}/api/listing/detail?${params}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}
