"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchListingsWS } from "@/lib/api";
import { Listing, SearchFilters, SearchResult, SourceStatus } from "@/lib/types";

const CACHE_KEY = "search_cache";

interface SearchCache {
  listings: Listing[];
  unmappedListings: Listing[];
  stats: SearchResult["stats"] | null;
}

function loadCache(): SearchCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveCache(data: SearchCache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded, ignore */ }
}

interface RunSearchOptions {
  onInit?: (detectedLocation: string, availableSources: string[]) => void;
}

export function useHousingSearch() {
  const cached = useRef(loadCache());
  const [listings, setListings] = useState<Listing[]>(cached.current?.listings || []);
  const [unmappedListings, setUnmappedListings] = useState<Listing[]>(cached.current?.unmappedListings || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SearchResult["stats"] | null>(cached.current?.stats || null);
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({});
  const wsCloseRef = useRef<(() => void) | null>(null);

  // Persist search results when they change
  useEffect(() => {
    if (listings.length > 0 || unmappedListings.length > 0 || stats) {
      saveCache({ listings, unmappedListings, stats });
    }
  }, [listings, unmappedListings, stats]);

  const resetResults = useCallback(() => {
    setListings([]);
    setUnmappedListings([]);
    setStats(null);
    setError(null);
    setSourceStatuses({});
    setLoading(false);
    try { sessionStorage.removeItem(CACHE_KEY); } catch {}
  }, []);

  const closeSearch = useCallback(() => {
    if (wsCloseRef.current) {
      wsCloseRef.current();
      wsCloseRef.current = null;
    }
  }, []);

  const runSearch = useCallback((
    polygon: [number, number][],
    filters: SearchFilters,
    options: RunSearchOptions = {},
  ) => {
    closeSearch();
    setLoading(true);
    setError(null);
    setListings([]);
    setUnmappedListings([]);
    setStats(null);
    setSourceStatuses({});

    wsCloseRef.current = searchListingsWS(polygon, filters, {
      onInit: (detectedLocation, availableSources) => {
        options.onInit?.(detectedLocation, availableSources);
      },
      onListings: (newListings) => {
        setListings((prev) => [...prev, ...newListings]);
      },
      onUnmappedListings: (newListings) => {
        setUnmappedListings((prev) => [...prev, ...newListings]);
      },
      onSourceStatus: (source, status) => {
        setSourceStatuses((prev) => ({ ...prev, [source]: status }));
      },
      onDone: (nextStats) => {
        setStats(nextStats);
        setLoading(false);
      },
      onError: (message) => {
        setError(message);
        setLoading(false);
      },
    });
  }, [closeSearch]);

  useEffect(() => closeSearch, [closeSearch]);

  return {
    listings,
    unmappedListings,
    loading,
    error,
    stats,
    sourceStatuses,
    runSearch,
    resetResults,
    closeSearch,
  };
}
