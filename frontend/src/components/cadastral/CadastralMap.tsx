"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCadastralStore, SurveyPlotRecord } from "@/stores/useCadastralStore";
import {
  Compass,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  Ruler,
  RotateCcw,
  X,
  Undo2,
  Copy,
  Layers,
  MapPin,
  Check,
  MousePointer,
  Hand,
  XCircle,
  Activity,
  Layers2,
  Tag,
  Crosshair,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  computeGeodesicDistance,
  formatDistance,
  calculatePolygonAreaM2,
  accumulateDistances,
} from "@/lib/gis/geodesy";

function shiftLatLng(lat: number, lon: number, dx: number, dy: number): [number, number] {
  if (dx === 0 && dy === 0) return [lat, lon];
  const latRad = (lat * Math.PI) / 180.0;
  const dLat = dy / 111320.0;
  const dLon = dx / (111320.0 * Math.max(0.01, Math.cos(latRad)));
  return [lat + dLat, lon + dLon];
}

function applyOffsetToGeoJSON(geojson: any, dx: number, dy: number) {
  if (!geojson || (dx === 0 && dy === 0)) return geojson;
  const clone = JSON.parse(JSON.stringify(geojson));
  const shiftPoint = (lon: number, lat: number, elev?: number): number[] => {
    const latRad = (lat * Math.PI) / 180.0;
    const dLat = dy / 111320.0;
    const dLon = dx / (111320.0 * Math.max(0.01, Math.cos(latRad)));
    return elev !== undefined ? [lon + dLon, lat + dLat, elev] : [lon + dLon, lat + dLat];
  };

  const shiftCoords = (coords: any): any => {
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      return shiftPoint(coords[0], coords[1], coords[2]);
    }
    return coords.map(shiftCoords);
  };

  if (clone.type === "FeatureCollection" && Array.isArray(clone.features)) {
    clone.features.forEach((feat: any) => {
      if (feat.geometry && feat.geometry.coordinates) {
        feat.geometry.coordinates = shiftCoords(feat.geometry.coordinates);
      }
    });
  } else if (clone.type === "Feature" && clone.geometry) {
    clone.geometry.coordinates = shiftCoords(clone.geometry.coordinates);
  } else if (clone.coordinates && typeof clone.type === "string") {
    clone.coordinates = shiftCoords(clone.coordinates);
  }
  return clone;
}

function parseChainageKm(val: any): number | null {
  if (!val) return null;
  const str = String(val).trim();
  const kmMatch = str.match(/KM\s*([\d.]+)/i);
  if (kmMatch) return parseFloat(kmMatch[1]);
  const chMatch = str.match(/(?:Ch\.?\s*)?(\d+)\+(\d+)/i);
  if (chMatch) {
    return parseFloat(chMatch[1]) + parseFloat(chMatch[2]) / 1000;
  }
  const num = parseFloat(str.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? null : num;
}

function parseChainageRange(rangeStr?: string): [number, number] | null {
  if (!rangeStr) return null;
  const parts = rangeStr.split("-");
  if (parts.length < 2) return null;
  const start = parseChainageKm(parts[0]);
  const end = parseChainageKm(parts[1]);
  if (start !== null && end !== null) {
    return [Math.min(start, end), Math.max(start, end)];
  }
  return null;
}

interface LatLngPoint {
  lat: number;
  lng: number;
}

export function CadastralMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseTileRef = useRef<L.TileLayer | null>(null);
  const apsacTileRef = useRef<L.TileLayer | null>(null);

  // GeoJSON Layer Refs
  const plotsLayerRef = useRef<L.GeoJSON | null>(null);
  const canalLayerRef = useRef<L.GeoJSON | null>(null);
  const bufferLayerRef = useRef<L.GeoJSON | null>(null);
  const roadsLayerRef = useRef<L.GeoJSON | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const chainagesLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const structuresLayerRef = useRef<L.GeoJSON | null>(null);
  const plotLabelsGroupRef = useRef<L.LayerGroup | null>(null);
  const highlightGroupRef = useRef<L.LayerGroup | null>(null);

  // Singleton Hover Card Ref (Guarantees zero ghost cards / zero tooltip leaks)
  const hoverTooltipRef = useRef<L.Tooltip | null>(null);

  // Measurement Layer Refs
  const measureLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const {
    projectData,
    currentProjectId,
    baseMap,
    setBaseMap,
    layers,
    layerOpacity,
    selectedPlot,
    setSelectedPlot,
    setHoveredPlot,
    clearSelection,
    targetFlyToBounds,
    setTargetFlyToBounds,
    apsacOverlay,
    apsacOpacity,
    measurementMode,
    setMeasurementMode,
    measurePoints,
    setMeasurePoints,
    measureTotalDist,
    setMeasureTotalDist,
    measureAreaM2,
    setMeasureAreaM2,
    undoMeasurePoint,
    clearMeasurement,
    mapTool,
    setMapTool,
    toggleLayer,
    highlightedIntersection,
    isLoading,
    isRightPanelOpen,
  } = useCadastralStore();

  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(14);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBasemapMenuOpen, setIsBasemapMenuOpen] = useState(false);
  const basemapMenuRef = useRef<HTMLDivElement>(null);

  // Vector Spatial Calibration State (Nudge vectors to align with satellite imagery)
  const [calibrationOffset, setCalibrationOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [isCalibrateOpen, setIsCalibrateOpen] = useState(false);
  const [calibrateStep, setCalibrateStep] = useState<number>(1);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const fittedProjectIdRef = useRef<string | null>(null);

  // Reset calibration and fitted-bounds tracker when switching projects
  useEffect(() => {
    setCalibrationOffset({ dx: 0, dy: 0 });
    fittedProjectIdRef.current = null;
  }, [projectData?.project_id, currentProjectId]);

// Measurement state is powered reactively by useCadastralStore
  const isDraggingMeasureRef = useRef(false);
  const measurementModeRef = useRef(measurementMode);
  measurementModeRef.current = measurementMode;
  const liveMeasurePointsRef = useRef<LatLngPoint[]>([]);
  liveMeasurePointsRef.current = measurePoints;

  // 1. Initialize Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const canvasRenderer = L.canvas({ padding: 0.5, tolerance: 5 });
    canvasRendererRef.current = canvasRenderer;

    const map = L.map(mapContainerRef.current, {
      preferCanvas: true,
      renderer: canvasRenderer,
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

    // Layer groups for chainages, plot labels and measurements
    chainagesLayerGroupRef.current = L.layerGroup().addTo(map);
    plotLabelsGroupRef.current = L.layerGroup().addTo(map);
    measureLayerGroupRef.current = L.layerGroup().addTo(map);
    highlightGroupRef.current = L.layerGroup().addTo(map);

    // Singleton Hover Card Tooltip (Single instance prevents duplicate/stuck DOM elements)
    const hoverTooltip = L.tooltip({
      direction: "top",
      offset: L.point(0, -18),
      opacity: 1,
      className: "cadastral-hover-card",
    });
    hoverTooltipRef.current = hoverTooltip;

    const closeHoverCard = () => {
      if (hoverTooltipRef.current && map.hasLayer(hoverTooltipRef.current)) {
        map.closeTooltip(hoverTooltipRef.current);
      }
    };

    map.on("mouseout", closeHoverCard);
    map.on("dragstart", closeHoverCard);
    map.on("zoomstart", closeHoverCard);

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      setMouseCoords({
        lat: Math.round(e.latlng.lat * 1000000) / 1000000,
        lng: Math.round(e.latlng.lng * 1000000) / 1000000,
      });
    });

    map.on("zoomend", () => {
      setCurrentZoom(map.getZoom());
    });

    mapInstanceRef.current = map;

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Base Map Tile Layer
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
      // High-resolution Google Satellite imagery with native zoom up to 20 and smooth overzoom up to 22!
      tileUrl = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
      subdomains = ["0", "1", "2", "3"];
      maxNativeZoom = 20;
      maxZoom = 22;
    } else if (baseMap === "imagery") {
      // Esri World Imagery: native tiles up to 18, overzooms cleanly up to 22 without "Map data not yet available"!
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
    } else if (baseMap === "apsac") {
      tileUrl =
        "https://apsac.ap.gov.in/gisserver/rest/services/REVENUE/cadastral_ap_cache/MapServer/tile/{z}/{y}/{x}";
      maxNativeZoom = 20;
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

  // 2b. APSAC Government Cadastral Overlay Tile Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!apsacOverlay) {
      if (apsacTileRef.current) {
        map.removeLayer(apsacTileRef.current);
        apsacTileRef.current = null;
      }
      return;
    }

    if (!apsacTileRef.current) {
      const tile = L.tileLayer(
        "https://apsac.ap.gov.in/gisserver/rest/services/REVENUE/cadastral_ap_cache/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 22,
          maxNativeZoom: 20,
          opacity: apsacOpacity,
          zIndex: 350,
          errorTileUrl:
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        }
      ).addTo(map);
      apsacTileRef.current = tile;
    } else {
      apsacTileRef.current.setOpacity(apsacOpacity);
    }
  }, [apsacOverlay, apsacOpacity]);

  // 3. Render Static / GeoJSON Cadastral Layers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !projectData?.layers) return;

    // Clear previous layers & any open hover tooltip
    if (hoverTooltipRef.current && map.hasLayer(hoverTooltipRef.current)) {
      map.closeTooltip(hoverTooltipRef.current);
    }
    [
      plotsLayerRef,
      canalLayerRef,
      bufferLayerRef,
      roadsLayerRef,
      boundaryLayerRef,
      structuresLayerRef,
    ].forEach((ref) => {
      if (ref.current) {
        map.removeLayer(ref.current);
        ref.current = null;
      }
    });

    const canalOp = layerOpacity.canal_alignment ?? 1.0;
    const bufferOp = layerOpacity.canal_buffer ?? 0.35;
    const plotsOp = layerOpacity.survey_plots ?? 0.3;
    const roadsOp = layerOpacity.roads ?? 0.9;
    const boundaryOp = layerOpacity.village_boundary ?? 1.0;

    const dx = calibrationOffset.dx;
    const dy = calibrationOffset.dy;

    // 3a. Village Boundary
    if (layers.village_boundary && projectData.layers.village_boundary) {
      const shiftedBoundary = applyOffsetToGeoJSON(projectData.layers.village_boundary, dx, dy);
      boundaryLayerRef.current = L.geoJSON(shiftedBoundary, {
        style: {
          color: "#9333ea",
          weight: 2.5,
          dashArray: "8, 6",
          fill: false,
          opacity: boundaryOp,
        },
      }).addTo(map);
    }

    // 3b. Roads & Cart Tracks
    if (layers.roads && projectData.layers.roads) {
      const shiftedRoads = applyOffsetToGeoJSON(projectData.layers.roads, dx, dy);
      roadsLayerRef.current = L.geoJSON(shiftedRoads, {
        style: {
          color: "#dc2626",
          weight: 2.2,
          opacity: roadsOp,
        },
      }).addTo(map);
    }

    // 3c. Canal Buffer (Proposed Corridor Right-of-Way)
    if (layers.canal_buffer && projectData.layers.canal_buffer) {
      const shiftedBuffer = applyOffsetToGeoJSON(projectData.layers.canal_buffer, dx, dy);
      bufferLayerRef.current = L.geoJSON(shiftedBuffer, {
        style: {
          color: "#0284c7",
          weight: 2,
          fillColor: "#38bdf8",
          fillOpacity: bufferOp,
        },
      }).addTo(map);
    }

    // 3d. Canal Alignment Centerline
    if (layers.canal_alignment && projectData.layers.canal_alignment) {
      const shiftedCanal = applyOffsetToGeoJSON(projectData.layers.canal_alignment, dx, dy);
      canalLayerRef.current = L.geoJSON(shiftedCanal, {
        style: {
          color: "#1d4ed8",
          weight: 3.5,
          opacity: canalOp,
        },
      }).addTo(map);
    }

    // 3e. Survey Plots Polygons
    if (layers.survey_plots && projectData.layers.survey_plots) {
      const shiftedPlots = applyOffsetToGeoJSON(projectData.layers.survey_plots, dx, dy);
      plotsLayerRef.current = L.geoJSON(shiftedPlots, {
        style: (feature) => {
          const isAffected = feature?.properties?.canal_passing;
          const isPoramboke = feature?.properties?.is_poramboke;

          if (isPoramboke) {
            return {
              color: isAffected ? "#d97706" : "#94a3b8",
              weight: isAffected ? 2.0 : 0.8,
              dashArray: isAffected ? "4, 3" : "2, 3",
              fillColor: isAffected ? "#10b981" : "#64748b",
              fillOpacity: isAffected ? Math.min(0.20, plotsOp * 0.5) : 0.015,
            };
          }

          return {
            color: isAffected ? "#0284c7" : "#3b82f6",
            weight: isAffected ? 1.8 : 1.2,
            fillColor: isAffected ? "#10b981" : "#f8fafc",
            fillOpacity: isAffected ? Math.min(0.16, plotsOp * 0.5) : 0.03,
          };
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          const isPoramboke = p.is_poramboke;
          const title = isPoramboke ? p.survey_no : `Sy. No. ${p.survey_no}`;

          let statusBadge = "";
          if (p.canal_passing) {
            statusBadge = `
              <span style="display:inline-flex;align-items:center;gap:3px;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:2px 7px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:0.02em;">
                <span style="width:5px;height:5px;border-radius:50%;background:#10b981;display:inline-block;"></span>
                Canal Intersected
              </span>
            `;
          } else if (isPoramboke) {
            statusBadge = `
              <span style="display:inline-flex;align-items:center;gap:3px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:2px 7px;border-radius:9999px;font-size:10px;font-weight:700;">
                Govt Corridor
              </span>
            `;
          } else {
            statusBadge = `
              <span style="display:inline-flex;align-items:center;gap:3px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:2px 7px;border-radius:9999px;font-size:10px;font-weight:600;">
                Ryotwari Patta
              </span>
            `;
          }

          const labelHtml = `
            <div style="min-width: 210px; max-width: 280px; padding: 2px;">
              <!-- Header Row -->
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <span style="font-weight: 800; font-size: 13px; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: -0.02em;">
                  ${title}
                </span>
                ${statusBadge}
              </div>

              <!-- Land Area Breakdown -->
              <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 6px; padding: 4px 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #f1f5f9; margin-bottom: 6px;">
                <span style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Total Extent</span>
                <div style="text-align: right;">
                  <span style="font-size: 12px; font-weight: 700; color: #0f172a; font-family: ui-monospace, monospace;">${p.total_acres} ac</span>
                  <span style="font-size: 10px; color: #94a3b8; font-family: ui-monospace, monospace; margin-left: 3px;">(${p.total_ac_cts || ""})</span>
                </div>
              </div>

              <!-- Acquisition Status -->
              ${
                p.canal_passing
                  ? `
                <div style="padding: 5px 8px; background: #ecfdf5; border-radius: 6px; border: 1px solid #a7f3d0; margin-bottom: 4px;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 10px; font-weight: 700; color: #047857; text-transform: uppercase; letter-spacing: 0.04em;">Acquired Right-of-Way</span>
                    <span style="font-size: 11px; font-weight: 800; color: #065f46; font-family: ui-monospace, monospace;">
                      ${p.acquired_acres} ac <span style="font-size: 9px; opacity: 0.85;">(${Math.round((p.acquired_acres / p.total_acres) * 100)}%)</span>
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 3px; font-size: 10px; color: #059669; font-family: ui-monospace, monospace;">
                    <span>Balance Retained:</span>
                    <span style="font-weight: 700;">${p.balance_acres || (p.total_acres - p.acquired_acres).toFixed(2)} ac</span>
                  </div>
                </div>
              `
                  : `
                <div style="font-size: 10px; color: #64748b; font-weight: 500; display: flex; align-items: center; gap: 4px; padding: 2px 4px;">
                  <span style="width: 5px; height: 5px; border-radius: 50%; background: #94a3b8; display: inline-block;"></span>
                  <span>Unaffected Parcel (Zero Canal Encroachment)</span>
                </div>
              `
              }

              <!-- Pattadar / Legal Owner if available -->
              ${
                p.pattadar_name
                  ? `
                <div style="margin-top: 5px; padding-top: 5px; border-top: 1px solid #f1f5f9; font-size: 10px; color: #334155; display: flex; align-items: center; justify-content: space-between;">
                  <span style="color: #64748b;">👤 Owner:</span>
                  <span style="font-weight: 700; color: #0f172a;">${p.pattadar_name}</span>
                </div>
              `
                  : ""
              }
            </div>
          `;

          const polyLayer = layer as L.Path;

          layer.on({
            mouseover: (e: L.LeafletMouseEvent) => {
              if (measurementModeRef.current !== "none") return;

              if (selectedPlot?.survey_no !== p.survey_no) {
                polyLayer.setStyle({
                  weight: 3,
                  color: "#1d4ed8",
                  fillOpacity: Math.min(0.85, (p.canal_passing ? plotsOp : 0.05) + 0.25),
                });
              }

              // Update & open the singleton hover card at cursor position
              if (hoverTooltipRef.current && mapInstanceRef.current) {
                hoverTooltipRef.current
                  .setLatLng(e.latlng)
                  .setContent(labelHtml);
                if (!mapInstanceRef.current.hasLayer(hoverTooltipRef.current)) {
                  mapInstanceRef.current.openTooltip(hoverTooltipRef.current);
                }
              }

              const match = projectData.survey_register.find(
                (item) => item.survey_no === p.survey_no
              );
              if (match) {
                setHoveredPlot(match);
              }
            },
            mousemove: (e: L.LeafletMouseEvent) => {
              if (measurementModeRef.current !== "none") return;
              if (hoverTooltipRef.current && mapInstanceRef.current?.hasLayer(hoverTooltipRef.current)) {
                hoverTooltipRef.current.setLatLng(e.latlng);
              }
            },
            mouseout: () => {
              if (selectedPlot?.survey_no !== p.survey_no) {
                plotsLayerRef.current?.resetStyle(polyLayer);
              }
              if (hoverTooltipRef.current && mapInstanceRef.current?.hasLayer(hoverTooltipRef.current)) {
                mapInstanceRef.current.closeTooltip(hoverTooltipRef.current);
              }
              setHoveredPlot(null);
            },
            click: (e: any) => {
              if (hoverTooltipRef.current && mapInstanceRef.current?.hasLayer(hoverTooltipRef.current)) {
                mapInstanceRef.current.closeTooltip(hoverTooltipRef.current);
              }
              if (measurementModeRef.current !== "none") {
                if (isDraggingMeasureRef.current) return;
                const newPt: LatLngPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
                setMeasurePoints((prev) => [...prev, newPt]);
                return;
              }
              const match = projectData.survey_register.find(
                (item) => item.survey_no === p.survey_no
              );
              if (match) {
                if (selectedPlot?.survey_no === match.survey_no) {
                  clearSelection();
                } else {
                  setSelectedPlot(match);
                }
              }
            },
          });
        },
      }).addTo(map);
    }

    // 3f. Structures
    if (layers.structures && projectData.layers.structures) {
      const shiftedStructures = applyOffsetToGeoJSON(projectData.layers.structures, dx, dy);
      structuresLayerRef.current = L.geoJSON(shiftedStructures, {
        pointToLayer: (feature, latlng) => {
          const icon = L.divIcon({
            className: "structure-icon",
            html: `<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid #1e293b;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          const marker = L.marker(latlng, { icon });
          marker.bindTooltip(`<b>Structure:</b> ${feature.properties.title}`, {
            direction: "top",
          });
          return marker;
        },
      }).addTo(map);
    }

    // Fit initial bounds if available (only once per project to prevent viewport resets on layer toggles/opacity changes)
    const projId = projectData.project_id || currentProjectId;
    if (plotsLayerRef.current && plotsLayerRef.current.getLayers().length > 0) {
      const bounds = plotsLayerRef.current.getBounds();
      if (bounds.isValid() && !targetFlyToBounds && !selectedPlot && fittedProjectIdRef.current !== projId) {
        fittedProjectIdRef.current = projId;
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectData,
    layers,
    layerOpacity,
    setSelectedPlot,
    setHoveredPlot,
    setMeasurePoints,
    calibrationOffset,
  ]);

  // 4. ZOOM-DEPENDENT & COLLISION-AWARE CHAINAGE LABELS + PLOT CENTROID LABELS
  useEffect(() => {
    const map = mapInstanceRef.current;
    const chainageGroup = chainagesLayerGroupRef.current;
    const plotLabelsGroup = plotLabelsGroupRef.current;
    if (!map || !chainageGroup || !plotLabelsGroup) return;

    chainageGroup.clearLayers();
    plotLabelsGroup.clearLayers();

    if (!projectData) return;

    // A. Render Smart Decluttered Chainage Markers
    if (layers.chainage_markers && projectData.layers?.chainage_markers?.features) {
      const allFeatures = projectData.layers.chainage_markers.features;
      const totalCount = allFeatures.length;

      // Determine step interval based on currentZoom to prevent overlapping along canal
      let step = 1;
      if (currentZoom < 14) {
        step = Math.max(10, Math.floor(totalCount / 5)); // Major ~1km milestones only
      } else if (currentZoom === 14) {
        step = 6; // ~500m intervals at overview zoom
      } else if (currentZoom === 15) {
        step = 3; // ~250m intervals
      } else {
        step = 1; // High zoom: all markers
      }

      const priorityRange = parseChainageRange(selectedPlot?.chainage_range);
      const placedChainageBoxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const mapBounds = map.getBounds();

      // Sort so priority chainages for the selected parcel are evaluated first
      const sortedFeatures = [...allFeatures].sort((a: any, b: any) => {
        const aKm = parseChainageKm(a.properties?.chainage || a.properties?.title || a.properties?.label);
        const bKm = parseChainageKm(b.properties?.chainage || b.properties?.title || b.properties?.label);
        const aPri = Boolean(priorityRange && aKm !== null && aKm >= priorityRange[0] - 0.04 && aKm <= priorityRange[1] + 0.04);
        const bPri = Boolean(priorityRange && bKm !== null && bKm >= priorityRange[0] - 0.04 && bKm <= priorityRange[1] + 0.04);
        if (aPri && !bPri) return -1;
        if (!aPri && bPri) return 1;
        return 0;
      });

      sortedFeatures.forEach((feat: any, idx: number) => {
        const rawTitle = feat.properties?.title || feat.properties?.chainage || feat.properties?.label || "Ch.";
        const featKm = parseChainageKm(
          feat.properties?.chainage || feat.properties?.title || feat.properties?.label
        );
        const isPriorityPlotChainage = Boolean(
          priorityRange &&
            featKm !== null &&
            featKm >= priorityRange[0] - 0.04 &&
            featKm <= priorityRange[1] + 0.04
        );

        // If not matching interval and not part of selected plot, skip to declutter!
        if (idx % step !== 0 && !isPriorityPlotChainage) {
          return;
        }

        const coords = feat.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const [shiftLat, shiftLon] = shiftLatLng(coords[1], coords[0], calibrationOffset.dx, calibrationOffset.dy);
        const latlng: L.LatLng = L.latLng(shiftLat, shiftLon);
        if (!mapBounds.contains(latlng)) return;

        // Screen-space collision detection for chainage markers to prevent any overlap along curves
        const pt = map.latLngToContainerPoint(latlng);
        const badgeW = 76;
        const badgeH = 36;
        const pad = 6;
        const box = {
          x1: pt.x - badgeW / 2 - pad,
          y1: pt.y - badgeH - pad,
          x2: pt.x + badgeW / 2 + pad,
          y2: pt.y + pad,
        };

        if (!isPriorityPlotChainage) {
          const collides = placedChainageBoxes.some((b) => {
            return !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2);
          });
          if (collides) {
            return; // Skip overlapping chainage marker!
          }
        }
        placedChainageBoxes.push(box);

        const isHighlight = isPriorityPlotChainage;

        // Clean & formatted station text (e.g. "219+400")
        let stationDisplay = rawTitle.replace(/^Ch\.?\s*/i, "").replace(/^KM\s*/i, "");
        if (!stationDisplay.includes("+") && featKm !== null) {
          const kmInt = Math.floor(featKm);
          const mInt = Math.round((featKm - kmInt) * 1000);
          stationDisplay = `${kmInt}+${mInt.toString().padStart(3, "0")}`;
        }

        // Clean, detailed station pin with precision anchor dot + offset leader line + floating badge
        const iconHtml = `
          <div style="position:relative;display:flex;flex-direction:column;align-items:center;pointer-events:auto;user-select:none;">
            <!-- Floating Clean Engineering Badge -->
            <div style="
              display:inline-flex;
              align-items:center;
              gap:4px;
              background:${isHighlight ? "linear-gradient(135deg, #1d4ed8, #2563eb)" : "rgba(15, 23, 42, 0.92)"};
              color:#ffffff;
              border:1.5px solid ${isHighlight ? "#93c5fd" : "rgba(255, 255, 255, 0.35)"};
              padding:2.5px 7px;
              border-radius:6px;
              box-shadow:0 4px 12px rgba(0,0,0,0.3);
              white-space:nowrap;
              font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              backdrop-filter:blur(6px);
            ">
              <span style="
                font-size:8px;
                font-weight:800;
                background:${isHighlight ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.15)"};
                color:#ffffff;
                padding:1px 3.5px;
                border-radius:3px;
                letter-spacing:0.5px;
              ">CH</span>
              <span style="font-size:11px;font-weight:700;letter-spacing:-0.2px;">${stationDisplay}</span>
            </div>

            <!-- Vertical Leader Line pointing down to canal centerline -->
            <div style="
              width:2px;
              height:12px;
              background:${isHighlight ? "#2563eb" : "rgba(15, 23, 42, 0.85)"};
              box-shadow:0 0 2px rgba(0,0,0,0.3);
            "></div>

            <!-- Centerline Precision Station Anchor Dot -->
            <div style="
              width:7px;
              height:7px;
              border-radius:50%;
              background:${isHighlight ? "#38bdf8" : "#3b82f6"};
              border:2px solid #ffffff;
              box-shadow:0 0 4px rgba(0,0,0,0.5);
              margin-top:-1px;
            "></div>
          </div>
        `;

        const icon = L.divIcon({
          className: "clean-chainage-station",
          html: iconHtml,
          iconSize: [80, 42],
          iconAnchor: [40, 41], // Anchor exactly at the bottom center station dot!
        });

        const marker = L.marker(latlng, { icon, zIndexOffset: isHighlight ? 950 : 250 });
        marker.bindTooltip(
          `<b>Station:</b> Ch. ${stationDisplay}<br/>` +
          `<b>Chainage Distance:</b> ${featKm !== null ? featKm.toFixed(3) + " km" : rawTitle}<br/>` +
          `<b>Coordinates:</b> ${latlng.lat.toFixed(6)}° N, ${latlng.lng.toFixed(6)}° E` +
          (isHighlight ? `<br/><b style="color:#0284c7;">Intersects Selected Parcel ${selectedPlot?.survey_no}</b>` : ""),
          { direction: "top", offset: [0, -42] }
        );
        chainageGroup.addLayer(marker);
      });
    }

    // B. Render Smart, Decluttered Survey Plot Centroid Labels
    // At low zoom (< 15): ONLY render the selected plot's callout badge!
    // At zoom >= 15: Use screen-space collision avoidance so labels NEVER overlap or obscure the map!
    if (layers.survey_plots && layers.plot_boundaries !== false && projectData.survey_register) {
      // Sort candidates by priority:
      // Priority 1: Currently selected plot (always placed first!)
      // Priority 2: Canal-affected parcels (canal_passing)
      // Priority 3: Large parcels
      const sortedPlots = [...projectData.survey_register].sort((a, b) => {
        if (a.survey_no === selectedPlot?.survey_no) return -1;
        if (b.survey_no === selectedPlot?.survey_no) return 1;
        if (a.canal_passing && !b.canal_passing) return -1;
        if (!a.canal_passing && b.canal_passing) return 1;
        return (b.total_acres || 0) - (a.total_acres || 0);
      });

      const placedBoxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const mapBounds = map.getBounds();

      sortedPlots.forEach((p) => {
        if (!p.center) return;
        const [shiftLat, shiftLon] = shiftLatLng(p.center[0], p.center[1], calibrationOffset.dx, calibrationOffset.dy);
        const latlng = L.latLng(shiftLat, shiftLon);
        if (!mapBounds.contains(latlng)) return;

        const isSelected = selectedPlot?.survey_no === p.survey_no;

        // Declutter rule: Poramboke & Road Corridors without canal acquisition should NOT render
        // floating centroid badges unless actively selected! Their vector outlines already show on the map.
        if (p.is_poramboke && !p.canal_passing && !isSelected) {
          return;
        }

        // At zoom < 15:
        // ONLY render the selected plot's badge.
        // All unselected plots are hidden, leaving the satellite map, canal alignment,
        // and boundary vectors 100% visible and uncluttered!
        if (currentZoom < 15 && !isSelected) {
          return;
        }

        // At zoom 15:
        // Only show canal-affected plots and selected plot, with collision avoidance
        if (currentZoom === 15 && !isSelected && !p.canal_passing) {
          return;
        }

        // Convert latlng to container pixel coordinates for collision detection
        const pt = map.latLngToContainerPoint(latlng);

        let width = 44;
        let height = 18;
        if (isSelected) {
          width = 85;
          height = 36;
        } else if (currentZoom >= 17) {
          width = 62;
          height = 28;
        }

        const buffer = 10; // 10px collision buffer to prevent touching
        const box = {
          x1: pt.x - width / 2 - buffer,
          y1: pt.y - height / 2 - buffer,
          x2: pt.x + width / 2 + buffer,
          y2: pt.y + height / 2 + buffer,
        };

        // If not the selected plot, skip if it collides with ANY already placed label
        if (!isSelected) {
          const collides = placedBoxes.some((b) => {
            return !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2);
          });
          if (collides) {
            return; // Skip overlapping label!
          }
        }

        placedBoxes.push(box);

        let labelHtml = "";
        let iconSize: [number, number] = [width, height];
        let iconAnchor: [number, number] = [width / 2, height / 2];

        if (isSelected) {
          labelHtml = `
            <div style="
              display:inline-flex;
              align-items:center;
              gap:5px;
              background:#fef3c7;
              color:#92400e;
              border:2px solid #f59e0b;
              border-radius:9999px;
              padding:3px 10px;
              box-shadow:0 4px 14px rgba(245, 158, 11, 0.35);
              cursor:pointer;
              white-space:nowrap;
              user-select:none;
              font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-weight:800;
              font-size:12px;
            ">
              <span style="width:7px;height:7px;border-radius:50%;background:#d97706;display:inline-block;"></span>
              <span>${/^\d+/.test(p.survey_no) ? `Sy. ${p.survey_no}` : p.survey_no}</span>
              ${p.canal_passing ? `<span style="font-size:10px;font-weight:700;color:#b45309;margin-left:2px;">• ${p.acquired_acres} ac acq</span>` : ""}
            </div>
          `;
          iconSize = [96, 26];
          iconAnchor = [48, 13];
        } else if (currentZoom < 17) {
          // Subtle cadastral number with crisp white outline - NO heavy card, NO shadow blocking the map!
          labelHtml = `
            <div style="
              cursor:pointer;
              user-select:none;
              white-space:nowrap;
              font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-weight:800;
              font-size:11px;
              color:#0f172a;
              text-shadow:
                -1.5px -1.5px 0 #ffffff,
                 1.5px -1.5px 0 #ffffff,
                -1.5px  1.5px 0 #ffffff,
                 1.5px  1.5px 0 #ffffff,
                 0 0 3px #ffffff,
                 0 0 5px #ffffff;
              display:flex;
              align-items:center;
              justify-content:center;
              line-height:1;
            ">
              ${p.canal_passing ? '<span style="width:5px;height:5px;border-radius:50%;background:#059669;margin-right:3px;box-shadow:0 0 2px #fff;"></span>' : ""}
              <span>${p.survey_no}</span>
            </div>
          `;
          iconSize = [44, 18];
          iconAnchor = [22, 9];
        } else {
          // High zoom (>= 17): Crisp, non-redundant cadastral badge pill
          labelHtml = `
            <div style="
              display:inline-flex;
              align-items:center;
              gap:4px;
              background:rgba(255, 255, 255, 0.96);
              color:#0f172a;
              border:1px solid ${p.canal_passing ? "#10b981" : "#cbd5e1"};
              border-radius:9999px;
              padding:2px 8px;
              box-shadow:0 2px 8px rgba(15, 23, 42, 0.12);
              cursor:pointer;
              white-space:nowrap;
              user-select:none;
              font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-weight:700;
              font-size:11px;
              line-height:1.2;
            ">
              ${p.canal_passing ? '<span style="width:5px;height:5px;border-radius:50%;background:#059669;display:inline-block;box-shadow:0 0 4px rgba(5,150,105,0.4);"></span>' : ""}
              <span>${/^\d+/.test(p.survey_no) ? `Sy. ${p.survey_no}` : p.survey_no}</span>
              ${p.canal_passing ? `<span style="font-size:9px;font-weight:700;color:#0284c7;font-family:-apple-system, sans-serif;margin-left:1px;">• ${p.acquired_acres} ac</span>` : ""}
            </div>
          `;
          iconSize = [74, 22];
          iconAnchor = [37, 11];
        }

        const icon = L.divIcon({
          className: "clean-plot-centroid-badge",
          html: labelHtml,
          iconSize,
          iconAnchor,
        });

        const marker = L.marker(latlng, {
          icon,
          zIndexOffset: isSelected ? 950 : 100,
        });

        marker.on("click", (e: any) => {
          L.DomEvent.stopPropagation(e);
          if (measurementModeRef.current !== "none") {
            if (isDraggingMeasureRef.current) return;
            const newPt: LatLngPoint = { lat: latlng.lat, lng: latlng.lng };
            setMeasurePoints((prev) => [...prev, newPt]);
            return;
          }
          setSelectedPlot(p);
        });

        plotLabelsGroup.addLayer(marker);
      });
    }
  }, [
    projectData,
    layers.chainage_markers,
    layers.survey_plots,
    layers.plot_boundaries,
    currentZoom,
    selectedPlot,
    setSelectedPlot,
    setMeasurePoints,
    calibrationOffset,
  ]);

  // 5. Smooth Fly to bounds
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !targetFlyToBounds) return;

    try {
      map.flyToBounds(targetFlyToBounds, {
        padding: [80, 80],
        maxZoom: 17,
        duration: 1.0,
      });
      setTargetFlyToBounds(null);
    } catch (e) {
      console.warn("Failed to fly to bounds:", e);
    }
  }, [targetFlyToBounds, setTargetFlyToBounds]);

  // 5b. Highlight Selected Plot Intersections (Canal Alignment Centerline, Buffer RoW, Roads)
  useEffect(() => {
    const group = highlightGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!selectedPlot || !projectData?.layers) return;

    const dx = calibrationOffset.dx;
    const dy = calibrationOffset.dy;

    // Highlight selected plot boundary with golden amber glowing border
    if (layers.survey_plots && projectData.layers?.survey_plots?.features) {
      const feat = projectData.layers.survey_plots.features.find(
        (f: any) => String(f.properties?.survey_no) === String(selectedPlot.survey_no)
      );
      if (feat) {
        const shiftedFeat = applyOffsetToGeoJSON(feat, dx, dy);
        const plotHighlight = L.geoJSON(shiftedFeat, {
          style: {
            color: "#f59e0b",
            weight: 3.5,
            fillColor: selectedPlot.canal_passing ? "#10b981" : "#3b82f6",
            fillOpacity: Math.min(0.40, (layerOpacity.survey_plots ?? 0.3) + 0.1),
          },
        });
        group.addLayer(plotHighlight);
      }
    }

    // Highlight canal alignment centerline
    if (
      selectedPlot.canal_passing &&
      layers.canal_alignment &&
      projectData.layers.canal_alignment &&
      (!highlightedIntersection || highlightedIntersection === "canal_alignment")
    ) {
      const shiftedCanal = applyOffsetToGeoJSON(projectData.layers.canal_alignment, dx, dy);
      const canalHighlight = L.geoJSON(shiftedCanal, {
        style: {
          color: "#06b6d4",
          weight: 5.5,
          opacity: 0.95,
          dashArray: highlightedIntersection === "canal_alignment" ? "8, 4" : undefined,
        },
      });
      group.addLayer(canalHighlight);
    }

    // Highlight canal buffer corridor if selected
    if (
      selectedPlot.canal_passing &&
      layers.canal_buffer &&
      projectData.layers.canal_buffer &&
      highlightedIntersection === "canal_buffer"
    ) {
      const shiftedBuffer = applyOffsetToGeoJSON(projectData.layers.canal_buffer, dx, dy);
      const bufferHighlight = L.geoJSON(shiftedBuffer, {
        style: {
          color: "#0284c7",
          weight: 3.5,
          fillColor: "#38bdf8",
          fillOpacity: 0.5,
          dashArray: "6, 4",
        },
      });
      group.addLayer(bufferHighlight);
    }

    // Highlight roads if targeted
    if (
      layers.roads &&
      projectData.layers.roads &&
      highlightedIntersection === "roads"
    ) {
      const shiftedRoads = applyOffsetToGeoJSON(projectData.layers.roads, dx, dy);
      const roadsHighlight = L.geoJSON(shiftedRoads, {
        style: {
          color: "#f59e0b",
          weight: 4.5,
          opacity: 0.95,
        },
      });
      group.addLayer(roadsHighlight);
    }
  }, [
    selectedPlot,
    highlightedIntersection,
    projectData,
    layers.survey_plots,
    layers.canal_alignment,
    layers.canal_buffer,
    layers.roads,
    layerOpacity.survey_plots,
    calibrationOffset,
  ]);

  // 5c. Map Cursor Style by Active Tool
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (measurementMode !== "none") {
      container.style.cursor = "crosshair";
    } else if (mapTool === "pan") {
      container.style.cursor = "grab";
    } else {
      container.style.cursor = "default";
    }
  }, [mapTool, measurementMode]);

  // 6. Interactive Measurement Handling
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (measurementMode === "none") {
      return;
    }

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (isDraggingMeasureRef.current) return;
      const newPt: LatLngPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      setMeasurePoints((prev) => [...prev, newPt]);
    };

    map.on("click", handleMapClick);

    return () => {
      map.off("click", handleMapClick);
    };
  }, [measurementMode, setMeasurePoints]);

  // Render Measurement Visuals with luxury CAD/GIS feedback
  useEffect(() => {
    const group = measureLayerGroupRef.current;
    if (!group) return;

    // If currently dragging, DO NOT destroy and recreate layers!
    if (isDraggingMeasureRef.current) return;

    group.clearLayers();
    if (measurePoints.length === 0 || measurementMode === "none") return;

    const latlngs = measurePoints.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    const isArea = measurementMode === "area";
    const primaryColor = isArea ? "#059669" : "#2563eb";

    let activeCasing: L.Polyline | null = null;
    let activeLine: L.Polyline | null = null;
    let activePoly: L.Polygon | null = null;

    // Helper to update active vector line/poly coordinates during drag without tearing down DOM
    const updateGeometry = (points: LatLngPoint[]) => {
      const coords = points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      if (activeCasing) activeCasing.setLatLngs(coords);
      if (activeLine) activeLine.setLatLngs(coords);
      if (activePoly) activePoly.setLatLngs(coords);
    };

    // 1. Draw High-Contrast Polyline / Polygon
    if (measurePoints.length >= 2) {
      if (!isArea) {
        // Casing underneath for razor-sharp visibility over dark or bright terrain
        activeCasing = L.polyline(latlngs, {
          color: "#ffffff",
          weight: 5,
          opacity: 0.9,
          interactive: false,
        });
        group.addLayer(activeCasing);

        // Active dash line on top
        activeLine = L.polyline(latlngs, {
          color: primaryColor,
          weight: 3,
          dashArray: "6, 6",
          opacity: 1,
          interactive: false,
        });
        group.addLayer(activeLine);
      } else {
        activePoly = L.polygon(latlngs, {
          color: "#059669",
          weight: 2.5,
          fillColor: "#10b981",
          fillOpacity: 0.22,
          interactive: false,
        });
        group.addLayer(activePoly);
      }

      // 2. Interactive Midpoint Handles for Segment Adjustment
      const segmentPairs: { p1: LatLngPoint; p2: LatLngPoint; insertIdx: number }[] = [];
      for (let i = 0; i < measurePoints.length - 1; i++) {
        segmentPairs.push({ p1: measurePoints[i], p2: measurePoints[i + 1], insertIdx: i + 1 });
      }
      if (isArea && measurePoints.length >= 3) {
        segmentPairs.push({
          p1: measurePoints[measurePoints.length - 1],
          p2: measurePoints[0],
          insertIdx: measurePoints.length,
        });
      }

      segmentPairs.forEach(({ p1, p2, insertIdx }) => {
        const midLat = (p1.lat + p2.lat) / 2;
        const midLng = (p1.lng + p2.lng) / 2;
        const legMeters = computeGeodesicDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        const legLabel =
          legMeters >= 1000
            ? `${(legMeters / 1000).toFixed(2)} km`
            : `${legMeters.toFixed(1)} m`;

        // Clean small round circle handle instead of a heavy dark badge
        const midHtml = `
          <div style="
            width: 12px;
            height: 12px;
            border-radius: 9999px;
            background: #ffffff;
            border: 2px solid ${primaryColor};
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: grab;
            transform: translate(-50%, -50%);
            transition: transform 0.12s ease;
          ">
            <div style="width: 3px; height: 3px; border-radius: 9999px; background: ${primaryColor};"></div>
          </div>
        `;

        const midMarker = L.marker([midLat, midLng], {
          draggable: true,
          icon: L.divIcon({
            className: "gis-midpoint-handle",
            html: midHtml,
            iconSize: [0, 0],
          }),
        });

        midMarker.bindTooltip(`${legLabel} • Drag to adjust link`, {
          direction: "top",
          offset: [0, -8],
          opacity: 0.95,
        });

        let dragPoints: LatLngPoint[] = [];

        midMarker.on("dragstart", (e: any) => {
          L.DomEvent.stopPropagation(e);
          isDraggingMeasureRef.current = true;
          dragPoints = [...liveMeasurePointsRef.current];
          const pos = e.target.getLatLng();
          dragPoints.splice(insertIdx, 0, { lat: pos.lat, lng: pos.lng });
          updateGeometry(dragPoints);
        });

        midMarker.on("drag", (e: any) => {
          L.DomEvent.stopPropagation(e);
          const pos = e.target.getLatLng();
          if (dragPoints[insertIdx]) {
            dragPoints[insertIdx] = { lat: pos.lat, lng: pos.lng };
            updateGeometry(dragPoints);
          }
        });

        midMarker.on("dragend", (e: any) => {
          L.DomEvent.stopPropagation(e);
          const finalPoints = [...dragPoints];
          setTimeout(() => {
            isDraggingMeasureRef.current = false;
            setMeasurePoints(finalPoints);
          }, 30);
        });

        midMarker.on("click", (e: any) => {
          L.DomEvent.stopPropagation(e);
        });

        group.addLayer(midMarker);
      });

      // If area mode with >= 3 points, calculate polygon centroid badge
      if (isArea && measurePoints.length >= 3 && measureAreaM2 > 0) {
        let sumLat = 0;
        let sumLng = 0;
        measurePoints.forEach((p) => {
          sumLat += p.lat;
          sumLng += p.lng;
        });
        const cLat = sumLat / measurePoints.length;
        const cLng = sumLng / measurePoints.length;
        const acres = measureAreaM2 * 0.000247105;

        const centroidMarker = L.marker([cLat, cLng], {
          icon: L.divIcon({
            className: "gis-area-badge",
            html: `<div style="background: rgba(5, 150, 105, 0.95); backdrop-filter: blur(6px); color: #ffffff; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); border: 1.5px solid rgba(255,255,255,0.35); text-align: center; white-space: nowrap; transform: translate(-50%, -50%); pointer-events: none;"><div>${acres.toFixed(2)} ac</div><div style="font-size: 9px; opacity: 0.9; font-weight: 500;">${Math.round(measureAreaM2).toLocaleString()} m²</div></div>`,
            iconSize: [0, 0],
          }),
          interactive: false,
        });
        group.addLayer(centroidMarker);
      }
    }

    // 3. Draw Numbered Vertex Pins (Draggable for Link Adjustment)
    measurePoints.forEach((pt, idx) => {
      const isOrigin = idx === 0;
      const vertexNumber = idx + 1;
      const pinHtml = isOrigin
        ? `<div style="width: 22px; height: 22px; border-radius: 9999px; background: ${primaryColor}; border: 2.5px solid #ffffff; box-shadow: 0 3px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #ffffff; cursor: grab; transform: translate(-50%, -50%);">P1</div>`
        : `<div style="width: 20px; height: 20px; border-radius: 9999px; background: #ffffff; border: 2px solid ${primaryColor}; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #0f172a; cursor: grab; transform: translate(-50%, -50%);">${vertexNumber}</div>`;

      const marker = L.marker([pt.lat, pt.lng], {
        draggable: true,
        icon: L.divIcon({
          className: "gis-vertex-pin",
          html: pinHtml,
          iconSize: [0, 0],
        }),
      });

      marker.bindTooltip(`P${vertexNumber} • Drag to move`, {
        direction: "top",
        offset: [0, -12],
        opacity: 0.95,
      });

      let dragPoints: LatLngPoint[] = [];

      marker.on("dragstart", (e: any) => {
        L.DomEvent.stopPropagation(e);
        isDraggingMeasureRef.current = true;
        dragPoints = [...liveMeasurePointsRef.current];
      });

      marker.on("drag", (e: any) => {
        L.DomEvent.stopPropagation(e);
        const pos = e.target.getLatLng();
        if (dragPoints[idx]) {
          dragPoints[idx] = { lat: pos.lat, lng: pos.lng };
          updateGeometry(dragPoints);
        }
      });

      marker.on("dragend", (e: any) => {
        L.DomEvent.stopPropagation(e);
        const finalPoints = [...dragPoints];
        setTimeout(() => {
          isDraggingMeasureRef.current = false;
          setMeasurePoints(finalPoints);
        }, 30);
      });

      marker.on("click", (e: any) => {
        L.DomEvent.stopPropagation(e);
      });

      group.addLayer(marker);
    });
  }, [measurePoints, measurementMode, measureAreaM2, setMeasurePoints]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      mapContainerRef.current?.parentElement?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleFitFullExtent = () => {
    if (plotsLayerRef.current) {
      const bounds = plotsLayerRef.current.getBounds();
      if (bounds.isValid()) {
        mapInstanceRef.current?.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  };

  // Approximate Map Scale Calculation
  const mapScaleRatio = useMemo(() => {
    // 156543.03392 * cos(lat) / (2 ^ zoom)
    const lat = mouseCoords?.lat ?? 14.67;
    const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, currentZoom);
    const approxScale = Math.round(metersPerPixel * 96 * 39.37);
    return approxScale > 0 ? `1:${approxScale.toLocaleString()}` : "1:5,000";
  }, [currentZoom, mouseCoords]);

  const visibleLayersCount = useMemo(() => {
    return Object.values(layers).filter(Boolean).length;
  }, [layers]);

  const totalLayersCount = useMemo(() => {
    return Object.keys(layers).length;
  }, [layers]);

  // Close basemap menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target as Node)) {
        setIsBasemapMenuOpen(false);
      }
    }
    if (isBasemapMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isBasemapMenuOpen]);

  // Global Engineering Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (isCalibrateOpen) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCalibrationOffset((prev) => ({ ...prev, dy: prev.dy + calibrateStep }));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCalibrationOffset((prev) => ({ ...prev, dy: prev.dy - calibrateStep }));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCalibrationOffset((prev) => ({ ...prev, dx: prev.dx - calibrateStep }));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setCalibrationOffset((prev) => ({ ...prev, dx: prev.dx + calibrateStep }));
          return;
        }
      }

      switch (e.key.toLowerCase()) {
        case "v":
        case "s":
          setMapTool("select");
          setMeasurementMode("none");
          break;
        case "h":
        case "p":
          setMapTool("pan");
          setMeasurementMode("none");
          break;
        case "d":
          setMeasurementMode(measurementMode === "distance" ? "none" : "distance");
          break;
        case "a":
          setMeasurementMode(measurementMode === "area" ? "none" : "area");
          break;
        case "l":
          toggleLayer("plot_boundaries");
          break;
        case "c":
          setIsCalibrateOpen((prev) => !prev);
          break;
        case "e":
          handleFitFullExtent();
          break;
        case "b":
          setIsBasemapMenuOpen((prev) => !prev);
          break;
        case "f":
          handleToggleFullscreen();
          break;
        case "escape":
          if (isCalibrateOpen) {
            setIsCalibrateOpen(false);
          } else if (measurementMode !== "none") {
            setMeasurementMode("none");
          } else if (selectedPlot) {
            clearSelection();
          }
          break;
        case "+":
        case "=":
          mapInstanceRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          mapInstanceRef.current?.zoomOut();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isCalibrateOpen,
    calibrateStep,
    measurementMode,
    selectedPlot,
    clearSelection,
    setMapTool,
    setMeasurementMode,
    toggleLayer,
  ]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-100 select-none">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* GIS Map Engineering Toolbar - Attached to header in middle like an engineering command step */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
        <div className="bg-white/95 border-x border-b border-slate-200/90 rounded-b-xl shadow-md px-2.5 py-1 flex items-center gap-1 backdrop-blur-md text-xs">
          {/* Select Mode */}
          <button
            onClick={() => {
              setMapTool("select");
              setMeasurementMode("none");
            }}
            title="Select Parcel / Feature Mode (Key: V or S)"
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
              mapTool === "select" && measurementMode === "none"
                ? "bg-blue-600 text-white shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Select</span>
            <span className="hidden md:inline text-[9px] font-mono opacity-60">V</span>
          </button>

          {/* Pan Mode */}
          <button
            onClick={() => {
              setMapTool("pan");
              setMeasurementMode("none");
            }}
            title="Pan / Navigate Map (Key: H or P)"
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
              mapTool === "pan" && measurementMode === "none"
                ? "bg-blue-600 text-white shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Pan</span>
            <span className="hidden md:inline text-[9px] font-mono opacity-60">H</span>
          </button>

          <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

          {/* Distance Tool */}
          <button
            onClick={() => {
              setMeasurementMode(measurementMode === "distance" ? "none" : "distance");
            }}
            title="Measure Geodesic Distance along Canal / Road (Key: D)"
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
              measurementMode === "distance"
                ? "bg-blue-600 text-white shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Distance</span>
            <span className="hidden lg:inline text-[9px] font-mono opacity-60">D</span>
          </button>

          {/* Area Tool */}
          <button
            onClick={() => {
              setMeasurementMode(measurementMode === "area" ? "none" : "area");
            }}
            title="Measure Enclosed Polygon Area (Key: A)"
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
              measurementMode === "area"
                ? "bg-emerald-600 text-white shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Area</span>
            <span className="hidden lg:inline text-[9px] font-mono opacity-60">A</span>
          </button>

          {/* Toggle Labels */}
          <button
            onClick={() => toggleLayer("plot_boundaries")}
            title={layers.plot_boundaries !== false ? "Hide Survey Number Labels (Key: L)" : "Show Survey Number Labels (Key: L)"}
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer ${
              layers.plot_boundaries !== false
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Labels</span>
            <span className="hidden xl:inline text-[9px] font-mono opacity-60">L</span>
          </button>

          {/* Calibrate / Spatial Nudge Tool */}
          <button
            onClick={() => setIsCalibrateOpen((prev) => !prev)}
            title="Calibrate Vector Alignment with Satellite Ground Truth (Key: C)"
            className={`p-1.5 rounded-md transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer ${
              isCalibrateOpen || calibrationOffset.dx !== 0 || calibrationOffset.dy !== 0
                ? "bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Calibrate</span>
            <span className="hidden xl:inline text-[9px] font-mono opacity-60">C</span>
            {(calibrationOffset.dx !== 0 || calibrationOffset.dy !== 0) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse ml-0.5" />
            )}
          </button>

          <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

          {/* Active Parcel Selection ON/OFF Toggle */}
          {selectedPlot && (
            <div className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-medium">
              <span className="font-mono font-bold text-amber-900 truncate max-w-[150px]">
                {/^\d+/.test(selectedPlot.survey_no) ? `Sy. ${selectedPlot.survey_no}` : selectedPlot.survey_no}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                title={`Toggle Off ${selectedPlot.survey_no} Highlight (Key: Esc)`}
                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200/80 hover:bg-amber-300 text-amber-900 flex items-center gap-1 transition-colors cursor-pointer shrink-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                <span>ON</span>
                <X className="w-3 h-3 text-amber-700 ml-0.5" />
              </button>
            </div>
          )}

          {/* Fit Project Extents */}
          <button
            onClick={handleFitFullExtent}
            title="Fit Full Project Extents (Key: E)"
            className="p-1.5 rounded-md text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Maximize className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Extent</span>
            <span className="hidden xl:inline text-[9px] font-mono opacity-60">E</span>
          </button>
        </div>

        {/* Floating Spatial Alignment / Vector Nudge HUD */}
        {isCalibrateOpen && (
          <div className="mt-2 bg-white/95 border border-slate-200/90 rounded-2xl shadow-xl p-3.5 z-30 flex flex-col gap-3 w-[330px] text-slate-800 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 mx-auto select-none">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shadow-2xs">
                  <Crosshair className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 leading-none">Spatial Calibration</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100/80 text-amber-800 leading-none">
                      NUDGE
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-none">Align vectors with satellite features</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCalibrateOpen(false)}
                className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                title="Close Calibration (Key: C or Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Readout Metric Cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col">
                <span className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                  Δ East / West
                </span>
                <span className="font-mono text-xs font-bold mt-0.5">
                  {calibrationOffset.dx > 0 ? (
                    <span className="text-blue-600">+{calibrationOffset.dx} m E</span>
                  ) : calibrationOffset.dx < 0 ? (
                    <span className="text-blue-600">{calibrationOffset.dx} m W</span>
                  ) : (
                    <span className="text-slate-400">0.0 m</span>
                  )}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col">
                <span className="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
                  Δ North / South
                </span>
                <span className="font-mono text-xs font-bold mt-0.5">
                  {calibrationOffset.dy > 0 ? (
                    <span className="text-emerald-600">+{calibrationOffset.dy} m N</span>
                  ) : calibrationOffset.dy < 0 ? (
                    <span className="text-emerald-600">{calibrationOffset.dy} m S</span>
                  ) : (
                    <span className="text-slate-400">0.0 m</span>
                  )}
                </span>
              </div>
            </div>

            {/* Shift Status Pill */}
            <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-slate-100/70 text-[11px]">
              <span className="text-slate-500 font-medium text-[10px]">Net Displacement:</span>
              <span className={`font-mono text-[11px] font-bold ${Math.hypot(calibrationOffset.dx, calibrationOffset.dy) > 0 ? "text-amber-700" : "text-emerald-600"}`}>
                {Math.hypot(calibrationOffset.dx, calibrationOffset.dy) > 0 ? `±${Math.hypot(calibrationOffset.dx, calibrationOffset.dy).toFixed(1)} m shift` : "0.0 m (Aligned)"}
              </span>
            </div>

            {/* Step Size Selector */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                <span>Nudge Step Size</span>
                <span className="text-slate-400 font-normal lowercase">use ↑ ↓ ← → keys</span>
              </div>
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 rounded-lg">
                {[
                  { val: 1, label: "1m (Fine)" },
                  { val: 5, label: "5m (Std)" },
                  { val: 10, label: "10m (Fast)" },
                ].map((step) => (
                  <button
                    key={step.val}
                    type="button"
                    onClick={() => setCalibrateStep(step.val)}
                    className={`py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                      calibrateStep === step.val
                        ? "bg-white text-blue-700 font-bold shadow-xs border border-slate-200/60"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Symmetrical 3x3 D-Pad */}
            <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/70 flex flex-col items-center">
              <div className="grid grid-cols-3 gap-1.5 w-full max-w-[210px]">
                {/* Row 1: empty, North, empty */}
                <div />
                <button
                  type="button"
                  onClick={() => setCalibrationOffset((prev) => ({ ...prev, dy: prev.dy + calibrateStep }))}
                  className="h-8 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition cursor-pointer"
                  title={`Nudge North +${calibrateStep}m (Up Arrow)`}
                >
                  <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
                  <span>N</span>
                </button>
                <div />

                {/* Row 2: West, Reset (0,0), East */}
                <button
                  type="button"
                  onClick={() => setCalibrationOffset((prev) => ({ ...prev, dx: prev.dx - calibrateStep }))}
                  className="h-8 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition cursor-pointer"
                  title={`Nudge West -${calibrateStep}m (Left Arrow)`}
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-blue-600" />
                  <span>W</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCalibrationOffset({ dx: 0, dy: 0 })}
                  className="h-8 rounded-lg bg-slate-100 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 border border-slate-200 text-slate-600 font-mono text-[10px] font-bold flex items-center justify-center gap-1 active:scale-95 transition cursor-pointer"
                  title="Reset Alignment to (0, 0)"
                >
                  <RotateCcw className="w-3 h-3 text-slate-500" />
                  <span>0,0</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCalibrationOffset((prev) => ({ ...prev, dx: prev.dx + calibrateStep }))}
                  className="h-8 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition cursor-pointer"
                  title={`Nudge East +${calibrateStep}m (Right Arrow)`}
                >
                  <span>E</span>
                  <ChevronRight className="w-3.5 h-3.5 text-blue-600" />
                </button>

                {/* Row 3: empty, South, empty */}
                <div />
                <button
                  type="button"
                  onClick={() => setCalibrationOffset((prev) => ({ ...prev, dy: prev.dy - calibrateStep }))}
                  className="h-8 rounded-lg bg-white border border-slate-200 shadow-2xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 active:scale-95 transition cursor-pointer"
                  title={`Nudge South -${calibrateStep}m (Down Arrow)`}
                >
                  <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                  <span>S</span>
                </button>
                <div />
              </div>
            </div>

            {/* Presets & Quick Reset Footer */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => setCalibrationOffset({ dx: 0, dy: 10 })}
                className="text-[10px] text-slate-500 hover:text-blue-600 font-medium px-2 py-0.5 rounded bg-slate-100 hover:bg-blue-50 transition cursor-pointer"
                title="Common Andhra Pradesh revenue survey geodetic shift preset (+10m North)"
              >
                AP Cadastral (+10m N)
              </button>
              <button
                type="button"
                onClick={() => setCalibrationOffset({ dx: 0, dy: 0 })}
                disabled={calibrationOffset.dx === 0 && calibrationOffset.dy === 0}
                className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:hover:text-blue-600 transition cursor-pointer"
              >
                Zero Offset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top Right Floating Map Controls */}
      <div
        className={`absolute top-3.5 z-20 flex flex-col gap-2 pointer-events-auto transition-all duration-200 select-none ${
          isRightPanelOpen && selectedPlot ? "right-92 lg:right-100" : "right-3.5"
        }`}
      >
        {/* Zoom In & Zoom Out - Unified Vertical Segmented Pill */}
        <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl shadow-md overflow-hidden flex flex-col">
          <button
            onClick={() => mapInstanceRef.current?.zoomIn()}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-blue-50/60 active:scale-95 transition-all cursor-pointer"
            title="Zoom In (Key: +)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="h-[1px] bg-slate-200/80 w-full" />
          <button
            onClick={() => mapInstanceRef.current?.zoomOut()}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-blue-50/60 active:scale-95 transition-all cursor-pointer"
            title="Zoom Out (Key: -)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>

        {/* Reset / Fit Project Extents (Compass) */}
        <button
          onClick={handleFitFullExtent}
          className="w-9 h-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-700 hover:text-blue-600 hover:bg-blue-50/60 flex items-center justify-center shadow-md active:scale-95 transition-all cursor-pointer"
          title="Reset North & Fit Full Project Extents (Key: E)"
        >
          <Compass className="w-4 h-4" />
        </button>

        {/* Quick Basemap Floating Selector */}
        <div className="relative" ref={basemapMenuRef}>
          <button
            onClick={() => setIsBasemapMenuOpen(!isBasemapMenuOpen)}
            className={`w-9 h-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-700 hover:text-blue-600 hover:bg-blue-50/60 flex items-center justify-center shadow-md active:scale-95 transition-all cursor-pointer ${
              isBasemapMenuOpen ? "ring-2 ring-blue-500 text-blue-600 bg-blue-50 font-bold" : ""
            }`}
            title="Switch Basemap Style (Key: B)"
          >
            <Layers className="w-4 h-4" />
          </button>

          {isBasemapMenuOpen && (
            <div className="absolute right-full top-0 mr-2.5 w-52 bg-white/98 backdrop-blur-xl border border-slate-200/90 rounded-xl shadow-2xl p-2 z-50 text-xs animate-in fade-in slide-in-from-right-2 duration-150">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 font-mono">
                Basemap Layer
              </div>
              <div className="py-1 space-y-1">
                {[
                  { id: "satellite", label: "Satellite Imagery" },
                  { id: "carto", label: "Clean Light (Carto)" },
                  { id: "osm", label: "OpenStreetMap" },
                  { id: "apsac", label: "AP Cadastral Map" },
                ].map((bm) => (
                  <button
                    key={bm.id}
                    onClick={() => {
                      setBaseMap(bm.id as any);
                      setIsBasemapMenuOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs transition-colors cursor-pointer ${
                      baseMap === bm.id
                        ? "bg-blue-50 text-blue-700 font-bold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{bm.label}</span>
                    {baseMap === bm.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen */}
        <button
          onClick={handleToggleFullscreen}
          className="w-9 h-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-700 hover:text-slate-900 hover:bg-slate-50/80 flex items-center justify-center shadow-md active:scale-95 transition-all cursor-pointer"
          title={isFullscreen ? "Exit Fullscreen (Key: F)" : "Fullscreen Map (Key: F)"}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>

      {/* Floating North Indicator */}
      <div className="absolute top-3 left-16 sm:left-20 z-10 pointer-events-none opacity-90">
        <div className="w-7 h-7 rounded-full bg-white/95 border border-slate-200 flex flex-col items-center justify-center text-[8px] font-bold text-slate-800 shadow-md">
          <span className="text-red-500 text-[9px] leading-none">▲</span>
          <span>N</span>
        </div>
      </div>

      {/* Interactive Measurement Dock HUD - Positioned at top-14 to clear top toolbar */}
      {measurementMode !== "none" && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
          <div className="bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-[0_12px_36px_rgba(15,23,42,0.16)] px-4 py-2 flex items-center gap-3.5 text-xs select-none">
            {/* Mode Indicator Pill */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase tracking-wider border ${
                measurementMode === "distance"
                  ? "bg-blue-50 text-blue-700 border-blue-200/80"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200/80"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full animate-pulse ${
                  measurementMode === "distance" ? "bg-blue-600" : "bg-emerald-600"
                }`}
              />
              {measurementMode === "distance" ? (
                <>
                  <Ruler className="w-3 h-3" />
                  <span>Distance</span>
                </>
              ) : (
                <>
                  <Compass className="w-3 h-3" />
                  <span>Area</span>
                </>
              )}
            </div>

            {/* Live Readout Values */}
            {measurementMode === "distance" ? (
              <div className="flex items-baseline gap-2 font-mono">
                <span className="text-sm font-bold text-slate-900 tabular-nums">
                  {measurePoints.length === 0
                    ? "Click map to start"
                    : formatDistance(measureTotalDist)}
                </span>
                {measurePoints.length > 0 && (
                  <span className="text-[11px] text-slate-400 font-normal tabular-nums">
                    ({(measureTotalDist * 3.28084).toFixed(1)} ft)
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-baseline gap-2 font-mono">
                {measurePoints.length < 3 ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium font-sans">
                    {measurePoints.length === 0 && <span>Click map to place vertex 1</span>}
                    {measurePoints.length === 1 && <span>Click map to place vertex 2</span>}
                    {measurePoints.length === 2 && (
                      <span>
                        Edge: <b className="font-mono">{formatDistance(measureTotalDist)}</b> • Click 3rd point to enclose area
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-bold text-emerald-800 tabular-nums">
                      {(measureAreaM2 * 0.000247105).toFixed(2)} ac
                    </span>
                    <span className="text-[11px] text-slate-400 font-normal tabular-nums">
                      ({Math.round(measureAreaM2).toLocaleString()} m²)
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Vertices Counter */}
            <div className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold text-[11px] tabular-nums">
              {measurePoints.length} {measurePoints.length === 1 ? "pt" : "pts"}
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1 border-l border-slate-200/80 pl-2.5">
              <button
                onClick={undoMeasurePoint}
                disabled={measurePoints.length === 0}
                title="Undo last point"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={clearMeasurement}
                disabled={measurePoints.length === 0}
                title="Clear all points"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setMeasurementMode("none")}
                title="Finish & Close measurement"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom GIS Status Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-white/95 border-t border-slate-200 text-slate-600 text-[11px] px-3 sm:px-4 flex items-center justify-between font-mono z-20 pointer-events-auto select-none backdrop-blur-xs">
        {/* Left: Project, Sync Status & Layers */}
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-slate-800">
            {projectData?.village || "Survey Village"}
          </span>
          <span className="text-slate-300">•</span>
          <div className="flex items-center gap-1 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-sans font-semibold">
              {isLoading ? "Processing..." : "Ready • Vector Synced"}
            </span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <span className="hidden sm:inline text-slate-600">
            {visibleLayersCount}/{totalLayersCount} Layers Visible
          </span>
          <span className="text-slate-300">•</span>
          <span>
            Selected Plot:{" "}
            {selectedPlot ? (
              <button
                onClick={() => {
                  if (selectedPlot.bounds) setTargetFlyToBounds(selectedPlot.bounds);
                }}
                title="Click to zoom to selected parcel"
                className="text-blue-700 font-bold hover:underline cursor-pointer"
              >
                Sy. {selectedPlot.survey_no}
              </button>
            ) : (
              <span className="text-slate-400">None</span>
            )}
          </span>
        </div>

        {/* Center: Cursor Coordinates */}
        <div className="hidden md:flex items-center gap-3">
          {mouseCoords ? (
            <span>
              Lat: <span className="text-slate-900 font-semibold">{mouseCoords.lat.toFixed(6)}° N</span>{" "}
              Lon: <span className="text-slate-900 font-semibold">{mouseCoords.lng.toFixed(6)}° E</span>
            </span>
          ) : (
            <span className="text-slate-400">Hover over map for coordinates</span>
          )}
        </div>

        {/* Right: Scale, Zoom & CRS */}
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline">
            Zoom {currentZoom} ({mapScaleRatio})
          </span>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <span>EPSG:4326 (WGS84)</span>
          <span className="text-slate-300 hidden lg:inline">•</span>
          <span className="hidden lg:inline">UTM Zone 43N</span>
        </div>
      </div>
    </div>
  );
}
