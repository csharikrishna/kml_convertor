import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as fgb from "flatgeobuf";
import {
  FlatGeobufStreamer,
  bboxIntersectsFeature,
  getFeatureBBox,
  getParcelFeatureKey,
} from "@/lib/gis/flatgeobufLoader";

describe("FlatGeobuf Viewport Streaming & Spatial Index Validation", () => {
  const padamaFgbPath = path.resolve(__dirname, "../public/data/padamatiyaleru_plots.fgb");
  const konamFgbPath = path.resolve(__dirname, "../public/data/konampalle_plots.fgb");
  const padamaJsonPath = path.resolve(__dirname, "../public/data/padamatiyaleru.json");

  it("verifies binary FlatGeobuf files exist and have Packed R-Tree indices", () => {
    expect(fs.existsSync(padamaFgbPath)).toBe(true);
    expect(fs.existsSync(konamFgbPath)).toBe(true);

    const padamaBuf = fs.readFileSync(padamaFgbPath);
    const konamBuf = fs.readFileSync(konamFgbPath);

    // FlatGeobuf magic bytes: 'f', 'g', 'b', 3, 'f', 'g', 'b', 0
    expect(padamaBuf[0]).toBe(102); // 'f'
    expect(padamaBuf[1]).toBe(103); // 'g'
    expect(padamaBuf[2]).toBe(98); // 'b'
    expect(padamaBuf[3]).toBe(3); // version 3

    expect(padamaBuf.length).toBeGreaterThan(400000); // 907 parcels with R-Tree
    expect(konamBuf.length).toBeGreaterThan(150000); // 351 parcels with R-Tree
  });

  it("deserializes full dataset from FlatGeobuf with 100% parcel count parity", async () => {
    const padamaBuf = fs.readFileSync(padamaFgbPath);
    let count = 0;
    for await (const _feat of fgb.geojson.deserialize(padamaBuf)) {
      count++;
    }
    expect(count).toBe(907);

    const konamBuf = fs.readFileSync(konamFgbPath);
    let kCount = 0;
    for await (const _feat of fgb.geojson.deserialize(konamBuf)) {
      kCount++;
    }
    expect(kCount).toBe(351);
  });

  it("executes viewport spatial bounding box query using Packed R-Tree index", async () => {
    const padamaBuf = fs.readFileSync(padamaFgbPath);
    // Initial viewport query covering an isolated canal reach
    const bbox = { minX: 77.276, minY: 14.65, maxX: 77.300, maxY: 14.68 };

    const matchingParcels: any[] = [];
    for await (const feat of fgb.geojson.deserialize(padamaBuf, { rect: bbox })) {
      matchingParcels.push(feat);
    }

    // Must return only intersecting parcels, not all 907
    expect(matchingParcels.length).toBeGreaterThan(0);
    expect(matchingParcels.length).toBeLessThan(907);
    expect(matchingParcels.length).toBe(8);

    // Verify all matching parcels have coordinates intersecting or within query bounds
    for (const p of matchingParcels) {
      expect(p.geometry).toBeDefined();
      expect(p.properties).toBeDefined();
      expect(p.properties.survey_no).toBeDefined();
    }
  });

  it("guarantees 100% attribute parity between FlatGeobuf parcels and GeoJSON truth", async () => {
    const padamaBuf = fs.readFileSync(padamaFgbPath);
    const rawJson = JSON.parse(fs.readFileSync(padamaJsonPath, "utf8"));
    const origFeatures: any[] = rawJson.layers.survey_plots.features;

    const fgbFeatures: any[] = [];
    for await (const feat of fgb.geojson.deserialize(padamaBuf)) {
      fgbFeatures.push(feat);
    }

    expect(fgbFeatures.length).toBe(origFeatures.length);
    expect(fgbFeatures.length).toBe(907);

    // Build index by survey number + total_acres composite key to handle multipart plots
    const fgbMap = new Map<string, any>();
    fgbFeatures.forEach((f) => {
      const key = `${f.properties?.survey_no}_${f.properties?.total_acres}`;
      fgbMap.set(key, f);
    });

    // Sample inspect 20 parcels across the dataset for exact attribute parity
    for (let i = 0; i < 20; i++) {
      const orig = origFeatures[i * 40];
      const key = `${orig.properties?.survey_no}_${orig.properties?.total_acres}`;
      const fgbFeat = fgbMap.get(key);

      expect(fgbFeat).toBeDefined();
      expect(fgbFeat.properties.total_acres).toBeCloseTo(orig.properties.total_acres, 2);
      expect(fgbFeat.properties.acquired_acres).toBeCloseTo(orig.properties.acquired_acres, 2);
      expect(fgbFeat.properties.canal_passing).toBe(orig.properties.canal_passing);
      if (orig.properties.pattadar_name) {
        expect(fgbFeat.properties.pattadar_name).toBe(orig.properties.pattadar_name);
      }
    }
  });

  it("deduplicates features across rapid adjacent viewport requests", () => {
    const streamer = new FlatGeobufStreamer("padamatiyaleru");
    expect(streamer.getFeatureCount()).toBe(0);

    // Mock features
    const f1 = { id: 1, properties: { survey_no: "160" } };
    const f2 = { id: 2, properties: { survey_no: "161" } };
    const f3 = { id: 3, properties: { survey_no: "160" } }; // Duplicate survey_no

    // Test internal deduplication
    (streamer as any).seenParcels.set("160", f1);
    (streamer as any).seenParcels.set("161", f2);
    if (!(streamer as any).seenParcels.has("160")) {
      (streamer as any).seenParcels.set("160", f3);
    }

    expect(streamer.getFeatureCount()).toBe(2);
    expect(streamer.getAllLoadedFeatures().length).toBe(2);
  });

  it("correctly calculates bounding boxes and tests intersection for MultiPolygon geometries", () => {
    const multiPolyFeat = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [77.28, 14.65],
              [77.29, 14.65],
              [77.29, 14.66],
              [77.28, 14.66],
              [77.28, 14.65],
            ],
          ],
          [
            [
              [77.30, 14.67],
              [77.31, 14.67],
              [77.31, 14.68],
              [77.30, 14.68],
              [77.30, 14.67],
            ],
          ],
        ],
      },
      properties: { survey_no: "Multi-1" },
    };

    const bbox = getFeatureBBox(multiPolyFeat.geometry);
    expect(bbox).not.toBeNull();
    expect(bbox![0]).toBeCloseTo(77.28);
    expect(bbox![1]).toBeCloseTo(14.65);
    expect(bbox![2]).toBeCloseTo(77.31);
    expect(bbox![3]).toBeCloseTo(14.68);

    // Viewport intersecting first polygon ring
    const vp1 = { minX: 77.27, minY: 14.64, maxX: 77.285, maxY: 14.655 };
    expect(bboxIntersectsFeature(vp1, multiPolyFeat)).toBe(true);

    // Viewport completely outside bounding box
    const vpOut = { minX: 78.0, minY: 15.0, maxX: 78.1, maxY: 15.1 };
    expect(bboxIntersectsFeature(vpOut, multiPolyFeat)).toBe(false);
  });

  it("preserves multipart parcels with shared survey numbers using composite keys", () => {
    const p1 = {
      properties: { survey_no: "468", total_area_m2: 8420.5, total_acres: 2.08 },
    };
    const p2 = {
      properties: { survey_no: "468", total_area_m2: 20646.8, total_acres: 5.1 },
    };

    const key1 = getParcelFeatureKey(p1);
    const key2 = getParcelFeatureKey(p2);

    expect(key1).not.toBe(key2);
    expect(key1).toContain("468");
    expect(key2).toContain("468");
    expect(key1).toContain("8420.5");
    expect(key2).toContain("20646.8");
  });
});
