import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';
import { Hike, RoutePart } from '../types';
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
