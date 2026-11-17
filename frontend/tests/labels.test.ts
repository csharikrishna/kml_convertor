import { describe, it, expect } from "vitest";
import {
  getLabelTier,
  calculateLabelFontSize,
  calculateCssTransform,
  isLabelVisibleAtZoom,
} from "../src/lib/gis/labels";

describe("CAD Label Sizing, Tiering & LOD Algorithms", () => {
  it("assigns correct tiers based on text and height", () => {
    // Tier 1: Major drawing titles and large annotations
    expect(getLabelTier("RESERVOIR DAM ALIGNMENT", 20.0, 10.0)).toBe(1);
    expect(getLabelTier("ALIGNMENT SHEET 1", 8.0, 10.0)).toBe(1);

    // Tier 2: Whole KM Milestones
    expect(getLabelTier("KM 1.000", 10.0, 10.0)).toBe(2);
    expect(getLabelTier("KM 2", 10.0, 10.0)).toBe(2);

    // Tier 3: 500m Intervals
    expect(getLabelTier("KM 1.500", 10.0, 10.0)).toBe(3);

    // Tier 4: 200m Intervals
    expect(getLabelTier("KM 1.200", 10.0, 10.0)).toBe(4);
    expect(getLabelTier("KM 1.600", 10.0, 10.0)).toBe(4);

    // Tier 5: Detailed stations / 100m chainage
    expect(getLabelTier("KM 1.100", 8.0, 10.0)).toBe(5);
    expect(getLabelTier(".100", 8.0, 10.0)).toBe(5);
  });

  it("calculates font size clamped between 9px and 13px", () => {
    const sizeDefault = calculateLabelFontSize(10.0, 1.0, 15, 10.0);
    expect(sizeDefault).toBeGreaterThanOrEqual(9);
    expect(sizeDefault).toBeLessThanOrEqual(13);

    // Extreme high scale still respects max 13px clamp
    const sizeMax = calculateLabelFontSize(50.0, 3.0, 20, 10.0);
    expect(sizeMax).toBe(13);

    // Extreme low scale still respects min 9px clamp
    const sizeMin = calculateLabelFontSize(0.1, 0.1, 10, 10.0);
    expect(sizeMin).toBe(9);
  });

  it("correctly handles AutoCAD text rotation and upright mode", () => {
    const r1 = calculateCssTransform(45, 0.0, 0.5, "cad");
    expect(r1.angleDeg).toBe(315); // (-45) % 360 = 315

    // Upright mode flips angles between 90 and 270
    const r2 = calculateCssTransform(200, 0.0, 0.5, "cad_upright");
    // cssAngle = (-200)%360 = 160. Since 160 is between 90 and 270, it becomes (160 + 180)%360 = 340
    expect(r2.angleDeg).toBe(340);

    // Horizontal mode produces 0deg
    const r3 = calculateCssTransform(45, 0.0, 0.5, "horizontal");
    expect(r3.angleDeg).toBe(0);
  });

  it("applies zoom-based LOD visibility rules", () => {
    // Zoom < 13: Tier 1 only
    expect(isLabelVisibleAtZoom(1, 12)).toBe(true);
    expect(isLabelVisibleAtZoom(2, 12)).toBe(false);

    // Zoom 13: Tiers 1 and 2
    expect(isLabelVisibleAtZoom(2, 13)).toBe(true);
    expect(isLabelVisibleAtZoom(3, 13)).toBe(false);

    // Zoom 15: Tiers 1 through 4
    expect(isLabelVisibleAtZoom(4, 15)).toBe(true);
    expect(isLabelVisibleAtZoom(5, 15)).toBe(false);

    // Zoom >= 16: All tiers
    expect(isLabelVisibleAtZoom(5, 16)).toBe(true);
  });
});
