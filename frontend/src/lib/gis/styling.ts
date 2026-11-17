import { safeColor } from "../utils";
import type { GeoJsonFeature } from "@/types/geojson";

export interface LayerStyleOptions {
  layerVisibility: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  fillPolygons: boolean;
  fillColor: string;
  fillOpacity: number;
}

export function getFeaturePathStyle(
  feature: GeoJsonFeature,
  options: LayerStyleOptions
) {
  const props = feature.properties || {};
  const layerName = props.layer || "Default";
  const userAlpha =
    options.layerOpacity[layerName] !== undefined
      ? options.layerOpacity[layerName]
      : 1.0;

  if (feature.geometry.type === "Point") {
    const ptColor = safeColor(props.color, "#10b981");
    return {
      radius: 4.5,
      fillColor: ptColor,
      fillOpacity: 1.0 * userAlpha,
      color: "#1e293b",
      weight: 1.5,
      fill: true,
      opacity: userAlpha,
    };
  }

  const baseStyle: {
    color: string;
    weight: number;
    opacity: number;
    fill?: boolean;
    fillColor?: string;
    fillOpacity?: number;
  } = {
    color: safeColor(props.stroke, "#ef4444"),
    weight: props["stroke-width"] || 2.5,
    opacity: 0.9 * userAlpha,
  };

  if (
    feature.geometry.type === "Polygon" ||
    feature.geometry.type === "MultiPolygon"
  ) {
    if (props.filled) {
      baseStyle.fillColor = safeColor(props.fill, "#ef4444");
      baseStyle.fillOpacity = (props["fill-opacity"] ?? 0.3) * userAlpha;
      baseStyle.fill = true;
    } else {
      baseStyle.fillColor = options.fillPolygons
        ? options.fillColor
        : safeColor(props.fill, "#ef4444");
      baseStyle.fillOpacity =
        (options.fillPolygons
          ? options.fillOpacity
          : (props["fill-opacity"] ?? 0.1)) * userAlpha;
      baseStyle.fill = options.fillPolygons || Boolean(props.fill);
    }
  } else {
    baseStyle.fill = false;
  }

  return baseStyle;
}
