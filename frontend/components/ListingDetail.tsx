"use client";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Listing, ListingDetail as DetailType, RenterProfile, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";
import { fetchListingDetail, startOutreach } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  listing: Listing;
  renterProfile: RenterProfile | null;
  onClose: () => void;
  onNeedProfile: (listing: Listing) => void;
  onOutreachStarted: () => void;
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 30 } },
  exit: { opacity: 0, scale: 0.97, y: 10, transition: { duration: 0.15 } },
};

export default function ListingDetail({ listing, renterProfile, onClose, onNeedProfile, onOutreachStarted }: Props) {
  const [detail, setDetail] = useState<DetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [selectedLandlordPhone, setSelectedLandlordPhone] = useState<string | null>(null);

  const [showContactForm, setShowContactForm] = useState(false);
  const [channel, setChannel] = useState<"call" | "text">("call");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [outreachError, setOutreachError] = useState("");
  const [outreachSuccess, setOutreachSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setPhotoIdx(0);
    fetchListingDetail(listing.url)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listing.url]);

  const allPhotos = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...(listing.photos || []), listing.photo_url || "", ...(detail?.photos || [])]) {
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out;
  }, [listing.photos, listing.photo_url, detail?.photos]);

  const allAmenities = useMemo(
    () => [...new Set([...(listing.amenities || []), ...(detail?.amenities || [])])],
    [listing.amenities, detail?.amenities],
  );

  const contactNumbers = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ raw: string; normalized: string }> = [];
    for (const raw of detail?.phone_numbers || []) {
      const digits = raw.replace(/\D/g, "");
      if (!digits) continue;
      const normalizedDigits = digits.length === 10 ? `1${digits}` : digits;
      if (!/^\d{11,15}$/.test(normalizedDigits)) continue;
      const normalized = `+${normalizedDigits}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
    return out;
  }, [detail?.phone_numbers]);

  const color = SOURCE_COLORS[listing.source] || "#6b7280";
  const priceStr =
    listing.price_min === listing.price_max
      ? `$${listing.price_min.toLocaleString()}`
      : `$${listing.price_min.toLocaleString()}\u2013${listing.price_max.toLocaleString()}`;

  useEffect(() => {
    setSelectedLandlordPhone((prev) => {
      if (prev && contactNumbers.some((phone) => phone.normalized === prev)) return prev;
      return contactNumbers[0]?.normalized || null;
    });
  }, [contactNumbers]);

  const hasPhone = !!selectedLandlordPhone;

  const handleContact = (selectedChannel: "call" | "text") => {
    if (!renterProfile) { onNeedProfile(listing); return; }
    setChannel(selectedChannel);
    setShowContactForm(true);
  };

  const handleSendOutreach = async () => {
    if (!renterProfile) return;
    if (!selectedLandlordPhone) { setOutreachError("No landlord phone number available"); return; }
    setSending(true);
    setOutreachError("");
    try {
      await startOutreach({
        renter_phone: renterProfile.phone,
        listings: [{
          listing_id: listing.id,
          listing: {
            title: listing.title, address: listing.address, price_min: listing.price_min,
            price_max: listing.price_max, bedrooms: listing.bedrooms, bathrooms: listing.bathrooms,
            source: listing.source, url: listing.url, neighborhood: listing.neighborhood,
            description: listing.description || detail?.description || "",
          },
          landlord_phone: selectedLandlordPhone,
        }],
        channel,
        custom_message: message || undefined,
      });
      setOutreachSuccess(true);
      setShowContactForm(false);
      toast.success("Agent dispatched!", { description: `AI agent will ${channel} the landlord now` });
    } catch (err: any) {
      setOutreachError(err.message || "Failed to start outreach");
      toast.error("Outreach failed", { description: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[2001] flex items-center justify-center p-4 md:p-6 pointer-events-none">
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="bg-surface-1 rounded-2xl shadow-2xl border border-border-light w-full max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto"
        >
          {/* Close */}
          <motion.button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full glass text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.button>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col lg:flex-row">
              {/* Photos */}
              <div className="lg:w-[55%] shrink-0">
                {allPhotos.length > 0 ? (
                  <div className="relative bg-surface-0 aspect-[4/3] overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.img
                        key={photoIdx}
                        src={allPhotos[photoIdx]}
                        alt=""
                        className="w-full h-full object-cover"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
                      />
                    </AnimatePresence>
                    {allPhotos.length > 1 && (
                      <>
                        <button onClick={() => setPhotoIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full glass text-text-primary hover:bg-surface-0/90 flex items-center justify-center transition-colors text-lg">&lsaquo;</button>
                        <button onClick={() => setPhotoIdx((i) => (i + 1) % allPhotos.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full glass text-text-primary hover:bg-surface-0/90 flex items-center justify-center transition-colors text-lg">&rsaquo;</button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 glass text-text-primary text-xs font-medium px-3 py-1 rounded-full">{photoIdx + 1} / {allPhotos.length}</div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="aspect-[4/3] bg-surface-2 flex items-center justify-center">
                    <svg className="w-12 h-12 text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                )}

                {allPhotos.length > 1 && (
                  <div className="flex gap-1.5 p-3 overflow-x-auto bg-surface-0/50">
                    {allPhotos.slice(0, 12).map((url, i) => (
                      <motion.button
                        key={url}
                        onClick={() => setPhotoIdx(i)}
                        className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${i === photoIdx ? "ring-2 ring-ramp-lime ring-offset-2 ring-offset-surface-1" : "opacity-40 hover:opacity-100"}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </motion.button>
                    ))}
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="lg:w-[45%] p-6 space-y-5 overflow-y-auto">
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge-dark text-white" style={{ backgroundColor: color }}>{SOURCE_LABELS[listing.source]}</span>
                    <span className="text-[11px] text-text-muted capitalize">{listing.listing_type}</span>
                  </div>
                  <h2 className="text-xl font-bold text-text-primary leading-tight tracking-tight">{listing.title}</h2>
                  <p className="text-sm text-text-secondary mt-1">{listing.address || listing.neighborhood}</p>
                </motion.div>

                <motion.div
                  className="grid grid-cols-3 gap-2"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  {[
                    { label: "Price", value: priceStr, sub: "per month", accent: true },
                    { label: "Bedrooms", value: listing.bedrooms === 0 ? "Studio" : String(listing.bedrooms), sub: `${listing.bathrooms} bath` },
                    { label: "Size", value: listing.sqft || detail?.sqft || "\u2014", sub: "sq ft" },
                  ].map((item) => (
                    <div key={item.label} className="bg-surface-2 border border-border rounded-xl p-3 text-center">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">{item.label}</p>
                      <p className={`text-lg font-bold tracking-tight ${item.accent ? "text-ramp-lime" : "text-text-primary"}`}>{item.value}</p>
                      <p className="text-[10px] text-text-muted">{item.sub}</p>
                    </div>
                  ))}
                </motion.div>

                <div className="flex flex-wrap gap-1.5">
                  {listing.furnished && <span className="badge-dark bg-emerald-500/20 text-emerald-400">Furnished</span>}
                  {listing.no_fee && <span className="badge-dark bg-blue-500/20 text-blue-400">No Broker Fee</span>}
                </div>

                {/* Lease details */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-surface-2 border-b border-border">
                    <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider">Lease Details</h3>
                  </div>
                  {[
                    ["Available from", listing.available_from],
                    ["Available to", listing.available_to],
                    ["Lease term", listing.lease_term || detail?.lease_term || (loading ? "Loading..." : null)],
                    ["Deposit", listing.deposit || detail?.deposit || (loading ? "Loading..." : null)],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label as string} className="px-4 py-2 flex justify-between border-b border-border last:border-0">
                      <span className="text-xs text-text-secondary">{label}</span>
                      <span className="text-xs font-medium text-text-primary max-w-[200px] text-right">{value}</span>
                    </div>
                  ))}
                  {!listing.available_from && !listing.available_to && !listing.lease_term && !detail?.lease_term && !loading && (
                    <div className="px-4 py-3 text-xs text-text-muted">No lease details available</div>
                  )}
                </div>

                {(() => {
                  const desc = listing.description || detail?.description || "";
                  const junk = /Photos?\d|Tours?\d|View all|Check availability|Use two fingers|scroll to zoom|Street view|Directions\n/i;
                  return desc && desc.length > 30 && !junk.test(desc) ? (
                    <div>
                      <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider mb-2">About</h3>
                      <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line line-clamp-[8]">{desc}</p>
                    </div>
                  ) : null;
                })()}

                {allAmenities.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider mb-2">Amenities</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {allAmenities.map((a) => (
                        <span key={a} className="text-[11px] bg-surface-3 text-text-secondary px-2.5 py-1 rounded-md font-medium">{a}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contact phones */}
                {contactNumbers.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider mb-2">Contact</h3>
                    <div className="space-y-1.5">
                      {contactNumbers.map((phone) => {
                        const active = phone.normalized === selectedLandlordPhone;
                        return (
                          <label key={phone.normalized} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all ${active ? "border-ramp-lime/50 bg-ramp-lime-dim" : "border-border bg-surface-2 hover:border-border-hover"}`}>
                            <input type="radio" name="landlord-phone" checked={active} onChange={() => setSelectedLandlordPhone(phone.normalized)} className="accent-lime-400" />
                            <span className="flex-1 text-sm text-text-primary">{phone.raw}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-surface-4 border-t-ramp-lime animate-spin" />
                    Fetching details from source...
                  </div>
                )}

                {/* Contact form */}
                <AnimatePresence>
                  {showContactForm && !outreachSuccess && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-xl border border-ramp-lime/20 bg-ramp-lime/[0.04] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-text-primary">Send AI Agent</h3>
                        <p className="text-xs text-text-secondary">
                          The agent will {channel === "call" ? "call" : "text"} the landlord on your behalf
                        </p>
                        <div className="flex gap-2">
                          {(["call", "text"] as const).map((ch) => (
                            <motion.button
                              key={ch}
                              onClick={() => setChannel(ch)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${channel === ch ? "border-ramp-lime bg-surface-0 text-ramp-lime" : "border-border bg-surface-2 text-text-secondary hover:border-border-hover"}`}
                              whileTap={{ scale: 0.97 }}
                            >
                              {ch === "call" ? "Call" : "Text"}
                            </motion.button>
                          ))}
                        </div>
                        <textarea
                          value={message}
                          onChange={e => setMessage(e.target.value)}
                          placeholder="Ask if it's available, allows pets, what utilities are included..."
                          rows={2}
                          maxLength={2000}
                          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ramp-lime/50 focus:ring-1 focus:ring-ramp-lime/20 resize-none transition-all"
                        />
                        {outreachError && <p className="text-xs text-red-400">{outreachError}</p>}
                        <div className="flex gap-2">
                          <button onClick={() => setShowContactForm(false)} className="flex-1 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors rounded-lg">Cancel</button>
                          <motion.button
                            onClick={handleSendOutreach}
                            disabled={sending}
                            className="flex-1 btn-ramp py-2 text-xs disabled:opacity-50"
                            whileTap={{ scale: 0.97 }}
                          >
                            {sending ? "Sending..." : `Send Agent (${channel})`}
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Success */}
                <AnimatePresence>
                  {outreachSuccess && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2"
                    >
                      <p className="text-sm font-semibold text-emerald-400">Agent dispatched!</p>
                      <p className="text-xs text-text-secondary">The AI agent is contacting the landlord. Check your dashboard for updates.</p>
                      <motion.button
                        onClick={() => { onClose(); onOutreachStarted(); }}
                        className="btn-ramp text-xs px-4 py-1.5 mt-1"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        View Dashboard
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* CTA */}
                <div className="flex gap-2">
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="btn-ramp flex-1 text-center block">
                    View on {SOURCE_LABELS[listing.source]} &#8599;
                  </a>
                  {!showContactForm && !outreachSuccess && hasPhone && (
                    <>
                      <motion.button
                        onClick={() => handleContact("call")}
                        className="btn-ramp !bg-surface-3 !text-text-primary hover:!bg-surface-4 px-4 flex items-center gap-1.5"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                        Agent Call
                      </motion.button>
                      <motion.button
                        onClick={() => handleContact("text")}
                        className="btn-ramp !bg-surface-3 !text-text-primary hover:!bg-surface-4 px-4 flex items-center gap-1.5"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                        </svg>
                        Agent Text
                      </motion.button>
                    </>
                  )}
                  {!showContactForm && !outreachSuccess && !hasPhone && !loading && (
                    <span className="text-xs text-text-muted py-2">No contact number found</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
