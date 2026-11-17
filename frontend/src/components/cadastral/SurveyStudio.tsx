"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CadastralHeader } from "./CadastralHeader";
import { CadastralLayerControl } from "./CadastralLayerControl";
import { CadastralPlotDetails } from "./CadastralPlotDetails";
import { CadastralLegend } from "./CadastralLegend";
import { CadastralTableModal } from "./CadastralTableModal";
import { CadastralUploadModal } from "./CadastralUploadModal";
import { ShareModal } from "@/components/sharing/ShareModal";
import { useCadastralStore, SurveyPlotRecord } from "@/stores/useCadastralStore";
import { Loader2, Globe, ExternalLink, MapPin, X } from "lucide-react";

const CadastralMap = dynamic(
  () => import("./CadastralMap").then((mod) => mod.CadastralMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-500 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="font-mono text-xs tracking-wider font-semibold text-slate-700">
          Initializing Cadastral GIS Vector Engine...
        </span>
      </div>
    ),
  }
);

export function SurveyStudio() {
  const {
    currentProjectId,
    projectData,
    isLoading,
    loadProject,
    fetchProjectsList,
    selectedPlot,
    setSelectedPlot,
    setTargetFlyToBounds,
  } = useCadastralStore();

  const searchParams = useSearchParams();
  const urlProject = searchParams?.get("project");
  const urlSurveyNo = searchParams?.get("sy");

  const [showEarthPrompt, setShowEarthPrompt] = useState(false);
  const [promptPlot, setPromptPlot] = useState<SurveyPlotRecord | null>(null);
  const promptedPlotRef = useRef<string | null>(null);

  const initializedRef = useRef(false);

  const getGoogleEarthUrl = useCallback((plot: SurveyPlotRecord): string => {
    let lat = plot.center?.[0];
    let lng = plot.center?.[1];
    if ((lat === undefined || lng === undefined) && plot.bounds) {
      lat = (plot.bounds[0][0] + plot.bounds[1][0]) / 2;
      lng = (plot.bounds[0][1] + plot.bounds[1][1]) / 2;
    }
    if (lat !== undefined && lng !== undefined) {
      return `https://earth.google.com/web/@${lat.toFixed(6)},${lng.toFixed(6)},420a,500d,35y,0h,45t,0r`;
    }
    return "https://earth.google.com/web/";
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      fetchProjectsList();
      const targetProj = urlProject || currentProjectId;
      if (!projectData || currentProjectId !== targetProj) {
        loadProject(targetProj);
      }
    }
  }, [fetchProjectsList, loadProject, currentProjectId, projectData, urlProject]);

  // Robust deep-linking: If a specific survey plot was requested in URL (?sy=236), locate, fly-to, and prompt
  useEffect(() => {
    if (urlSurveyNo && projectData?.survey_register && projectData.survey_register.length > 0) {
      const cleanQuery = urlSurveyNo.trim().toLowerCase();
      const cleanNum = cleanQuery.replace(/\D+/g, "");

      const match = projectData.survey_register.find((p) => {
        const pNo = p.survey_no.trim().toLowerCase();
        const pNum = pNo.replace(/\D+/g, "");
        if (pNo === cleanQuery) return true;
        if (cleanNum && pNum === cleanNum) return true;
        if (pNo.includes(cleanQuery) || cleanQuery.includes(pNo)) return true;
        return false;
      });

      if (match) {
        if (selectedPlot?.survey_no !== match.survey_no) {
          setSelectedPlot(match);
        }
        if (match.bounds) {
          setTargetFlyToBounds(match.bounds);
        }
        if (promptedPlotRef.current !== match.survey_no) {
          promptedPlotRef.current = match.survey_no;
          setPromptPlot(match);
          setShowEarthPrompt(true);
        }
      }
    }
  }, [urlSurveyNo, projectData, selectedPlot, setSelectedPlot, setTargetFlyToBounds]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 select-none">
      {/* Top Application Bar */}
      <CadastralHeader />

      {/* Main Studio Viewport */}
      <div className="flex-1 relative overflow-hidden">
        {/* Interactive Leaflet Cadastral Map */}
        <CadastralMap />

        {/* Left Vertical Ribbon & Layer Control */}
        <CadastralLayerControl />

        {/* Right Contextual Survey Plot Details Inspector */}
        <CadastralPlotDetails />

        {/* Bottom Left Floating Legend */}
        <CadastralLegend />

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-30 bg-slate-900/30 backdrop-blur-xs flex flex-col items-center justify-center gap-2.5 text-white">
            <div className="p-5 bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col items-center gap-3 text-slate-800">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <div className="text-xs font-bold tracking-wide text-slate-900">
                Parsing Cadastral Parcels & Computing Canal Intersections...
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Generating Planar Polygons & Topological Overlay
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Dialogs */}
      <CadastralTableModal />
      <CadastralUploadModal />
      <ShareModal />

      {/* Google Earth Web 3D Prompt Dialog (triggered on deep-linked survey plots ?sy=236) */}
      {showEarthPrompt && promptPlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-5 text-slate-800 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Globe className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <span>Survey Plot {promptPlot.survey_no}</span>
                    {promptPlot.canal_passing && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                        Canal Intersected
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {promptPlot.village} • {promptPlot.mandal} • {promptPlot.total_acres} ac
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEarthPrompt(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              This survey plot has been located from your link. Would you like to launch Google Earth in your browser or explore in Cadastral GIS?
            </p>

            <div className="space-y-2 pt-1">
              {/* Option 1: Google Earth Web (3D browser app) */}
              <a
                href={getGoogleEarthUrl(promptPlot)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowEarthPrompt(false)}
                className="group w-full p-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50/70 hover:from-blue-100 hover:to-indigo-100 text-left flex items-center justify-between transition-all shadow-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                      <span>Open in Google Earth Web (3D)</span>
                      <ExternalLink className="w-3 h-3 text-blue-600 opacity-70 group-hover:opacity-100" />
                    </div>
                    <div className="text-[11px] text-blue-800/80">
                      View terrain, 3D satellite imagery & isometric tilt in browser
                    </div>
                  </div>
                </div>
              </a>

              {/* Option 2: Cadastral GIS Workstation */}
              <button
                type="button"
                onClick={() => {
                  setShowEarthPrompt(false);
                  if (promptPlot.bounds) setTargetFlyToBounds(promptPlot.bounds);
                }}
                className="w-full p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-left flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Explore in Cadastral GIS
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Inspect canal alignment, boundaries & land acquisition register
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
