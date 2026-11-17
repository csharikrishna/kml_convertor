"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  FolderOpen,
  ChevronDown,
  Check,
  Columns,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useCadastralStore } from "@/stores/useCadastralStore";
import { useGisStore } from "@/stores/useGisStore";
import { GlobalBrandAnchor } from "@/components/layout/GlobalBrandAnchor";
import { GlobalModeSwitcher } from "@/components/layout/GlobalModeSwitcher";

const SimpleKmlMap = dynamic(
  () => import("@/components/cadastral/SimpleKmlMap").then((mod) => mod.SimpleKmlMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-500 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
          <span>Loading Simple KML Map Engine...</span>
        </div>
      </div>
    ),
  }
);

const SplitCompareView = dynamic(
  () => import("@/components/cadastral/SplitCompareView").then((mod) => mod.SplitCompareView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-500 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
          <span>Initializing Synchronized Split Comparison...</span>
        </div>
      </div>
    ),
  }
);

export function SimpleKmlView() {
  const {
    currentProjectId,
    projectsList,
    projectData,
    loadProject,
    fetchProjectsList,
    baseMap,
    setBaseMap,
  } = useCadastralStore();

  const [isSplitCompare, setIsSplitCompare] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [activeLayers, setActiveLayers] = useState({
    canal: true,
    buffer: true,
    plots: true,
    roads: true,
    stations: true,
  });
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchProjectsList();
    if (!projectData) {
      loadProject(currentProjectId);
    }
  }, [currentProjectId, fetchProjectsList, loadProject, projectData]);

  // Click outside to close project dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentProject =
    projectsList.find((p) => p.id === currentProjectId) || {
      id: currentProjectId,
      title: projectData?.village ? `${projectData.village} Project` : "Cadastral Project",
      filename: "project_drawing.dwg",
    };

  const toggleLayer = (key: keyof typeof activeLayers) => {
    setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 select-none">
      {/* Top Application Bar - Fixed 56px, Spacious & Unified Layout */}
      <header className="h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-5 flex items-center justify-between gap-4 shrink-0 z-30 shadow-[0_1px_2px_rgba(15,23,42,0.04)] whitespace-nowrap">
        {/* Left: Branding Anchor, Project Selector & Split Compare Action */}
        <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
          <GlobalBrandAnchor badge="SIMPLE KML" badgeVariant="sky" />

          <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

          {/* Project Dropdown Button */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
              className="h-9 px-3 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-[13px] font-medium text-slate-800 flex items-center gap-2 max-w-[200px] sm:max-w-[260px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 transition-colors duration-150 whitespace-nowrap"
              title={currentProject.title}
            >
              <FolderOpen className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="truncate text-slate-800 font-medium text-[13px] whitespace-nowrap">
                {currentProject.title}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {isProjectDropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 text-[10px] uppercase font-mono tracking-wider text-slate-400 font-bold border-b border-slate-100">
                  Select Project Drawing
                </div>
                <div className="py-1 space-y-0.5 max-h-60 overflow-y-auto">
                  {projectsList.map((p) => {
                    const isCurrent = p.id === currentProjectId;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          loadProject(p.id);
                          setIsProjectDropdownOpen(false);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors whitespace-nowrap ${
                          isCurrent
                            ? "bg-blue-50 text-blue-900 font-bold border border-blue-200/70"
                            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                        }`}
                      >
                        <span className="truncate whitespace-nowrap">{p.title}</span>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

          {/* Secondary Action: Split Compare (Moved right beside project selector) */}
          <button
            onClick={() => setIsSplitCompare(!isSplitCompare)}
            title="Toggle Split-Screen Compare Mode"
            className={`h-9 px-3 rounded-lg border text-[13px] font-medium flex items-center gap-2 transition-colors duration-150 whitespace-nowrap shadow-[0_1px_2px_rgba(15,23,42,0.04)] active:scale-98 ${
              isSplitCompare
                ? "bg-blue-600 text-white border-blue-700 font-semibold"
                : "border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 hover:border-slate-300"
            }`}
          >
            <Columns className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="whitespace-nowrap">
              {isSplitCompare ? "Exit Split View" : "Split Compare"}
            </span>
          </button>
        </div>

        {/* Center: Open & Spacious */}
        <div className="flex-1" />

        {/* Right: Fullscreen & Master Unified Mode Switcher */}
        <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="h-9 w-9 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 transition-colors duration-150 active:scale-98 shrink-0"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

          {/* Master Tool Switcher (Exact Same Component & Sizing Across All Modes) */}
          <GlobalModeSwitcher activeMode="simple" />
        </div>
      </header>

      {/* Main Map Canvas Area */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-slate-100">
        {isSplitCompare ? (
          <SplitCompareView
            projectData={projectData}
            activeLayers={activeLayers}
            overlayOpacity={overlayOpacity}
            baseMap={baseMap}
            setBaseMap={setBaseMap}
          />
        ) : (
          <SimpleKmlMap
            projectData={projectData}
            activeLayers={activeLayers}
            toggleLayer={toggleLayer}
            overlayOpacity={overlayOpacity}
            setOverlayOpacity={setOverlayOpacity}
            baseMap={baseMap}
            setBaseMap={setBaseMap}
          />
        )}
      </main>
    </div>
  );
}
