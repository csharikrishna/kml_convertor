import { create } from "zustand";
import type { BasemapId, WorkstationLayerState } from "@/types/workstation";
import type { GeoJsonFeatureCollection } from "@/types/geojson";
import type { LabelOrientationMode } from "@/lib/gis/labels";

export interface MeasurementPoint {
  lat: number;
  lng: number;
  title?: string;
}

interface GisState {
  basemap: BasemapId;
  geojson: GeoJsonFeatureCollection | null;
  layers: WorkstationLayerState[];
  layerVisibility: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  layerColors: Record<string, string>;
  medianTextHeight: number;
  labelOrientation: LabelOrientationMode;
  declutterLabels: boolean;

  // Measurement State
  isMeasuring: boolean;
  measurePoints: MeasurementPoint[];
  totalMeasureDistance: number;
  lastSegmentDistance: number;

  // Location selector picker state
  isSelectingLocation: boolean;

  // Map Instance & Navigation Callbacks
  mapInstance: any | null;
  fitBoundsCallback: (() => void) | null;

  // UI Panels
  isLayerPanelOpen: boolean;
  isShareModalOpen: boolean;
  isPdfModalOpen: boolean;
  activeMobileTab: "converter" | "map";
  appMode: "converter" | "survey_studio";

  // Actions
  setAppMode: (mode: "converter" | "survey_studio") => void;
  setBasemap: (basemap: BasemapId) => void;
  setGeoJson: (geojson: GeoJsonFeatureCollection | null) => void;
  setLayerVisibility: (layerName: string, visible: boolean) => void;
  setAllLayersVisibility: (visible: boolean) => void;
  setLayerOpacity: (layerName: string, opacity: number) => void;
  setLabelOrientation: (mode: LabelOrientationMode) => void;
  setDeclutterLabels: (declutter: boolean) => void;
  setIsMeasuring: (measuring: boolean) => void;
  addMeasurePoint: (pt: MeasurementPoint, segDist: number, totalDist: number) => void;
  clearMeasurement: () => void;
  setIsSelectingLocation: (selecting: boolean) => void;
  setIsLayerPanelOpen: (open: boolean) => void;
  toggleLayerPanel: () => void;
  setIsShareModalOpen: (open: boolean) => void;
  setIsPdfModalOpen: (open: boolean) => void;
  setActiveMobileTab: (tab: "converter" | "map") => void;

  // Map Controls
  registerMap: (map: any, fitBoundsCb?: () => void) => void;
  unregisterMap: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitBounds: () => void;
  flyTo: (coords: [number, number], zoom?: number) => void;

  resetGis: () => void;
}

export const useGisStore = create<GisState>((set, get) => ({
  basemap: "google_hybrid",
  geojson: null,
  layers: [],
  layerVisibility: {},
  layerOpacity: {},
  layerColors: {},
  medianTextHeight: 1.0,
  labelOrientation: "cad",
  declutterLabels: true,

  isMeasuring: false,
  measurePoints: [],
  totalMeasureDistance: 0,
  lastSegmentDistance: 0,

  isSelectingLocation: false,
  mapInstance: null,
  fitBoundsCallback: null,

  isLayerPanelOpen: false,
  isShareModalOpen: false,
  isPdfModalOpen: false,
  activeMobileTab: "converter",
  appMode: "survey_studio",

  setAppMode: (appMode) => set({ appMode }),
  setBasemap: (basemap) => set({ basemap }),
  setGeoJson: (geojson) => {
    if (!geojson || !Array.isArray(geojson.features)) {
      set({
        geojson: null,
        layers: [],
        layerVisibility: {},
        layerOpacity: {},
        layerColors: {},
        medianTextHeight: 1.0,
      });
      return;
    }

    const heights = geojson.features
      .filter(
        (f) =>
          f.properties?.type === "text" &&
          Number(f.properties?.text_height) > 0
      )
      .map((f) => Number(f.properties.text_height))
      .sort((a, b) => a - b);
    const median =
      heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 1.0;

    const layerMap = new Map<string, { color: string; count: number }>();
    const visibility: Record<string, boolean> = {};
    const opacity: Record<string, number> = {};
    const colors: Record<string, string> = {};

    geojson.features.forEach((f) => {
      const name = f.properties?.layer || "Default";
      const col =
        (f.properties?.stroke as string) ||
        (f.properties?.color as string) ||
        (f.properties?.label_color as string) ||
        "#3b82f6";
      const existing = layerMap.get(name);
      if (existing) {
        existing.count += 1;
      } else {
        layerMap.set(name, { color: col, count: 1 });
      }
    });

    const layers: WorkstationLayerState[] = Array.from(layerMap.entries()).map(
      ([name, info]) => {
        visibility[name] = true;
        opacity[name] = 1.0;
        colors[name] = info.color;
        return {
          name,
          color: info.color,
          visible: true,
          opacity: 1.0,
          featureCount: info.count,
        };
      }
    );

    set({
      geojson,
      layers,
      layerVisibility: visibility,
      layerOpacity: opacity,
      layerColors: colors,
      medianTextHeight: median,
      activeMobileTab: "map",
    });
  },

  setLayerVisibility: (layerName, visible) =>
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layerName]: visible },
      layers: state.layers.map((l) =>
        l.name === layerName ? { ...l, visible } : l
      ),
    })),

  setAllLayersVisibility: (visible) =>
    set((state) => {
      const newVis: Record<string, boolean> = {};
      state.layers.forEach((l) => {
        newVis[l.name] = visible;
      });
      return {
        layerVisibility: newVis,
        layers: state.layers.map((l) => ({ ...l, visible })),
      };
    }),

  setLayerOpacity: (layerName, opacity) =>
    set((state) => ({
      layerOpacity: { ...state.layerOpacity, [layerName]: opacity },
      layers: state.layers.map((l) =>
        l.name === layerName ? { ...l, opacity } : l
      ),
    })),

  setLabelOrientation: (labelOrientation) => set({ labelOrientation }),
  setDeclutterLabels: (declutterLabels) => set({ declutterLabels }),

  setIsMeasuring: (isMeasuring) =>
    set((state) => ({
      isMeasuring,
      measurePoints: isMeasuring ? state.measurePoints : [],
      totalMeasureDistance: isMeasuring ? state.totalMeasureDistance : 0,
      lastSegmentDistance: isMeasuring ? state.lastSegmentDistance : 0,
    })),

  addMeasurePoint: (pt, segDist, totalDist) =>
    set((state) => ({
      measurePoints: [...state.measurePoints, pt],
      lastSegmentDistance: segDist,
      totalMeasureDistance: totalDist,
    })),

  clearMeasurement: () =>
    set({
      measurePoints: [],
      totalMeasureDistance: 0,
      lastSegmentDistance: 0,
    }),

  setIsSelectingLocation: (isSelectingLocation) => set({ isSelectingLocation }),
  setIsLayerPanelOpen: (isLayerPanelOpen) => set({ isLayerPanelOpen }),
  toggleLayerPanel: () =>
    set((state) => ({ isLayerPanelOpen: !state.isLayerPanelOpen })),
  setIsShareModalOpen: (isShareModalOpen) => set({ isShareModalOpen }),
  setIsPdfModalOpen: (isPdfModalOpen) => set({ isPdfModalOpen }),
  setActiveMobileTab: (activeMobileTab) => set({ activeMobileTab }),

  registerMap: (map, fitBoundsCb) =>
    set({ mapInstance: map, fitBoundsCallback: fitBoundsCb || null }),

  unregisterMap: () =>
    set({ mapInstance: null, fitBoundsCallback: null }),

  zoomIn: () => {
    const map = get().mapInstance;
    if (map && typeof map.zoomIn === "function") {
      map.zoomIn();
    }
  },

  zoomOut: () => {
    const map = get().mapInstance;
    if (map && typeof map.zoomOut === "function") {
      map.zoomOut();
    }
  },

  fitBounds: () => {
    const { fitBoundsCallback, mapInstance } = get();
    if (typeof fitBoundsCallback === "function") {
      fitBoundsCallback();
    } else if (mapInstance && typeof mapInstance.fitBounds === "function") {
      // fallback
    }
  },

  flyTo: (coords, zoom = 14) => {
    const map = get().mapInstance;
    if (map && typeof map.flyTo === "function") {
      map.flyTo(coords, zoom, { duration: 1.5 });
    }
  },

  resetGis: () =>
    set({
      geojson: null,
      layers: [],
      layerVisibility: {},
      layerOpacity: {},
      isMeasuring: false,
      measurePoints: [],
      totalMeasureDistance: 0,
      lastSegmentDistance: 0,
    }),
}));
