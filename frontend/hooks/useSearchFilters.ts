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

export function useSearchFilters() {
  const [filters, setFiltersState] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [noSourcesMessage, setNoSourcesMessage] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceSelectionMode>("auto");
  const sourceModeRef = useRef<SourceSelectionMode>("auto");

  const updateSourceMode = useCallback((mode: SourceSelectionMode) => {
    sourceModeRef.current = mode;
    setSourceMode(mode);
  }, []);

  const setFilters = useCallback((next: SearchFilters) => {
    setFiltersState(next);
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
  }, [updateSourceMode]);

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
