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
  initialPolygon?: [number, number][] | null;
  onPolygonChange: (polygon: [number, number][] | null) => void;
  onSelectListing: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onDrawStart?: () => void;
}

interface HoverPreview {
  listing: Listing;
  x: number;
  y: number;
}

export default function Map({ listings, selectedId, center, zoom, loading, initialPolygon, onPolygonChange, onSelectListing, onOpenDetail, onDrawStart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const polygonLayerRef = useRef<any>(null);
  const onPolygonChangeRef = useRef(onPolygonChange);
  const [hasPolygon, setHasPolygon] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const setHoverPreviewRef = useRef(setHoverPreview);
  const hoveredListingRef = useRef<Listing | null>(null);

  const initialPolygonRef = useRef(initialPolygon);

  // Keep ref current so initMap never needs onPolygonChange as a dependency
  useEffect(() => { onPolygonChangeRef.current = onPolygonChange; }, [onPolygonChange]);

  // Track mouse position for hover preview — attached to container, not markers
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      if (!hoveredListingRef.current) return;
      const rect = el.getBoundingClientRect();
      setHoverPreviewRef.current({
        listing: hoveredListingRef.current,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

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

  const disablePolygonInteractivity = useCallback((layer: any) => {
    if (!layer) return;
    if (layer.pm?.disable) {
      layer.pm.disable();
    }
    if (layer.dragging?.disable) {
      layer.dragging.disable();
    }
    if (layer.options) {
      layer.options.interactive = false;
    }
    const element = layer.getElement?.();
    if (element) {
      element.style.pointerEvents = "none";
    }
  }, []);

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
      disablePolygonInteractivity(e.layer);
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

    // Restore persisted polygon if available
    if (initialPolygonRef.current && initialPolygonRef.current.length >= 3) {
      const restoredLayer = L.polygon(
        initialPolygonRef.current.map(([lat, lng]) => [lat, lng] as [number, number]),
        drawPathOptions,
      ).addTo(map);
      polygonLayerRef.current = restoredLayer;
      disablePolygonInteractivity(restoredLayer);
      setHasPolygon(true);
      map.fitBounds(restoredLayer.getBounds(), { padding: [40, 40] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disablePolygonInteractivity]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isDrawing) {
      map.dragging.disable();
      setShowMenu(false);
    } else {
      map.dragging.enable();
    }
  }, [isDrawing]);

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
    disablePolygonInteractivity(layer);
  }, [disablePolygonInteractivity, listings.length, loading]);

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

        const marker = L.marker([listing.lat, listing.lng], { icon }).addTo(map);

        marker.on("click", () => {
          onSelectListing(listing.id);
          onOpenDetail(listing.id);
        });

        marker.on("mouseover", () => {
          hoveredListingRef.current = listing;
        });
        marker.on("mouseout", () => {
          hoveredListingRef.current = null;
          setHoverPreviewRef.current(null);
        });

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

      {/* Hover preview card */}
      {hoverPreview && (() => {
        const { listing, x, y } = hoverPreview;
        const photo = listing.photo_url || listing.photos?.[0];
        const price = `$${listing.price_min.toLocaleString()}/mo`;
        const beds = listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} BR`;
        // Flip horizontally near right edge, vertically near bottom
        const flipX = x > (containerRef.current?.clientWidth ?? 0) - 260;
        const flipY = y > (containerRef.current?.clientHeight ?? 0) - 200;
        return (
          <div
            className="absolute z-[1500] pointer-events-none"
            style={{
              left: flipX ? x - 240 : x + 16,
              top: flipY ? y - 180 : y - 10,
            }}
          >
            <div className="bg-surface-1 border border-border rounded-xl shadow-card-hover overflow-hidden w-[220px] animate-fade-in">
              {photo ? (
                <img src={photo} alt="" className="w-full h-[130px] object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-full h-[130px] bg-surface-3 flex items-center justify-center">
                  <svg className="w-8 h-8 text-surface-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-text-primary leading-snug line-clamp-1">{listing.title}</p>
                <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{listing.address || listing.neighborhood}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-sm font-bold text-ramp-lime">{price}</span>
                  <span className="text-xs text-text-secondary">{beds} · {listing.bathrooms} BA</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
