import { accumulateDistances, calculatePolygonAreaM2 } from "@/lib/gis/geodesy";
import { create } from "zustand";

export interface SurveyPlotRecord {
  survey_no: string;
  village: string;
  mandal: string;
  district: string;
  total_area_m2: number;
  total_acres: number;
  total_ac_cts: string;
  canal_passing: boolean;
  acquired_area_m2: number;
  acquired_acres: number;
  balance_area_m2: number;
  balance_acres: number;
  chainage_range: string;
  canal_length_m: number;
  canal_width_m: number;
  is_poramboke?: boolean;
  land_type?: string;
  pattadar_name?: string;
  khata_no?: string;
  land_nature?: string;
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  local_poly?: [number, number][];
  local_canal?: [number, number][][];
}

export interface CadastralSummary {
  total_plots: number;
  affected_plots: number;
  total_area_acres: number;
  acquired_area_acres: number;
  balance_area_acres: number;
}

export interface CadastralProjectMeta {
  id: string;
  title: string;
  village: string;
  mandal?: string;
  district?: string;
  filename?: string;
  crs?: string;
  plots_count?: number;
  affected_count?: number;
  chainage_span?: string;
  has_excel?: boolean;
  has_pdf?: boolean;
  is_sample?: boolean;
  is_custom?: boolean;
  available?: boolean;
  created_at?: string;
}

export interface CadastralProjectData {
  success: boolean;
  village: string;
  mandal: string;
  district: string;
  summary: CadastralSummary;
  layers: {
    survey_plots: any;
    canal_alignment: any;
    canal_buffer: any;
    roads: any;
    village_boundary: any;
    structures: any;
    chainage_markers: any;
  };
  survey_register: SurveyPlotRecord[];
  project_id?: string;
  title?: string;
  documents?: Array<{
    title: string;
    filename: string;
    url: string;
    size_bytes?: number;
  }>;
}

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface LayerVisibility {
  canal_alignment: boolean;
  canal_buffer: boolean;
  survey_plots: boolean;
  plot_boundaries: boolean;
  roads: boolean;
  village_boundary: boolean;
  chainage_markers: boolean;
  structures: boolean;
  contours: boolean;
  topo_points: boolean;
  drainage: boolean;
  lulc: boolean;
}

interface CadastralState {
  currentProjectId: string;
  projectsList: CadastralProjectMeta[];
  projectData: CadastralProjectData | null;
  selectedPlot: SurveyPlotRecord | null;
  hoveredPlot: SurveyPlotRecord | null;
  isLoading: boolean;
  error: string | null;

  // Map Basemap
  baseMap: "satellite" | "osm" | "imagery" | "carto" | "apsac";
  setBaseMap: (basemap: "satellite" | "osm" | "imagery" | "carto" | "apsac") => void;

  // APSAC Government Cadastral Overlay
  apsacOverlay: boolean;
  apsacOpacity: number;
  setApsacOverlay: (enabled: boolean) => void;
  setApsacOpacity: (opacity: number) => void;

  // Layer visibility
  layers: LayerVisibility;
  toggleLayer: (layerKey: keyof LayerVisibility) => void;
  setLayer: (layerKey: keyof LayerVisibility, visible: boolean) => void;

  // Measurement Tools
  measurementMode: "none" | "distance" | "area";
  setMeasurementMode: (mode: "none" | "distance" | "area") => void;
  measurePoints: LatLngPoint[];
  setMeasurePoints: (points: LatLngPoint[] | ((prev: LatLngPoint[]) => LatLngPoint[])) => void;
  measureTotalDist: number;
  setMeasureTotalDist: (dist: number) => void;
  measureAreaM2: number;
  setMeasureAreaM2: (area: number) => void;
  undoMeasurePoint: () => void;
  clearMeasurement: () => void;

  // Active Map Tool
  mapTool: "select" | "pan" | "identify";
  setMapTool: (tool: "select" | "pan" | "identify") => void;

  // Highlighted Spatial Intersection
  highlightedIntersection: string | null;
  setHighlightedIntersection: (id: string | null) => void;

  // Layer Opacities
  layerOpacity: Record<string, number>;
  setLayerOpacity: (layerKey: string, opacity: number) => void;
  isolateLayer: (layerKey: keyof LayerVisibility) => void;

  // Unit preferences
  unitMode: "acres" | "hectares" | "sq_meters";
  setUnitMode: (mode: "acres" | "hectares" | "sq_meters") => void;

  // Left & Right Panels
  isLeftPanelCollapsed: boolean;
  setIsLeftPanelCollapsed: (collapsed: boolean) => void;
  activeLeftRibbon: "layers" | "basemaps" | "legend" | "measurements";
  setActiveLeftRibbon: (ribbon: "layers" | "basemaps" | "legend" | "measurements") => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean) => void;
  isMobileSheetExpanded: boolean;
  setIsMobileSheetExpanded: (expanded: boolean) => void;
  layerSearchQuery: string;
  setLayerSearchQuery: (q: string) => void;

  // Modals
  isTableModalOpen: boolean;
  setTableModalOpen: (open: boolean) => void;
  isUploadModalOpen: boolean;
  setUploadModalOpen: (open: boolean) => void;
  isCreateProjectModalOpen: boolean;
  setCreateProjectModalOpen: (open: boolean) => void;
  previewDocument: {
    title: string;
    desc: string;
    type: string;
    date: string;
    status?: string;
    content?: string;
    filename?: string;
  } | null;
  setPreviewDocument: (doc: any) => void;
  layerInfoModal: {
    key: string;
    label: string;
    category: string;
    count: number;
    geometryType: string;
    description: string;
  } | null;
  setLayerInfoModal: (info: any) => void;

  // Active right HUD tab
  activeTab: "summary" | "attributes" | "intersections" | "documents";
  setActiveTab: (tab: "summary" | "attributes" | "intersections" | "documents") => void;

  // Search & Navigation
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  targetFlyToBounds: [[number, number], [number, number]] | null;
  setTargetFlyToBounds: (bounds: [[number, number], [number, number]] | null) => void;

  // Actions
  fetchProjectsList: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  setSelectedPlot: (plot: SurveyPlotRecord | null) => void;
  clearSelection: () => void;
  setHoveredPlot: (plot: SurveyPlotRecord | null) => void;
  setProjectData: (data: CadastralProjectData) => void;
}

const apiEndpoint = (path: string) => {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "";
  return `${base}${path}`;
};

const DEFAULT_LAYERS: LayerVisibility = {
  canal_alignment: true,
  canal_buffer: true,
  survey_plots: true,
  plot_boundaries: true,
  roads: true,
  village_boundary: true,
  chainage_markers: true,
  structures: true,
  contours: false,
  topo_points: false,
  drainage: false,
  lulc: false,
};

export const useCadastralStore = create<CadastralState>((set, get) => ({
  currentProjectId: "konampalle",
  projectsList: [
    {
      id: "konampalle",
      title: "Konampalle Canal Project (KM 216.300 - 219.750)",
      village: "Konampalle",
      filename: "1) KONAMPALLE-KM 216.300 to 217.300 & 218.575 to 219.750.dwg",
      available: true,
    },
    {
      id: "padamatiyaleru",
      title: "Padamatiyaleru Canal Project (KM 217.300 - 242.350)",
      village: "Padamatiyaleru",
      filename: "2) PADAMATIYALERU-KM 217.300 to 218.575 & 219.750 to 223.140 & 236.775 to 242.350.dwg",
      available: true,
    },
  ],
  projectData: null,
  selectedPlot: null,
  hoveredPlot: null,
  isLoading: false,
  error: null,

  baseMap: "satellite",
  setBaseMap: (baseMap) => set({ baseMap }),

  apsacOverlay: true,
  apsacOpacity: 0.85,
  setApsacOverlay: (apsacOverlay) => set({ apsacOverlay }),
  setApsacOpacity: (apsacOpacity) => set({ apsacOpacity }),

  layers: DEFAULT_LAYERS,
  toggleLayer: (layerKey) =>
    set((state) => ({
      layers: { ...state.layers, [layerKey]: !state.layers[layerKey] },
    })),
  setLayer: (layerKey, visible) =>
    set((state) => ({
      layers: { ...state.layers, [layerKey]: visible },
    })),

  measurementMode: "none",
  setMeasurementMode: (measurementMode) => {
    set({ measurementMode });
    if (measurementMode === "none") {
      set({ measurePoints: [], measureTotalDist: 0, measureAreaM2: 0 });
    }
  },
  measurePoints: [],
  setMeasurePoints: (pointsOrFn) =>
    set((state) => {
      const nextPoints =
        typeof pointsOrFn === "function" ? pointsOrFn(state.measurePoints) : pointsOrFn;
      const { totalDistance } = accumulateDistances(nextPoints);
      let area = 0;
      if (state.measurementMode === "area" && nextPoints.length >= 3) {
        const ring = nextPoints.map((pt) => [pt.lng, pt.lat]);
        ring.push([nextPoints[0].lng, nextPoints[0].lat]);
        area = calculatePolygonAreaM2(ring);
      }
      return {
        measurePoints: nextPoints,
        measureTotalDist: totalDistance,
        measureAreaM2: area,
      };
    }),
  measureTotalDist: 0,
  setMeasureTotalDist: (measureTotalDist) => set({ measureTotalDist }),
  measureAreaM2: 0,
  setMeasureAreaM2: (measureAreaM2) => set({ measureAreaM2 }),
  undoMeasurePoint: () =>
    set((state) => {
      const nextPoints = state.measurePoints.slice(0, -1);
      const { totalDistance } = accumulateDistances(nextPoints);
      let area = 0;
      if (state.measurementMode === "area" && nextPoints.length >= 3) {
        const ring = nextPoints.map((pt) => [pt.lng, pt.lat]);
        ring.push([nextPoints[0].lng, nextPoints[0].lat]);
        area = calculatePolygonAreaM2(ring);
      }
      return {
        measurePoints: nextPoints,
        measureTotalDist: totalDistance,
        measureAreaM2: area,
      };
    }),
  clearMeasurement: () =>
    set({ measurePoints: [], measureTotalDist: 0, measureAreaM2: 0 }),

  mapTool: "select",
  setMapTool: (mapTool) => {
    set({ mapTool });
    if (mapTool === "select") {
      set({ measurementMode: "none" });
    }
  },

  highlightedIntersection: null,
  setHighlightedIntersection: (highlightedIntersection) =>
    set({ highlightedIntersection }),

  layerOpacity: {
    canal_alignment: 1.0,
    canal_buffer: 0.35,
    survey_plots: 0.3,
    plot_boundaries: 1.0,
    roads: 0.9,
    village_boundary: 1.0,
    chainage_markers: 1.0,
    structures: 1.0,
  },
  setLayerOpacity: (layerKey, opacity) =>
    set((state) => ({
      layerOpacity: { ...state.layerOpacity, [layerKey]: opacity },
    })),
  isolateLayer: (layerKey) =>
    set((state) => {
      const updatedLayers = { ...state.layers };
      (Object.keys(updatedLayers) as (keyof LayerVisibility)[]).forEach((k) => {
        updatedLayers[k] = k === layerKey;
      });
      return { layers: updatedLayers };
    }),

  unitMode: "acres",
  setUnitMode: (unitMode) => set({ unitMode }),

  isLeftPanelCollapsed: false,
  setIsLeftPanelCollapsed: (isLeftPanelCollapsed) => set({ isLeftPanelCollapsed }),
  activeLeftRibbon: "layers",
  setActiveLeftRibbon: (activeLeftRibbon) => set({ activeLeftRibbon }),
  isRightPanelOpen: true,
  setIsRightPanelOpen: (isRightPanelOpen) => set({ isRightPanelOpen }),
  isMobileSheetExpanded: false,
  setIsMobileSheetExpanded: (isMobileSheetExpanded) => set({ isMobileSheetExpanded }),
  layerSearchQuery: "",
  setLayerSearchQuery: (layerSearchQuery) => set({ layerSearchQuery }),

  isTableModalOpen: false,
  setTableModalOpen: (open) => set({ isTableModalOpen: open }),
  isUploadModalOpen: false,
  setUploadModalOpen: (open) => set({ isUploadModalOpen: open, isCreateProjectModalOpen: open }),
  isCreateProjectModalOpen: false,
  setCreateProjectModalOpen: (open) => set({ isCreateProjectModalOpen: open, isUploadModalOpen: open }),
  previewDocument: null,
  setPreviewDocument: (previewDocument) => set({ previewDocument }),
  layerInfoModal: null,
  setLayerInfoModal: (layerInfoModal) => set({ layerInfoModal }),

  activeTab: "summary",
  setActiveTab: (activeTab) => set({ activeTab }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  targetFlyToBounds: null,
  setTargetFlyToBounds: (bounds) => set({ targetFlyToBounds: bounds }),

  setSelectedPlot: (plot) => {
    set({
      selectedPlot: plot,
      isRightPanelOpen: plot ? true : false,
      highlightedIntersection: null,
    });
    if (plot?.bounds) {
      set({ targetFlyToBounds: plot.bounds });
    }
  },
  clearSelection: () => {
    set({
      selectedPlot: null,
      isRightPanelOpen: false,
      highlightedIntersection: null,
    });
  },
  setHoveredPlot: (hoveredPlot) => set({ hoveredPlot }),
  setProjectData: (projectData) => set({ projectData }),

  fetchProjectsList: async () => {
    try {
      const res = await fetch(apiEndpoint("/api/cadastral/projects"));
      if (res.ok) {
        const data = await res.json();
        if (data.projects && Array.isArray(data.projects)) {
          set({ projectsList: data.projects });
          return;
        }
      }
      // Fallback API route
      const sRes = await fetch(apiEndpoint("/api/cadastral/samples"));
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.samples && Array.isArray(sData.samples)) {
          set({ projectsList: sData.samples });
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch cadastral projects list from backend:", e);
    }

    // Static Edge CDN Fallback (ensures projects always render even if Render backend is sleeping or blocked)
    try {
      const staticRes = await fetch("/data/projects.json");
      if (staticRes.ok) {
        const staticData = await staticRes.json();
        if (staticData.projects && Array.isArray(staticData.projects)) {
          set({ projectsList: staticData.projects });
        }
      }
    } catch (staticErr) {
      console.warn("Failed to fetch static projects list:", staticErr);
    }
  },

  loadProject: async (projectId: string) => {
    set({ isLoading: true, error: null, currentProjectId: projectId });
    try {
      let data: CadastralProjectData | null = null;
      try {
        let res = await fetch(apiEndpoint(`/api/cadastral/project/${projectId}`));
        if (!res.ok) {
          res = await fetch(apiEndpoint(`/api/cadastral/sample/${projectId}`));
        }
        if (res.ok) {
          data = await res.json();
        }
      } catch (backendErr) {
        console.warn(`Backend fetch failed for ${projectId}, trying static CDN fallback...`, backendErr);
      }

      // If backend was unreachable or CORS blocked, load from static CDN
      if (!data) {
        try {
          const staticRes = await fetch(`/data/${projectId}.json`);
          if (staticRes.ok) {
            data = await staticRes.json();
          }
        } catch (staticErr) {
          console.warn(`Static CDN fetch failed for ${projectId}:`, staticErr);
        }
      }

      if (!data) {
        throw new Error(`Failed to load project: ${projectId}`);
      }

      set({ projectData: data, isLoading: false, currentProjectId: projectId });

      // Automatically select the first affected plot if available for immediate showcase
      if (data.survey_register && data.survey_register.length > 0) {
        const affected = data.survey_register.find((p) => p.canal_passing);
        const defaultPlot = affected || data.survey_register[0];
        set({ selectedPlot: defaultPlot });
        if (defaultPlot.bounds) {
          set({ targetFlyToBounds: defaultPlot.bounds });
        }
      }
    } catch (err: any) {
      set({ error: err.message || "Failed to load project", isLoading: false });
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      const res = await fetch(apiEndpoint(`/api/cadastral/project/${projectId}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Failed to delete project");
      }
      await get().fetchProjectsList();
      if (get().currentProjectId === projectId) {
        await get().loadProject("padamatiyaleru");
      }
      return true;
    } catch (err: any) {
      console.error("Failed to delete project:", err);
      alert(err.message || "Could not delete project");
      return false;
    }
  },
}));
