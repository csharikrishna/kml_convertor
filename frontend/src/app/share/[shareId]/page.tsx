"use client";

import React, { useEffect, useState, use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { StatusBar } from "@/components/layout/StatusBar";
import { MapControls } from "@/components/map/MapControls";
import { LayerPanel } from "@/components/map/LayerPanel";
import { MapSearch } from "@/components/map/MapSearch";
import { MeasurementDock } from "@/components/measurement/MeasurementDock";
import { FeatureInspector } from "@/components/inspector/FeatureInspector";
import { PdfExportModal } from "@/components/export/PdfExportModal";
import { useGisStore } from "@/stores/useGisStore";
import { fetchSharedGeoJson, getSharedDownloadUrl } from "@/lib/api/client";
import {
  Clock,
  Download,
  AlertCircle,
  FileQuestion,
  Loader2,
  ArrowLeft,
} from "lucide-react";

const LeafletMap = dynamic(
  () => import("@/components/map/LeafletMap").then((mod) => mod.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400 text-xs">
        Loading Shared CAD Project...
      </div>
    ),
  }
);

interface SharePageProps {
  params: Promise<{ shareId: string }>;
}

export default function ShareViewerPage({ params }: SharePageProps) {
  const resolvedParams = use(params);
  const shareId = resolvedParams.shareId;

  const { setGeoJson } = useGisStore();
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [docName, setDocName] = useState<string>("CAD Drawing");

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    fetchSharedGeoJson(shareId)
      .then((data) => {
        if (!isMounted) return;
        setGeoJson(data);
        if (data.filename) setDocName(data.filename);
        setIsLoading(false);
      })
      .catch((err: any) => {
        if (!isMounted) return;
        setErrorStatus(err.status || 404);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [shareId, setGeoJson]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <h2 className="text-sm font-semibold tracking-wide">
          Loading Shared GIS Workstation...
        </h2>
      </div>
    );
  }

  if (errorStatus === 410 || errorStatus === 404) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-900">
              {errorStatus === 410
                ? "This Shared Link Has Expired"
                : "Shared CAD Project Not Found"}
            </h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              Shared links automatically expire to protect drawing confidentiality
              and free server resources. Please request a fresh link or upload the
              drawing directly.
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go to CAD2KML Converter</span>
          </Link>
        </div>
      </div>
    );
  }

  const downloadUrl = getSharedDownloadUrl(shareId);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-900">
      <Header
        isSharedView={true}
        sharedFileName={docName}
        sharedDownloadUrl={downloadUrl}
      />

      <main className="flex-1 relative overflow-hidden">
        <LeafletMap />
        <MapSearch />
        <MapControls />
        <LayerPanel />
        <MeasurementDock />
        <FeatureInspector />

        {/* Floating Shared Download Button on Top Left */}
        <div className="absolute top-16 left-4 z-10 block">
          <a
            href={downloadUrl}
            className="glass-panel px-3.5 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-white/95 flex items-center gap-2 shadow-md hover:bg-white transition-all text-decoration-none border border-emerald-200"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>Download KML/KMZ</span>
          </a>
        </div>
      </main>

      <StatusBar />
      <PdfExportModal />
    </div>
  );
}
