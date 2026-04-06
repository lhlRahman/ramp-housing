"use client";
import { SearchFilters, SOURCE_LABELS, SOURCE_COLORS } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}

export default function FiltersBar({
  filters, onChange, onSourcesChange, onSearch, onPromptSearch,
  prompt, onPromptChange,
  hasPolygon, loading, availableSources, detectedLocation, parsedSummary,
  theme = "light", onToggleTheme,
}: Props) {
  const [showSources, setShowSources] = useState(false);
  const sourcesMenuRef = useRef<HTMLDivElement | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (!showSources) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!sourcesMenuRef.current?.contains(event.target as Node)) setShowSources(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showSources]);

  const handleSubmit = async () => {
    if (!hasPolygon) return;
    if (prompt.trim()) await onPromptSearch();
    else onSearch();
  };

  const toggleSource = (s: string) => {
    const next = filters.sources.includes(s) ? filters.sources.filter((x) => x !== s) : [...filters.sources, s];
    if (next.length > 0) onSourcesChange(next);
  };

  return (
    <div className="shrink-0 bg-surface-1/80 backdrop-blur-xl border-b border-border px-4 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <motion.img
            src="/logo.svg"
            alt="RampHousing"
            className="w-7 h-7 rounded-lg"
            whileHover={{ scale: 1.1, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
          />
          <span className="text-sm font-semibold text-text-primary tracking-tight">Housing</span>
        </div>

        <span className="w-px h-7 bg-border shrink-0" />

        {/* Location badge */}
        <AnimatePresence mode="wait">
          {detectedLocation ? (
            <motion.div
              key="location"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ramp-lime/[0.06] border border-ramp-lime/20 shrink-0"
            >
              <svg className="w-3.5 h-3.5 text-ramp-lime shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              <span className="text-xs font-medium text-ramp-lime">{detectedLocation}</span>
            </motion.div>
          ) : (
            <motion.div
              key="no-location"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 px-2 py-1.5 text-text-muted shrink-0"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              <span className="text-xs whitespace-nowrap">Draw area to detect</span>
            </motion.div>
          )}
        </AnimatePresence>

        <span className="w-px h-7 bg-border shrink-0" />

        {/* Search input */}
        <div className="flex-1 relative">
          <motion.div
            animate={{
              borderColor: inputFocused ? "rgba(235, 241, 35, 0.3)" : "transparent",
              boxShadow: inputFocused ? "0 0 0 2px rgba(235, 241, 35, 0.06)" : "0 0 0 0px transparent",
            }}
            transition={{ duration: 0.15 }}
            className="rounded-lg"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={`Describe what you're looking for \u2014 e.g. "furnished 1BR under $3k"`}
              className="w-full bg-surface-2 border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors"
            />
          </motion.div>
          <motion.svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            animate={{ color: inputFocused ? "#C8D400" : "#9CA3AF" }}
            transition={{ duration: 0.15 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </motion.svg>
        </div>

        {/* Sources */}
        {availableSources.length > 0 && (
          <div ref={sourcesMenuRef} className="relative shrink-0">
            <motion.button
              onClick={() => setShowSources(!showSources)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-2 transition-all"
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-text-muted">Sources</span>
              <span className="text-text-primary font-semibold">{filters.sources.length}/{availableSources.length}</span>
              <motion.svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                animate={{ rotate: showSources ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </motion.svg>
            </motion.button>

            <AnimatePresence>
              {showSources && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-full right-0 mt-1 glass-strong rounded-xl shadow-card-hover p-2 z-[101] w-48"
                >
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Sources</span>
                    <button
                      onClick={() => onSourcesChange(filters.sources.length === availableSources.length ? [availableSources[0]] : [...availableSources])}
                      className="text-[10px] text-ramp-lime hover:text-ramp-lime-hover font-medium"
                    >
                      {filters.sources.length === availableSources.length ? "Clear" : "All"}
                    </button>
                  </div>
                  {availableSources.map((s, i) => {
                    const active = filters.sources.includes(s);
                    return (
                      <motion.button
                        key={s}
                        onClick={() => toggleSource(s)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${active ? "text-text-primary" : "text-text-muted hover:text-text-secondary"}`}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                      >
                        <motion.span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: SOURCE_COLORS[s] || "#6b7280" }}
                          animate={{ opacity: active ? 1 : 0.3, scale: active ? 1 : 0.8 }}
                          transition={{ duration: 0.15 }}
                        />
                        <span className="font-medium">{SOURCE_LABELS[s] || s}</span>
                        {active && (
                          <motion.svg
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="w-3 h-3 ml-auto text-ramp-lime"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </motion.svg>
                        )}
                      </motion.button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Search button */}
        <motion.button
          onClick={handleSubmit}
          disabled={!hasPolygon || loading}
          className="btn-ramp flex items-center gap-2 !py-1.5 !px-5 !text-xs shrink-0"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {loading ? (
            <>
              <motion.div
                className="w-3 h-3 rounded-full border-[1.5px] border-surface-0/30 border-t-surface-0"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              />
              Searching...
            </>
          ) : hasPolygon ? "Update" : "Draw area first"}
        </motion.button>

        {/* Theme toggle */}
        {onToggleTheme && (
          <motion.button
            onClick={onToggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors shrink-0"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.93 }}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? (
              /* Moon icon */
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
              </svg>
            ) : (
              /* Sun icon */
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <circle cx="12" cy="12" r="4" />
                <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            )}
          </motion.button>
        )}
      </div>
    </div>
  );
}
