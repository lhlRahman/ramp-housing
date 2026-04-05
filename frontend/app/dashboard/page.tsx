"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { OutreachItem, OUTREACH_STATUS_LABELS, OUTREACH_STATUS_COLORS, SOURCE_LABELS } from "@/lib/types";
import { getOutreachDashboard, getAuthToken, getMe } from "@/lib/api";

interface OutreachEvent {
  event_id: number;
  outreach_id: string;
  event_type: string;
  detail: string | null;
  created_at: number;
}

interface OutreachWithEvents extends OutreachItem {
  events?: OutreachEvent[];
}

function parseEventDetail(detail: string | null): any {
  if (!detail) return null;
  try { return JSON.parse(detail); } catch { return null; }
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function DashboardPage() {
  const router = useRouter();
  const [items, setItems] = useState<OutreachWithEvents[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renterPhone, setRenterPhone] = useState<string | null>(null);
  const [profileHydrated, setProfileHydrated] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      router.replace("/");
      return;
    }
    getMe().then((data) => {
      setRenterPhone(data.phone);
      setProfileHydrated(true);
      setLoading(false);
    }).catch(() => {
      router.replace("/");
    });
  }, [router]);

  const refresh = useCallback(async () => {
    if (!renterPhone) return;
    setLoading(true);
    try {
      const data = await getOutreachDashboard(renterPhone);
      setItems(data.outreach);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [renterPhone]);

  useEffect(() => {
    if (!renterPhone) return;
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh, renterPhone]);

  const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  const getCallResult = (item: OutreachWithEvents) => {
    if (!item.events) return null;
    const endEvent = item.events.find(e => e.event_type === "call_ended");
    if (!endEvent) return null;
    return parseEventDetail(endEvent.detail);
  };

  if (profileHydrated && !renterPhone) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-text-muted text-sm">No profile found. Set up your profile first.</p>
          <button onClick={() => router.push("/")} className="btn-ramp text-sm px-6 py-2">Go to Search</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-0">
      {/* Header */}
      <div className="border-b border-border bg-surface-1">
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Outreach Dashboard</h1>
            <p className="text-xs text-text-muted mt-0.5">{items.length} conversation{items.length !== 1 ? "s" : ""} tracked</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="w-9 h-9 rounded-full bg-surface-3 hover:bg-surface-4 text-text-muted hover:text-text-primary flex items-center justify-center transition-colors">
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
            <button onClick={() => router.push("/")} className="btn-ramp text-xs px-4 py-2 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to Search
            </button>
          </div>
        </div>
      </div>

      {/* Status pills */}
      {Object.keys(statusCounts).length > 0 && (
        <div className="max-w-[900px] mx-auto px-6 py-3 flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1.5 text-xs bg-surface-2 border border-border rounded-full px-3 py-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: OUTREACH_STATUS_COLORS[status] || "#6b7280" }} />
              <span className="text-text-secondary">{OUTREACH_STATUS_LABELS[status] || status}</span>
              <span className="font-semibold text-text-primary">{count}</span>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="max-w-[900px] mx-auto px-6 py-2">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-xs text-red-400">{error}</div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-[900px] mx-auto px-6 py-4">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 rounded-full border-2 border-surface-4 border-t-ramp-lime animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <p className="text-sm text-text-muted">No outreach yet. Open a listing and hit Agent Call or Agent Text to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const callResult = getCallResult(item);
              const isExpanded = expandedId === item.outreach_id;

              return (
                <div
                  key={item.outreach_id}
                  className="bg-surface-1 border border-border rounded-xl hover:border-surface-4 transition-colors cursor-pointer overflow-hidden"
                  onClick={() => setExpandedId(isExpanded ? null : item.outreach_id)}
                >
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: OUTREACH_STATUS_COLORS[item.status] || "#6b7280" }} />
                          <h3 className="text-sm font-semibold text-text-primary truncate">{item.listing?.title || "Unknown listing"}</h3>
                        </div>
                        <p className="text-xs text-text-muted truncate">{item.listing?.address || item.listing?.neighborhood || ""}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs">
                          <span className="text-text-secondary">{SOURCE_LABELS[item.listing?.source] || item.listing?.source}</span>
                          <span className="text-text-muted">-</span>
                          <span className="text-text-secondary">${(item.listing?.price_min || item.listing?.price || 0).toLocaleString()}/mo</span>
                          <span className="text-text-muted">-</span>
                          <span className="text-text-muted">{formatTime(item.created_at)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <span
                          className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: (OUTREACH_STATUS_COLORS[item.status] || "#6b7280") + "20",
                            color: OUTREACH_STATUS_COLORS[item.status] || "#6b7280",
                          }}
                        >
                          {OUTREACH_STATUS_LABELS[item.status] || item.status}
                        </span>
                        <p className="text-[10px] text-text-muted">{item.channel === "call" ? "Voice" : "SMS"}</p>
                        {callResult?.sentiment && (
                          <span className={`text-[10px] ${callResult.sentiment === "Positive" ? "text-emerald-400" : callResult.sentiment === "Negative" ? "text-red-400" : "text-text-muted"}`}>
                            {callResult.sentiment}
                          </span>
                        )}
                        <svg className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {item.summary && (
                      <p className="text-xs text-text-secondary mt-2 bg-surface-2 rounded-lg px-3 py-2">{item.summary}</p>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-4 space-y-3 border-t border-border pt-3">
                      {callResult && (
                        <div className="flex items-center gap-3 text-xs">
                          {callResult.duration_ms && (
                            <span className="text-text-muted">Duration: {Math.round(callResult.duration_ms / 1000)}s</span>
                          )}
                          {callResult.recording_url && (
                            <a href={callResult.recording_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-ramp-lime hover:text-ramp-lime-hover flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                              </svg>
                              Listen to recording
                            </a>
                          )}
                        </div>
                      )}

                      {callResult?.transcript && (
                        <div>
                          <h4 className="text-[10px] font-semibold text-text-primary uppercase tracking-wider mb-1.5">Transcript</h4>
                          <div className="bg-surface-2 border border-border rounded-lg px-3 py-2 max-h-[300px] overflow-y-auto">
                            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">{callResult.transcript}</pre>
                          </div>
                        </div>
                      )}

                      {item.scam_flags && (
                        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                          Scam flags: {item.scam_flags}
                        </p>
                      )}
                      {item.negotiation_result && (
                        <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                          Negotiation: {item.negotiation_result}
                        </p>
                      )}
                      {item.tour_time && (
                        <p className="text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                          Tour: {item.tour_time}
                        </p>
                      )}

                      {item.channel === "text" && item.events && item.events.some(e => ["contacted", "sms_reply", "sms_sent", "followup_sent"].includes(e.event_type)) && (
                        <div>
                          <h4 className="text-[10px] font-semibold text-text-primary uppercase tracking-wider mb-1.5">Messages</h4>
                          <div className="bg-surface-2 border border-border rounded-lg px-3 py-2 space-y-2 max-h-[300px] overflow-y-auto">
                            {item.events
                              .filter(e => ["contacted", "sms_reply", "sms_sent", "followup_sent"].includes(e.event_type))
                              .map(ev => {
                                const d = parseEventDetail(ev.detail);
                                const msgBody = d?.body || "";
                                const isUs = ev.event_type === "contacted" || ev.event_type === "sms_sent" || ev.event_type === "followup_sent";
                                return (
                                  <div key={ev.event_id} className={`flex ${isUs ? "justify-end" : "justify-start"}`}>
                                    <div className={`max-w-[80%] rounded-lg px-3 py-1.5 ${isUs ? "bg-ramp-lime/15 text-text-primary" : "bg-surface-3 text-text-primary"}`}>
                                      <p className="text-xs">{msgBody}</p>
                                      <p className="text-[9px] text-text-muted mt-0.5">{formatTime(ev.created_at)}</p>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {item.events && item.events.filter(e => !["call_ended", "contacted", "sms_reply", "sms_sent", "followup_sent", "analysis", "auto_reply_skipped", "auto_reply_capped", "sms_reply_ignored", "auto_ghosted"].includes(e.event_type)).length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-semibold text-text-primary uppercase tracking-wider mb-1.5">Timeline</h4>
                          <div className="space-y-1">
                            {item.events.filter(e => !["call_ended", "contacted", "sms_reply", "sms_sent", "followup_sent", "analysis", "auto_reply_skipped", "auto_reply_capped", "sms_reply_ignored", "auto_ghosted"].includes(e.event_type)).map(ev => (
                              <div key={ev.event_id} className="flex items-center gap-2 text-[10px]">
                                <span className="text-text-muted w-[100px] shrink-0">{formatTime(ev.created_at)}</span>
                                <span className="text-text-secondary">{ev.event_type}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
