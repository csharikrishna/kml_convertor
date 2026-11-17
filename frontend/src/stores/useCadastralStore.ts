import { accumulateDistances, calculatePolygonAreaM2 } from "@/lib/gis/geodesy";
import { getGeodesyWorker } from "@/lib/gis/geodesyWorkerClient";
import { CadastralSearchIndex } from "@/lib/gis/searchIndex";
import {
  loadProjectOfflineFirst,
  saveCustomProjectToIDB,
  getCustomProjectFromIDB,
  getAllCustomProjectsFromIDB,
  deleteCustomProjectFromIDB,
} from "@/lib/cache/cadastralCache";
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
  searchIndex: CadastralSearchIndex | null;
  isCached: boolean;

  // Actions
  fetchProjectsList: () => Promise<void>;
  loadProject: (projectId: string, targetSurveyNo?: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  setSelectedPlot: (plot: SurveyPlotRecord | null, options?: { replace?: boolean } | any) => void;
  clearSelection: (options?: { replace?: boolean } | any) => void;
  setHoveredPlot: (plot: SurveyPlotRecord | null) => void;
  setProjectData: (data: CadastralProjectData) => void;
}

const STORAGE_KEY_CUSTOM_PROJECTS = "cad2kml_custom_projects_catalog";
const STORAGE_PREFIX_PROJECT_DATA = "cad2kml_project_data_";

export function getLocalCustomProjects(): CadastralProjectMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_PROJECTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Rigorous Cadastral Parcel Locator
 * Resolves discrete survey numbers, sub-divisions, prefix-stripped queries, and road identifiers.
 * Guarantees zero false positives (e.g. searching for "160" will NEVER match "6", "16", etc.).
 */
export function findCadastralPlot(
  plots: SurveyPlotRecord[] | undefined,
  query: string | null | undefined
): SurveyPlotRecord | null {
  if (!query || !plots || plots.length === 0) return null;

  const rawClean = String(query).trim();
  if (!rawClean) return null;
  const lower = rawClean.toLowerCase();

  // Strip common user prefixes: "Survey No. 235", "Sy 160", "Plot 14" -> "235", "160", "14"
  const stripped = lower
    .replace(/^(survey\s*no\.?|survey\s*number|survey|sy\.?\s*no\.?|sy\.?|s\.?\s*no\.?|plot\s*no\.?|plot)\s*/i, "")
    .trim();

  // 1. Exact survey_no match (raw query or stripped)
  const exactMatch = plots.find((p) => {
    const pNo = (p.survey_no || "").trim().toLowerCase();
    return pNo === stripped || pNo === lower;
  });
  if (exactMatch) return exactMatch;

  // 2. Explicit Road / Cart Track search (e.g. "R-160", "Cart Track / Road (R-160)")
  const isRoadQuery =
    stripped.startsWith("r-") ||
    stripped.includes("cart") ||
    stripped.includes("track") ||
    stripped.includes("road") ||
    stripped.includes("donka") ||
    stripped.includes("vagu");

  if (isRoadQuery) {
    const roadMatch = plots.find((p) => {
      const pNo = (p.survey_no || "").trim().toLowerCase();
      return (
        pNo === stripped ||
        pNo.includes(stripped) ||
        (stripped.startsWith("r-") && pNo.includes(`(${stripped})`))
      );
    });
    if (roadMatch) return roadMatch;
  }

  // 3. Exact numeric match for parcel survey numbers (ignoring punctuation)
  const queryDigits = stripped.replace(/\D+/g, "");
  if (queryDigits && !isRoadQuery) {
    // 3a. Exact digits where parcel has no sub-division slashes or hyphens
    const pureNumericMatch = plots.find((p) => {
      const pNo = (p.survey_no || "").trim().toLowerCase();
      const pDigits = pNo.replace(/\D+/g, "");
      return (
        pDigits === queryDigits &&
        !pNo.includes("/") &&
        !pNo.includes("-") &&
        !pNo.includes("cart") &&
        !pNo.includes("road")
      );
    });
    if (pureNumericMatch) return pureNumericMatch;

    // 3b. Exact digits match on parcel
    const numericMatch = plots.find((p) => {
      const pNo = (p.survey_no || "").trim().toLowerCase();
      const pDigits = pNo.replace(/\D+/g, "");
      return pDigits === queryDigits && !pNo.includes("cart") && !pNo.includes("road");
    });
    if (numericMatch) return numericMatch;
  }

  // 4. Sub-division start match (e.g. query "155" matches "155/1" or "155-A")
  if (stripped && !isRoadQuery) {
    const subMatch = plots.find((p) => {
      const pNo = (p.survey_no || "").trim().toLowerCase();
      return pNo.startsWith(stripped + "/") || pNo.startsWith(stripped + "-");
    });
    if (subMatch) return subMatch;
  }

  return null;
}

export async function saveLocalCustomProject(meta: CadastralProjectMeta, data: CadastralProjectData) {
  if (typeof window === "undefined") return;
  try {
    const existing = getLocalCustomProjects().filter((p) => p.id !== meta.id);
    localStorage.setItem(STORAGE_KEY_CUSTOM_PROJECTS, JSON.stringify([meta, ...existing]));
    // Save heavy dataset to IndexedDB (bypasses 5MB localStorage limits)
    await saveCustomProjectToIDB(meta, data);
  } catch (e) {
    console.warn("Failed to persist custom project:", e);
  }
}

export async function getLocalProjectData(projectId: string): Promise<CadastralProjectData | null> {
  if (typeof window === "undefined") return null;
  try {
    const idbData = await getCustomProjectFromIDB(projectId);
    if (idbData) return idbData;
    const raw = localStorage.getItem(`${STORAGE_PREFIX_PROJECT_DATA}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function deleteLocalProject(projectId: string) {
  if (typeof window === "undefined") return;
  try {
    const remaining = getLocalCustomProjects().filter((p) => p.id !== projectId);
    localStorage.setItem(STORAGE_KEY_CUSTOM_PROJECTS, JSON.stringify(remaining));
    localStorage.removeItem(`${STORAGE_PREFIX_PROJECT_DATA}${projectId}`);
    await deleteCustomProjectFromIDB(projectId);
  } catch (e) {
    console.warn("Failed to delete local project:", e);
  }
}

const apiEndpoint = (path: string) => {
  // Always use same-origin relative path in browser so requests route cleanly through Next.js rewrite proxy.
  // This completely eliminates cross-origin browser CORS blocks between Vercel and Render.
  return path;
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
  searchIndex: null,
  isCached: false,
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

      // Offload to Web Worker for asynchronous geodesic accuracy verification
      if (typeof window !== "undefined") {
        getGeodesyWorker()
          .accumulateDistances(nextPoints)
          .then(({ totalDistance: wDist }) => {
            if (Math.abs(wDist - totalDistance) > 0.01) {
              set({ measureTotalDist: wDist });
            }
          })
          .catch(() => {});

        if (state.measurementMode === "area" && nextPoints.length >= 3) {
          const ring = nextPoints.map((pt) => [pt.lng, pt.lat]);
          ring.push([nextPoints[0].lng, nextPoints[0].lat]);
          getGeodesyWorker()
            .calculateArea(ring)
            .then(({ areaM2: wArea }) => {
              if (Math.abs(wArea - area) > 0.1) {
                set({ measureAreaM2: wArea });
              }
            })
            .catch(() => {});
        }
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

      if (typeof window !== "undefined") {
        getGeodesyWorker()
          .accumulateDistances(nextPoints)
          .then(({ totalDistance: wDist }) => {
            if (Math.abs(wDist - totalDistance) > 0.01) {
              set({ measureTotalDist: wDist });
            }
          })
          .catch(() => {});

        if (state.measurementMode === "area" && nextPoints.length >= 3) {
          const ring = nextPoints.map((pt) => [pt.lng, pt.lat]);
          ring.push([nextPoints[0].lng, nextPoints[0].lat]);
          getGeodesyWorker()
            .calculateArea(ring)
            .then(({ areaM2: wArea }) => {
              if (Math.abs(wArea - area) > 0.1) {
                set({ measureAreaM2: wArea });
              }
            })
            .catch(() => {});
        }
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

  setSelectedPlot: (plot, options) => {
    set({
      selectedPlot: plot,
      isRightPanelOpen: plot ? true : false,
      highlightedIntersection: null,
    });
    if (plot?.bounds) {
      set({ targetFlyToBounds: plot.bounds });
    }
    // Synchronize browser URL (?sy=...) so deep-linking, sharing, and browser back/forward work seamlessly
    if (typeof window !== "undefined") {
      try {
        const newUrl = new URL(window.location.href);
        const oldSy = newUrl.searchParams.get("sy");
        const nextSy = plot?.survey_no ? String(plot.survey_no) : null;
        if (nextSy) {
          newUrl.searchParams.set("sy", nextSy);
        } else {
          newUrl.searchParams.delete("sy");
        }
        if (oldSy !== nextSy) {
          const isReplace = Boolean(options && typeof options === "object" && "replace" in options && options.replace);
          if (isReplace) {
            window.history.replaceState(null, "", newUrl.toString());
          } else {
            window.history.pushState(null, "", newUrl.toString());
          }
        }
      } catch {}
    }
  },
  clearSelection: (options) => {
    set({
      selectedPlot: null,
      isRightPanelOpen: false,
      highlightedIntersection: null,
    });
    // Remove ?sy= parameter on deselection
    if (typeof window !== "undefined") {
      try {
        const newUrl = new URL(window.location.href);
        if (newUrl.searchParams.has("sy")) {
          newUrl.searchParams.delete("sy");
          const isReplace = Boolean(options && typeof options === "object" && "replace" in options && options.replace);
          if (isReplace) {
            window.history.replaceState(null, "", newUrl.toString());
          } else {
            window.history.pushState(null, "", newUrl.toString());
          }
        }
      } catch {}
    }
  },
  setHoveredPlot: (hoveredPlot) => set({ hoveredPlot }),
  setProjectData: (projectData) => {
    const searchIndex = new CadastralSearchIndex(projectData);
    set({ projectData, searchIndex });
  },

  fetchProjectsList: async () => {
    let baseProjects: CadastralProjectMeta[] = [];
    try {
      const res = await fetch(apiEndpoint("/api/cadastral/projects"));
      if (res.ok) {
        const data = await res.json();
        if (data.projects && Array.isArray(data.projects)) {
          baseProjects = data.projects;
        }
      }
      if (baseProjects.length === 0) {
        const sRes = await fetch(apiEndpoint("/api/cadastral/samples"));
        if (sRes.ok) {
          const sData = await sRes.json();
          if (sData.samples && Array.isArray(sData.samples)) {
            baseProjects = sData.samples;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to fetch cadastral projects list from backend:", e);
    }

    // Static Edge CDN Fallback if backend returned empty/offline
    if (baseProjects.length === 0) {
      try {
        const staticRes = await fetch("/data/projects.json");
        if (staticRes.ok) {
          const staticData = await staticRes.json();
          if (staticData.projects && Array.isArray(staticData.projects)) {
            baseProjects = staticData.projects;
          }
        }
      } catch (staticErr) {
        console.warn("Failed to fetch static projects list:", staticErr);
      }
    }

    // Merge with any persistent user-created projects in localStorage (ensures zero data loss on backend sleep)
    const localProjects = getLocalCustomProjects();
    const merged = [...baseProjects];
    for (const lp of localProjects) {
      if (!merged.some((p) => p.id === lp.id)) {
        merged.push(lp);
      }
    }
    set({ projectsList: merged });
  },

  loadProject: async (projectId: string, targetSurveyNo?: string) => {
    set({ isLoading: true, error: null, currentProjectId: projectId });
    try {
      const fetchFn = async (): Promise<CadastralProjectData> => {
        let data: CadastralProjectData | null = null;
        try {
          let res = await fetch(apiEndpoint(`/api/cadastral/project/${projectId}`));
          if (!res.ok) {
            res = await fetch(apiEndpoint(`/api/cadastral/sample/${projectId}`));
          }
          if (res.ok) {
            data = await res.json();
          }
        } catch {}

        if (!data) {
          const staticRes = await fetch(`/data/${projectId}.json`);
          if (staticRes.ok) {
            data = await staticRes.json();
          }
        }

        if (!data) {
          data = await getLocalProjectData(projectId);
        }

        if (!data) {
          throw new Error(`Failed to load project: ${projectId}`);
        }
        return data;
      };

      const { data, fromCache } = await loadProjectOfflineFirst(projectId, fetchFn);
      const searchIndex = new CadastralSearchIndex(data);

      // Initial plot resolution: explicit target > ?sy= in URL > first canal affected parcel > first parcel
      let initialPlot: SurveyPlotRecord | null = null;
      let urlSy: string | null = null;
      if (typeof window !== "undefined") {
        try {
          const urlParams = new URL(window.location.href).searchParams;
          urlSy = urlParams.get("sy");
        } catch {}
      }

      const lookupQuery = targetSurveyNo || urlSy;
      if (lookupQuery) {
        initialPlot = searchIndex.findExactPlot(lookupQuery);
      }

      // Fallback: automatically select first affected parcel for immediate showcase
      if (!initialPlot && data.survey_register && data.survey_register.length > 0) {
        const affected = data.survey_register.find((p) => p.canal_passing);
        initialPlot = affected || data.survey_register[0];
      }

      // Synchronize URL: ?project=...&sy=...
      if (typeof window !== "undefined") {
        try {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set("project", projectId);
          if (initialPlot?.survey_no) {
            newUrl.searchParams.set("sy", String(initialPlot.survey_no));
          } else {
            newUrl.searchParams.delete("sy");
          }
          window.history.replaceState(null, "", newUrl.toString());
        } catch {}
      }

      set({
        projectData: data,
        searchIndex,
        isCached: fromCache,
        isLoading: false,
        currentProjectId: projectId,
        selectedPlot: initialPlot,
        isRightPanelOpen: Boolean(initialPlot),
      });

      if (initialPlot?.bounds) {
        set({ targetFlyToBounds: initialPlot.bounds });
      }
    } catch (err: any) {
      set({ error: err.message || "Failed to load project", isLoading: false });
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      deleteLocalProject(projectId);
      await fetch(apiEndpoint(`/api/cadastral/project/${projectId}`), {
        method: "DELETE",
      }).catch(() => {});
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
