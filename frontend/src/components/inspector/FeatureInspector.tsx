"use client";

import React from "react";
import { Info, Maximize2, Hash, Layers, Tag } from "lucide-react";
import { useInspectorStore } from "@/stores/useInspectorStore";
import { formatDistance } from "@/lib/gis/geodesy";

export function FeatureInspector() {
  const { inspectedFeature } = useInspectorStore();

  if (!inspectedFeature) return null;

  const {
    layer,
    type,
    lengthMeters,
    areaM2,
    vertexCount,
    text,
    textHeight,
    rotation,
    properties,
  } = inspectedFeature;

  return (
    <div className="absolute bottom-10 left-4 z-20 w-72 glass-panel rounded-2xl shadow-xl p-3 border border-slate-200/90 text-xs space-y-2 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <Layers className="w-3.5 h-3.5 text-blue-600" />
          <span className="truncate max-w-[170px]">{layer}</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase">
          {type}
        </span>
      </div>

      <div className="space-y-1 text-[11px] text-slate-600">
        {text && (
          <div className="flex items-start gap-1">
            <span className="text-slate-400 shrink-0">Text:</span>
            <span className="font-semibold text-slate-800 break-all">{text}</span>
          </div>
        )}

        {textHeight !== undefined && textHeight !== null && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Text Height:</span>
            <span className="font-mono text-slate-700">{textHeight}</span>
          </div>
        )}

        {rotation !== undefined && rotation !== 0 && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Rotation:</span>
            <span className="font-mono text-slate-700">
              {rotation.toFixed(1)}°
            </span>
          </div>
        )}

        {lengthMeters !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Geodesic Length:</span>
            <span className="font-bold text-blue-600 font-mono">
              {formatDistance(lengthMeters)}
            </span>
          </div>
        )}

        {areaM2 !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Geodesic Area:</span>
            <span className="font-bold text-blue-600 font-mono">
              {Math.round(areaM2).toLocaleString()} m² (
              {(areaM2 / 10000).toFixed(2)} ha)
            </span>
          </div>
        )}

        {vertexCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Vertices:</span>
            <span className="font-mono text-slate-700">{vertexCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
