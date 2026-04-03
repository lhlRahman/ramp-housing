import { SearchFilters } from "@/lib/types";

export type SourceSelectionMode = "auto" | "manual";

function intersectSources(selected: string[], available: string[]): string[] {
  return selected.filter((source) => available.includes(source));
}

export function reconcileSourcesForLocation(
  currentSources: string[],
  availableSources: string[],
  mode: SourceSelectionMode,
): { sources: string[]; mode: SourceSelectionMode } {
  if (availableSources.length === 0) {
    return { sources: [], mode: "auto" };
  }

  if (mode === "auto") {
    return { sources: [...availableSources], mode };
  }

  const validSources = intersectSources(currentSources, availableSources);
  if (validSources.length > 0) {
    return { sources: validSources, mode };
  }

  return { sources: [...availableSources], mode: "auto" };
}

export function mergeParsedFilters(
  filters: SearchFilters,
  parsed: Partial<SearchFilters>,
): SearchFilters {
  return {
    ...filters,
    ...parsed,
    sources: filters.sources,
  };
}
