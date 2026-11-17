/**
 * High-Performance Client Interface for Geodesy & Spatial Math Web Worker
 *
 * Provides:
 * - Singleton worker lifecycle management with duplicate prevention
 * - Request-response message correlation with unique IDs
 * - Timeout detection and cancellation of stale requests
 * - Graceful main-thread fallback if Worker API is unavailable (SSR/test runner/restricted browser)
 * - Strongly-typed async API for polygon area, length, distance, validation, and bulk processing
 */

import {
  GeodesyWorkerRequest,
  GeodesyWorkerResponse,
  WorkerPoint,
  calculatePolygonAreaM2Worker,
  calculateFeatureLengthMetersWorker,
  computeGeodesicDistanceWorker,
  validateGeometryWorker,
  checkSpatialIntersectsWorker,
  bulkPreprocessParcelsWorker,
  transformOffsetWorker,
} from "./geodesy.worker";

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
type WorkerAction = DistributiveOmit<GeodesyWorkerRequest, "id">;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: any;
  type: string;
  fallbackFn: () => any;
}

class GeodesyWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private isWorkerSupported: boolean = true;
  private workerInitFailed: boolean = false;
  private defaultTimeoutMs: number = 8000;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      this.isWorkerSupported = false;
      return;
    }

    try {
      // Initialize Next.js Web Worker using standard URL resolution
      this.worker = new Worker(new URL("./geodesy.worker.ts", import.meta.url), {
        type: "module",
      });

      this.worker.onmessage = (event: MessageEvent<GeodesyWorkerResponse>) => {
        const res = event.data;
        if (!res || !res.id) return;

        const req = this.pending.get(res.id);
        if (!req) return; // Stale or already timed out request

        clearTimeout(req.timer);
        this.pending.delete(res.id);

        if (res.success) {
          req.resolve(res.result);
        } else {
          req.reject(new Error(res.error || "Worker computation failure"));
        }
      };

      this.worker.onerror = (err) => {
        // Fall back gracefully to main thread on runtime crash
        console.warn("Geodesy worker encountered error, engaging main-thread fallback:", err);
        this.workerInitFailed = true;
        this.isWorkerSupported = false;
        this.flushPendingWithFallback();
      };
    } catch (e) {
      console.warn("Could not instantiate geodesy Web Worker, using main-thread fallback:", e);
      this.isWorkerSupported = false;
      this.workerInitFailed = true;
    }
  }

  private flushPendingWithFallback(): void {
    // If worker crashes, resolve remaining requests on main thread with fallback function
    this.pending.forEach((req, id) => {
      clearTimeout(req.timer);
      this.pending.delete(id);
      try {
        req.resolve(req.fallbackFn());
      } catch (err) {
        req.reject(err);
      }
    });
  }

  /**
   * For testing & reliability: simulate worker crash / CSP error
   */
  public triggerFallbackMode(): void {
    this.workerInitFailed = true;
    this.isWorkerSupported = false;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {}
      this.worker = null;
    }
    this.flushPendingWithFallback();
  }

  private nextId(): string {
    return `geo_${Date.now()}_${++this.reqCounter}`;
  }

  private execute<T>(
    req: WorkerAction,
    fallbackFn: () => T,
    timeoutMs: number = this.defaultTimeoutMs
  ): Promise<T> {
    // If worker is unsupported or failed, execute synchronously via promise on main thread
    if (!this.isWorkerSupported || this.workerInitFailed || !this.worker) {
      try {
        return Promise.resolve(fallbackFn());
      } catch (err) {
        return Promise.reject(err);
      }
    }

    const id = this.nextId();
    const fullRequest = { ...req, id } as GeodesyWorkerRequest;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // On timeout, execute fallback on main thread to guarantee no dropped calculations
        try {
          resolve(fallbackFn());
        } catch (err) {
          reject(new Error(`Worker request ${id} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, type: req.type, fallbackFn });

      try {
        this.worker!.postMessage(fullRequest);
      } catch (postErr) {
        clearTimeout(timer);
        this.pending.delete(id);
        // Post failure (e.g. cloning error), execute fallback
        try {
          resolve(fallbackFn());
        } catch (err) {
          reject(err);
        }
      }
    });
  }

  /**
   * Computes polygon area in square meters and acres asynchronously in Web Worker.
   */
  public async calculateArea(ring: number[][]): Promise<{ areaM2: number; acres: number }> {
    return this.execute(
      { type: "CALCULATE_AREA", ring },
      () => {
        const areaM2 = calculatePolygonAreaM2Worker(ring);
        const acres = Math.round((areaM2 / 4046.8564224) * 100) / 100;
        return { areaM2, acres };
      }
    );
  }

  /**
   * Computes polyline length in meters asynchronously in Web Worker.
   */
  public async calculateLength(coords: number[][]): Promise<{ lengthMeters: number; formatted: string }> {
    return this.execute(
      { type: "CALCULATE_LENGTH", coords },
      () => {
        const lengthMeters = calculateFeatureLengthMetersWorker(coords);
        const formatted =
          lengthMeters >= 1000
            ? `${(lengthMeters / 1000).toFixed(2)} km (${Math.round(lengthMeters).toLocaleString()} m)`
            : `${lengthMeters.toFixed(1)} m`;
        return { lengthMeters, formatted };
      }
    );
  }

  /**
   * Accumulates geodesic distances for measurement path in Web Worker.
   */
  public async accumulateDistances(
    points: WorkerPoint[]
  ): Promise<{ totalDistance: number; segmentDistances: number[] }> {
    return this.execute(
      { type: "ACCUMULATE_DISTANCES", points },
      () => {
        const segmentDistances: number[] = [];
        let totalDistance = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const seg = computeGeodesicDistanceWorker(
            points[i].lat,
            points[i].lng,
            points[i + 1].lat,
            points[i + 1].lng
          );
          segmentDistances.push(seg);
          totalDistance += seg;
        }
        return { totalDistance, segmentDistances };
      }
    );
  }

  /**
   * Validates topological geometry in Web Worker.
   */
  public async validateGeometry(
    coords: number[][],
    geometryType: "Polygon" | "LineString" | "Point"
  ): Promise<{ isValid: boolean; vertexCount: number; isClosed: boolean; errors: string[] }> {
    return this.execute(
      { type: "VALIDATE_GEOMETRY", coords, geometryType },
      () => validateGeometryWorker(coords, geometryType)
    );
  }

  /**
   * Checks spatial intersection of two polygon rings in Web Worker.
   */
  public async checkSpatialIntersects(ringA: number[][], ringB: number[][]): Promise<boolean> {
    return this.execute(
      { type: "SPATIAL_INTERSECTS", ringA, ringB },
      () => checkSpatialIntersectsWorker(ringA, ringB)
    );
  }

  /**
   * Preprocesses bulk parcels (acreages, centroids, and bounds) in Web Worker.
   */
  public async bulkPreprocessParcels(
    parcels: Array<{ survey_no: string; ring: number[][] }>
  ): Promise<
    Array<{
      survey_no: string;
      areaM2: number;
      acres: number;
      center: [number, number];
      bounds: [[number, number], [number, number]];
    }>
  > {
    return this.execute(
      { type: "BULK_PREPROCESS_PARCELS", parcels },
      () => bulkPreprocessParcelsWorker(parcels)
    );
  }

  /**
   * Shifts coordinate pairs with calibration offset dx/dy in Web Worker.
   */
  public async transformOffset(coords: number[][], dx: number, dy: number): Promise<number[][]> {
    return this.execute(
      { type: "TRANSFORM_OFFSET", coords, dx, dy },
      () => transformOffsetWorker(coords, dx, dy)
    );
  }

  /**
   * Terminate active worker instance during cleanup.
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.flushPendingWithFallback();
  }
}

// Global singleton client ensures single Web Worker instantiation across entire GIS app
let clientInstance: GeodesyWorkerClient | null = null;

export function getGeodesyWorker(): GeodesyWorkerClient {
  if (!clientInstance) {
    clientInstance = new GeodesyWorkerClient();
  }
  return clientInstance;
}
