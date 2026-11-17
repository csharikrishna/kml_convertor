/**
 * Exact Geodesic Math & Geometry Measurement Engine
 * Preserves the exact calculation algorithms of the CAD2KML platform.
 */

const EARTH_RADIUS_METERS = 6371000;
const TO_RAD = Math.PI / 180;

/**
 * Computes exact geodesic distance between two WGS84 coordinates in meters using the Haversine formula.
 */
export function computeGeodesicDistance(
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

/**
 * Formats distance with dual metric representation (km and m).
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km (${Math.round(meters).toLocaleString()} m)`;
  }
  return `${meters.toFixed(1)} m`;
}

/**
 * Calculates polyline length in meters from GeoJSON coordinate array [[lon, lat], ...].
 */
export function calculateFeatureLengthMeters(coords: number[][]): number {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum += computeGeodesicDistance(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0]
    );
  }
  return sum;
}

/**
 * Calculates spherical polygon area in square meters from GeoJSON linear ring [[lon, lat], ...].
 */
export function calculatePolygonAreaM2(ring: number[][]): number {
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

/**
 * Accumulates geodesic distances across an array of coordinate points.
 * Returns total distance and per-segment distances in meters.
 */
export function accumulateDistances(
  points: { lat: number; lng: number }[]
): { totalDistance: number; segmentDistances: number[] } {
  if (!Array.isArray(points) || points.length < 2) {
    return { totalDistance: 0, segmentDistances: [] };
  }
  const segmentDistances: number[] = [];
  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = computeGeodesicDistance(
      points[i].lat,
      points[i].lng,
      points[i + 1].lat,
      points[i + 1].lng
    );
    segmentDistances.push(seg);
    totalDistance += seg;
  }
  return { totalDistance, segmentDistances };
}
