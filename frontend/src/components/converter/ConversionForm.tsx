"use client";

import React, { useState } from "react";
import {
  MapPin,
  Settings2,
  ChevronDown,
  ChevronUp,
  FileCode,
  Layers,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useConverterStore } from "@/stores/useConverterStore";
import { useGisStore } from "@/stores/useGisStore";
import { convertCadFile } from "@/lib/api/client";

const COMMON_CRS_OPTIONS = [
  { value: "EPSG:32644", label: "UTM Zone 44N (India Central/East) · EPSG:32644" },
  { value: "EPSG:32643", label: "UTM Zone 43N (India West/South) · EPSG:32643" },
  { value: "EPSG:32642", label: "UTM Zone 42N (India NW/Pakistan) · EPSG:32642" },
  { value: "EPSG:32645", label: "UTM Zone 45N (India East/Bangladesh) · EPSG:32645" },
  { value: "EPSG:4326", label: "WGS 84 (Geographic Lat/Lon) · EPSG:4326" },
  { value: "EPSG:3857", label: "WGS 84 / Pseudo-Mercator · EPSG:3857" },
  { value: "EPSG:32632", label: "UTM Zone 32N (Central Europe) · EPSG:32632" },
  { value: "EPSG:32633", label: "UTM Zone 33N (Eastern Europe) · EPSG:32633" },
  { value: "EPSG:32618", label: "UTM Zone 18N (US East) · EPSG:32618" },
  { value: "EPSG:32610", label: "UTM Zone 10N (US West Coast) · EPSG:32610" },
];

export function ConversionForm() {
  const {
    file,
    parameters,
    status,
    updateParameters,
    setStatus,
    setUploadPercent,
    setResult,
    setErrorMessage,
  } = useConverterStore();

  const { isSelectingLocation, setIsSelectingLocation, setGeoJson } =
    useGisStore();

  const handleConversionTypeChange = (type: "standard" | "raw") => {
    updateParameters({
      conversion_type: type,
      export_text: type === "raw",
      export_points: type === "raw",
    });
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMessage("Please select or drop a CAD drawing first.");
      return;
    }

    try {
      setErrorMessage(null);
      setStatus("uploading");
      setUploadPercent(0);

      const res = await convertCadFile(file, parameters, (percent) => {
        setUploadPercent(percent);
        if (percent >= 100) {
          setStatus("converting");
        }
      });

      setStatus("rendering");
      setResult(res);
      if (res.geojson) {
        setGeoJson(res.geojson);
      }
    } catch (err: any) {
      setErrorMessage(
        err.message || "An unexpected error occurred during conversion."
      );
    }
  };

  const isConverting = status === "uploading" || status === "converting" || status === "rendering";

  return (
    <form onSubmit={handleConvert} className="space-y-4">
      {/* Conversion Mode Pills */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          Conversion Engine Mode
        </label>
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => handleConversionTypeChange("standard")}
            className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
              parameters.conversion_type === "standard"
                ? "bg-white text-blue-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Standard (Fast)
          </button>
          <button
            type="button"
            onClick={() => handleConversionTypeChange("raw")}
            className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
              parameters.conversion_type === "raw"
                ? "bg-white text-blue-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Raw (Full Detail)
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {parameters.conversion_type === "raw"
            ? "Exports labels, text rotations, survey points, polylines, and blocks."
            : "Streamlined geometry-only conversion optimized for large master plans."}
        </p>
      </div>

      {/* Input Coordinate Reference System (CRS) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-slate-700">
            Drawing Input Coordinate System
          </label>
          <button
            type="button"
            onClick={() => setIsSelectingLocation(!isSelectingLocation)}
            className={`text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isSelectingLocation
                ? "text-rose-600 animate-pulse"
                : "text-blue-600 hover:text-blue-800"
            }`}
            title="Click anywhere on the map to automatically detect the UTM Zone"
          >
            <MapPin className="w-3 h-3" />
            <span>
              {isSelectingLocation ? "Click on MAP..." : "Select on Map"}
            </span>
          </button>
        </div>

        <select
          value={parameters.input_epsg}
          onChange={(e) => updateParameters({ input_epsg: e.target.value })}
          className="w-full text-xs font-medium rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
        >
          {COMMON_CRS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Output Format */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Output Format
          </label>
          <select
            value={parameters.output_format}
            onChange={(e) =>
              updateParameters({
                output_format: e.target.value as "kml" | "kmz",
              })
            }
            className="w-full text-xs font-medium rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 shadow-xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
          >
            <option value="kml">KML (Standard XML)</option>
            <option value="kmz">KMZ (Zipped KML)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Target Datum
          </label>
          <div className="text-xs font-mono py-2 px-3 bg-slate-100 rounded-lg border border-slate-200 text-slate-600">
            WGS84 (EPSG:4326)
          </div>
        </div>
      </div>

      {/* Convert Submit Button */}
      <button
        type="submit"
        disabled={!file || isConverting}
        className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isConverting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Processing CAD Drawing...</span>
          </>
        ) : (
          <>
            <span>Convert & Visualize on GIS Map</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </form>
  );
}
