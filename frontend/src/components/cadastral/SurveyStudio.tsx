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
import { useCadastralStore } from "@/stores/useCadastralStore";
import { Loader2 } from "lucide-react";

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

  const initializedRef = useRef(false);

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

  // Robust deep-linking: If a specific survey plot was requested in URL (?sy=236), locate and fly-to directly
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
    </div>
  );
}
