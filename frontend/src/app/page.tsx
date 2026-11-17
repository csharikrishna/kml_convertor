"use client";

import React, { Suspense } from "react";
import { SurveyStudio } from "@/components/cadastral/SurveyStudio";
import { ConverterWorkstation } from "@/components/converter/ConverterWorkstation";
import { useGisStore } from "@/stores/useGisStore";
import { Loader2 } from "lucide-react";

function RootWorkspace() {
  const { appMode } = useGisStore();

  if (appMode === "converter") {
    return <ConverterWorkstation />;
  }

  return <SurveyStudio />;
}

export default function WorkstationPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-600 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="font-mono text-xs font-semibold">
            Initializing Spatial Intelligence Platform...
          </span>
        </div>
      }
    >
      <RootWorkspace />
    </Suspense>
  );
}