"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  FileDown,
  Printer,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";
import { useConverterStore } from "@/stores/useConverterStore";
import { jsPDF } from "jspdf";
import type { BasemapId } from "@/types/workstation";

export function PdfExportModal() {
  const { isPdfModalOpen, setIsPdfModalOpen, geojson, layerVisibility, layerOpacity, layerColors } =
    useGisStore();
  const { file, result, parameters } = useConverterStore();

  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [zoomCoverage, setZoomCoverage] = useState(100);
  const [textSize, setTextSize] = useState(100);
  const [exportBasemap, setExportBasemap] = useState<BasemapId>("google_hybrid");
  const [showPolygons, setShowPolygons] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cachedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Web Mercator tile projection
  const project = (lng: number, lat: number, zoom: number) => {
    const n = Math.pow(2, zoom);
    const x = ((lng + 180) / 360) * n * 256;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n * 256;
    return { x, y };
  };

  const getTileUrl = (tx: number, ty: number, zoom: number, basemapId: BasemapId) => {
    if (basemapId === "esri_world") {
      return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
    } else if (basemapId === "osm_streets") {
      const sub = ["a", "b", "c", "d"][(tx + ty) % 4];
      return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`;
    } else {
      const sub = (tx + ty) % 4;
      return `https://mt${sub}.google.com/vt/lyrs=y&x=${tx}&y=${ty}&z=${zoom}`;
    }
  };

  const renderSheetPreview = useCallback(async () => {
    if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsRendering(true);

    try {
      // 1. Gather all coordinates
      const allCoords: [number, number][] = [];
      const extract = (c: any) => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === "number" && typeof c[1] === "number") {
          allCoords.push([c[0], c[1]]);
        } else {
          for (let i = 0; i < c.length; i++) extract(c[i]);
        }
      };

      geojson.features.forEach((f) => {
        if (f.geometry?.coordinates) extract(f.geometry.coordinates);
      });

      if (allCoords.length === 0) return;

      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      allCoords.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });

      const midLng = (minLng + maxLng) / 2;
      const midLat = (minLat + maxLat) / 2;
      const baseSpanLng = Math.max(0.0015, (maxLng - minLng) * 1.16);
      const baseSpanLat = Math.max(0.0015, (maxLat - minLat) * 1.16);

      const targetAspect = orientation === "portrait" ? 0.71 : 1.5;
      const latRadMid = (midLat * Math.PI) / 180;
      const currentAspect = (baseSpanLng * Math.cos(latRadMid)) / baseSpanLat;

      let fittedSpanLng = baseSpanLng;
      let fittedSpanLat = baseSpanLat;
      if (currentAspect < targetAspect) {
        fittedSpanLng = (baseSpanLat * targetAspect) / Math.cos(latRadMid);
      } else {
        fittedSpanLat = (baseSpanLng * Math.cos(latRadMid)) / targetAspect;
      }

      const zoomScale = Math.max(0.3, Math.min(3.0, zoomCoverage / 100));
      const effectiveSpanLng = fittedSpanLng / zoomScale;
      const effectiveSpanLat = fittedSpanLat / zoomScale;

      const bMinLng = midLng - effectiveSpanLng / 2;
      const bMaxLng = midLng + effectiveSpanLng / 2;
      const bMinLat = midLat - effectiveSpanLat / 2;
      const bMaxLat = midLat + effectiveSpanLat / 2;

      // High-DPI zoom calculation
      let z = 16;
      for (let testZ = 9; testZ <= 19; testZ++) {
        const p1 = project(bMinLng, bMinLat, testZ);
        const p2 = project(bMaxLng, bMaxLat, testZ);
        const spanW = Math.abs(p2.x - p1.x);
        const spanH = Math.abs(p1.y - p2.y);
        const minTx = Math.floor(Math.min(p1.x, p2.x) / 256);
        const maxTx = Math.floor(Math.max(p1.x, p2.x) / 256);
        const minTy = Math.floor(Math.min(p1.y, p2.y) / 256);
        const maxTy = Math.floor(Math.max(p1.y, p2.y) / 256);
        const tileCount = (maxTx - minTx + 1) * (maxTy - minTy + 1);

        if (tileCount > 36 && testZ > 12) break;
        z = testZ;
        if (spanW >= 900 || spanH >= 900) break;
      }

      const pMin = project(bMinLng, bMaxLat, z);
      const pMax = project(bMaxLng, bMinLat, z);
      const pxMinX = Math.min(pMin.x, pMax.x);
      const pxMaxX = Math.max(pMin.x, pMax.x);
      const pxMinY = Math.min(pMin.y, pMax.y);
      const pxMaxY = Math.max(pMin.y, pMax.y);

      const originX = pxMinX;
      const originY = pxMinY;
      const width = Math.round(pxMaxX - pxMinX);
      const height = Math.round(pxMaxY - pxMinY);

      const minTx = Math.floor(pxMinX / 256);
      const maxTx = Math.floor(pxMaxX / 256);
      const minTy = Math.floor(pxMinY / 256);
      const maxTy = Math.floor(pxMaxY / 256);

      const offscreen = document.createElement("canvas");
      const scale = 2; // High-DPI 2x Retina
      offscreen.width = width * scale;
      offscreen.height = height * scale;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, width, height);

      // Fetch Tiles
      const tilePromises: Promise<{ img: HTMLImageElement; tx: number; ty: number } | null>[] = [];
      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          tilePromises.push(
            new Promise((res) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => res({ img, tx, ty });
              img.onerror = () => res(null);
              img.src = getTileUrl(tx, ty, z, exportBasemap);
            })
          );
        }
      }

      const tiles = await Promise.all(tilePromises);
      tiles.forEach((t) => {
        if (!t) return;
        const dx = Math.round(t.tx * 256 - originX);
        const dy = Math.round(t.ty * 256 - originY);
        ctx.drawImage(t.img, dx, dy, 256, 256);
      });

      // Draw Polygons & Polylines
      if (showPolygons) {
        geojson.features.forEach((f) => {
          const g = f.geometry;
          if (!g || !g.coordinates) return;
          if (f.properties?.type === "text" || g.type === "Point") return;

          const layerName = f.properties?.layer || "Default";
          if (layerVisibility[layerName] === false) return;
          const userAlpha = layerOpacity[layerName] !== undefined ? layerOpacity[layerName] : 1.0;

          const strokeColor = (f.properties?.stroke as string) || layerColors[layerName] || "#ef4444";
          const strokeWidth = Number(f.properties?.["stroke-width"]) || 2.5;

          const rings =
            g.type === "Polygon" || g.type === "MultiLineString"
              ? g.coordinates
              : g.type === "MultiPolygon"
              ? g.coordinates.flat()
              : [g.coordinates];

          rings.forEach((ring: [number, number][]) => {
            if (!ring || ring.length === 0) return;
            ctx.save();
            ctx.beginPath();
            ring.forEach((coord, idx) => {
              const pt = project(coord[0], coord[1], z);
              const x = pt.x - originX;
              const y = pt.y - originY;
              if (idx === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });

            if (g.type === "Polygon") {
              ctx.closePath();
              ctx.fillStyle = (f.properties?.fill as string) || strokeColor;
              ctx.globalAlpha = userAlpha * (Number(f.properties?.["fill-opacity"]) || 0.15);
              ctx.fill();
            }

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = Math.max(2.0, strokeWidth);
            ctx.globalAlpha = userAlpha * 0.95;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
            ctx.restore();
          });
        });
      }

      // Draw Survey Points
      if (showPoints) {
        const tScale = Math.max(0.5, Math.min(2.5, textSize / 100));
        const ptRadius = Math.max(2.5, 4.5 * Math.min(1.4, Math.max(0.8, tScale)));

        geojson.features.forEach((f) => {
          if (f.geometry?.type !== "Point" || f.properties?.type === "text") return;
          const layerName = f.properties?.layer || "Default";
          if (layerVisibility[layerName] === false) return;
          const userAlpha = layerOpacity[layerName] !== undefined ? layerOpacity[layerName] : 1.0;

          const coord = f.geometry.coordinates;
          const pt = project(coord[0], coord[1], z);
          const sx = pt.x - originX;
          const sy = pt.y - originY;

          ctx.save();
          ctx.globalAlpha = userAlpha;
          ctx.beginPath();
          ctx.arc(sx, sy, ptRadius, 0, Math.PI * 2);
          ctx.fillStyle = (f.properties?.color as string) || layerColors[layerName] || "#10b981";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "#0f172a";
          ctx.stroke();
          ctx.restore();
        });
      }

      // Draw Text Labels
      if (showLabels) {
        const tScale = Math.max(0.5, Math.min(2.5, textSize / 100));

        geojson.features.forEach((f) => {
          if (f.geometry?.type !== "Point" || f.properties?.type !== "text") return;
          const layerName = f.properties?.layer || "Default";
          if (layerVisibility[layerName] === false) return;
          const userAlpha = layerOpacity[layerName] !== undefined ? layerOpacity[layerName] : 1.0;

          const coord = f.geometry.coordinates;
          const pt = project(coord[0], coord[1], z);
          const sx = pt.x - originX;
          const sy = pt.y - originY;
          const title = (f.properties?.title as string) || "";
          if (!title) return;

          const rotation = Number(f.properties?.rotation) || 0;
          const labelColor = (f.properties?.label_color as string) || "#ff0000";
          const isLargeTitle = (title.length > 8 && !title.startsWith("KM")) || title.includes("RESERVOIR");
          const fontSize = Math.max(6, Math.round((isLargeTitle ? 14 : 10.5) * tScale));

          ctx.save();
          ctx.translate(sx, sy);
          if (Math.abs(rotation) > 0.01) {
            let cssAngle = (-rotation) % 360;
            if (cssAngle < 0) cssAngle += 360;
            ctx.rotate((cssAngle * Math.PI) / 180);
          }

          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          // Contrast halo
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = Math.max(2.0, 2.5 * tScale);
          ctx.strokeText(title, 0, 0);

          ctx.fillStyle = labelColor;
          ctx.globalAlpha = userAlpha;
          ctx.fillText(title, 0, 0);
          ctx.restore();
        });
      }

      cachedCanvasRef.current = offscreen;

      // Copy onto visible canvas
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      const visibleCtx = canvas.getContext("2d");
      visibleCtx?.drawImage(offscreen, 0, 0);
    } catch (err) {
      console.error("PDF render sheet error:", err);
    } finally {
      setIsRendering(false);
    }
  }, [
    geojson,
    orientation,
    zoomCoverage,
    textSize,
    exportBasemap,
    showPolygons,
    showPoints,
    showLabels,
    layerVisibility,
    layerOpacity,
    layerColors,
  ]);

  useEffect(() => {
    if (isPdfModalOpen) {
      renderSheetPreview();
    }
  }, [isPdfModalOpen, renderSheetPreview]);

  const handleDownloadPdf = async () => {
    const canvas = cachedCanvasRef.current;
    if (!canvas) return;

    try {
      setIsExporting(true);
      const pdf = new jsPDF({
        orientation,
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Top Banner
      pdf.setFillColor(248, 250, 252);
      pdf.rect(0, 0, pageWidth, 16, "F");
      pdf.setDrawColor(226, 232, 240);
      pdf.line(0, 16, pageWidth, 16);

      const docName = file?.name || result?.filename || "CAD Drawing Map";
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(15, 23, 42);
      pdf.text(docName, 10, 10.5);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Exported: ${new Date().toLocaleString()} · Datum: ${parameters.input_epsg} · High-DPI GIS Print`,
        pageWidth - 10,
        10.5,
        { align: "right" }
      );

      // Map canvas image
      const margin = 8;
      const topY = 19;
      const availWidth = pageWidth - margin * 2;
      const availHeight = pageHeight - topY - 9;

      const imgRatio = canvas.width / canvas.height;
      let targetWidth = availWidth;
      let targetHeight = targetWidth / imgRatio;

      if (targetHeight > availHeight) {
        targetHeight = availHeight;
        targetWidth = targetHeight * imgRatio;
      }

      const imgX = margin + (availWidth - targetWidth) / 2;
      const imgY = topY + (availHeight - targetHeight) / 2;

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(imgData, "JPEG", imgX, imgY, targetWidth, targetHeight);

      // Footer
      pdf.setFontSize(7.5);
      pdf.setTextColor(148, 163, 184);
      pdf.text("CAD2KML Pro Workstation · High-DPI Engineering Print", margin, pageHeight - 4);

      pdf.save(`${docName.replace(/\.[^/.]+$/, "")}_GIS_Map.pdf`);
    } catch (err: any) {
      alert("Error generating PDF: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    const canvas = cachedCanvasRef.current;
    if (!canvas) {
      alert("Please wait for the map sheet preview to render before printing.");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      window.print();
      return;
    }

    const orientCss = orientation === "portrait" ? "portrait" : "landscape";
    const docName = file?.name || result?.filename || "CAD Drawing Map";
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${docName} · Engineering Map Print</title>
          <style>
            @page { size: A4 ${orientCss}; margin: 8mm; }
            body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fff; }
            img { max-width: 100%; max-height: 100%; object-fit: contain; }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" onload="window.print(); window.close();" />
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (!isPdfModalOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsPdfModalOpen(false);
      }}
      className="fixed inset-0 z-[99999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden relative">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
              <FileDown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Print & Export High-DPI Engineering PDF
              </h3>
              <p className="text-[11px] text-slate-500">
                ISO A4 · Scaled Map Projection · AutoCAD Text & Vector Overlay
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsPdfModalOpen(false)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Controls Column */}
          <div className="space-y-4">
            {/* Orientation */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Sheet Orientation
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOrientation("landscape")}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    orientation === "landscape"
                      ? "border-blue-600 bg-blue-50 text-blue-600"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  A4 Landscape
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation("portrait")}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    orientation === "portrait"
                      ? "border-blue-600 bg-blue-50 text-blue-600"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  A4 Portrait
                </button>
              </div>
            </div>

            {/* Zoom Coverage Slider */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <span className="font-semibold text-slate-700">Zoom Coverage</span>
                <span className="font-mono text-slate-500">{zoomCoverage}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="300"
                step="5"
                value={zoomCoverage}
                onChange={(e) => setZoomCoverage(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Text Scale Slider */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs">
                <span className="font-semibold text-slate-700">Label Text Size</span>
                <span className="font-mono text-slate-500">{textSize}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="250"
                step="5"
                value={textSize}
                onChange={(e) => setTextSize(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Basemap for Export */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Print Basemap Imagery
              </label>
              <select
                value={exportBasemap}
                onChange={(e) => setExportBasemap(e.target.value as BasemapId)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-800"
              >
                <option value="google_hybrid">Google Satellite Hybrid</option>
                <option value="esri_world">Esri World Imagery</option>
                <option value="osm_streets">OSM Carto Voyager</option>
              </select>
            </div>

            {/* Feature Layers */}
            <div className="space-y-1.5 pt-2 border-t border-slate-200 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={showPolygons}
                  onChange={(e) => setShowPolygons(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Include Polygons & Polylines</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={showPoints}
                  onChange={(e) => setShowPoints(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Include Survey Points</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Include Text Labels</span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 space-y-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isRendering || isExporting}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                <span>Download High-DPI PDF</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="w-full py-2 px-4 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors flex items-center justify-center gap-2"
              >
                <Printer className="w-4 h-4" />
                <span>Direct Print</span>
              </button>
            </div>
          </div>

          {/* Live Sheet Preview Column */}
          <div className="md:col-span-2 flex flex-col items-center justify-center bg-slate-100/80 rounded-xl p-4 border border-slate-200 relative min-h-[360px]">
            {isRendering && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-2xs rounded-xl flex flex-col items-center justify-center gap-2 z-10">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <span className="text-xs font-semibold text-slate-700">
                  Rendering High-DPI Sheet...
                </span>
              </div>
            )}

            <div
              className={`bg-white rounded-lg shadow-xl overflow-hidden border border-slate-300 flex items-center justify-center ${
                orientation === "landscape" ? "aspect-3/2 w-full" : "aspect-2/3 max-w-[360px]"
              }`}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full object-contain bg-slate-900"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
