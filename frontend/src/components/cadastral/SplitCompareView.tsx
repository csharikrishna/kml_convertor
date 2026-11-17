"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Layers, ArrowLeftRight, Compass, Sparkles, CheckCircle2 } from "lucide-react";

interface SplitCompareViewProps {
  projectData: any;
  activeLayers: {
    canal: boolean;
    buffer: boolean;
    plots: boolean;
    roads: boolean;
    stations: boolean;
  };
  overlayOpacity: number;
  baseMap: string;
  setBaseMap: (bm: any) => void;
}

export function SplitCompareView({
  projectData,
  activeLayers,
  overlayOpacity,
  baseMap,
}: SplitCompareViewProps) {
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);

  const leftMapRef = useRef<L.Map | null>(null);
  const rightMapRef = useRef<L.Map | null>(null);

  const isSyncingRef = useRef(false);

  // 1. Initialize Dual Synchronized Maps
  useEffect(() => {
    if (!leftContainerRef.current || !rightContainerRef.current) return;
    if (leftMapRef.current || rightMapRef.current) return;

    const initialCenter: L.LatLngExpression = [14.67, 77.28];
    const initialZoom = 14;

    const leftMap = L.map(leftContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 22,
    });

    const rightMap = L.map(rightContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 22,
    });

    // High-resolution satellite basemaps with overzoom support up to 22
    const tileUrl = "https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
    const tileOptions = {
      maxZoom: 22,
      maxNativeZoom: 20,
      subdomains: ["0", "1", "2", "3"],
      errorTileUrl:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    };
    L.tileLayer(tileUrl, tileOptions).addTo(leftMap);
    L.tileLayer(tileUrl, tileOptions).addTo(rightMap);

    // Synchronize Map Panning & Zooming
    const syncMaps = (source: L.Map, target: L.Map) => {
      source.on("move", () => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;
        target.setView(source.getCenter(), source.getZoom(), { animate: false });
        isSyncingRef.current = false;
      });
    };

    syncMaps(leftMap, rightMap);
    syncMaps(rightMap, leftMap);

    leftMapRef.current = leftMap;
    rightMapRef.current = rightMap;

    return () => {
      leftMap.remove();
      rightMap.remove();
      leftMapRef.current = null;
      rightMapRef.current = null;
    };
  }, []);

  // 2. Render Left Pane (Simple KML CAD Overlay)
  useEffect(() => {
    const map = leftMapRef.current;
    if (!map || !projectData?.layers) return;

    // Buffer
    if (activeLayers.buffer && projectData.layers.canal_buffer) {
      L.geoJSON(projectData.layers.canal_buffer, {
        style: {
          color: "#0284c7",
          weight: 1.5,
          fillColor: "#38bdf8",
          fillOpacity: overlayOpacity * 0.35,
          dashArray: "4 4",
        },
      }).addTo(map);
    }

    // Canal Centerline
    if (activeLayers.canal && projectData.layers.canal_alignment) {
      const canalLyr = L.geoJSON(projectData.layers.canal_alignment, {
        style: {
          color: "#0284c7",
          weight: 3.5,
          opacity: overlayOpacity,
        },
      }).addTo(map);

      const b = canalLyr.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [40, 40] });
      }
    }

    // Survey Polylines
    if (activeLayers.plots && projectData.layers.survey_plots) {
      L.geoJSON(projectData.layers.survey_plots, {
        style: {
          color: "#f59e0b",
          weight: 1.8,
          fillColor: "transparent",
        },
      }).addTo(map);
    }
  }, [projectData, activeLayers, overlayOpacity]);

  // 3. Render Right Pane (Analytical Cadastral Topology & Intersection Studio)
  useEffect(() => {
    const map = rightMapRef.current;
    if (!map || !projectData?.layers) return;

    // Survey Plots (Polygons with Acreage & Intersection Styling)
    if (projectData.layers.survey_plots) {
      L.geoJSON(projectData.layers.survey_plots, {
        style: (feat: any) => {
          const isAffected = feat.properties?.canal_passing;
          return {
            color: isAffected ? "#059669" : "#64748b",
            weight: 2,
            fillColor: isAffected ? "#10b981" : "#94a3b8",
            fillOpacity: isAffected ? 0.45 : 0.15,
          };
        },
      }).addTo(map);
    }

    // Canal Alignment & 25m Buffer
    if (projectData.layers.canal_buffer) {
      L.geoJSON(projectData.layers.canal_buffer, {
        style: {
          color: "#0284c7",
          weight: 2,
          fillColor: "#0284c7",
          fillOpacity: 0.5,
        },
      }).addTo(map);
    }
    if (projectData.layers.canal_alignment) {
      L.geoJSON(projectData.layers.canal_alignment, {
        style: {
          color: "#ffffff",
          weight: 3,
        },
      }).addTo(map);
    }
  }, [projectData]);

  return (
    <div className="w-full h-full flex flex-col md:flex-row relative divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-slate-100">
      {/* Left Pane: Simple KML Overlay */}
      <div className="flex-1 h-full relative flex flex-col">
        <div className="absolute top-3 left-3 z-20 px-3 py-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-xs font-mono text-slate-800 font-bold shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          <span>VIEW 1: Clean KML Vector Overlay</span>
        </div>
        <div ref={leftContainerRef} className="w-full h-full z-0" />
      </div>

      {/* Right Pane: Survey Studio Analysis */}
      <div className="flex-1 h-full relative flex flex-col">
        <div className="absolute top-3 left-3 z-20 px-3 py-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-xs font-mono text-slate-800 font-bold shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
          <span>VIEW 2: Cadastral Survey & RoW Analysis</span>
        </div>
        <div ref={rightContainerRef} className="w-full h-full z-0" />
      </div>
    </div>
  );
}
