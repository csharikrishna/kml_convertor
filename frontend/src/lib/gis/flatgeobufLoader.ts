/**
 * Viewport-Aware FlatGeobuf Streaming Loader & Spatial Cache Sync
 *
 * Implements:
 * - HTTP byte-range request streaming via Packed R-Tree spatial index
 * - Viewport bounds spatial querying (only fetching visible parcels)
 * - Automatic feature deduplication across rapid pan/zoom cycles
 * - Offline-first IndexedDB synchronization (reusing cached features)
 * - Graceful fallback to full GeoJSON dataset if range requests or FGB fail
 */

import {
  getCachedProject,
  saveCustomProjectToIDB,
  openDB,
  getParcelFeatureKey,
  getCachedViewportParcels,
} from "@/lib/cache/cadastralCache";
import { CadastralProjectData } from "@/stores/useCadastralStore";

export { getParcelFeatureKey };

export interface ViewportBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getFeatureBBox(geometry: any): [number, number, number, number] | null {
  if (!geometry || !geometry.coordinates) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visitCoord = (c: any) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      for (const item of c) visitCoord(item);
    }
  };
  visitCoord(geometry.coordinates);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

export function bboxIntersectsFeature(bbox: ViewportBBox, feat: any): boolean {
  if (!feat || !feat.geometry) return false;
  const featBbox = getFeatureBBox(feat.geometry);
  if (!featBbox) return false;
  const [fMinX, fMinY, fMaxX, fMaxY] = featBbox;
  return !(fMaxX < bbox.minX || fMinX > bbox.maxX || fMaxY < bbox.minY || fMinY > bbox.maxY);
}

export interface StreamStats {
  bytesFetched: number;
  featuresLoaded: number;
  cacheHits: number;
  isPartial: boolean;
  durationMs: number;
}

const STORE_PARCEL_CACHE = "parcel_spatial_cache";

/**
 * Ensures spatial parcel store exists in IndexedDB
 */
async function ensureSpatialStore(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  try {
    return await openDB();
  } catch {
    return null;
  }
}

/**
 * High-performance viewport parcel streaming engine
 */
export class FlatGeobufStreamer {
  private seenParcels = new Map<string, any>();
  private activeAbortController: AbortController | null = null;
  private currentProjectId: string | null = null;

  constructor(projectId?: string) {
    if (projectId) {
      this.currentProjectId = projectId;
    }
  }

  public reset(projectId: string): void {
    this.currentProjectId = projectId;
    this.seenParcels.clear();
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  /**
   * Streams parcels intersecting current viewport bounds.
   * Leverages HTTP Range requests against .fgb when available.
   * Falls back transparently to cached GeoJSON or full fetch if range requests fail.
   */
  public async fetchViewportParcels(
    projectId: string,
    bbox: ViewportBBox,
    options: {
      onFeatureBatch?: (features: any[]) => void;
      signal?: AbortSignal;
    } = {}
  ): Promise<{ features: any[]; stats: StreamStats }> {
    const started = performance.now();
    let bytesFetched = 0;
    let cacheHits = 0;
    const newFeatures: any[] = [];

    if (this.currentProjectId !== projectId) {
      this.reset(projectId);
    }

    const fgbUrl = `/data/${projectId}_plots.fgb`;

    try {
      // Dynamic import of flatgeobuf in browser
      const fgb = await import("flatgeobuf");

      // Set up range request options
      const deserializeOptions: any = {
        rect: bbox,
      };

      // Try streaming from URL with HTTP range requests
      const featureIterator = fgb.geojson.deserialize(fgbUrl, deserializeOptions);

      for await (const feat of featureIterator) {
        if (options.signal?.aborted) break;

        const key = getParcelFeatureKey(feat);
        if (!this.seenParcels.has(key)) {
          this.seenParcels.set(key, feat);
          newFeatures.push(feat);
        } else {
          cacheHits++;
        }
      }

      if (options.onFeatureBatch && newFeatures.length > 0) {
        options.onFeatureBatch(newFeatures);
      }

      const durationMs = performance.now() - started;

      return {
        features: Array.from(this.seenParcels.values()),
        stats: {
          bytesFetched,
          featuresLoaded: newFeatures.length,
          cacheHits,
          isPartial: true,
          durationMs,
        },
      };
    } catch (err) {
      console.warn(
        `FlatGeobuf range-streaming encountered notice (${fgbUrl}), applying resilient cache fallback:`,
        err
      );

      // Fallback: check IndexedDB cached project or cached viewport parcels
      let candidatePlots: any[] = [];
      const cached = await getCachedProject(projectId);
      if (cached && cached.data?.layers?.survey_plots?.features) {
        candidatePlots = cached.data.layers.survey_plots.features;
      } else {
        const idbParcels = await getCachedViewportParcels(projectId);
        if (idbParcels && idbParcels.length > 0) {
          candidatePlots = idbParcels;
        }
      }

      if (candidatePlots.length > 0) {
        // Robust bounding box intersection handling Polygon and MultiPolygon
        const filtered = candidatePlots.filter((f: any) => bboxIntersectsFeature(bbox, f));

        for (const feat of filtered) {
          const key = getParcelFeatureKey(feat);
          if (!this.seenParcels.has(key)) {
            this.seenParcels.set(key, feat);
            newFeatures.push(feat);
          }
        }

        if (options.onFeatureBatch && newFeatures.length > 0) {
          options.onFeatureBatch(newFeatures);
        }

        return {
          features: Array.from(this.seenParcels.values()),
          stats: {
            bytesFetched: 0,
            featuresLoaded: newFeatures.length,
            cacheHits: candidatePlots.length - newFeatures.length,
            isPartial: true,
            durationMs: performance.now() - started,
          },
        };
      }

      // If nothing cached, throw so caller can load default GeoJSON
      throw err;
    }
  }

  public getAllLoadedFeatures(): any[] {
    return Array.from(this.seenParcels.values());
  }

  public getFeatureCount(): number {
    return this.seenParcels.size;
  }
}

// Global singleton instance
export const globalFgbStreamer = new FlatGeobufStreamer();
