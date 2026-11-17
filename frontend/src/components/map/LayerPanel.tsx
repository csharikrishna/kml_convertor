"use client";

import React from "react";
import { X, Eye, EyeOff, Layers } from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";

export function LayerPanel() {
  const {
    layers,
    layerVisibility,
    layerOpacity,
    isLayerPanelOpen,
    setIsLayerPanelOpen,
    setLayerVisibility,
    setLayerOpacity,
    setAllLayersVisibility,
  } = useGisStore();

  if (!isLayerPanelOpen) return null;

  return (
    <div className="absolute top-16 right-4 w-72 sm:w-80 max-h-[calc(100%-80px)] glass-panel rounded-2xl shadow-2xl z-20 flex flex-col border border-slate-200/90 overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-white/60">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-800">
            CAD Drawing Layers ({layers.length})
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {layers.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 mr-1">
              <button
                type="button"
                onClick={() => setAllLayersVisibility(true)}
                className="text-blue-600 hover:text-blue-800 px-1 py-0.5 rounded hover:bg-blue-50 transition-colors"
                title="Show all layers"
              >
                All
              </button>
              <span className="text-slate-300">/</span>
              <button
                type="button"
                onClick={() => setAllLayersVisibility(false)}
                className="text-slate-500 hover:text-slate-700 px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
                title="Hide all layers"
              >
                None
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsLayerPanelOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Layer List */}
      <div className="p-2 space-y-1.5 overflow-y-auto flex-1">
        {layers.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400">
            No drawing layers loaded
          </div>
        ) : (
          layers.map((l) => {
            const isVisible = layerVisibility[l.name] !== false;
            const currentOpacity =
              layerOpacity[l.name] !== undefined ? layerOpacity[l.name] : 1.0;

            return (
              <div
                key={l.name}
                className="p-2.5 rounded-xl bg-white/80 border border-slate-200/70 hover:border-slate-300 transition-all space-y-2 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 border border-slate-400/40"
                      style={{ backgroundColor: l.color }}
                    />
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {l.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({l.featureCount})
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLayerVisibility(l.name, !isVisible)}
                    className={`p-1 rounded-md transition-colors ${
                      isVisible
                        ? "text-blue-600 hover:bg-blue-50"
                        : "text-slate-400 hover:bg-slate-100"
                    }`}
                    title={isVisible ? "Hide Layer" : "Show Layer"}
                  >
                    {isVisible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {isVisible && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[10px] text-slate-400">Opacity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={currentOpacity}
                      onChange={(e) =>
                        setLayerOpacity(l.name, parseFloat(e.target.value))
                      }
                      className="flex-1 accent-blue-600 h-1 bg-slate-200 rounded-lg cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-slate-500 w-8 text-right">
                      {Math.round(currentOpacity * 100)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
