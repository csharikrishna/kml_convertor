"use client";

import React, { Suspense } from "react";
import { ConverterWorkstation } from "@/components/converter/ConverterWorkstation";
import { Loader2 } from "lucide-react";

export default function ConverterPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-600 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="font-mono text-xs font-semibold">
            Loading CAD to KML Converter...
          </span>
        </div>
      }
    >
      <ConverterWorkstation />
    </Suspense>
  );
}