import { Listing, SearchFilters, SearchResult, ListingDetail, SourceStatus, RenterProfile, OutreachItem, AuthUser } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("auth_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = authHeaders(
    init?.body ? { "Content-Type": "application/json" } : undefined,
  );
  const resp = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
  if (resp.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/")) {
    clearAuth();
    window.location.href = "/";
  }
  return resp;
}

export interface SearchCallbacks {
  onInit: (detectedLocation: string, availableSources: string[]) => void;
  onListings: (listings: Listing[], source: string) => void;
  onUnmappedListings?: (listings: Listing[], source: string) => void;
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

  let done = false;
  ws.onmessage = (evt) => {
    let msg: any;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === "init") {
      callbacks.onInit(msg.detected_location, msg.available_sources);
    } else if (msg.type === "listings") {
      callbacks.onListings(msg.listings, msg.source);
    } else if (msg.type === "unmapped_listings") {
      callbacks.onUnmappedListings?.(msg.listings, msg.source);
    } else if (msg.type === "source_status") {
      callbacks.onSourceStatus(msg.source, { status: msg.status, count: msg.count, cached: msg.cached });
    } else if (msg.type === "done") {
      done = true;
      callbacks.onDone(msg.stats);
    } else if (msg.type === "error") {
      done = true;
      callbacks.onError(msg.message);
    }
  };

  ws.onerror = () => { if (!done) { done = true; callbacks.onError("WebSocket connection failed"); } };
  ws.onclose = (e) => {
    // Modal's WS proxy sends broken close frames (code 1006/1015) on container idle — ignore if data already came through
    if (!done && e.code !== 1006 && e.code !== 1015) callbacks.onError("Connection closed unexpectedly");
  };

  return () => ws.close();
}

export async function parseFilters(prompt: string): Promise<{ filters: Partial<SearchFilters>; summary: string }> {
  const resp = await authFetch(`${API_BASE}/api/parse-filters`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw new Error(`Parse error: ${resp.status}`);
  return resp.json();
}

export async function fetchListingDetail(url: string): Promise<ListingDetail> {
  const params = new URLSearchParams({ url });
  const resp = await authFetch(`${API_BASE}/api/listing/detail?${params}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

// ── Renter Profile ──────────────────────────────────────────────

export async function upsertRenterProfile(profile: Partial<RenterProfile> & { phone: string }): Promise<RenterProfile> {
  const resp = await authFetch(`${API_BASE}/api/renter/profile`, {
    method: "POST",
    body: JSON.stringify(profile),
  });
  if (!resp.ok) throw new Error(`Profile error: ${resp.status}`);
  const data = await resp.json();
  return data.profile;
}

export async function getRenterProfile(phone: string): Promise<RenterProfile | null> {
  const resp = await authFetch(`${API_BASE}/api/renter/profile/${encodeURIComponent(phone)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Profile error: ${resp.status}`);
  return resp.json();
}

// ── Outreach ────────────────────────────────────────────────────

export interface StartOutreachParams {
  renter_phone: string;
  listings: { listing_id: string; listing: Record<string, any>; landlord_phone?: string | null }[];
  channel: "call" | "text";
  custom_message?: string;
}

export async function startOutreach(params: StartOutreachParams): Promise<OutreachItem[]> {
  const resp = await authFetch(`${API_BASE}/api/outreach/start`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Outreach error: ${resp.status}`);
  const data = await resp.json();
  return data.outreach;
}

export async function getOutreachDashboard(phone: string): Promise<{ count: number; outreach: OutreachItem[] }> {
  const resp = await authFetch(`${API_BASE}/api/outreach/dashboard/${encodeURIComponent(phone)}`);
  if (!resp.ok) throw new Error(`Dashboard error: ${resp.status}`);
  return resp.json();
}

export async function getOutreachDetail(outreachId: string): Promise<OutreachItem & { events: any[] }> {
  const resp = await authFetch(`${API_BASE}/api/outreach/${encodeURIComponent(outreachId)}`);
  if (!resp.ok) throw new Error(`Outreach error: ${resp.status}`);
  return resp.json();
}

export async function sendOutreachSMS(outreachId: string, message: string): Promise<void> {
  const resp = await authFetch(`${API_BASE}/api/outreach/${encodeURIComponent(outreachId)}/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `Send SMS error: ${resp.status}`);
  }
}

// ── Auth ────────────────────────────────────────────────────────

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}

export function setAuthToken(token: string) {
  localStorage.setItem("auth_token", token);
}

export function clearAuth() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  localStorage.removeItem("renter_profile");
}

export async function sendOTP(phone: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `Error: ${resp.status}`);
  }
}

export async function verifyOTP(phone: string, code: string): Promise<{ token: string; user: AuthUser }> {
  const resp = await fetch(`${API_BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `Error: ${resp.status}`);
  }
  return resp.json();
}

export async function getMe(): Promise<{ user_id: string; phone: string; name: string | null; profile: RenterProfile | null }> {
  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");
  const resp = await authFetch(`${API_BASE}/api/auth/me`);
  if (!resp.ok) throw new Error(`Auth error: ${resp.status}`);
  return resp.json();
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
  } catch { /* ignore */ }
  clearAuth();
}
