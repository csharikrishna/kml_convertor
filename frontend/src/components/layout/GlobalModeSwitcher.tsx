"use client";

import React from "react";
import Link from "next/link";
import { Layers, Compass, ArrowLeftRight } from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";

interface GlobalModeSwitcherProps {
  activeMode: "studio" | "simple" | "converter";
}

export function GlobalModeSwitcher({ activeMode }: GlobalModeSwitcherProps) {
  const { setAppMode } = useGisStore();

  return (
    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-[13px] font-medium whitespace-nowrap shrink-0 shadow-inner select-none">
      <Link
        href="/cadastral"
        onClick={() => setAppMode("survey_studio")}
        title="Full Cadastral Survey & RoW GIS Studio (/cadastral)"
        className={`h-8 px-3 rounded-md flex items-center gap-1.5 transition-all duration-150 whitespace-nowrap ${
          activeMode === "studio"
            ? "bg-white text-blue-700 font-semibold shadow-xs border border-slate-200/60"
            : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
        }`}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">Studio</span>
      </Link>

      <Link
        href="/simple-view"
        title="Clean Simple KML Overlay & Compare View (/simple-view)"
        className={`h-8 px-3 rounded-md flex items-center gap-1.5 transition-all duration-150 whitespace-nowrap ${
          activeMode === "simple"
            ? "bg-white text-blue-700 font-semibold shadow-xs border border-slate-200/60"
            : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
        }`}
      >
        <Compass className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">Simple KML</span>
      </Link>

      <Link
        href="/converter"
        onClick={() => setAppMode("converter")}
        title="AutoCAD to KML Converter Tool (/converter)"
        className={`h-8 px-3 rounded-md flex items-center gap-1.5 transition-all duration-150 whitespace-nowrap ${
          activeMode === "converter"
            ? "bg-white text-blue-700 font-semibold shadow-xs border border-slate-200/60"
            : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
        }`}
      >
        <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">Converter</span>
      </Link>
    </div>
  );
}
