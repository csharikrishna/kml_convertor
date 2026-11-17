/**
 * CAD Text Label Font Scaling, Tier Categorization, and LOD Decluttering Algorithms
 * Preserves the exact behavior of the CAD2KML rendering engine.
 */

export function getLabelTier(
  text: string,
  textHeight: number,
  medianHeight = 10.0
): number {
  const str = (text || "").trim();
  const h = Number(textHeight) || 0;
  const med = Number(medianHeight) || 10.0;

  // Tier 1: Major drawing titles, large text annotations (h >= 1.35 * median), or non-chainage words
  if (
    h >= med * 1.35 ||
    (!/^KM\b/i.test(str) && !/^\d+(\.\d+)?$/.test(str) && str.length > 8)
  ) {
    return 1;
  }
  // Tier 2: Whole Kilometer Milestones (e.g., KM 1.000, KM 2.000, KM 1, KM 2)
  if (/^KM\s*\d+(\.000?)?$/i.test(str) || /\.000$/i.test(str)) {
    return 2;
  }
  // Tier 3: 500m Intervals (e.g., KM 0.500, KM 1.500, KM 2.500)
  if (/^KM\s*\d+\.[50]00?$/i.test(str) || /\.[50]00$/i.test(str)) {
    return 3;
  }
  // Tier 4: 200m Intervals (e.g., .200, .400, .600, .800)
  if (/^KM\s*\d+\.[2468]00?$/i.test(str) || /\.[2468]00$/i.test(str)) {
    return 4;
  }
  // Tier 5: Detailed 100m chainage and all minor stations
  return 5;
}

export function calculateLabelFontSize(
  textHeight: number,
  labelScale = 1.0,
  zoom = 15,
  medianTextHeight = 1.0
): number {
  const zoomDiff = zoom - 15;
  const zoomFactor = 1 + zoomDiff * 0.04;

  let cadHeightFactor = 1.0;
  const h = Number(textHeight);
  if (h > 0 && medianTextHeight > 0) {
    const ratio = h / medianTextHeight;
    cadHeightFactor = Math.max(0.9, Math.min(1.2, Math.pow(ratio, 0.2)));
  }

  const scale = labelScale > 0 ? 0.8 + 0.2 * Math.min(labelScale, 1.5) : 1.0;
  const calculatedPx = 11.0 * scale * zoomFactor * cadHeightFactor;
  return Math.max(9, Math.min(13, Math.round(calculatedPx)));
}

export type LabelOrientationMode = "cad" | "cad_upright" | "horizontal";

export function calculateCssTransform(
  rotation = 0,
  anchorX = 0.0,
  anchorY = 0.5,
  orientation: LabelOrientationMode = "cad"
): { transformOrigin: string; transform: string; angleDeg: number } {
  const pctX = Math.round(anchorX * 100);
  const pctY = Math.round(anchorY * 100);
  const transformOrigin = `${pctX}% ${pctY}%`;

  if (orientation !== "horizontal" && Math.abs(rotation) > 0.01) {
    let cssAngle = (-rotation) % 360;
    if (cssAngle < 0) cssAngle += 360;
    if (orientation === "cad_upright" && cssAngle > 90 && cssAngle < 270) {
      cssAngle = (cssAngle + 180) % 360;
    }
    return {
      transformOrigin,
      transform: `translate(-${pctX}%, -${pctY}%) rotate(${cssAngle}deg)`,
      angleDeg: cssAngle,
    };
  }

  return {
    transformOrigin,
    transform: `translate(-${pctX}%, -${pctY}%)`,
    angleDeg: 0,
  };
}

export function isLabelVisibleAtZoom(tier: number, zoom: number): boolean {
  if (zoom < 13 && tier > 1) return false;
  if (zoom === 13 && tier > 2) return false;
  if (zoom === 14 && tier > 3) return false;
  if (zoom === 15 && tier > 4) return false;
  return true;
}
