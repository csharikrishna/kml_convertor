"use client";

import React from "react";
import { FileUp, Map } from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";

export function MobileTabs() {
  const { activeMobileTab, setActiveMobileTab } = useGisStore();

  return (
    <div className="lg:hidden flex border-b border-slate-200 bg-white sticky top-14 z-20">
      <button
        type="button"
        onClick={() => setActiveMobileTab("converter")}
        className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
          activeMobileTab === "converter"
            ? "border-blue-600 text-blue-600 bg-blue-50/50"
            : "border-transparent text-slate-600 hover:text-slate-900"
        }`}
      >
        <FileUp className="w-4 h-4" />
        <span>Converter</span>
      </button>

      <button
        type="button"
        onClick={() => setActiveMobileTab("map")}
        className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
          activeMobileTab === "map"
            ? "border-blue-600 text-blue-600 bg-blue-50/50"
            : "border-transparent text-slate-600 hover:text-slate-900"
        }`}
      >
        <Map className="w-4 h-4" />
        <span>GIS Map</span>
      </button>
    </div>
  );
}
