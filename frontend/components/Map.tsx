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
  loading?: boolean;
  onPolygonChange: (polygon: [number, number][] | null) => void;
  onSelectListing: (id: string) => void;
  onDrawStart?: () => void;
}

export default function Map({ listings, selectedId, center, zoom, loading, onPolygonChange, onSelectListing, onDrawStart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const polygonLayerRef = useRef<any>(null);
  const onPolygonChangeRef = useRef(onPolygonChange);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep ref current so initMap never needs onPolygonChange as a dependency
  useEffect(() => { onPolygonChangeRef.current = onPolygonChange; }, [onPolygonChange]);

  useEffect(() => {
    if (!showMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showMenu]);

  const drawPathOptions = {
    color: "#60a5fa",
    weight: 2,
    fillColor: "#60a5fa",
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

    // StrictMode runs cleanup+remount; Leaflet leaves _leaflet_id on the DOM so clear it
    delete (containerRef.current as any)._leaflet_id;

    const map = L.map(containerRef.current, {
      dragging: true,
      zoomControl: true,
      inertia: true,
    }).setView(center, zoom);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    map.options.minZoom = 4;
    map.dragging.enable();

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
      (map as any).pm.disableDraw();
      map.dragging.enable();

      const latlngs = e.layer.getLatLngs()[0] as { lat: number; lng: number }[];
      const coords: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
      onPolygonChangeRef.current(coords);
      setHasPolygon(true);
      setIsDrawing(false);
    });

    map.on("pm:remove", () => {
      polygonLayerRef.current = null;
      onPolygonChangeRef.current(null);
      setHasPolygon(false);
      setIsDrawing(false);
      map.dragging.enable();
    });

    map.on("pm:edit", (e: any) => {
      const layer = e.layer || polygonLayerRef.current;
      if (!layer) return;
      const latlngs = layer.getLatLngs()[0] as { lat: number; lng: number }[];
      const coords: [number, number][] = latlngs.map((ll) => [ll.lat, ll.lng]);
      onPolygonChangeRef.current(coords);
    });

    map.on("pm:drawend", () => {
      setIsDrawing(false);
      map.dragging.enable();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  // Update polygon highlight based on results / loading state
  useEffect(() => {
    const layer = polygonLayerRef.current;
    if (!layer) return;
    if (loading) {
      layer.setStyle({ color: "#60a5fa", weight: 2, fillColor: "#60a5fa", fillOpacity: 0.08 });
    } else if (listings.length > 0) {
      layer.setStyle({ color: "#60a5fa", weight: 2.5, fillColor: "#60a5fa", fillOpacity: 0.18 });
    } else {
      layer.setStyle({ color: "#60a5fa", weight: 1.5, fillColor: "#60a5fa", fillOpacity: 0.04 });
    }
  }, [listings.length, loading]);

  // Pan map when center changes (e.g. geolocation detected)
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom);
    }
  }, [center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers — incremental: only add new, remove stale
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(listings.map((l) => l.id));

    // Remove markers for listings that are gone
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
      }
    });

    // Add markers for new listings only
    const newListings = listings.filter((l) => !markersRef.current.has(l.id));
    if (newListings.length === 0) return;

    (async () => {
      const L = (await import("leaflet")).default;
      for (const listing of newListings) {
        if (listing.lat == null || listing.lng == null) continue;
        if (!mapRef.current) break;

        const color = SOURCE_COLORS[listing.source] || "#6b7280";

        const priceK = listing.price_min >= 10000
          ? `$${Math.round(listing.price_min / 1000)}k`
          : `$${(listing.price_min / 1000).toFixed(1)}k`;

        const icon = L.divIcon({
          html: `<div style="display:inline-flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))">
            <div style="background:${color};color:white;border-radius:20px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;letter-spacing:-0.02em;border:2px solid rgba(255,255,255,0.25)">${priceK}</div>
            <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};margin-top:-1px"></div>
          </div>`,
          className: "",
          iconSize: [0, 0],
          iconAnchor: [20, 30],
        });

        const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
        const price = `$${listing.price_min.toLocaleString()}/mo`;
        const beds = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} BR`;
        const marker = L.marker([listing.lat, listing.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:Inter,system-ui,sans-serif;min-width:180px">` +
            `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${esc(listing.title)}</div>` +
            `<div style="color:#6b7280;font-size:12px;margin-bottom:4px">${esc(listing.address || "")}</div>` +
            `<div style="font-weight:700;font-size:14px">${price}</div>` +
            `<div style="color:#6b7280;font-size:12px">${beds} · ${listing.bathrooms} BA</div>` +
            `</div>`
          );

        marker.on("click", () => onSelectListing(listing.id));
        markersRef.current.set(listing.id, marker);
      }
    })();
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
    setIsDrawing(true);
    onDrawStart?.();

    (map as any).pm.enableDraw(mode, {
      snappable: false,
      pathOptions: drawPathOptions,
      continueDrawing: false,
    });
  };

  const cancelDraw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    (map as any).pm.disableDraw();
    map.dragging.enable();
    setIsDrawing(false);
  }, []);

  useEffect(() => {
    if (!isDrawing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelDraw();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelDraw, isDrawing]);

  const clearArea = () => {
    const map = mapRef.current;
    if (!map || !polygonLayerRef.current) return;
    map.removeLayer(polygonLayerRef.current);
    polygonLayerRef.current = null;
    onPolygonChangeRef.current(null);
    setHasPolygon(false);
    setIsDrawing(false);
  };

  return (
    <div ref={containerRef} className="flex-1 h-full relative">
      {/* Custom draw buttons */}
      <div className="absolute top-3 left-14 z-[1000] flex items-center gap-1.5">
        {isDrawing && !hasPolygon ? (
          <button
            onClick={cancelDraw}
            className="bg-surface-2 border-2 border-amber-500/40 text-amber-300 hover:bg-surface-3 rounded-lg px-3 py-2 text-xs font-medium transition-all flex items-center gap-2 shadow-card"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel drawing
          </button>
        ) : hasPolygon ? (
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
          <div ref={menuRef} className="relative">
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
            )}
          </div>
        )}
      </div>

      {isDrawing && !hasPolygon && (
        <div className="absolute top-16 left-14 z-[1000] pointer-events-none">
          <div className="bg-surface-2/95 backdrop-blur border border-border rounded-lg px-3 py-2 text-[11px] text-text-secondary shadow-card">
            Click to place points. Press Esc to cancel.
          </div>
        </div>
      )}
    </div>
  );
}
