"use client";
import { SearchFilters, SOURCE_LABELS, SOURCE_COLORS } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

interface Props {
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  onSourcesChange: (sources: string[]) => void;
  onSearch: () => void;
  onPromptSearch: () => Promise<void>;
  prompt: string;
  onPromptChange: (p: string) => void;
  hasPolygon: boolean;
  loading: boolean;
  availableSources: string[];
  detectedLocation: string | null;
  noSourcesMessage: string | null;
  parsedSummary: string | null;
}

export default function FiltersBar({
  filters, onChange, onSourcesChange, onSearch, onPromptSearch,
  prompt, onPromptChange,
  hasPolygon, loading, availableSources, detectedLocation, parsedSummary,
}: Props) {
  const [showSources, setShowSources] = useState(false);
  const sourcesMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showSources) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!sourcesMenuRef.current?.contains(event.target as Node)) {
        setShowSources(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showSources]);

  const handleSubmit = async () => {
    if (!hasPolygon) return;
    if (prompt.trim()) {
      await onPromptSearch();
    } else {
      onSearch();
    }
  };

  const toggleSource = (s: string) => {
    const next = filters.sources.includes(s)
      ? filters.sources.filter((x) => x !== s)
      : [...filters.sources, s];
    if (next.length > 0) onSourcesChange(next);
  };

  const busy = loading;

  return (
    <div className="shrink-0 bg-surface-1 border-b border-border px-4 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-ramp-lime flex items-center justify-center">
            <span className="text-surface-0 text-xs font-bold">R</span>
          </div>
          <span className="text-sm font-semibold text-text-primary tracking-tight">Housing</span>
        </div>

        <span className="w-px h-7 bg-border shrink-0" />

        {/* Detected location badge */}
        {detectedLocation ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border shrink-0">
            <svg className="w-3.5 h-3.5 text-ramp-lime shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="text-xs font-medium text-text-primary">{detectedLocation}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-text-muted shrink-0">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <span className="text-xs whitespace-nowrap">Draw area to detect</span>
          </div>
        )}

        <span className="w-px h-7 bg-border shrink-0" />

        {/* Natural language input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={`Describe what you're looking for — e.g. "furnished 1BR under $3k, available June through August"`}
            className="w-full bg-surface-2 border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-ramp-lime/40 transition-colors"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>

        {/* Sources dropdown */}
        {availableSources.length > 0 && (
          <div ref={sourcesMenuRef} className="relative shrink-0">
            <button onClick={() => setShowSources(!showSources)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-2 transition-all">
              <span className="text-text-muted">Sources</span>
              <span className="text-text-primary font-semibold">{filters.sources.length}/{availableSources.length}</span>
              <svg className={`w-3 h-3 transition-transform ${showSources ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSources && (
              <div className="absolute top-full right-0 mt-1 bg-surface-2 border border-border rounded-xl shadow-card-hover p-2 z-[101] w-48">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Sources</span>
                  <button onClick={() => onSourcesChange(filters.sources.length === availableSources.length ? [availableSources[0]] : [...availableSources])} className="text-[10px] text-ramp-lime hover:text-ramp-lime-hover font-medium">
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
            )}
          </div>
        )}

        {/* Search button */}
        <button
          onClick={handleSubmit}
          disabled={!hasPolygon || busy}
          className="btn-ramp flex items-center gap-2 !py-1.5 !px-5 !text-xs shrink-0"
        >
          {busy ? (
            <><div className="w-3 h-3 rounded-full border-[1.5px] border-surface-0/30 border-t-surface-0 animate-spin" />Searching...</>
          ) : hasPolygon ? "Update" : "Draw area first"}
        </button>
      </div>

    </div>
  );
}
