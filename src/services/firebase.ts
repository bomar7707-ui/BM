import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';
import { Hike, RoutePart, PlannedRoute, ParticipantProfile } from '../types';
import { resolveGpxVal, calculateCoordsDistanceKm } from '../utils/gpxParser';

const firebaseConfig = {
  apiKey: "AIzaSyDg0j8KCyc-QlSjI80b-CsyLA1pecMlLVE",
  authDomain: "moje-hory.firebaseapp.com",
  projectId: "moje-hory",
  storageBucket: "moje-hory.firebasestorage.app",
  messagingSenderId: "307649543821",
  appId: "1:307649543821:web:115122f080533b4c17acc4",
};

let db: Firestore | null = null;
let auth: ReturnType<typeof getAuth> | null = null;

try {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("Firebase initialization warning:", e);
}

export { db, auth };

let pendingAuthPromise: Promise<void> | null = null;

export async function ensureAuth(): Promise<void> {
  if (!auth) return;
  if (auth.currentUser) return;

  if (!pendingAuthPromise) {
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 4000));
    const signInPromise = signInAnonymously(auth)
      .then(() => {})
      .catch((e) => {
        console.warn("Anonymous auth warning:", e);
      });

    pendingAuthPromise = Promise.race([signInPromise, timeoutPromise]).finally(() => {
      pendingAuthPromise = null;
    });
  }

  await pendingAuthPromise;
}

/**
 * Safely caches hikes to localStorage without raw GPX XML strings to avoid
 * exceeding the browser's 5MB localStorage quota. Never throws.
 */
export function saveHikesToStorageSafe(hikes: Hike[]): void {
  try {
    const lightweight = hikes.map((h) => ({
      id: h.id,
      name: h.name,
      distance: h.distance,
      date: h.date,
      dateTo: h.dateTo,
      rawDate: h.rawDate,
      endDate: h.endDate,
      participants: h.participants,
      note: h.note,
      routes: (h.routes || h.maps || []).map((r) => ({
        distance: r.distance,
        link: r.link || r.url || '',
        url: r.url || r.link || '',
        gpxName: r.gpxName || '',
        gpxUrl: r.gpxUrl || '',
        hasGpx: r.hasGpx,
        visible: r.visible !== false,
        photosUrl: r.photosUrl || r.photos || '',
        photos: r.photos || r.photosUrl || '',
        youtube: r.youtube || r.video || '',
        video: r.video || r.youtube || '',
        coordinates: r.coordinates || [],
      })),
    }));
    localStorage.setItem('hikingArchiveDataJsonOnly', JSON.stringify(lightweight));
  } catch {
    try {
      // Fallback without coordinates if storage is still near quota
      const minimal = hikes.map(({ maps, routes, gpx, ...rest }) => ({
        ...rest,
        routes: (routes || maps || []).map(({ coordinates, gpxData, ...rRest }) => rRest),
      }));
      localStorage.setItem('hikingArchiveDataJsonOnly', JSON.stringify(minimal));
    } catch {
      // Ignore storage quota errors completely
    }
  }
}

export async function extractRoutesFromData(
  data: Record<string, unknown>,
  gpxDataMap: Record<string, unknown> = {}
): Promise<RoutePart[]> {
  const routes: RoutePart[] = [];

  async function processItem(item: unknown): Promise<RoutePart | null> {
    if (!item) return null;
    if (typeof item === 'string') {
      const coords = await resolveGpxVal(item);
      const isHttp = item.startsWith('http');
      const isMapy = isHttp && (item.includes('mapy.cz') || item.includes('mapy.com'));
      return {
        link: isMapy ? item : '',
        url: isMapy ? item : '',
        gpxUrl: isHttp && !isMapy ? item : '',
        hasGpx: coords.length > 0,
        coordinates: coords,
        visible: true,
      };
    }

    const obj = item as Record<string, unknown>;
    const rawGpxVal =
      obj.gpxData ||
      obj.gpx ||
      obj.gpxUrl ||
      obj.gpxFile ||
      obj.file ||
      obj.fileData ||
      obj.coordinates ||
      obj.coords ||
      obj.points ||
      obj.track ||
      obj.path ||
      obj.gpxContent ||
      obj.xml;

    const coords = await resolveGpxVal(rawGpxVal);
    const mapLink = String(obj.link || obj.url || obj.mapUrl || obj.map || obj.mapa || '');
    const gpxLink = String(
      obj.gpxUrl ||
        obj.gpxDownload ||
        (typeof obj.gpx === 'string' && obj.gpx.startsWith('http') ? obj.gpx : '')
    );
    const gpxName = String(
      obj.gpxName || (gpxLink ? 'GPX trasa' : coords.length > 0 ? 'Nahrané GPX' : '')
    );

    let routePhotos = obj.photosUrl || obj.photos || obj.photo || obj.fotky || obj.foto || '';
    if (Array.isArray(routePhotos)) routePhotos = routePhotos[0] || '';

    const video = String(obj.youtube || obj.video || obj.videa || '');
    const savedGpxData =
      typeof obj.gpxData === 'string'
        ? obj.gpxData
        : typeof rawGpxVal === 'string' && !rawGpxVal.startsWith('http')
        ? rawGpxVal
        : null;

    const rawSegDist =
      obj.distance !== undefined && obj.distance !== null && obj.distance !== ''
        ? parseFloat(String(obj.distance))
        : NaN;
    const gpxDist = coords.length >= 2 ? calculateCoordsDistanceKm(coords) : 0;
    const segDist =
      !isNaN(rawSegDist) && rawSegDist > 0
        ? Math.round(rawSegDist * 10) / 10
        : gpxDist > 0
        ? Math.round(gpxDist * 10) / 10
        : undefined;

    return {
      distance: segDist,
      link: mapLink,
      url: mapLink,
      gpxUrl: gpxLink,
      gpxName: gpxName,
      gpxData: savedGpxData,
      hasGpx: coords.length > 0 || !!gpxLink || !!savedGpxData,
      coordinates: coords,
      visible: obj.visible !== undefined ? Boolean(obj.visible) : true,
      photosUrl: String(routePhotos || ''),
      photos: String(routePhotos || ''),
      youtube: video,
      video: video,
    };
  }

  const arrayFields = ['routes', 'maps', 'trasy', 'tracks', 'mapy', 'items'];
  for (const field of arrayFields) {
    const list = data[field];
    if (Array.isArray(list) && list.length > 0) {
      for (const item of list) {
        const processed = await processItem(item);
        if (processed) routes.push(processed);
      }
    }
  }

  if (routes.length === 0 || routes.every((r) => !r.coordinates || r.coordinates.length === 0)) {
    const rootGpx =
      data.gpx ||
      data.gpxData ||
      data.gpxUrl ||
      data.gpxFile ||
      data.gpxXml ||
      data.gpxContent ||
      data.file ||
      data.coordinates ||
      data.coords ||
      data.points ||
      gpxDataMap;

    const directCoords = await resolveGpxVal(rootGpx);
    const mapLink = String(data.mapUrl || data.url || data.link || data.map || data.mapa || '');
    const gpxLink = String(
      (typeof data.gpxUrl === 'string' && data.gpxUrl.startsWith('http') ? data.gpxUrl : '') ||
        (typeof data.gpx === 'string' && data.gpx.startsWith('http') ? data.gpx : '')
    );

    if (directCoords.length > 0 || mapLink || gpxLink) {
      routes.push({
        link: mapLink,
        url: mapLink,
        gpxUrl: gpxLink,
        gpxData: typeof data.gpx === 'string' && !data.gpx.startsWith('http') ? data.gpx : null,
        gpxName: gpxLink ? 'GPX trasa' : directCoords.length > 0 ? 'Původní GPX' : '',
        hasGpx: directCoords.length > 0 || !!gpxLink,
        coordinates: directCoords,
        visible: true,
      });
    }
  }

  return routes;
}

export async function processFirestoreDoc(
  docSnapId: string,
  data: Record<string, unknown>,
  gpxDataMap: Record<string, unknown> = {}
): Promise<Hike> {
  const distNum = parseFloat(String(data.distance || '0'));

  let startDateRaw = String(data.date || data.dateFrom || data.startDate || data.from || '');
  let endDateRaw = String(data.dateTo || data.endDate || data.to || data.end || '');

  if (startDateRaw && !endDateRaw) {
    if (startDateRaw.includes(' - ')) {
      const p = startDateRaw.split(' - ');
      startDateRaw = p[0].trim();
      endDateRaw = p[1].trim();
    } else if (startDateRaw.includes(' – ')) {
      const p = startDateRaw.split(' – ');
      startDateRaw = p[0].trim();
      endDateRaw = p[1].trim();
    }
  }

  const routes = await extractRoutesFromData(
    data,
    (gpxDataMap[docSnapId] as Record<string, unknown>) || {}
  );

  // Backfill segment distance if single-segment hike has hike.distance but no route.distance
  if (routes.length === 1 && !routes[0].distance && !isNaN(distNum) && distNum > 0) {
    routes[0].distance = Math.round(distNum * 10) / 10;
  }

  // Sum segment distances when available
  const explicitSegmentsSum = routes.reduce((sum, r) => {
    const d = r.distance !== undefined ? parseFloat(String(r.distance)) : NaN;
    return sum + (!isNaN(d) && d > 0 ? d : 0);
  }, 0);

  const finalDistNum =
    !isNaN(distNum) && distNum > 0
      ? distNum
      : explicitSegmentsSum > 0
      ? explicitSegmentsSum
      : 0;
  const formattedDist = finalDistNum.toFixed(1);

  return {
    id: docSnapId,
    name: String(data.name || 'Neznámý výšlap'),
    distance: formattedDist,
    date: startDateRaw,
    dateTo: endDateRaw,
    rawDate: startDateRaw,
    endDate: endDateRaw,
    participants: String(data.participants || ''),
    note: String(data.note || data.notes || data.description || ''),
    routes: routes,
    maps: routes,
    gpx: typeof data.gpx === 'string' ? data.gpx : undefined,
  };
}

export function subscribeToHikesLive(
  onSuccess: (hikes: Hike[]) => void,
  onError: (err: Error) => void
): () => void {
  if (!db) {
    onError(new Error("Databáze není inicializována"));
    return () => {};
  }

  let cancelled = false;
  let unsubscribeSnapshot: (() => void) | null = null;

  (async () => {
    try {
      await ensureAuth();
      if (cancelled || !db) return;

      const vyslapyRef = collection(db, 'vyslapy');
      unsubscribeSnapshot = onSnapshot(
        vyslapyRef,
        async (snapshot) => {
          try {
            const promises = snapshot.docs.map((docSnap) =>
              processFirestoreDoc(docSnap.id, docSnap.data())
            );
            const resolved = await Promise.all(promises);
            if (cancelled) return;
            onSuccess(resolved);
            saveHikesToStorageSafe(resolved);
          } catch (err) {
            console.error("Error processing hikes snapshot:", err);
            if (!cancelled) onError(err as Error);
          }
        },
        (error) => {
          console.warn("Firestore subscription error:", error);
          if (!cancelled) onError(error);
        }
      );
    } catch (err) {
      if (!cancelled) onError(err as Error);
    }
  })();

  return () => {
    cancelled = true;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }
  };
}

export async function fetchAllHikes(): Promise<Hike[]> {
  if (!db) throw new Error("Databáze není dostupná");
  await ensureAuth();

  const querySnapshot = await getDocs(collection(db, 'vyslapy'));
  const gpxDataMap: Record<string, unknown> = {};
  try {
    const gpxSnapshot = await getDocs(collection(db, 'vyslapy_gpx'));
    gpxSnapshot.forEach((d) => {
      gpxDataMap[d.id] = d.data();
    });
  } catch {
    // optional gpx collection
  }

  const promises = querySnapshot.docs.map((docSnap) =>
    processFirestoreDoc(docSnap.id, docSnap.data(), gpxDataMap)
  );

  const hikes = await Promise.all(promises);
  saveHikesToStorageSafe(hikes);
  return hikes;
}

function serializeRoutesForFirestore(routes?: RoutePart[]) {
  return (routes || [])
    .filter(
      (r) =>
        (r.distance !== undefined && r.distance !== '' && parseFloat(String(r.distance)) > 0) ||
        r.link ||
        r.url ||
        r.gpxData ||
        r.photosUrl ||
        r.photos ||
        r.youtube ||
        r.video
    )
    .map((r) => {
      const parsedDist =
        r.distance !== undefined && r.distance !== '' ? parseFloat(String(r.distance)) : NaN;
      return {
        distance: !isNaN(parsedDist) && parsedDist > 0 ? Math.round(parsedDist * 10) / 10 : 0,
        link: (r.link || r.url || '').trim(),
        gpxData: r.gpxData || null,
        gpxName: r.gpxName || '',
        photosUrl: (r.photosUrl || r.photos || '').trim(),
        youtube: (r.youtube || r.video || '').trim(),
      };
    });
}

export async function addHike(hikeData: {
  name: string;
  distance: number;
  date: string;
  dateTo?: string;
  participants?: string;
  note?: string;
  routes?: RoutePart[];
}) {
  if (!db) throw new Error("Databáze není dostupná");
  await ensureAuth();

  const payload: Record<string, unknown> = {
    name: hikeData.name.trim(),
    distance: hikeData.distance,
    date: hikeData.date,
    dateTo: hikeData.dateTo || '',
    participants: (hikeData.participants || '').trim(),
    note: (hikeData.note || '').trim(),
    routes: serializeRoutesForFirestore(hikeData.routes),
  };

  const docRef = await addDoc(collection(db, 'vyslapy'), payload);
  return docRef.id;
}

export async function updateHike(
  id: string,
  hikeData: {
    name: string;
    distance: number;
    date: string;
    dateTo?: string;
    participants?: string;
    note?: string;
    routes?: RoutePart[];
  }
) {
  if (!db) throw new Error("Databáze není dostupná");
  await ensureAuth();

  const payload: Record<string, unknown> = {
    name: hikeData.name.trim(),
    distance: hikeData.distance,
    date: hikeData.date,
    dateTo: hikeData.dateTo || '',
    participants: (hikeData.participants || '').trim(),
    note: (hikeData.note || '').trim(),
    routes: serializeRoutesForFirestore(hikeData.routes),
  };

  await updateDoc(doc(db, 'vyslapy', id), payload);
}

export async function deleteHike(id: string) {
  if (!db) throw new Error("Databáze není dostupná");
  await ensureAuth();
  await deleteDoc(doc(db, 'vyslapy', id));
}

export async function replaceAllHikesInFirebase(newHikes: Hike[]) {
  if (!db) throw new Error("Databáze není dostupná");
  await ensureAuth();

  const existingSnapshot = await getDocs(collection(db, 'vyslapy'));
  for (const docSnap of existingSnapshot.docs) {
    await deleteDoc(doc(db, 'vyslapy', docSnap.id));
  }

  for (const h of newHikes) {
    const payload = {
      name: h.name,
      distance: typeof h.distance === 'string' ? parseFloat(h.distance) || 0 : h.distance,
      date: h.date,
      dateTo: h.dateTo || '',
      participants: h.participants || '',
      note: h.note || '',
      routes: serializeRoutesForFirestore(h.routes || h.maps),
    };
    await addDoc(collection(db, 'vyslapy'), payload);
  }
}

// ============================================================================
// PLANNED ROUTES (Plánované trasy) - Separate collection 'planovane_trasy'
// ============================================================================

const PLANNED_STORAGE_KEY = 'plannedRoutesArchiveData';

export function savePlannedRoutesToStorageSafe(planned: PlannedRoute[]): void {
  try {
    const lightweight = planned.map((p) => ({
      id: p.id,
      name: p.name,
      distance: p.distance,
      link: p.link || '',
      note: p.note || '',
      color: p.color || '',
      gpxName: p.gpxName || '',
      createdAt: p.createdAt || '',
      coordinates: p.coordinates || [],
      routes: (p.routes || []).map((r) => ({
        distance: r.distance,
        link: r.link || r.url || '',
        url: r.url || r.link || '',
        gpxName: r.gpxName || '',
        hasGpx: r.hasGpx,
        visible: r.visible !== false,
        coordinates: r.coordinates || [],
      })),
    }));
    localStorage.setItem(PLANNED_STORAGE_KEY, JSON.stringify(lightweight));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadPlannedRoutesFromStorage(): PlannedRoute[] {
  try {
    const raw = localStorage.getItem(PLANNED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

async function processPlannedFirestoreDoc(
  docSnapId: string,
  data: Record<string, unknown>
): Promise<PlannedRoute> {
  const routes = await extractRoutesFromData(data);
  const directCoords =
    routes.length > 0 && routes[0].coordinates && routes[0].coordinates.length > 0
      ? routes[0].coordinates
      : await resolveGpxVal(data.gpxData || data.gpx || data.coordinates);

  const distNum = parseFloat(String(data.distance || '0'));
  const explicitSegmentsSum = routes.reduce((sum, r) => {
    const d = r.distance !== undefined ? parseFloat(String(r.distance)) : NaN;
    return sum + (!isNaN(d) && d > 0 ? d : 0);
  }, 0);
  const calcDist = directCoords.length >= 2 ? calculateCoordsDistanceKm(directCoords) : 0;

  const finalDistNum =
    !isNaN(distNum) && distNum > 0
      ? distNum
      : explicitSegmentsSum > 0
      ? explicitSegmentsSum
      : calcDist > 0
      ? calcDist
      : 0;

  if (routes.length === 0 && (directCoords.length > 0 || data.link)) {
    routes.push({
      distance: Math.round(finalDistNum * 10) / 10,
      link: String(data.link || ''),
      url: String(data.link || ''),
      gpxName: String(data.gpxName || ''),
      gpxData: typeof data.gpxData === 'string' ? data.gpxData : null,
      hasGpx: directCoords.length > 0,
      coordinates: directCoords,
      visible: true,
    });
  }

  return {
    id: docSnapId,
    name: String(data.name || 'Plánovaná trasa'),
    distance: finalDistNum.toFixed(1),
    link: String(data.link || (routes[0]?.link ?? '')),
    note: String(data.note || ''),
    color: typeof data.color === 'string' ? data.color : undefined,
    gpxName: String(data.gpxName || (routes[0]?.gpxName ?? '')),
    gpxData: typeof data.gpxData === 'string' ? data.gpxData : null,
    coordinates: directCoords,
    routes,
    createdAt: String(data.createdAt || ''),
  };
}

export function subscribeToPlannedRoutesLive(
  onSuccess: (routes: PlannedRoute[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db) {
    onError?.(new Error('Databáze není inicializována'));
    return () => {};
  }

  let cancelled = false;
  let unsubscribeSnapshot: (() => void) | null = null;

  (async () => {
    try {
      await ensureAuth();
      if (cancelled || !db) return;

      const plannedRef = collection(db, 'planovane_trasy');
      unsubscribeSnapshot = onSnapshot(
        plannedRef,
        async (snapshot) => {
          try {
            const promises = snapshot.docs.map((docSnap) =>
              processPlannedFirestoreDoc(docSnap.id, docSnap.data())
            );
            const resolved = await Promise.all(promises);
            if (cancelled) return;
            onSuccess(resolved);
            savePlannedRoutesToStorageSafe(resolved);
          } catch (err) {
            console.warn('Error processing planned routes snapshot:', err);
            if (!cancelled) onError?.(err as Error);
          }
        },
        (error) => {
          console.warn('Planned routes Firestore subscription warning:', error);
          if (!cancelled) onError?.(error);
        }
      );
    } catch (err) {
      if (!cancelled) onError?.(err as Error);
    }
  })();

  return () => {
    cancelled = true;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }
  };
}

export async function addPlannedRoute(routeData: {
  name: string;
  distance: number;
  link?: string;
  note?: string;
  color?: string;
  routes: RoutePart[];
}): Promise<string> {
  if (!db) throw new Error('Databáze není dostupná');
  await ensureAuth();

  const payload: Record<string, unknown> = {
    name: routeData.name.trim(),
    distance: routeData.distance,
    link: (routeData.link || '').trim(),
    note: (routeData.note || '').trim(),
    color: routeData.color || '',
    createdAt: new Date().toISOString(),
    routes: serializeRoutesForFirestore(routeData.routes),
  };

  const docRef = await addDoc(collection(db, 'planovane_trasy'), payload);
  return docRef.id;
}

export async function updatePlannedRoute(
  id: string,
  routeData: {
    name: string;
    distance: number;
    link?: string;
    note?: string;
    color?: string;
    routes: RoutePart[];
  }
): Promise<void> {
  if (!db) throw new Error('Databáze není dostupná');
  await ensureAuth();

  const payload: Record<string, unknown> = {
    name: routeData.name.trim(),
    distance: routeData.distance,
    link: (routeData.link || '').trim(),
    note: (routeData.note || '').trim(),
    color: routeData.color || '',
    routes: serializeRoutesForFirestore(routeData.routes),
  };

  await updateDoc(doc(db, 'planovane_trasy', id), payload);
}

export async function deletePlannedRoute(id: string): Promise<void> {
  if (!db) throw new Error('Databáze není dostupná');
  await ensureAuth();
  await deleteDoc(doc(db, 'planovane_trasy', id));
}

// ============================================================================
// PARTICIPANTS (Účastníci) - Collection 'ucastnici' + localStorage
// ============================================================================

const PARTICIPANTS_STORAGE_KEY = 'participantsProfilesArchiveData';

export function saveParticipantsToStorage(profiles: Record<string, ParticipantProfile>): void {
  try {
    localStorage.setItem(PARTICIPANTS_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // ignore
  }
}

export function loadParticipantsFromStorage(): Record<string, ParticipantProfile> {
  try {
    const raw = localStorage.getItem(PARTICIPANTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

function getParticipantDocId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'turista'
  );
}

export function subscribeToParticipantsLive(
  onSuccess: (profiles: Record<string, ParticipantProfile>) => void
): () => void {
  if (!db) return () => {};

  let cancelled = false;
  let unsubscribeSnapshot: (() => void) | null = null;

  (async () => {
    try {
      await ensureAuth();
      if (cancelled || !db) return;

      const ref = collection(db, 'ucastnici');
      unsubscribeSnapshot = onSnapshot(
        ref,
        (snapshot) => {
          if (cancelled) return;
          const local = loadParticipantsFromStorage();
          const merged: Record<string, ParticipantProfile> = { ...local };
          snapshot.docs.forEach((d) => {
            const data = d.data();
            const name = String(data.name || '').trim();
            if (name) {
              merged[name] = {
                name,
                email: String(data.email || '').trim(),
                notifiedMilestones: Array.isArray(data.notifiedMilestones)
                  ? data.notifiedMilestones.map(String)
                  : merged[name]?.notifiedMilestones || [],
              };
            }
          });
          saveParticipantsToStorage(merged);
          onSuccess(merged);
        },
        () => {
          // Ignore if Firestore rules restrict 'ucastnici' collection; localStorage remains active
        }
      );
    } catch {
      // ignore
    }
  })();

  return () => {
    cancelled = true;
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }
  };
}

export async function saveParticipantProfile(profile: ParticipantProfile): Promise<void> {
  const current = loadParticipantsFromStorage();
  current[profile.name.trim()] = {
    name: profile.name.trim(),
    email: profile.email.trim(),
    notifiedMilestones: profile.notifiedMilestones || current[profile.name.trim()]?.notifiedMilestones || [],
  };
  saveParticipantsToStorage(current);

  if (!db) return;
  try {
    await ensureAuth();
    const docId = getParticipantDocId(profile.name);
    await setDoc(
      doc(db, 'ucastnici', docId),
      {
        name: profile.name.trim(),
        email: profile.email.trim(),
        notifiedMilestones: current[profile.name.trim()].notifiedMilestones || [],
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch {
    // Already persisted in localStorage
  }
}


