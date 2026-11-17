"use client";

import React, { useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Scan,
  Ruler,
  Layers,
  FileDown,
  Share2,
  Map as MapIcon,
  ChevronDown,
} from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";
import type { BasemapId } from "@/types/workstation";

const BASEMAP_OPTIONS: { id: BasemapId; label: string }[] = [
  { id: "google_hybrid", label: "Google Satellite Hybrid" },
  { id: "esri_world", label: "Esri World Imagery" },
  { id: "osm_streets", label: "OSM Carto Voyager" },
];

export function MapControls() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBasemapMenu, setShowBasemapMenu] = useState(false);

  const {
    basemap,
    setBasemap,
    isMeasuring,
    setIsMeasuring,
    toggleLayerPanel,
    isLayerPanelOpen,
    zoomIn,
    zoomOut,
    fitBounds,
  } = useGisStore();

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2 pointer-events-auto">
      {/* Basemap Switcher Pill */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowBasemapMenu(!showBasemapMenu)}
          className="glass-panel px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-800 flex items-center gap-1.5 hover:bg-white shadow-md transition-all"
        >
          <MapIcon className="w-3.5 h-3.5 text-blue-600" />
          <span>
            {BASEMAP_OPTIONS.find((b) => b.id === basemap)?.label.split(" ")[0]}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {showBasemapMenu && (
          <div className="absolute right-0 top-9 w-48 bg-white/95 backdrop-blur-md rounded-xl border border-slate-200 shadow-xl p-1 z-30 space-y-0.5">
            {BASEMAP_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setBasemap(opt.id);
                  setShowBasemapMenu(false);
                }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  basemap === opt.id
                    ? "bg-blue-50 text-blue-600 font-semibold"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Floating Glass Tool Dock */}
      <div className="glass-panel p-1 rounded-xl shadow-lg flex flex-col gap-1 border border-slate-200/80">
        <button
          type="button"
          onClick={zoomIn}
          className="p-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={zoomOut}
          className="p-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <div className="w-full h-px bg-slate-200 my-0.5" />

        <button
          type="button"
          onClick={fitBounds}
          className="p-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Fit Drawing Bounds"
        >
          <Scan className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setIsMeasuring(!isMeasuring)}
          className={`p-2 rounded-lg transition-colors ${
            isMeasuring
              ? "bg-cyan-500 text-white shadow-xs"
              : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
          }`}
          title="Toggle Geodesic Measurement Tool"
        >
          <Ruler className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={toggleLayerPanel}
          className={`p-2 rounded-lg transition-colors ${
            isLayerPanelOpen
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
          }`}
          title="Toggle CAD Layers Panel"
        >
          <Layers className="w-4 h-4" />
        </button>

        <div className="w-full h-px bg-slate-200 my-0.5" />

        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="p-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Toggle Fullscreen View"
        >
          {isFullscreen ? (
            <Minimize2 className="w-4 h-4" />
          ) : (
            <Maximize2 className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
