"use client";

import { useCallback, useRef, useState } from "react";
import { SearchFilters } from "@/lib/types";
import {
  mergeParsedFilters,
  reconcileSourcesForLocation,
  SourceSelectionMode,
} from "@/lib/filter-reconcile";

const DEFAULT_FILTERS: SearchFilters = {
  checkIn: "2026-06-01",
  checkOut: "2026-08-31",
  minPrice: 0,
  maxPrice: 50000,
  bedrooms: [0, 1, 2, 3],
  furnished: false,
  noFee: false,
  sources: [],
};

function loadSession<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export function useSearchFilters() {
  const [filters, setFiltersState] = useState<SearchFilters>(() => loadSession("search_filters", DEFAULT_FILTERS));
  const [detectedLocation, setDetectedLocationState] = useState<string | null>(() => loadSession("search_location", null));
  const [availableSources, setAvailableSourcesState] = useState<string[]>(() => loadSession("search_sources", []));
  const [noSourcesMessage, setNoSourcesMessage] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceSelectionMode>("auto");
  const sourceModeRef = useRef<SourceSelectionMode>("auto");

  const updateSourceMode = useCallback((mode: SourceSelectionMode) => {
    sourceModeRef.current = mode;
    setSourceMode(mode);
  }, []);

  const setFilters = useCallback((next: SearchFilters) => {
    setFiltersState(next);
    try { sessionStorage.setItem("search_filters", JSON.stringify(next)); } catch {}
  }, []);

  const applyParsedFilters = useCallback((parsed: Partial<SearchFilters>) => {
    let resolved: SearchFilters = DEFAULT_FILTERS;
    setFiltersState((prev) => {
      resolved = mergeParsedFilters(prev, parsed);
      return resolved;
    });
    return resolved;
  }, []);

  const setManualSources = useCallback((sources: string[]) => {
    updateSourceMode("manual");
    setFiltersState((prev) => ({ ...prev, sources }));
  }, [updateSourceMode]);

  const setDetectedLocation = useCallback((loc: string | null) => {
    setDetectedLocationState(loc);
    try { if (loc) sessionStorage.setItem("search_location", JSON.stringify(loc)); else sessionStorage.removeItem("search_location"); } catch {}
  }, []);
  const setAvailableSources = useCallback((sources: string[]) => {
    setAvailableSourcesState(sources);
    try { sessionStorage.setItem("search_sources", JSON.stringify(sources)); } catch {}
  }, []);

  const handleSearchInit = useCallback((locationName: string, sources: string[]) => {
    setDetectedLocation(locationName);
    setAvailableSources(sources);
    setNoSourcesMessage(
      sources.length === 0 ? `No supported sources are available for ${locationName}.` : null,
    );

    let nextMode = sourceModeRef.current;
    setFiltersState((prev) => {
      const reconciled = reconcileSourcesForLocation(prev.sources, sources, sourceModeRef.current);
      nextMode = reconciled.mode;
      return { ...prev, sources: reconciled.sources };
    });
    updateSourceMode(nextMode);
  }, [updateSourceMode]);

  const clearLocation = useCallback(() => {
    setDetectedLocation(null);
    setAvailableSources([]);
    setNoSourcesMessage(null);
    updateSourceMode("auto");
    try { sessionStorage.removeItem("search_filters"); } catch {}
  }, [setDetectedLocation, setAvailableSources, updateSourceMode]);

  return {
    filters,
    setFilters,
    applyParsedFilters,
    setManualSources,
    detectedLocation,
    availableSources,
    noSourcesMessage,
    handleSearchInit,
    clearLocation,
  };
}
