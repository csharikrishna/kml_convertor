"use client";

import React from "react";
import { Loader2, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";

export function ProgressCard() {
  const { status, uploadPercent, errorMessage } = useConverterStore();

  if (status === "idle" && !errorMessage) return null;

  if (errorMessage) {
    return (
      <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold mb-0.5">Conversion Error</div>
          <p className="text-rose-700 leading-relaxed">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (status === "completed") return null;

  const getStageInfo = () => {
    switch (status) {
      case "uploading":
        return {
          title: `Uploading CAD drawing (${uploadPercent}%)`,
          desc: "Transferring file bytes securely to the conversion server...",
        };
      case "converting":
        return {
          title: "Transforming CAD geometry & CRS",
          desc: "Parsing DWG/DXF entities, applying WGS84 projection, and assembling KML...",
        };
      case "rendering":
        return {
          title: "Generating GIS layer preview",
          desc: "Populating GeoJSON features and initializing map layers...",
        };
      default:
        return {
          title: "Processing...",
          desc: "Please wait while the server completes your request.",
        };
    }
  };

  const stage = getStageInfo();

  return (
    <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          <span className="text-xs font-semibold text-slate-800">
            {stage.title}
          </span>
        </div>
        {status === "uploading" && (
          <span className="text-xs font-mono font-bold text-blue-700">
            {uploadPercent}%
          </span>
        )}
      </div>

      {status === "uploading" && (
        <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-200"
            style={{ width: `${uploadPercent}%` }}
          />
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-tight">{stage.desc}</p>
    </div>
  );
}
