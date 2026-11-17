"use client";

import React from "react";
import {
  Download,
  Share2,
  FileDown,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";
import { useGisStore } from "@/stores/useGisStore";
import { getDownloadUrl } from "@/lib/api/client";

export function ResultsCard() {
  const { result } = useConverterStore();
  const { setIsShareModalOpen, setIsPdfModalOpen } = useGisStore();

  if (!result || !result.success) return null;

  const stats = result.stats || {};
  const downloadUrl = getDownloadUrl(result.job_id, result.filename);

  return (
    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <div>
            <h4 className="text-xs font-bold text-slate-900">
              Conversion Successful
            </h4>
            <div className="text-[11px] font-mono text-slate-500">
              {result.filename}
            </div>
          </div>
        </div>

        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
          READY
        </span>
      </div>

      {/* Primary Download Button */}
      <a
        href={downloadUrl}
        download={result.filename}
        className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-sm transition-all flex items-center justify-center gap-2 text-decoration-none"
      >
        <Download className="w-4 h-4" />
        <span>Download {result.filename}</span>
      </a>

      {/* Secondary Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setIsPdfModalOpen(true)}
          className="py-1.5 px-3 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs flex items-center justify-center gap-1.5"
        >
          <FileDown className="w-3.5 h-3.5 text-rose-600" />
          <span>Save PDF</span>
        </button>

        <button
          type="button"
          onClick={() => setIsShareModalOpen(true)}
          className="py-1.5 px-3 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs flex items-center justify-center gap-1.5"
        >
          <Share2 className="w-3.5 h-3.5 text-blue-600" />
          <span>Share Link</span>
        </button>
      </div>

      {/* Statistics Grid */}
      <div className="pt-2 border-t border-emerald-200/60 grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
          <div className="text-slate-400">Total Entities</div>
          <div className="font-mono font-bold text-slate-800">
            {stats.total_entities?.toLocaleString() ?? "—"}
          </div>
        </div>

        <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
          <div className="text-slate-400">Total Vertices</div>
          <div className="font-mono font-bold text-slate-800">
            {stats.total_vertices?.toLocaleString() ?? "—"}
          </div>
        </div>

        <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
          <div className="text-slate-400">Shapes (Lines/Poly)</div>
          <div className="font-mono font-bold text-slate-800">
            {stats.total_shapes?.toLocaleString() ?? "—"}
          </div>
        </div>

        <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
          <div className="text-slate-400">Markers & Labels</div>
          <div className="font-mono font-bold text-slate-800">
            {stats.total_markers?.toLocaleString() ?? "—"}
          </div>
        </div>
      </div>

      {/* Warnings if any */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] space-y-1">
          <div className="font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>Conversion Warnings ({result.warnings.length})</span>
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-amber-700">
            {result.warnings.slice(0, 3).map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
