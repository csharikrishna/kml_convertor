"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ZoomIn, ZoomOut, Compass, Layers } from "lucide-react";

interface SimpleKmlMapProps {
  projectData: any;
  activeLayers: {
    canal: boolean;
    buffer: boolean;
    plots: boolean;
    roads: boolean;
    stations: boolean;
  };
  toggleLayer?: (key: any) => void;
  overlayOpacity: number;
  setOverlayOpacity?: (val: number) => void;
  baseMap: string;
  setBaseMap: (bm: any) => void;
}

export function SimpleKmlMap({
  projectData,
  activeLayers,
  toggleLayer,
  overlayOpacity,
  setOverlayOpacity,
  baseMap,
  setBaseMap,
}: SimpleKmlMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseTileRef = useRef<L.TileLayer | null>(null);

  const canalLayerRef = useRef<L.GeoJSON | null>(null);
  const bufferLayerRef = useRef<L.GeoJSON | null>(null);
  const plotsLayerRef = useRef<L.GeoJSON | null>(null);
  const roadsLayerRef = useRef<L.GeoJSON | null>(null);
  const stationsLayerRef = useRef<L.LayerGroup | null>(null);

  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      center: [14.67, 77.28],
      zoom: 14,
      maxZoom: 22,
    });

    L.control
      .scale({
        imperial: false,
        metric: true,
        maxWidth: 160,
        position: "bottomright",
      })
      .addTo(map);

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      setMouseCoords({
        lat: Math.round(e.latlng.lat * 1000000) / 1000000,
        lng: Math.round(e.latlng.lng * 1000000) / 1000000,
      });
    });

    stationsLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Base Tile Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (baseTileRef.current) {
      map.removeLayer(baseTileRef.current);
      baseTileRef.current = null;
    }

    let tileUrl = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
    let maxZoom = 22;
    let maxNativeZoom = 20;
    let subdomains: string[] | string = ["0", "1", "2", "3"];

    if (baseMap === "satellite") {
      tileUrl = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
      subdomains = ["0", "1", "2", "3"];
      maxNativeZoom = 20;
      maxZoom = 22;
    } else if (baseMap === "imagery") {
      tileUrl =
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      subdomains = ["server", "services"];
      maxNativeZoom = 18;
      maxZoom = 22;
    } else if (baseMap === "osm") {
      tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      subdomains = ["a", "b", "c"];
      maxNativeZoom = 19;
      maxZoom = 22;
    } else if (baseMap === "carto") {
      tileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
      subdomains = ["a", "b", "c", "d"];
      maxNativeZoom = 19;
      maxZoom = 22;
    }

    const tile = L.tileLayer(tileUrl, {
      maxZoom,
      maxNativeZoom,
      subdomains,
      errorTileUrl:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    }).addTo(map);
    baseTileRef.current = tile;
  }, [baseMap]);

  // 3. Render Converted CAD Layers as Clean KML Overlay
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !projectData?.layers) return;

    // Clear previous
    [canalLayerRef, bufferLayerRef, plotsLayerRef, roadsLayerRef].forEach((ref) => {
      if (ref.current) {
        map.removeLayer(ref.current);
        ref.current = null;
      }
    });

    if (stationsLayerRef.current) {
      stationsLayerRef.current.clearLayers();
    }

    // A. 25m Buffer (Right-of-Way Corridor)
    if (activeLayers.buffer && projectData.layers.canal_buffer) {
      bufferLayerRef.current = L.geoJSON(projectData.layers.canal_buffer, {
        style: {
          color: "#0284c7",
          weight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: overlayOpacity * 0.35,
          dashArray: "4 4",
        },
      }).addTo(map);
    }

    // B. Canal Centerline Alignment
    if (activeLayers.canal && projectData.layers.canal_alignment) {
      canalLayerRef.current = L.geoJSON(projectData.layers.canal_alignment, {
        style: {
          color: "#0284c7",
          weight: 3.5,
          opacity: overlayOpacity,
          lineCap: "round",
          lineJoin: "round",
        },
      }).addTo(map);
    }

    // C. Survey Parcel Boundaries
    if (activeLayers.plots && projectData.layers.survey_plots) {
      plotsLayerRef.current = L.geoJSON(projectData.layers.survey_plots, {
        style: {
          color: "#f59e0b", // Authentic gold CAD layer color
          weight: 2.0,
          fillColor: "#10b981",
          fillOpacity: overlayOpacity * 0.15,
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          layer.bindTooltip(
            `<b>Survey No:</b> ${p.survey_no || "N/A"}<br/>` +
            `<b>Area:</b> ${p.total_acres || 0} acres (${p.total_ac_cts || ""})<br/>` +
            (p.canal_passing ? `<b style="color:#0284c7;">Canal Affected: ${p.acquired_acres} ac</b>` : "Unaffected"),
            { direction: "top", sticky: true }
          );
        },
      }).addTo(map);
    }

    // D. Roads & Access Tracks
    if (activeLayers.roads && projectData.layers.roads) {
      roadsLayerRef.current = L.geoJSON(projectData.layers.roads, {
        style: {
          color: "#e11d48",
          weight: 2.2,
          opacity: overlayOpacity * 0.9,
          dashArray: "6 3",
        },
      }).addTo(map);
    }

    // E. Station Markers (Crisp light badges)
    if (activeLayers.stations && projectData.layers?.chainage_markers?.features && stationsLayerRef.current) {
      const markers = projectData.layers.chainage_markers.features;
      markers.forEach((feat: any, idx: number) => {
        if (idx % 2 !== 0 && markers.length > 20) return;

        const coords = feat.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const latlng: L.LatLng = L.latLng(coords[1], coords[0]);
        const title = feat.properties?.title || feat.properties?.chainage || "Ch.";

        const iconHtml = `
          <div style="display:flex;align-items:center;gap:4px;background:rgba(255, 255, 255, 0.96);color:#0f172a;border:1px solid #cbd5e1;padding:2px 7px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.12);font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;font-weight:700;white-space:nowrap;">
            <span style="color:#2563eb;font-size:12px;line-height:1;">•</span> ${title}
          </div>
        `;

        const icon = L.divIcon({
          className: "simple-kml-station",
          html: iconHtml,
          iconSize: [60, 20],
          iconAnchor: [30, 10],
        });

        const marker = L.marker(latlng, { icon });
        stationsLayerRef.current?.addLayer(marker);
      });
    }

    // Fit bounds
    if (canalLayerRef.current && canalLayerRef.current.getLayers().length > 0) {
      const b = canalLayerRef.current.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [50, 50] });
      }
    }
  }, [projectData, activeLayers, overlayOpacity]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-100">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Map Layer Toggles & Opacity Bar (Viewport Dock) */}
      {toggleLayer && setOverlayOpacity && (
        <div className="absolute top-4 left-4 z-20 pointer-events-auto">
          <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl shadow-[0_4px_20px_rgba(15,23,42,0.08)] p-1.5 flex items-center gap-2 select-none whitespace-nowrap">
            {/* Layer Filter Pills */}
            <div className="flex items-center gap-1 whitespace-nowrap">
              <button
                onClick={() => toggleLayer("canal")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeLayers.canal
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200/80 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title="Toggle Canal Centerline Alignment"
              >
                <span className="w-2.5 h-1 bg-sky-500 rounded-full shrink-0" />
                <span className="whitespace-nowrap">Canal</span>
              </button>

              <button
                onClick={() => toggleLayer("buffer")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeLayers.buffer
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200/80 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title="Toggle 25m Right-of-Way Statutory Corridor"
              >
                <span className="w-2.5 h-2.5 bg-sky-400/30 border border-sky-500 rounded-xs shrink-0" />
                <span className="whitespace-nowrap">25m RoW</span>
              </button>

              <button
                onClick={() => toggleLayer("plots")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeLayers.plots
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200/80 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title="Toggle Survey Plots Cadastral Boundaries"
              >
                <span className="w-2.5 h-2.5 bg-emerald-500/30 border border-amber-500 rounded-xs shrink-0" />
                <span className="whitespace-nowrap">Parcels</span>
              </button>

              <button
                onClick={() => toggleLayer("roads")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeLayers.roads
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200/80 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title="Toggle Access Roads & Cart Tracks"
              >
                <span className="w-2.5 h-1 bg-rose-500 rounded-full shrink-0" />
                <span className="whitespace-nowrap">Roads</span>
              </button>

              <button
                onClick={() => toggleLayer("stations")}
                className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeLayers.stations
                    ? "bg-slate-100 text-slate-900 font-semibold border border-slate-200/80 shadow-2xs"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title="Toggle Engineering Chainage Station Markers"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
                <span className="whitespace-nowrap">Chainage</span>
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200 shrink-0" />

            {/* Opacity Range Slider */}
            <div className="flex items-center gap-2 px-2 text-xs text-slate-600 font-mono whitespace-nowrap">
              <span className="text-[11px] font-sans font-medium text-slate-500 whitespace-nowrap">Opacity:</span>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                className="w-18 accent-blue-600 cursor-pointer"
              />
              <span className="font-bold text-blue-600 w-8 text-right text-[11px] whitespace-nowrap">
                {Math.round(overlayOpacity * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Map Controls - Clean Light Theme */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5">
        <button
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="w-8.5 h-8.5 rounded-xl bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200/90 shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center transition-all duration-150 active:scale-95"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="w-8.5 h-8.5 rounded-xl bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200/90 shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center transition-all duration-150 active:scale-95"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            if (canalLayerRef.current) {
              const b = canalLayerRef.current.getBounds();
              if (b.isValid()) mapInstanceRef.current?.fitBounds(b, { padding: [50, 50] });
            }
          }}
          className="w-8.5 h-8.5 rounded-xl bg-white/95 hover:bg-white text-blue-600 hover:text-blue-700 border border-slate-200/90 shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex items-center justify-center transition-all duration-150 active:scale-95 mt-1"
          title="Fit Full Extents"
        >
          <Compass className="w-4 h-4" />
        </button>
      </div>

      {/* Floating Legend Badge - Crisp White Glassmorphic Card */}
      <div className="absolute bottom-10 left-4 z-20 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] p-3 text-xs text-slate-700 font-medium space-y-1.5 min-w-[190px]">
          <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold border-b border-slate-100 pb-1 mb-1">
            KML Overlay Legend
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1 bg-sky-500 rounded-full" />
            <span className="text-[11px] text-slate-700">Canal Centerline</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-2 bg-sky-400/30 border border-sky-500 rounded-xs" />
            <span className="text-[11px] text-slate-700">25m Corridor Buffer</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-2 bg-emerald-500/20 border border-amber-500 rounded-xs" />
            <span className="text-[11px] text-slate-700">Survey Boundaries</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-1 bg-rose-500 rounded-full" />
            <span className="text-[11px] text-slate-700">Roads & Tracks</span>
          </div>
        </div>
      </div>

      {/* Bottom Coordinates & Scale Status Bar - Clean Light Footer */}
      <div className="absolute bottom-0 left-0 right-0 h-7.5 bg-white/95 backdrop-blur-md border-t border-slate-200/90 text-slate-500 text-[11px] px-4 flex items-center justify-between font-mono z-10 select-none shadow-2xs">
        <div>
          {mouseCoords && (
            <span>
              Lat: <span className="text-slate-800 font-semibold">{mouseCoords.lat.toFixed(6)}° N</span> &nbsp;
              Lon: <span className="text-slate-800 font-semibold">{mouseCoords.lng.toFixed(6)}° E</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-blue-600 font-bold">{projectData?.village || "Survey Area"}</span>
          <span>•</span>
          <span>EPSG:4326 (WGS84)</span>
          <span>•</span>
          <span>UTM Zone 43N</span>
        </div>
      </div>
    </div>
  );
}
