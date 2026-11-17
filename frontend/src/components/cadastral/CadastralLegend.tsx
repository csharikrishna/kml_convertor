"use client";

import React, { useState, useRef } from "react";
import { ChevronDown, ChevronUp, Layers, GripHorizontal, RotateCcw } from "lucide-react";

export function CadastralLegend() {
  const [isOpen, setIsOpen] = useState(true);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only primary mouse button or touch
    if (e.button !== 0) return;
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragRef.current) return;
    e.stopPropagation();

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    setOffset({
      x: dragRef.current.startOffsetX + dx,
      y: dragRef.current.startOffsetY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    e.stopPropagation();

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const resetPosition = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOffset({ x: 0, y: 0 });
  };

  const isMoved = offset.x !== 0 || offset.y !== 0;

  return (
    <div
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        transition: isDragging ? "none" : "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className="absolute bottom-8 left-14 sm:left-16 z-20 pointer-events-auto select-none"
    >
      <div
        className={`bg-white/95 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 min-w-[215px] shadow-md backdrop-blur-xs transition-shadow duration-200 ${
          isDragging ? "shadow-2xl ring-2 ring-blue-500/25 cursor-grabbing" : ""
        }`}
      >
        {/* Draggable Header */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`flex items-center justify-between font-bold text-[10px] uppercase tracking-wider text-slate-500 cursor-grab active:cursor-grabbing group select-none touch-none ${
            isOpen ? "pb-1.5 border-b border-slate-100" : ""
          }`}
          title="Drag to move map legend anywhere on the screen"
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
            <GripHorizontal className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-semibold text-slate-700 tracking-normal normal-case text-xs">Map Legend</span>
          </div>

          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            {isMoved && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={resetPosition}
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                title="Reset legend position"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen((prev) => !prev);
              }}
              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              title={isOpen ? "Collapse legend" : "Expand legend"}
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="pt-2 space-y-1.5 text-[11px] font-medium text-slate-700">
            {/* Canal Alignment */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-1 bg-blue-700 rounded-full" />
              <span>Canal Alignment Centerline</span>
            </div>

            {/* Canal Buffer */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-3 bg-sky-400/40 border border-sky-500 rounded" />
              <span>Canal Buffer (Proposed RoW)</span>
            </div>

            {/* Selected Parcel */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-3 bg-amber-400/30 border-2 border-amber-500 rounded" />
              <span>Selected Survey Plot</span>
            </div>

            {/* Survey Plot Boundary */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-3 bg-emerald-500/20 border border-blue-600 rounded" />
              <span>Survey Plots (Ryotwari Patta)</span>
            </div>

            {/* Govt Poramboke */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-3 bg-slate-400/20 border border-slate-500 border-dashed rounded" />
              <span>Govt Poramboke / Corridor</span>
            </div>

            {/* Road */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-0.5 bg-red-600 rounded-full" />
              <span>Road / Cart Track</span>
            </div>

            {/* Village Boundary */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-0.5 border-t-2 border-purple-600 border-dashed" />
              <span>Village Revenue Boundary</span>
            </div>

            {/* Chainage */}
            <div className="flex items-center gap-2.5">
              <div className="w-3.5 h-3.5 rounded bg-blue-50 border border-blue-600 flex items-center justify-center text-[8px] font-mono text-blue-700 font-bold">
                Ch
              </div>
              <span>Chainage Markers</span>
            </div>

            {/* Structure */}
            <div className="flex items-center gap-2.5">
              <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-slate-800" />
              <span>Structures (Culvert/Regulator)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
