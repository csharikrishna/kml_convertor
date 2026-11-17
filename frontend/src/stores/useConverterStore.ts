import { create } from "zustand";
import type { ConversionParameters } from "@/types/workstation";
import type { ConvertSuccessResponse } from "@/lib/api/types";

export type ConversionStatus =
  | "idle"
  | "uploading"
  | "converting"
  | "rendering"
  | "completed"
  | "error";

interface ConverterState {
  file: File | null;
  parameters: ConversionParameters;
  status: ConversionStatus;
  uploadPercent: number;
  errorMessage: string | null;
  result: ConvertSuccessResponse | null;
  isSampleLoading: boolean;
  dwgSupported: boolean;
  maxUploadMb: number;

  setFile: (file: File | null) => void;
  updateParameters: (params: Partial<ConversionParameters>) => void;
  setStatus: (status: ConversionStatus) => void;
  setUploadPercent: (percent: number) => void;
  setErrorMessage: (msg: string | null) => void;
  setResult: (res: ConvertSuccessResponse | null) => void;
  setIsSampleLoading: (loading: boolean) => void;
  setServerCapabilities: (dwg: boolean, maxUploadMb: number) => void;
  reset: () => void;
}

const defaultParameters: ConversionParameters = {
  input_epsg: "EPSG:32644",
  output_epsg: "EPSG:4326",
  conversion_type: "raw",
  merge_lines: true,
  ignore_large_polygons: true,
  label_scale: 1.2,
  kml_text_mode: "screen",
  export_text: true,
  export_points: true,
  auto_scale_text: true,
  fill_polygons: false,
  fill_color: "#ff0000",
  fill_opacity: 0.3,
  output_format: "kml",
};

export const useConverterStore = create<ConverterState>((set) => ({
  file: null,
  parameters: defaultParameters,
  status: "idle",
  uploadPercent: 0,
  errorMessage: null,
  result: null,
  isSampleLoading: false,
  dwgSupported: true,
  maxUploadMb: 25,

  setFile: (file) => set({ file, errorMessage: null, result: null, status: "idle" }),
  updateParameters: (params) =>
    set((state) => ({
      parameters: { ...state.parameters, ...params },
    })),
  setStatus: (status) => set({ status }),
  setUploadPercent: (uploadPercent) => set({ uploadPercent }),
  setErrorMessage: (errorMessage) => set({ errorMessage, status: errorMessage ? "error" : "idle" }),
  setResult: (result) => set({ result, status: "completed", uploadPercent: 100 }),
  setIsSampleLoading: (isSampleLoading) => set({ isSampleLoading }),
  setServerCapabilities: (dwgSupported, maxUploadMb) =>
    set({ dwgSupported, maxUploadMb }),
  reset: () =>
    set({
      file: null,
      status: "idle",
      uploadPercent: 0,
      errorMessage: null,
      result: null,
    }),
}));
