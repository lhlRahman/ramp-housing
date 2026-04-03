"use client";

import { useCallback, useState } from "react";
import { parseFilters } from "@/lib/api";
import { SearchFilters } from "@/lib/types";

export function usePromptFilters() {
  const [prompt, setPrompt] = useState("");
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const parsePromptToFilters = useCallback(async (): Promise<Partial<SearchFilters>> => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setParsedSummary(null);
      return {};
    }

    setParsing(true);
    try {
      const { filters, summary } = await parseFilters(trimmed);
      setParsedSummary(summary || null);
      return filters;
    } finally {
      setParsing(false);
    }
  }, [prompt]);

  return {
    prompt,
    setPrompt,
    parsedSummary,
    parsing,
    parsePromptToFilters,
  };
}
