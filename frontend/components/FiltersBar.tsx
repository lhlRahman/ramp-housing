"use client";
import { SearchFilters, SOURCE_LABELS, SOURCE_COLORS } from "@/lib/types";
import { useState } from "react";

interface Props {
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  onSearch: () => void;
  hasPolygon: boolean;
  loading: boolean;
  availableSources: string[];
  detectedLocation: string | null;
  noSourcesMessage: string | null;
}

export default function FiltersBar({ filters, onChange, onSearch, hasPolygon, loading, availableSources, detectedLocation, noSourcesMessage }: Props) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const [showSources, setShowSources] = useState(false);

  const toggleBed = (b: number) => {
    const next = filters.bedrooms.includes(b)
      ? filters.bedrooms.filter((x) => x !== b)
      : [...filters.bedrooms, b].sort();
    if (next.length > 0) set({ bedrooms: next });
  };

  const toggleSource = (s: string) => {
    const next = filters.sources.includes(s)
      ? filters.sources.filter((x) => x !== s)
      : [...filters.sources, s];
    if (next.length > 0) set({ sources: next });
  };

  return (
    <div className="shrink-0 bg-surface-1 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 mr-1">
          <div className="w-7 h-7 rounded-lg bg-ramp-lime flex items-center justify-center">
            <span className="text-surface-0 text-xs font-bold">R</span>
          </div>
          <span className="text-sm font-semibold text-text-primary tracking-tight whitespace-nowrap">Housing</span>
        </div>

        <span className="w-px h-7 bg-border" />

        {/* Detected location badge */}
        {detectedLocation ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border">
            <svg className="w-3.5 h-3.5 text-ramp-lime" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="text-xs font-medium text-text-primary">{detectedLocation}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-muted">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="text-xs">Draw area to detect</span>
          </div>
        )}

        <span className="w-px h-7 bg-border" />

        {/* Dates */}
        <div className="flex items-center gap-1.5">
          <span className="filter-label mr-1">Dates</span>
          <input type="date" value={filters.checkIn} onChange={(e) => set({ checkIn: e.target.value })} className="input-dark !py-1.5 !px-2 !text-xs !w-[120px]" />
          <span className="text-text-muted text-xs">→</span>
          <input type="date" value={filters.checkOut} onChange={(e) => set({ checkOut: e.target.value })} className="input-dark !py-1.5 !px-2 !text-xs !w-[120px]" />
        </div>

        <span className="w-px h-7 bg-border" />

        {/* Price */}
        <div className="flex items-center gap-1.5">
          <span className="filter-label mr-1">Price</span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
            <input type="number" value={filters.minPrice || ""} onChange={(e) => set({ minPrice: Number(e.target.value) || 0 })} placeholder="0" className="input-dark !py-1.5 !pl-5 !pr-2 !text-xs !w-[80px]" />
          </div>
          <span className="text-text-muted text-xs">–</span>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
            <input type="number" value={filters.maxPrice === 50000 ? "" : filters.maxPrice} onChange={(e) => set({ maxPrice: Number(e.target.value) || 50000 })} placeholder="Any" className="input-dark !py-1.5 !pl-5 !pr-2 !text-xs !w-[80px]" />
          </div>
        </div>

        <span className="w-px h-7 bg-border" />

        {/* Bedrooms */}
        <div className="flex items-center gap-1.5">
          <span className="filter-label mr-1">Beds</span>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3].map((b) => {
              const active = filters.bedrooms.includes(b);
              return (
                <button key={b} onClick={() => toggleBed(b)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${active ? "bg-surface-4 text-text-primary" : "text-text-muted hover:text-text-secondary hover:bg-surface-2"}`}>
                  {b === 0 ? "S" : `${b}`}
                </button>
              );
            })}
          </div>
        </div>

        <span className="w-px h-7 bg-border" />

        {/* Toggles */}
        <div className="flex items-center gap-1">
          <button onClick={() => set({ furnished: !filters.furnished })} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${filters.furnished ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "text-text-muted hover:text-text-secondary border border-transparent"}`}>Furnished</button>
          <button onClick={() => set({ noFee: !filters.noFee })} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${filters.noFee ? "bg-blue-500/15 text-blue-400 border border-blue-500/30" : "text-text-muted hover:text-text-secondary border border-transparent"}`}>No Fee</button>
        </div>

        {/* Sources dropdown — only show after first search detects available sources */}
        {availableSources.length > 0 && (
          <>
            <span className="w-px h-7 bg-border" />
            <div className="relative">
              <button onClick={() => setShowSources(!showSources)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-2 transition-all">
                <span className="filter-label">Sources</span>
                <span className="text-text-primary font-semibold">{filters.sources.length}/{availableSources.length}</span>
                <svg className={`w-3 h-3 transition-transform ${showSources ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showSources && (
                <>
                  <div className="fixed inset-0 z-[100]" onClick={() => setShowSources(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-surface-2 border border-border rounded-xl shadow-card-hover p-2 z-[101] w-48">
                    <div className="flex items-center justify-between px-2 py-1 mb-1">
                      <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Sources</span>
                      <button onClick={() => set({ sources: filters.sources.length === availableSources.length ? [availableSources[0]] : [...availableSources] })} className="text-[10px] text-ramp-lime hover:text-ramp-lime-hover font-medium">
                        {filters.sources.length === availableSources.length ? "Clear" : "All"}
                      </button>
                    </div>
                    {availableSources.map((s) => {
                      const active = filters.sources.includes(s);
                      return (
                        <button key={s} onClick={() => toggleSource(s)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${active ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
                          <span className={`w-2 h-2 rounded-full transition-opacity ${active ? "opacity-100" : "opacity-30"}`} style={{ backgroundColor: SOURCE_COLORS[s] || "#6b7280" }} />
                          <span className="font-medium">{SOURCE_LABELS[s] || s}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        <button onClick={onSearch} disabled={!hasPolygon || loading} className="btn-ramp flex items-center gap-2 !py-1.5 !px-5 !text-xs">
          {loading ? (
            <><div className="w-3 h-3 rounded-full border-[1.5px] border-surface-0/30 border-t-surface-0 animate-spin" />Searching...</>
          ) : (
            hasPolygon ? "Re-search" : "Draw area first"
          )}
        </button>
      </div>
    </div>
  );
}
