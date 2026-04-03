"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchListingsWS } from "@/lib/api";
import { Listing, SearchFilters, SearchResult, SourceStatus } from "@/lib/types";

interface RunSearchOptions {
  onInit?: (detectedLocation: string, availableSources: string[]) => void;
}

export function useHousingSearch() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SearchResult["stats"] | null>(null);
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({});
  const wsCloseRef = useRef<(() => void) | null>(null);

  const resetResults = useCallback(() => {
    setListings([]);
    setStats(null);
    setError(null);
    setSourceStatuses({});
    setLoading(false);
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
    setStats(null);
    setSourceStatuses({});

    wsCloseRef.current = searchListingsWS(polygon, filters, {
      onInit: (detectedLocation, availableSources) => {
        options.onInit?.(detectedLocation, availableSources);
      },
      onListings: (newListings) => {
        setListings((prev) => [...prev, ...newListings]);
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
    loading,
    error,
    stats,
    sourceStatuses,
    runSearch,
    resetResults,
    closeSearch,
  };
}
