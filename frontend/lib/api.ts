import { Listing, SearchFilters, SearchResult, ListingDetail, SourceStatus } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export interface SearchCallbacks {
  onInit: (detectedLocation: string, availableSources: string[]) => void;
  onListings: (listings: Listing[], source: string) => void;
  onSourceStatus: (source: string, status: SourceStatus) => void;
  onDone: (stats: SearchResult["stats"]) => void;
  onError: (message: string) => void;
}

export function searchListingsWS(
  polygon: [number, number][],
  filters: SearchFilters,
  callbacks: SearchCallbacks,
): () => void {
  const ws = new WebSocket(`${WS_BASE}/api/ws/search`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      polygon,
      min_price: filters.minPrice,
      max_price: filters.maxPrice,
      bedrooms: filters.bedrooms.join(","),
      furnished: filters.furnished,
      no_fee: filters.noFee,
      sources: filters.sources.join(","),
      check_in: filters.checkIn || undefined,
      check_out: filters.checkOut || undefined,
    }));
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "init") {
      callbacks.onInit(msg.detected_location, msg.available_sources);
    } else if (msg.type === "listings") {
      callbacks.onListings(msg.listings, msg.source);
    } else if (msg.type === "source_status") {
      callbacks.onSourceStatus(msg.source, { status: msg.status, count: msg.count, cached: msg.cached });
    } else if (msg.type === "done") {
      callbacks.onDone(msg.stats);
    } else if (msg.type === "error") {
      callbacks.onError(msg.message);
    }
  };

  ws.onerror = () => callbacks.onError("WebSocket connection failed");

  return () => ws.close();
}

export async function parseFilters(prompt: string): Promise<{ filters: Partial<SearchFilters>; summary: string }> {
  const resp = await fetch(`${API_BASE}/api/parse-filters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw new Error(`Parse error: ${resp.status}`);
  return resp.json();
}

export async function fetchListingDetail(url: string): Promise<ListingDetail> {
  const params = new URLSearchParams({ url });
  const resp = await fetch(`${API_BASE}/api/listing/detail?${params}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}
