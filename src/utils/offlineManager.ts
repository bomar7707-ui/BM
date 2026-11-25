import { useState, useEffect, useCallback } from 'react';
import { Hike, HikeActivity, PlannedRoute, RoutePart } from '../types';

export const OFFLINE_TILE_CACHE_NAME = 'horsky-offline-tiles-v1';
const MANUAL_OFFLINE_STORAGE_KEY = 'horsky_manual_offline_mode_v1';
const OFFLINE_QUEUE_STORAGE_KEY = 'horsky_offline_sync_queue_v1';

// ---------------------------------------------------------------------------
// Connectivity & Manual Offline Mode State
// ---------------------------------------------------------------------------

type OfflineListener = () => void;
const offlineListeners = new Set<OfflineListener>();

function emitOfflineChange() {
  offlineListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  });
}

export function getManualOfflineMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(MANUAL_OFFLINE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setManualOfflineMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MANUAL_OFFLINE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
  emitOfflineChange();
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function isEffectivelyOffline(): boolean {
  return !isBrowserOnline() || getManualOfflineMode();
}

export function subscribeOfflineMode(listener: OfflineListener): () => void {
  offlineListeners.add(listener);
  return () => {
    offlineListeners.delete(listener);
  };
}

export function useOfflineMode() {
  const [isOnline, setIsOnline] = useState<boolean>(() => isBrowserOnline());
  const [isManualOffline, setIsManualOfflineState] = useState<boolean>(() =>
    getManualOfflineMode()
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onManualChange = () => setIsManualOfflineState(getManualOfflineMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === MANUAL_OFFLINE_STORAGE_KEY) {
        setIsManualOfflineState(getManualOfflineMode());
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('storage', onStorage);
    const unsub = subscribeOfflineMode(onManualChange);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('storage', onStorage);
      unsub();
    };
  }, []);

  const setManualOffline = useCallback((enabled: boolean) => {
    setManualOfflineMode(enabled);
  }, []);

  return {
    isOnline,
    isManualOffline,
    isOffline: !isOnline || isManualOffline,
    setManualOffline,
  };
}

// ---------------------------------------------------------------------------
// Durable Offline Sync Queue (for hikes & planned routes edited while offline)
// ---------------------------------------------------------------------------

export interface OfflineHikePayload {
  name: string;
  distance: number;
  date: string;
  dateTo?: string;
  participants?: string;
  note?: string;
  activity?: HikeActivity | '';
  routes: RoutePart[];
}

export interface OfflinePlannedPayload {
  name: string;
  distance: number;
  link?: string;
  note?: string;
  color?: string;
  routes: RoutePart[];
}

export type OfflineSyncOp =
  | {
      opId: string;
      type: 'add_hike';
      localId: string;
      payload: OfflineHikePayload;
      createdAt: number;
    }
  | {
      opId: string;
      type: 'update_hike';
      id: string;
      payload: OfflineHikePayload;
      createdAt: number;
    }
  | {
      opId: string;
      type: 'delete_hike';
      id: string;
      createdAt: number;
    }
  | {
      opId: string;
      type: 'add_planned';
      localId: string;
      payload: OfflinePlannedPayload;
      createdAt: number;
    }
  | {
      opId: string;
      type: 'update_planned';
      id: string;
      payload: OfflinePlannedPayload;
      createdAt: number;
    }
  | {
      opId: string;
      type: 'delete_planned';
      id: string;
      createdAt: number;
    };

const queueListeners = new Set<OfflineListener>();

function emitQueueChange() {
  queueListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore
    }
  });
}

function stripLargeCoordsForQueue(routes: RoutePart[]): RoutePart[] {
  return (routes || []).map((r) => ({
    distance: r.distance,
    link: r.link || r.url || '',
    url: r.url || r.link || '',
    gpxData: r.gpxData || null,
    gpxName: r.gpxName || '',
    gpxUrl: r.gpxUrl || '',
    hasGpx: r.hasGpx,
    visible: r.visible !== false,
    photosUrl: r.photosUrl || r.photos || '',
    photos: r.photos || r.photosUrl || '',
    youtube: r.youtube || r.video || '',
    video: r.video || r.youtube || '',
    // Keep coordinates only when raw gpxData is not already present
    coordinates: r.gpxData ? [] : r.coordinates || [],
  }));
}

export function getPendingOfflineOps(): OfflineSyncOp[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineSyncOp[]) : [];
  } catch {
    return [];
  }
}

function savePendingOfflineOps(ops: OfflineSyncOp[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(ops));
  } catch {
    // If near quota, strip coordinates from queued ops and retry
    try {
      const compact = ops.map((op) => {
        if ('payload' in op && op.payload && Array.isArray(op.payload.routes)) {
          return {
            ...op,
            payload: {
              ...op.payload,
              routes: op.payload.routes.map((r) => ({ ...r, coordinates: [] })),
            },
          };
        }
        return op;
      });
      localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      // Ignore unrecoverable storage quota errors
    }
  }
  emitQueueChange();
}

export function enqueueOfflineOp(
  opInput:
    | { type: 'add_hike'; localId: string; payload: OfflineHikePayload }
    | { type: 'update_hike'; id: string; payload: OfflineHikePayload }
    | { type: 'delete_hike'; id: string }
    | { type: 'add_planned'; localId: string; payload: OfflinePlannedPayload }
    | { type: 'update_planned'; id: string; payload: OfflinePlannedPayload }
    | { type: 'delete_planned'; id: string }
): void {
  const ops = getPendingOfflineOps();
  const now = Date.now();
  const opId = `op_${now}_${Math.random().toString(36).slice(2, 7)}`;

  if (opInput.type === 'add_hike') {
    ops.push({
      opId,
      type: 'add_hike',
      localId: opInput.localId,
      payload: {
        ...opInput.payload,
        routes: stripLargeCoordsForQueue(opInput.payload.routes),
      },
      createdAt: now,
    });
    savePendingOfflineOps(ops);
    return;
  }

  if (opInput.type === 'update_hike') {
    const cleanPayload: OfflineHikePayload = {
      ...opInput.payload,
      routes: stripLargeCoordsForQueue(opInput.payload.routes),
    };
    const pendingAddIdx = ops.findIndex(
      (o) => o.type === 'add_hike' && o.localId === opInput.id
    );
    if (pendingAddIdx >= 0) {
      const existing = ops[pendingAddIdx];
      if (existing.type === 'add_hike') {
        ops[pendingAddIdx] = { ...existing, payload: cleanPayload };
      }
      savePendingOfflineOps(ops);
      return;
    }
    const filtered = ops.filter(
      (o) => !(o.type === 'update_hike' && o.id === opInput.id)
    );
    filtered.push({
      opId,
      type: 'update_hike',
      id: opInput.id,
      payload: cleanPayload,
      createdAt: now,
    });
    savePendingOfflineOps(filtered);
    return;
  }

  if (opInput.type === 'delete_hike') {
    const pendingAddIdx = ops.findIndex(
      (o) => o.type === 'add_hike' && o.localId === opInput.id
    );
    if (pendingAddIdx >= 0) {
      ops.splice(pendingAddIdx, 1);
      savePendingOfflineOps(ops);
      return;
    }
    const filtered = ops.filter(
      (o) => !((o.type === 'update_hike' || o.type === 'delete_hike') && o.id === opInput.id)
    );
    filtered.push({
      opId,
      type: 'delete_hike',
      id: opInput.id,
      createdAt: now,
    });
    savePendingOfflineOps(filtered);
    return;
  }

  if (opInput.type === 'add_planned') {
    ops.push({
      opId,
      type: 'add_planned',
      localId: opInput.localId,
      payload: {
        ...opInput.payload,
        routes: stripLargeCoordsForQueue(opInput.payload.routes),
      },
      createdAt: now,
    });
    savePendingOfflineOps(ops);
    return;
  }

  if (opInput.type === 'update_planned') {
    const cleanPayload: OfflinePlannedPayload = {
      ...opInput.payload,
      routes: stripLargeCoordsForQueue(opInput.payload.routes),
    };
    const pendingAddIdx = ops.findIndex(
      (o) => o.type === 'add_planned' && o.localId === opInput.id
    );
    if (pendingAddIdx >= 0) {
      const existing = ops[pendingAddIdx];
      if (existing.type === 'add_planned') {
        ops[pendingAddIdx] = { ...existing, payload: cleanPayload };
      }
      savePendingOfflineOps(ops);
      return;
    }
    const filtered = ops.filter(
      (o) => !(o.type === 'update_planned' && o.id === opInput.id)
    );
    filtered.push({
      opId,
      type: 'update_planned',
      id: opInput.id,
      payload: cleanPayload,
      createdAt: now,
    });
    savePendingOfflineOps(filtered);
    return;
  }

  if (opInput.type === 'delete_planned') {
    const pendingAddIdx = ops.findIndex(
      (o) => o.type === 'add_planned' && o.localId === opInput.id
    );
    if (pendingAddIdx >= 0) {
      ops.splice(pendingAddIdx, 1);
      savePendingOfflineOps(ops);
      return;
    }
    const filtered = ops.filter(
      (o) =>
        !((o.type === 'update_planned' || o.type === 'delete_planned') && o.id === opInput.id)
    );
    filtered.push({
      opId,
      type: 'delete_planned',
      id: opInput.id,
      createdAt: now,
    });
    savePendingOfflineOps(filtered);
  }
}

export function clearPendingOfflineOps(): void {
  savePendingOfflineOps([]);
}

export function useOfflineSyncQueue() {
  const [pendingOps, setPendingOps] = useState<OfflineSyncOp[]>(() =>
    getPendingOfflineOps()
  );

  useEffect(() => {
    const refresh = () => setPendingOps(getPendingOfflineOps());
    const onStorage = (e: StorageEvent) => {
      if (e.key === OFFLINE_QUEUE_STORAGE_KEY) refresh();
    };
    queueListeners.add(refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      queueListeners.delete(refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    pendingOps,
    pendingCount: pendingOps.length,
  };
}

export interface OfflineSyncHandlers {
  addHike: (payload: OfflineHikePayload) => Promise<string>;
  updateHike: (id: string, payload: OfflineHikePayload) => Promise<void>;
  deleteHike: (id: string) => Promise<void>;
  addPlannedRoute: (payload: OfflinePlannedPayload) => Promise<string>;
  updatePlannedRoute: (id: string, payload: OfflinePlannedPayload) => Promise<void>;
  deletePlannedRoute: (id: string) => Promise<void>;
}

let isSyncRunning = false;

export async function syncPendingOfflineOps(
  handlers: OfflineSyncHandlers
): Promise<{ synced: number; failed: number }> {
  if (isSyncRunning || isEffectivelyOffline()) {
    return { synced: 0, failed: 0 };
  }

  const queue = getPendingOfflineOps();
  if (queue.length === 0) {
    return { synced: 0, failed: 0 };
  }

  isSyncRunning = true;
  let synced = 0;
  let failed = 0;
  const remaining: OfflineSyncOp[] = [];

  try {
    for (const op of queue) {
      if (isEffectivelyOffline()) {
        remaining.push(op);
        continue;
      }
      try {
        switch (op.type) {
          case 'add_hike':
            await handlers.addHike(op.payload);
            break;
          case 'update_hike':
            await handlers.updateHike(op.id, op.payload);
            break;
          case 'delete_hike':
            await handlers.deleteHike(op.id);
            break;
          case 'add_planned':
            await handlers.addPlannedRoute(op.payload);
            break;
          case 'update_planned':
            await handlers.updatePlannedRoute(op.id, op.payload);
            break;
          case 'delete_planned':
            await handlers.deletePlannedRoute(op.id);
            break;
        }
        synced++;
      } catch (err) {
        console.warn('Failed to replay offline op:', op.type, err);
        failed++;
        remaining.push(op);
      }
    }

    savePendingOfflineOps(remaining);
  } finally {
    isSyncRunning = false;
  }

  return { synced, failed };
}

// ---------------------------------------------------------------------------
// Offline Map Tile Cache Storage Manager
// ---------------------------------------------------------------------------

export async function fetchWithOfflineTileCache(
  url: string,
  options?: { offlineOnly?: boolean; signal?: AbortSignal }
): Promise<Response | null> {
  const offlineOnly = options?.offlineOnly ?? isEffectivelyOffline();

  let cache: Cache | null = null;
  if (typeof caches !== 'undefined') {
    try {
      cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        return cached;
      }
    } catch {
      cache = null;
    }
  }

  if (offlineOnly) {
    return null;
  }

  try {
    const res = await fetch(url, { mode: 'cors', signal: options?.signal });
    if (res.ok && cache) {
      try {
        await cache.put(url, res.clone());
      } catch {
        // Ignore quota or opaque response cache errors
      }
    }
    return res;
  } catch {
    return null;
  }
}

export interface OfflineTileCacheStats {
  totalTiles: number;
  vectorTiles: number;
  demTiles: number;
  satelliteTiles: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function getOfflineTileCacheStats(): Promise<OfflineTileCacheStats> {
  let vectorTiles = 0;
  let demTiles = 0;
  let satelliteTiles = 0;
  let totalTiles = 0;

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
      const keys = await cache.keys();
      totalTiles = keys.length;
      for (const req of keys) {
        const u = req.url;
        if (u.includes('openfreemap.org')) vectorTiles++;
        else if (u.includes('elevation-tiles-prod')) demTiles++;
        else if (u.includes('tiles.maps.eox.at')) satelliteTiles++;
      }
    } catch {
      // ignore
    }
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = typeof est.usage === 'number' ? est.usage : null;
      quotaBytes = typeof est.quota === 'number' ? est.quota : null;
    } catch {
      // ignore
    }
  }

  return {
    totalTiles,
    vectorTiles,
    demTiles,
    satelliteTiles,
    usageBytes,
    quotaBytes,
  };
}

export async function clearOfflineTileCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(OFFLINE_TILE_CACHE_NAME);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Offline Map Area Pre-Downloader (Vector + Terrarium DEM + optional Satellite)
// ---------------------------------------------------------------------------

function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 1 << z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const y = Math.max(
    0,
    Math.min(
      n - 1,
      Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
    )
  );
  return { x, y };
}

export function collectCoordsFromHike(hike: Hike): [number, number][] {
  const out: [number, number][] = [];
  const routes = hike.routes || hike.maps || [];
  for (const r of routes) {
    if (Array.isArray(r.coordinates)) {
      for (const pt of r.coordinates) {
        if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          out.push([pt[0], pt[1]]);
        }
      }
    }
  }
  return out;
}

export function collectCoordsFromPlannedRoute(route: PlannedRoute): [number, number][] {
  const out: [number, number][] = [];
  if (Array.isArray(route.coordinates)) {
    for (const pt of route.coordinates) {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        out.push([pt[0], pt[1]]);
      }
    }
  }
  if (out.length === 0 && Array.isArray(route.routes)) {
    for (const r of route.routes) {
      if (Array.isArray(r.coordinates)) {
        for (const pt of r.coordinates) {
          if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
            out.push([pt[0], pt[1]]);
          }
        }
      }
    }
  }
  return out;
}

export function collectCoordsFromAll(
  hikes: Hike[],
  plannedRoutes: PlannedRoute[] = []
): [number, number][] {
  const out: [number, number][] = [];
  for (const h of hikes) {
    const pts = collectCoordsFromHike(h);
    // Sample every Nth point so bounding clusters are fast while covering every route
    const step = Math.max(1, Math.floor(pts.length / 40));
    for (let i = 0; i < pts.length; i += step) {
      out.push(pts[i]);
    }
    if (pts.length > 0) out.push(pts[pts.length - 1]);
  }
  for (const p of plannedRoutes) {
    const pts = collectCoordsFromPlannedRoute(p);
    const step = Math.max(1, Math.floor(pts.length / 40));
    for (let i = 0; i < pts.length; i += step) {
      out.push(pts[i]);
    }
    if (pts.length > 0) out.push(pts[pts.length - 1]);
  }
  return out;
}

export interface OfflineDownloadProgress {
  done: number;
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
}

const MAX_OFFLINE_DOWNLOAD_URLS = 280;

export async function downloadOfflineMapArea(
  coords: [number, number][],
  options: {
    vectorTemplate: string;
    terrariumUrl: (z: number, x: number, y: number) => string;
    satelliteUrl?: (z: number, x: number, y: number) => string;
    includeSatellite?: boolean;
    onProgress?: (progress: OfflineDownloadProgress) => void;
    signal?: AbortSignal;
  }
): Promise<OfflineDownloadProgress> {
  if (typeof caches === 'undefined') {
    throw new Error('Prohlížeč nepodporuje offline mezipaměť (Cache API).');
  }
  if (!coords.length) {
    return { done: 0, total: 0, downloaded: 0, skipped: 0, failed: 0 };
  }

  // Collect unique tiles around every sampled coordinate (avoids downloading huge empty rectangles between distant mountain ranges!)
  const vectorZooms = [9, 10, 11, 12, 13];
  const demZooms = [9, 10, 11, 12];

  // Prioritize overview zooms first, then detail zooms up to MAX_OFFLINE_DOWNLOAD_URLS
  const urlsOrdered: string[] = [];
  const seenUrls = new Set<string>();

  const addUrl = (url: string) => {
    if (seenUrls.has(url) || urlsOrdered.length >= MAX_OFFLINE_DOWNLOAD_URLS) return;
    seenUrls.add(url);
    urlsOrdered.push(url);
  };

  // Sample route points down to max 250 representative vertices
  const stride = Math.max(1, Math.floor(coords.length / 250));
  const sampled: [number, number][] = [];
  for (let i = 0; i < coords.length; i += stride) {
    sampled.push(coords[i]);
  }
  sampled.push(coords[coords.length - 1]);

  for (const z of vectorZooms) {
    const pad = z <= 11 ? 1 : 1;
    const tileSet = new Set<string>();
    const n = 1 << z;
    for (const [lat, lon] of sampled) {
      const { x, y } = latLonToTile(lat, lon, z);
      for (let dx = -pad; dx <= pad; dx++) {
        for (let dy = -pad; dy <= pad; dy++) {
          const tx = Math.max(0, Math.min(n - 1, x + dx));
          const ty = Math.max(0, Math.min(n - 1, y + dy));
          tileSet.add(`${tx}/${ty}`);
        }
      }
    }

    for (const key of tileSet) {
      const [xs, ys] = key.split('/');
      const x = Number(xs);
      const y = Number(ys);
      const vtUrl = options.vectorTemplate
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      addUrl(vtUrl);

      if (demZooms.includes(z)) {
        addUrl(options.terrariumUrl(z, x, y));
      }

      if (options.includeSatellite && options.satelliteUrl && z >= 9 && z <= 12) {
        addUrl(options.satelliteUrl(z, x, y));
      }
    }
  }

  const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
  const total = urlsOrdered.length;
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  options.onProgress?.({ done, total, downloaded, skipped, failed });

  const concurrency = 4;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urlsOrdered.length) {
      if (options.signal?.aborted) break;
      const idx = cursor++;
      const url = urlsOrdered[idx];

      try {
        const existing = await cache.match(url);
        if (existing) {
          skipped++;
        } else {
          const res = await fetch(url, { mode: 'cors', signal: options.signal });
          if (res.ok) {
            await cache.put(url, res.clone());
            downloaded++;
          } else {
            failed++;
          }
        }
      } catch {
        if (options.signal?.aborted) break;
        failed++;
      } finally {
        done++;
        options.onProgress?.({ done, total, downloaded, skipped, failed });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { done, total, downloaded, skipped, failed };
}

export function formatBytesCz(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
