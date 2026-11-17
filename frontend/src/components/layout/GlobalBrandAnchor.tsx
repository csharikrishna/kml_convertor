"use client";

import React from "react";
import Link from "next/link";
import { Layers } from "lucide-react";

interface GlobalBrandAnchorProps {
  badge: "PRO" | "SIMPLE KML" | "CONVERTER";
  badgeVariant?: "blue" | "sky" | "emerald";
}

export function GlobalBrandAnchor({ badge, badgeVariant = "blue" }: GlobalBrandAnchorProps) {
  const badgeClasses = {
    blue: "bg-blue-50 text-blue-700 border-blue-200/70",
    sky: "bg-sky-50 text-sky-700 border-sky-200/70",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
  }[badgeVariant];

  return (
    <Link href="/" className="flex items-center gap-2.5 group select-none whitespace-nowrap shrink-0">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)] shrink-0 group-hover:scale-102 transition-transform">
        <Layers className="w-4 h-4 text-white" />
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="font-extrabold text-sm tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors whitespace-nowrap">
          CAD2KML
        </span>
        <span
          className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded-md border whitespace-nowrap ${badgeClasses}`}
        >
          {badge}
        </span>
      </div>
    </Link>
  );
}
