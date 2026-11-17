"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  X,
  FileText,
  Table as TableIcon,
  Download,
  CheckCircle2,
  Compass,
  Layers,
  MapPin,
  Ruler,
  Info,
  Copy,
  Check,
  Search,
  ExternalLink,
  Eye,
  AlertTriangle,
  FileCheck,
  Building,
  Focus,
  User,
  FileSpreadsheet,
  Globe,
  Share2,
} from "lucide-react";
import { useCadastralStore } from "@/stores/useCadastralStore";
import { generatePlotKml, downloadKmlBlob } from "@/lib/gis/kmlGenerator";

export function CadastralPlotDetails() {
  const [copiedLink, setCopiedLink] = useState(false);
  const {
    selectedPlot,
    setSelectedPlot,
    activeTab,
    setActiveTab,
    setTableModalOpen,
    currentProjectId,
    unitMode,
    setUnitMode,
    isRightPanelOpen,
    setIsRightPanelOpen,
    setTargetFlyToBounds,
    highlightedIntersection,
    setHighlightedIntersection,
    previewDocument,
    setPreviewDocument,
    projectData,
  } = useCadastralStore();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [attributeFilter, setAttributeFilter] = useState("");

  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }, []);

  const handleDownloadPlotKml = useCallback(() => {
    if (!selectedPlot) return;
    const kml = generatePlotKml(selectedPlot, projectData);
    const sanitizedVillage = (selectedPlot.village || "Plot").replace(/[\s/\\()]+/g, "_");
    const sanitizedSy = String(selectedPlot.survey_no).replace(/[\s/\\()]+/g, "_");
    downloadKmlBlob(kml, `Sy_${sanitizedSy}_${sanitizedVillage}.kml`);
  }, [selectedPlot, projectData]);

  // Format area according to selected unit preference
  const formatArea = useCallback(
    (areaM2: number, acres: number) => {
      if (unitMode === "sq_meters") {
        return `${Math.round(areaM2).toLocaleString()} m²`;
      }
      if (unitMode === "hectares") {
        return `${(areaM2 / 10000).toFixed(3)} ha`;
      }
      // default: acres
      return `${acres.toFixed(2)} ac`;
    },
    [unitMode]
  );

  // Split area into number and unit for perfect typographical alignment without monospace space leaks
  const renderFormattedArea = useCallback(
    (
      areaM2: number,
      acres: number,
      numClass = "font-mono font-bold text-lg tabular-nums text-slate-900 tracking-tight",
      unitClass = "text-xs font-semibold text-slate-500 ml-1 font-sans"
    ) => {
      let numStr = "";
      let unitStr = "";
      if (unitMode === "sq_meters") {
        numStr = Math.round(areaM2).toLocaleString();
        unitStr = "m²";
      } else if (unitMode === "hectares") {
        numStr = (areaM2 / 10000).toFixed(3);
        unitStr = "ha";
      } else {
        numStr = acres.toFixed(2);
        unitStr = "ac";
      }
      return (
        <span className="inline-flex items-baseline leading-none">
          <span className={numClass}>{numStr}</span>
          <span className={unitClass}>{unitStr}</span>
        </span>
      );
    },
    [unitMode]
  );

  const percentAffected = useMemo(() => {
    if (!selectedPlot || selectedPlot.total_acres <= 0) return 0;
    return Math.min(
      100,
      Math.round((selectedPlot.acquired_acres / selectedPlot.total_acres) * 100)
    );
  }, [selectedPlot]);

  // Attributes list for Tab 2
  const attributesList = useMemo(() => {
    if (!selectedPlot) return [];
    return [
      { key: "survey_no", label: "Survey Number", value: selectedPlot.survey_no },
      ...(selectedPlot.pattadar_name
        ? [{ key: "pattadar_name", label: "Pattadar / Legal Landowner", value: selectedPlot.pattadar_name }]
        : []),
      ...(selectedPlot.khata_no
        ? [{ key: "khata_no", label: "Pattadar Passbook Khata No.", value: selectedPlot.khata_no }]
        : []),
      ...(selectedPlot.land_nature
        ? [{ key: "land_nature", label: "Land Classification (Schedule)", value: selectedPlot.land_nature }]
        : []),
      {
        key: "land_type",
        label: "Land Classification",
        value:
          (selectedPlot as any).land_type ||
          ((selectedPlot as any).is_poramboke ? "Government Poramboke" : "Ryotwari Patta"),
      },
      { key: "village", label: "Revenue Village", value: selectedPlot.village },
      { key: "mandal", label: "Mandal / Tahsil", value: selectedPlot.mandal },
      { key: "district", label: "District", value: selectedPlot.district },
      { key: "total_acres", label: "Total Acreage", value: `${selectedPlot.total_acres} ac` },
      { key: "total_ac_cts", label: "Acres - Cents Breakdown", value: selectedPlot.total_ac_cts },
      {
        key: "total_area_m2",
        label: "Metric Area",
        value: `${selectedPlot.total_area_m2.toLocaleString()} m²`,
      },
      {
        key: "hectares",
        label: "Hectares",
        value: `${(selectedPlot.total_area_m2 / 10000).toFixed(3)} ha`,
      },
      {
        key: "canal_passing",
        label: "Canal Alignment Intersects",
        value: selectedPlot.canal_passing ? "Yes (Acquired)" : "No (Unaffected)",
      },
      {
        key: "acquired_acres",
        label: "Acquired Area (Acres)",
        value: `${selectedPlot.acquired_acres} ac`,
      },
      {
        key: "acquired_area_m2",
        label: "Acquired Area (m²)",
        value: `${selectedPlot.acquired_area_m2.toLocaleString()} m²`,
      },
      {
        key: "balance_acres",
        label: "Balance Retained Area (Acres)",
        value: `${selectedPlot.balance_acres} ac`,
      },
      {
        key: "balance_area_m2",
        label: "Balance Retained Area (m²)",
        value: `${selectedPlot.balance_area_m2.toLocaleString()} m²`,
      },
      {
        key: "chainage_range",
        label: "Chainage Station Range",
        value: selectedPlot.chainage_range,
      },
      {
        key: "canal_length_m",
        label: "Canal Reach Length in Plot",
        value: `${selectedPlot.canal_length_m} m`,
      },
      {
        key: "canal_width_m",
        label: "Canal Corridor RoW Width",
        value: `${selectedPlot.canal_width_m} m`,
      },
      {
        key: "centroid_latlng",
        label: "Centroid Coordinates (WGS84)",
        value: selectedPlot.center
          ? `${selectedPlot.center[0].toFixed(6)}° N, ${selectedPlot.center[1].toFixed(6)}° E`
          : "N/A",
      },
      {
        key: "google_maps",
        label: "Google Maps Location",
        value: selectedPlot.center
          ? `https://www.google.com/maps?q=${selectedPlot.center[0].toFixed(6)},${selectedPlot.center[1].toFixed(6)}`
          : "N/A",
        isLink: Boolean(selectedPlot.center),
      },
      {
        key: "crs_projection",
        label: "Coordinate System",
        value: "EPSG:4326 (WGS84) / EPSG:32643 (UTM Zone 43N)",
      },
      {
        key: "data_source",
        label: "Cadastral Source",
        value: "AutoCAD Engineering Drawing (Topological Overlay)",
      },
    ];
  }, [selectedPlot]);

  const filteredAttributes = useMemo(() => {
    if (!attributeFilter.trim()) return attributesList;
    const q = attributeFilter.toLowerCase().trim();
    return attributesList.filter(
      (a) => a.label.toLowerCase().includes(q) || String(a.value).toLowerCase().includes(q)
    );
  }, [attributesList, attributeFilter]);

  // Spatial Intersections list for Tab 3
  const intersectionsList = useMemo(() => {
    if (!selectedPlot) return [];
    const list = [];
    if (selectedPlot.canal_passing) {
      list.push({
        id: "canal_alignment",
        name: "Canal Alignment Centerline",
        category: "Hydraulic Infrastructure",
        type: "Linear Crossing",
        length: `${selectedPlot.canal_length_m} m`,
        area: "Centerline",
        percent: "-",
        chainage: selectedPlot.chainage_range,
        status: "Active Alignment",
        distinction: "Actual canal excavation channel",
      });

      list.push({
        id: "canal_buffer",
        name: "Canal Right-of-Way Buffer",
        category: "Statutory Corridor",
        type: "Surface Acquisition",
        length: `${selectedPlot.canal_length_m} m corridor`,
        area: `${selectedPlot.acquired_acres} ac (${selectedPlot.acquired_area_m2.toLocaleString()} m²)`,
        percent: `${percentAffected}%`,
        chainage: selectedPlot.chainage_range,
        status: "Proposed Acquisition",
        distinction: "Design corridor + maintenance embankments (25m RoW)",
      });
    }

    list.push({
      id: "roads",
      name: "Field Access Roads / Tracks",
      category: "Transportation",
      type: "Linear / Access",
      length: "Perimeter",
      area: "Non-acquired",
      percent: "0%",
      chainage: "Local Track",
      status: "Public Easement",
      distinction: "Existing village cart track access",
    });

    return list;
  }, [selectedPlot, percentAffected]);

  const handleDownloadReport = useCallback(() => {
    if (!selectedPlot) return;
    const content = `=================================================================
LAND ACQUISITION INSPECTION REPORT - SURVEY NO. ${selectedPlot.survey_no}
=================================================================
Project:   ${selectedPlot.village} Canal Alignment & Land Survey
Village:   ${selectedPlot.village}
Mandal:    ${selectedPlot.mandal}
District:  ${selectedPlot.district}

1. LAND AREA MEASUREMENTS:
   - Total Plot Area:      ${selectedPlot.total_acres} Acres (${selectedPlot.total_ac_cts})
   - Total Metric Area:    ${selectedPlot.total_area_m2.toLocaleString()} sq. meters (${(
      selectedPlot.total_area_m2 / 10000
    ).toFixed(3)} ha)
   - Canal Alignment:      ${
     selectedPlot.canal_passing ? "AFFECTED (CANAL INTERSECTS)" : "UNAFFECTED"
   }
   - Canal Acquired Area:  ${selectedPlot.acquired_acres} Acres (${selectedPlot.acquired_area_m2.toLocaleString()} m²)
   - Balance Area:         ${selectedPlot.balance_acres} Acres (${selectedPlot.balance_area_m2.toLocaleString()} m²)
   - Percentage Acquired:  ${percentAffected}%

2. ENGINEERING CHAINAGE & INFRASTRUCTURE:
   - Chainage Range:       ${selectedPlot.chainage_range}
   - Canal Length in Plot: ${selectedPlot.canal_length_m} meters
   - Canal Corridor Width: ${selectedPlot.canal_width_m} meters (Right-of-Way Corridor)

3. SPATIAL COORDINATES (CENTROID):
   - Latitude:             ${selectedPlot.center ? selectedPlot.center[0].toFixed(6) : "N/A"}° N
   - Longitude:            ${selectedPlot.center ? selectedPlot.center[1].toFixed(6) : "N/A"}° E
   - CRS Datum:            EPSG:4326 (WGS84) / UTM Zone 43N

Certified by Canal Alignment & Land Survey GIS Studio.
Generated on: ${new Date().toLocaleString()}
=================================================================`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Inspection_Report_Sy_${selectedPlot.survey_no.replace(/\//g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedPlot, percentAffected]);

  const chainageBreakdown = useMemo(() => {
    if (!selectedPlot?.chainage_range) {
      return { start: "KM 0.000", end: "KM 0.000" };
    }
    const parts = selectedPlot.chainage_range.split("-").map((s) => s.trim());
    if (parts.length >= 2) {
      return { start: parts[0], end: parts[1] };
    }
    return { start: selectedPlot.chainage_range, end: selectedPlot.chainage_range };
  }, [selectedPlot]);

  const handleDownloadDocument = useCallback(
    (doc: any) => {
      if (!selectedPlot) return;
      const content = `=================================================================
OFFICIAL CADASTRAL RECORD: ${doc.title.toUpperCase()}
=================================================================
Survey Plot:      Sy. No. ${selectedPlot.survey_no}
Revenue Village:  ${selectedPlot.village}
Mandal:           ${selectedPlot.mandal}
District:         ${selectedPlot.district}
Document Type:    ${doc.type}
Certification:    ${doc.status}
Issued Date:      ${doc.date}

RECORD SUMMARY:
- Gross Extent:        ${selectedPlot.total_acres} Acres (${selectedPlot.total_ac_cts})
- Metric Land Area:    ${selectedPlot.total_area_m2.toLocaleString()} sq. meters
- Canal Alignment:     ${selectedPlot.canal_passing ? "CORRIDOR INTERSECTS" : "NON-AFFECTED"}
- Statutory Corridor:  ${selectedPlot.canal_width_m}m Right-of-Way
- Acquisition Area:    ${selectedPlot.acquired_acres} Acres (${selectedPlot.acquired_area_m2.toLocaleString()} m²)
- Balance Retained:    ${selectedPlot.balance_acres} Acres (${selectedPlot.balance_area_m2.toLocaleString()} m²)
- Chainage Range:      ${selectedPlot.chainage_range}
- WGS84 Centroid:      ${selectedPlot.center ? `${selectedPlot.center[0].toFixed(6)}° N, ${selectedPlot.center[1].toFixed(6)}° E` : "N/A"}

Verified against cadastral vector dataset.
Timestamp: ${new Date().toISOString()}
=================================================================`;
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/[\s\/\(\)]+/g, "_")}_Sy_${selectedPlot.survey_no.replace(/\//g, "_")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [selectedPlot]
  );

  // If no plot selected, render nothing so map controls remain clean & unobstructed
  if (!selectedPlot) {
    return null;
  }

  // 2D Planar SVG Diagram
  const renderPlotSvg = () => {
    const poly = selectedPlot.local_poly;
    const canals = selectedPlot.local_canal || [];

    if (!poly || poly.length < 3) {
      return (
        <svg
          viewBox="0 0 320 180"
          className="w-full h-44 rounded-lg bg-slate-50 border border-slate-200 p-2"
        >
          <polygon
            points="40,140 70,30 250,20 280,135"
            fill="#10b981"
            fillOpacity="0.2"
            stroke="#2563eb"
            strokeWidth="3"
          />
          {selectedPlot.canal_passing && (
            <polygon
              points="30,95 290,75 290,110 30,125"
              fill="#0ea5e9"
              fillOpacity="0.65"
              stroke="#0284c7"
              strokeWidth="2"
            />
          )}
          <text
            x="160"
            y="95"
            fill="#0f172a"
            fontSize="13"
            fontWeight="bold"
            textAnchor="middle"
            fontFamily="monospace"
          >
            {selectedPlot.survey_no}
          </text>
        </svg>
      );
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    const pad = 24;
    const viewW = 340;
    const viewH = 180;
    const scale = Math.min((viewW - pad * 2) / spanX, (viewH - pad * 2) / spanY);

    const toSvg = (x: number, y: number): [number, number] => {
      const sx = pad + (x - minX) * scale + (viewW - pad * 2 - spanX * scale) / 2;
      const sy = viewH - (pad + (y - minY) * scale + (viewH - pad * 2 - spanY * scale) / 2);
      return [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10];
    };

    const polyPoints = poly.map(([x, y]) => toSvg(x, y).join(",")).join(" ");

    return (
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="w-full h-44 rounded-lg bg-slate-50 p-2 border border-slate-200"
      >
        <defs>
          <pattern
            id="canalHatchStripes"
            width="8"
            height="8"
            patternTransform="rotate(45 0 0)"
            patternUnits="userSpaceOnUse"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke="#0284c7" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Survey Plot Polygon Base */}
        <polygon
          points={polyPoints}
          fill="#10b981"
          fillOpacity="0.22"
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinejoin="round"
        />

        {/* Canal Corridor Intersection Slice */}
        {selectedPlot.canal_passing &&
          canals.map((cPoly, i) => {
            const pts = cPoly.map(([x, y]) => toSvg(x, y).join(",")).join(" ");
            return (
              <g key={i}>
                <polygon
                  points={pts}
                  fill="#0ea5e9"
                  fillOpacity="0.6"
                  stroke="#0284c7"
                  strokeWidth="2"
                />
                <polygon points={pts} fill="url(#canalHatchStripes)" fillOpacity="0.35" />
              </g>
            );
          })}

        {/* Center Survey Number Label */}
        <text
          x={viewW / 2}
          y={viewH / 2 + 5}
          fill="#0f172a"
          fontSize="13"
          fontWeight="bold"
          textAnchor="middle"
          fontFamily="monospace"
        >
          {selectedPlot.survey_no}
        </text>
      </svg>
    );
  };

  return (
    <>
      {/* 1. Compact Floating Pill (Animated expansion/compression origin) */}
      <div
        className={`fixed md:absolute top-3.5 right-16 z-20 pointer-events-auto transform-gpu transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          !isRightPanelOpen
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-75 -translate-y-2 pointer-events-none"
        }`}
      >
        <button
          type="button"
          onClick={() => setIsRightPanelOpen(true)}
          className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl shadow-md px-3.5 py-2 flex items-center gap-2 hover:bg-slate-50 text-xs text-slate-800 hover:border-blue-300 shadow-md transition-all active:scale-95 cursor-pointer group"
          title="Expand Survey Plot Inspector"
        >
          <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-2xs group-hover:scale-105 transition-transform">
            <Layers className="w-3 h-3 text-white" />
          </div>
          <span className="font-bold text-slate-900">Sy. No. {selectedPlot.survey_no}</span>
          <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 group-hover:bg-blue-100 transition-colors">
            Expand
          </span>
        </button>
      </div>

      {/* 2. Survey Plot Inspector Drawer with Origin-Top-Right Compression/Expansion */}
      <aside
        className={`fixed md:absolute bottom-0 md:bottom-8 right-0 md:right-4 top-auto md:top-3 w-full md:w-[390px] lg:w-[400px] max-h-[85vh] md:max-h-[calc(100vh-80px)] bg-white border border-slate-200/90 rounded-2xl shadow-[0_20px_50px_rgba(15,23,42,0.18)] z-30 md:z-20 flex flex-col pointer-events-auto text-slate-800 overflow-hidden transform-gpu origin-top-right transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isRightPanelOpen
            ? "opacity-100 scale-100 translate-x-0 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-75 translate-x-8 -translate-y-6 pointer-events-none"
        }`}
      >
      {/* Mobile grab indicator */}
      <div className="md:hidden flex justify-center pt-2 pb-1 bg-slate-50/80">
        <div className="w-10 h-1 rounded-full bg-slate-300" />
      </div>

      {/* 1. Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-2xs shrink-0">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900 leading-tight">
              Survey Plot Inspector
            </h3>
            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
              Cadastral Parcel Details
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            PARCEL ACTIVE
          </span>
          <button
            onClick={() => setIsRightPanelOpen(false)}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors ml-1 cursor-pointer"
            title="Minimize Inspector to top-right pill (Key: Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Hero: Survey Number & Badges */}
      <div className="p-4 bg-white border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
              Survey Number
            </span>
            <button
              onClick={() => handleCopy(selectedPlot.survey_no, "hero_sy")}
              title="Copy Survey Number"
              className="text-slate-400 hover:text-blue-600 p-0.5 rounded hover:bg-slate-50 transition-colors"
            >
              {copiedKey === "hero_sy" ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <span className="text-2xl font-black font-mono text-slate-950 tracking-tight leading-none">
              {selectedPlot.survey_no}
            </span>
            {(selectedPlot as any).is_poramboke ? (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs">
                Govt Corridor
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs">
                Ryotwari Patta
              </span>
            )}
          </div>
          {(selectedPlot as any).land_type &&
            (selectedPlot as any).land_type !== "Ryotwari Patta" &&
            (selectedPlot as any).land_type !== "Govt Poramboke" &&
            (selectedPlot as any).land_type !== "Govt Poramboke (Rasta)" &&
            (selectedPlot as any).land_type !== "Govt Corridor" && (
            <div className="text-[11px] font-medium text-slate-500 mt-1">
              {(selectedPlot as any).land_type}
            </div>
          )}
          {selectedPlot.pattadar_name && (
            <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50/80 text-emerald-900 border border-emerald-200/80 text-[11px] font-medium max-w-[240px] shadow-2xs">
              <User className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="font-bold truncate">{selectedPlot.pattadar_name}</span>
              {selectedPlot.khata_no && (
                <span className="text-[10px] text-emerald-700 font-mono shrink-0">
                  (Khata #{selectedPlot.khata_no})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-0.5 text-right shrink-0">
          <span className="text-sm font-bold text-slate-900 font-sans leading-tight">
            {selectedPlot.village}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            {selectedPlot.mandal} • {selectedPlot.district}
          </span>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap justify-end">
            <button
              type="button"
              onClick={handleDownloadPlotKml}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 hover:text-blue-700 border border-slate-200 rounded-md px-2 py-1 transition-colors shadow-2xs"
              title="Download parcel vector KML file"
            >
              <Download className="w-3 h-3 text-slate-500" />
              <span>KML</span>
            </button>
            {selectedPlot.center && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${selectedPlot.center[0]},${selectedPlot.center[1]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md px-2 py-1 transition-colors shadow-2xs"
                title={`Open Survey Plot ${selectedPlot.survey_no} in Google Maps with dropped pin`}
              >
                <ExternalLink className="w-3 h-3 text-emerald-600" />
                <span>Google Maps</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 3. Segmented Tab Navigation */}
      <div className="px-4 py-2 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-xl">
          {[
            { id: "summary", label: "Overview", count: undefined },
            { id: "attributes", label: "Attributes", count: attributesList.length },
            { id: "intersections", label: "Intersections", count: intersectionsList.length },
            { id: "documents", label: "Documents", count: 3 },
          ].map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex-1 py-1.5 px-2 text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                  isActive
                    ? "bg-white text-blue-600 font-bold shadow-xs border border-slate-200/60"
                    : "text-slate-600 hover:text-slate-900 font-medium"
                }`}
              >
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive
                        ? "bg-blue-50 text-blue-700 font-bold"
                        : "bg-slate-200/80 text-slate-600"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs pb-28">
        {/* ================= TAB 1: OVERVIEW ================= */}
        {activeTab === "summary" && (
          <>
            {/* Unit Preference Switcher */}
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Display Units
              </span>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 font-mono text-[10px]">
                {[
                  { id: "acres", label: "Acres" },
                  { id: "sq_meters", label: "Sq M" },
                  { id: "hectares", label: "Ha" },
                ].map((u) => {
                  const isActive = unitMode === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => setUnitMode(u.id as any)}
                      className={`px-2.5 py-0.5 rounded-md transition-all ${
                        isActive
                          ? "bg-white text-blue-700 font-bold shadow-2xs border border-slate-200/60"
                          : "text-slate-600 hover:text-slate-900 font-medium"
                      }`}
                    >
                      {u.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Total Plot Area Hero Card */}
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-white shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8.5 h-8.5 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-2xs shrink-0">
                  <Ruler className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Total Plot Area
                  </span>
                  <div className="mt-0.5">
                    {renderFormattedArea(
                      selectedPlot.total_area_m2,
                      selectedPlot.total_acres,
                      "font-mono font-extrabold text-xl tabular-nums text-slate-900 tracking-tight",
                      "text-xs font-semibold text-slate-500 ml-1 font-sans"
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-800 font-mono">{selectedPlot.total_ac_cts}</div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                  {selectedPlot.total_area_m2.toLocaleString()} m²
                </div>
              </div>
            </div>

            {/* Canal Intersection Status Banner */}
            <div className="px-3.5 py-3 rounded-xl border border-slate-200/90 bg-white shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8.5 h-8.5 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-2xs shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Canal Intersection
                  </span>
                  <span className="text-xs font-bold text-slate-800 block mt-0.5">
                    {selectedPlot.canal_passing ? "Canal Intersected" : "Unaffected Parcel"}
                  </span>
                </div>
              </div>

              {selectedPlot.canal_passing ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 flex items-center gap-1.5 font-mono shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {percentAffected}% acq
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200 font-mono">
                  Clean
                </span>
              )}
            </div>

            {/* Split Metrics: Area Under Canal vs Balance */}
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-white shadow-2xs space-y-3">
              <div className="grid grid-cols-2 gap-3 divide-x divide-slate-100">
                {/* Area Under Canal */}
                <div className="flex flex-col gap-1 pr-2">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3 h-3 text-blue-600 shrink-0" />
                    Under Canal
                  </span>
                  <div>
                    {renderFormattedArea(
                      selectedPlot.acquired_area_m2,
                      selectedPlot.acquired_acres,
                      "font-mono font-bold text-base tabular-nums text-slate-900",
                      "text-xs font-semibold text-slate-500 ml-1 font-sans"
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {selectedPlot.acquired_area_m2.toLocaleString()} m²
                  </span>
                </div>

                {/* Balance Area */}
                <div className="flex flex-col gap-1 pl-3">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                    Balance Retained
                  </span>
                  <div>
                    {renderFormattedArea(
                      selectedPlot.balance_area_m2,
                      selectedPlot.balance_acres,
                      "font-mono font-bold text-base tabular-nums text-slate-900",
                      "text-xs font-semibold text-slate-500 ml-1 font-sans"
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {selectedPlot.balance_area_m2.toLocaleString()} m²
                  </span>
                </div>
              </div>

              {/* Visual Proportion Bar (Land Split) */}
              {selectedPlot.canal_passing && (
                <div className="pt-2.5 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono font-semibold text-slate-500">
                    <span className="text-blue-600 font-bold">Acquired {percentAffected}%</span>
                    <span className="text-emerald-600 font-bold">Retained {100 - percentAffected}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${Math.max(2, Math.min(100, percentAffected))}%` }}
                      title={`Under Canal: ${percentAffected}%`}
                    />
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${100 - Math.max(2, Math.min(100, percentAffected))}%` }}
                      title={`Balance Retained: ${100 - percentAffected}%`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Engineering Chainage Details */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 divide-y divide-slate-200/60 overflow-hidden shadow-2xs">
              <div className="px-3.5 py-2 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Chainage Start</span>
                <span className="font-mono font-bold text-blue-700">{chainageBreakdown.start}</span>
              </div>
              <div className="px-3.5 py-2 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Chainage End</span>
                <span className="font-mono font-bold text-blue-700">{chainageBreakdown.end}</span>
              </div>
              <div className="px-3.5 py-2 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Total Canal Reach</span>
                <span className="font-mono font-semibold text-slate-800">{selectedPlot.chainage_range}</span>
              </div>
              <div className="px-3.5 py-2 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Canal Length in Plot</span>
                <span className="font-mono font-semibold text-slate-800">{selectedPlot.canal_length_m} m</span>
              </div>
              <div className="px-3.5 py-2 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Corridor RoW Width</span>
                <span className="font-mono font-semibold text-slate-800">{selectedPlot.canal_width_m} m</span>
              </div>
            </div>

            {/* 2D Planar SVG Projection */}
            <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[10px] text-slate-600 uppercase tracking-wider">
                  Planar 2D Parcel Projection
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-400">Orthogonal</span>
                  {selectedPlot.bounds && (
                    <button
                      onClick={() => setTargetFlyToBounds(selectedPlot.bounds!)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 flex items-center gap-1 transition-colors shadow-2xs"
                      title="Zoom map directly to this survey parcel"
                    >
                      <Focus className="w-3 h-3" />
                      <span>Zoom</span>
                    </button>
                  )}
                </div>
              </div>

              {renderPlotSvg()}

              <div className="flex items-center justify-around pt-1 text-[10px] text-slate-700 font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded border border-blue-600 bg-emerald-500/20" />
                  <span>Plot Boundary</span>
                </div>
                {selectedPlot.canal_passing && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded bg-sky-500" />
                    <span>Canal RoW</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded bg-emerald-500" />
                  <span>Balance Land</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ================= TAB 2: ATTRIBUTES ================= */}
        {activeTab === "attributes" && (
          <div className="space-y-3">
            {/* Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={attributeFilter}
                onChange={(e) => setAttributeFilter(e.target.value)}
                placeholder="Filter attributes..."
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 outline-none"
              />
            </div>

            {/* Attributes Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 bg-white">
              {filteredAttributes.map((attr) => (
                <div
                  key={attr.key}
                  className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-tight">
                      {attr.label}
                    </span>
                    {(attr as any).isLink ? (
                      <a
                        href={String(attr.value)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 mt-0.5"
                      >
                        <ExternalLink className="w-3 h-3 text-blue-500 shrink-0" />
                        <span className="truncate">Open in Google Maps</span>
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-slate-900 font-medium truncate block">
                        {attr.value}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleCopy(String(attr.value), attr.key)}
                    title="Copy value"
                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100"
                  >
                    {copiedKey === attr.key ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= TAB 3: INTERSECTIONS ================= */}
        {activeTab === "intersections" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-1">
              <div className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-blue-600" />
                <span>Canal Alignment Corridor Overlay</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {selectedPlot.canal_passing
                  ? `Canal alignment intersects Survey No. ${selectedPlot.survey_no} over a stretch of ${selectedPlot.canal_length_m} meters. A statutory corridor width of ${selectedPlot.canal_width_m}m has been calculated for land acquisition, leaving ${selectedPlot.balance_acres} acres balance.`
                  : `Survey No. ${selectedPlot.survey_no} is outside the canal Right-of-Way corridor.`}
              </p>
            </div>

            {/* Intersecting Features Table */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Intersecting Project Features
              </span>

              {intersectionsList.map((item) => {
                const isHighlighted = highlightedIntersection === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() =>
                      setHighlightedIntersection(isHighlighted ? null : item.id)
                    }
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isHighlighted
                        ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-400/30 shadow-xs"
                        : "border-slate-200 bg-white hover:border-blue-300 shadow-2xs"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                          <span>{item.name}</span>
                          {isHighlighted && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {item.category} • {item.type}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                          isHighlighted
                            ? "bg-blue-600 text-white"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {isHighlighted ? "Active on Map" : item.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">
                          Acquired Area / Length
                        </span>
                        <span className="font-bold text-slate-800">{item.area}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block font-sans">
                          Parcel Affected %
                        </span>
                        <span className="font-bold text-slate-800">{item.percent}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-sans italic bg-slate-50 p-1.5 rounded">
                      <span>{item.distinction}</span>
                      <span className="text-blue-600 font-bold not-italic font-mono text-[9px]">
                        {isHighlighted ? "Click to clear" : "Click to highlight"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= TAB 4: DOCUMENTS ================= */}
        {activeTab === "documents" && (
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Associated Cadastral & Revenue Records
            </span>

            {projectData?.documents && projectData.documents.map((doc, idx) => (
              <div
                key={`uploaded-doc-${idx}`}
                className="p-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/70 to-blue-50/50 space-y-2 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-xs text-indigo-950">{doc.title}</div>
                      <div className="text-[10px] text-indigo-700 font-mono">{doc.filename}</div>
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 shrink-0 font-mono">
                    PROJECT PDF
                  </span>
                </div>

                <div className="pt-1.5 border-t border-indigo-100 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-mono">
                    {doc.size_bytes ? `${(doc.size_bytes / 1024 / 1024).toFixed(2)} MB` : "Attached Document"}
                  </span>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1 shadow-2xs transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open / Download PDF</span>
                  </a>
                </div>
              </div>
            ))}

            {[
              {
                title: "Field Measurement Book (FMB)",
                desc: `Survey sketch for Sy. No. ${selectedPlot.survey_no}`,
                type: "CAD / DWG Extract",
                status: "Certified",
                date: "2024 Revenue Survey",
              },
              {
                title: "Form 1-B (Record of Rights)",
                desc: `Pahani ownership extract for ${selectedPlot.village}`,
                type: "Revenue PDF",
                status: "Verified",
                date: "Fasli 1433",
              },
              {
                title: "Section 11(1) Preliminary Gazette",
                desc: `Land Acquisition statutory notification`,
                type: "Govt Gazette PDF",
                status: "Gazetted",
                date: "AP Gazette Notification",
              },
              {
                title: "Valuation & Compensation Award",
                desc: `Estimated structural & land compensation schedule`,
                type: "Schedule CSV",
                status: "Draft Award",
                date: "Phase-1 Irrigation",
              },
            ].map((doc, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-slate-200 bg-white space-y-2 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <FileCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-xs text-slate-900">{doc.title}</div>
                      <div className="text-[11px] text-slate-500">{doc.desc}</div>
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 font-mono">
                    {doc.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1.5 border-t border-slate-100">
                  <span>{doc.date}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewDocument(doc)}
                      className="text-slate-600 hover:text-blue-600 font-semibold font-sans flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Preview
                    </button>
                    <button
                      onClick={() => handleDownloadDocument(doc)}
                      className="text-blue-600 hover:text-blue-800 font-semibold font-sans flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Footer Actions */}
      <div className="p-2.5 sm:p-3 bg-white border-t border-slate-200/90 flex items-center justify-between gap-1.5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] shrink-0 z-20 relative rounded-b-2xl">
        <button
          onClick={handleDownloadReport}
          title="Download Inspection Report TXT"
          className="h-9 px-2 sm:px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1 sm:gap-1.5 transition-colors shadow-xs active:scale-98 shrink-0 cursor-pointer"
        >
          <FileText className="w-3.5 h-3.5 text-blue-600" />
          <span>Report</span>
        </button>

        <button
          onClick={() => setTableModalOpen(true)}
          title="Open Land Plan Schedule Table"
          className="h-9 px-2 sm:px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1 sm:gap-1.5 transition-colors shadow-xs active:scale-98 shrink-0 cursor-pointer"
        >
          <TableIcon className="w-3.5 h-3.5 text-emerald-600" />
          <span>Schedule</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPlotKml}
          className="h-9 px-2 sm:px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1 sm:gap-1.5 transition-colors shadow-xs active:scale-98 shrink-0 cursor-pointer"
          title="Download parcel vector KML file"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>KML</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              const url = `${window.location.origin}/cadastral?project=${currentProjectId}&sy=${encodeURIComponent(selectedPlot.survey_no)}`;
              navigator.clipboard.writeText(url);
              setCopiedLink(true);
              setTimeout(() => setCopiedLink(false), 2000);
            }
          }}
          className="h-9 px-2 sm:px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-1 sm:gap-1.5 transition-colors shadow-xs active:scale-98 shrink-0 cursor-pointer"
          title="Copy direct shareable link for this survey parcel"
        >
          {copiedLink ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700 font-bold">Copied!</span>
            </>
          ) : (
            <>
              <Share2 className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Share Sy</span>
            </>
          )}
        </button>

        <a
          href={`/api/cadastral/export-table/${currentProjectId}`}
          download
          title="Export Survey Register CSV"
          className="flex-1 min-w-[70px] h-9 px-2.5 sm:px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-[0_2px_8px_rgba(37,99,235,0.25)] active:scale-98 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </a>
      </div>

      {/* Document Inspection & Preview Dialog */}
      {previewDocument && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-xs text-slate-900">
                  {previewDocument.title}
                </span>
              </div>
              <button
                onClick={() => setPreviewDocument(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 font-mono text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-[11px]">
                <div className="text-slate-500 font-sans">
                  Parcel: <b className="text-slate-900 font-mono">Sy. No. {selectedPlot.survey_no}</b>
                </div>
                <div className="text-slate-500 font-sans">
                  Location: <b className="text-slate-900 font-sans">{selectedPlot.village}, {selectedPlot.mandal}</b>
                </div>
                <div className="text-slate-500 font-sans">
                  Classification: <b className="text-slate-900">{previewDocument.type}</b> ({previewDocument.status})
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Cadastral Extract Preview
                </div>
                <div className="space-y-1 text-slate-700 text-[11px] leading-relaxed">
                  <div>• Gross Cadastral Extent: <b>{selectedPlot.total_acres} acres ({selectedPlot.total_ac_cts})</b></div>
                  <div>• Metric Calculated Area: <b>{selectedPlot.total_area_m2.toLocaleString()} m²</b></div>
                  <div>• Canal Right-of-Way Status: <b>{selectedPlot.canal_passing ? `Corridor Intersected (${selectedPlot.acquired_acres} ac acq)` : "Unaffected Parcel"}</b></div>
                  <div>• Chainage Reach: <b>{selectedPlot.chainage_range}</b></div>
                  <div>• Centroid Location: <b>{selectedPlot.center ? `${selectedPlot.center[0].toFixed(6)}° N, ${selectedPlot.center[1].toFixed(6)}° E` : "N/A"}</b></div>
                  <div>• Verification Datum: <b>EPSG:4326 (WGS84) / UTM Zone 43N</b></div>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setPreviewDocument(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  handleDownloadDocument(previewDocument);
                  setPreviewDocument(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 flex items-center gap-1.5 shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Download Document
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
    </>
  );
}
