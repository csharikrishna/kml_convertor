import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGisStore } from "../src/stores/useGisStore";
import { useCadastralStore, SurveyPlotRecord } from "../src/stores/useCadastralStore";
import type { GeoJsonFeatureCollection } from "../src/types/geojson";

describe("useGisStore State Architecture", () => {
  beforeEach(() => {
    useGisStore.getState().resetGis();
  });

  const sampleGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { layer: "BUND", stroke: "#ef4444" },
        geometry: { type: "LineString", coordinates: [[78, 15], [78.1, 15.1]] },
      },
      {
        type: "Feature",
        properties: { layer: "CANAL", stroke: "#3b82f6" },
        geometry: { type: "LineString", coordinates: [[78.2, 15.2], [78.3, 15.3]] },
      },
      {
        type: "Feature",
        properties: { layer: "LABELS", type: "text", text_height: 12.5, title: "KM 1.000" },
        geometry: { type: "Point", coordinates: [78, 15] },
      },
      {
        type: "Feature",
        properties: { layer: "LABELS", type: "text", text_height: 8.0, title: "KM 0.500" },
        geometry: { type: "Point", coordinates: [78, 15] },
      },
    ],
  };

  it("extracts layer set, counts, and median text height when GeoJSON is loaded", () => {
    const store = useGisStore.getState();
    store.setGeoJson(sampleGeoJson);

    const updated = useGisStore.getState();
    expect(updated.layers).toHaveLength(3);
    expect(updated.layers.map((l) => l.name).sort()).toEqual(["BUND", "CANAL", "LABELS"]);
    expect(updated.layerVisibility["BUND"]).toBe(true);
    expect(updated.layerOpacity["BUND"]).toBe(1.0);

    // Median of [8.0, 12.5] sorted is 12.5 (index Math.floor(2/2) = 1)
    expect(updated.medianTextHeight).toBe(12.5);
  });

  it("toggles single layer visibility and modifies opacity", () => {
    const store = useGisStore.getState();
    store.setGeoJson(sampleGeoJson);

    store.setLayerVisibility("BUND", false);
    expect(useGisStore.getState().layerVisibility["BUND"]).toBe(false);

    store.setLayerOpacity("CANAL", 0.45);
    expect(useGisStore.getState().layerOpacity["CANAL"]).toBe(0.45);
  });

  it("toggles all layers visibility in bulk (All / None)", () => {
    const store = useGisStore.getState();
    store.setGeoJson(sampleGeoJson);

    // Turn all off
    store.setAllLayersVisibility(false);
    let state = useGisStore.getState();
    expect(state.layerVisibility["BUND"]).toBe(false);
    expect(state.layerVisibility["CANAL"]).toBe(false);
    expect(state.layerVisibility["LABELS"]).toBe(false);

    // Turn all on
    store.setAllLayersVisibility(true);
    state = useGisStore.getState();
    expect(state.layerVisibility["BUND"]).toBe(true);
    expect(state.layerVisibility["CANAL"]).toBe(true);
    expect(state.layerVisibility["LABELS"]).toBe(true);
  });

  it("manages measurement session points and resets properly", () => {
    const store = useGisStore.getState();
    store.setIsMeasuring(true);
    expect(useGisStore.getState().isMeasuring).toBe(true);

    store.addMeasurePoint({ lat: 15.0, lng: 78.0 }, 0, 0);
    store.addMeasurePoint({ lat: 15.1, lng: 78.1 }, 1500, 1500);

    let state = useGisStore.getState();
    expect(state.measurePoints).toHaveLength(2);
    expect(state.totalMeasureDistance).toBe(1500);
    expect(state.lastSegmentDistance).toBe(1500);

    store.clearMeasurement();
    state = useGisStore.getState();
    expect(state.measurePoints).toHaveLength(0);
    expect(state.totalMeasureDistance).toBe(0);
    expect(state.lastSegmentDistance).toBe(0);
  });

  it("handles cadastral parcel selection and URL state synchronization", () => {
    const mockPlot: SurveyPlotRecord = {
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
      chainage_range: "KM 218.200",
      canal_length_m: 350,
      canal_width_m: 25,
      bounds: [
        [14.675, 77.28],
        [14.685, 77.29],
      ],
    };

    const store = useCadastralStore.getState();
    store.setSelectedPlot(mockPlot);

    const updated = useCadastralStore.getState();
    expect(updated.selectedPlot?.survey_no).toBe("160");
    expect(updated.isRightPanelOpen).toBe(true);
    expect(updated.targetFlyToBounds).toEqual(mockPlot.bounds);

    // Clear selection
    store.clearSelection();
    const cleared = useCadastralStore.getState();
    expect(cleared.selectedPlot).toBeNull();
    expect(cleared.isRightPanelOpen).toBe(false);
  });
});
