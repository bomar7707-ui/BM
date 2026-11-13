import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Coordinate } from '../types';
import { calculateDistanceKm } from '../utils/gpxParser';

export interface Route3DItem {
  id: string;
  tripId: string;
  mapIndex: number;
  name: string;
  date?: string;
  distanceLabel?: string;
  color: string;
  isSelected: boolean;
  coordinates: Coordinate[];
}

export type BaseMapStyle3D = 'outdoor' | 'satellite' | 'topo';

export type DioramaPOICategory =
  | 'peak'
  | 'viewpoint'
  | 'hut'
  | 'saddle'
  | 'historic'
  | 'spring';

export interface DioramaPOI {
  id: string;
  name: string;
  lat: number;
  lon: number;
  ele?: number | null;
  category: DioramaPOICategory;
  distanceFromRouteKm: number;
}

export interface FlightTelemetryState {
  isFlying: boolean;
  isOrbiting: boolean;
  flyProgress: {
    distKm: number;
    eleM: number | null;
    pct: number;
  } | null;
}

export interface Terrain3DMapHandle {
  toggleFlyover: () => void;
  toggleOrbit: () => void;
  focusRoute: () => void;
  adjustPitch: (delta: number) => void;
  focusLocation: (lat: number, lon: number) => void;
}

interface Terrain3DMapProps {
  routes: Route3DItem[];
  selectedCoords: Coordinate[];
  hoveredCoord?: [number, number] | null;
  hasBottomPanel?: boolean;
  baseStyle: BaseMapStyle3D;
  exaggeration: number;
  pois?: DioramaPOI[];
  showPois?: boolean;
  highlightedPoiId?: string | null;
  onSelectPoi?: (poi: DioramaPOI) => void;
  onSelectRoute?: (tripId: string, mapIndex: number) => void;
  onFlightStateChange?: (state: FlightTelemetryState) => void;
}

const MAPY_CZ_API_KEY = '3SfstVBaZryBHeEkOsw_DSAc8PwcV140TQvNslWDrQY';

// Grid resolution of the 3D diorama top surface
const GRID_SEGMENTS = 144;
const GRID_VERTS = GRID_SEGMENTS + 1;
const DIORAMA_MAX_SIZE = 100; // World units for the longest horizontal edge
const BASE_SOIL_THICKNESS = 4.2; // Minimum height of the vertical diorama cut-out wall

interface DioramaBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  centerLat: number;
  centerLon: number;
  widthMeters: number;
  depthMeters: number;
  worldWidth: number;
  worldDepth: number;
  metersToWorld: number;
}

interface ProjectedLabel {
  x: number;
  y: number;
  visible: boolean;
}

// Convert longitude/latitude to fractional Web Mercator tile coordinates at zoom z
function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z)
  );
}

function tileYToLat(tileY: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * tileY) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileXToLon(tileX: number, z: number): number {
  return (tileX / Math.pow(2, z)) * 360 - 180;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function getTileUrl(style: BaseMapStyle3D, z: number, x: number, y: number): string {
  if (style === 'satellite') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  if (style === 'topo') {
    return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
  }
  return `https://api.mapy.cz/v1/maptiles/outdoor/256/${z}/${x}/${y}?apikey=${MAPY_CZ_API_KEY}`;
}

// Compute padded geographic bounding box for the diorama block
function computeDioramaBounds(coords: Coordinate[]): DioramaBounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const pt of coords) {
    if (pt[0] < minLat) minLat = pt[0];
    if (pt[0] > maxLat) maxLat = pt[0];
    if (pt[1] < minLon) minLon = pt[1];
    if (pt[1] > maxLon) maxLon = pt[1];
  }

  if (!isFinite(minLat)) {
    minLat = 49.48;
    maxLat = 49.55;
    minLon = 18.52;
    maxLon = 18.62;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  let latSpan = Math.max(0.012, maxLat - minLat);
  let lonSpan = Math.max(0.012 / cosLat, maxLon - minLon);

  // Add 24% margin around the route so surrounding peaks/valleys frame the diorama
  latSpan *= 1.48;
  lonSpan *= 1.48;

  // Keep a balanced tabletop aspect ratio (between 0.72 and 1.38)
  let widthMeters = lonSpan * 111320 * cosLat;
  let depthMeters = latSpan * 111132;

  const minRatio = 0.74;
  const maxRatio = 1.35;
  const ratio = widthMeters / Math.max(1, depthMeters);

  if (ratio < minRatio) {
    widthMeters = depthMeters * minRatio;
    lonSpan = widthMeters / (111320 * cosLat);
  } else if (ratio > maxRatio) {
    depthMeters = widthMeters / maxRatio;
    latSpan = depthMeters / 111132;
  }

  minLat = centerLat - latSpan / 2;
  maxLat = centerLat + latSpan / 2;
  minLon = centerLon - lonSpan / 2;
  maxLon = centerLon + lonSpan / 2;

  const maxDimMeters = Math.max(widthMeters, depthMeters, 1000);
  const metersToWorld = DIORAMA_MAX_SIZE / maxDimMeters;
  const worldWidth = widthMeters * metersToWorld;
  const worldDepth = depthMeters * metersToWorld;

  return {
    minLat,
    maxLat,
    minLon,
    maxLon,
    centerLat,
    centerLon,
    widthMeters,
    depthMeters,
    worldWidth,
    worldDepth,
    metersToWorld,
  };
}

// Pick zoom level so the diorama bounding box uses at most ~4x4 tiles (fast & sharp)
function pickOptimalZoom(bounds: DioramaBounds, maxAllowedZoom = 14): number {
  for (let z = maxAllowedZoom; z >= 10; z--) {
    const x0 = Math.floor(lonToTileX(bounds.minLon, z));
    const x1 = Math.floor(lonToTileX(bounds.maxLon, z));
    const y0 = Math.floor(latToTileY(bounds.maxLat, z));
    const y1 = Math.floor(latToTileY(bounds.minLat, z));
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    if (cols <= 4 && rows <= 4) {
      return z;
    }
  }
  return 11;
}

// Fetch and composite cropped raster map canvas for the diorama bounds
async function fetchDioramaMapCanvas(
  bounds: DioramaBounds,
  style: BaseMapStyle3D
): Promise<HTMLCanvasElement> {
  const z = pickOptimalZoom(bounds, 14);
  const exactX0 = lonToTileX(bounds.minLon, z);
  const exactX1 = lonToTileX(bounds.maxLon, z);
  const exactY0 = latToTileY(bounds.maxLat, z); // North is smaller Y
  const exactY1 = latToTileY(bounds.minLat, z); // South is larger Y

  const minTileX = Math.floor(exactX0);
  const maxTileX = Math.floor(exactX1);
  const minTileY = Math.floor(exactY0);
  const maxTileY = Math.floor(exactY1);

  const cols = maxTileX - minTileX + 1;
  const rows = maxTileY - minTileY + 1;

  const stitchCanvas = document.createElement('canvas');
  stitchCanvas.width = cols * 256;
  stitchCanvas.height = rows * 256;
  const sCtx = stitchCanvas.getContext('2d')!;

  // Fallback subtle topographic background in case a tile is slow
  sCtx.fillStyle = '#dce7dc';
  sCtx.fillRect(0, 0, stitchCanvas.width, stitchCanvas.height);

  const tasks: Promise<void>[] = [];
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const url = getTileUrl(style, z, tx, ty);
      const dx = (tx - minTileX) * 256;
      const dy = (ty - minTileY) * 256;
      tasks.push(
        loadImage(url).then((img) => {
          if (img) {
            sCtx.drawImage(img, dx, dy, 256, 256);
          }
        })
      );
    }
  }
  await Promise.all(tasks);

  // Crop to exact geographic bounding box
  const cropX = (exactX0 - minTileX) * 256;
  const cropY = (exactY0 - minTileY) * 256;
  const cropW = Math.max(16, (exactX1 - exactX0) * 256);
  const cropH = Math.max(16, (exactY1 - exactY0) * 256);

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = 1024;
  finalCanvas.height = 1024;
  const fCtx = finalCanvas.getContext('2d')!;
  fCtx.drawImage(stitchCanvas, cropX, cropY, cropW, cropH, 0, 0, 1024, 1024);

  return finalCanvas;
}

// Fetch and decode real DEM heights (in meters) across the GRID_VERTS x GRID_VERTS grid
async function fetchDioramaElevationGrid(
  bounds: DioramaBounds,
  fallbackCoords: Coordinate[]
): Promise<{ heights: Float32Array; minEle: number; maxEle: number }> {
  const z = pickOptimalZoom(bounds, 13);
  const exactX0 = lonToTileX(bounds.minLon, z);
  const exactX1 = lonToTileX(bounds.maxLon, z);
  const exactY0 = latToTileY(bounds.maxLat, z);
  const exactY1 = latToTileY(bounds.minLat, z);

  const minTileX = Math.floor(exactX0);
  const maxTileX = Math.floor(exactX1);
  const minTileY = Math.floor(exactY0);
  const maxTileY = Math.floor(exactY1);

  const cols = maxTileX - minTileX + 1;
  const rows = maxTileY - minTileY + 1;

  const stitchCanvas = document.createElement('canvas');
  stitchCanvas.width = cols * 256;
  stitchCanvas.height = rows * 256;
  const sCtx = stitchCanvas.getContext('2d')!;

  let loadedCount = 0;
  const tasks: Promise<void>[] = [];
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      const dx = (tx - minTileX) * 256;
      const dy = (ty - minTileY) * 256;
      tasks.push(
        loadImage(url).then((img) => {
          if (img) {
            sCtx.drawImage(img, dx, dy, 256, 256);
            loadedCount++;
          }
        })
      );
    }
  }
  await Promise.all(tasks);

  const rawGrid = new Float32Array(GRID_VERTS * GRID_VERTS);

  if (loadedCount > 0) {
    const imgData = sCtx.getImageData(0, 0, stitchCanvas.width, stitchCanvas.height).data;
    const w = stitchCanvas.width;
    const h = stitchCanvas.height;

    const samplePixelEle = (px: number, py: number): number => {
      const cx = Math.max(0, Math.min(w - 1, Math.round(px)));
      const cy = Math.max(0, Math.min(h - 1, Math.round(py)));
      const idx = (cy * w + cx) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const a = imgData[idx + 3];
      if (a === 0) return 450;
      const ele = r * 256 + g + b / 256 - 32768;
      return ele > -500 && ele < 9000 ? ele : 450;
    };

    // Row iz = 0 corresponds to North (maxLat), iz = GRID_SEGMENTS corresponds to South (minLat)
    for (let iz = 0; iz < GRID_VERTS; iz++) {
      const v = iz / GRID_SEGMENTS;
      const lat = bounds.maxLat - v * (bounds.maxLat - bounds.minLat);
      const tileY = latToTileY(lat, z);
      const py = (tileY - minTileY) * 256;

      for (let ix = 0; ix < GRID_VERTS; ix++) {
        const u = ix / GRID_SEGMENTS;
        const lon = bounds.minLon + u * (bounds.maxLon - bounds.minLon);
        const tileX = lonToTileX(lon, z);
        const px = (tileX - minTileX) * 256;

        // Bilinear interpolation in pixel space
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const fx = px - x0;
        const fy = py - y0;

        const e00 = samplePixelEle(x0, y0);
        const e10 = samplePixelEle(x0 + 1, y0);
        const e01 = samplePixelEle(x0, y0 + 1);
        const e11 = samplePixelEle(x0 + 1, y0 + 1);

        const top = e00 * (1 - fx) + e10 * fx;
        const bot = e01 * (1 - fx) + e11 * fx;
        rawGrid[iz * GRID_VERTS + ix] = top * (1 - fy) + bot * fy;
      }
    }
  } else {
    // Fallback: inverse-distance interpolation from GPX coordinates
    const ptsWithEle = fallbackCoords.filter(
      (c) => typeof c[2] === 'number' && !isNaN(c[2])
    );
    const step = Math.max(1, Math.floor(ptsWithEle.length / 120));
    const samplePts = ptsWithEle.filter((_, idx) => idx % step === 0);

    for (let iz = 0; iz < GRID_VERTS; iz++) {
      const v = iz / GRID_SEGMENTS;
      const lat = bounds.maxLat - v * (bounds.maxLat - bounds.minLat);
      for (let ix = 0; ix < GRID_VERTS; ix++) {
        const u = ix / GRID_SEGMENTS;
        const lon = bounds.minLon + u * (bounds.maxLon - bounds.minLon);
        if (samplePts.length === 0) {
          rawGrid[iz * GRID_VERTS + ix] = 500;
          continue;
        }
        let num = 0;
        let den = 0;
        for (const p of samplePts) {
          const d2 = (p[0] - lat) ** 2 + (p[1] - lon) ** 2 + 1e-8;
          const w = 1 / (d2 * d2);
          num += (p[2] as number) * w;
          den += w;
        }
        rawGrid[iz * GRID_VERTS + ix] = den > 0 ? num / den : 500;
      }
    }
  }

  // Smooth the elevation grid (2 passes of 3x3 Gaussian-like kernel) so the 3D diorama mesh is silky smooth
  let current = rawGrid;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(GRID_VERTS * GRID_VERTS);
    for (let iz = 0; iz < GRID_VERTS; iz++) {
      for (let ix = 0; ix < GRID_VERTS; ix++) {
        let sum = 0;
        let weightSum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nz = Math.max(0, Math.min(GRID_SEGMENTS, iz + dz));
            const nx = Math.max(0, Math.min(GRID_SEGMENTS, ix + dx));
            const w = dz === 0 && dx === 0 ? 4 : dz === 0 || dx === 0 ? 2 : 1;
            sum += current[nz * GRID_VERTS + nx] * w;
            weightSum += w;
          }
        }
        next[iz * GRID_VERTS + ix] = sum / weightSum;
      }
    }
    current = next;
  }

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (let i = 0; i < current.length; i++) {
    if (current[i] < minEle) minEle = current[i];
    if (current[i] > maxEle) maxEle = current[i];
  }
  if (!isFinite(minEle)) {
    minEle = 400;
    maxEle = 800;
  }

  return { heights: current, minEle, maxEle };
}

// Build geological cross-section side walls + bottom base for the 3D diorama block
function buildDioramaWallsGeometry(
  bounds: DioramaBounds,
  heights: Float32Array,
  minEle: number,
  exaggeration: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];

  const halfW = bounds.worldWidth / 2;
  const halfD = bounds.worldDepth / 2;

  const getWorldY = (ix: number, iz: number): number => {
    const ele = heights[iz * GRID_VERTS + ix];
    return (
      BASE_SOIL_THICKNESS +
      Math.max(0, ele - minEle) * bounds.metersToWorld * exaggeration
    );
  };

  const getWorldX = (ix: number): number =>
    -halfW + (ix / GRID_SEGMENTS) * bounds.worldWidth;
  const getWorldZ = (iz: number): number =>
    -halfD + (iz / GRID_SEGMENTS) * bounds.worldDepth;

  // Warm geological earth cross-section colors (top crest -> upper soil -> deep rock strata)
  const topSoilColor = new THREE.Color('#6b5344');
  const midRockColor = new THREE.Color('#4a3b32');
  const deepBedrockColor = new THREE.Color('#27211d');

  // Helper to push a vertical wall quad between perimeter point A and perimeter point B
  // Outward normal follows right-hand rule when (ax, az) -> (bx, bz) is ordered counter-clockwise from above
  const addWallSegment = (
    ax: number,
    az: number,
    ay: number,
    bx: number,
    bz: number,
    by: number
  ) => {
    const midY = Math.min(ay, by) * 0.48;

    // Upper stratum quad: top -> midY
    positions.push(
      ax, ay, az,
      ax, midY, az,
      bx, by, bz,

      bx, by, bz,
      ax, midY, az,
      bx, midY, bz
    );
    colors.push(
      topSoilColor.r, topSoilColor.g, topSoilColor.b,
      midRockColor.r, midRockColor.g, midRockColor.b,
      topSoilColor.r, topSoilColor.g, topSoilColor.b,

      topSoilColor.r, topSoilColor.g, topSoilColor.b,
      midRockColor.r, midRockColor.g, midRockColor.b,
      midRockColor.r, midRockColor.g, midRockColor.b
    );

    // Lower stratum quad: midY -> 0
    positions.push(
      ax, midY, az,
      ax, 0, az,
      bx, midY, bz,

      bx, midY, bz,
      ax, 0, az,
      bx, 0, bz
    );
    colors.push(
      midRockColor.r, midRockColor.g, midRockColor.b,
      deepBedrockColor.r, deepBedrockColor.g, deepBedrockColor.b,
      midRockColor.r, midRockColor.g, midRockColor.b,

      midRockColor.r, midRockColor.g, midRockColor.b,
      deepBedrockColor.r, deepBedrockColor.g, deepBedrockColor.b,
      deepBedrockColor.r, deepBedrockColor.g, deepBedrockColor.b
    );
  };

  // 1. South wall (iz = GRID_SEGMENTS, x from left to right, normal +Z)
  for (let ix = 0; ix < GRID_SEGMENTS; ix++) {
    addWallSegment(
      getWorldX(ix),
      halfD,
      getWorldY(ix, GRID_SEGMENTS),
      getWorldX(ix + 1),
      halfD,
      getWorldY(ix + 1, GRID_SEGMENTS)
    );
  }

  // 2. East wall (ix = GRID_SEGMENTS, z from +halfD to -halfD, normal +X)
  for (let iz = GRID_SEGMENTS; iz > 0; iz--) {
    addWallSegment(
      halfW,
      getWorldZ(iz),
      getWorldY(GRID_SEGMENTS, iz),
      halfW,
      getWorldZ(iz - 1),
      getWorldY(GRID_SEGMENTS, iz - 1)
    );
  }

  // 3. North wall (iz = 0, x from +halfW to -halfW, normal -Z)
  for (let ix = GRID_SEGMENTS; ix > 0; ix--) {
    addWallSegment(
      getWorldX(ix),
      -halfD,
      getWorldY(ix, 0),
      getWorldX(ix - 1),
      -halfD,
      getWorldY(ix - 1, 0)
    );
  }

  // 4. West wall (ix = 0, z from -halfD to +halfD, normal -X)
  for (let iz = 0; iz < GRID_SEGMENTS; iz++) {
    addWallSegment(
      -halfW,
      getWorldZ(iz),
      getWorldY(0, iz),
      -halfW,
      getWorldZ(iz + 1),
      getWorldY(0, iz + 1)
    );
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

export const Terrain3DMap = forwardRef<Terrain3DMapHandle, Terrain3DMapProps>(
  (
    {
      routes,
      selectedCoords,
      hoveredCoord,
      hasBottomPanel = false,
      baseStyle,
      exaggeration,
      pois = [],
      showPois = true,
      highlightedPoiId = null,
      onSelectPoi,
      onSelectRoute,
      onFlightStateChange,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const dioramaGroupRef = useRef<THREE.Group | null>(null);

    const terrainMeshRef = useRef<THREE.Mesh | null>(null);
    const wallsMeshRef = useRef<THREE.Mesh | null>(null);
    const plinthGroupRef = useRef<THREE.Group | null>(null);
    const routesGroupRef = useRef<THREE.Group | null>(null);
    const poiGroupRef = useRef<THREE.Group | null>(null);
    const hoverMeshGroupRef = useRef<THREE.Group | null>(null);
    const flyMeshGroupRef = useRef<THREE.Group | null>(null);

    // Cached DEM data for the current route bounding box
    const dioramaDataRef = useRef<{
      bounds: DioramaBounds;
      heights: Float32Array;
      minEle: number;
      maxEle: number;
    } | null>(null);

    // 3D anchor positions for HTML badges (Start, Finish, Peak, Compass N/S/E/W, POIs)
    const anchors3DRef = useRef<{
      start: THREE.Vector3 | null;
      end: THREE.Vector3 | null;
      peak: { pos: THREE.Vector3; ele: number; lat: number; lon: number } | null;
      north: THREE.Vector3 | null;
      pois: Map<string, THREE.Vector3>;
    }>({
      start: null,
      end: null,
      peak: null,
      north: null,
      pois: new Map(),
    });

    // DOM refs for projected HTML markers so we can update positions at 60fps without React re-renders
    const startBadgeRef = useRef<HTMLDivElement | null>(null);
    const endBadgeRef = useRef<HTMLDivElement | null>(null);
    const peakBadgeRef = useRef<HTMLDivElement | null>(null);
    const northBadgeRef = useRef<HTMLDivElement | null>(null);
    const poiBadgeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const [peakElevationLabel, setPeakElevationLabel] = useState<number | null>(null);
    const [isLoadingDiorama, setIsLoadingDiorama] = useState<boolean>(true);

    // Animation state refs
    const isFlyingRef = useRef(false);
    const isOrbitingRef = useRef(false);
    const flySavedProgressRef = useRef<{
      t: number;
      progress: { distKm: number; eleM: number | null; pct: number };
    } | null>(null);
    const flyStateRef = useRef<{
      active: boolean;
      startTime: number;
      elapsedOffsetMs: number;
      durationMs: number;
      coords: Coordinate[];
      cumDist: number[];
      totalDist: number;
    } | null>(null);
    const cameraTweenRef = useRef<{
      active: boolean;
      startTime: number;
      durationMs: number;
      fromPos: THREE.Vector3;
      toPos: THREE.Vector3;
      fromTarget: THREE.Vector3;
      toTarget: THREE.Vector3;
    } | null>(null);

    // Keep latest callbacks/props in refs
    const onSelectRouteRef = useRef(onSelectRoute);
    onSelectRouteRef.current = onSelectRoute;

    const onFlightStateChangeRef = useRef(onFlightStateChange);
    onFlightStateChangeRef.current = onFlightStateChange;

    const exaggerationRef = useRef(exaggeration);
    exaggerationRef.current = exaggeration;

    const hasBottomPanelRef = useRef(hasBottomPanel);
    hasBottomPanelRef.current = hasBottomPanel;

    const selectedCoordsRef = useRef(selectedCoords);
    selectedCoordsRef.current = selectedCoords;

    const routesRef = useRef(routes);
    routesRef.current = routes;

    const poisRef = useRef(pois);
    poisRef.current = pois;

    const showPoisRef = useRef(showPois);
    showPoisRef.current = showPois;

    const emitFlightState = useCallback(
      (
        flying: boolean,
        orbiting: boolean,
        progress: { distKm: number; eleM: number | null; pct: number } | null
      ) => {
        isFlyingRef.current = flying;
        isOrbitingRef.current = orbiting;
        onFlightStateChangeRef.current?.({
          isFlying: flying,
          isOrbiting: orbiting,
          flyProgress: progress,
        });
      },
      []
    );

    // Pause active flyover/orbit while preserving current flyover progress & marker
    const pauseAnimations = useCallback(() => {
      flyStateRef.current = null;
      cameraTweenRef.current = null;
      if (controlsRef.current) {
        controlsRef.current.autoRotate = false;
      }
      emitFlightState(false, false, flySavedProgressRef.current?.progress ?? null);
    }, [emitFlightState]);

    // Completely reset flyover progress & hide flyover marker (called on Vycentrovat 3D or route change)
    const resetAnimations = useCallback(() => {
      flyStateRef.current = null;
      flySavedProgressRef.current = null;
      cameraTweenRef.current = null;
      if (controlsRef.current) {
        controlsRef.current.autoRotate = false;
      }
      if (flyMeshGroupRef.current) {
        flyMeshGroupRef.current.visible = false;
      }
      emitFlightState(false, false, null);
    }, [emitFlightState]);

    // Convert geographic [lat, lon] to 3D world position on the diorama surface
    const latLonToWorld = useCallback(
      (lat: number, lon: number, extraHeight = 0): THREE.Vector3 | null => {
        const data = dioramaDataRef.current;
        if (!data) return null;
        const { bounds, heights, minEle } = data;

        const u = Math.max(
          0,
          Math.min(1, (lon - bounds.minLon) / (bounds.maxLon - bounds.minLon))
        );
        const v = Math.max(
          0,
          Math.min(1, (bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat))
        );

        const gx = u * GRID_SEGMENTS;
        const gz = v * GRID_SEGMENTS;
        const ix0 = Math.min(GRID_SEGMENTS - 1, Math.max(0, Math.floor(gx)));
        const iz0 = Math.min(GRID_SEGMENTS - 1, Math.max(0, Math.floor(gz)));
        const fx = gx - ix0;
        const fz = gz - iz0;

        const e00 = heights[iz0 * GRID_VERTS + ix0];
        const e10 = heights[iz0 * GRID_VERTS + (ix0 + 1)];
        const e01 = heights[(iz0 + 1) * GRID_VERTS + ix0];
        const e11 = heights[(iz0 + 1) * GRID_VERTS + (ix0 + 1)];

        const top = e00 * (1 - fx) + e10 * fx;
        const bot = e01 * (1 - fx) + e11 * fx;
        const ele = top * (1 - fz) + bot * fz;

        const x = (u - 0.5) * bounds.worldWidth;
        const z = (v - 0.5) * bounds.worldDepth;
        const y =
          BASE_SOIL_THICKNESS +
          Math.max(0, ele - minEle) * bounds.metersToWorld * exaggerationRef.current +
          extraHeight;

        return new THREE.Vector3(x, y, z);
      },
      []
    );

    // Rebuild 3D route tubes & markers whenever elevation grid, routes, or exaggeration change
    const rebuildRoutesAndAnchors = useCallback(() => {
      const data = dioramaDataRef.current;
      const routesGroup = routesGroupRef.current;
      if (!data || !routesGroup) return;

      // Clear previous route meshes
      while (routesGroup.children.length > 0) {
        const child = routesGroup.children[0] as THREE.Mesh;
        routesGroup.remove(child);
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }

      const curRoutes = routesRef.current;
      curRoutes.forEach((r) => {
        if (!r.coordinates || r.coordinates.length < 2) return;

        // Subsample dense GPX tracks to ~260 control points for a clean CatmullRom spline
        const step = Math.max(1, Math.floor(r.coordinates.length / 260));
        const pts3D: THREE.Vector3[] = [];
        const heightOffset = r.isSelected ? 0.32 : 0.22;

        for (let i = 0; i < r.coordinates.length; i += step) {
          const c = r.coordinates[i];
          const p = latLonToWorld(c[0], c[1], heightOffset);
          if (p) pts3D.push(p);
        }
        const lastCoord = r.coordinates[r.coordinates.length - 1];
        const lastP = latLonToWorld(lastCoord[0], lastCoord[1], heightOffset);
        if (lastP && (pts3D.length === 0 || pts3D[pts3D.length - 1].distanceTo(lastP) > 0.05)) {
          pts3D.push(lastP);
        }

        if (pts3D.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(pts3D);
        const tubularSegments = Math.min(480, Math.max(90, pts3D.length * 2));

        if (r.isSelected) {
          // Outer silhouette border using BackSide culling so it NEVER covers the purple core from any angle
          const haloGeom = new THREE.TubeGeometry(curve, tubularSegments, 0.25, 10, false);
          const haloMat = new THREE.MeshBasicMaterial({
            color: '#3b0764',
            side: THREE.BackSide,
          });
          const haloMesh = new THREE.Mesh(haloGeom, haloMat);
          haloMesh.userData = { tripId: r.tripId, mapIndex: r.mapIndex };
          routesGroup.add(haloMesh);

          // Vivid purple/fuchsia core tube (always visible on top)
          const coreGeom = new THREE.TubeGeometry(curve, tubularSegments, 0.18, 10, false);
          const coreMat = new THREE.MeshStandardMaterial({
            color: '#c026d3',
            emissive: '#9333ea',
            emissiveIntensity: 0.65,
            roughness: 0.25,
          });
          const coreMesh = new THREE.Mesh(coreGeom, coreMat);
          coreMesh.castShadow = true;
          coreMesh.userData = { tripId: r.tripId, mapIndex: r.mapIndex };
          routesGroup.add(coreMesh);
        } else {
          const unselGeom = new THREE.TubeGeometry(curve, tubularSegments, 0.14, 8, false);
          const unselMat = new THREE.MeshStandardMaterial({
            color: '#6366f1',
            emissive: '#4f46e5',
            emissiveIntensity: 0.35,
            roughness: 0.3,
          });
          const unselMesh = new THREE.Mesh(unselGeom, unselMat);
          unselMesh.userData = { tripId: r.tripId, mapIndex: r.mapIndex };
          routesGroup.add(unselMesh);
        }
      });

      // Update Start / Finish / Peak 3D anchors
      const selCoords = selectedCoordsRef.current;
      if (selCoords.length >= 2) {
        const startC = selCoords[0];
        const endC = selCoords[selCoords.length - 1];

        anchors3DRef.current.start = latLonToWorld(startC[0], startC[1], 1.2);
        anchors3DRef.current.end = latLonToWorld(endC[0], endC[1], 1.2);

        let maxEle = -Infinity;
        let peakCoord: Coordinate | null = null;
        for (const pt of selCoords) {
          if (typeof pt[2] === 'number' && !isNaN(pt[2]) && pt[2] > maxEle) {
            maxEle = pt[2];
            peakCoord = pt;
          }
        }
        if (peakCoord && isFinite(maxEle)) {
          const pCoord = peakCoord as Coordinate;
          const peakPos = latLonToWorld(pCoord[0], pCoord[1], 1.8);
          anchors3DRef.current.peak = peakPos
            ? { pos: peakPos, ele: Math.round(maxEle), lat: pCoord[0], lon: pCoord[1] }
            : null;
          setPeakElevationLabel(Math.round(maxEle));
        } else {
          anchors3DRef.current.peak = null;
          setPeakElevationLabel(null);
        }
      } else {
        anchors3DRef.current.start = null;
        anchors3DRef.current.end = null;
        anchors3DRef.current.peak = null;
        setPeakElevationLabel(null);
      }

      // Rebuild 3D POI pins and anchors on the diorama
      const poiGroup = poiGroupRef.current;
      anchors3DRef.current.pois.clear();
      if (poiGroup) {
        while (poiGroup.children.length > 0) {
          const c = poiGroup.children[0] as THREE.Mesh;
          poiGroup.remove(c);
          c.geometry?.dispose();
          (c.material as THREE.Material)?.dispose();
        }

        if (showPoisRef.current) {
          const curPois = poisRef.current;
          const categoryColors: Record<DioramaPOICategory, string> = {
            peak: '#fbbf24',
            viewpoint: '#38bdf8',
            hut: '#34d399',
            saddle: '#f472b6',
            historic: '#fb923c',
            spring: '#60a5fa',
          };

          curPois.forEach((poi) => {
            // Check if POI is within diorama bounds
            if (
              poi.lat < data.bounds.minLat ||
              poi.lat > data.bounds.maxLat ||
              poi.lon < data.bounds.minLon ||
              poi.lon > data.bounds.maxLon
            ) {
              return;
            }

            const surfacePos = latLonToWorld(poi.lat, poi.lon, 0.15);
            const labelPos = latLonToWorld(poi.lat, poi.lon, 2.35);
            if (!surfacePos || !labelPos) return;

            anchors3DRef.current.pois.set(poi.id, labelPos);

            const pinColor = categoryColors[poi.category] || '#fbbf24';
            const stemMesh = new THREE.Mesh(
              new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8),
              new THREE.MeshBasicMaterial({ color: '#ffffff' })
            );
            stemMesh.position.set(surfacePos.x, surfacePos.y + 0.95, surfacePos.z);
            poiGroup.add(stemMesh);

            const headMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.42, 16, 16),
              new THREE.MeshBasicMaterial({ color: pinColor })
            );
            headMesh.position.set(surfacePos.x, surfacePos.y + 1.95, surfacePos.z);
            poiGroup.add(headMesh);
          });
        }
      }

      // North compass badge anchor at the northern edge of the plinth
      anchors3DRef.current.north = new THREE.Vector3(
        0,
        1.2,
        -data.bounds.worldDepth / 2 - 3.2
      );
    }, [latLonToWorld]);

    // Smoothly frame the 3D Diorama in the viewport AND reset any paused/active flyover
    const focusSelectedRoute3D = useCallback(() => {
      resetAnimations();
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const data = dioramaDataRef.current;
      if (!camera || !controls || !data) return;

      const maxSpan = Math.max(data.bounds.worldWidth, data.bounds.worldDepth);
      const yOffset = hasBottomPanelRef.current ? -4.5 : 2.0;
      const toTarget = new THREE.Vector3(0, yOffset, 0);
      const toPos = new THREE.Vector3(
        maxSpan * 0.22,
        maxSpan * 0.68,
        maxSpan * 0.94
      );

      cameraTweenRef.current = {
        active: true,
        startTime: performance.now(),
        durationMs: 750,
        fromPos: camera.position.clone(),
        toPos,
        fromTarget: controls.target.clone(),
        toTarget,
      };
    }, [resetAnimations]);

    // Initialize Three.js WebGL scene, lighting, controls, and animation loop ONCE on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0f172a');
      sceneRef.current = scene;

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;

      const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 1000);
      camera.position.set(22, 68, 95);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.maxPolarAngle = Math.PI / 2 - 0.04; // Never dip below the diorama base table
      controls.minPolarAngle = 0.12;
      controls.minDistance = 24;
      controls.maxDistance = 230;
      controls.autoRotate = false;
      controls.autoRotateSpeed = 4.0; // ~24 deg/sec (15s per full 360° turntable rotation)
      controlsRef.current = controls;

      // Pause flyover or orbit if user manually grabs the diorama
      const handleControlStart = () => {
        if (isOrbitingRef.current || isFlyingRef.current) {
          pauseAnimations();
        } else {
          cameraTweenRef.current = null;
        }
      };
      controls.addEventListener('start', handleControlStart);

      // Studio lighting for crisp 3D relief shading
      const ambientLight = new THREE.HemisphereLight('#f8fafc', '#334155', 1.15);
      scene.add(ambientLight);

      const sunLight = new THREE.DirectionalLight('#fffbeb', 1.65);
      sunLight.position.set(-65, 95, 55);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.width = 2048;
      sunLight.shadow.mapSize.height = 2048;
      sunLight.shadow.camera.near = 10;
      sunLight.shadow.camera.far = 260;
      const d = 75;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.bias = -0.0005;
      scene.add(sunLight);

      const rimLight = new THREE.DirectionalLight('#38bdf8', 0.45);
      rimLight.position.set(70, 45, -70);
      scene.add(rimLight);

      // Main Diorama Group
      const dioramaGroup = new THREE.Group();
      scene.add(dioramaGroup);
      dioramaGroupRef.current = dioramaGroup;

      const plinthGroup = new THREE.Group();
      dioramaGroup.add(plinthGroup);
      plinthGroupRef.current = plinthGroup;

      const routesGroup = new THREE.Group();
      dioramaGroup.add(routesGroup);
      routesGroupRef.current = routesGroup;

      const poiGroup = new THREE.Group();
      dioramaGroup.add(poiGroup);
      poiGroupRef.current = poiGroup;

      // Hover Marker 3D Pin (for elevation profile hover)
      const hoverGroup = new THREE.Group();
      hoverGroup.visible = false;
      const hoverSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.68, 20, 20),
        new THREE.MeshBasicMaterial({ color: '#f59e0b' })
      );
      hoverSphere.position.y = 1.25;
      const hoverRing = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.3, 28),
        new THREE.MeshBasicMaterial({
          color: '#ffffff',
          side: THREE.DoubleSide,
        })
      );
      hoverRing.rotation.x = -Math.PI / 2;
      hoverRing.position.y = 0.2;
      const hoverStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 1.25, 8),
        new THREE.MeshBasicMaterial({ color: '#ffffff' })
      );
      hoverStem.position.y = 0.62;
      hoverGroup.add(hoverSphere, hoverRing, hoverStem);
      dioramaGroup.add(hoverGroup);
      hoverMeshGroupRef.current = hoverGroup;

      // Flyover Marker 3D Beacon
      const flyGroup = new THREE.Group();
      flyGroup.visible = false;
      const flySphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.75, 24, 24),
        new THREE.MeshBasicMaterial({ color: '#fbbf24' })
      );
      flySphere.position.y = 1.2;
      const flyHalo = new THREE.Mesh(
        new THREE.SphereGeometry(1.25, 20, 20),
        new THREE.MeshBasicMaterial({
          color: '#f59e0b',
          transparent: true,
          opacity: 0.38,
        })
      );
      flyHalo.position.y = 1.2;
      flyGroup.add(flySphere, flyHalo);
      dioramaGroup.add(flyGroup);
      flyMeshGroupRef.current = flyGroup;

      // Click raycasting on 3D route tubes
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      let pointerDownPos = { x: 0, y: 0 };

      const onPointerDown = (e: PointerEvent) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      };

      const onPointerUp = (e: PointerEvent) => {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (dist > 6 || !routesGroupRef.current || !onSelectRouteRef.current) return;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(routesGroupRef.current.children, false);
        if (hits.length > 0) {
          const ud = hits[0].object.userData;
          if (ud && ud.tripId !== undefined && ud.mapIndex !== undefined) {
            onSelectRouteRef.current(ud.tripId, ud.mapIndex);
          }
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          const h = entry.contentRect.height;
          if (w > 0 && h > 0) {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
          }
        }
      });
      resizeObserver.observe(container);

      // Project a 3D world vector onto 2D container pixel coordinates and update DOM element
      const projectBadge = (worldPos: THREE.Vector3 | null, el: HTMLDivElement | null) => {
        if (!el) return;
        if (!worldPos) {
          el.style.display = 'none';
          return;
        }
        const v = worldPos.clone().project(camera);
        if (v.z > 1 || v.z < -1) {
          el.style.display = 'none';
          return;
        }
        const cw = renderer.domElement.clientWidth;
        const ch = renderer.domElement.clientHeight;
        const px = (v.x * 0.5 + 0.5) * cw;
        const py = (-v.y * 0.5 + 0.5) * ch;
        el.style.display = 'flex';
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
      };

      let rafId = 0;
      const animate = (now: number) => {
        rafId = requestAnimationFrame(animate);

        // 1. Handle smooth camera tweening (e.g. Vycentrovat 3D or Naklopit/Shora)
        const tween = cameraTweenRef.current;
        if (tween && tween.active) {
          const t = Math.min(1, (now - tween.startTime) / tween.durationMs);
          const ease = 1 - Math.pow(1 - t, 3);
          camera.position.lerpVectors(tween.fromPos, tween.toPos, ease);
          controls.target.lerpVectors(tween.fromTarget, tween.toTarget, ease);
          if (t >= 1) {
            tween.active = false;
          }
        }

        // 2. Handle 3D Flyover along the route on the diorama
        const fly = flyStateRef.current;
        if (fly && fly.active) {
          const elapsed = now - fly.startTime + fly.elapsedOffsetMs;
          const t = Math.min(1, elapsed / fly.durationMs);
          const targetDist = t * fly.totalDist;

          let idx = 0;
          while (idx < fly.cumDist.length - 2 && fly.cumDist[idx + 1] < targetDist) {
            idx++;
          }
          const segStart = fly.cumDist[idx];
          const segEnd = fly.cumDist[idx + 1];
          const frac = segEnd > segStart ? (targetDist - segStart) / (segEnd - segStart) : 0;

          const p1 = fly.coords[idx];
          const p2 = fly.coords[idx + 1] || p1;
          const lat = p1[0] + (p2[0] - p1[0]) * frac;
          const lon = p1[1] + (p2[1] - p1[1]) * frac;
          const ele =
            typeof p1[2] === 'number' && typeof p2[2] === 'number'
              ? Math.round(p1[2] + (p2[2] - p1[2]) * frac)
              : typeof p1[2] === 'number'
              ? Math.round(p1[2])
              : null;

          const worldPt = latLonToWorld(lat, lon, 0.3);
          if (worldPt && flyMeshGroupRef.current) {
            flyMeshGroupRef.current.visible = true;
            flyMeshGroupRef.current.position.copy(worldPt);

            // Look ahead along the trail
            const lookIdx = Math.min(
              fly.coords.length - 1,
              idx + Math.max(6, Math.floor(fly.coords.length * 0.06))
            );
            const lookCoord = fly.coords[lookIdx];
            const lookWorld =
              latLonToWorld(lookCoord[0], lookCoord[1], 0.5) || worldPt.clone();

            const dir = lookWorld.clone().sub(worldPt);
            dir.y = 0;
            if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
            dir.normalize();

            // Place camera behind and above the hiker, slightly angled to show the diorama relief
            const desiredCamPos = worldPt
              .clone()
              .sub(dir.clone().multiplyScalar(28))
              .add(new THREE.Vector3(6, 22, 0));
            const desiredTarget = worldPt.clone().add(dir.clone().multiplyScalar(8));

            camera.position.lerp(desiredCamPos, 0.055);
            controls.target.lerp(desiredTarget, 0.08);
          }

          const currentProgress = {
            distKm: targetDist,
            eleM: ele,
            pct: Math.round(t * 100),
          };
          flySavedProgressRef.current = { t, progress: currentProgress };
          emitFlightState(true, false, currentProgress);

          if (t >= 1) {
            fly.active = false;
            flySavedProgressRef.current = null;
            emitFlightState(false, false, null);
          }
        }

        controls.update();
        renderer.render(scene, camera);

        // Update 2D projected overlay badges
        projectBadge(anchors3DRef.current.start, startBadgeRef.current);
        projectBadge(anchors3DRef.current.end, endBadgeRef.current);

        // Hide generic route peak badge if a named peak POI is within 200m of it
        const peakData = anchors3DRef.current.peak;
        let showGenericPeak = Boolean(peakData);
        if (peakData && showPoisRef.current && poisRef.current.length > 0) {
          const hasCloseNamedPeak = poisRef.current.some(
            (p) =>
              p.category === 'peak' &&
              calculateDistanceKm(peakData.lat, peakData.lon, p.lat, p.lon) < 0.22
          );
          if (hasCloseNamedPeak) {
            showGenericPeak = false;
          }
        }
        projectBadge(showGenericPeak ? peakData?.pos || null : null, peakBadgeRef.current);
        projectBadge(anchors3DRef.current.north, northBadgeRef.current);

        // Project POI badges
        poiBadgeRefs.current.forEach((el, id) => {
          if (!showPoisRef.current) {
            el.style.display = 'none';
            return;
          }
          const pos = anchors3DRef.current.pois.get(id) || null;
          projectBadge(pos, el);
        });
      };

      rafId = requestAnimationFrame(animate);

      return () => {
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        controls.removeEventListener('start', handleControlStart);
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
    }, [pauseAnimations, emitFlightState, latLonToWorld]);

    // Build / Rebuild the 3D Terrain Diorama when the route geometry changes
    const routeSignature = routes
      .map((r) => `${r.id}:${r.isSelected ? 1 : 0}:${r.coordinates.length}`)
      .join('|');

    useEffect(() => {
      let cancelled = false;
      const allCoords =
        selectedCoords.length >= 2
          ? selectedCoords
          : routes.flatMap((r) => r.coordinates);

      if (allCoords.length < 2) return;

      const buildDiorama = async () => {
        setIsLoadingDiorama(true);
        const bounds = computeDioramaBounds(allCoords);

        const [demResult, mapCanvas] = await Promise.all([
          fetchDioramaElevationGrid(bounds, allCoords),
          fetchDioramaMapCanvas(bounds, baseStyle),
        ]);

        if (cancelled) return;

        dioramaDataRef.current = {
          bounds,
          heights: demResult.heights,
          minEle: demResult.minEle,
          maxEle: demResult.maxEle,
        };

        const dioramaGroup = dioramaGroupRef.current;
        const renderer = rendererRef.current;
        if (!dioramaGroup || !renderer) return;

        // 1. Create or replace Top Terrain Surface Mesh
        if (terrainMeshRef.current) {
          dioramaGroup.remove(terrainMeshRef.current);
          terrainMeshRef.current.geometry.dispose();
          const oldMat = terrainMeshRef.current.material as THREE.MeshStandardMaterial;
          oldMat.map?.dispose();
          oldMat.dispose();
          terrainMeshRef.current = null;
        }

        const planeGeom = new THREE.PlaneGeometry(
          bounds.worldWidth,
          bounds.worldDepth,
          GRID_SEGMENTS,
          GRID_SEGMENTS
        );
        planeGeom.rotateX(-Math.PI / 2);

        const posAttr = planeGeom.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
          const ele = demResult.heights[i];
          const y =
            BASE_SOIL_THICKNESS +
            Math.max(0, ele - demResult.minEle) *
              bounds.metersToWorld *
              exaggerationRef.current;
          posAttr.setY(i, y);
        }
        planeGeom.computeVertexNormals();

        const mapTexture = new THREE.CanvasTexture(mapCanvas);
        mapTexture.colorSpace = THREE.SRGBColorSpace;
        mapTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        mapTexture.minFilter = THREE.LinearMipmapLinearFilter;
        mapTexture.magFilter = THREE.LinearFilter;

        const terrainMat = new THREE.MeshStandardMaterial({
          map: mapTexture,
          roughness: 0.78,
          metalness: 0.04,
        });

        const terrainMesh = new THREE.Mesh(planeGeom, terrainMat);
        terrainMesh.receiveShadow = true;
        terrainMesh.castShadow = true;
        dioramaGroup.add(terrainMesh);
        terrainMeshRef.current = terrainMesh;

        // 2. Create 4 Geological Cross-Section Side Walls
        if (wallsMeshRef.current) {
          dioramaGroup.remove(wallsMeshRef.current);
          wallsMeshRef.current.geometry.dispose();
          (wallsMeshRef.current.material as THREE.Material).dispose();
          wallsMeshRef.current = null;
        }

        const wallsGeom = buildDioramaWallsGeometry(
          bounds,
          demResult.heights,
          demResult.minEle,
          exaggerationRef.current
        );
        const wallsMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.88,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        const wallsMesh = new THREE.Mesh(wallsGeom, wallsMat);
        wallsMesh.castShadow = true;
        wallsMesh.receiveShadow = true;
        dioramaGroup.add(wallsMesh);
        wallsMeshRef.current = wallsMesh;

        // 3. Create Dark Slate Plinth / Pedestal Base Frame
        const plinthGroup = plinthGroupRef.current;
        if (plinthGroup) {
          while (plinthGroup.children.length > 0) {
            const c = plinthGroup.children[0] as THREE.Mesh;
            plinthGroup.remove(c);
            c.geometry?.dispose();
            (c.material as THREE.Material)?.dispose();
          }

          const plinthGeom = new THREE.BoxGeometry(
            bounds.worldWidth + 3.2,
            2.2,
            bounds.worldDepth + 3.2
          );
          const plinthMat = new THREE.MeshStandardMaterial({
            color: '#1e293b',
            roughness: 0.5,
            metalness: 0.25,
          });
          const plinthMesh = new THREE.Mesh(plinthGeom, plinthMat);
          plinthMesh.position.y = -1.1;
          plinthMesh.receiveShadow = true;
          plinthMesh.castShadow = true;
          plinthGroup.add(plinthMesh);

          // Subtle gold/amber trim rim around the diorama base
          const rimGeom = new THREE.BoxGeometry(
            bounds.worldWidth + 0.6,
            0.35,
            bounds.worldDepth + 0.6
          );
          const rimMat = new THREE.MeshStandardMaterial({
            color: '#b45309',
            roughness: 0.4,
            metalness: 0.4,
          });
          const rimMesh = new THREE.Mesh(rimGeom, rimMat);
          rimMesh.position.y = 0.02;
          plinthGroup.add(rimMesh);
        }

        // 4. Build 3D routes and markers, then frame the camera
        rebuildRoutesAndAnchors();
        focusSelectedRoute3D();
        setIsLoadingDiorama(false);
      };

      buildDiorama();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeSignature]);

    // Update ONLY the draped map texture when baseStyle changes (instant, keeps camera & geometry intact)
    useEffect(() => {
      let cancelled = false;
      const data = dioramaDataRef.current;
      if (!data || !terrainMeshRef.current || !rendererRef.current) return;

      fetchDioramaMapCanvas(data.bounds, baseStyle).then((canvas) => {
        if (cancelled || !terrainMeshRef.current || !rendererRef.current) return;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = rendererRef.current.capabilities.getMaxAnisotropy();

        const mat = terrainMeshRef.current.material as THREE.MeshStandardMaterial;
        const oldTex = mat.map;
        mat.map = tex;
        mat.needsUpdate = true;
        oldTex?.dispose();
      });

      return () => {
        cancelled = true;
      };
    }, [baseStyle]);

    // Update terrain vertical exaggeration in real-time when user clicks 1x / 1.4x / 2x
    useEffect(() => {
      const data = dioramaDataRef.current;
      const terrainMesh = terrainMeshRef.current;
      const dioramaGroup = dioramaGroupRef.current;
      if (!data || !terrainMesh || !dioramaGroup) return;

      const posAttr = terrainMesh.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const ele = data.heights[i];
        const y =
          BASE_SOIL_THICKNESS +
          Math.max(0, ele - data.minEle) * data.bounds.metersToWorld * exaggeration;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
      terrainMesh.geometry.computeVertexNormals();

      if (wallsMeshRef.current) {
        wallsMeshRef.current.geometry.dispose();
        wallsMeshRef.current.geometry = buildDioramaWallsGeometry(
          data.bounds,
          data.heights,
          data.minEle,
          exaggeration
        );
      }

      rebuildRoutesAndAnchors();
    }, [exaggeration, rebuildRoutesAndAnchors]);

    // Synchronize hover marker from bottom elevation profile chart WITHOUT resetting camera
    useEffect(() => {
      const hoverGroup = hoverMeshGroupRef.current;
      if (!hoverGroup) return;

      if (!hoveredCoord) {
        hoverGroup.visible = false;
        return;
      }

      const worldPos = latLonToWorld(hoveredCoord[0], hoveredCoord[1], 0.35);
      if (worldPos) {
        hoverGroup.position.copy(worldPos);
        hoverGroup.visible = true;
      } else {
        hoverGroup.visible = false;
      }
    }, [hoveredCoord, latLonToWorld]);

    // Virtual 3D Flyover along the selected route on the diorama (supports pause & resume)
    const handleToggleFlyover = useCallback(() => {
      const coords = selectedCoordsRef.current;
      if (coords.length < 2) return;

      // If currently flying, pause at current position (do NOT reset to start!)
      if (isFlyingRef.current) {
        pauseAnimations();
        return;
      }

      pauseAnimations();

      const cumDist: number[] = [0];
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        cumDist.push(
          cumDist[i - 1] + calculateDistanceKm(prev[0], prev[1], curr[0], curr[1])
        );
      }
      const totalDist = cumDist[cumDist.length - 1] || 1;
      const durationMs = Math.min(95000, Math.max(32000, totalDist * 2800));

      const saved = flySavedProgressRef.current;
      const resumeT = saved && saved.t > 0 && saved.t < 1 ? saved.t : 0;
      const elapsedOffsetMs = resumeT * durationMs;

      flyStateRef.current = {
        active: true,
        startTime: performance.now(),
        elapsedOffsetMs,
        durationMs,
        coords,
        cumDist,
        totalDist,
      };

      emitFlightState(
        true,
        false,
        saved?.progress ?? { distKm: 0, eleM: null, pct: 0 }
      );
    }, [pauseAnimations, emitFlightState]);

    // 360° Turntable Orbit around the 3D Diorama
    const handleToggleOrbit = useCallback(() => {
      const controls = controlsRef.current;
      if (!controls) return;

      if (isOrbitingRef.current) {
        pauseAnimations();
        return;
      }

      pauseAnimations();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 4.0;
      emitFlightState(false, true, flySavedProgressRef.current?.progress ?? null);
    }, [pauseAnimations, emitFlightState]);

    // Rebuild POI pins when `pois` or `showPois` changes
    useEffect(() => {
      if (!dioramaDataRef.current) return;
      rebuildRoutesAndAnchors();
    }, [pois, showPois, rebuildRoutesAndAnchors]);

    // Smoothly focus camera onto a specific geographic point (e.g. a clicked peak or POI)
    const handleFocusLocation = useCallback(
      (lat: number, lon: number) => {
        pauseAnimations();
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const targetWorld = latLonToWorld(lat, lon, 1.0);
        if (!camera || !controls || !targetWorld) return;

        const currentDir = camera.position.clone().sub(controls.target);
        currentDir.y = Math.max(24, currentDir.y);
        currentDir.setLength(Math.min(58, Math.max(34, currentDir.length() * 0.65)));

        const toPos = targetWorld.clone().add(currentDir);
        cameraTweenRef.current = {
          active: true,
          startTime: performance.now(),
          durationMs: 650,
          fromPos: camera.position.clone(),
          toPos,
          fromTarget: controls.target.clone(),
          toTarget: targetWorld,
        };
      },
      [pauseAnimations, latLonToWorld]
    );

    // Adjust camera tilt (Naklopit / Shora)
    const handleAdjustPitch = useCallback((deltaDeg: number) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;

      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const deltaRad = (deltaDeg * Math.PI) / 180;
      spherical.phi = Math.max(0.18, Math.min(Math.PI / 2 - 0.08, spherical.phi + deltaRad));
      offset.setFromSpherical(spherical);

      cameraTweenRef.current = {
        active: true,
        startTime: performance.now(),
        durationMs: 320,
        fromPos: camera.position.clone(),
        toPos: controls.target.clone().add(offset),
        fromTarget: controls.target.clone(),
        toTarget: controls.target.clone(),
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        toggleFlyover: handleToggleFlyover,
        toggleOrbit: handleToggleOrbit,
        focusRoute: focusSelectedRoute3D,
        adjustPitch: handleAdjustPitch,
        focusLocation: handleFocusLocation,
      }),
      [
        handleToggleFlyover,
        handleToggleOrbit,
        focusSelectedRoute3D,
        handleAdjustPitch,
        handleFocusLocation,
      ]
    );

    const getPoiIcon = (cat: DioramaPOICategory) => {
      switch (cat) {
        case 'peak':
          return '⛰️';
        case 'viewpoint':
          return '🔭';
        case 'hut':
          return '🏡';
        case 'saddle':
          return '🚩';
        case 'historic':
          return '🏰';
        case 'spring':
          return '💧';
      }
    };

    return (
      <div className="w-full h-full relative bg-radial from-slate-800 via-slate-900 to-slate-950 overflow-hidden select-none">
        {/* Three.js 3D Diorama Canvas Container */}
        <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* Projected 3D Overlay Markers (START, CÍL, Peak, POIs, North Compass) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-[400]">
          {/* Significant Peaks & POIs along the route */}
          {showPois &&
            pois.map((poi) => {
              const isHighlighted = highlightedPoiId === poi.id;
              const isPeak = poi.category === 'peak';
              return (
                <div
                  key={poi.id}
                  ref={(el) => {
                    if (el) {
                      poiBadgeRefs.current.set(poi.id, el);
                    } else {
                      poiBadgeRefs.current.delete(poi.id);
                    }
                  }}
                  style={{ display: 'none' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFocusLocation(poi.lat, poi.lon);
                    onSelectPoi?.(poi);
                  }}
                  className={`pointer-events-auto cursor-pointer absolute top-0 left-0 px-2 py-0.5 rounded-lg text-[10px] font-extrabold shadow-lg border whitespace-nowrap items-center gap-1 transition-colors ${
                    isHighlighted
                      ? 'bg-amber-400 text-slate-950 border-white ring-2 ring-amber-300 z-30 scale-110'
                      : isPeak
                      ? 'bg-slate-900/92 hover:bg-slate-800 text-amber-300 border-amber-400/75 z-20'
                      : 'bg-slate-900/88 hover:bg-slate-800 text-sky-200 border-slate-500/80 z-10'
                  }`}
                  title={`${poi.name}${poi.ele ? ` (${poi.ele} m n.m.)` : ''} – kliknutím přiblížíte`}
                >
                  <span>{getPoiIcon(poi.category)}</span>
                  <span>{poi.name}</span>
                  {poi.ele ? (
                    <span
                      className={
                        isHighlighted
                          ? 'text-slate-800 font-bold'
                          : 'text-slate-300 font-semibold'
                      }
                    >
                      · {poi.ele} m
                    </span>
                  ) : null}
                </div>
              );
            })}

          <div
            ref={startBadgeRef}
            style={{ display: 'none' }}
            className="absolute top-0 left-0 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold shadow-lg border-2 border-white whitespace-nowrap z-30"
          >
            START
          </div>

          <div
            ref={endBadgeRef}
            style={{ display: 'none' }}
            className="absolute top-0 left-0 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold shadow-lg border-2 border-white whitespace-nowrap z-30"
          >
            CÍL
          </div>

          <div
            ref={peakBadgeRef}
            style={{ display: 'none' }}
            className="absolute top-0 left-0 px-2.5 py-1 rounded-xl bg-slate-900/90 text-amber-300 text-[11px] font-extrabold shadow-xl border border-amber-400/70 whitespace-nowrap items-center gap-1 z-25"
          >
            <span>🏔️</span>
            <span>{peakElevationLabel ?? ''} m n.m.</span>
          </div>

          <div
            ref={northBadgeRef}
            style={{ display: 'none' }}
            className="absolute top-0 left-0 px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[10px] font-bold border border-slate-600/80 shadow-md whitespace-nowrap"
          >
            ▲ SEVER
          </div>
        </div>

        {/* Subtle loading badge while fetching the ~3x3 DEM & map tiles for the diorama */}
        {isLoadingDiorama && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[450] bg-slate-900/90 backdrop-blur-md text-emerald-300 border border-emerald-500/40 px-4 py-2 rounded-xl shadow-xl text-xs font-bold flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span>Modeluji 3D diorámu terénu…</span>
          </div>
        )}
      </div>
    );
  }
);
