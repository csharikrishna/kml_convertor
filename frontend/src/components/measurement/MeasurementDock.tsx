"use client";

import React from "react";
import { Ruler, RotateCcw, X, Check } from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";
import { formatDistance } from "@/lib/gis/geodesy";

export function MeasurementDock() {
  const {
    isMeasuring,
    measurePoints,
    totalMeasureDistance,
    lastSegmentDistance,
    clearMeasurement,
    setIsMeasuring,
  } = useGisStore();

  if (!isMeasuring) return null;

  const count = measurePoints.length;

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 glass-panel rounded-2xl shadow-xl px-4 py-2.5 flex items-center gap-4 border border-cyan-300 bg-white/95 text-slate-800 animate-in fade-in slide-in-from-top-3 duration-200">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-cyan-500 text-white flex items-center justify-center shrink-0">
          <Ruler className="w-4 h-4" />
        </div>
        <div>
          <div className="text-xs font-bold flex items-center gap-1.5 text-slate-900">
            <span>Geodesic Measurement</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-100 text-cyan-800">
              {count} {count === 1 ? "point" : "points"}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            {count === 0 ? (
              "Click any station or map point to begin"
            ) : (
              <>
                Total:{" "}
                <span className="font-bold text-cyan-700">
                  {formatDistance(totalMeasureDistance)}
                </span>
                {count > 1 && (
                  <span className="text-slate-400">
                    {" "}
                    (Last: +{formatDistance(lastSegmentDistance)})
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
        <button
          type="button"
          onClick={clearMeasurement}
          className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          title="Reset points"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setIsMeasuring(false)}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
