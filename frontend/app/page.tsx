"use client";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import FiltersBar from "@/components/FiltersBar";
import ListingCard from "@/components/ListingCard";
import ListingDetail from "@/components/ListingDetail";
import { Listing, SearchFilters, SortOption } from "@/lib/types";
import { searchListings } from "@/lib/api";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const DEFAULT_FILTERS: SearchFilters = {
  checkIn: "2026-06-01",
  checkOut: "2026-08-31",
  minPrice: 0,
  maxPrice: 50000,
  bedrooms: [0, 1, 2, 3],
  furnished: false,
  noFee: false,
  sources: [],  // empty = all available for detected city
};

function sortListings(listings: Listing[], sort: SortOption): Listing[] {
  const sorted = [...listings];
  switch (sort) {
    case "price_asc":  return sorted.sort((a, b) => a.price_min - b.price_min);
    case "price_desc": return sorted.sort((a, b) => b.price_min - a.price_min);
    case "bedrooms":   return sorted.sort((a, b) => a.bedrooms - b.bedrooms);
    case "source":     return sorted.sort((a, b) => a.source.localeCompare(b.source));
    default: return sorted;
  }
}

export default function Home() {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [polygon, setPolygon] = useState<[number, number][] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [showEmptyState, setShowEmptyState] = useState(true);
  const searchRef = useRef<AbortController | null>(null);

  // Auto-detected from search response
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [noSourcesMessage, setNoSourcesMessage] = useState<string | null>(null);

  // Map defaults — center of US, or browser geolocation
  const [mapCenter, setMapCenter] = useState<[number, number]>([39.83, -98.58]);
  const [mapZoom, setMapZoom] = useState(4);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setMapCenter([pos.coords.latitude, pos.coords.longitude]);
        setMapZoom(12);
      },
      () => {} // silently fail
    );
  }, []);

  const doSearch = useCallback(async (poly: [number, number][], f: SearchFilters) => {
    if (searchRef.current) searchRef.current.abort();
    const controller = new AbortController();
    searchRef.current = controller;
    setLoading(true);
    setError(null);
    setNoSourcesMessage(null);
    try {
      const result = await searchListings(poly, f);
      if (controller.signal.aborted) return;
      setListings(result.listings);
      setStats(result.stats);
      setDetectedLocation(result.detected_location);
      setAvailableSources(result.available_sources);
      if (result.message) {
        setNoSourcesMessage(result.message);
      }
      // Populate sources on first search for this area
      if (result.available_sources.length > 0 && f.sources.length === 0) {
        setFilters(prev => ({ ...prev, sources: result.available_sources }));
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const handlePolygonChange = useCallback((poly: [number, number][] | null) => {
    setPolygon(poly);
    if (poly) doSearch(poly, filters);
    else {
      setListings([]); setStats(null);
      setDetectedLocation(null); setAvailableSources([]);
      setNoSourcesMessage(null);
    }
  }, [doSearch, filters]);

  const handleSearch = useCallback(() => {
    if (polygon) doSearch(polygon, filters);
  }, [polygon, filters, doSearch]);

  const sorted = useMemo(() => sortListings(listings, sort), [listings, sort]);
  const sourceCounts = useMemo(() => listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.source] = (acc[l.source] || 0) + 1;
    return acc;
  }, {}), [listings]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-0">
      <FiltersBar
        filters={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        hasPolygon={!!polygon}
        loading={loading}
        availableSources={availableSources}
        detectedLocation={detectedLocation}
        noSourcesMessage={noSourcesMessage}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <Map
            listings={listings}
            selectedId={selectedId}
            center={mapCenter}
            zoom={mapZoom}
            onPolygonChange={handlePolygonChange}
            onSelectListing={(id) => setSelectedId(prev => prev === id ? null : id)}
            onDrawStart={() => setShowEmptyState(false)}
          />

          {loading && (
            <div className="absolute inset-0 bg-surface-0/80 backdrop-blur-sm flex items-center justify-center z-[1000] pointer-events-none">
              <div className="bg-surface-2 border border-border rounded-2xl px-8 py-6 flex flex-col items-center shadow-card-hover">
                <div className="relative w-10 h-10 mb-3">
                  <div className="absolute inset-0 rounded-full border-[3px] border-surface-4" />
                  <div className="absolute inset-0 rounded-full border-[3px] border-ramp-lime border-t-transparent animate-spin" />
                </div>
                <p className="text-sm font-semibold text-text-primary">
                  {detectedLocation ? `Searching ${detectedLocation}...` : "Detecting location..."}
                </p>
                <p className="text-xs text-text-muted mt-1">Live scraping — takes ~15s</p>
              </div>
            </div>
          )}

          {noSourcesMessage && !loading && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999]">
              <div className="bg-surface-2 border border-amber-500/30 rounded-2xl px-10 py-8 text-center max-w-sm shadow-card-hover">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-text-primary text-base mb-1">No sources available</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{noSourcesMessage}</p>
              </div>
            </div>
          )}

          {stats && !loading && !noSourcesMessage && (
            <div className="absolute bottom-4 left-4 bg-surface-1/90 backdrop-blur border border-border rounded-xl px-4 py-2 flex items-center gap-3 text-xs z-[999]">
              {detectedLocation && (
                <>
                  <span className="text-ramp-lime font-semibold">{detectedLocation}</span>
                  <span className="w-px h-3 bg-border" />
                </>
              )}
              <span className="text-text-secondary"><span className="font-semibold text-text-primary">{stats.total_scraped}</span> scraped</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary"><span className="font-semibold text-ramp-lime">{stats.returned}</span> in area</span>
            </div>
          )}

          {showEmptyState && !polygon && !loading && listings.length === 0 && !noSourcesMessage && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999]">
              <div className="bg-surface-2 border border-border rounded-2xl px-10 py-8 text-center max-w-sm shadow-card-hover relative">
                <button
                  onClick={() => setShowEmptyState(false)}
                  className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-surface-3 hover:bg-surface-4 text-text-muted hover:text-text-primary flex items-center justify-center transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="w-12 h-12 rounded-full bg-ramp-lime/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-ramp-lime" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-text-primary text-base mb-1">Search anywhere</h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Zoom into any city and draw an area to find housing.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="w-[420px] shrink-0 flex flex-col bg-surface-1 border-l border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary tracking-tight">
                {listings.length > 0 ? (
                  <>{listings.length} <span className="text-text-muted font-normal">listings</span></>
                ) : "Results"}
              </h2>
              {Object.keys(sourceCounts).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(sourceCounts).map(([s, n]) => (
                    <span key={s} className="text-[10px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">
                      {n} {s.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {listings.length > 1 && (
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="text-xs bg-surface-2 border border-border text-text-secondary rounded-lg px-2 py-1 cursor-pointer"
              >
                <option value="price_asc">Price ↑</option>
                <option value="price_desc">Price ↓</option>
                <option value="bedrooms">Beds</option>
                <option value="source">Source</option>
              </select>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {listings.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <p className="text-sm text-text-muted">
                  {polygon ? (noSourcesMessage || "No listings in this area") : "Draw an area to search"}
                </p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {sorted.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    selected={listing.id === selectedId}
                    onClick={() => setSelectedId(prev => prev === listing.id ? null : listing.id)}
                    onOpenDetail={() => { setDetailListing(listing); setSelectedId(listing.id); }}
                  />
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-xs text-red-400">{error}</div>
          )}
        </div>
      </div>

      {detailListing && (
        <ListingDetail listing={detailListing} onClose={() => setDetailListing(null)} />
      )}
    </div>
  );
}
