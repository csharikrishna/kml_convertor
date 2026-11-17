"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";
import { useGisStore } from "@/stores/useGisStore";
import type { LabelOrientationMode } from "@/lib/gis/labels";

export function AdvancedOptions() {
  const [isOpen, setIsOpen] = useState(false);
  const { parameters, updateParameters } = useConverterStore();
  const {
    labelOrientation,
    setLabelOrientation,
    declutterLabels,
    setDeclutterLabels,
  } = useGisStore();

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-2.5 px-3.5 flex items-center justify-between text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          <span>Advanced GIS & Styling Options</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {isOpen && (
        <div className="p-3.5 space-y-3.5 text-xs border-t border-slate-200 bg-white">
          {/* Checkboxes grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.merge_lines}
                onChange={(e) =>
                  updateParameters({ merge_lines: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Merge Connected Lines</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.ignore_large_polygons}
                onChange={(e) =>
                  updateParameters({ ignore_large_polygons: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Filter Large Extent Polygons</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.export_text}
                onChange={(e) =>
                  updateParameters({ export_text: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Export CAD Text Labels</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.export_points}
                onChange={(e) =>
                  updateParameters({ export_points: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Export Survey Stations / Points</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.auto_scale_text}
                onChange={(e) =>
                  updateParameters({ auto_scale_text: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Auto-scale Text to Drawing</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={declutterLabels}
                onChange={(e) => setDeclutterLabels(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Dynamic Spatial Label Decluttering</span>
            </label>
          </div>

          {/* Label Text Scale Slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-700 font-medium">
                Label Text Scale
              </label>
              <span className="font-mono text-slate-500">
                {parameters.label_scale.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={parameters.label_scale}
              onChange={(e) =>
                updateParameters({ label_scale: parseFloat(e.target.value) })
              }
              className="w-full accent-blue-600"
            />
          </div>

          {/* Label Orientation & Text Mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Label Orientation
              </label>
              <select
                value={labelOrientation}
                onChange={(e) =>
                  setLabelOrientation(e.target.value as LabelOrientationMode)
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              >
                <option value="cad">Exact CAD Angle</option>
                <option value="cad_upright">CAD Upright (Readable)</option>
                <option value="horizontal">Horizontal Always</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">
                KML Text Mode
              </label>
              <select
                value={parameters.kml_text_mode}
                onChange={(e) =>
                  updateParameters({
                    kml_text_mode: e.target.value as "screen" | "normal",
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              >
                <option value="screen">Screen Space Overlay</option>
                <option value="normal">Standard Ground Text</option>
              </select>
            </div>
          </div>

          {/* Polygon Fills */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={parameters.fill_polygons}
                onChange={(e) =>
                  updateParameters({ fill_polygons: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium">Fill Closed Polygons</span>
            </label>

            {parameters.fill_polygons && (
              <div className="grid grid-cols-2 gap-3 pl-6 pt-1">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">
                    Fill Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={parameters.fill_color}
                      onChange={(e) =>
                        updateParameters({ fill_color: e.target.value })
                      }
                      className="w-7 h-7 rounded border border-slate-300 p-0.5 cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-slate-500">
                      {parameters.fill_color}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-slate-600">
                      Opacity
                    </label>
                    <span className="font-mono text-[11px] text-slate-500">
                      {Math.round(parameters.fill_opacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={parameters.fill_opacity}
                    onChange={(e) =>
                      updateParameters({
                        fill_opacity: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
