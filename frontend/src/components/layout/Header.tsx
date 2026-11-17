"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import {
  Share2,
  FileDown,
  Layers,
  Sparkles,
  Download,
  Ruler,
  FileCode,
} from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";
import { useGisStore } from "@/stores/useGisStore";
import { checkBackendHealth, fetchSampleDrawingFile } from "@/lib/api/client";
import { GlobalBrandAnchor } from "@/components/layout/GlobalBrandAnchor";
import { GlobalModeSwitcher } from "@/components/layout/GlobalModeSwitcher";
import { BackendWakeButton } from "@/components/layout/BackendWakeButton";

interface HeaderProps {
  isSharedView?: boolean;
  sharedFileName?: string;
  sharedExpiryStr?: string;
  sharedDownloadUrl?: string;
}

export function Header({
  isSharedView = false,
  sharedFileName,
  sharedExpiryStr,
  sharedDownloadUrl,
}: HeaderProps) {
  const {
    file,
    result,
    isSampleLoading,
    setFile,
    setIsSampleLoading,
    setServerCapabilities,
  } = useConverterStore();

  const {
    geojson,
    isLayerPanelOpen,
    isMeasuring,
    setIsMeasuring,
    toggleLayerPanel,
    setIsShareModalOpen,
    setIsPdfModalOpen,
  } = useGisStore();

  useEffect(() => {
    if (!isSharedView) {
      checkBackendHealth()
        .then((h) => {
          setServerCapabilities(h.dwg_supported, h.limits.max_upload_mb);
        })
        .catch(() => {
          // Keep defaults if health check is unreachable yet
        });
    }
  }, [isSharedView, setServerCapabilities]);

  const handleLoadSample = async () => {
    try {
      setIsSampleLoading(true);
      const sampleFile = await fetchSampleDrawingFile();
      setFile(sampleFile);
    } catch (err: any) {
      alert(err.message || "Failed to load sample drawing.");
    } finally {
      setIsSampleLoading(false);
    }
  };

  const hasData = Boolean(geojson || result);

  return (
    <header className="h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-5 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-[0_1px_2px_rgba(15,23,42,0.04)] select-none whitespace-nowrap">
      {/* Left: Branding & Drawing Context */}
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        <GlobalBrandAnchor badge="CONVERTER" badgeVariant="emerald" />

        <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

        {/* Current Drawing Context Pill */}
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200/90 bg-white text-slate-800 text-[13px] font-medium max-w-[200px] sm:max-w-[260px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] whitespace-nowrap">
          <FileCode className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="truncate whitespace-nowrap">
            {isSharedView
              ? sharedFileName || "Shared CAD Drawing"
              : file
              ? file.name
              : "Althur Padu Bund (KM 216-220)"}
          </span>
        </div>

        {sharedExpiryStr && (
          <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>Expires in {sharedExpiryStr}</span>
          </span>
        )}
      </div>

      {/* Center: Open & Spacious */}
      <div className="flex-1" />

      {/* Right Actions & Master Mode Switcher */}
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        <BackendWakeButton />

        {!isSharedView && !hasData && (
          <button
            type="button"
            onClick={handleLoadSample}
            disabled={isSampleLoading}
            className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-150 disabled:opacity-50 whitespace-nowrap active:scale-98"
            title="Load sample drawing (Althur Padu Bund)"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="whitespace-nowrap">
              {isSampleLoading ? "Loading..." : "Load Sample DWG"}
            </span>
          </button>
        )}

        {hasData && (
          <>
            <button
              type="button"
              onClick={() => setIsMeasuring(!isMeasuring)}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors duration-150 border whitespace-nowrap shadow-[0_1px_2px_rgba(15,23,42,0.04)] active:scale-98 ${
                isMeasuring
                  ? "bg-cyan-50 text-cyan-700 border-cyan-300 font-semibold"
                  : "bg-white text-slate-700 hover:text-slate-900 border-slate-200/90 hover:bg-slate-50"
              }`}
              title="Toggle Geodesic Measurement Tool"
            >
              <Ruler className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Measure</span>
            </button>

            <button
              type="button"
              onClick={toggleLayerPanel}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors duration-150 border whitespace-nowrap shadow-[0_1px_2px_rgba(15,23,42,0.04)] active:scale-98 ${
                isLayerPanelOpen
                  ? "bg-blue-50 text-blue-700 border-blue-300 font-semibold"
                  : "bg-white text-slate-700 hover:text-slate-900 border-slate-200/90 hover:bg-slate-50"
              }`}
              title="Toggle Layer Visibility & Opacity"
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Layers</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPdfModalOpen(true)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-150 whitespace-nowrap active:scale-98"
              title="Export High-DPI Engineering PDF"
            >
              <FileDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">Export PDF</span>
            </button>

            {isSharedView && sharedDownloadUrl && (
              <a
                href={sharedDownloadUrl}
                download
                className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all whitespace-nowrap active:scale-98"
                title="Download Converted KML/KMZ File"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Download KML</span>
              </a>
            )}

            {!isSharedView && (
              <button
                type="button"
                onClick={() => setIsShareModalOpen(true)}
                className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-700 shadow-[0_2px_8px_rgba(37,99,235,0.25)] transition-all whitespace-nowrap active:scale-98"
                title="Create Shareable Workstation Link"
              >
                <Share2 className="w-3.5 h-3.5 text-blue-100 shrink-0" />
                <span className="hidden sm:inline whitespace-nowrap">Share</span>
              </button>
            )}
          </>
        )}

        <div className="h-5 w-px bg-slate-200 hidden sm:block shrink-0" />

        {/* Master Tool Switcher (Exact Same Across All Modes) */}
        <GlobalModeSwitcher activeMode="converter" />
      </div>
    </header>
  );
}
