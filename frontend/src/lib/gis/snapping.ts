import type { GeoJsonFeatureCollection } from "@/types/geojson";
import { computeGeodesicDistance } from "./geodesy";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface SnappedVertexResult {
  lat: number;
  lng: number;
  distancePx?: number;
  distanceMeters?: number;
}

export interface SnappingOptions {
  latLngToScreenPx?: (pt: LatLngPoint) => { x: number; y: number };
  tolerancePx?: number;
  maxDistanceMeters?: number;
}

/**
 * Traverses all geometries in a GeoJSON FeatureCollection to find the nearest vertex
 * or survey station to a target coordinate.
 *
 * Supports screen-pixel snapping when a projection function is supplied (Leaflet map),
 * or ground geodesic distance snapping (pure math / test environments).
 */
export function findNearestVertex(
  target: LatLngPoint,
  geojson: GeoJsonFeatureCollection | null,
  options: SnappingOptions = {}
): SnappedVertexResult | null {
  if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
    return null;
  }

  const {
    latLngToScreenPx,
    tolerancePx = 22,
    maxDistanceMeters = 50,
  } = options;

  let best: SnappedVertexResult | null = null;
  let minScreenDist = tolerancePx;
  let minMeterDist = maxDistanceMeters;

  const targetScreen = latLngToScreenPx ? latLngToScreenPx(target) : null;

  const checkCoord = (lon: number, lat: number) => {
    if (typeof lon !== "number" || typeof lat !== "number") return;

    if (targetScreen && latLngToScreenPx) {
      const ptScreen = latLngToScreenPx({ lat, lng: lon });
      const dx = targetScreen.x - ptScreen.x;
      const dy = targetScreen.y - ptScreen.y;
      const distPx = Math.sqrt(dx * dx + dy * dy);

      if (distPx <= minScreenDist) {
        minScreenDist = distPx;
        best = { lat, lng: lon, distancePx: distPx };
      }
    } else {
      const distMeters = computeGeodesicDistance(target.lat, target.lng, lat, lon);
      if (distMeters <= minMeterDist) {
        minMeterDist = distMeters;
        best = { lat, lng: lon, distanceMeters: distMeters };
      }
    }
  };

  geojson.features.forEach((feature) => {
    const geom = feature.geometry;
    if (!geom || !geom.coordinates) return;

    switch (geom.type) {
      case "Point":
        checkCoord(geom.coordinates[0], geom.coordinates[1]);
        break;

      case "MultiPoint":
      case "LineString":
        geom.coordinates.forEach((c: number[]) => checkCoord(c[0], c[1]));
        break;

      case "MultiLineString":
      case "Polygon":
        geom.coordinates.forEach((ring: number[][]) => {
          if (Array.isArray(ring)) {
            ring.forEach((c: number[]) => checkCoord(c[0], c[1]));
          }
        });
        break;

      case "MultiPolygon":
        geom.coordinates.forEach((poly: number[][][]) => {
          if (Array.isArray(poly)) {
            poly.forEach((ring: number[][]) => {
              if (Array.isArray(ring)) {
                ring.forEach((c: number[]) => checkCoord(c[0], c[1]));
              }
            });
          }
        });
        break;
    }
  });

  return best;
}
