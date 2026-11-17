export type BasemapId = "google_hybrid" | "esri_world" | "osm_streets";

export interface BasemapConfig {
  id: BasemapId;
  name: string;
  url: string;
  subdomains?: string[] | string;
  maxZoom: number;
  maxNativeZoom: number;
  attribution: string;
}

export interface ConversionParameters {
  input_epsg: string;
  output_epsg: string;
  conversion_type: "standard" | "raw";
  merge_lines: boolean;
  ignore_large_polygons: boolean;
  label_scale: number;
  kml_text_mode: "screen" | "normal";
  export_text: boolean;
  export_points: boolean;
  auto_scale_text: boolean;
  fill_polygons: boolean;
  fill_color: string;
  fill_opacity: number;
  output_format: "kml" | "kmz";
}

export interface WorkstationLayerState {
  name: string;
  color: string;
  visible: boolean;
  opacity: number;
  featureCount: number;
}
