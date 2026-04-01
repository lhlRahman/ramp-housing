"use client";
import { useState, useEffect } from "react";
import { Listing, ListingDetail as DetailType, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";
import { fetchListingDetail } from "@/lib/api";

interface Props {
  listing: Listing;
  onClose: () => void;
}

export default function ListingDetail({ listing, onClose }: Props) {
  const [detail, setDetail] = useState<DetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    setLoading(true);
    setPhotoIdx(0);
    fetchListingDetail(listing.url)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [listing.url]);

  const allPhotos = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...(listing.photos || []), listing.photo_url || "", ...(detail?.photos || [])]) {
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out;
  })();

  const allAmenities = [...new Set([...(listing.amenities || []), ...(detail?.amenities || [])])];
  const color = SOURCE_COLORS[listing.source] || "#6b7280";
  const priceStr =
    listing.price_min === listing.price_max
      ? `$${listing.price_min.toLocaleString()}`
      : `$${listing.price_min.toLocaleString()}–${listing.price_max.toLocaleString()}`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2000] animate-fade-in" onClick={onClose} />

      {/* Centered modal */}
      <div className="fixed inset-0 z-[2001] flex items-center justify-center p-6 pointer-events-none">
        <div className="bg-surface-1 rounded-2xl shadow-2xl border border-border w-full max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto animate-fade-in">

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-surface-0/70 backdrop-blur text-text-secondary hover:text-text-primary hover:bg-surface-0/90 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Scroll area */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col lg:flex-row">

              {/* Left: Photos */}
              <div className="lg:w-[55%] shrink-0">
                {allPhotos.length > 0 ? (
                  <div className="relative bg-surface-0 aspect-[4/3]">
                    <img
                      src={allPhotos[photoIdx]}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
                    />
                    {allPhotos.length > 1 && (
                      <>
                        <button
                          onClick={() => setPhotoIdx((i) => (i - 1 + allPhotos.length) % allPhotos.length)}
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-surface-0/70 backdrop-blur text-text-primary hover:bg-surface-0/90 flex items-center justify-center transition-colors text-lg"
                        >
                          ‹
                        </button>
                        <button
                          onClick={() => setPhotoIdx((i) => (i + 1) % allPhotos.length)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-surface-0/70 backdrop-blur text-text-primary hover:bg-surface-0/90 flex items-center justify-center transition-colors text-lg"
                        >
                          ›
                        </button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-surface-0/70 backdrop-blur text-text-primary text-xs font-medium px-3 py-1 rounded-full">
                          {photoIdx + 1} / {allPhotos.length}
                        </div>
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

                {/* Thumbnails */}
                {allPhotos.length > 1 && (
                  <div className="flex gap-1.5 p-3 overflow-x-auto bg-surface-0/50">
                    {allPhotos.slice(0, 12).map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setPhotoIdx(i)}
                        className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${
                          i === photoIdx
                            ? "ring-2 ring-ramp-lime ring-offset-2 ring-offset-surface-1"
                            : "opacity-40 hover:opacity-100"
                        }`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Details */}
              <div className="lg:w-[45%] p-6 space-y-5 overflow-y-auto">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge-dark text-white" style={{ backgroundColor: color }}>
                      {SOURCE_LABELS[listing.source]}
                    </span>
                    <span className="text-[11px] text-text-muted capitalize">{listing.listing_type}</span>
                  </div>
                  <h2 className="text-xl font-bold text-text-primary leading-tight tracking-tight">{listing.title}</h2>
                  <p className="text-sm text-text-secondary mt-1">{listing.address || listing.neighborhood}</p>
                </div>

                {/* Key stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-surface-2 border border-border rounded-xl p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">Price</p>
                    <p className="text-lg font-bold text-ramp-lime tracking-tight">{priceStr}</p>
                    <p className="text-[10px] text-text-muted">per month</p>
                  </div>
                  <div className="bg-surface-2 border border-border rounded-xl p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">Bedrooms</p>
                    <p className="text-lg font-bold text-text-primary">{listing.bedrooms === 0 ? "Studio" : listing.bedrooms}</p>
                    <p className="text-[10px] text-text-muted">{listing.bathrooms} bath</p>
                  </div>
                  <div className="bg-surface-2 border border-border rounded-xl p-3 text-center">
                    <p className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">Size</p>
                    <p className="text-lg font-bold text-text-primary">{listing.sqft || detail?.sqft || "—"}</p>
                    <p className="text-[10px] text-text-muted">sq ft</p>
                  </div>
                </div>

                {/* Tags */}
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
                  ]
                    .filter(([, v]) => v)
                    .map(([label, value]) => (
                      <div key={label as string} className="px-4 py-2 flex justify-between border-b border-border last:border-0">
                        <span className="text-xs text-text-secondary">{label}</span>
                        <span className="text-xs font-medium text-text-primary max-w-[200px] text-right">{value}</span>
                      </div>
                    ))}
                  {!listing.available_from && !listing.available_to && !listing.lease_term && !detail?.lease_term && !loading && (
                    <div className="px-4 py-3 text-xs text-text-muted">No lease details available</div>
                  )}
                </div>

                {/* Description */}
                {(listing.description || detail?.description) && (
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider mb-2">About</h3>
                    <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line line-clamp-[8]">
                      {listing.description || detail?.description}
                    </p>
                  </div>
                )}

                {/* Amenities */}
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

                {/* Contact */}
                {detail?.phone_numbers && detail.phone_numbers.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-wider mb-2">Contact</h3>
                    <div className="space-y-1.5">
                      {detail.phone_numbers.map((phone) => (
                        <a
                          key={phone}
                          href={`tel:${phone.replace(/\D/g, "")}`}
                          className="flex items-center gap-2 text-sm text-ramp-lime hover:text-ramp-lime-hover transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                          {phone}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fetching indicator */}
                {loading && (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <div className="w-3 h-3 rounded-full border-[1.5px] border-surface-4 border-t-ramp-lime animate-spin" />
                    Fetching details from source...
                  </div>
                )}

                {/* CTA */}
                <div className="flex gap-2">
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ramp flex-1 text-center block"
                  >
                    View on {SOURCE_LABELS[listing.source]} ↗
                  </a>
                  {detail?.phone_numbers && detail.phone_numbers.length > 0 && (
                    <a
                      href={`tel:${detail.phone_numbers[0].replace(/\D/g, "")}`}
                      className="btn-ramp !bg-surface-3 !text-text-primary hover:!bg-surface-4 px-4 flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                      </svg>
                      Call
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
