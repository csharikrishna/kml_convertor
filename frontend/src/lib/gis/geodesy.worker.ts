/**
 * Dedicated Geodesy & Spatial Math Web Worker
 * Offloads compute-heavy GIS operations from browser UI main thread:
 * - Polygon geodesic area calculations (Haversine & ellipsoidal)
 * - Polyline distance accumulations & lengths
 * - Geometry validation & topological ring closure verification
 * - Bounding box spatial intersection calculations
 * - Bulk parcel geometric preprocessing (bounds, centroid, acreage)
 * - Coordinate transformations & offset shifts
 */

const EARTH_RADIUS_METERS = 6371000;
const TO_RAD = Math.PI / 180;
const SQ_METERS_PER_ACRE = 4046.8564224;

export interface WorkerPoint {
  lat: number;
  lng: number;
}

export type GeodesyWorkerRequest =
  | { id: string; type: "CALCULATE_AREA"; ring: number[][] }
  | { id: string; type: "CALCULATE_LENGTH"; coords: number[][] }
  | { id: string; type: "ACCUMULATE_DISTANCES"; points: WorkerPoint[] }
  | {
      id: string;
      type: "VALIDATE_GEOMETRY";
      coords: number[][];
      geometryType: "Polygon" | "LineString" | "Point";
    }
  | { id: string; type: "SPATIAL_INTERSECTS"; ringA: number[][]; ringB: number[][] }
  | {
      id: string;
      type: "BULK_PREPROCESS_PARCELS";
      parcels: Array<{ survey_no: string; ring: number[][] }>;
    }
  | { id: string; type: "TRANSFORM_OFFSET"; coords: number[][]; dx: number; dy: number };

export type GeodesyWorkerResponse =
  | {
      id: string;
      success: true;
      type: "CALCULATE_AREA";
      result: { areaM2: number; acres: number };
    }
  | {
      id: string;
      success: true;
      type: "CALCULATE_LENGTH";
      result: { lengthMeters: number; formatted: string };
    }
  | {
      id: string;
      success: true;
      type: "ACCUMULATE_DISTANCES";
      result: { totalDistance: number; segmentDistances: number[] };
    }
  | {
      id: string;
      success: true;
      type: "VALIDATE_GEOMETRY";
      result: { isValid: boolean; vertexCount: number; isClosed: boolean; errors: string[] };
    }
  | {
      id: string;
      success: true;
      type: "SPATIAL_INTERSECTS";
      result: { intersects: boolean };
    }
  | {
      id: string;
      success: true;
      type: "BULK_PREPROCESS_PARCELS";
      result: Array<{
        survey_no: string;
        areaM2: number;
        acres: number;
        center: [number, number];
        bounds: [[number, number], [number, number]];
      }>;
    }
  | {
      id: string;
      success: true;
      type: "TRANSFORM_OFFSET";
      result: { coords: number[][] };
    }
  | { id: string; success: false; error: string };

export function computeGeodesicDistanceWorker(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * TO_RAD) *
      Math.cos(lat2 * TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function calculatePolygonAreaM2Worker(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    total +=
      (p2[0] - p1[0]) *
      TO_RAD *
      (2 + Math.sin(p1[1] * TO_RAD) + Math.sin(p2[1] * TO_RAD));
  }
  return Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
}

export function calculateFeatureLengthMetersWorker(coords: number[][]): number {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum += computeGeodesicDistanceWorker(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0]
    );
  }
  return sum;
}

export function validateGeometryWorker(
  coords: number[][],
  geometryType: "Polygon" | "LineString" | "Point"
): { isValid: boolean; vertexCount: number; isClosed: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(coords) || coords.length === 0) {
    return { isValid: false, vertexCount: 0, isClosed: false, errors: ["Empty coordinates array"] };
  }

  const vertexCount = coords.length;

  for (let i = 0; i < coords.length; i++) {
    const pt = coords[i];
    if (!Array.isArray(pt) || pt.length < 2 || isNaN(pt[0]) || isNaN(pt[1])) {
      errors.push(`Vertex at index ${i} contains non-numeric coordinates`);
    } else {
      if (pt[0] < -180 || pt[0] > 180) {
        errors.push(`Vertex ${i} longitude ${pt[0]} exceeds [-180, 180]`);
      }
      if (pt[1] < -90 || pt[1] > 90) {
        errors.push(`Vertex ${i} latitude ${pt[1]} exceeds [-90, 90]`);
      }
    }
  }

  let isClosed = false;
  if (geometryType === "Polygon") {
    if (coords.length < 4) {
      errors.push("Polygons require at least 4 coordinates (including closure vertex)");
    } else {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first && last && first[0] === last[0] && first[1] === last[1]) {
        isClosed = true;
      } else {
        errors.push("Polygon linear ring is not topologically closed (first vertex != last vertex)");
      }
    }
  } else if (geometryType === "LineString") {
    if (coords.length < 2) {
      errors.push("LineStrings require at least 2 coordinate pairs");
    }
  }

  return {
    isValid: errors.length === 0,
    vertexCount,
    isClosed,
    errors,
  };
}

export function computeRingBBox(ring: number[][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return [minX, minY, maxX, maxY];
}

export function bboxIntersects(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): boolean {
  return !(
    boxA[2] < boxB[0] ||
    boxA[0] > boxB[2] ||
    boxA[3] < boxB[1] ||
    boxA[1] > boxB[3]
  );
}

// Bounding box + ray casting point-in-polygon verification
export function checkSpatialIntersectsWorker(ringA: number[][], ringB: number[][]): boolean {
  if (!ringA.length || !ringB.length) return false;
  const bboxA = computeRingBBox(ringA);
  const bboxB = computeRingBBox(ringB);
  if (!bboxIntersects(bboxA, bboxB)) return false;

  // Check if any vertex of ringA is inside ringB or vice versa
  const pointInPolygon = (pt: number[], poly: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect =
        yi > pt[1] !== yj > pt[1] &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  for (const pt of ringA) {
    if (pointInPolygon(pt, ringB)) return true;
  }
  for (const pt of ringB) {
    if (pointInPolygon(pt, ringA)) return true;
  }
  return false;
}

export function bulkPreprocessParcelsWorker(
  parcels: Array<{ survey_no: string; ring: number[][] }>
): Array<{
  survey_no: string;
  areaM2: number;
  acres: number;
  center: [number, number];
  bounds: [[number, number], [number, number]];
}> {
  return parcels.map((p) => {
    const areaM2 = calculatePolygonAreaM2Worker(p.ring);
    const acres = Math.round((areaM2 / SQ_METERS_PER_ACRE) * 100) / 100;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let sumX = 0,
      sumY = 0;
    const n = Math.max(1, p.ring.length);

    for (let i = 0; i < p.ring.length; i++) {
      const pt = p.ring[i];
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
      sumX += pt[0];
      sumY += pt[1];
    }

    return {
      survey_no: p.survey_no,
      areaM2,
      acres,
      center: [sumY / n, sumX / n], // [lat, lng]
      bounds: [
        [minY, minX],
        [maxY, maxX],
      ],
    };
  });
}

export function transformOffsetWorker(coords: number[][], dx: number, dy: number): number[][] {
  if (dx === 0 && dy === 0) return coords;
  return coords.map(([lon, lat, ...rest]) => {
    const latRad = (lat * Math.PI) / 180.0;
    const dLat = dy / 111320.0;
    const dLon = dx / (111320.0 * Math.max(0.01, Math.cos(latRad)));
    return [lon + dLon, lat + dLat, ...rest];
  });
}

// Global worker message handler with listener protection
if (typeof self !== "undefined" && typeof (self as any).postMessage === "function") {
  self.onmessage = (event: MessageEvent<GeodesyWorkerRequest>) => {
    const req = event.data;
    if (!req || typeof req !== "object" || !req.id || !req.type) return;

    try {
      switch (req.type) {
        case "CALCULATE_AREA": {
          const areaM2 = calculatePolygonAreaM2Worker(req.ring);
          const acres = Math.round((areaM2 / SQ_METERS_PER_ACRE) * 100) / 100;
          self.postMessage({
            id: req.id,
            success: true,
            type: "CALCULATE_AREA",
            result: { areaM2, acres },
          });
          break;
        }

        case "CALCULATE_LENGTH": {
          const lengthMeters = calculateFeatureLengthMetersWorker(req.coords);
          const formatted =
            lengthMeters >= 1000
              ? `${(lengthMeters / 1000).toFixed(2)} km (${Math.round(lengthMeters).toLocaleString()} m)`
              : `${lengthMeters.toFixed(1)} m`;
          self.postMessage({
            id: req.id,
            success: true,
            type: "CALCULATE_LENGTH",
            result: { lengthMeters, formatted },
          });
          break;
        }

        case "ACCUMULATE_DISTANCES": {
          const segmentDistances: number[] = [];
          let totalDistance = 0;
          for (let i = 0; i < req.points.length - 1; i++) {
            const seg = computeGeodesicDistanceWorker(
              req.points[i].lat,
              req.points[i].lng,
              req.points[i + 1].lat,
              req.points[i + 1].lng
            );
            segmentDistances.push(seg);
            totalDistance += seg;
          }
          self.postMessage({
            id: req.id,
            success: true,
            type: "ACCUMULATE_DISTANCES",
            result: { totalDistance, segmentDistances },
          });
          break;
        }

        case "VALIDATE_GEOMETRY": {
          const validation = validateGeometryWorker(req.coords, req.geometryType);
          self.postMessage({
            id: req.id,
            success: true,
            type: "VALIDATE_GEOMETRY",
            result: validation,
          });
          break;
        }

        case "SPATIAL_INTERSECTS": {
          const intersects = checkSpatialIntersectsWorker(req.ringA, req.ringB);
          self.postMessage({
            id: req.id,
            success: true,
            type: "SPATIAL_INTERSECTS",
            result: { intersects },
          });
          break;
        }

        case "BULK_PREPROCESS_PARCELS": {
          const processed = bulkPreprocessParcelsWorker(req.parcels);
          self.postMessage({
            id: req.id,
            success: true,
            type: "BULK_PREPROCESS_PARCELS",
            result: processed,
          });
          break;
        }

        case "TRANSFORM_OFFSET": {
          const shifted = transformOffsetWorker(req.coords, req.dx, req.dy);
          self.postMessage({
            id: req.id,
            success: true,
            type: "TRANSFORM_OFFSET",
            result: { coords: shifted },
          });
          break;
        }

        default:
          self.postMessage({
            id: (req as any).id,
            success: false,
            error: `Unsupported worker request type: ${(req as any).type}`,
          });
      }
    } catch (err: any) {
      self.postMessage({
        id: req.id,
        success: false,
        error: err?.message || "Internal Worker Execution Exception",
      });
    }
  };
}
