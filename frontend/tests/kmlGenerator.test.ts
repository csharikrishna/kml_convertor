import { describe, it, expect } from "vitest";
import { generatePlotKml, generateProjectKml } from "../src/lib/gis/kmlGenerator";
import { CadastralProjectData, SurveyPlotRecord } from "../src/stores/useCadastralStore";

describe("Cadastral KML Generation Engine", () => {
  const mockPlot: SurveyPlotRecord = {
    survey_no: "160",
    village: "Konampalle",
    mandal: "Beluguppa",
    district: "Anantapur",
    total_area_m2: 40000,
    total_acres: 9.88,
    total_ac_cts: "9 Ac 88 Cts",
    canal_passing: true,
    acquired_area_m2: 8000,
    acquired_acres: 1.98,
    balance_area_m2: 32000,
    balance_acres: 7.9,
    chainage_range: "KM 218.200 - 218.600",
    canal_length_m: 350,
    canal_width_m: 25,
    pattadar_name: "Ramanjaneyulu",
    bounds: [
      [14.675, 77.28],
      [14.685, 77.29],
    ],
  };

  const mockProjectData: CadastralProjectData = {
    success: true,
    village: "Konampalle",
    mandal: "Beluguppa",
    district: "Anantapur",
    summary: {
      total_plots: 1,
      affected_plots: 1,
      total_area_acres: 9.88,
      acquired_area_acres: 1.98,
      balance_area_acres: 7.9,
    },
    layers: {
      survey_plots: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { survey_no: "160", canal_passing: true, total_acres: 9.88, acquired_acres: 1.98 },
            geometry: {
              type: "Polygon",
              // Exterior ring + 1 Interior hole ring
              coordinates: [
                [
                  [77.28, 14.675],
                  [77.29, 14.675],
                  [77.29, 14.685],
                  [77.28, 14.685],
                  [77.28, 14.675],
                ],
                [
                  [77.283, 14.678],
                  [77.287, 14.678],
                  [77.287, 14.682],
                  [77.283, 14.682],
                  [77.283, 14.678],
                ],
              ],
            },
          },
        ],
      },
      canal_alignment: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { title: "Alignment" },
            geometry: {
              type: "LineString",
              coordinates: [
                [77.28, 14.68],
                [77.29, 14.68],
              ],
            },
          },
        ],
      },
      canal_buffer: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { title: "Buffer" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [77.28, 14.679],
                  [77.29, 14.679],
                  [77.29, 14.681],
                  [77.28, 14.681],
                  [77.28, 14.679],
                ],
              ],
            },
          },
        ],
      },
      roads: null,
      village_boundary: null,
      structures: null,
      chainage_markers: null,
    },
    survey_register: [mockPlot],
  };

  it("generates OGC KML 2.2 compliant plot XML", () => {
    const kml = generatePlotKml(mockPlot, mockProjectData);

    // KML 2.2 namespace
    expect(kml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    expect(kml).toContain("<Document>");
    expect(kml).toContain("</Document>");
    expect(kml).toContain("<name>Survey Plot 160 - Konampalle</name>");

    // Coordinates order in KML: lon,lat,alt
    expect(kml).toContain("77.2800000,14.6750000,0");

    // Outer boundary
    expect(kml).toContain("<outerBoundaryIs>");
    expect(kml).toContain("</outerBoundaryIs>");

    // Inner boundary (holes) preserved!
    expect(kml).toContain("<innerBoundaryIs>");
    expect(kml).toContain("77.2830000,14.6780000,0");
    expect(kml).toContain("</innerBoundaryIs>");

    // Clamp to ground altitude mode
    expect(kml).toContain("<altitudeMode>clampToGround</altitudeMode>");

    // Strict OGC KML 2.2 schema: tessellate must NOT appear directly inside Polygon
    expect(kml).not.toMatch(/<Polygon>\s*<tessellate>/);

    // Strict ring closure: every LinearRing coordinates must start and end at the same vertex
    const ringCoordsMatches = kml.matchAll(/<LinearRing>\s*<coordinates>([^<]+)<\/coordinates>\s*<\/LinearRing>/g);
    for (const match of ringCoordsMatches) {
      const coords = match[1].trim().split(" ");
      expect(coords.length).toBeGreaterThanOrEqual(4);
      expect(coords[0]).toBe(coords[coords.length - 1]);
    }
  });

  it("generates complete project KML with infrastructure folders and plot layers", () => {
    const kml = generateProjectKml(mockProjectData);

    expect(kml).toContain("<name>Canal Infrastructure</name>");
    expect(kml).toContain("<name>Survey Plots</name>");
    expect(kml).toContain("<name>Canal Alignment Centerline</name>");
    expect(kml).toContain("<name>Canal Proposed RoW Corridor</name>");
    expect(kml).toContain("<name>Sy 160</name>");
  });
});
