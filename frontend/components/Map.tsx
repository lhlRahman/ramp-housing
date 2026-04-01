"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Listing, SOURCE_COLORS } from "@/lib/types";

type DrawMode = "Rectangle" | "Polygon";

interface Props {
  listings: Listing[];
  selectedId: string | null;
  center: [number, number];
  zoom: number;
  onPolygonChange: (polygon: [number, number][] | null) => void;
  onSelectListing: (id: string) => void;
  onDrawStart?: () => void;
}

export default function Map({ listings, selectedId, center, zoom, onPolygonChange, onSelectListing, onDrawStart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const polygonLayerRef = useRef<any>(null);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const drawPathOptions = {
    color: "#EBF123",
    weight: 2,
    fillColor: "#EBF123",
    fillOpacity: 0.08,
  };

  const initMap = useCallback(async () => {
    if (!containerRef.current || mapRef.current) return;

    const L = (await import("leaflet")).default;
    await import("@geoman-io/leaflet-geoman-free");

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    const map = L.map(containerRef.current).setView(center, zoom);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    // Restrict to US bounds
    const usBounds = L.latLngBounds(
      L.latLng(24.396308, -125.0), // SW corner
      L.latLng(49.384358, -66.93),  // NE corner
    );
    map.setMaxBounds(usBounds.pad(0.1));
    map.options.minZoom = 4;

    // Init geoman without toolbar
    (map as any).pm.addControls({
      position: "topleft",
      drawMarker: false, drawCircle: false, drawCircleMarker: false,
      drawPolyline: false, drawRectangle: false, drawPolygon: false,
      editMode: false, dragMode: false, cutPolygon: false,
      removalMode: false, drawText: false, rotateMode: false,
    });

    // Handle polygon create
    map.on("pm:create", (e: any) => {
      if (polygonLayerRef.current) {
        map.removeLayer(polygonLayerRef.current);
      }
      polygonLayerRef.current = e.layer;
      e.layer.setStyle(drawPathOptions);

      const latlngs = e.layer.getLatLngs()[0] as { lat: number; lng: number }[];
      const coords: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
      onPolygonChange(coords);
      setHasPolygon(true);
    });

    map.on("pm:remove", () => {
      polygonLayerRef.current = null;
      onPolygonChange(null);
      setHasPolygon(false);
    });

    map.on("pm:edit", (e: any) => {
      const layer = e.layer || polygonLayerRef.current;
      if (!layer) return;
      const latlngs = layer.getLatLngs()[0] as { lat: number; lng: number }[];
      const coords: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
      onPolygonChange(coords);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPolygonChange]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  // Pan map when center changes (e.g. geolocation detected)
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom);
    }
  }, [center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => map.removeLayer(marker));
    markersRef.current.clear();

    listings.forEach(async (listing) => {
      if (listing.lat == null || listing.lng == null) return;

      const L = (await import("leaflet")).default;
      const color = SOURCE_COLORS[listing.source] || "#6b7280";

      const priceK = listing.price_min >= 10000
        ? `$${Math.round(listing.price_min / 1000)}k`
        : `$${(listing.price_min / 1000).toFixed(1)}k`;

      const icon = L.divIcon({
        html: `<div style="background:${color};color:white;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;border:2px solid rgba(255,255,255,0.3);box-shadow:0 2px 8px rgba(0,0,0,0.3);letter-spacing:-0.02em">${priceK}</div>`,
        className: "",
        iconSize: [0, 0],
        iconAnchor: [20, 14],
      });

      const price = `$${listing.price_min.toLocaleString()}/mo`;
      const beds = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} BR`;
      const marker = L.marker([listing.lat, listing.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:Inter,system-ui,sans-serif;min-width:180px">` +
          `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${listing.title}</div>` +
          `<div style="color:#6b7280;font-size:12px;margin-bottom:4px">${listing.address}</div>` +
          `<div style="font-weight:700;font-size:14px">${price}</div>` +
          `<div style="color:#6b7280;font-size:12px">${beds} · ${listing.bathrooms} BA</div>` +
          `</div>`
        );

      marker.on("click", () => onSelectListing(listing.id));
      markersRef.current.set(listing.id, marker);
    });
  }, [listings, onSelectListing]);

  // Highlight selected
  useEffect(() => {
    if (!selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (marker) {
      marker.openPopup();
      mapRef.current?.panTo(marker.getLatLng());
    }
  }, [selectedId]);

  const startDraw = (mode: DrawMode) => {
    const map = mapRef.current;
    if (!map) return;
    setShowMenu(false);
    onDrawStart?.();

    (map as any).pm.enableDraw(mode, {
      snappable: false,
      pathOptions: drawPathOptions,
    });
  };

  const clearArea = () => {
    const map = mapRef.current;
    if (!map || !polygonLayerRef.current) return;
    map.removeLayer(polygonLayerRef.current);
    polygonLayerRef.current = null;
    onPolygonChange(null);
    setHasPolygon(false);
  };

  return (
    <div ref={containerRef} className="flex-1 h-full relative">
      {/* Custom draw buttons */}
      <div className="absolute top-3 left-14 z-[1000] flex items-center gap-1.5">
        {hasPolygon ? (
          <button
            onClick={clearArea}
            className="bg-surface-2 border-2 border-ramp-lime/50 text-ramp-lime hover:bg-surface-3 rounded-lg px-3 py-2 text-xs font-medium transition-all flex items-center gap-2 shadow-card"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear area
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="bg-surface-2 border border-border hover:border-border-hover hover:bg-surface-3 text-text-primary rounded-lg px-3 py-2 text-xs font-medium transition-all flex items-center gap-2 shadow-card"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
              Draw area
              <svg className={`w-3 h-3 transition-transform ${showMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setShowMenu(false)} />
                <div className="absolute top-full left-0 mt-1 bg-surface-2 border border-border rounded-xl shadow-card-hover p-1.5 z-[100] w-40">
                  <button
                    onClick={() => startDraw("Rectangle")}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
                  >
                    <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="3" y="5" width="18" height="14" rx="1" />
                    </svg>
                    Rectangle
                  </button>
                  <button
                    onClick={() => startDraw("Polygon")}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
                  >
                    <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75l7.5-3.75 8.25 3.75-3.75 10.5H7.5z" />
                    </svg>
                    Polygon
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
