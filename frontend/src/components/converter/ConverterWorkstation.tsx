"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout/Header";
import { MobileTabs } from "@/components/layout/MobileTabs";
import { StatusBar } from "@/components/layout/StatusBar";
import { Dropzone } from "@/components/converter/Dropzone";
import { ConversionForm } from "@/components/converter/ConversionForm";
import { AdvancedOptions } from "@/components/converter/AdvancedOptions";
import { ProgressCard } from "@/components/converter/ProgressCard";
import { ResultsCard } from "@/components/converter/ResultsCard";
import { MapControls } from "@/components/map/MapControls";
import { LayerPanel } from "@/components/map/LayerPanel";
import { MapSearch } from "@/components/map/MapSearch";
import { MeasurementDock } from "@/components/measurement/MeasurementDock";
import { FeatureInspector } from "@/components/inspector/FeatureInspector";
import { PdfExportModal } from "@/components/export/PdfExportModal";
import { ShareModal } from "@/components/sharing/ShareModal";
import { useGisStore } from "@/stores/useGisStore";

const LeafletMap = dynamic(
  () => import("@/components/map/LeafletMap").then((mod) => mod.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400 text-xs font-mono">
        Initializing CAD to GIS Map Engine...
      </div>
    ),
  }
);

export function ConverterWorkstation() {
  const { activeMobileTab } = useGisStore();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 select-none">
      <Header />
      <MobileTabs />

      {/* Main Workstation Studio Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Converter Sidebar */}
        <aside
          className={`w-full lg:w-[420px] xl:w-[460px] h-full overflow-y-auto border-r border-slate-200 bg-white p-4 sm:p-5 flex flex-col gap-4 shrink-0 z-10 transition-transform ${
            activeMobileTab === "map" ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              AutoCAD to GIS Converter
            </h2>
            <p className="text-xs text-slate-500">
              Convert DWG/DXF drawings into accurate Google Earth KML & KMZ files.
            </p>
          </div>

          <Dropzone />
          <ConversionForm />
          <AdvancedOptions />
          <ProgressCard />
          <ResultsCard />

          <div className="mt-auto pt-4 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between font-mono">
            <span>v3.0.0 SaaS Edition</span>
            <span>WGS84 Transverse Mercator</span>
          </div>
        </aside>

        {/* Right GIS Interactive Map Viewport */}
        <main
          className={`flex-1 h-full relative overflow-hidden bg-slate-900 ${
            activeMobileTab === "converter" ? "hidden lg:block" : "block"
          }`}
        >
          <LeafletMap />
          <MapSearch />
          <MapControls />
          <LayerPanel />
          <MeasurementDock />
          <FeatureInspector />
        </main>
      </div>

      <StatusBar />
      <PdfExportModal />
      <ShareModal />
    </div>
  );
}