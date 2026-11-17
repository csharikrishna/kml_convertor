import { describe, it, expect, beforeAll } from "vitest";
import { CadastralSearchIndex, normalizeCadastralQuery } from "../src/lib/gis/searchIndex";
import { CadastralProjectData, SurveyPlotRecord } from "../src/stores/useCadastralStore";

describe("CadastralSearchIndex & Exact Resolution Engine", () => {
  const samplePlots: SurveyPlotRecord[] = [
    {
      survey_no: "6",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 10000,
      total_acres: 2.47,
      total_ac_cts: "2 Ac 47 Cts",
      canal_passing: false,
      acquired_area_m2: 0,
      acquired_acres: 0,
      balance_area_m2: 10000,
      balance_acres: 2.47,
      chainage_range: "Non-acquired",
      canal_length_m: 0,
      canal_width_m: 0,
      pattadar_name: "Venkat Reddy",
    },
    {
      survey_no: "16",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 20000,
      total_acres: 4.94,
      total_ac_cts: "4 Ac 94 Cts",
      canal_passing: false,
      acquired_area_m2: 0,
      acquired_acres: 0,
      balance_area_m2: 20000,
      balance_acres: 4.94,
      chainage_range: "Non-acquired",
      canal_length_m: 0,
      canal_width_m: 0,
      pattadar_name: "Narayana Swamy",
    },
    {
      survey_no: "60",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 15000,
      total_acres: 3.71,
      total_ac_cts: "3 Ac 71 Cts",
      canal_passing: false,
      acquired_area_m2: 0,
      acquired_acres: 0,
      balance_area_m2: 15000,
      balance_acres: 3.71,
      chainage_range: "Non-acquired",
      canal_length_m: 0,
      canal_width_m: 0,
      pattadar_name: "Lakshmi Devi",
    },
    {
      survey_no: "160",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 40000,
      total_acres: 9.88,
      total_ac_cts: "9 Ac 88 Cts",
      canal_passing: true,
      acquired_area_m2: 8000,
      acquired_acres: 1.98,
      balance_area_m2: 32000,
      balance_acres: 7.9,
      chainage_range: "Ch. 218+200 - Ch. 218+600",
      canal_length_m: 350,
      canal_width_m: 25,
      pattadar_name: "Ramanjaneyulu",
    },
    {
      survey_no: "160/1",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 12000,
      total_acres: 2.97,
      total_ac_cts: "2 Ac 97 Cts",
      canal_passing: false,
      acquired_area_m2: 0,
      acquired_acres: 0,
      balance_area_m2: 12000,
      balance_acres: 2.97,
      chainage_range: "Non-acquired",
      canal_length_m: 0,
      canal_width_m: 0,
      pattadar_name: "Subba Rao",
    },
    {
      survey_no: "Cart Track / Road (R-160)",
      village: "TestVillage",
      mandal: "TestMandal",
      district: "TestDistrict",
      total_area_m2: 5000,
      total_acres: 1.24,
      total_ac_cts: "1 Ac 24 Cts",
      canal_passing: false,
      acquired_area_m2: 0,
      acquired_acres: 0,
      balance_area_m2: 5000,
      balance_acres: 1.24,
      chainage_range: "Non-acquired",
      canal_length_m: 0,
      canal_width_m: 0,
      is_poramboke: true,
    },
  ];

  const dummyProjectData: CadastralProjectData = {
    success: true,
    village: "TestVillage",
    mandal: "TestMandal",
    district: "TestDistrict",
    summary: {
      total_plots: 6,
      affected_plots: 1,
      total_area_acres: 26.21,
      acquired_area_acres: 1.98,
      balance_area_acres: 24.23,
    },
    layers: {
      survey_plots: null,
      canal_alignment: null,
      canal_buffer: null,
      roads: null,
      village_boundary: null,
      structures: null,
      chainage_markers: null,
    },
    survey_register: samplePlots,
  };

  const index = new CadastralSearchIndex(dummyProjectData);

  it("normalizes official survey prefixes cleanly", () => {
    expect(normalizeCadastralQuery("Survey No. 160").stripped).toBe("160");
    expect(normalizeCadastralQuery("Sy. 160").stripped).toBe("160");
    expect(normalizeCadastralQuery("S.No 160").stripped).toBe("160");
    expect(normalizeCadastralQuery("Plot 160").stripped).toBe("160");
    expect(normalizeCadastralQuery("Sy. 160/1").stripped).toBe("160/1");
    // Telugu script prefixes
    expect(normalizeCadastralQuery("సర్వే నెం. 160").stripped).toBe("160");
    expect(normalizeCadastralQuery("సర్వే నెంబర్ 160/1").stripped).toBe("160/1");
    expect(normalizeCadastralQuery("స.నెం 160").stripped).toBe("160");
  });

  it("resolves Telugu script survey queries accurately", () => {
    const teluguMatch = index.findExactPlot("సర్వే నెం. 160");
    expect(teluguMatch).not.toBeNull();
    expect(teluguMatch?.survey_no).toBe("160");

    const teluguSubMatch = index.findExactPlot("సర్వే నెం. 160/1");
    expect(teluguSubMatch).not.toBeNull();
    expect(teluguSubMatch?.survey_no).toBe("160/1");
  });

  it("prevents cadastral stop words from polluting pattadar landowner searches", () => {
    // When searching for "Survey No. 160", "no" or "survey" must NOT match landowners with "no" in their name
    const results = index.search("Survey No. 160");
    // All results should be related to 160, not random pattadars matching "no"
    for (const r of results) {
      if (r.plot) {
        expect(r.plot.survey_no.startsWith("160") || r.plot.survey_no.includes("160")).toBe(true);
      }
    }
  });

  it("restricts specific road queries to matching roads rather than returning all roads", () => {
    const results = index.search("R-160");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].plot?.survey_no).toBe("Cart Track / Road (R-160)");
    // Should not include other arbitrary roads like R-1, R-2
    const nonMatchingRoads = results.filter((r) => r.type === "road" && !r.title.includes("R-160"));
    expect(nonMatchingRoads.length).toBe(0);
  });

  it("finds exact plot with zero false positives (160 does NOT match 6, 16, or 60)", () => {
    const match160 = index.findExactPlot("160");
    expect(match160).not.toBeNull();
    expect(match160?.survey_no).toBe("160");

    const match6 = index.findExactPlot("6");
    expect(match6).not.toBeNull();
    expect(match6?.survey_no).toBe("6");

    const match16 = index.findExactPlot("16");
    expect(match16).not.toBeNull();
    expect(match16?.survey_no).toBe("16");

    const match60 = index.findExactPlot("60");
    expect(match60).not.toBeNull();
    expect(match60?.survey_no).toBe("60");

    // Non-existent number
    expect(index.findExactPlot("999")).toBeNull();
  });

  it("prioritizes exact parcel matches over road and cart tracks", () => {
    const results = index.search("160");
    expect(results.length).toBeGreaterThan(0);
    // First result MUST be exact plot 160, NOT the road Cart Track / Road (R-160)
    expect(results[0].plot?.survey_no).toBe("160");
    expect(results[0].score).toBeGreaterThanOrEqual(950);
  });

  it("resolves pattadar landowner name search", () => {
    const results = index.search("Ramanjaneyulu");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].plot?.survey_no).toBe("160");
    expect(results[0].badge).toBe("Pattadar Match");
  });

  it("resolves subdivision queries", () => {
    const exactSub = index.findExactPlot("160/1");
    expect(exactSub).not.toBeNull();
    expect(exactSub?.survey_no).toBe("160/1");

    const searchSub = index.search("160");
    const subResult = searchSub.find((r) => r.plot?.survey_no === "160/1");
    expect(subResult).toBeDefined();
  });

  it("executes exact lookup in under 5 milliseconds benchmark", () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      index.findExactPlot("Survey No. 160");
      index.findExactPlot("16");
      index.findExactPlot("6");
      index.findExactPlot("60");
    }
    const end = performance.now();
    const durationPerLookup = (end - start) / 2000;
    // Target is < 5ms, indexed lookup should be < 0.1ms!
    expect(durationPerLookup).toBeLessThan(1.0);
  });
});
