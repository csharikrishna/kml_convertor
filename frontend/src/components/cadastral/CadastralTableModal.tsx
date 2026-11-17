"use client";

import React, { useState, useMemo } from "react";
import {
  X,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  ExternalLink,
  Filter,
  Layers,
  Compass,
} from "lucide-react";
import { useCadastralStore, SurveyPlotRecord } from "@/stores/useCadastralStore";

export function CadastralTableModal() {
  const {
    isTableModalOpen,
    setTableModalOpen,
    projectData,
    setSelectedPlot,
    currentProjectId,
  } = useCadastralStore();

  const [filterType, setFilterType] = useState<"all" | "affected" | "patta" | "poramboke">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const rows = useMemo(() => {
    if (!projectData?.survey_register) return [];
    return projectData.survey_register.filter((item) => {
      if (filterType === "affected" && !item.canal_passing) return false;
      if (filterType === "patta" && (item as any).is_poramboke) return false;
      if (filterType === "poramboke" && !(item as any).is_poramboke) return false;
      if (
        searchTerm.trim() &&
        !item.survey_no.toLowerCase().includes(searchTerm.toLowerCase().trim())
      ) {
        return false;
      }
      return true;
    });
  }, [projectData, filterType, searchTerm]);

  const pattaCount = useMemo(() => {
    return projectData?.survey_register?.filter((p: any) => !p.is_poramboke).length || 0;
  }, [projectData]);

  const porambokeCount = useMemo(() => {
    return projectData?.survey_register?.filter((p: any) => p.is_poramboke).length || 0;
  }, [projectData]);

  if (!isTableModalOpen || !projectData) return null;

  const summary = projectData.summary;

  const handleSelectAndZoom = (plot: SurveyPlotRecord) => {
    setSelectedPlot(plot);
    setTableModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 select-none">
      <div className="w-full max-w-6xl max-h-[90vh] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col text-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                FORM A LAND PLAN SCHEDULE
              </span>
              <span className="text-slate-500 text-xs">
                Village: <b className="text-slate-900">{projectData.village}</b> • Mandal:{" "}
                <b className="text-slate-900">{projectData.mandal}</b> • District:{" "}
                <b className="text-slate-900">{projectData.district}</b>
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-1">
              Cadastral Survey Register & Land Acquisition Statement
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/api/cadastral/export-table/${currentProjectId}`}
              download
              className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </a>
            <button
              onClick={() => setTableModalOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 p-4 bg-slate-50 border-b border-slate-200 text-xs font-mono">
          <div className="p-3 bg-white border border-slate-200 rounded-lg">
            <span className="text-slate-400 block text-[10px] uppercase font-sans font-semibold">
              Total Plots
            </span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">
              {summary.total_plots}
            </span>
          </div>
          <div className="p-3 bg-white border border-slate-200 rounded-lg">
            <span className="text-slate-400 block text-[10px] uppercase font-sans font-semibold">
              Canal Affected
            </span>
            <span className="text-xl font-bold text-emerald-600 mt-0.5 block">
              {summary.affected_plots}
            </span>
          </div>
          <div className="p-3 bg-white border border-slate-200 rounded-lg">
            <span className="text-slate-400 block text-[10px] uppercase font-sans font-semibold">
              Total Gross Area
            </span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">
              {summary.total_area_acres} ac
            </span>
          </div>
          <div className="p-3 bg-white border border-blue-200 bg-blue-50/40 rounded-lg">
            <span className="text-blue-700 block text-[10px] uppercase font-sans font-semibold">
              Canal Acquired
            </span>
            <span className="text-xl font-bold text-blue-900 mt-0.5 block">
              {summary.acquired_area_acres} ac
            </span>
          </div>
          <div className="p-3 bg-white border border-emerald-200 bg-emerald-50/40 rounded-lg">
            <span className="text-emerald-700 block text-[10px] uppercase font-sans font-semibold">
              Balance Retained
            </span>
            <span className="text-xl font-bold text-emerald-900 mt-0.5 block">
              {summary.balance_area_acres} ac
            </span>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Survey No..."
                className="w-48 sm:w-64 h-8 pl-8 pr-3 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 outline-none font-mono"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                onClick={() => setFilterType("all")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  filterType === "all"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All ({projectData.survey_register.length})
              </button>
              <button
                onClick={() => setFilterType("patta")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  filterType === "patta"
                    ? "bg-white text-blue-900 font-bold shadow-xs border border-blue-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Ryotwari Patta ({pattaCount})
              </button>
              <button
                onClick={() => setFilterType("affected")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  filterType === "affected"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Canal Affected ({summary.affected_plots})
              </button>
              <button
                onClick={() => setFilterType("poramboke")}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  filterType === "poramboke"
                    ? "bg-amber-100 text-amber-900 font-bold shadow-xs border border-amber-300"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Govt Corridors ({porambokeCount})
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500 font-mono">
            Showing <b className="text-slate-900">{rows.length}</b> records
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-mono text-[11px] uppercase tracking-wider z-10">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Survey No.</th>
                <th className="py-2.5 px-3 font-semibold">Village / Mandal</th>
                <th className="py-2.5 px-3 font-semibold">Total Extent</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Canal Acquired</th>
                <th className="py-2.5 px-3 font-semibold">Balance Extent</th>
                <th className="py-2.5 px-3 font-semibold">Chainage Range</th>
                <th className="py-2.5 px-3 font-semibold">Reach</th>
                <th className="py-2.5 px-4 font-semibold text-right">Map Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {rows.map((plot) => (
                <tr
                  key={plot.survey_no}
                  className={`hover:bg-blue-50/50 transition-colors ${
                    plot.canal_passing ? "bg-white" : "bg-slate-50/30"
                  }`}
                >
                  <td className="py-2.5 px-4 font-bold text-slate-900">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>Sy. No. {plot.survey_no}</span>
                      {(plot as any).is_poramboke && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200 font-sans">
                          Govt Land
                        </span>
                      )}
                    </div>
                    {(plot as any).land_type && (
                      <div className="text-[10px] text-slate-400 font-sans font-normal">
                        {(plot as any).land_type}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 font-sans">
                    {plot.village}, {plot.mandal}
                  </td>
                  <td className="py-2.5 px-3 text-slate-800">
                    <div>{plot.total_acres} ac</div>
                    <div className="text-[10px] text-slate-400 font-sans">
                      {plot.total_ac_cts}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    {plot.canal_passing ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans">
                        Acquisition
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 font-sans">
                        Clean
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-blue-900">
                    {plot.canal_passing ? (
                      <>
                        <div>{plot.acquired_acres} ac</div>
                        <div className="text-[10px] text-blue-600">
                          {plot.acquired_area_m2.toLocaleString()} m²
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-emerald-800">
                    <div>{plot.balance_acres} ac</div>
                    <div className="text-[10px] text-slate-400 font-sans">
                      {plot.balance_area_m2.toLocaleString()} m²
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700">
                    {plot.chainage_range}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700">
                    {plot.canal_length_m > 0 ? `${plot.canal_length_m} m` : "-"}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {plot.center && (
                        <a
                          href={`https://www.google.com/maps?q=${plot.center[0]},${plot.center[1]}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white font-semibold font-sans text-xs flex items-center gap-1 transition-colors"
                          title="Open parcel in Google Maps"
                        >
                          <ExternalLink className="w-3 h-3 text-emerald-600" />
                          <span>Maps</span>
                        </a>
                      )}
                      <button
                        onClick={() => handleSelectAndZoom(plot)}
                        className="px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white font-semibold font-sans text-xs transition-colors"
                      >
                        Locate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">CRS:</span>
            <span className="font-mono">EPSG:4326 (WGS84) / UTM Zone 43N</span>
          </div>
          <button
            onClick={() => setTableModalOpen(false)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-semibold text-slate-700 transition-colors"
          >
            Close Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
