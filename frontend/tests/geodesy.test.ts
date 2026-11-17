import { describe, it, expect } from "vitest";
import {
  computeGeodesicDistance,
  formatDistance,
  calculateFeatureLengthMeters,
  calculatePolygonAreaM2,
  accumulateDistances,
} from "../src/lib/gis/geodesy";

describe("Geodesy & Measurement Engine", () => {
  it("calculates accurate geodesic distance between known coordinates", () => {
    // Distance between London (51.5074, -0.1278) and Paris (48.8566, 2.3522) ~ 343.5 km
    const d = computeGeodesicDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(340000);
    expect(d).toBeLessThan(350000);
  });

  it("returns 0 for identical points", () => {
    const d = computeGeodesicDistance(15.8281, 78.0373, 15.8281, 78.0373);
    expect(d).toBe(0);
  });

  it("formats distances correctly in km and meters", () => {
    expect(formatDistance(50.4)).toBe("50.4 m");
    expect(formatDistance(1250)).toContain("1.25 km");
    expect(formatDistance(1250)).toContain("1,250 m");
  });

  it("calculates polyline length for coordinate arrays", () => {
    const coords = [
      [78.0, 15.0],
      [78.01, 15.0],
      [78.02, 15.0],
    ];
    const len = calculateFeatureLengthMeters(coords);
    expect(len).toBeGreaterThan(2000);
    expect(len).toBeLessThan(2300);
  });

  it("calculates spherical polygon area accurately", () => {
    // 1-degree square around equator ~ 111km x 111km ~ 1.23e10 m^2
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const area = calculatePolygonAreaM2(ring);
    expect(area).toBeGreaterThan(1.2e10);
    expect(area).toBeLessThan(1.3e10);
  });

  it("accumulates distances across multiple points with per-segment breakdown", () => {
    const pts = [
      { lat: 15.0, lng: 78.0 },
      { lat: 15.0, lng: 78.01 },
      { lat: 15.0, lng: 78.02 },
    ];
    const { totalDistance, segmentDistances } = accumulateDistances(pts);
    expect(segmentDistances).toHaveLength(2);
    expect(totalDistance).toBe(segmentDistances[0] + segmentDistances[1]);
    expect(totalDistance).toBeGreaterThan(2000);
  });

  it("returns 0 for empty or single point in accumulateDistances", () => {
    expect(accumulateDistances([])).toEqual({ totalDistance: 0, segmentDistances: [] });
    expect(accumulateDistances([{ lat: 10, lng: 10 }])).toEqual({
      totalDistance: 0,
      segmentDistances: [],
    });
  });
});
