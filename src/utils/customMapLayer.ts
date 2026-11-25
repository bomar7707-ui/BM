import L from 'leaflet';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
  MapaSettings,
  MapaStylePreset,
  getMapaSettings,
  getMapaSettingsSignature,
  subscribeMapaSettings,
} from './mapSettings';

/**
 * High-Performance Custom Czech & World Cartographic Map Engine (Mapa v1.3.0).
 *
 * Performance optimizations:
 * 1. Pre-decoded VectorTile cache (`DECODED_VT_CACHE`) with per-feature bounding boxes
 *    for O(1) sub-tile frustum culling (no repeated PBF parsing or geometry decoding).
 * 2. Precomputed 1D elevation & bathymetry color Lookup Tables (LUTs) per style preset.
 * 3. Analytical vector hillshade (1 sqrt instead of 5 trig calls per DEM cell) +
 *    zero per-tile temporary DOM `<canvas>` or `ImageData` allocations.
 * 4. Single-pass zero-allocation Marching Squares contour generator using `Path2D`.
 * 5. LRU Rendered Tile Bitmap Cache (`RENDERED_TILE_CACHE`) + instant parent-tile quadrant
 *    preview while zooming + frame-budgeted LIFO `requestAnimationFrame` render scheduler.
 */

const TILE_LOGICAL_PX = 256;
const TILE_BACKING_PX =
  typeof window !== 'undefined' && (window.devicePixelRatio || 1) <= 1.25 ? 384 : 512;
const MAX_NATIVE_VECTOR_Z = 14;
const MAX_DEM_Z = 12;
const MAX_SAT_Z = 13;

const FALLBACK_OPENFREEMAP_TEMPLATE =
  'https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf';

const TERRARIUM_DEM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// EOX Sentinel-2 Cloudless 2024 (WMTS /{z}/{y}/{x}.jpg)
const SENTINEL2_TILE_URL = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`;

// ---------------------------------------------------------------------------
// Pre-decoded Vector Tile Data Structures
// ---------------------------------------------------------------------------
interface Pt {
  x: number;
  y: number;
}

interface DecodedGeomFeature {
  rings: Pt[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface DecodedPlaceFeature {
  x: number;
  y: number;
  name: string;
  cls: string;
  rank: number;
}

interface DecodedPeakFeature {
  x: number;
  y: number;
  name: string;
  ele: number;
  rank: number;
}

interface DecodedWaterNameFeature {
  x: number;
  y: number;
  name: string;
}

interface DecodedRoadShieldFeature {
  x: number;
  y: number;
  ref: string;
  isGreen: boolean;
}

type RoadClass =
  | 'ferry'
  | 'path'
  | 'track'
  | 'service'
  | 'minor'
  | 'tertiary'
  | 'secondary'
  | 'primary'
  | 'trunk'
  | 'motorway';

interface DecodedVectorTile {
  extent: number;
  landcover: {
    grass: DecodedGeomFeature[];
    wood: DecodedGeomFeature[];
    wetland: DecodedGeomFeature[];
    rock: DecodedGeomFeature[];
    glacier: DecodedGeomFeature[];
  };
  parks: DecodedGeomFeature[];
  urban: DecodedGeomFeature[];
  buildings: DecodedGeomFeature[];
  oceans: DecodedGeomFeature[];
  inlandWater: DecodedGeomFeature[];
  waterways: {
    stream: DecodedGeomFeature[];
    canal: DecodedGeomFeature[];
    river: DecodedGeomFeature[];
  };
  aerowayPolys: DecodedGeomFeature[];
  aerowayLines: { geom: DecodedGeomFeature; isRunway: boolean }[];
  borders: {
    b2: DecodedGeomFeature[];
    b4: DecodedGeomFeature[];
    b6: DecodedGeomFeature[];
  };
  railways: DecodedGeomFeature[];
  roads: Record<RoadClass, DecodedGeomFeature[]>;
  places: DecodedPlaceFeature[];
  peaks: DecodedPeakFeature[];
  waterNames: DecodedWaterNameFeature[];
  roadShields: DecodedRoadShieldFeature[];
}

// ---------------------------------------------------------------------------
// Shared LRU Caches across all map views & 3D diorama
// ---------------------------------------------------------------------------
const MAX_VT_CACHE = 220;
const MAX_DEM_CACHE = 140;
const MAX_SAT_CACHE = 140;
const MAX_RENDERED_TILE_CACHE = 180;

const DECODED_VT_CACHE = new Map<string, DecodedVectorTile | null>();
const VT_INFLIGHT = new Map<string, Promise<DecodedVectorTile | null>>();
const DEM_CACHE = new Map<string, Float32Array | null>();
const DEM_INFLIGHT = new Map<string, Promise<Float32Array | null>>();
const SAT_CACHE = new Map<string, HTMLImageElement | null>();
const SAT_INFLIGHT = new Map<string, Promise<HTMLImageElement | null>>();
const RENDERED_TILE_CACHE = new Map<string, HTMLCanvasElement>();

let resolvedVectorTemplate: string | null = null;
let vectorTemplatePromise: Promise<string> | null = null;

function resolveVectorTileTemplate(): Promise<string> {
  if (resolvedVectorTemplate) return Promise.resolve(resolvedVectorTemplate);
  if (vectorTemplatePromise) return vectorTemplatePromise;

  if (typeof fetch === 'undefined') {
    resolvedVectorTemplate = FALLBACK_OPENFREEMAP_TEMPLATE;
    return Promise.resolve(resolvedVectorTemplate);
  }

  vectorTemplatePromise = fetch('https://tiles.openfreemap.org/planet')
    .then((res) => (res.ok ? res.json() : null))
    .then((tj) => {
      if (tj && Array.isArray(tj.tiles) && typeof tj.tiles[0] === 'string') {
        resolvedVectorTemplate = tj.tiles[0];
        return resolvedVectorTemplate;
      }
      resolvedVectorTemplate = FALLBACK_OPENFREEMAP_TEMPLATE;
      return resolvedVectorTemplate;
    })
    .catch(() => {
      resolvedVectorTemplate = FALLBACK_OPENFREEMAP_TEMPLATE;
      return resolvedVectorTemplate;
    });

  return vectorTemplatePromise;
}

// Pre-warm OpenFreeMap tile template immediately on module import
void resolveVectorTileTemplate();

function setLru<K, V>(map: Map<K, V>, key: K, val: V, maxSize: number) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  if (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function getPreferredName(props: Record<string, unknown>): string {
  const cs = props['name:cs'];
  if (typeof cs === 'string' && cs.trim()) return cs.trim();
  const latin = props['name:latin'];
  if (typeof latin === 'string' && latin.trim()) return latin.trim();
  const def = props.name;
  if (typeof def === 'string' && def.trim()) return def.trim();
  return '';
}

const URBAN_LANDUSE = new Set([
  'residential',
  'industrial',
  'commercial',
  'retail',
  'quarter',
  'suburb',
  'neighbourhood',
  'hospital',
  'school',
  'university',
  'college',
  'cemetery',
  'railway',
  'quarry',
  'military',
  'stadium',
]);

const PLACE_CLASS_ORDER: Record<string, number> = {
  country: 0,
  city: 1,
  town: 2,
  village: 3,
  suburb: 4,
  hamlet: 5,
};

function decodeGeomWithBbox(
  rawRings: Pt[][],
  scaleTo4096: number,
  minPoints: number
): DecodedGeomFeature | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings: Pt[][] = [];

  for (let r = 0; r < rawRings.length; r++) {
    const src = rawRings[r];
    if (src.length < minPoints) continue;
    if (scaleTo4096 === 1) {
      for (let i = 0; i < src.length; i++) {
        const { x, y } = src[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      rings.push(src);
    } else {
      const scaled: Pt[] = new Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const x = src[i].x * scaleTo4096;
        const y = src[i].y * scaleTo4096;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        scaled[i] = { x, y };
      }
      rings.push(scaled);
    }
  }

  if (rings.length === 0) return null;
  return { rings, minX, minY, maxX, maxY };
}

/**
 * Decodes an OpenFreeMap PBF buffer ONCE into pre-classified geometry buckets with bounding boxes.
 */
function parseAndDecodeVectorTile(buf: ArrayBuffer, z: number): DecodedVectorTile | null {
  let vt: VectorTile;
  try {
    vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  } catch {
    return null;
  }

  const EXTENT = 4096;
  const decoded: DecodedVectorTile = {
    extent: EXTENT,
    landcover: { grass: [], wood: [], wetland: [], rock: [], glacier: [] },
    parks: [],
    urban: [],
    buildings: [],
    oceans: [],
    inlandWater: [],
    waterways: { stream: [], canal: [], river: [] },
    aerowayPolys: [],
    aerowayLines: [],
    borders: { b2: [], b4: [], b6: [] },
    railways: [],
    roads: {
      ferry: [],
      path: [],
      track: [],
      service: [],
      minor: [],
      tertiary: [],
      secondary: [],
      primary: [],
      trunk: [],
      motorway: [],
    },
    places: [],
    peaks: [],
    waterNames: [],
    roadShields: [],
  };

  // 1. Landcover
  const landcover = vt.layers.landcover;
  if (landcover) {
    const s = EXTENT / (landcover.extent || EXTENT);
    for (let i = 0; i < landcover.length; i++) {
      const f = landcover.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      let target: DecodedGeomFeature[] | null = null;
      if (cls === 'wood' || cls === 'forest') target = decoded.landcover.wood;
      else if (cls === 'grass' || cls === 'meadow' || cls === 'farmland') target = decoded.landcover.grass;
      else if (cls === 'wetland') target = decoded.landcover.wetland;
      else if (cls === 'rock' || cls === 'sand') target = decoded.landcover.rock;
      else if (cls === 'ice' || cls === 'glacier') target = decoded.landcover.glacier;
      if (!target) continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
      if (g) target.push(g);
    }
  }

  // 2. Parks
  const parkLayer = vt.layers.park;
  if (parkLayer && z >= 8) {
    const s = EXTENT / (parkLayer.extent || EXTENT);
    for (let i = 0; i < parkLayer.length; i++) {
      const f = parkLayer.feature(i);
      if (f.type !== 3) continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
      if (g) decoded.parks.push(g);
    }
  }

  // 3. Urban landuse
  const landuse = vt.layers.landuse;
  if (landuse && z >= 9) {
    const s = EXTENT / (landuse.extent || EXTENT);
    for (let i = 0; i < landuse.length; i++) {
      const f = landuse.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      if (!URBAN_LANDUSE.has(cls)) continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
      if (g) decoded.urban.push(g);
    }
  }

  // 4. Buildings
  const building = vt.layers.building;
  if (building && z >= 13) {
    const s = EXTENT / (building.extent || EXTENT);
    const cap = Math.min(building.length, 600);
    for (let i = 0; i < cap; i++) {
      const f = building.feature(i);
      if (f.type !== 3) continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
      if (g) decoded.buildings.push(g);
    }
  }

  // 5. Water polygons
  const water = vt.layers.water;
  if (water) {
    const s = EXTENT / (water.extent || EXTENT);
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      if (f.type !== 3) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'swimming_pool') continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
      if (!g) continue;
      if (cls === 'ocean' || cls === 'sea') {
        decoded.oceans.push(g);
      } else {
        decoded.inlandWater.push(g);
      }
    }
  }

  // 6. Waterways
  const waterway = vt.layers.waterway;
  if (waterway) {
    const s = EXTENT / (waterway.extent || EXTENT);
    for (let i = 0; i < waterway.length; i++) {
      const f = waterway.feature(i);
      if (f.type !== 2) continue;
      const raw = String(f.properties.class || 'stream');
      if (raw !== 'river' && raw !== 'canal' && z < 11) continue;
      const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
      if (!g) continue;
      if (raw === 'river') decoded.waterways.river.push(g);
      else if (raw === 'canal') decoded.waterways.canal.push(g);
      else decoded.waterways.stream.push(g);
    }
  }

  // 7. Aeroways
  const aeroway = vt.layers.aeroway;
  if (aeroway && z >= 10) {
    const s = EXTENT / (aeroway.extent || EXTENT);
    for (let i = 0; i < aeroway.length; i++) {
      const f = aeroway.feature(i);
      const cls = String(f.properties.class || '');
      if (cls !== 'runway' && cls !== 'taxiway' && cls !== 'apron') continue;
      if (f.type === 3) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 3);
        if (g) decoded.aerowayPolys.push(g);
      } else if (f.type === 2) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
        if (g) decoded.aerowayLines.push({ geom: g, isRunway: cls === 'runway' });
      }
    }
  }

  // 8. Boundaries
  const boundary = vt.layers.boundary;
  if (boundary) {
    const s = EXTENT / (boundary.extent || EXTENT);
    for (let i = 0; i < boundary.length; i++) {
      const f = boundary.feature(i);
      if (f.type !== 2 || f.properties.maritime === 1) continue;
      const lvl = Number(f.properties.admin_level || 0);
      if (lvl === 2) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
        if (g) decoded.borders.b2.push(g);
      } else if (lvl === 4 && z >= 7) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
        if (g) decoded.borders.b4.push(g);
      } else if ((lvl === 6 || lvl === 7) && z >= 7) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
        if (g) decoded.borders.b6.push(g);
      }
    }
  }

  // 9. Transportation
  const transport = vt.layers.transportation;
  if (transport) {
    const s = EXTENT / (transport.extent || EXTENT);
    for (let i = 0; i < transport.length; i++) {
      const f = transport.feature(i);
      if (f.type !== 2) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'rail' || cls === 'transit') {
        if (z >= 8) {
          const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
          if (g) decoded.railways.push(g);
        }
        continue;
      }
      if (cls in decoded.roads) {
        const g = decodeGeomWithBbox(f.loadGeometry(), s, 2);
        if (g) decoded.roads[cls as RoadClass].push(g);
      }
    }
  }

  // 10. Places
  const placeLayer = vt.layers.place;
  if (placeLayer) {
    const s = EXTENT / (placeLayer.extent || EXTENT);
    for (let i = 0; i < placeLayer.length; i++) {
      const f = placeLayer.feature(i);
      if (f.type !== 1) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'continent') continue;
      if (cls === 'country' && z >= 8) continue;
      if ((cls === 'village' || cls === 'hamlet') && z < 10) continue;
      if (cls === 'suburb' && z < 12) continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      decoded.places.push({
        x: geom[0][0].x * s,
        y: geom[0][0].y * s,
        name,
        cls,
        rank: Number(f.properties.rank || 10),
      });
    }
    decoded.places.sort(
      (a, b) => (PLACE_CLASS_ORDER[a.cls] ?? 6) - (PLACE_CLASS_ORDER[b.cls] ?? 6) || a.rank - b.rank
    );
  }

  // 11. Mountain peaks
  const peakLayer = vt.layers.mountain_peak;
  if (peakLayer && z >= 10) {
    const s = EXTENT / (peakLayer.extent || EXTENT);
    for (let i = 0; i < peakLayer.length; i++) {
      const f = peakLayer.feature(i);
      if (f.type !== 1) continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      decoded.peaks.push({
        x: geom[0][0].x * s,
        y: geom[0][0].y * s,
        name,
        ele: Number(f.properties.ele || 0),
        rank: Number(f.properties.rank || 10),
      });
    }
    decoded.peaks.sort((a, b) => a.rank - b.rank || b.ele - a.ele);
  }

  // 12. Water names
  const waterName = vt.layers.water_name;
  if (waterName && z >= 10) {
    const s = EXTENT / (waterName.extent || EXTENT);
    for (let i = 0; i < Math.min(waterName.length, 20); i++) {
      const f = waterName.feature(i);
      if (f.type !== 1) continue;
      const cls = String(f.properties.class || '');
      if (cls === 'ocean' || cls === 'sea') continue;
      const name = getPreferredName(f.properties);
      if (!name) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      decoded.waterNames.push({
        x: geom[0][0].x * s,
        y: geom[0][0].y * s,
        name,
      });
    }
  }

  // 13. Road shields
  const tName = vt.layers.transportation_name;
  if (tName && z >= 9) {
    const s = EXTENT / (tName.extent || EXTENT);
    const seenRefs = new Set<string>();
    for (let i = 0; i < Math.min(tName.length, 50); i++) {
      const f = tName.feature(i);
      const cls = String(f.properties.class || '');
      if (cls !== 'motorway' && cls !== 'trunk' && cls !== 'primary') continue;
      const refRaw = f.properties.ref;
      if (typeof refRaw !== 'string') continue;
      const ref = refRaw.split(';')[0].trim();
      if (!ref || ref.length > 6 || seenRefs.has(ref)) continue;
      const geom = f.loadGeometry();
      if (!geom.length || geom[0].length < 2) continue;
      seenRefs.add(ref);
      const mid = geom[0][Math.floor(geom[0].length / 2)];
      decoded.roadShields.push({
        x: mid.x * s,
        y: mid.y * s,
        ref,
        isGreen: cls === 'motorway' || cls === 'trunk',
      });
    }
  }

  return decoded;
}

async function fetchDecodedVectorTile(
  z: number,
  x: number,
  y: number
): Promise<DecodedVectorTile | null> {
  const key = `${z}/${x}/${y}`;
  if (DECODED_VT_CACHE.has(key)) {
    const val = DECODED_VT_CACHE.get(key) ?? null;
    setLru(DECODED_VT_CACHE, key, val, MAX_VT_CACHE);
    return val;
  }
  const existing = VT_INFLIGHT.get(key);
  if (existing) return existing;

  const req = (async () => {
    try {
      const tpl = await resolveVectorTileTemplate();
      const url = tpl
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404 || res.status === 204) {
          setLru(DECODED_VT_CACHE, key, null, MAX_VT_CACHE);
        }
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        setLru(DECODED_VT_CACHE, key, null, MAX_VT_CACHE);
        return null;
      }
      const decoded = parseAndDecodeVectorTile(buf, z);
      setLru(DECODED_VT_CACHE, key, decoded, MAX_VT_CACHE);
      return decoded;
    } catch {
      return null;
    } finally {
      VT_INFLIGHT.delete(key);
    }
  })();

  VT_INFLIGHT.set(key, req);
  return req;
}

// Single shared 256x256 scratch canvas for decoding Terrarium DEM PNGs (zero DOM churn)
let demDecodeCanvas: HTMLCanvasElement | null = null;
let demDecodeCtx: CanvasRenderingContext2D | null = null;

function getDemDecodeCtx(): CanvasRenderingContext2D | null {
  if (!demDecodeCanvas && typeof document !== 'undefined') {
    demDecodeCanvas = document.createElement('canvas');
    demDecodeCanvas.width = 256;
    demDecodeCanvas.height = 256;
    demDecodeCtx = demDecodeCanvas.getContext('2d', { willReadFrequently: true });
  }
  return demDecodeCtx;
}

function loadTerrariumTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  if (DEM_CACHE.has(key)) {
    const val = DEM_CACHE.get(key) ?? null;
    setLru(DEM_CACHE, key, val, MAX_DEM_CACHE);
    return Promise.resolve(val);
  }
  const existing = DEM_INFLIGHT.get(key);
  if (existing) return existing;

  const req = new Promise<Float32Array | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const cCtx = getDemDecodeCtx();
        if (!cCtx) {
          resolve(null);
          return;
        }
        cCtx.drawImage(img, 0, 0, 256, 256);
        const rgba = cCtx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0; i < 256 * 256; i++) {
          const p = i << 2;
          const elev = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] * 0.00390625 - 32768;
          out[i] = elev < -11000 ? -11000 : elev > 9000 ? 9000 : elev;
        }
        setLru(DEM_CACHE, key, out, MAX_DEM_CACHE);
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = TERRARIUM_DEM_URL(z, x, y);
  }).finally(() => {
    DEM_INFLIGHT.delete(key);
  });

  DEM_INFLIGHT.set(key, req);
  return req;
}

function loadSatelliteTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const key = `${z}/${x}/${y}`;
  if (SAT_CACHE.has(key)) {
    const val = SAT_CACHE.get(key) ?? null;
    setLru(SAT_CACHE, key, val, MAX_SAT_CACHE);
    return Promise.resolve(val);
  }
  const existing = SAT_INFLIGHT.get(key);
  if (existing) return existing;

  const req = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      setLru(SAT_CACHE, key, img, MAX_SAT_CACHE);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = SENTINEL2_TILE_URL(z, x, y);
  }).finally(() => {
    SAT_INFLIGHT.delete(key);
  });

  SAT_INFLIGHT.set(key, req);
  return req;
}

// ---------------------------------------------------------------------------
// Exact Mapa v1.3.0 Style Palettes & Precomputed 1D Color Lookup Tables (LUTs)
// ---------------------------------------------------------------------------
type ColorStop = readonly [number, [number, number, number]];

const LUT_MAX_LAND_M = 8850;
const LUT_MIN_OCEAN_M = -8000;

function evalColorStops(elev: number, stops: readonly ColorStop[]): [number, number, number] {
  if (elev <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (elev >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (elev <= b[0]) {
      const u = Math.max(0, Math.min(1, (elev - a[0]) / (b[0] - a[0])));
      const s = u * u * (3 - 2 * u);
      const t = u * 0.35 + s * 0.65;
      return [
        a[1][0] + (b[1][0] - a[1][0]) * t,
        a[1][1] + (b[1][1] - a[1][1]) * t,
        a[1][2] + (b[1][2] - a[1][2]) * t,
      ];
    }
  }
  return last[1];
}

function buildLandLut(stops: readonly ColorStop[]): Uint8Array {
  const lut = new Uint8Array((LUT_MAX_LAND_M + 1) * 3);
  for (let m = 0; m <= LUT_MAX_LAND_M; m++) {
    const [r, g, b] = evalColorStops(m, stops);
    const idx = m * 3;
    lut[idx] = Math.round(r);
    lut[idx + 1] = Math.round(g);
    lut[idx + 2] = Math.round(b);
  }
  return lut;
}

function buildOceanLut(stops: readonly ColorStop[]): Uint8Array {
  const span = -LUT_MIN_OCEAN_M;
  const lut = new Uint8Array((span + 1) * 3);
  for (let d = LUT_MIN_OCEAN_M; d <= 0; d++) {
    const [r, g, b] = evalColorStops(d, stops);
    const idx = (d - LUT_MIN_OCEAN_M) * 3;
    lut[idx] = Math.round(r);
    lut[idx + 1] = Math.round(g);
    lut[idx + 2] = Math.round(b);
  }
  return lut;
}

interface StylePalette {
  isDark: boolean;
  isSatellite: boolean;
  bg: string;
  flatLandRgb: [number, number, number];
  flatOceanHex: string;
  oceanDetailHex: string;
  hillshadeStrength: number;
  landLut: Uint8Array;
  oceanLut: Uint8Array;
  forestFill: string;
  meadowFill: string;
  wetlandFill: string;
  rockFill: string;
  glacierFill: string;
  urbanFill: string;
  urbanStroke: string;
  buildingFill: string;
  buildingStroke: string;
  parkOutline: string;
  contourMinor: string;
  contourIndex: string;
  waterFill: string;
  waterStroke: string;
  waterLabel: string;
  waterLabelHalo: string;
  borderOuter: string;
  borderInner: string;
  regionBorder: string;
  districtBorder: string;
  railMain: string;
  railDash: string;
  gridStroke: string;
  gridText: string;
  textPrimary: string;
  textSecondary: string;
  textCountry: string;
  textHalo: string;
  cityDot: string;
  cityRing: string;
  peakColor: string;
}

const WORLD_LAND_ATLAS_STOPS: readonly ColorStop[] = [
  [0, [238, 242, 228]],
  [120, [241, 243, 231]],
  [280, [244, 243, 232]],
  [500, [243, 240, 228]],
  [800, [240, 236, 222]],
  [1200, [236, 231, 216]],
  [1750, [232, 226, 210]],
  [2400, [228, 221, 204]],
  [3200, [224, 217, 200]],
  [4200, [227, 221, 207]],
  [5400, [236, 233, 225]],
  [7000, [246, 246, 243]],
  [8849, [253, 254, 255]],
];

const WORLD_OCEAN_ATLAS_STOPS: readonly ColorStop[] = [
  [-8000, [104, 168, 224]],
  [-5500, [118, 180, 232]],
  [-3500, [134, 193, 239]],
  [-1800, [150, 206, 245]],
  [-600, [166, 217, 249]],
  [-120, [178, 225, 252]],
  [0, [188, 230, 254]],
];

const WORLD_LAND_NATURAL_STOPS: readonly ColorStop[] = [
  [0, [232, 239, 221]],
  [180, [237, 241, 226]],
  [450, [240, 239, 226]],
  [850, [237, 233, 218]],
  [1400, [232, 226, 210]],
  [2200, [226, 219, 202]],
  [3200, [221, 213, 196]],
  [4500, [226, 220, 208]],
  [6200, [242, 243, 244]],
  [8849, [252, 253, 255]],
];

const WORLD_OCEAN_NATURAL_STOPS: readonly ColorStop[] = [
  [-8000, [94, 156, 212]],
  [-4500, [116, 176, 226]],
  [-1800, [140, 196, 238]],
  [-300, [160, 210, 246]],
  [0, [174, 219, 249]],
];

const WORLD_LAND_LIGHT_STOPS: readonly ColorStop[] = [
  [0, [241, 246, 234]],
  [300, [248, 247, 239]],
  [850, [245, 239, 227]],
  [1700, [237, 227, 210]],
  [3000, [227, 214, 196]],
  [5200, [238, 234, 228]],
  [8849, [250, 250, 248]],
];

const WORLD_OCEAN_LIGHT_STOPS: readonly ColorStop[] = [
  [-7000, [180, 212, 238]],
  [-1500, [198, 224, 244]],
  [0, [216, 235, 249]],
];

const WORLD_LAND_DARK_STOPS: readonly ColorStop[] = [
  [0, [24, 35, 42]],
  [350, [31, 42, 49]],
  [900, [40, 51, 58]],
  [1800, [52, 62, 69]],
  [3200, [68, 77, 85]],
  [5500, [92, 102, 112]],
  [8849, [132, 142, 152]],
];

const WORLD_OCEAN_DARK_STOPS: readonly ColorStop[] = [
  [-7000, [11, 20, 32]],
  [-2000, [16, 29, 44]],
  [0, [22, 38, 56]],
];

const DARK_LAND_LUT = buildLandLut(WORLD_LAND_DARK_STOPS);
const DARK_OCEAN_LUT = buildOceanLut(WORLD_OCEAN_DARK_STOPS);

const STYLE_PALETTES: Record<MapaStylePreset, StylePalette> = {
  atlas: {
    isDark: false,
    isSatellite: false,
    bg: '#F3F2E9',
    flatLandRgb: [244, 243, 234],
    flatOceanHex: '#A6D5F7',
    oceanDetailHex: '#A8D6F5',
    hillshadeStrength: 0.27,
    landLut: buildLandLut(WORLD_LAND_ATLAS_STOPS),
    oceanLut: buildOceanLut(WORLD_OCEAN_ATLAS_STOPS),
    forestFill: 'rgba(188, 220, 158, 0.64)',
    meadowFill: 'rgba(218, 232, 192, 0.44)',
    wetlandFill: 'rgba(166, 212, 198, 0.42)',
    rockFill: 'rgba(208, 204, 196, 0.45)',
    glacierFill: 'rgba(244, 249, 252, 0.85)',
    urbanFill: 'rgba(232, 224, 212, 0.56)',
    urbanStroke: 'rgba(212, 202, 188, 0.42)',
    buildingFill: 'rgba(218, 208, 198, 0.78)',
    buildingStroke: 'rgba(186, 174, 164, 0.62)',
    parkOutline: 'rgba(72, 146, 86, 0.45)',
    contourMinor: 'rgba(164, 146, 122, 0.24)',
    contourIndex: 'rgba(138, 116, 90, 0.44)',
    waterFill: '#8EC0E8',
    waterStroke: '#66A2D4',
    waterLabel: '#2B6CA3',
    waterLabelHalo: 'rgba(255, 255, 255, 0.85)',
    borderOuter: 'rgba(116, 120, 114, 0.34)',
    borderInner: 'rgba(34, 38, 34, 0.92)',
    regionBorder: 'rgba(84, 88, 84, 0.42)',
    districtBorder: 'rgba(104, 92, 126, 0.48)',
    railMain: '#6B7075',
    railDash: '#FFFFFF',
    gridStroke: 'rgba(60, 72, 68, 0.16)',
    gridText: 'rgba(60, 72, 68, 0.68)',
    textPrimary: '#1F2421',
    textSecondary: '#4A544E',
    textCountry: '#5C645E',
    textHalo: 'rgba(255, 255, 255, 0.95)',
    cityDot: '#7A5A3C',
    cityRing: '#F5A65B',
    peakColor: '#3A332C',
  },
  natural: {
    isDark: false,
    isSatellite: false,
    bg: '#F0EFE5',
    flatLandRgb: [241, 240, 231],
    flatOceanHex: '#94C6EC',
    oceanDetailHex: '#9CCAEF',
    hillshadeStrength: 0.34,
    landLut: buildLandLut(WORLD_LAND_NATURAL_STOPS),
    oceanLut: buildOceanLut(WORLD_OCEAN_NATURAL_STOPS),
    forestFill: 'rgba(176, 212, 146, 0.70)',
    meadowFill: 'rgba(212, 229, 182, 0.48)',
    wetlandFill: 'rgba(154, 206, 190, 0.46)',
    rockFill: 'rgba(202, 198, 188, 0.48)',
    glacierFill: 'rgba(244, 249, 252, 0.88)',
    urbanFill: 'rgba(228, 220, 208, 0.56)',
    urbanStroke: 'rgba(204, 194, 180, 0.44)',
    buildingFill: 'rgba(212, 202, 190, 0.78)',
    buildingStroke: 'rgba(180, 168, 156, 0.64)',
    parkOutline: 'rgba(58, 134, 72, 0.52)',
    contourMinor: 'rgba(154, 134, 108, 0.25)',
    contourIndex: 'rgba(128, 104, 78, 0.46)',
    waterFill: '#86B8E2',
    waterStroke: '#5E9ACC',
    waterLabel: '#256298',
    waterLabelHalo: 'rgba(255, 255, 255, 0.85)',
    borderOuter: 'rgba(110, 114, 108, 0.34)',
    borderInner: 'rgba(30, 34, 30, 0.92)',
    regionBorder: 'rgba(80, 84, 80, 0.42)',
    districtBorder: 'rgba(98, 86, 118, 0.48)',
    railMain: '#63686D',
    railDash: '#FFFFFF',
    gridStroke: 'rgba(48, 60, 54, 0.16)',
    gridText: 'rgba(48, 60, 54, 0.68)',
    textPrimary: '#1D221F',
    textSecondary: '#455049',
    textCountry: '#525C55',
    textHalo: 'rgba(255, 255, 255, 0.94)',
    cityDot: '#755638',
    cityRing: '#F2A052',
    peakColor: '#322B24',
  },
  light: {
    isDark: false,
    isSatellite: false,
    bg: '#F8F7F2',
    flatLandRgb: [246, 245, 240],
    flatOceanHex: '#CCE2F4',
    oceanDetailHex: '#C6DFF4',
    hillshadeStrength: 0.21,
    landLut: buildLandLut(WORLD_LAND_LIGHT_STOPS),
    oceanLut: buildOceanLut(WORLD_OCEAN_LIGHT_STOPS),
    forestFill: 'rgba(200, 226, 174, 0.52)',
    meadowFill: 'rgba(226, 238, 208, 0.34)',
    wetlandFill: 'rgba(182, 220, 210, 0.36)',
    rockFill: 'rgba(218, 214, 208, 0.36)',
    glacierFill: 'rgba(248, 251, 254, 0.85)',
    urbanFill: 'rgba(236, 230, 222, 0.48)',
    urbanStroke: 'rgba(218, 210, 200, 0.38)',
    buildingFill: 'rgba(224, 218, 210, 0.72)',
    buildingStroke: 'rgba(196, 188, 180, 0.56)',
    parkOutline: 'rgba(84, 152, 96, 0.38)',
    contourMinor: 'rgba(168, 152, 132, 0.18)',
    contourIndex: 'rgba(142, 124, 102, 0.36)',
    waterFill: '#A4CEF0',
    waterStroke: '#78B0DE',
    waterLabel: '#3675AC',
    waterLabelHalo: 'rgba(255, 255, 255, 0.90)',
    borderOuter: 'rgba(124, 128, 122, 0.30)',
    borderInner: 'rgba(42, 46, 42, 0.88)',
    regionBorder: 'rgba(92, 96, 92, 0.36)',
    districtBorder: 'rgba(116, 104, 138, 0.42)',
    railMain: '#7A8085',
    railDash: '#FFFFFF',
    gridStroke: 'rgba(40, 52, 48, 0.13)',
    gridText: 'rgba(72, 82, 78, 0.62)',
    textPrimary: '#222725',
    textSecondary: '#58625D',
    textCountry: '#66706B',
    textHalo: 'rgba(255, 255, 255, 0.96)',
    cityDot: '#7D5E40',
    cityRing: '#F6AC66',
    peakColor: '#423B35',
  },
  dark: {
    isDark: true,
    isSatellite: false,
    bg: '#161D24',
    flatLandRgb: [34, 44, 52],
    flatOceanHex: '#101A26',
    oceanDetailHex: '#152538',
    hillshadeStrength: 0.32,
    landLut: DARK_LAND_LUT,
    oceanLut: DARK_OCEAN_LUT,
    forestFill: 'rgba(42, 78, 54, 0.56)',
    meadowFill: 'rgba(46, 68, 52, 0.34)',
    wetlandFill: 'rgba(34, 78, 76, 0.44)',
    rockFill: 'rgba(82, 88, 96, 0.36)',
    glacierFill: 'rgba(182, 202, 218, 0.45)',
    urbanFill: 'rgba(66, 76, 88, 0.52)',
    urbanStroke: 'rgba(92, 104, 118, 0.42)',
    buildingFill: 'rgba(82, 94, 108, 0.72)',
    buildingStroke: 'rgba(112, 126, 142, 0.55)',
    parkOutline: 'rgba(86, 178, 112, 0.48)',
    contourMinor: 'rgba(186, 174, 154, 0.14)',
    contourIndex: 'rgba(208, 194, 170, 0.28)',
    waterFill: '#1D4468',
    waterStroke: '#4686BC',
    waterLabel: '#8CC4F0',
    waterLabelHalo: 'rgba(16, 24, 34, 0.88)',
    borderOuter: 'rgba(10, 14, 18, 0.65)',
    borderInner: 'rgba(218, 224, 232, 0.84)',
    regionBorder: 'rgba(164, 178, 192, 0.36)',
    districtBorder: 'rgba(174, 152, 214, 0.45)',
    railMain: '#8A96A4',
    railDash: '#1E2730',
    gridStroke: 'rgba(220, 232, 244, 0.14)',
    gridText: 'rgba(204, 218, 232, 0.68)',
    textPrimary: '#F1F5F9',
    textSecondary: '#CBD5E1',
    textCountry: '#94A3B8',
    textHalo: 'rgba(16, 23, 30, 0.92)',
    cityDot: '#9A6B3E',
    cityRing: '#E09248',
    peakColor: '#E2E8F0',
  },
  satellite: {
    isDark: true,
    isSatellite: true,
    bg: '#0C1726',
    flatLandRgb: [30, 44, 36],
    flatOceanHex: '#0F243A',
    oceanDetailHex: '#102A44',
    hillshadeStrength: 0.24,
    landLut: DARK_LAND_LUT,
    oceanLut: DARK_OCEAN_LUT,
    forestFill: 'rgba(46, 86, 58, 0.0)',
    meadowFill: 'rgba(0, 0, 0, 0.0)',
    wetlandFill: 'rgba(56, 148, 136, 0.16)',
    rockFill: 'rgba(0, 0, 0, 0.0)',
    glacierFill: 'rgba(255, 255, 255, 0.10)',
    urbanFill: 'rgba(0, 0, 0, 0.0)',
    urbanStroke: 'rgba(255, 255, 255, 0.15)',
    buildingFill: 'rgba(255, 255, 255, 0.14)',
    buildingStroke: 'rgba(255, 255, 255, 0.32)',
    parkOutline: 'rgba(134, 239, 172, 0.62)',
    contourMinor: 'rgba(255, 244, 214, 0.22)',
    contourIndex: 'rgba(255, 236, 188, 0.44)',
    waterFill: 'rgba(56, 146, 212, 0.28)',
    waterStroke: 'rgba(126, 206, 255, 0.68)',
    waterLabel: '#BAE6FD',
    waterLabelHalo: 'rgba(10, 16, 26, 0.90)',
    borderOuter: 'rgba(0, 0, 0, 0.60)',
    borderInner: 'rgba(255, 246, 206, 0.92)',
    regionBorder: 'rgba(255, 255, 255, 0.46)',
    districtBorder: 'rgba(253, 224, 71, 0.56)',
    railMain: '#CBD5E1',
    railDash: '#0F172A',
    gridStroke: 'rgba(255, 255, 255, 0.20)',
    gridText: 'rgba(241, 245, 249, 0.84)',
    textPrimary: '#FFFFFF',
    textSecondary: '#E2E8F0',
    textCountry: '#F8FAFC',
    textHalo: 'rgba(10, 16, 26, 0.92)',
    cityDot: '#B45309',
    cityRing: '#FBBF24',
    peakColor: '#F8FAFC',
  },
};

// ---------------------------------------------------------------------------
// Fast DEM Sampling, LUT Hypsometry & Analytical Hillshade
// ---------------------------------------------------------------------------
const SUN_ALT = (42 * Math.PI) / 180;
const SUN_AZ = (315 * Math.PI) / 180;
const SIN_ALT = Math.sin(SUN_ALT);
const COS_ALT_COS_AZ = Math.cos(SUN_ALT) * Math.cos(SUN_AZ);
const COS_ALT_SIN_AZ = Math.cos(SUN_ALT) * Math.sin(SUN_AZ);

// Shared reusable scratch canvas for DEM grid blitting (avoids per-tile DOM allocations)
let gridScratchCanvas: HTMLCanvasElement | null = null;
let gridScratchCtx: CanvasRenderingContext2D | null = null;
let gridScratchImgData: ImageData | null = null;
let gridScratchSize = 0;

function getGridScratch(gridSize: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imgData: ImageData;
} | null {
  if (typeof document === 'undefined') return null;
  if (!gridScratchCanvas) {
    gridScratchCanvas = document.createElement('canvas');
    gridScratchCtx = gridScratchCanvas.getContext('2d');
  }
  if (!gridScratchCtx) return null;
  if (gridScratchSize !== gridSize || !gridScratchImgData) {
    gridScratchCanvas.width = gridSize;
    gridScratchCanvas.height = gridSize;
    gridScratchImgData = gridScratchCtx.createImageData(gridSize, gridSize);
    gridScratchSize = gridSize;
  }
  return {
    canvas: gridScratchCanvas,
    ctx: gridScratchCtx,
    imgData: gridScratchImgData,
  };
}

function sampleDemSubGrid(
  dem: Float32Array,
  demZ: number,
  demX: number,
  demY: number,
  z: number,
  tx: number,
  ty: number,
  gridSize: number
): Float32Array {
  const out = new Float32Array(gridSize * gridSize);
  const scale = 1 << (z - demZ);
  const subX0 = (tx - demX * scale) / scale;
  const subY0 = (ty - demY * scale) / scale;
  const invGridM1 = 1 / ((gridSize - 1) * scale);

  for (let r = 0; r < gridSize; r++) {
    const v = subY0 + r * invGridM1;
    const fy = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
    const y0 = fy | 0;
    const y1 = y0 < 255 ? y0 + 1 : 255;
    const wy = fy - y0;
    const row0 = y0 << 8;
    const row1 = y1 << 8;
    const rOffset = r * gridSize;

    for (let c = 0; c < gridSize; c++) {
      const u = subX0 + c * invGridM1;
      const fx = u <= 0 ? 0 : u >= 1 ? 255 : u * 255;
      const x0 = fx | 0;
      const x1 = x0 < 255 ? x0 + 1 : 255;
      const wx = fx - x0;

      const e00 = dem[row0 + x0];
      const e10 = dem[row0 + x1];
      const e01 = dem[row1 + x0];
      const e11 = dem[row1 + x1];
      const top = e00 + (e10 - e00) * wx;
      const bot = e01 + (e11 - e01) * wx;
      out[rOffset + c] = top + (bot - top) * wy;
    }
  }
  return out;
}

function paintHypsometryAndHillshade(
  ctx: CanvasRenderingContext2D,
  elevGrid: Float32Array,
  gridSize: number,
  z: number,
  ty: number,
  pal: StylePalette,
  enableHypsometry: boolean,
  enableHillshade: boolean
) {
  const scratch = getGridScratch(gridSize);
  if (!scratch) return;

  const data = scratch.imgData.data;
  const landLut = pal.landLut;
  const flatR = pal.flatLandRgb[0];
  const flatG = pal.flatLandRgb[1];
  const flatB = pal.flatLandRgb[2];

  const n = 1 << z;
  const mercY = Math.PI * (1 - (2 * (ty + 0.5)) / n);
  const latRad = Math.atan(Math.sinh(mercY));
  const tileMeters = (40075016.686 * Math.max(0.2, Math.cos(latRad))) / n;
  const cellMeters = tileMeters / Math.max(1, gridSize - 1);
  const zExag = z >= 12 ? 1.55 : z >= 9 ? 2.1 : 2.8;
  const gradFactor = zExag / (2 * cellMeters);
  const shadeMult = pal.hillshadeStrength * 1.6;

  for (let r = 0; r < gridSize; r++) {
    const rUp = (r > 0 ? r - 1 : 0) * gridSize;
    const rDn = (r < gridSize - 1 ? r + 1 : gridSize - 1) * gridSize;
    const rCur = r * gridSize;

    for (let c = 0; c < gridSize; c++) {
      const idx = rCur + c;
      const rawElev = elevGrid[idx];
      const landElev = rawElev > 0 ? rawElev : 0;

      let baseR: number;
      let baseG: number;
      let baseB: number;
      if (enableHypsometry) {
        const lutIdx =
          (landElev >= LUT_MAX_LAND_M ? LUT_MAX_LAND_M : (landElev + 0.5) | 0) * 3;
        baseR = landLut[lutIdx];
        baseG = landLut[lutIdx + 1];
        baseB = landLut[lutIdx + 2];
      } else {
        baseR = flatR;
        baseG = flatG;
        baseB = flatB;
      }

      let shadeFactor = 1;
      if (enableHillshade && landElev > 0.5) {
        const cLt = c > 0 ? c - 1 : 0;
        const cRt = c < gridSize - 1 ? c + 1 : gridSize - 1;
        const eLt = elevGrid[rCur + cLt] > 0 ? elevGrid[rCur + cLt] : 0;
        const eRt = elevGrid[rCur + cRt] > 0 ? elevGrid[rCur + cRt] : 0;
        const eUp = elevGrid[rUp + c] > 0 ? elevGrid[rUp + c] : 0;
        const eDn = elevGrid[rDn + c] > 0 ? elevGrid[rDn + c] : 0;

        const dzdx = (eRt - eLt) * gradFactor;
        const dzdy = (eDn - eUp) * gradFactor;
        // Analytical normal dot product (replaces atan + atan2 + 3 sin/cos calls)
        const hs =
          (SIN_ALT - dzdx * COS_ALT_COS_AZ - dzdy * COS_ALT_SIN_AZ) /
          Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
        shadeFactor = 1 + (hs - 0.67) * shadeMult;
      }

      const p = idx << 2;
      const rOut = (baseR * shadeFactor + 0.5) | 0;
      const gOut = (baseG * shadeFactor + 0.5) | 0;
      const bOut = (baseB * shadeFactor + 0.5) | 0;
      data[p] = rOut < 0 ? 0 : rOut > 255 ? 255 : rOut;
      data[p + 1] = gOut < 0 ? 0 : gOut > 255 ? 255 : gOut;
      data[p + 2] = bOut < 0 ? 0 : bOut > 255 ? 255 : bOut;
      data[p + 3] = 255;
    }
  }

  scratch.ctx.putImageData(scratch.imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch.canvas, 0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
}

function paintSatelliteHillshadeOverlay(
  ctx: CanvasRenderingContext2D,
  elevGrid: Float32Array,
  gridSize: number,
  z: number,
  ty: number
) {
  const scratch = getGridScratch(gridSize);
  if (!scratch) return;

  const data = scratch.imgData.data;
  const n = 1 << z;
  const mercY = Math.PI * (1 - (2 * (ty + 0.5)) / n);
  const latRad = Math.atan(Math.sinh(mercY));
  const tileMeters = (40075016.686 * Math.max(0.2, Math.cos(latRad))) / n;
  const cellMeters = tileMeters / Math.max(1, gridSize - 1);
  const zExag = z >= 12 ? 1.5 : 2.0;
  const gradFactor = zExag / (2 * cellMeters);

  for (let r = 0; r < gridSize; r++) {
    const rUp = (r > 0 ? r - 1 : 0) * gridSize;
    const rDn = (r < gridSize - 1 ? r + 1 : gridSize - 1) * gridSize;
    const rCur = r * gridSize;

    for (let c = 0; c < gridSize; c++) {
      const idx = rCur + c;
      const landElev = elevGrid[idx] > 0 ? elevGrid[idx] : 0;
      const p = idx << 2;
      if (landElev <= 1) {
        data[p + 3] = 0;
        continue;
      }
      const cLt = c > 0 ? c - 1 : 0;
      const cRt = c < gridSize - 1 ? c + 1 : gridSize - 1;
      const eLt = elevGrid[rCur + cLt] > 0 ? elevGrid[rCur + cLt] : 0;
      const eRt = elevGrid[rCur + cRt] > 0 ? elevGrid[rCur + cRt] : 0;
      const eUp = elevGrid[rUp + c] > 0 ? elevGrid[rUp + c] : 0;
      const eDn = elevGrid[rDn + c] > 0 ? elevGrid[rDn + c] : 0;

      const dzdx = (eRt - eLt) * gradFactor;
      const dzdy = (eDn - eUp) * gradFactor;
      const hs =
        (SIN_ALT - dzdx * COS_ALT_COS_AZ - dzdy * COS_ALT_SIN_AZ) /
        Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy);
      const delta = hs - 0.67;
      if (delta >= 0) {
        data[p] = 255;
        data[p + 1] = 252;
        data[p + 2] = 240;
        const a = (delta * 165) | 0;
        data[p + 3] = a > 72 ? 72 : a;
      } else {
        data[p] = 8;
        data[p + 1] = 14;
        data[p + 2] = 24;
        const a = (-delta * 195) | 0;
        data[p + 3] = a > 96 ? 96 : a;
      }
    }
  }

  scratch.ctx.putImageData(scratch.imgData, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch.canvas, 0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
  ctx.restore();
}

function paintClippedOceanBathymetry(
  ctx: CanvasRenderingContext2D,
  elevGrid: Float32Array,
  gridSize: number,
  pal: StylePalette
) {
  const scratch = getGridScratch(gridSize);
  if (!scratch) return;

  const data = scratch.imgData.data;
  const oceanLut = pal.oceanLut;
  const count = gridSize * gridSize;

  for (let i = 0; i < count; i++) {
    const raw = elevGrid[i];
    const depth = raw >= 0 ? 0 : raw <= LUT_MIN_OCEAN_M ? LUT_MIN_OCEAN_M : raw | 0;
    const lutIdx = (depth - LUT_MIN_OCEAN_M) * 3;
    const p = i << 2;
    data[p] = oceanLut[lutIdx];
    data[p + 1] = oceanLut[lutIdx + 1];
    data[p + 2] = oceanLut[lutIdx + 2];
    data[p + 3] = 255;
  }

  scratch.ctx.putImageData(scratch.imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch.canvas, 0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
}

/**
 * Single-pass zero-allocation Marching Squares contour generator.
 */
function paintContoursFromGrid(
  ctx: CanvasRenderingContext2D,
  elevGrid: Float32Array,
  gridSize: number,
  z: number,
  pal: StylePalette
) {
  if (z < 8) return;

  const stepM = z >= 15 ? 10 : z >= 13 ? 20 : z >= 11 ? 50 : z >= 9 ? 100 : 200;
  const majorStepM = stepM * 5;

  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < elevGrid.length; i++) {
    const e = elevGrid[i];
    if (e > 5 && e < minE) minE = e;
    if (e > maxE) maxE = e;
  }
  if (!isFinite(minE) || maxE <= 5) return;

  // Check if at least one contour level falls within [minE, maxE]
  const firstTileLevel = Math.max(stepM, Math.ceil(minE / stepM) * stepM);
  if (firstTileLevel > maxE) return;

  const pxStep = TILE_LOGICAL_PX / (gridSize - 1);
  const minorPath = new Path2D();
  const majorPath = new Path2D();
  let hasMinor = false;
  let hasMajor = false;

  for (let r = 0; r < gridSize - 1; r++) {
    const y0 = r * pxStep;
    const y1 = (r + 1) * pxStep;
    const row0 = r * gridSize;
    const row1 = (r + 1) * gridSize;

    for (let c = 0; c < gridSize - 1; c++) {
      const v0 = elevGrid[row0 + c];
      const v1 = elevGrid[row0 + c + 1];
      const v2 = elevGrid[row1 + c + 1];
      const v3 = elevGrid[row1 + c];

      const cMin = Math.min(v0, v1, v2, v3);
      const cMax = Math.max(v0, v1, v2, v3);
      if (cMax <= 5 || cMax - cMin < 1e-4) continue;

      const startLevel = Math.max(stepM, Math.ceil(cMin / stepM) * stepM);
      if (startLevel > cMax) continue;

      const x0 = c * pxStep;
      const x1 = (c + 1) * pxStep;

      for (let level = startLevel; level <= cMax; level += stepM) {
        const b0 = v0 >= level ? 1 : 0;
        const b1 = v1 >= level ? 2 : 0;
        const b2 = v2 >= level ? 4 : 0;
        const b3 = v3 >= level ? 8 : 0;
        const mask = b0 | b1 | b2 | b3;
        if (mask === 0 || mask === 15) continue;

        let ptCount = 0;
        let xA = 0,
          yA = 0,
          xB = 0,
          yB = 0,
          xC = 0,
          yC = 0,
          xD = 0,
          yD = 0;

        if (b0 !== b1 >> 1) {
          const t = (level - v0) / (v1 - v0 || 1e-6);
          xA = x0 + t * pxStep;
          yA = y0;
          ptCount = 1;
        }
        if (b1 >> 1 !== b2 >> 2) {
          const t = (level - v1) / (v2 - v1 || 1e-6);
          if (ptCount === 0) {
            xA = x1;
            yA = y0 + t * pxStep;
            ptCount = 1;
          } else {
            xB = x1;
            yB = y0 + t * pxStep;
            ptCount = 2;
          }
        }
        if (b2 >> 2 !== b3 >> 3) {
          const t = (level - v3) / (v2 - v3 || 1e-6);
          const px = x0 + t * pxStep;
          if (ptCount === 0) {
            xA = px;
            yA = y1;
            ptCount = 1;
          } else if (ptCount === 1) {
            xB = px;
            yB = y1;
            ptCount = 2;
          } else {
            xC = px;
            yC = y1;
            ptCount = 3;
          }
        }
        if (b3 >> 3 !== b0) {
          const t = (level - v0) / (v3 - v0 || 1e-6);
          const py = y0 + t * pxStep;
          if (ptCount === 1) {
            xB = x0;
            yB = py;
            ptCount = 2;
          } else if (ptCount === 3) {
            xD = x0;
            yD = py;
            ptCount = 4;
          }
        }

        if (ptCount >= 2) {
          const isMajor = level % majorStepM === 0;
          const targetPath = isMajor ? majorPath : minorPath;
          if (isMajor) hasMajor = true;
          else hasMinor = true;

          targetPath.moveTo(xA, yA);
          targetPath.lineTo(xB, yB);
          if (ptCount === 4) {
            targetPath.moveTo(xC, yC);
            targetPath.lineTo(xD, yD);
          }
        }
      }
    }
  }

  ctx.lineCap = 'round';
  if (hasMinor) {
    ctx.strokeStyle = pal.contourMinor;
    ctx.lineWidth = 0.45;
    ctx.stroke(minorPath);
  }
  if (hasMajor) {
    ctx.strokeStyle = pal.contourIndex;
    ctx.lineWidth = 0.85;
    ctx.stroke(majorPath);
  }
}

// ---------------------------------------------------------------------------
// WGS84 Graticule Overlay (Zeměpisná síť WGS84)
// ---------------------------------------------------------------------------
function tileYToLat(yNorm: number): number {
  const merc = Math.PI * (1 - 2 * yNorm);
  return (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
}

function latToTileYNorm(latDeg: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, latDeg));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function formatWgsCoord(val: number, posHem: string, negHem: string, stepDeg: number): string {
  const hem = val >= 0 ? posHem : negHem;
  const abs = Math.abs(val);
  const deg = Math.floor(abs + 1e-6);
  const min = Math.round((abs - deg) * 60);
  if (stepDeg >= 1 || min === 0) return `${deg}°${hem}`;
  return `${deg}°${String(min).padStart(2, '0')}'${hem}`;
}

function paintWgs84Graticule(
  ctx: CanvasRenderingContext2D,
  z: number,
  tx: number,
  ty: number,
  pal: StylePalette
) {
  const n = 1 << z;
  const minLon = (tx / n) * 360 - 180;
  const maxLon = ((tx + 1) / n) * 360 - 180;
  const maxLat = tileYToLat(ty / n);
  const minLat = tileYToLat((ty + 1) / n);

  const stepDeg =
    z >= 14 ? 1 / 60 :
    z >= 12 ? 5 / 60 :
    z >= 10 ? 15 / 60 :
    z >= 8 ? 0.5 :
    z >= 6 ? 2 :
    z >= 4 ? 5 : 15;

  const lonSpan = maxLon - minLon;
  const yTopNorm = ty / n;
  const ySpanNorm = 1 / n;

  ctx.save();
  ctx.strokeStyle = pal.gridStroke;
  ctx.lineWidth = 0.65;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();

  const lonLabels: { x: number; text: string }[] = [];
  const firstLon = Math.ceil(minLon / stepDeg) * stepDeg;
  for (let lon = firstLon; lon <= maxLon + 1e-6; lon += stepDeg) {
    const x = ((lon - minLon) / lonSpan) * TILE_LOGICAL_PX;
    if (x < 0.5 || x > TILE_LOGICAL_PX - 0.5) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TILE_LOGICAL_PX);
    if (x > 26 && x < TILE_LOGICAL_PX - 26) {
      lonLabels.push({ x, text: formatWgsCoord(lon, 'E', 'W', stepDeg) });
    }
  }

  const latLabels: { y: number; text: string }[] = [];
  const firstLat = Math.ceil(minLat / stepDeg) * stepDeg;
  for (let lat = firstLat; lat <= maxLat + 1e-6; lat += stepDeg) {
    const yNorm = latToTileYNorm(lat);
    const y = ((yNorm - yTopNorm) / ySpanNorm) * TILE_LOGICAL_PX;
    if (y < 0.5 || y > TILE_LOGICAL_PX - 0.5) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(TILE_LOGICAL_PX, y);
    if (y > 16 && y < TILE_LOGICAL_PX - 16) {
      latLabels.push({ y, text: formatWgsCoord(lat, 'N', 'S', stepDeg) });
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (lonLabels.length > 0 || latLabels.length > 0) {
    ctx.font = '500 7.5px Inter, system-ui, sans-serif';
    ctx.fillStyle = pal.gridText;
    ctx.strokeStyle = pal.textHalo;
    ctx.lineWidth = 2;

    if (lonLabels.length > 0 && ((ty + tx) % 2 === 0 || z >= 10)) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lbl = lonLabels[0];
      ctx.strokeText(lbl.text, lbl.x, 4);
      ctx.fillText(lbl.text, lbl.x, 4);
    }

    if (latLabels.length > 0 && ((ty + tx) % 2 === 0 || z >= 10)) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lbl = latLabels[0];
      ctx.strokeText(lbl.text, 5, lbl.y - 5);
      ctx.fillText(lbl.text, 5, lbl.y - 5);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fast Vector Drawing Helpers with O(1) Sub-Tile Bounding Box Culling
// ---------------------------------------------------------------------------
interface TileTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  vMinX: number;
  vMinY: number;
  vMaxX: number;
  vMaxY: number;
}

function makeTileTransform(tileScale: number, offsetX: number, offsetY: number): TileTransform {
  const scale = (TILE_LOGICAL_PX * tileScale) / 4096;
  const invScale = 1 / scale;
  const pad = 16 * invScale;
  return {
    scale,
    offsetX,
    offsetY,
    vMinX: offsetX * invScale - pad,
    vMinY: offsetY * invScale - pad,
    vMaxX: (offsetX + TILE_LOGICAL_PX) * invScale + pad,
    vMaxY: (offsetY + TILE_LOGICAL_PX) * invScale + pad,
  };
}

function traceRing(
  ctx: CanvasRenderingContext2D,
  ring: Pt[],
  xf: TileTransform,
  close: boolean
): boolean {
  if (ring.length < 2) return false;
  const { scale, offsetX, offsetY } = xf;
  let prevU = ring[0].x * scale - offsetX;
  let prevV = ring[0].y * scale - offsetY;
  ctx.moveTo(prevU, prevV);

  const lastIdx = ring.length - 1;
  for (let i = 1; i <= lastIdx; i++) {
    const u = ring[i].x * scale - offsetX;
    const v = ring[i].y * scale - offsetY;
    if (i < lastIdx && Math.abs(u - prevU) < 0.2 && Math.abs(v - prevV) < 0.2) {
      continue;
    }
    ctx.lineTo(u, v);
    prevU = u;
    prevV = v;
  }
  if (close) ctx.closePath();
  return true;
}

function paintDecodedPolygons(
  ctx: CanvasRenderingContext2D,
  features: DecodedGeomFeature[],
  xf: TileTransform,
  doFill: boolean,
  doStroke: boolean
) {
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (f.maxX < xf.vMinX || f.minX > xf.vMaxX || f.maxY < xf.vMinY || f.minY > xf.vMaxY) {
      continue;
    }
    ctx.beginPath();
    let any = false;
    for (let r = 0; r < f.rings.length; r++) {
      if (traceRing(ctx, f.rings[r], xf, true)) any = true;
    }
    if (!any) continue;
    if (doFill) ctx.fill('evenodd');
    if (doStroke) ctx.stroke();
  }
}

function traceDecodedLines(
  ctx: CanvasRenderingContext2D,
  features: DecodedGeomFeature[],
  xf: TileTransform
): boolean {
  let any = false;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (f.maxX < xf.vMinX || f.minX > xf.vMaxX || f.maxY < xf.vMinY || f.minY > xf.vMaxY) {
      continue;
    }
    for (let r = 0; r < f.rings.length; r++) {
      if (traceRing(ctx, f.rings[r], xf, false)) any = true;
    }
  }
  return any;
}

interface RoadStyle {
  minZ: number;
  casing: string;
  core: string;
  casingW: number;
  coreW: number;
  dash?: number[];
}

function getRoadStyles(z: number, isDark: boolean): Record<RoadClass, RoadStyle> {
  const s =
    z >= 15 ? 0.92 : z >= 14 ? 0.78 : z >= 13 ? 0.66 : z >= 12 ? 0.56 : z >= 10 ? 0.48 : 0.42;

  if (isDark) {
    return {
      ferry: { minZ: 8, casing: '#64A8E0', core: '', casingW: 0.6, coreW: 0, dash: [4, 4] },
      path: { minZ: 12, casing: 'rgba(214, 204, 186, 0.52)', core: '', casingW: 0.75 * s, coreW: 0, dash: [2.4, 2.2] },
      track: { minZ: 11, casing: 'rgba(206, 196, 178, 0.62)', core: '', casingW: 0.9 * s, coreW: 0, dash: [4.2, 2.4] },
      service: { minZ: 13, casing: 'rgba(12, 18, 26, 0.75)', core: 'rgba(182, 192, 204, 0.72)', casingW: 1.5 * s, coreW: 0.85 * s },
      minor: { minZ: 11, casing: 'rgba(12, 18, 26, 0.8)', core: 'rgba(208, 216, 224, 0.82)', casingW: 1.9 * s, coreW: 1.15 * s },
      tertiary: {
        minZ: 10,
        casing: 'rgba(18, 24, 30, 0.85)',
        core: '#E8CC68',
        casingW: 2.2 * s,
        coreW: 1.25 * s,
      },
      secondary: {
        minZ: 8,
        casing: 'rgba(18, 24, 30, 0.88)',
        core: '#F2B84B',
        casingW: 2.55 * s,
        coreW: 1.5 * s,
      },
      primary: {
        minZ: 7,
        casing: 'rgba(18, 24, 30, 0.9)',
        core: '#F59E2D',
        casingW: 2.9 * s,
        coreW: 1.75 * s,
      },
      trunk: {
        minZ: 6,
        casing: 'rgba(18, 52, 24, 0.92)',
        core: '#5CC464',
        casingW: 3.4 * s,
        coreW: 2.0 * s,
      },
      motorway: {
        minZ: 5,
        casing: 'rgba(16, 48, 22, 0.95)',
        core: '#52C45A',
        casingW: 3.9 * s,
        coreW: 2.3 * s,
      },
    };
  }

  return {
    ferry: { minZ: 8, casing: '#5A9AD2', core: '', casingW: 0.55, coreW: 0, dash: [4, 4] },
    path: { minZ: 12, casing: '#8F8272', core: '', casingW: 0.75 * s, coreW: 0, dash: [2.4, 2.2] },
    track: { minZ: 11, casing: '#8E8476', core: '', casingW: 0.9 * s, coreW: 0, dash: [4.2, 2.4] },
    service: { minZ: 13, casing: '#C6BEB0', core: '#FCFBF8', casingW: 1.5 * s, coreW: 0.85 * s },
    minor: { minZ: 11, casing: '#BEB5A4', core: '#FEFDFA', casingW: 1.9 * s, coreW: 1.15 * s },
    tertiary: {
      minZ: 10,
      casing: z <= 11 ? '#DEB95C' : '#C6A04A',
      core: z <= 11 ? '' : '#FCE38C',
      casingW: (z <= 11 ? 1.15 : 2.25) * s,
      coreW: z <= 11 ? 0 : 1.35 * s,
    },
    secondary: {
      minZ: 8,
      casing: z <= 9 ? '#EAB03C' : '#CA8E28',
      core: z <= 9 ? '' : '#F9C454',
      casingW: (z <= 9 ? 1.25 : 2.55) * s,
      coreW: z <= 9 ? 0 : 1.55 * s,
    },
    primary: {
      minZ: 7,
      casing: '#C87C1A',
      core: '#F6A62C',
      casingW: 2.9 * s,
      coreW: 1.8 * s,
    },
    trunk: {
      minZ: 6,
      casing: '#328038',
      core: '#66C56A',
      casingW: 3.4 * s,
      coreW: 2.05 * s,
    },
    motorway: {
      minZ: 5,
      casing: '#2B7830',
      core: '#5AC05E',
      casingW: 3.9 * s,
      coreW: 2.35 * s,
    },
  };
}

const ORDERED_ROAD_CLASSES: readonly RoadClass[] = [
  'ferry',
  'path',
  'track',
  'service',
  'minor',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
];

function paintVectorBase(
  ctx: CanvasRenderingContext2D,
  vt: DecodedVectorTile,
  z: number,
  xf: TileTransform,
  pal: StylePalette,
  layers: MapaSettings['layers']
) {
  if (layers.forests) {
    if (!pal.isSatellite) {
      const lc = vt.landcover;
      if (lc.grass.length > 0) {
        ctx.fillStyle = pal.meadowFill;
        paintDecodedPolygons(ctx, lc.grass, xf, true, false);
      }
      if (lc.wood.length > 0) {
        ctx.fillStyle = pal.forestFill;
        paintDecodedPolygons(ctx, lc.wood, xf, true, false);
      }
      if (lc.wetland.length > 0) {
        ctx.fillStyle = pal.wetlandFill;
        paintDecodedPolygons(ctx, lc.wetland, xf, true, false);
      }
      if (lc.rock.length > 0) {
        ctx.fillStyle = pal.rockFill;
        paintDecodedPolygons(ctx, lc.rock, xf, true, false);
      }
      if (lc.glacier.length > 0) {
        ctx.fillStyle = pal.glacierFill;
        paintDecodedPolygons(ctx, lc.glacier, xf, true, false);
      }
    }

    if (vt.parks.length > 0 && z >= 8) {
      ctx.strokeStyle = pal.parkOutline;
      ctx.lineWidth = z >= 11 ? 1.15 : 0.78;
      ctx.setLineDash([4, 3]);
      paintDecodedPolygons(ctx, vt.parks, xf, false, true);
      ctx.setLineDash([]);
    }
  }

  if (layers.cities) {
    if (!pal.isSatellite && vt.urban.length > 0 && z >= 9) {
      ctx.fillStyle = pal.urbanFill;
      ctx.strokeStyle = pal.urbanStroke;
      ctx.lineWidth = 0.4;
      paintDecodedPolygons(ctx, vt.urban, xf, true, z >= 11);
    }

    if (vt.buildings.length > 0 && z >= 13) {
      ctx.fillStyle = pal.buildingFill;
      ctx.strokeStyle = pal.buildingStroke;
      ctx.lineWidth = 0.4;
      paintDecodedPolygons(ctx, vt.buildings, xf, true, true);
    }
  }
}

function paintVectorOverlay(
  ctx: CanvasRenderingContext2D,
  vt: DecodedVectorTile,
  z: number,
  xf: TileTransform,
  elevGrid: Float32Array | null,
  gridSize: number,
  pal: StylePalette,
  layers: MapaSettings['layers']
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Oceans & seas
  if (vt.oceans.length > 0 && !pal.isSatellite) {
    ctx.save();
    ctx.beginPath();
    let anyOcean = false;
    for (let i = 0; i < vt.oceans.length; i++) {
      const f = vt.oceans[i];
      if (f.maxX < xf.vMinX || f.minX > xf.vMaxX || f.maxY < xf.vMinY || f.minY > xf.vMaxY) {
        continue;
      }
      for (let r = 0; r < f.rings.length; r++) {
        if (traceRing(ctx, f.rings[r], xf, true)) anyOcean = true;
      }
    }
    if (anyOcean) {
      if (elevGrid && layers.hypsometry && z <= 9) {
        ctx.fillStyle = pal.flatOceanHex;
        ctx.fill('nonzero');
        ctx.clip('nonzero');
        paintClippedOceanBathymetry(ctx, elevGrid, gridSize, pal);
      } else {
        ctx.fillStyle = layers.hypsometry ? pal.oceanDetailHex : pal.flatOceanHex;
        ctx.fill('nonzero');
      }
    }
    ctx.restore();
  }

  // 2. Inland water polygons & waterways
  if (layers.hydrology) {
    if (vt.inlandWater.length > 0) {
      ctx.fillStyle = pal.waterFill;
      ctx.strokeStyle = pal.waterStroke;
      ctx.lineWidth = z >= 11 ? 0.5 : 0.35;
      paintDecodedPolygons(ctx, vt.inlandWater, xf, true, true);
    }

    const riverW = z >= 13 ? 1.25 : z >= 11 ? 0.95 : z >= 9 ? 0.72 : 0.55;
    const canalW = z >= 12 ? 0.75 : 0.5;
    const streamW = z >= 13 ? 0.55 : 0.4;

    if (z >= 11 && vt.waterways.stream.length > 0) {
      ctx.beginPath();
      if (traceDecodedLines(ctx, vt.waterways.stream, xf)) {
        ctx.strokeStyle = pal.waterStroke;
        ctx.lineWidth = streamW;
        ctx.stroke();
      }
    }
    if (vt.waterways.canal.length > 0) {
      ctx.beginPath();
      if (traceDecodedLines(ctx, vt.waterways.canal, xf)) {
        ctx.strokeStyle = pal.waterStroke;
        ctx.lineWidth = canalW;
        ctx.stroke();
      }
    }
    if (vt.waterways.river.length > 0) {
      ctx.beginPath();
      if (traceDecodedLines(ctx, vt.waterways.river, xf)) {
        ctx.strokeStyle = pal.waterStroke;
        ctx.lineWidth = riverW;
        ctx.stroke();
      }
    }
  }

  // 3. Aeroways
  if (layers.highways && z >= 10) {
    if (vt.aerowayPolys.length > 0) {
      ctx.fillStyle = pal.isDark ? 'rgba(180, 188, 198, 0.25)' : 'rgba(148, 144, 138, 0.35)';
      paintDecodedPolygons(ctx, vt.aerowayPolys, xf, true, false);
    }
    for (let i = 0; i < vt.aerowayLines.length; i++) {
      const al = vt.aerowayLines[i];
      ctx.beginPath();
      if (traceDecodedLines(ctx, [al.geom], xf)) {
        ctx.strokeStyle = pal.isDark ? '#A0AAB6' : '#94908A';
        ctx.lineWidth = al.isRunway ? (z >= 12 ? 3.2 : 1.8) : 1.0;
        ctx.stroke();
      }
    }
  }

  // 4. Borders
  if (layers.districts && z >= 7 && vt.borders.b6.length > 0) {
    ctx.beginPath();
    if (traceDecodedLines(ctx, vt.borders.b6, xf)) {
      ctx.strokeStyle = pal.districtBorder;
      ctx.lineWidth = z >= 10 ? 0.95 : 0.7;
      ctx.setLineDash([2.5, 2.5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (layers.borders) {
    if (z >= 7 && vt.borders.b4.length > 0) {
      ctx.beginPath();
      if (traceDecodedLines(ctx, vt.borders.b4, xf)) {
        ctx.strokeStyle = pal.regionBorder;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4.5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (vt.borders.b2.length > 0) {
      ctx.beginPath();
      if (traceDecodedLines(ctx, vt.borders.b2, xf)) {
        ctx.setLineDash([]);
        ctx.strokeStyle = pal.borderOuter;
        ctx.lineWidth = z >= 9 ? 3.0 : 2.2;
        ctx.stroke();
        ctx.strokeStyle = pal.borderInner;
        ctx.lineWidth = z >= 9 ? 1.15 : 0.9;
        ctx.stroke();
      }
    }
  }

  // 5. Railways
  if (layers.railways && z >= 8 && vt.railways.length > 0) {
    ctx.beginPath();
    if (traceDecodedLines(ctx, vt.railways, xf)) {
      ctx.setLineDash([]);
      ctx.strokeStyle = pal.railMain;
      ctx.lineWidth = z >= 12 ? 1.1 : 0.75;
      ctx.stroke();
      ctx.strokeStyle = pal.railDash;
      ctx.lineWidth = z >= 12 ? 0.65 : 0.45;
      ctx.setLineDash([2.5, 3.5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 6. Roads
  if (layers.highways) {
    const styles = getRoadStyles(z, pal.isDark);
    for (let i = 0; i < ORDERED_ROAD_CLASSES.length; i++) {
      const rc = ORDERED_ROAD_CLASSES[i];
      const st = styles[rc];
      if (z < st.minZ) continue;
      const list = vt.roads[rc];
      if (list.length === 0) continue;

      ctx.beginPath();
      if (!traceDecodedLines(ctx, list, xf)) continue;

      ctx.setLineDash(st.dash || []);
      ctx.strokeStyle = st.casing;
      ctx.lineWidth = st.casingW;
      ctx.stroke();

      if (st.core && st.coreW > 0) {
        ctx.setLineDash([]);
        ctx.strokeStyle = st.core;
        ctx.lineWidth = st.coreW;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
}

function paintVectorLabels(
  ctx: CanvasRenderingContext2D,
  vt: DecodedVectorTile,
  z: number,
  xf: TileTransform,
  pal: StylePalette,
  layers: MapaSettings['layers']
) {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const margin = 8;

  const canPlace = (cx: number, cy: number, w: number, h: number): boolean => {
    const x0 = cx - w * 0.5 - 2;
    const x1 = cx + w * 0.5 + 2;
    const y0 = cy - h * 0.5 - 2;
    const y1 = cy + h * 0.5 + 2;
    if (
      x0 < margin ||
      x1 > TILE_LOGICAL_PX - margin ||
      y0 < margin ||
      y1 > TILE_LOGICAL_PX - margin
    ) {
      return false;
    }
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i];
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return false;
    }
    placed.push({ x0, y0, x1, y1 });
    return true;
  };

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // 1. Places
  if ((layers.cities || layers.borders) && vt.places.length > 0) {
    for (let i = 0; i < vt.places.length; i++) {
      const it = vt.places[i];
      if (it.cls === 'country') {
        if (!layers.borders || z >= 8) continue;
      } else if (!layers.cities) {
        continue;
      }
      const x = it.x * xf.scale - xf.offsetX;
      const y = it.y * xf.scale - xf.offsetY;
      if (x < 0 || x > TILE_LOGICAL_PX || y < 0 || y > TILE_LOGICAL_PX) continue;

      const isCity = it.cls === 'city';
      const isTown = it.cls === 'town';
      const isCountry = it.cls === 'country';
      const fontSize = isCountry ? 10 : isCity ? 10.5 : isTown ? 9.2 : 8.2;
      const weight = isCountry || isCity ? '700' : isTown ? '600' : '500';
      ctx.font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
      const text = isCountry ? it.name.toUpperCase() : it.name;
      const w = ctx.measureText(text).width;
      if (!canPlace(x, y - (isCity || isTown ? 6 : 0), w, fontSize + 2)) continue;

      if ((isCity || isTown) && z >= 7 && z <= 12) {
        ctx.beginPath();
        ctx.arc(x, y, isCity ? 2.6 : 1.9, 0, Math.PI * 2);
        ctx.fillStyle = pal.cityRing;
        ctx.fill();
        ctx.strokeStyle = pal.cityDot;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      const ly = (isCity || isTown) && z >= 7 && z <= 12 ? y - 6.5 : y;
      ctx.strokeStyle = pal.textHalo;
      ctx.lineWidth = 2.6;
      ctx.strokeText(text, x, ly);
      ctx.fillStyle = isCountry
        ? pal.textCountry
        : isCity || isTown
          ? pal.textPrimary
          : pal.textSecondary;
      ctx.fillText(text, x, ly);
    }
  }

  // 2. Mountain peaks
  if (layers.peaks && z >= 10 && vt.peaks.length > 0) {
    ctx.font = '600 8px Inter, system-ui, sans-serif';
    for (let i = 0; i < vt.peaks.length; i++) {
      const pk = vt.peaks[i];
      const x = pk.x * xf.scale - xf.offsetX;
      const y = pk.y * xf.scale - xf.offsetY;
      if (x < 0 || x > TILE_LOGICAL_PX || y < 0 || y > TILE_LOGICAL_PX) continue;

      const label = pk.ele > 100 ? `${pk.name} ${Math.round(pk.ele)}` : pk.name;
      const w = ctx.measureText(label).width;
      if (!canPlace(x, y - 7, w, 10)) continue;

      ctx.beginPath();
      ctx.moveTo(x, y - 2.8);
      ctx.lineTo(x - 2.5, y + 1.8);
      ctx.lineTo(x + 2.5, y + 1.8);
      ctx.closePath();
      ctx.fillStyle = pal.peakColor;
      ctx.fill();

      ctx.strokeStyle = pal.textHalo;
      ctx.lineWidth = 2.4;
      ctx.strokeText(label, x, y - 7);
      ctx.fillStyle = pal.peakColor;
      ctx.fillText(label, x, y - 7);
    }
  }

  // 3. Water body names
  if (layers.hydrology && z >= 10 && vt.waterNames.length > 0) {
    ctx.font = 'italic 500 8px Inter, system-ui, sans-serif';
    for (let i = 0; i < vt.waterNames.length; i++) {
      const wn = vt.waterNames[i];
      const x = wn.x * xf.scale - xf.offsetX;
      const y = wn.y * xf.scale - xf.offsetY;
      if (x < 0 || x > TILE_LOGICAL_PX || y < 0 || y > TILE_LOGICAL_PX) continue;
      const w = ctx.measureText(wn.name).width;
      if (!canPlace(x, y, w, 9)) continue;
      ctx.strokeStyle = pal.waterLabelHalo;
      ctx.lineWidth = 2.2;
      ctx.strokeText(wn.name, x, y);
      ctx.fillStyle = pal.waterLabel;
      ctx.fillText(wn.name, x, y);
    }
  }

  // 4. Road shields
  if (layers.highways && z >= 9 && vt.roadShields.length > 0) {
    ctx.font = '700 7.5px Inter, system-ui, sans-serif';
    for (let i = 0; i < vt.roadShields.length; i++) {
      const sh = vt.roadShields[i];
      const x = sh.x * xf.scale - xf.offsetX;
      const y = sh.y * xf.scale - xf.offsetY;
      if (x < 0 || x > TILE_LOGICAL_PX || y < 0 || y > TILE_LOGICAL_PX) continue;
      const tw = ctx.measureText(sh.ref).width + 6;
      if (!canPlace(x, y, tw, 11)) continue;

      ctx.fillStyle = sh.isGreen ? '#3A9642' : '#D98218';
      ctx.beginPath();
      ctx.roundRect(x - tw * 0.5, y - 5.5, tw, 11, 2.5);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(sh.ref, x, y + 0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame-Budgeted Render Queue & Parent-Tile Instant Preview
// ---------------------------------------------------------------------------
interface QueuedRenderJob {
  run: () => void;
  isCancelled: () => boolean;
}

const RENDER_QUEUE: QueuedRenderJob[] = [];
let renderRafId: number | null = null;

function flushRenderQueue() {
  renderRafId = null;
  const start = performance.now();
  // Process newest (LIFO) visible tile renders within an 8.5 ms per-frame budget for 60 FPS panning
  while (RENDER_QUEUE.length > 0) {
    const job = RENDER_QUEUE.pop()!;
    if (job.isCancelled()) continue;
    job.run();
    if (performance.now() - start > 8.5) break;
  }
  if (RENDER_QUEUE.length > 0) {
    renderRafId = requestAnimationFrame(flushRenderQueue);
  }
}

function scheduleFrameBudgetedPaint(run: () => void, isCancelled: () => boolean): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') {
    if (!isCancelled()) run();
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    RENDER_QUEUE.push({
      isCancelled,
      run: () => {
        try {
          if (!isCancelled()) run();
        } finally {
          resolve();
        }
      },
    });
    if (renderRafId === null) {
      renderRafId = requestAnimationFrame(flushRenderQueue);
    }
  });
}

function tryPaintParentTilePreview(
  ctx: CanvasRenderingContext2D,
  z: number,
  wrappedX: number,
  ty: number,
  sig: string,
  targetW: number,
  targetH: number
): boolean {
  for (let dz = 1; dz <= 2; dz++) {
    const pz = z - dz;
    if (pz < 2) break;
    const px = wrappedX >> dz;
    const py = ty >> dz;
    const parentCanvas = RENDERED_TILE_CACHE.get(`${pz}/${px}/${py}@${sig}`);
    if (parentCanvas) {
      const scale = 1 << dz;
      const sw = parentCanvas.width / scale;
      const sh = parentCanvas.height / scale;
      const sx = (wrappedX - (px << dz)) * sw;
      const sy = (ty - (py << dz)) * sh;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(parentCanvas, sx, sy, sw, sh, 0, 0, targetW, targetH);
      ctx.restore();
      return true;
    }
  }
  return false;
}

/**
 * Synchronous paint pass once decoded vector data, DEM, and/or satellite image are in memory.
 */
function executeTilePaintPass(
  ctx: CanvasRenderingContext2D,
  z: number,
  wrappedX: number,
  ty: number,
  dprScale: number,
  pal: StylePalette,
  layers: MapaSettings['layers'],
  vt: DecodedVectorTile | null,
  xf: TileTransform,
  demRaw: Float32Array | null,
  demZ: number,
  demX: number,
  demY: number,
  satImg: HTMLImageElement | null,
  satShift: number,
  satX: number,
  satY: number
) {
  ctx.setTransform(dprScale, 0, 0, dprScale, 0, 0);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);

  const gridSize = z >= 11 ? 65 : 49;
  let elevGrid: Float32Array | null = null;
  if (demRaw) {
    elevGrid = sampleDemSubGrid(demRaw, demZ, demX, demY, z, wrappedX, ty, gridSize);
  }

  // Pass 0: Base terrain or Sentinel-2 satellite imagery
  if (pal.isSatellite && satImg) {
    const satScale = 1 << satShift;
    const subX = (wrappedX - satX * satScale) / satScale;
    const subY = (ty - satY * satScale) / satScale;
    const sw = satImg.naturalWidth / satScale;
    const sh = satImg.naturalHeight / satScale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      satImg,
      subX * satImg.naturalWidth,
      subY * satImg.naturalHeight,
      sw,
      sh,
      0,
      0,
      TILE_LOGICAL_PX,
      TILE_LOGICAL_PX
    );
    if (elevGrid && layers.hillshade) {
      paintSatelliteHillshadeOverlay(ctx, elevGrid, gridSize, z, ty);
    }
  } else if (elevGrid && (layers.hypsometry || layers.hillshade)) {
    paintHypsometryAndHillshade(
      ctx,
      elevGrid,
      gridSize,
      z,
      ty,
      pal,
      layers.hypsometry,
      layers.hillshade
    );
  } else {
    ctx.fillStyle = `rgb(${pal.flatLandRgb[0]}, ${pal.flatLandRgb[1]}, ${pal.flatLandRgb[2]})`;
    ctx.fillRect(0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
  }

  // Pass 1: Forests, parks, urban landuse, buildings (under contours)
  if (vt) {
    paintVectorBase(ctx, vt, z, xf, pal, layers);
  }

  // Pass 2: Adaptive elevation contours (10–200 m)
  if (elevGrid && layers.contours) {
    paintContoursFromGrid(ctx, elevGrid, gridSize, z, pal);
  }

  // Pass 3: Oceans/water, rivers, borders, districts, railways, roads & labels
  if (vt) {
    paintVectorOverlay(ctx, vt, z, xf, elevGrid, gridSize, pal, layers);
    paintVectorLabels(ctx, vt, z, xf, pal, layers);
  }

  // Pass 4: WGS84 geographic graticule (when toggled on)
  if (layers.graticule) {
    paintWgs84Graticule(ctx, z, wrappedX, ty, pal);
  }
}

/**
 * Renders a single custom Mapa v1.3 tile (z, tx, ty) onto any HTMLCanvasElement
 * using the currently active MapaSettings (or an explicit override).
 * Shared by Leaflet GridLayer (2D maps) and Three.js Terrain3DMap (3D diorama texture).
 */
export async function renderCustomMapTileToCanvas(
  z: number,
  tx: number,
  ty: number,
  canvas: HTMLCanvasElement,
  isCancelled?: () => boolean,
  settingsOverride?: MapaSettings
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const settings = settingsOverride ?? getMapaSettings();
  const sig = getMapaSettingsSignature(settings);
  const pal = STYLE_PALETTES[settings.stylePreset] ?? STYLE_PALETTES.atlas;
  const layers = settings.layers;

  const dprScale = canvas.width / TILE_LOGICAL_PX;
  const maxIndex = 1 << z;
  const wrappedX = ((tx % maxIndex) + maxIndex) % maxIndex;
  if (ty < 0 || ty >= maxIndex) {
    ctx.setTransform(dprScale, 0, 0, dprScale, 0, 0);
    ctx.fillStyle = pal.flatOceanHex;
    ctx.fillRect(0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
    return;
  }

  const cacheKey = `${z}/${wrappedX}/${ty}@${sig}`;
  const cachedTile = RENDERED_TILE_CACHE.get(cacheKey);
  if (cachedTile) {
    setLru(RENDERED_TILE_CACHE, cacheKey, cachedTile, MAX_RENDERED_TILE_CACHE);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cachedTile, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return;
  }

  // Paint instant parent-tile preview (or solid style bg) so zooming/panning never flashes blank squares
  if (!tryPaintParentTilePreview(ctx, z, wrappedX, ty, sig, canvas.width, canvas.height)) {
    ctx.setTransform(dprScale, 0, 0, dprScale, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, TILE_LOGICAL_PX, TILE_LOGICAL_PX);
  }

  // Native vector tile coordinates
  const vecZ = Math.min(z, MAX_NATIVE_VECTOR_Z);
  const vecShift = z - vecZ;
  const vecX = wrappedX >> vecShift;
  const vecY = ty >> vecShift;
  const vecTileScale = 1 << vecShift;
  const vecOffsetX = (wrappedX - vecX * vecTileScale) * TILE_LOGICAL_PX;
  const vecOffsetY = (ty - vecY * vecTileScale) * TILE_LOGICAL_PX;
  const xf = makeTileTransform(vecTileScale, vecOffsetX, vecOffsetY);

  // Native DEM tile coordinates
  const needsDem =
    z >= 5 && (layers.hillshade || layers.contours || (!pal.isSatellite && layers.hypsometry));
  const demZ = Math.min(z, MAX_DEM_Z);
  const demShift = z - demZ;
  const demX = wrappedX >> demShift;
  const demY = ty >> demShift;

  // Native Sentinel-2 tile coordinates
  const satZ = Math.min(z, MAX_SAT_Z);
  const satShift = z - satZ;
  const satX = wrappedX >> satShift;
  const satY = ty >> satShift;

  const vtKey = `${vecZ}/${vecX}/${vecY}`;
  const demKey = `${demZ}/${demX}/${demY}`;
  const satKey = `${satZ}/${satX}/${satY}`;

  // Fast path: if all needed raw inputs are already in memory (e.g. toggling a layer or zooming z13-18),
  // schedule straight onto the frame-budgeted render queue without async network overhead!
  const allInMemory =
    DECODED_VT_CACHE.has(vtKey) &&
    (!needsDem || DEM_CACHE.has(demKey)) &&
    (!pal.isSatellite || SAT_CACHE.has(satKey));

  let vt: DecodedVectorTile | null = null;
  let demRaw: Float32Array | null = null;
  let satImg: HTMLImageElement | null = null;

  if (allInMemory) {
    vt = DECODED_VT_CACHE.get(vtKey) ?? null;
    demRaw = needsDem ? (DEM_CACHE.get(demKey) ?? null) : null;
    satImg = pal.isSatellite ? (SAT_CACHE.get(satKey) ?? null) : null;
  } else {
    [vt, demRaw, satImg] = await Promise.all([
      fetchDecodedVectorTile(vecZ, vecX, vecY),
      needsDem ? loadTerrariumTile(demZ, demX, demY) : Promise.resolve(null),
      pal.isSatellite ? loadSatelliteTile(satZ, satX, satY) : Promise.resolve(null),
    ]);
  }

  if (isCancelled?.()) return;

  await scheduleFrameBudgetedPaint(
    () => {
      executeTilePaintPass(
        ctx,
        z,
        wrappedX,
        ty,
        dprScale,
        pal,
        layers,
        vt,
        xf,
        demRaw,
        demZ,
        demX,
        demY,
        satImg,
        satShift,
        satX,
        satY
      );

      if (typeof document !== 'undefined' && canvas.width === TILE_BACKING_PX) {
        const snap = document.createElement('canvas');
        snap.width = canvas.width;
        snap.height = canvas.height;
        const sCtx = snap.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(canvas, 0, 0);
          setLru(RENDERED_TILE_CACHE, cacheKey, snap, MAX_RENDERED_TILE_CACHE);
        }
      }
    },
    () => Boolean(isCancelled?.())
  );
}

/**
 * Drop-in Leaflet GridLayer implementing the custom Mapa v1.3 basemap.
 * Automatically redraws in-place whenever any setting in MapSettingsControl changes.
 */
export function createCustomMapaTileLayer(): L.GridLayer {
  const activeTiles = new Map<
    string,
    { z: number; x: number; y: number; tile: HTMLCanvasElement; cancel: () => void }
  >();

  const CustomMapaGridLayer = L.GridLayer.extend({
    createTile: function (coords: L.Coords, done: L.DoneCallback): HTMLElement {
      const tile = document.createElement('canvas');
      tile.width = TILE_BACKING_PX;
      tile.height = TILE_BACKING_PX;
      tile.style.width = `${TILE_LOGICAL_PX}px`;
      tile.style.height = `${TILE_LOGICAL_PX}px`;

      let cancelled = false;
      const cancelFn = () => {
        cancelled = true;
      };
      const tileKey = `${coords.z}/${coords.x}/${coords.y}`;
      (tile as HTMLCanvasElement & { _cancelMapa?: () => void; _tileKey?: string })._cancelMapa =
        cancelFn;
      (tile as HTMLCanvasElement & { _cancelMapa?: () => void; _tileKey?: string })._tileKey =
        tileKey;

      activeTiles.set(tileKey, {
        z: coords.z,
        x: coords.x,
        y: coords.y,
        tile,
        cancel: cancelFn,
      });

      const snapshotSettings = getMapaSettings();

      renderCustomMapTileToCanvas(
        coords.z,
        coords.x,
        coords.y,
        tile,
        () => cancelled,
        snapshotSettings
      )
        .then(() => {
          if (!cancelled) done(undefined, tile);
        })
        .catch(() => {
          if (!cancelled) done(undefined, tile);
        });

      return tile;
    },
  });

  const layer = new (CustomMapaGridLayer as unknown as new (
    opts: L.GridLayerOptions
  ) => L.GridLayer)({
    tileSize: TILE_LOGICAL_PX,
    minZoom: 2,
    maxZoom: 18,
    maxNativeZoom: 18,
    updateWhenIdle: false,
    updateWhenZooming: false,
    updateInterval: 80,
    keepBuffer: 3,
    attribution: '&copy; OpenStreetMap',
  });

  layer.on('tileunload', (ev: L.TileEvent) => {
    const el = ev.tile as unknown as HTMLCanvasElement & {
      _cancelMapa?: () => void;
      _tileKey?: string;
    };
    el?._cancelMapa?.();
    if (el?._tileKey) {
      activeTiles.delete(el._tileKey);
    }
  });

  let unsubscribe: (() => void) | null = null;
  layer.on('add', () => {
    const hostMap = (layer as L.GridLayer & { _map?: L.Map })._map;
    hostMap?.attributionControl?.setPrefix(false);
    if (unsubscribe) unsubscribe();
    unsubscribe = subscribeMapaSettings((nextSettings) => {
      // In-place repaint of mounted tiles without destroying & recreating DOM nodes (zero flicker!)
      activeTiles.forEach((entry) => {
        void renderCustomMapTileToCanvas(
          entry.z,
          entry.x,
          entry.y,
          entry.tile,
          () => !activeTiles.has(`${entry.z}/${entry.x}/${entry.y}`),
          nextSettings
        );
      });
    });
  });
  layer.on('remove', () => {
    unsubscribe?.();
    unsubscribe = null;
    activeTiles.forEach((entry) => entry.cancel());
    activeTiles.clear();
  });

  return layer;
}
