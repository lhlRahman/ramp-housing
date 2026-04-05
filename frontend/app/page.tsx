"use client";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import FiltersBar from "@/components/FiltersBar";
import ListingCard from "@/components/ListingCard";
import ListingDetail from "@/components/ListingDetail";
import RenterProfileModal from "@/components/RenterProfileModal";
import { Listing, RenterProfile, SortOption, SOURCE_LABELS, SOURCE_COLORS } from "@/lib/types";
import { getRenterProfile } from "@/lib/api";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { usePromptFilters } from "@/hooks/usePromptFilters";
import { useHousingSearch } from "@/hooks/useHousingSearch";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

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
  const router = useRouter();
  const [polygon, setPolygon] = useState<[number, number][] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [sort, setSort] = useState<SortOption>("price_asc");
  const [showEmptyState, setShowEmptyState] = useState(true);

  // Renter profile
  const [renterProfile, setRenterProfile] = useState<RenterProfile | null>(null);
  const [profileHydrated, setProfileHydrated] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("renter_profile");
      setRenterProfile(stored ? JSON.parse(stored) : null);
    } catch {
      setRenterProfile(null);
    } finally {
      setProfileHydrated(true);
    }
  }, []);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // When user tries to contact without a profile, we store intent and show profile modal first
  const [pendingContactListing, setPendingContactListing] = useState<Listing | null>(null);

  const mapCenter: [number, number] = [40.7128, -74.006];
  const mapZoom = 12;

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(420);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX;
      setSidebarWidth(Math.min(700, Math.max(280, dragStartWidth.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  const {
    filters, setFilters, applyParsedFilters, setManualSources,
    detectedLocation, availableSources, noSourcesMessage,
    handleSearchInit, clearLocation,
  } = useSearchFilters();
  const { prompt, setPrompt, parsedSummary, parsing, parsePromptToFilters } = usePromptFilters();
  const { listings, loading, error, stats, sourceStatuses, runSearch, resetResults } = useHousingSearch();

  // Persist profile to localStorage
  useEffect(() => {
    if (!profileHydrated) return;
    if (renterProfile) {
      localStorage.setItem("renter_profile", JSON.stringify(renterProfile));
    } else {
      localStorage.removeItem("renter_profile");
    }
  }, [profileHydrated, renterProfile]);

  // Auto-load seeded test profile if none stored (dev only)
  useEffect(() => {
    if (!profileHydrated || renterProfile || process.env.NODE_ENV !== "development") return;
    getRenterProfile("16477732191").then(p => {
      if (p) setRenterProfile(p);
    }).catch(() => {});
  }, [profileHydrated, renterProfile]);

  // Escape key closes modals
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showProfileModal) setShowProfileModal(false);
        else if (detailListing) setDetailListing(null);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showProfileModal, detailListing]);

  const doSearch = useCallback((poly: [number, number][], resolvedFilters = filters) => {
    runSearch(poly, resolvedFilters, {
      onInit: (locationName, sources) => { handleSearchInit(locationName, sources); },
    });
  }, [filters, handleSearchInit, runSearch]);

  const handlePolygonChange = useCallback((poly: [number, number][] | null) => {
    setPolygon(poly);
    if (poly) { doSearch(poly, filters); }
    else { resetResults(); clearLocation(); }
  }, [clearLocation, doSearch, filters, resetResults]);

  const handleSearch = useCallback(() => {
    if (polygon) doSearch(polygon, filters);
  }, [polygon, filters, doSearch]);

  const handlePromptSearch = useCallback(async () => {
    const parsed = await parsePromptToFilters();
    const nextFilters = applyParsedFilters(parsed);
    if (polygon) doSearch(polygon, nextFilters);
  }, [applyParsedFilters, doSearch, parsePromptToFilters, polygon]);

  const sorted = useMemo(() => sortListings(listings, sort), [listings, sort]);
  const sourceCounts = useMemo(() => listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.source] = (acc[l.source] || 0) + 1;
    return acc;
  }, {}), [listings]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-0">
      <FiltersBar
        filters={filters} onChange={setFilters} onSourcesChange={setManualSources}
        onSearch={handleSearch} onPromptSearch={handlePromptSearch}
        prompt={prompt} onPromptChange={setPrompt} hasPolygon={!!polygon}
        loading={loading || parsing} availableSources={availableSources}
        detectedLocation={detectedLocation} noSourcesMessage={noSourcesMessage}
        parsedSummary={parsedSummary}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <Map
            listings={listings} selectedId={selectedId} center={mapCenter} zoom={mapZoom}
            loading={loading || parsing} onPolygonChange={handlePolygonChange}
            onSelectListing={(id) => setSelectedId(prev => prev === id ? null : id)}
            onOpenDetail={(id) => { const l = listings.find(l => l.id === id); if (l) setDetailListing(l); setSelectedId(id); }}
            onDrawStart={() => setShowEmptyState(false)}
          />

          {loading && Object.keys(sourceStatuses).length > 0 && (
            <div className="absolute top-3 right-3 z-[1000] pointer-events-none">
              <div className="bg-surface-2/95 backdrop-blur border border-border rounded-xl px-4 py-3 shadow-card-hover min-w-[200px]">
                <p className="text-xs font-semibold text-text-primary mb-2">
                  {detectedLocation ? `Scraping ${detectedLocation}` : "Detecting location..."}
                </p>
                <div className="space-y-1.5">
                  {Object.entries(sourceStatuses).map(([src, s]) => (
                    <div key={src} className="flex items-center gap-2 text-[11px]">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                        backgroundColor: s.status === "done" ? (s.count > 0 ? "#22c55e" : "#6b7280") : s.status === "error" ? "#ef4444" : SOURCE_COLORS[src] || "#6b7280",
                        animation: s.status === "scraping" ? "pulse 1.5s infinite" : "none",
                      }} />
                      <span className="text-text-secondary flex-1">{SOURCE_LABELS[src] || src}</span>
                      <span className={`font-mono tabular-nums ${s.status === "done" ? (s.count > 0 ? "text-ramp-lime" : "text-text-muted") : s.status === "error" ? "text-red-400" : "text-text-muted"}`}>
                        {s.status === "scraping" ? "..." : s.status === "error" ? "err" : s.cached ? `${s.count} (cached)` : String(s.count)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(loading || parsing) && Object.keys(sourceStatuses).length === 0 && (
            <div className="absolute inset-0 bg-surface-0/80 backdrop-blur-sm flex items-center justify-center z-[1000] pointer-events-none">
              <div className="bg-surface-2 border border-border rounded-2xl px-8 py-6 flex flex-col items-center shadow-card-hover">
                <div className="relative w-10 h-10 mb-3">
                  <div className="absolute inset-0 rounded-full border-[3px] border-surface-4" />
                  <div className="absolute inset-0 rounded-full border-[3px] border-ramp-lime border-t-transparent animate-spin" />
                </div>
                <p className="text-sm font-semibold text-text-primary">{parsing ? "Parsing filters..." : "Detecting location..."}</p>
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
              {detectedLocation && (<><span className="text-ramp-lime font-semibold">{detectedLocation}</span><span className="w-px h-3 bg-border" /></>)}
              <span className="text-text-secondary"><span className="font-semibold text-text-primary">{stats.total_scraped}</span> scraped</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary"><span className="font-semibold text-ramp-lime">{stats.returned}</span> in area</span>
            </div>
          )}

          {showEmptyState && !polygon && !loading && listings.length === 0 && !noSourcesMessage && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999] pointer-events-none">
              <div className="bg-surface-2 border border-border rounded-2xl px-10 py-8 text-center max-w-sm shadow-card-hover relative pointer-events-none">
                <button onClick={() => setShowEmptyState(false)} className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-surface-3 hover:bg-surface-4 text-text-muted hover:text-text-primary flex items-center justify-center transition-colors pointer-events-auto">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <div className="w-12 h-12 rounded-full bg-ramp-lime/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-ramp-lime" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold text-text-primary text-base mb-1">Search anywhere</h3>
                <p className="text-sm text-text-secondary leading-relaxed">Drag the map to move around, then draw an area to search.</p>
              </div>
            </div>
          )}
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDragStart}
          className="w-1 shrink-0 bg-border hover:bg-ramp-lime/60 cursor-col-resize transition-colors active:bg-ramp-lime"
        />

        <div className="shrink-0 flex flex-col bg-surface-1 border-l border-border overflow-hidden" style={{ width: sidebarWidth }}>
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary tracking-tight">
                {listings.length > 0 ? (<>{listings.length} <span className="text-text-muted font-normal">listings</span></>) : "Results"}
              </h2>
              {Object.keys(sourceCounts).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(sourceCounts).map(([s, n]) => (
                    <span key={s} className="text-[10px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">{n} {s.replace(/_/g, " ")}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowProfileModal(true)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${renterProfile ? "bg-ramp-lime/10 text-ramp-lime hover:bg-ramp-lime/20" : "bg-surface-3 text-text-muted hover:text-text-primary hover:bg-surface-4"}`}
                title={renterProfile ? `Profile: ${renterProfile.name || renterProfile.phone}` : "Set up profile"}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </button>
              {renterProfile && (
                <button onClick={() => router.push("/dashboard")} className="w-8 h-8 rounded-full bg-surface-3 text-text-muted hover:text-text-primary hover:bg-surface-4 flex items-center justify-center transition-colors" title="Outreach Dashboard">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                </button>
              )}
              {listings.length > 1 && (
                <select value={sort} onChange={(e) => setSort(e.target.value as SortOption)} className="text-xs bg-surface-2 border border-border text-text-secondary rounded-lg px-2 py-1 cursor-pointer">
                  <option value="price_asc">Price up</option>
                  <option value="price_desc">Price down</option>
                  <option value="bedrooms">Beds</option>
                  <option value="source">Source</option>
                </select>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listings.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <p className="text-sm text-text-muted">{polygon ? (noSourcesMessage || "No listings in this area") : "Draw an area to search"}</p>
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
        <ListingDetail
          listing={detailListing}
          renterProfile={renterProfile}
          onClose={() => setDetailListing(null)}
          onNeedProfile={(listing) => {
            setPendingContactListing(listing);
            setShowProfileModal(true);
          }}
          onOutreachStarted={() => router.push("/dashboard")}
        />
      )}

      {showProfileModal && (
        <RenterProfileModal
          existingProfile={renterProfile}
          onSaved={(profile) => {
            setRenterProfile(profile);
            setShowProfileModal(false);
            // If they had a pending contact, reopen the detail modal
            if (pendingContactListing) {
              setDetailListing(pendingContactListing);
              setPendingContactListing(null);
            }
          }}
          onClose={() => { setShowProfileModal(false); setPendingContactListing(null); }}
        />
      )}

    </div>
  );
}
