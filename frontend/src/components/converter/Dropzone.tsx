"use client";

import React, { useRef, useState } from "react";
import { UploadCloud, FileText, X, Sparkles, AlertCircle, ShieldCheck } from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";
import { fetchSampleDrawingFile } from "@/lib/api/client";
import { validateCadFileClientSide } from "@/lib/gis/cadValidator";

export function Dropzone() {
  const {
    file,
    status,
    dwgSupported,
    maxUploadMb,
    isSampleLoading,
    setFile,
    setErrorMessage,
    setIsSampleLoading,
  } = useConverterStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const [cadVersionLabel, setCadVersionLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedExts = dwgSupported ? [".dxf", ".dwg"] : [".dxf"];

  const validateAndSetFile = async (f: File) => {
    const ext = `.${f.name.split(".").pop()?.toLowerCase()}`;
    if (!acceptedExts.includes(ext)) {
      setErrorMessage(
        dwgSupported
          ? "Invalid file format. Please upload a .dxf or .dwg AutoCAD drawing."
          : "Invalid file format. Please upload a .dxf AutoCAD drawing."
      );
      return;
    }

    if (f.size > maxUploadMb * 1024 * 1024) {
      setErrorMessage(
        `File too large (${(f.size / (1024 * 1024)).toFixed(
          1
        )} MB). Maximum allowed upload size is ${maxUploadMb} MB.`
      );
      return;
    }

    // Client-side header and magic signature pre-validation
    const validation = await validateCadFileClientSide(f);
    if (!validation.isValid) {
      setErrorMessage(validation.error || "Corrupted CAD drawing file.");
      return;
    }

    setCadVersionLabel(validation.versionString || null);
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (status === "uploading" || status === "converting") return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleSampleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsSampleLoading(true);
      const sample = await fetchSampleDrawingFile();
      setFile(sample);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load sample drawing.");
    } finally {
      setIsSampleLoading(false);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedExts.join(",")}
        onChange={handleFileInput}
        className="hidden"
      />

      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragOver
              ? "border-blue-500 bg-blue-50/60 scale-[0.99]"
              : "border-slate-200 bg-slate-50/50 hover:bg-slate-100/60 hover:border-slate-300"
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
            <UploadCloud className="w-6 h-6" />
          </div>

          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            Drag & drop CAD drawing here
          </h3>

          <p className="text-xs text-slate-500 mb-3">
            Supports {dwgSupported ? ".DXF and .DWG" : ".DXF"} files up to{" "}
            {maxUploadMb} MB
          </p>

          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 shadow-xs hover:bg-slate-50"
            >
              Browse Files
            </button>

            <button
              type="button"
              onClick={handleSampleClick}
              disabled={isSampleLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isSampleLoading ? "Loading..." : "Try Sample"}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-blue-200 bg-blue-50/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm font-bold text-xs uppercase">
              {file.name.split(".").pop()}
            </div>
            <div className="truncate">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {file.name}
              </div>
              <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                <span>{formatFileSize(file.size)}</span>
                {cadVersionLabel && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-sans font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    {cadVersionLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRemove}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/80 transition-colors"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
