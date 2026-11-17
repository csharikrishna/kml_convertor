"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FolderOpen,
  Search,
  X,
  Table as TableIcon,
  Share2,
  Upload,
  ArrowLeftRight,
  ChevronDown,
  Check,
  Download,
  FileText,
  Layers,
  Activity,
  Printer,
  Compass,
  Undo2,
  Redo2,
  MapPin,
  FolderPlus,
  Trash2,
  FileSpreadsheet,
  FileCode,
  Sparkles,
  Globe,
} from "lucide-react";
import { generateProjectKml, downloadKmlBlob } from "@/lib/gis/kmlGenerator";
import { GlobalBrandAnchor } from "@/components/layout/GlobalBrandAnchor";
import { GlobalModeSwitcher } from "@/components/layout/GlobalModeSwitcher";
import { BackendWakeButton } from "@/components/layout/BackendWakeButton";
import { useCadastralStore, SurveyPlotRecord } from "@/stores/useCadastralStore";
import { useGisStore } from "@/stores/useGisStore";

interface SearchResultItem {
  id: string;
  type: "plot" | "chainage" | "structure";
  title: string;
  subtitle: string;
  badge?: string;
  plot?: SurveyPlotRecord;
  bounds?: [[number, number], [number, number]];
}

export function CadastralHeader() {
  const {
    currentProjectId,
    projectsList,
    projectData,
    loadProject,
    deleteProject,
    fetchProjectsList,
    selectedPlot,
    setSelectedPlot,
    setTargetFlyToBounds,
    setTableModalOpen,
    setUploadModalOpen,
  } = useCadastralStore();

  const { setIsShareModalOpen, setAppMode } = useGisStore();

  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    fetchProjectsList();
  }, [fetchProjectsList]);

  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setIsExportDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Global keyboard shortcut: Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentProject =
    projectsList.find((p) => p.id === currentProjectId) || {
      id: currentProjectId,
      title: projectData?.village ? `${projectData.village} Project` : "Cadastral Project",
      village: projectData?.village || "Survey Village",
    };

  // Enhanced global search: Plots, Chainages, Structures, Village/Mandal
  const searchResults: SearchResultItem[] = useMemo(() => {
    if (!searchTerm.trim() || !projectData) return [];
    const term = searchTerm.toLowerCase().trim();
    const results: SearchResultItem[] = [];

    // 1. Survey Plots
    if (projectData.survey_register) {
      projectData.survey_register.forEach((p) => {
        const matchesSurvey = p.survey_no.toLowerCase().includes(term);
        const matchesVillage = p.village?.toLowerCase().includes(term);
        const matchesMandal = p.mandal?.toLowerCase().includes(term);
        const matchesDistrict = p.district?.toLowerCase().includes(term);
        const matchesChainage = p.chainage_range?.toLowerCase().includes(term);
        const matchesAffected =
          (term === "affected" || term === "canal" || term === "row") && p.canal_passing;

        if (
          matchesSurvey ||
          matchesVillage ||
          matchesMandal ||
          matchesDistrict ||
          matchesChainage ||
          matchesAffected
        ) {
          results.push({
            id: `plot-${p.survey_no}`,
            type: "plot",
            title: `Sy. No. ${p.survey_no}`,
            subtitle: `${p.village}, ${p.mandal} • ${p.total_acres} ac ${
              p.canal_passing ? `(${p.acquired_acres} ac acq)` : ""
            }`,
            badge: p.canal_passing ? "Canal Affected" : undefined,
            plot: p,
            bounds: p.bounds,
          });
        }
      });
    }

    // 2. Chainage Markers
    if (projectData.layers?.chainage_markers?.features) {
      projectData.layers.chainage_markers.features.forEach((feat: any, idx: number) => {
        const title = feat.properties?.title || feat.properties?.chainage || "";
        if (title.toLowerCase().includes(term)) {
          const coords = feat.geometry?.coordinates;
          if (coords && coords.length >= 2) {
            results.push({
              id: `chainage-${idx}`,
              type: "chainage",
              title,
              subtitle: "Engineering Station Marker along Alignment",
              badge: "Chainage",
              bounds: [
                [coords[1] - 0.001, coords[0] - 0.001],
                [coords[1] + 0.001, coords[0] + 0.001],
              ],
            });
          }
        }
      });
    }

    // 3. Structures
    if (projectData.layers?.structures?.features) {
      projectData.layers.structures.features.forEach((feat: any, idx: number) => {
        const title = feat.properties?.title || "";
        if (title.toLowerCase().includes(term)) {
          const coords = feat.geometry?.coordinates;
          if (coords && coords.length >= 2) {
            results.push({
              id: `struct-${idx}`,
              type: "structure",
              title,
              subtitle: "Hydraulic Canal Structure (Culvert / Regulator)",
              badge: "Structure",
              bounds: [
                [coords[1] - 0.001, coords[0] - 0.001],
                [coords[1] + 0.001, coords[0] + 0.001],
              ],
            });
          }
        }
      });
    }

    return results.slice(0, 15);
  }, [searchTerm, projectData]);

  // Reset highlight index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchTerm]);

  const handleSelectResult = useCallback(
    (item: SearchResultItem) => {
      if (item.type === "plot" && item.plot) {
        setSelectedPlot(item.plot);
        setSearchTerm(`Survey No. ${item.plot.survey_no}`);
      } else {
        if (item.bounds) {
          setTargetFlyToBounds(item.bounds);
        }
        setSearchTerm(item.title);
      }
      setIsSearchOpen(false);
      searchInputRef.current?.blur();
    },
    [setSelectedPlot, setTargetFlyToBounds]
  );

  // Keyboard navigation for search dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSearchOpen || searchResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchResults[selectedIndex]) {
        handleSelectResult(searchResults[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsSearchOpen(false);
      searchInputRef.current?.blur();
    }
  };

  // Export GeoJSON helper
  const handleExportGeoJson = () => {
    if (!projectData?.layers) return;
    const exportData = {
      type: "FeatureCollection",
      crs: {
        type: "name",
        properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
      },
      features: [
        ...(projectData.layers.survey_plots?.features || []),
        ...(projectData.layers.canal_alignment?.features || []),
        ...(projectData.layers.canal_buffer?.features || []),
        ...(projectData.layers.roads?.features || []),
        ...(projectData.layers.structures?.features || []),
      ],
      metadata: {
        project: currentProject.title,
        village: projectData.village,
        mandal: projectData.mandal,
        district: projectData.district,
        exported_at: new Date().toISOString(),
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentProjectId}_cadastral_layers.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportDropdownOpen(false);
  };

  const handleExportKml = () => {
    if (!projectData) return;
    const kml = generateProjectKml(projectData);
    downloadKmlBlob(kml, `${currentProjectId}_cadastral_3d.kml`);
    setIsExportDropdownOpen(false);
  };

  return (
    <header className="h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-5 flex items-center justify-between gap-4 shrink-0 z-40 select-none shadow-[0_1px_2px_rgba(15,23,42,0.04)] whitespace-nowrap">
      {/* Left: Branding & Project Selector */}
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        {/* Unified Brand Lockup */}
        <GlobalBrandAnchor badge="PRO" badgeVariant="blue" />

        <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

        {/* Project Selector Dropdown */}
        <div className="relative hidden md:block" ref={dropdownRef}>
          <button
            onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
            className="h-9 px-3 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-[13px] font-medium text-slate-800 flex items-center gap-2 max-w-[220px] lg:max-w-[280px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 transition-colors duration-150 group whitespace-nowrap"
            title={currentProject.title}
          >
            <FolderOpen className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate text-slate-800 font-medium text-[13px] tracking-tight whitespace-nowrap">{currentProject.title}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-auto group-hover:text-slate-700 transition-colors" />
          </button>

          {isProjectDropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-96 bg-white border border-slate-200 rounded-xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              {/* Dropdown Top Bar */}
              <div className="px-2 py-1.5 flex items-center justify-between border-b border-slate-100 mb-2">
                <span className="text-[11px] uppercase font-mono tracking-wider text-slate-500 font-bold">
                  Village Projects & Maps
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {projectsList.length} Available
                </span>
              </div>

              {/* Action: Create New Project Button */}
              <button
                onClick={() => {
                  setIsProjectDropdownOpen(false);
                  setUploadModalOpen(true);
                }}
                className="w-full text-left p-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 flex items-center gap-2.5 shadow-xs transition-all mb-2"
              >
                <div className="w-7 h-7 rounded-md bg-white/20 flex items-center justify-center shrink-0">
                  <FolderPlus className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="font-bold text-xs flex items-center gap-1.5">
                    <span>+ Create New Village Project</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-white/20 font-mono">NEW</span>
                  </div>
                  <div className="text-[10px] text-blue-100 font-medium">
                    Upload DWG/DXF, Excel schedules & PDF scans
                  </div>
                </div>
              </button>

              {/* Search filter for projects */}
              {projectsList.length > 2 && (
                <div className="px-1 mb-2">
                  <div className="relative flex items-center">
                    <Search className="w-3 h-3 text-slate-400 absolute left-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Filter village projects..."
                      className="w-full h-7 pl-7 pr-2 rounded-md bg-slate-50 border border-slate-200 text-[11px] focus:bg-white focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Project list container */}
              <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                {/* 1. Custom Village Projects */}
                {(() => {
                  const custom = projectsList.filter(
                    (p) =>
                      (p.is_custom || (!p.id.includes("konampalle") && !p.id.includes("padamatiyaleru"))) &&
                      (!projectSearch.trim() ||
                        p.title.toLowerCase().includes(projectSearch.toLowerCase()) ||
                        p.village.toLowerCase().includes(projectSearch.toLowerCase()))
                  );

                  if (custom.length === 0 && !projectSearch.trim()) return null;

                  return (
                    <div>
                      <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold">
                        My Village Workspaces ({custom.length})
                      </div>
                      <div className="space-y-1 mt-0.5">
                        {custom.map((p) => {
                          const isCurrent = p.id === currentProjectId;
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                loadProject(p.id);
                                setIsProjectDropdownOpen(false);
                              }}
                              className={`group w-full text-left p-2 rounded-lg text-xs flex items-start justify-between cursor-pointer transition-all ${
                                isCurrent
                                  ? "text-blue-900 bg-blue-50/80 border border-blue-200 shadow-2xs"
                                  : "text-slate-700 hover:bg-slate-50 border border-transparent"
                              }`}
                            >
                              <div className="truncate pr-2 flex-1">
                                <div className="font-bold truncate text-slate-900 flex items-center gap-1.5">
                                  <span>{p.title}</span>
                                  {isCurrent && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
                                  <span>{p.village}</span>
                                  {p.mandal && <span>• {p.mandal}</span>}
                                  {p.plots_count ? <span>• {p.plots_count} plots</span> : null}
                                </div>
                                <div className="flex items-center gap-1 mt-1 font-mono text-[9px]">
                                  <span className="px-1 py-0.2 rounded bg-blue-100 text-blue-800 font-bold">
                                    DWG
                                  </span>
                                  {p.has_excel && (
                                    <span className="px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold flex items-center gap-0.5">
                                      <Check className="w-2.5 h-2.5" /> XLS
                                    </span>
                                  )}
                                  {p.has_pdf && (
                                    <span className="px-1 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold flex items-center gap-0.5">
                                      <Check className="w-2.5 h-2.5" /> PDF
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                {isCurrent && (
                                  <Check className="w-4 h-4 text-blue-600 shrink-0" />
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Are you sure you want to delete project folder "${p.title}"?`)) {
                                      deleteProject(p.id);
                                    }
                                  }}
                                  title="Delete project folder"
                                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* 2. Sample Canal Reaches */}
                <div>
                  <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold">
                    Sample Canal Reaches
                  </div>
                  <div className="space-y-1 mt-0.5">
                    {projectsList
                      .filter(
                        (p) =>
                          p.id.includes("konampalle") ||
                          p.id.includes("padamatiyaleru") ||
                          p.is_sample
                      )
                      .filter(
                        (p) =>
                          !projectSearch.trim() ||
                          p.title.toLowerCase().includes(projectSearch.toLowerCase()) ||
                          p.village.toLowerCase().includes(projectSearch.toLowerCase())
                      )
                      .map((p) => {
                        const isCurrent = p.id === currentProjectId;
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              loadProject(p.id);
                              setIsProjectDropdownOpen(false);
                            }}
                            className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                              isCurrent
                                ? "text-blue-700 font-bold bg-blue-50/80 border border-blue-200"
                                : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <div className="truncate pr-2">
                              <div className="font-semibold truncate text-slate-900">
                                {p.title}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                                <span>{p.village}</span>
                                <span className="px-1 py-0.2 rounded bg-slate-100 text-slate-600 text-[9px] font-sans">
                                  Sample
                                </span>
                              </div>
                            </div>
                            {isCurrent && (
                              <Check className="w-4 h-4 text-blue-600 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Bottom Quick Action */}
              <div className="border-t border-slate-100 mt-2 pt-2">
                <button
                  onClick={() => {
                    setIsProjectDropdownOpen(false);
                    setUploadModalOpen(true);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-md text-[11px] text-blue-600 hover:bg-blue-50 flex items-center gap-2 font-semibold transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-600" />
                  <span>Upload Custom Drawing & Schedules...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center: Global Survey Number Search */}
      <div className="relative flex-1 max-w-xs md:max-w-sm lg:max-w-md mx-2 group" ref={searchRef}>
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none group-focus-within:text-blue-600 transition-colors" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsSearchOpen(true);
            }}
            onFocus={() => setIsSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder={
              selectedPlot
                ? `Survey No. ${selectedPlot.survey_no} (Active on Map)`
                : "Search survey plot, village, chainage..."
            }
            className="w-full h-8.5 pl-9 pr-14 text-xs font-medium rounded-xl border border-slate-200/80 bg-slate-100/60 hover:bg-slate-100/90 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all placeholder:text-slate-400 shadow-2xs"
          />
          {searchTerm ? (
            <button
              onClick={() => {
                setSearchTerm("");
                setIsSearchOpen(false);
              }}
              className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="absolute right-2 flex items-center gap-0.5 pointer-events-none">
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-400 bg-white border border-slate-200/90 rounded-md shadow-2xs">
                ⌘K
              </kbd>
            </div>
          )}
        </div>

        {/* Search Results Dropdown */}
        {isSearchOpen && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto p-1.5 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-1.5 text-[10px] uppercase font-mono tracking-wider text-slate-400 border-b border-slate-100 flex justify-between font-bold">
              <span>Matching Spatial Features</span>
              <span>{searchResults.length} found</span>
            </div>

            {searchResults.length > 0 ? (
              <div className="py-1 space-y-0.5">
                {searchResults.map((item, idx) => (
                  <button
                    key={`${item.id}-${idx}`}
                    onClick={() => handleSelectResult(item)}
                    className={`w-full px-3 py-2 rounded-lg text-left flex items-center justify-between text-xs transition-colors ${
                      idx === selectedIndex
                        ? "bg-blue-50 text-blue-900 font-semibold"
                        : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-md bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                        {item.type === "plot" && <Layers className="w-3 h-3 text-blue-600" />}
                        {item.type === "chainage" && <MapPin className="w-3 h-3 text-emerald-600" />}
                        {item.type === "structure" && <Compass className="w-3 h-3 text-purple-600" />}
                      </div>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-900 truncate">
                            {item.title}
                          </span>
                          {item.badge && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-sans truncate">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wider shrink-0 pl-2">
                      Locate
                    </div>
                  </button>
                ))}
              </div>
            ) : searchTerm.trim() ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400 font-sans">
                No matching survey plots or features found for &ldquo;{searchTerm}&rdquo;
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Right Actions Toolbar */}
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        {/* Backend Wake Status Button */}
        <BackendWakeButton />

        {/* CAD Engine Sync Status */}
        <div
          title="GIS Vector Pipeline Active (Shapely + STRtree Synced)"
          className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 text-[10px] font-bold font-mono tracking-tight shadow-2xs whitespace-nowrap"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="whitespace-nowrap">TOPOLOGY SYNCED</span>
        </div>

        {/* Schedule Table Modal */}
        <button
          onClick={() => setTableModalOpen(true)}
          title="Open Land Plan Schedule Table"
          className="h-9 px-3 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-[13px] font-medium flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-150 active:scale-98 whitespace-nowrap"
        >
          <TableIcon className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="hidden md:inline whitespace-nowrap">Schedule</span>
        </button>

        {/* Export Dropdown Menu */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
            title="Export Survey Data & Reports"
            className="h-9 px-3 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-[13px] font-medium flex items-center gap-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-150 active:scale-98 whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="hidden md:inline whitespace-nowrap">Export</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {isExportDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-2xl p-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 border-b border-slate-100 font-bold">
                Export Options
              </div>
              <div className="py-1 space-y-0.5">
                <a
                  href={`/api/cadastral/export-table/${currentProjectId}`}
                  download
                  onClick={() => setIsExportDropdownOpen(false)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-slate-700 hover:text-slate-900 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-600" />
                  <div>
                    <div className="font-semibold">Land Plan Schedule (CSV)</div>
                    <div className="text-[10px] text-slate-400">Complete survey register</div>
                  </div>
                </a>

                <button
                  onClick={handleExportGeoJson}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-slate-700 hover:text-slate-900 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <div>
                    <div className="font-semibold">Project GeoJSON</div>
                    <div className="text-[10px] text-slate-400">Vector layers for QGIS/ArcGIS</div>
                  </div>
                </button>

                <button
                  onClick={handleExportKml}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-slate-700 hover:text-slate-900 transition-colors"
                >
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  <div>
                    <div className="font-semibold">3D Village KML (Google Earth)</div>
                    <div className="text-[10px] text-slate-400">All survey plots & canal corridor</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Share Button (Primary Radiant Sapphire CTA) */}
        <button
          onClick={() => setIsShareModalOpen(true)}
          title="Share GIS Drawing Workspace Link"
          className="h-9 px-3.5 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 text-white text-[13px] font-semibold flex items-center gap-2 shadow-[0_2px_8px_rgba(37,99,235,0.25)] hover:shadow-[0_4px_12px_rgba(37,99,235,0.35)] transition-all duration-150 active:scale-98 whitespace-nowrap"
        >
          <Share2 className="w-3.5 h-3.5 text-blue-100 shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">Share</span>
        </button>

        <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

        {/* Master Tool Switcher (Unified Across All Modes) */}
        <GlobalModeSwitcher activeMode="studio" />
      </div>
    </header>
  );
}
