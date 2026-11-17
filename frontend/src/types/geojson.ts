export interface CadProperties {
  type?: "text" | "point" | "linestring" | "polygon" | string;
  layer?: string;
  title?: string;
  color?: string;
  stroke?: string;
  "stroke-width"?: number;
  fill?: string;
  "fill-opacity"?: number;
  filled?: boolean;
  text_height?: number | string;
  rotation?: number;
  label_color?: string;
  anchor_x?: number;
  anchor_y?: number;
  bold?: boolean;
  italic?: boolean;
  font_family?: string;
  [key: string]: unknown;
}

export interface GeoJsonGeometry {
  type: "Point" | "MultiPoint" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
  coordinates: any;
}

export interface GeoJsonFeature {
  type: "Feature";
  properties: CadProperties;
  geometry: GeoJsonGeometry;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
  filename?: string;
}

export interface InspectedFeatureInfo {
  layer: string;
  type: string;
  lengthMeters?: number;
  areaM2?: number;
  vertexCount: number;
  text?: string;
  textHeight?: string | number;
  rotation?: number;
  properties: CadProperties;
}
