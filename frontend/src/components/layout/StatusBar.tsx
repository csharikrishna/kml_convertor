"use client";

import React from "react";
import { Navigation, Compass, Globe, ZoomIn } from "lucide-react";
import { useInspectorStore } from "@/stores/useInspectorStore";
import { useConverterStore } from "@/stores/useConverterStore";

export function StatusBar() {
  const { cursorLatLon, cursorUtm, zoomLevel, lodLabel } = useInspectorStore();
  const { parameters } = useConverterStore();

  const latFmt = cursorLatLon
    ? `${Math.abs(cursorLatLon.lat).toFixed(5)}°${
        cursorLatLon.lat >= 0 ? "N" : "S"
      }`
    : "—";

  const lonFmt = cursorLatLon
    ? `${Math.abs(cursorLatLon.lon).toFixed(5)}°${
        cursorLatLon.lon >= 0 ? "E" : "W"
      }`
    : "—";

  const utmFmt = cursorUtm
    ? `E: ${cursorUtm.easting.toLocaleString()} m, N: ${cursorUtm.northing.toLocaleString()} m (Z${
        cursorUtm.zone
      })`
    : "—";

  return (
    <div className="h-7 border-t border-slate-200 bg-white/95 backdrop-blur-sm text-[11px] text-slate-600 px-3 flex items-center justify-between z-20 overflow-x-auto select-none">
      <div className="flex items-center gap-4 shrink-0 font-mono">
        <div className="flex items-center gap-1.5" title="Cursor Geodetic WGS84 Coordinates">
          <Navigation className="w-3 h-3 text-slate-400" />
          <span>
            {latFmt}, {lonFmt}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5" title="Transverse Mercator UTM Coordinates">
          <Compass className="w-3 h-3 text-slate-400" />
          <span>{utmFmt}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0 font-mono">
        <div className="flex items-center gap-1.5" title="Input CRS Definition">
          <Globe className="w-3 h-3 text-slate-400" />
          <span className="font-semibold text-slate-700">
            {parameters.input_epsg}
          </span>
        </div>

        <div className="flex items-center gap-1.5" title="Current Zoom & Level of Detail">
          <ZoomIn className="w-3 h-3 text-slate-400" />
          <span>
            {zoomLevel} · <span className="text-slate-500">{lodLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
