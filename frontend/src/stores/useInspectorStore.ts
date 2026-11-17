import { create } from "zustand";
import type { InspectedFeatureInfo } from "@/types/geojson";

interface InspectorState {
  inspectedFeature: InspectedFeatureInfo | null;
  cursorLatLon: { lat: number; lon: number } | null;
  cursorUtm: { easting: number; northing: number; zone: number } | null;
  zoomLevel: number;
  lodLabel: string;

  setInspectedFeature: (feature: InspectedFeatureInfo | null) => void;
  setCursorCoordinates: (
    latLon: { lat: number; lon: number } | null,
    utm: { easting: number; northing: number; zone: number } | null
  ) => void;
  setZoomLevel: (zoom: number) => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  inspectedFeature: null,
  cursorLatLon: null,
  cursorUtm: null,
  zoomLevel: 11,
  lodLabel: "Overview (Landmarks)",

  setInspectedFeature: (inspectedFeature) => set({ inspectedFeature }),
  setCursorCoordinates: (cursorLatLon, cursorUtm) =>
    set({ cursorLatLon, cursorUtm }),
  setZoomLevel: (zoom) => {
    let lod = "Detailed (100m)";
    if (zoom < 13) lod = "Overview (Landmarks)";
    else if (zoom <= 14) lod = "Milestones (1km/500m)";
    else if (zoom === 15) lod = "Intervals (200m)";
    set({ zoomLevel: zoom, lodLabel: lod });
  },
}));
