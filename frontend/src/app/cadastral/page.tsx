"use client";

import React, { Suspense } from "react";
import { SurveyStudio } from "@/components/cadastral/SurveyStudio";
import { Loader2 } from "lucide-react";

export default function CadastralPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-600 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="font-mono text-xs font-semibold">
            Loading Cadastral GIS Platform...
          </span>
        </div>
      }
    >
      <SurveyStudio />
    </Suspense>
  );
}