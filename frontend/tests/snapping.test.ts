import { describe, it, expect } from "vitest";
import { findNearestVertex } from "../src/lib/gis/snapping";
import type { GeoJsonFeatureCollection } from "../src/types/geojson";

describe("GIS Vertex Snapping Engine", () => {
  const sampleGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { layer: "ROAD", type: "polyline" },
        geometry: {
          type: "LineString",
          coordinates: [
            [78.000, 15.000],
            [78.005, 15.005],
            [78.010, 15.010],
          ],
        },
      },
      {
        type: "Feature",
        properties: { layer: "BOUNDARY", type: "polygon" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [78.020, 15.020],
              [78.025, 15.020],
              [78.025, 15.025],
              [78.020, 15.025],
              [78.020, 15.020],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { layer: "STATIONS", type: "point" },
        geometry: {
          type: "Point",
          coordinates: [78.030, 15.030],
        },
      },
    ],
  };

  it("returns null for null or empty geojson", () => {
    expect(findNearestVertex({ lat: 15.0, lng: 78.0 }, null)).toBeNull();
    expect(
      findNearestVertex({ lat: 15.0, lng: 78.0 }, {
        type: "FeatureCollection",
        features: [],
      })
    ).toBeNull();
  });

  it("snaps to exact vertex coordinate when clicked close enough in ground meters", () => {
    // Click 5 meters away from [78.005, 15.005]
    const click = { lat: 15.00502, lng: 78.00502 };
    const snapped = findNearestVertex(click, sampleGeoJson, {
      maxDistanceMeters: 50,
    });

    expect(snapped).not.toBeNull();
    expect(snapped?.lat).toBe(15.005);
    expect(snapped?.lng).toBe(78.005);
    expect(snapped?.distanceMeters).toBeLessThan(10);
  });

  it("snaps to polygon vertex", () => {
    const click = { lat: 15.02498, lng: 78.02498 };
    const snapped = findNearestVertex(click, sampleGeoJson, {
      maxDistanceMeters: 50,
    });

    expect(snapped).not.toBeNull();
    expect(snapped?.lat).toBe(15.025);
    expect(snapped?.lng).toBe(78.025);
  });

  it("snaps to point feature", () => {
    const click = { lat: 15.03001, lng: 78.03001 };
    const snapped = findNearestVertex(click, sampleGeoJson, {
      maxDistanceMeters: 50,
    });

    expect(snapped).not.toBeNull();
    expect(snapped?.lat).toBe(15.030);
    expect(snapped?.lng).toBe(78.030);
  });

  it("snaps based on screen pixels when projection function is supplied", () => {
    // Mock 1 degree = 1000 pixels
    const latLngToScreen = (pt: { lat: number; lng: number }) => ({
      x: pt.lng * 1000,
      y: pt.lat * 1000,
    });

    const click = { lat: 15.00501, lng: 78.00501 };
    const snapped = findNearestVertex(click, sampleGeoJson, {
      latLngToScreenPx: latLngToScreen,
      tolerancePx: 20,
    });

    expect(snapped).not.toBeNull();
    expect(snapped?.lat).toBe(15.005);
    expect(snapped?.lng).toBe(78.005);
    expect(snapped?.distancePx).toBeDefined();
    expect(snapped?.distancePx).toBeLessThan(20);
  });

  it("returns null when click is beyond snapping tolerance", () => {
    const click = { lat: 16.0, lng: 79.0 }; // miles away
    const snapped = findNearestVertex(click, sampleGeoJson, {
      maxDistanceMeters: 50,
    });
    expect(snapped).toBeNull();
  });
});
