"use client";
import { motion } from "framer-motion";
import { Listing, SOURCE_COLORS, SOURCE_LABELS } from "@/lib/types";

interface Props {
  listing: Listing;
  selected: boolean;
  onClick: () => void;
  onOpenDetail: () => void;
  index?: number;
}

export default function ListingCard({ listing, selected, onClick, onOpenDetail, index = 0 }: Props) {
  const color = SOURCE_COLORS[listing.source] || "#6b7280";

  const priceStr =
    listing.price_min === listing.price_max
      ? `$${listing.price_min.toLocaleString()}`
      : `$${listing.price_min.toLocaleString()}-${listing.price_max.toLocaleString()}`;

  const bedsStr = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} BR`;
  const photo = listing.photo_url || (listing.photos && listing.photos.length > 0 ? listing.photos[0] : null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`group rounded-xl border transition-all cursor-pointer overflow-hidden ${
        selected
          ? "border-ramp-lime/40 bg-ramp-lime-dim shadow-glow ring-1 ring-ramp-lime/20"
          : "border-border bg-surface-2 hover:border-border-hover hover:shadow-card-hover"
      }`}
    >
      {/* Image */}
      {photo ? (
        <div className="relative h-[130px] bg-surface-3 overflow-hidden">
          <img
            src={photo}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            loading="lazy"
            onError={(e) => { const parent = (e.target as HTMLImageElement).parentElement; if (parent) parent.style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Source pill */}
          <div className="absolute top-2 left-2">
            <span className="badge-dark text-white shadow-sm backdrop-blur-sm" style={{ backgroundColor: `${color}cc` }}>
              {SOURCE_LABELS[listing.source]}
            </span>
          </div>

          {/* Tags */}
          <div className="absolute top-2 right-2 flex gap-1">
            {listing.furnished && <span className="badge-dark bg-emerald-500/80 text-white backdrop-blur-sm">Furnished</span>}
            {listing.no_fee && <span className="badge-dark bg-blue-500/80 text-white backdrop-blur-sm">No Fee</span>}
          </div>

          {/* Price overlay */}
          <div className="absolute bottom-2 left-2">
            <span className="text-white font-bold text-base drop-shadow-md leading-none">
              {priceStr}
              <span className="text-white/60 text-[11px] font-normal ml-0.5">/mo</span>
            </span>
          </div>

          {/* Photo count */}
          {listing.photos && listing.photos.length > 1 && (
            <div className="absolute bottom-2 right-2">
              <span className="badge-dark bg-black/50 text-white backdrop-blur-sm">
                <svg className="w-3 h-3 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
                {listing.photos.length}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <span className="badge-dark text-white" style={{ backgroundColor: color }}>
            {SOURCE_LABELS[listing.source]}
          </span>
          {listing.furnished && <span className="badge-dark bg-emerald-500/20 text-emerald-400">Furnished</span>}
          {listing.no_fee && <span className="badge-dark bg-blue-500/20 text-blue-400">No Fee</span>}
        </div>
      )}

      {/* Content */}
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-1 tracking-tight">
          {listing.title}
        </h3>
        <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
          {listing.address || listing.neighborhood}
        </p>

        <div className="flex items-center justify-between mt-2">
          {!photo && (
            <span className="text-base font-bold text-text-primary tracking-tight">
              {priceStr}<span className="text-xs font-normal text-text-muted ml-0.5">/mo</span>
            </span>
          )}
          <div className={`flex items-center gap-2 text-xs text-text-secondary ${photo ? "" : "ml-auto"}`}>
            <span className="font-medium text-text-primary">{bedsStr}</span>
            <span className="text-text-muted">&#183;</span>
            <span>{listing.bathrooms} BA</span>
            {listing.sqft && (
              <>
                <span className="text-text-muted">&#183;</span>
                <span>{listing.sqft} ft&#178;</span>
              </>
            )}
          </div>
        </div>

        {listing.available_from && (
          <p className="text-[11px] text-text-muted mt-1.5">
            Available {listing.available_from}{listing.available_to ? ` \u2192 ${listing.available_to}` : "+"}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border">
          <motion.button
            onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
            className="flex-1 text-xs font-medium text-ramp-lime hover:text-ramp-lime-hover hover:bg-ramp-lime-dim rounded-lg py-1.5 transition-colors text-center"
            whileTap={{ scale: 0.97 }}
          >
            Details
          </motion.button>
          <span className="w-px h-4 bg-border" />
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-3 rounded-lg py-1.5 transition-colors text-center"
          >
            Source &#8599;
          </a>
        </div>
      </div>
    </motion.div>
  );
}
