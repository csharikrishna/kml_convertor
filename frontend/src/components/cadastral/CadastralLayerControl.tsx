"use client";

import { computeGeodesicDistance, formatDistance } from "@/lib/gis/geodesy";

import React, { useState, useMemo } from "react";
import {
  Map,
  Layers,
  Search,
  Ruler,
  FileText,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Sliders,
  Maximize2,
  Compass,
  Check,
  Focus,
  Info,
  X,
  Undo2,
  Copy,
  RotateCcw,
} from "lucide-react";
import { useCadastralStore, LayerVisibility } from "@/stores/useCadastralStore";

interface LayerDef {
  key: keyof LayerVisibility;
  label: string;
  category: "canal" | "cadastral" | "transport" | "admin" | "reference";
  color: string;
  type: "line" | "polygon" | "point";
  description?: string;
}

const LAYER_DEFINITIONS: LayerDef[] = [
  // Canal Infrastructure
  {
    key: "canal_alignment",
    label: "Canal Alignment Centerline",
    category: "canal",
    color: "#1d4ed8",
    type: "line",
    description: "Design centerline of canal excavation corridor",
  },
  {
    key: "canal_buffer",
    label: "Canal Buffer / Right-of-Way",
    category: "canal",
    color: "#0284c7",
    type: "polygon",
    description: "Proposed corridor buffer zone for acquisition",
  },
  {
    key: "chainage_markers",
    label: "Chainage Markers",
    category: "canal",
    color: "#2563eb",
    type: "point",
    description: "Engineering station markers along alignment",
  },
  {
    key: "structures",
    label: "Structures (Culverts & Regulators)",
    category: "canal",
    color: "#1e293b",
    type: "point",
    description: "Hydraulic structures, bridges and regulators",
  },

  // Cadastral Data
  {
    key: "survey_plots",
    label: "Survey Plots (Cadastral Parcels)",
    category: "cadastral",
    color: "#2563eb",
    type: "polygon",
    description: "Revenue cadastral boundaries with computed areas",
  },
  {
    key: "plot_boundaries",
    label: "Survey Number Labels",
    category: "cadastral",
    color: "#3b82f6",
    type: "point",
    description: "Centroid survey numbers & acreage callouts",
  },

  // Transportation
  {
    key: "roads",
    label: "Roads & Cart Tracks",
    category: "transport",
    color: "#dc2626",
    type: "line",
    description: "Access roads, cart tracks, and rural pathways",
  },

  // Administrative Boundaries
  {
    key: "village_boundary",
    label: "Village Revenue Boundary",
    category: "admin",
    color: "#9333ea",
    type: "line",
    description: "Statutory revenue village limits",
  },

  // Reference Layers
  {
    key: "contours",
    label: "Elevation Contours",
    category: "reference",
    color: "#d97706",
    type: "line",
    description: "Topographic elevation contour lines",
  },
  {
    key: "topo_points",
    label: "Topo Survey Points",
    category: "reference",
    color: "#64748b",
    type: "point",
    description: "Field spot levels and benchmark elevations",
  },
  {
    key: "drainage",
    label: "Drainage Channels & Streams",
    category: "reference",
    color: "#06b6d4",
    type: "line",
    description: "Natural streams, nalas, and catchment drainage",
  },
  {
    key: "lulc",
    label: "Land Use / Land Cover",
    category: "reference",
    color: "#10b981",
    type: "polygon",
    description: "Crop land, barren ground, and water bodies",
  },
];

interface LayerGroup {
  id: "canal" | "cadastral" | "transport" | "admin" | "reference";
  title: string;
  layers: LayerDef[];
}

export function CadastralLayerControl() {
  const {
    baseMap,
    setBaseMap,
    layers,
    toggleLayer,
    setLayer,
    layerOpacity,
    setLayerOpacity,
    setTableModalOpen,
    currentProjectId,
    apsacOverlay,
    setApsacOverlay,
    apsacOpacity,
    setApsacOpacity,
    measurementMode,
    setMeasurementMode,
    measurePoints,
    setMeasurePoints,
    measureTotalDist,
    measureAreaM2,
    undoMeasurePoint,
    clearMeasurement,
    isLeftPanelCollapsed,
    setIsLeftPanelCollapsed,
    activeLeftRibbon,
    setActiveLeftRibbon,
    setTargetFlyToBounds,
    projectData,
    isolateLayer,
    layerInfoModal,
    setLayerInfoModal,
  } = useCadastralStore();

  const [layerFilter, setLayerFilter] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    canal: true,
    cadastral: true,
    transport: true,
    admin: true,
    reference: false,
  });
  const [activeOpacityKey, setActiveOpacityKey] = useState<string | null>(null);
  const [measureCopied, setMeasureCopied] = useState(false);

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const layerGroups: LayerGroup[] = useMemo(() => {
    const filter = layerFilter.toLowerCase().trim();
    const matchesFilter = (l: LayerDef) =>
      !filter ||
      l.label.toLowerCase().includes(filter) ||
      l.description?.toLowerCase().includes(filter);

    const groups: LayerGroup[] = [
      {
        id: "canal",
        title: "Canal Infrastructure",
        layers: LAYER_DEFINITIONS.filter(
          (l) => l.category === "canal" && matchesFilter(l)
        ),
      },
      {
        id: "cadastral",
        title: "Cadastral Data",
        layers: LAYER_DEFINITIONS.filter(
          (l) => l.category === "cadastral" && matchesFilter(l)
        ),
      },
      {
        id: "transport",
        title: "Transportation",
        layers: LAYER_DEFINITIONS.filter(
          (l) => l.category === "transport" && matchesFilter(l)
        ),
      },
      {
        id: "admin",
        title: "Administrative Boundaries",
        layers: LAYER_DEFINITIONS.filter(
          (l) => l.category === "admin" && matchesFilter(l)
        ),
      },
      {
        id: "reference",
        title: "Reference Topography",
        layers: LAYER_DEFINITIONS.filter(
          (l) => l.category === "reference" && matchesFilter(l)
        ),
      },
    ];

    return groups.filter((g) => g.layers.length > 0);
  }, [layerFilter]);

  const toggleGroupVisibility = (group: LayerGroup) => {
    const allVisible = group.layers.every((l) => layers[l.key]);
    const newState = !allVisible;
    group.layers.forEach((l) => setLayer(l.key, newState));
  };

  const handleZoomToLayer = (layerKey: keyof LayerVisibility) => {
    if (projectData?.layers) {
      const geojson = (projectData.layers as any)[layerKey];
      if (geojson && geojson.features && geojson.features.length > 0) {
        // Calculate rough bbox from features
        let minLat = Infinity,
          maxLat = -Infinity,
          minLng = Infinity,
          maxLng = -Infinity;

        const scanCoords = (coords: any) => {
          if (typeof coords[0] === "number" && typeof coords[1] === "number") {
            const lng = coords[0];
            const lat = coords[1];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
          } else if (Array.isArray(coords)) {
            coords.forEach(scanCoords);
          }
        };

        geojson.features.forEach((f: any) => {
          if (f.geometry?.coordinates) {
            scanCoords(f.geometry.coordinates);
          }
        });

        if (minLat !== Infinity && maxLat !== -Infinity) {
          setTargetFlyToBounds([
            [minLat, minLng],
            [maxLat, maxLng],
          ]);
        }
      }
    }
  };

  return (
    <div className="absolute top-0 left-0 bottom-0 z-20 flex pointer-events-none select-none">
      {/* 1. Far Left Vertical Ribbon */}
      <div className="w-12 h-full bg-white border-r border-slate-200 flex flex-col items-center py-3 gap-2 pointer-events-auto shrink-0 z-20 shadow-xs">
        {/* Layer Explorer */}
        <button
          onClick={() => {
            setActiveLeftRibbon("layers");
            setIsLeftPanelCollapsed(false);
          }}
          title="Layer Tree Explorer"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            activeLeftRibbon === "layers" && !isLeftPanelCollapsed
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Base Maps */}
        <button
          onClick={() => {
            setActiveLeftRibbon("basemaps");
            setIsLeftPanelCollapsed(false);
          }}
          title="Basemap Gallery"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            activeLeftRibbon === "basemaps" && !isLeftPanelCollapsed
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Map className="w-4 h-4" />
        </button>

        {/* Measurement Tools */}
        <button
          onClick={() => {
            setActiveLeftRibbon("measurements");
            setIsLeftPanelCollapsed(false);
            if (measurementMode === "none") {
              setMeasurementMode("distance");
            }
          }}
          title="GIS Measurements (Distance & Area)"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            activeLeftRibbon === "measurements" && !isLeftPanelCollapsed
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Ruler className="w-4 h-4" />
        </button>

        {/* Schedule Modal */}
        <button
          onClick={() => setTableModalOpen(true)}
          title="Open Land Plan Schedule Table"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
        >
          <FileText className="w-4 h-4" />
        </button>

        {/* Export CSV Direct Link */}
        <a
          href={`/api/cadastral/export-table/${currentProjectId}`}
          download
          title="Download Schedule CSV"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:bg-slate-100 transition-colors mt-auto"
        >
          <Download className="w-4 h-4" />
        </a>
      </div>

      {/* 2. Expandable Panel */}
      {!isLeftPanelCollapsed && (
        <div className="w-72 sm:w-80 h-full bg-white border-r border-slate-200 flex flex-col pointer-events-auto text-slate-800 transition-all z-10 shadow-lg">
          {/* Header */}
          <div className="h-12 px-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              {activeLeftRibbon === "layers" && (
                <>
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-800">
                    GIS Layer Explorer
                  </span>
                </>
              )}
              {activeLeftRibbon === "basemaps" && (
                <>
                  <Map className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-800">
                    Basemap Gallery
                  </span>
                </>
              )}
              {activeLeftRibbon === "measurements" && (
                <>
                  <Ruler className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-800">
                    Measurement Tools
                  </span>
                </>
              )}
            </div>

            <button
              onClick={() => setIsLeftPanelCollapsed(true)}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              title="Collapse Panel"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* TAB: LAYERS */}
          {activeLeftRibbon === "layers" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Layer Search & Quick Toggles */}
              <div className="p-3 border-b border-slate-100 space-y-2 bg-white">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={layerFilter}
                    onChange={(e) => setLayerFilter(e.target.value)}
                    placeholder="Filter layers..."
                    className="w-full h-8 pl-8 pr-7 text-xs rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 outline-none"
                  />
                  {layerFilter && (
                    <button
                      onClick={() => setLayerFilter("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {Object.values(layers).filter(Boolean).length} of{" "}
                    {LAYER_DEFINITIONS.length} visible
                  </span>
                  <button
                    onClick={() => {
                      const allOn = Object.values(layers).every(Boolean);
                      LAYER_DEFINITIONS.forEach((l) => setLayer(l.key, !allOn));
                    }}
                    className="text-blue-600 hover:text-blue-700 font-semibold"
                  >
                    {Object.values(layers).every(Boolean) ? "Hide All" : "Show All"}
                  </button>
                </div>
              </div>

              {/* Layer Tree Groups */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {layerGroups.map((group) => {
                  const isExpanded = expandedGroups[group.id] !== false;
                  const allVisible = group.layers.every((l) => layers[l.key]);
                  const someVisible = group.layers.some((l) => layers[l.key]);

                  return (
                    <div
                      key={group.id}
                      className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs"
                    >
                      {/* Group Header */}
                      <div className="px-2.5 py-2 bg-slate-50 flex items-center justify-between border-b border-slate-100">
                        <div
                          onClick={() => toggleGroupExpand(group.id)}
                          className="flex items-center gap-1.5 cursor-pointer flex-1"
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                              isExpanded ? "" : "-rotate-90"
                            }`}
                          />
                          <span className="font-semibold text-xs text-slate-800">
                            {group.title}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 ml-1">
                            ({group.layers.length})
                          </span>
                        </div>

                        <button
                          onClick={() => toggleGroupVisibility(group)}
                          title={allVisible ? "Hide group" : "Show group"}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-200 transition-colors"
                        >
                          {allVisible ? (
                            <Eye className="w-3.5 h-3.5 text-blue-600" />
                          ) : someVisible ? (
                            <Eye className="w-3.5 h-3.5 text-amber-500" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Group Children Layers */}
                      {isExpanded && (
                        <div className="divide-y divide-slate-100">
                          {group.layers.map((layer) => {
                            const isVisible = layers[layer.key];
                            const opacity = layerOpacity[layer.key] ?? 1.0;
                            const isOpacityOpen = activeOpacityKey === layer.key;

                            return (
                              <div
                                key={layer.key}
                                className={`p-2 transition-colors ${
                                  isVisible ? "bg-white" : "bg-slate-50/50 opacity-60"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={isVisible}
                                      onChange={() => toggleLayer(layer.key)}
                                      className="w-3.5 h-3.5 rounded text-blue-600 border-slate-300 focus:ring-0 cursor-pointer"
                                    />
                                    {/* Layer Swatch */}
                                    <div className="shrink-0 flex items-center justify-center">
                                      {layer.type === "line" && (
                                        <div
                                          className="w-4 h-1 rounded-full"
                                          style={{ backgroundColor: layer.color }}
                                        />
                                      )}
                                      {layer.type === "polygon" && (
                                        <div
                                          className="w-3.5 h-3 rounded border"
                                          style={{
                                            borderColor: layer.color,
                                            backgroundColor: `${layer.color}33`,
                                          }}
                                        />
                                      )}
                                      {layer.type === "point" && (
                                        <div
                                          className="w-2.5 h-2.5 rounded-full"
                                          style={{ backgroundColor: layer.color }}
                                        />
                                      )}
                                    </div>
                                    <span className="text-xs font-medium text-slate-800 truncate">
                                      {layer.label}
                                    </span>
                                  </label>

                                  <div className="flex items-center gap-0.5 shrink-0">
                                    {/* Isolate layer */}
                                    <button
                                      onClick={() => isolateLayer(layer.key)}
                                      title="Isolate Layer (Hide all other layers)"
                                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100"
                                    >
                                      <Focus className="w-3 h-3" />
                                    </button>

                                    {/* Layer Info */}
                                    <button
                                      onClick={() => {
                                        const count =
                                          (projectData?.layers as any)?.[layer.key]?.features?.length ||
                                          (layer.key === "survey_plots"
                                            ? projectData?.survey_register?.length || 0
                                            : 0);
                                        setLayerInfoModal({
                                          key: layer.key,
                                          label: layer.label,
                                          category: layer.category,
                                          count,
                                          geometryType: layer.type,
                                          description:
                                            layer.description || "Project GIS Vector Layer",
                                        });
                                      }}
                                      title="Layer Information"
                                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100"
                                    >
                                      <Info className="w-3 h-3" />
                                    </button>

                                    {/* Opacity slider trigger */}
                                    <button
                                      onClick={() =>
                                        setActiveOpacityKey(
                                          isOpacityOpen ? null : layer.key
                                        )
                                      }
                                      title="Adjust opacity"
                                      className={`p-1 rounded hover:bg-slate-100 ${
                                        isOpacityOpen
                                          ? "text-blue-600 bg-blue-50"
                                          : "text-slate-400"
                                      }`}
                                    >
                                      <Sliders className="w-3 h-3" />
                                    </button>

                                    {/* Zoom to layer */}
                                    <button
                                      onClick={() => handleZoomToLayer(layer.key)}
                                      title="Zoom to layer extent"
                                      className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100"
                                    >
                                      <Maximize2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Opacity Slider Panel */}
                                {isOpacityOpen && (
                                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                                    <span>Opacity:</span>
                                    <input
                                      type="range"
                                      min="0.1"
                                      max="1.0"
                                      step="0.05"
                                      value={opacity}
                                      onChange={(e) =>
                                        setLayerOpacity(
                                          layer.key,
                                          parseFloat(e.target.value)
                                        )
                                      }
                                      className="w-24 accent-blue-600 cursor-pointer"
                                    />
                                    <span className="w-8 text-right font-bold text-slate-700">
                                      {Math.round(opacity * 100)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* APSAC Government Cadastral Overlay */}
                <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={apsacOverlay}
                        onChange={(e) => setApsacOverlay(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-blue-600 border-blue-300 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-bold text-xs text-blue-950">
                        APSAC Cadastral Overlay
                      </span>
                    </label>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800 font-mono">
                      AP GOVT API
                    </span>
                  </div>

                  <p className="text-[10px] text-slate-600 leading-tight">
                    Official revenue parcel boundaries from AP Space Applications Centre
                    MapServer.
                  </p>

                  {apsacOverlay && (
                    <div className="pt-1.5 border-t border-blue-100 flex items-center justify-between gap-2 text-[10px] text-slate-600 font-mono">
                      <span>Opacity:</span>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={apsacOpacity}
                        onChange={(e) =>
                          setApsacOpacity(parseFloat(e.target.value))
                        }
                        className="w-24 accent-blue-600 cursor-pointer"
                      />
                      <span className="w-8 text-right font-bold text-blue-700">
                        {Math.round(apsacOpacity * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: BASEMAPS */}
          {activeLeftRibbon === "basemaps" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Standard Basemap Providers
              </span>
              <div className="space-y-1.5">
                {[
                  {
                    id: "satellite",
                    label: "ESRI Satellite Imagery",
                    desc: "High-resolution orbital satellite photography",
                  },
                  {
                    id: "osm",
                    label: "OpenStreetMap",
                    desc: "Crowdsourced global road and civic basemap",
                  },
                  {
                    id: "imagery",
                    label: "Esri World Imagery",
                    desc: "World imagery with detailed ground resolution",
                  },
                  {
                    id: "carto",
                    label: "Carto Positron (Clean Light)",
                    desc: "Minimal high-contrast light cartography",
                  },
                  {
                    id: "apsac",
                    label: "APSAC Cadastral Base",
                    desc: "Official Andhra Pradesh government revenue base",
                  },
                ].map((bm) => (
                  <button
                    key={bm.id}
                    onClick={() => setBaseMap(bm.id as any)}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all flex items-start justify-between ${
                      baseMap === bm.id
                        ? "bg-blue-50 border-blue-300 text-blue-900 font-semibold"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{bm.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{bm.desc}</div>
                    </div>
                    {baseMap === bm.id && (
                      <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB: MEASUREMENTS */}
          {activeLeftRibbon === "measurements" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-none">
              {/* Header Title & Mode Toggle */}
              <div>
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  Spatial Measurement Studio
                </h4>
                <p className="text-slate-500 text-[11px] mt-0.5">
                  Measure linear alignments, canal sections, or parcel boundaries with geodesic precision.
                </p>
              </div>

              {/* Segmented Mode Switcher */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80">
                <button
                  onClick={() => setMeasurementMode("distance")}
                  className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 font-medium text-xs transition-all ${
                    measurementMode === "distance"
                      ? "bg-white text-blue-700 font-bold shadow-xs border border-slate-200/80"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Distance</span>
                </button>
                <button
                  onClick={() => setMeasurementMode("area")}
                  className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 font-medium text-xs transition-all ${
                    measurementMode === "area"
                      ? "bg-white text-emerald-700 font-bold shadow-xs border border-slate-200/80"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Area</span>
                </button>
              </div>

              {/* Live Metric Readout Card */}
              <div className="bg-gradient-to-br from-white to-slate-50/80 border border-slate-200/90 rounded-xl p-3.5 shadow-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
                  <span>{measurementMode === "area" ? "Enclosed Area" : "Path Length"}</span>
                  <span className="text-[10px] font-mono lowercase text-slate-400">
                    {measurePoints.length} {measurePoints.length === 1 ? "vertex" : "vertices"}
                  </span>
                </div>

                {measurementMode === "distance" ? (
                  <div>
                    <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                      {formatDistance(measureTotalDist)}
                    </div>
                    {measurePoints.length >= 2 && (
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Meters</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {Math.round(measureTotalDist).toLocaleString()} m
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Feet</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {(measureTotalDist * 3.28084).toFixed(1)} ft
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Kilometers</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {(measureTotalDist / 1000).toFixed(3)} km
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Yards</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {(measureTotalDist * 1.09361).toFixed(1)} yd
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="text-2xl font-bold font-mono text-emerald-900 tabular-nums">
                      {(measureAreaM2 * 0.000247105).toFixed(2)} ac
                    </div>
                    {measurePoints.length >= 3 && (
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
                        <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-200/60">
                          <div className="text-[10px] font-semibold text-emerald-600 uppercase">Cents</div>
                          <div className="font-mono font-bold text-emerald-900 text-xs tabular-nums">
                            {(measureAreaM2 * 0.000247105 * 100).toFixed(1)} cts
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Sq Meters</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {Math.round(measureAreaM2).toLocaleString()} m²
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Hectares</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {(measureAreaM2 / 10000).toFixed(3)} ha
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase">Acres & Cents</div>
                          <div className="font-mono font-bold text-slate-800 text-xs tabular-nums">
                            {Math.floor(measureAreaM2 * 0.000247105)} Ac {((measureAreaM2 * 0.000247105 - Math.floor(measureAreaM2 * 0.000247105)) * 100).toFixed(1)} Cts
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {measurePoints.length === 0 && (
                  <div className="mt-2 text-slate-400 text-[11px] italic">
                    Click anywhere on the map viewport to place starting point P1.
                  </div>
                )}
              </div>

              {/* Legs / Segments Table */}
              {measurePoints.length >= 2 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <span>Segment Breakdown</span>
                    <span className="text-[10px] text-slate-400 font-mono">{measurePoints.length - 1} legs</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-slate-200/80 p-1.5 bg-slate-50/50">
                    {measurePoints.slice(0, -1).map((pt, i) => {
                      const nextPt = measurePoints[i + 1];
                      const legDist = computeGeodesicDistance(pt.lat, pt.lng, nextPt.lat, nextPt.lng);
                      return (
                        <div
                          key={`leg-${i}`}
                          className="flex items-center justify-between px-2 py-1 rounded bg-white border border-slate-200/60 text-[11px] font-mono"
                        >
                          <span className="text-slate-600 font-semibold">
                            P{i + 1} → P{i + 2}
                          </span>
                          <span className="font-bold text-slate-900 tabular-nums">
                            {legDist < 1000 ? `${legDist.toFixed(1)} m` : `${(legDist / 1000).toFixed(2)} km`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions & Utilities Bar */}
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={undoMeasurePoint}
                    disabled={measurePoints.length === 0}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo Point</span>
                  </button>
                  <button
                    onClick={() => {
                      const textToCopy =
                        measurementMode === "distance"
                          ? `Measured Distance: ${formatDistance(measureTotalDist)} (${measurePoints.length} vertices)`
                          : `Measured Area: ${(measureAreaM2 * 0.000247105).toFixed(2)} acres (${Math.round(measureAreaM2).toLocaleString()} m², ${measurePoints.length} vertices)`;
                      navigator.clipboard.writeText(textToCopy);
                      setMeasureCopied(true);
                      setTimeout(() => setMeasureCopied(false), 2000);
                    }}
                    disabled={measurePoints.length === 0}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{measureCopied ? "Copied!" : "Copy Summary"}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={clearMeasurement}
                    disabled={measurePoints.length === 0}
                    className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-600 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All</span>
                  </button>
                  <button
                    onClick={() => setMeasurementMode("none")}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Finish</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Layer Information Modal Dialog */}
      {layerInfoModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-xs text-slate-900">
                  {layerInfoModal.label}
                </span>
              </div>
              <button
                onClick={() => setLayerInfoModal(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Layer Category:</span>
                  <span className="font-bold text-slate-900 uppercase">{layerInfoModal.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Geometry Primitive:</span>
                  <span className="font-bold text-blue-700 uppercase">{layerInfoModal.geometryType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Feature Count:</span>
                  <span className="font-bold text-slate-900">{layerInfoModal.count} features</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-sans">Coordinate System:</span>
                  <span className="font-bold text-slate-900">EPSG:4326 (WGS84)</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-600 font-sans leading-relaxed bg-white p-2 border border-slate-100 rounded">
                {layerInfoModal.description}
              </div>
            </div>

            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={() => {
                  isolateLayer(layerInfoModal.key as any);
                  setLayerInfoModal(null);
                }}
                className="px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white font-semibold text-xs transition-colors flex items-center gap-1"
              >
                <Focus className="w-3 h-3" />
                <span>Isolate This Layer</span>
              </button>
              <button
                onClick={() => setLayerInfoModal(null)}
                className="px-3 py-1 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen handle when collapsed */}
      {isLeftPanelCollapsed && (
        <button
          onClick={() => setIsLeftPanelCollapsed(false)}
          className="absolute top-3 left-14 bg-white text-slate-700 hover:text-blue-600 border border-slate-200 p-1.5 rounded-lg pointer-events-auto shadow-md transition-colors"
          title="Open Layer Control"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
