/**
 * Cadastral GIS IndexedDB Offline-First High-Performance Caching Layer
 * Provides instant zero-latency project retrieval, background revalidation,
 * quota exhaustion auto-eviction (LRU), and in-flight request de-duplication.
 */

import { CadastralProjectData, CadastralProjectMeta } from "@/stores/useCadastralStore";

const DB_NAME = "cad2kml_cadastral_db";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_CUSTOM = "custom_projects";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours fresh TTL

export interface CachedProjectRecord {
  id: string;
  data: CadastralProjectData;
  timestamp: number;
  etag?: string;
  version?: string;
}

export interface CachedCustomProjectRecord {
  id: string;
  meta: CadastralProjectMeta;
  data: CadastralProjectData;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, CachedProjectRecord>();
const inFlightRequests = new Map<string, Promise<CadastralProjectData | null>>();

export function openDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB not available in this environment"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          const store = db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CUSTOM)) {
          const cStore = db.createObjectStore(STORE_CUSTOM, { keyPath: "id" });
          cStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });

  return dbPromise;
}

/**
 * Retrieves a cached project from IndexedDB.
 * Returns null if not cached or if cache entry is corrupt.
 */
export async function getCachedProject(projectId: string): Promise<CachedProjectRecord | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return memoryFallback.get(projectId) || null;
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get(projectId);

      req.onsuccess = () => {
        const record = req.result as CachedProjectRecord | undefined;
        if (record && record.data && record.data.survey_register) {
          resolve(record);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return memoryFallback.get(projectId) || null;
  }
}

/**
 * Stores a project in IndexedDB.
 * Automatically handles quota exhaustion by evicting older entries.
 */
export async function setCachedProject(
  projectId: string,
  data: CadastralProjectData,
  etag?: string
): Promise<void> {
  const record: CachedProjectRecord = {
    id: projectId,
    data,
    timestamp: Date.now(),
    etag,
  };

  if (typeof window === "undefined" || !window.indexedDB) {
    memoryFallback.set(projectId, record);
    return;
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      const putReq = store.put(record);

      putReq.onsuccess = () => resolve();
      putReq.onerror = (e) => {
        const err = putReq.error;
        if (err && err.name === "QuotaExceededError") {
          // Evict oldest entries
          evictOldestCacheEntries(db)
            .then(() => {
              const retryTx = db.transaction(STORE_PROJECTS, "readwrite");
              retryTx.objectStore(STORE_PROJECTS).put(record);
              resolve();
            })
            .catch(reject);
        } else {
          reject(err || e);
        }
      };
    });
  } catch (err) {
    console.warn("IndexedDB set failed, using in-memory fallback:", err);
    memoryFallback.set(projectId, record);
  }
}

/**
 * Evict oldest entries when storage quota is reached.
 */
async function evictOldestCacheEntries(db: IDBDatabase, targetRemoveCount = 2): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      const index = store.index("timestamp");
      const req = index.openCursor(null, "next"); // oldest first
      let removed = 0;

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && removed < targetRemoveCount) {
          cursor.delete();
          removed++;
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Loads project with offline-first strategy:
 * 1. Deduplicates concurrent requests for the same project.
 * 2. Returns cached data immediately if available.
 * 3. Triggers background revalidation if online and cached data is older than TTL.
 */
export async function loadProjectOfflineFirst(
  projectId: string,
  fetchFn: () => Promise<CadastralProjectData>
): Promise<{ data: CadastralProjectData; fromCache: boolean; isStale: boolean }> {
  // If an in-flight request is already loading this project, reuse it!
  const inFlight = inFlightRequests.get(projectId);
  if (inFlight) {
    const data = await inFlight;
    if (data) return { data, fromCache: false, isStale: false };
  }

  // 1. Check IndexedDB cache
  const cached = await getCachedProject(projectId);
  if (cached && cached.data) {
    const isStale = Date.now() - cached.timestamp > CACHE_TTL_MS;

    // Background revalidation
    if (isStale && typeof navigator !== "undefined" && navigator.onLine) {
      setTimeout(() => {
        fetchFn()
          .then((fresh) => {
            if (fresh && fresh.survey_register) {
              setCachedProject(projectId, fresh).catch(() => {});
            }
          })
          .catch(() => {});
      }, 500);
    }

    return { data: cached.data, fromCache: true, isStale };
  }

  // 2. Fetch fresh data
  const fetchPromise = (async () => {
    try {
      const freshData = await fetchFn();
      if (freshData && freshData.survey_register) {
        await setCachedProject(projectId, freshData);
      }
      return freshData;
    } finally {
      inFlightRequests.delete(projectId);
    }
  })();

  inFlightRequests.set(projectId, fetchPromise);
  const data = await fetchPromise;
  return { data, fromCache: false, isStale: false };
}

/**
 * Custom Projects (User-uploaded drawings) persistence in IndexedDB.
 * Completely replaces localStorage which fails on 5MB quota!
 */
export async function saveCustomProjectToIDB(
  meta: CadastralProjectMeta,
  data: CadastralProjectData
): Promise<void> {
  if (typeof window === "undefined") return;

  const record: CachedCustomProjectRecord = {
    id: meta.id,
    meta,
    data,
    updatedAt: Date.now(),
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CUSTOM, "readwrite");
      const store = tx.objectStore(STORE_CUSTOM);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to save custom project in IndexedDB:", err);
  }
}

export async function getCustomProjectFromIDB(projectId: string): Promise<CadastralProjectData | null> {
  if (typeof window === "undefined") return null;

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CUSTOM, "readonly");
      const store = tx.objectStore(STORE_CUSTOM);
      const req = store.get(projectId);
      req.onsuccess = () => {
        const rec = req.result as CachedCustomProjectRecord | undefined;
        resolve(rec ? rec.data : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getAllCustomProjectsFromIDB(): Promise<CadastralProjectMeta[]> {
  if (typeof window === "undefined") return [];

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CUSTOM, "readonly");
      const store = tx.objectStore(STORE_CUSTOM);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result || []) as CachedCustomProjectRecord[];
        resolve(records.map((r) => r.meta));
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deleteCustomProjectFromIDB(projectId: string): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_CUSTOM], "readwrite");
      tx.objectStore(STORE_PROJECTS).delete(projectId);
      tx.objectStore(STORE_CUSTOM).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn("Failed to delete custom project from IDB:", err);
  }
}

/**
 * Generates stable unique key for cadastral parcel feature,
 * correctly differentiating multipart parcels that share the same survey number.
 */
export function getParcelFeatureKey(f: any): string {
  if (!f) return "";
  if (typeof f === "string") return f;
  const props = f.properties || (typeof f.getProperties === "function" ? f.getProperties() : {}) || {};
  const sNo = props.survey_no ?? f.id ?? "";
  const area = props.total_area_m2 ?? props.total_acres ?? "";
  const center = props.center ? `${props.center[0]}_${props.center[1]}` : "";
  return area ? `${sNo}_${area}${center ? `_${center}` : ""}` : String(sNo);
}

/**
 * Cache incrementally loaded viewport parcels into IndexedDB
 */
export async function cacheViewportParcels(
  projectId: string,
  parcels: any[]
): Promise<void> {
  if (typeof window === "undefined" || !parcels.length) return;

  const key = `${projectId}_viewport_parcels`;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_PROJECTS, "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result?.parcels || [];
        const seen = new Set(existing.map((p: any) => getParcelFeatureKey(p)));
        const merged = [...existing];
        for (const p of parcels) {
          const pKey = getParcelFeatureKey(p);
          if (!seen.has(pKey)) {
            seen.add(pKey);
            merged.push(p);
          }
        }
        store.put({ id: key, parcels: merged, timestamp: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn("Failed to cache viewport parcels to IDB:", err);
  }
}

/**
 * Retrieve cached viewport parcels from IndexedDB
 */
export async function getCachedViewportParcels(projectId: string): Promise<any[]> {
  if (typeof window === "undefined") return [];

  const key = `${projectId}_viewport_parcels`;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PROJECTS, "readonly");
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result?.parcels || []);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
