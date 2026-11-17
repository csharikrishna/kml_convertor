import { describe, it, expect, afterAll } from "vitest";
import { getGeodesyWorker } from "@/lib/gis/geodesyWorkerClient";
import {
  calculatePolygonAreaM2Worker,
  calculateFeatureLengthMetersWorker,
  computeGeodesicDistanceWorker,
  validateGeometryWorker,
  checkSpatialIntersectsWorker,
  bulkPreprocessParcelsWorker,
  transformOffsetWorker,
} from "@/lib/gis/geodesy.worker";

describe("Geodesy Web Worker & Spatial Math Engine", () => {
  const worker = getGeodesyWorker();

  afterAll(() => {
    worker.terminate();
  });

  it("calculates exact geodesic distance between known geographic coordinates", () => {
    // 1 degree latitude along equator ~ 111,195 meters
    const dist = computeGeodesicDistanceWorker(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(111500);

    // Antipodal / zero distance
    expect(computeGeodesicDistanceWorker(14.5, 77.5, 14.5, 77.5)).toBe(0);
  });

  it("calculates polygon area in square meters and acres via worker client", async () => {
    // Square polygon ring around (14.65, 77.28) of ~ 0.001 deg (~111m x 111m ~ 12,321 m2)
    const ring = [
      [77.28, 14.65],
      [77.281, 14.65],
      [77.281, 14.651],
      [77.28, 14.651],
      [77.28, 14.65],
    ];

    const res = await worker.calculateArea(ring);
    expect(res.areaM2).toBeGreaterThan(10000);
    expect(res.areaM2).toBeLessThan(15000);
    expect(res.acres).toBeCloseTo(res.areaM2 / 4046.8564, 1);
  });

  it("calculates polyline length with dual representation via worker client", async () => {
    const coords = [
      [77.28, 14.65],
      [77.29, 14.65],
      [77.30, 14.65],
    ];

    const res = await worker.calculateLength(coords);
    expect(res.lengthMeters).toBeGreaterThan(2000);
    expect(res.formatted).toContain("km");
  });

  it("accumulates measurement distances across path segments", async () => {
    const points = [
      { lat: 14.65, lng: 77.28 },
      { lat: 14.66, lng: 77.28 },
      { lat: 14.67, lng: 77.28 },
    ];

    const res = await worker.accumulateDistances(points);
    expect(res.segmentDistances.length).toBe(2);
    expect(res.totalDistance).toBeCloseTo(res.segmentDistances[0] + res.segmentDistances[1], 3);
  });

  it("validates geometry topology and flags unclosed rings or invalid ranges", async () => {
    // Valid closed ring
    const validRing = [
      [77.28, 14.65],
      [77.281, 14.65],
      [77.281, 14.651],
      [77.28, 14.651],
      [77.28, 14.65],
    ];
    const resValid = await worker.validateGeometry(validRing, "Polygon");
    expect(resValid.isValid).toBe(true);
    expect(resValid.isClosed).toBe(true);
    expect(resValid.errors.length).toBe(0);

    // Unclosed ring
    const unclosedRing = [
      [77.28, 14.65],
      [77.281, 14.65],
      [77.281, 14.651],
      [77.28, 14.651],
    ];
    const resUnclosed = await worker.validateGeometry(unclosedRing, "Polygon");
    expect(resUnclosed.isValid).toBe(false);
    expect(resUnclosed.isClosed).toBe(false);
    expect(resUnclosed.errors.some((e) => e.includes("closed"))).toBe(true);
  });

  it("computes spatial intersection between two polygon rings", async () => {
    const ringA = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const ringOverlapping = [
      [5, 5],
      [15, 5],
      [15, 15],
      [5, 15],
      [5, 5],
    ];
    const ringDisjoint = [
      [100, 100],
      [110, 100],
      [110, 110],
      [100, 110],
      [100, 100],
    ];

    expect(await worker.checkSpatialIntersects(ringA, ringOverlapping)).toBe(true);
    expect(await worker.checkSpatialIntersects(ringA, ringDisjoint)).toBe(false);
  });

  it("executes bulk parcel preprocessing in parallel worker batch", async () => {
    const parcels = [
      {
        survey_no: "160/1",
        ring: [
          [77.28, 14.65],
          [77.281, 14.65],
          [77.281, 14.651],
          [77.28, 14.651],
          [77.28, 14.65],
        ],
      },
      {
        survey_no: "160/2",
        ring: [
          [77.281, 14.65],
          [77.282, 14.65],
          [77.282, 14.651],
          [77.281, 14.651],
          [77.281, 14.65],
        ],
      },
    ];

    const processed = await worker.bulkPreprocessParcels(parcels);
    expect(processed.length).toBe(2);
    expect(processed[0].survey_no).toBe("160/1");
    expect(processed[0].acres).toBeGreaterThan(0);
    expect(processed[0].center[0]).toBeCloseTo(14.6505, 3);
    expect(processed[0].center[1]).toBeCloseTo(77.2805, 3);
  });

  it("applies vector spatial calibration offset shift", async () => {
    const coords = [
      [77.28, 14.65],
      [77.29, 14.66],
    ];
    // Shift 10 meters East, 20 meters North
    const shifted = await worker.transformOffset(coords, 10, 20);
    expect(shifted[0][0]).toBeGreaterThan(77.28);
    expect(shifted[0][1]).toBeGreaterThan(14.65);
  });

  it("executes seamless fallback on worker crash or CSP restriction without throwing unhandled exceptions", async () => {
    // Simulate runtime worker crash / CSP denial
    worker.triggerFallbackMode();

    const ring = [
      [77.28, 14.65],
      [77.281, 14.65],
      [77.281, 14.651],
      [77.28, 14.651],
      [77.28, 14.65],
    ];

    // Must resolve seamlessly via synchronous main thread fallback
    const res = await worker.calculateArea(ring);
    expect(res.areaM2).toBeGreaterThan(10000);
    expect(res.acres).toBeGreaterThan(0);

    const points = [
      { lat: 14.65, lng: 77.28 },
      { lat: 14.66, lng: 77.28 },
    ];
    const distRes = await worker.accumulateDistances(points);
    expect(distRes.totalDistance).toBeGreaterThan(1000);
  });
});
