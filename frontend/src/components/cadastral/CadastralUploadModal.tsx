"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  FileCode,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderPlus,
  Trash2,
  Layers,
  Sparkles,
  Info,
  Check,
} from "lucide-react";
import { useCadastralStore } from "@/stores/useCadastralStore";

export function CadastralUploadModal() {
  const {
    isUploadModalOpen,
    setUploadModalOpen,
    loadProject,
    fetchProjectsList,
    setProjectData,
    setSelectedPlot,
  } = useCadastralStore();

  const [projectTitle, setProjectTitle] = useState("");
  const [villageName, setVillageName] = useState("");
  const [mandalName, setMandalName] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [crs, setCrs] = useState("EPSG:32643");
  const [canalBuffer, setCanalBuffer] = useState("12.5");

  // 3 Files
  const [dwgFile, setDwgFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingStage, setProcessingStage] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dwgInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  if (!isUploadModalOpen) return null;

  const handleDwgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setDwgFile(selected);
      if (!villageName) {
        const base = selected.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[^a-zA-Z0-9]/g, " ")
          .trim();
        const detectedVillage = base.split(" ")[0] || "Custom Village";
        setVillageName(detectedVillage);
        if (!projectTitle) {
          setProjectTitle(`${detectedVillage} Village Project`);
        }
      }
    }
  };

  const handleExcelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setExcelFile(e.target.files[0]);
    }
  };

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPdfFile(e.target.files[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dwgFile) {
      setErrorMsg("Please select an AutoCAD DWG or DXF drawing file.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setProcessingStage(1);

    const formData = new FormData();
    formData.append("drawing_file", dwgFile);
    formData.append("title", projectTitle.trim() || `${villageName || "Village"} Project`);
    formData.append("village_name", villageName.trim() || "Village");
    formData.append("mandal_name", mandalName.trim() || "Mandal");
    formData.append("district_name", districtName.trim() || "District");
    formData.append("crs", crs);
    formData.append("canal_buffer", canalBuffer);

    if (excelFile) {
      formData.append("excel_file", excelFile);
    }
    if (pdfFile) {
      formData.append("pdf_file", pdfFile);
    }

    // Stage progression timer simulation for UX
    const stageTimer1 = setTimeout(() => setProcessingStage(2), 2000);
    const stageTimer2 = setTimeout(() => setProcessingStage(3), 4000);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "";
      let res: Response;
      try {
        res = await fetch(`${apiBase}/api/cadastral/projects/create`, {
          method: "POST",
          body: formData,
        });
      } catch (directErr) {
        console.warn("Direct upload to Render blocked or failed, retrying via Next.js proxy route...", directErr);
        res = await fetch(`/api/cadastral/projects/create`, {
          method: "POST",
          body: formData,
        });
      }

      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Render compute backend is running an older deployment without the project creation endpoint. In your Render Dashboard, click 'Manual Deploy' > 'Deploy latest commit'.");
        }
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Project creation failed (Status ${res.status})`);
      }

      setProcessingStage(4);
      const result = await res.json();

      // Refresh projects catalog in store
      await fetchProjectsList();

      if (result.project_data) {
        setProjectData(result.project_data);
        if (result.project_data.survey_register && result.project_data.survey_register.length > 0) {
          const affected = result.project_data.survey_register.find((p: any) => p.canal_passing);
          setSelectedPlot(affected || result.project_data.survey_register[0]);
        }
      } else if (result.project_id) {
        await loadProject(result.project_id);
      }

      setIsSubmitting(false);
      setUploadModalOpen(false);
    } catch (err: any) {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setIsSubmitting(false);
      setProcessingStage(0);
      setErrorMsg(err.message || "Failed to create village project.");
    }
  };

  const STAGES = [
    "Preparing project files...",
    "Converting & parsing AutoCAD DWG entities...",
    "Building 2-pass spatial polygon topology & road recovery...",
    "Enriching survey parcels with Land Schedule Pattadars...",
    "Finalizing project workspace & launching GIS viewer...",
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none overflow-y-auto">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[95vh]">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-inner">
              <FolderPlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight text-white flex items-center gap-2">
                Create Village Project Workspace
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-white/20 text-white font-bold tracking-wider">
                  Multi-File Ingestion
                </span>
              </h3>
              <p className="text-xs text-blue-100/90 mt-0.5">
                Create a dedicated project folder for your village map with drawings, land schedules, and records
              </p>
            </div>
          </div>
          <button
            onClick={() => !isSubmitting && setUploadModalOpen(false)}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-800">
          {errorMsg && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2.5 shadow-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div>
                <span className="font-bold block">Processing Error:</span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {isSubmitting ? (
            <div className="py-12 px-6 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center shadow-md">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                  {processingStage}
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-base text-slate-900">
                  {STAGES[processingStage] || "Processing Village Project Workspace..."}
                </h4>
                <p className="text-xs text-slate-500 max-w-md">
                  Parsing closed CAD parcels, calculating canal corridor Right-of-Way, and mapping legal landowner schedules.
                </p>
              </div>

              {/* Step Tracker */}
              <div className="w-full max-w-md bg-slate-100 rounded-full h-2 overflow-hidden mt-4">
                <div
                  className="bg-blue-600 h-full transition-all duration-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(15, processingStage * 25))}%` }}
                />
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 text-xs">
              {/* Section 1: Village & Project Information */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  1. Village & Administrative Information
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      Project Folder Name / Title
                    </label>
                    <input
                      type="text"
                      value={projectTitle}
                      onChange={(e) => setProjectTitle(e.target.value)}
                      placeholder="e.g. Padamatiyaleru Village Canal Phase 2"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none shadow-2xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      Village Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={villageName}
                      onChange={(e) => setVillageName(e.target.value)}
                      placeholder="e.g. Padamatiyaleru"
                      className="w-full h-9 px-3 rounded-lg border border-slate-300 text-xs focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none shadow-2xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-slate-600 font-medium mb-1 text-[11px]">
                      Mandal / Tahsil
                    </label>
                    <input
                      type="text"
                      value={mandalName}
                      onChange={(e) => setMandalName(e.target.value)}
                      placeholder="e.g. Beluguppa"
                      className="w-full h-8 px-2.5 rounded-md border border-slate-200 text-xs focus:border-blue-500 outline-none shadow-2xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1 text-[11px]">
                      District
                    </label>
                    <input
                      type="text"
                      value={districtName}
                      onChange={(e) => setDistrictName(e.target.value)}
                      placeholder="e.g. Anantapur"
                      className="w-full h-8 px-2.5 rounded-md border border-slate-200 text-xs focus:border-blue-500 outline-none shadow-2xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1 text-[11px]">
                      Coordinate System (CRS)
                    </label>
                    <select
                      value={crs}
                      onChange={(e) => setCrs(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-slate-200 text-xs bg-white focus:border-blue-500 outline-none font-mono shadow-2xs"
                    >
                      <option value="EPSG:32643">UTM 43N (AP/Rayalaseema)</option>
                      <option value="EPSG:32644">UTM 44N (Coastal AP/TG)</option>
                      <option value="EPSG:4326">WGS84 Lat/Lon Degrees</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1 text-[11px]">
                      Canal Buffer (m)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={canalBuffer}
                      onChange={(e) => setCanalBuffer(e.target.value)}
                      className="w-full h-8 px-2.5 rounded-md border border-slate-200 text-xs focus:border-blue-500 outline-none font-mono shadow-2xs"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Dedicated File Upload Zones */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-xs uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    2. Upload Project Files & Schedules
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Auto-merges into unified village GIS
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* File 1: AutoCAD DWG/DXF */}
                  <div
                    onClick={() => dwgInputRef.current?.click()}
                    className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[140px] relative ${
                      dwgFile
                        ? "border-blue-500 bg-blue-50/40 shadow-xs"
                        : "border-dashed border-slate-300 hover:border-blue-400 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      ref={dwgInputRef}
                      type="file"
                      accept=".dwg,.dxf"
                      onChange={handleDwgChange}
                      className="hidden"
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                          <FileCode className="w-4 h-4" />
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-600 text-white font-mono">
                          REQUIRED
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900">AutoCAD Drawing</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        .DWG or .DXF survey map
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/80">
                      {dwgFile ? (
                        <div className="flex items-center justify-between text-blue-700 font-medium">
                          <span className="truncate max-w-[130px] font-mono font-bold text-[11px]">
                            {dwgFile.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatFileSize(dwgFile.size)}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-blue-600 font-semibold flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          <span>Choose Drawing</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* File 2: Excel Land Schedule / Coordinates */}
                  <div
                    onClick={() => excelInputRef.current?.click()}
                    className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[140px] relative ${
                      excelFile
                        ? "border-emerald-500 bg-emerald-50/40 shadow-xs"
                        : "border-dashed border-slate-300 hover:border-emerald-400 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleExcelChange}
                      className="hidden"
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                          <FileSpreadsheet className="w-4 h-4" />
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono">
                          OPTIONAL
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900">Land Schedule / Excel</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Pattadars, Khatas, Coordinates
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/80">
                      {excelFile ? (
                        <div className="flex items-center justify-between text-emerald-700 font-medium">
                          <span className="truncate max-w-[130px] font-mono font-bold text-[11px]">
                            {excelFile.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatFileSize(excelFile.size)}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          <span>Choose Excel / CSV</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* File 3: PDF Document */}
                  <div
                    onClick={() => pdfInputRef.current?.click()}
                    className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[140px] relative ${
                      pdfFile
                        ? "border-indigo-500 bg-indigo-50/40 shadow-xs"
                        : "border-dashed border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handlePdfChange}
                      className="hidden"
                    />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                          <FileText className="w-4 h-4" />
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300 font-mono">
                          OPTIONAL
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900">Village Scan / DPR</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        PDF Village Map & Gazette
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/80">
                      {pdfFile ? (
                        <div className="flex items-center justify-between text-indigo-700 font-medium">
                          <span className="truncate max-w-[130px] font-mono font-bold text-[11px]">
                            {pdfFile.name}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatFileSize(pdfFile.size)}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-indigo-600 font-semibold flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          <span>Choose PDF</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl flex items-start gap-2.5 text-blue-900 text-[11px]">
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Automated Legal & Spatial Merging: </span>
                    Uploading an Excel Land Plan Schedule will automatically attach landowner names, passbook numbers, and land classifications to matching CAD survey polygons.
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={!dwgFile || isSubmitting}
                  className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-2 disabled:opacity-50 transition-all shadow-md hover:shadow-lg"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>Create Village Project Folder</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
