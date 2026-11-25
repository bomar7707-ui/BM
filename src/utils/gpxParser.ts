import { Coordinate, RoutePart } from '../types';

/**
 * Threshold (in km) between two separate route parts (Úsek 1 -> Úsek 2)
 * above which the transition is considered a non-contiguous transfer ("Přejezd").
 */
export const INTER_SEGMENT_TRANSFER_THRESHOLD_KM = 0.25;

export type ElevationSlopeCat = 'flat' | 'std' | 'steep' | 'extreme' | 'transfer';
export type SlopeCategory = ElevationSlopeCat;

export interface ElevationProfilePoint {
  /** Cumulative walked distance in km (excludes Přejezd distances) */
  dist: number;
  /** Position along the X-axis of the chart (includes visual span for Přejezd segments) */
  plotDist: number;
  ele: number;
  rawEle: number;
  gradePct: number;
  slopeCat: ElevationSlopeCat;
  coord: [number, number];
  isTransfer: boolean;
  transferDistKm?: number;
}

export interface ElevationTransferRange {
  startPlotDist: number;
  endPlotDist: number;
  startXPct: number;
  endXPct: number;
  midXPct: number;
  midYPct: number;
  startEle: number;
  endEle: number;
  transferDistKm: number;
  walkedDistAtTransfer: number;
}

export interface ElevationProfileData {
  title: string;
  ascent: number;
  descent: number;
  maxEle: number;
  minEle: number;
  totalWalkedDist: number;
  totalPlotDist: number;
  hasTransfers: boolean;
  transferCount: number;
  transfers: ElevationTransferRange[];
  points: ElevationProfilePoint[];
}

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Checks whether the transition between the end of one route segment (Úsek i)
 * and the start of the next route segment (Úsek i+1) is a non-contiguous Přejezd.
 */
export function isTransferStep(
  p1: [number, number, number?],
  p2: [number, number, number?],
  isBetweenSegments = true
): boolean {
  if (!isBetweenSegments) return false;
  const dKm = calculateDistanceKm(p1[0], p1[1], p2[0], p2[1]);
  return dKm > INTER_SEGMENT_TRANSFER_THRESHOLD_KM;
}

/**
 * A single GPX track (RoutePart) is always a single connected route.
 */
export function splitIntoContiguousSegments(coords?: Coordinate[]): Coordinate[][] {
  if (!coords || coords.length === 0) return [];
  return [coords];
}

/**
 * Calculates walked distance along a single GPX coordinate array.
 */
export function calculateCoordsDistanceKm(coords?: Coordinate[]): number {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += calculateDistanceKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

export function calculateRawCoordsDistanceKm(coords?: Coordinate[]): number {
  return calculateCoordsDistanceKm(coords);
}

export function getSegmentDistanceKm(
  part: RoutePart,
  totalRoutesCount = 1,
  fallbackTripDistance?: number | string
): number | null {
  if (part.distance !== undefined && part.distance !== '') {
    const parsed =
      typeof part.distance === 'number' ? part.distance : parseFloat(String(part.distance));
    if (!isNaN(parsed) && parsed > 0) {
      return Math.round(parsed * 10) / 10;
    }
  }
  if (part.coordinates && part.coordinates.length >= 2) {
    const calc = calculateCoordsDistanceKm(part.coordinates);
    if (calc > 0) {
      return Math.round(calc * 10) / 10;
    }
  }
  if (totalRoutesCount === 1 && fallbackTripDistance !== undefined) {
    const fb =
      typeof fallbackTripDistance === 'number'
        ? fallbackTripDistance
        : parseFloat(String(fallbackTripDistance));
    if (!isNaN(fb) && fb > 0) {
      return Math.round(fb * 10) / 10;
    }
  }
  return null;
}

/**
 * Returns the effective walked distance (in km) of a Hike or PlannedRoute,
 * automatically excluding any non-contiguous Přejezd transfers between separate route segments.
 */
export function getEffectiveHikeDistanceKm(trip: {
  distance?: number | string;
  routes?: RoutePart[];
  maps?: RoutePart[];
  coordinates?: Coordinate[];
}): number {
  const storedRaw =
    typeof trip.distance === 'number'
      ? trip.distance
      : parseFloat(String(trip.distance ?? '0').replace(',', '.'));
  const storedDist = !isNaN(storedRaw) && storedRaw > 0 ? storedRaw : 0;

  if (storedDist > 0) {
    return Math.round(storedDist * 10) / 10;
  }

  const routes =
    trip.routes && trip.routes.length > 0
      ? trip.routes
      : trip.maps && trip.maps.length > 0
      ? trip.maps
      : trip.coordinates && trip.coordinates.length > 0
      ? [{ coordinates: trip.coordinates }]
      : [];

  if (routes.length === 0) {
    return 0;
  }

  let segmentsSum = 0;
  let walkedGpxSum = 0;

  for (const r of routes) {
    const segKm = getSegmentDistanceKm(r, routes.length);
    if (segKm !== null && segKm > 0) {
      segmentsSum += segKm;
    }
    if (r.coordinates && r.coordinates.length >= 2) {
      walkedGpxSum += calculateCoordsDistanceKm(r.coordinates);
    }
  }

  return Math.round((segmentsSum > 0 ? segmentsSum : walkedGpxSum) * 10) / 10;
}

/**
 * Computes elevation ascent, descent, maxEle, and minEle across route segments,
 * strictly excluding all Přejezd transfers between separate segments.
 */
export function computeRouteElevationStats(
  routes: { coordinates?: Coordinate[]; visible?: boolean }[],
  isSegmentHidden?: (idx: number) => boolean
): {
  ascent: number;
  descent: number;
  maxEle: number | null;
  minEle: number | null;
  walkedGpxKm: number;
} {
  let ascent = 0;
  let descent = 0;
  let maxEle = -Infinity;
  let minEle = Infinity;
  let walkedGpxKm = 0;

  routes.forEach((r, idx) => {
    if (r.visible === false || isSegmentHidden?.(idx)) return;
    if (!r.coordinates || r.coordinates.length === 0) return;

    let prevEle: number | null = null;
    for (let i = 0; i < r.coordinates.length; i++) {
      const pt = r.coordinates[i];
      if (i > 0) {
        walkedGpxKm += calculateDistanceKm(
          r.coordinates[i - 1][0],
          r.coordinates[i - 1][1],
          pt[0],
          pt[1]
        );
      }
      const ele =
        pt.length >= 3 && typeof pt[2] === 'number' && !isNaN(pt[2]) ? pt[2] : null;
      if (ele !== null) {
        if (ele > maxEle) maxEle = ele;
        if (ele < minEle) minEle = ele;
        if (prevEle !== null) {
          const diff = ele - prevEle;
          if (diff > 0) ascent += diff;
          else descent += Math.abs(diff);
        }
        prevEle = ele;
      }
    }
  });

  return {
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    maxEle: maxEle !== -Infinity ? Math.round(maxEle) : null,
    minEle: minEle !== Infinity ? Math.round(minEle) : null,
    walkedGpxKm,
  };
}

/**
 * Builds elevation profile data for MapView, PlannedRoutesView, and Route3DView.
 * Each group in `routeCoordGroups` is one connected GPX segment (Úsek).
 * Any non-contiguous transition ("Přejezd") between separate segments (> 250 m apart)
 * is marked with `slopeCat: 'transfer'`, rendered in black with the label "Přejezd",
 * and excluded from ascent, descent, and walked distance statistics.
 */
export function computeElevationProfileData(
  routeCoordGroups: Coordinate[][],
  title: string
): ElevationProfileData | null {
  // 1. Keep each route part (GPX track) intact as a single connected segment, filtering to points with valid elevation
  const rawSubSegments: Coordinate[][] = [];
  for (const group of routeCoordGroups) {
    if (!group || group.length === 0) continue;
    const withEle = group.filter(
      (p) => p.length >= 3 && typeof p[2] === 'number' && !isNaN(p[2] as number)
    );
    if (withEle.length >= 2) {
      rawSubSegments.push(withEle);
    }
  }

  if (rawSubSegments.length === 0) return null;

  // 2. Merge adjacent route parts if their endpoints connect (distance <= 250 m);
  //    keep them separate if they do not connect (Přejezd > 250 m).
  const contiguousSegments: Coordinate[][] = [rawSubSegments[0]];
  for (let i = 1; i < rawSubSegments.length; i++) {
    const prevSeg = contiguousSegments[contiguousSegments.length - 1];
    const nextSeg = rawSubSegments[i];
    const lastPt = prevSeg[prevSeg.length - 1];
    const firstPt = nextSeg[0];

    if (!isTransferStep(lastPt, firstPt, true)) {
      // Segments connect continuously on foot
      contiguousSegments[contiguousSegments.length - 1] = prevSeg.concat(nextSeg);
    } else {
      contiguousSegments.push(nextSeg);
    }
  }

  // Estimate total walked distance to bound extreme transfer visual widths
  let estimatedWalkedKm = 0;
  for (const seg of contiguousSegments) {
    for (let i = 1; i < seg.length; i++) {
      estimatedWalkedKm += calculateDistanceKm(
        seg[i - 1][0],
        seg[i - 1][1],
        seg[i][0],
        seg[i][1]
      );
    }
  }

  let walkedDist = 0;
  let plotDist = 0;
  let ascent = 0;
  let descent = 0;
  let maxEle = -Infinity;
  let minEle = Infinity;

  const allPoints: ElevationProfilePoint[] = [];
  const rawTransfers: {
    startPlotDist: number;
    endPlotDist: number;
    startEle: number;
    endEle: number;
    transferDistKm: number;
    walkedDistAtTransfer: number;
  }[] = [];

  for (let sIdx = 0; sIdx < contiguousSegments.length; sIdx++) {
    const seg = contiguousSegments[sIdx];

    // If sIdx > 0, there is a non-contiguous Přejezd between contiguousSegments[sIdx - 1] and seg
    if (sIdx > 0) {
      const prevSeg = contiguousSegments[sIdx - 1];
      const prevLast = prevSeg[prevSeg.length - 1];
      const nextFirst = seg[0];
      const startEle = prevLast[2] as number;
      const endEle = nextFirst[2] as number;
      const transferKm = calculateDistanceKm(
        prevLast[0],
        prevLast[1],
        nextFirst[0],
        nextFirst[1]
      );

      // Visual width on the chart X-axis so the black Přejezd line & label are clearly visible
      const maxVisualTransferSpan = Math.max(estimatedWalkedKm * 0.65, 25);
      const minVisualTransferSpan = Math.max(estimatedWalkedKm * 0.045, 0.4);
      const transferPlotSpan = Math.max(
        minVisualTransferSpan,
        Math.min(transferKm, maxVisualTransferSpan)
      );

      const startPlotDist = plotDist;
      const endPlotDist = plotDist + transferPlotSpan;

      rawTransfers.push({
        startPlotDist,
        endPlotDist,
        startEle,
        endEle,
        transferDistKm: transferKm,
        walkedDistAtTransfer: walkedDist,
      });

      // Insert interpolated points along the Přejezd so hover & SVG run grouping work smoothly.
      // IMPORTANT: walkedDist, ascent, and descent are NOT incremented during a Přejezd!
      const INTERP_STEPS = 16;
      for (let step = 1; step <= INTERP_STEPS; step++) {
        const frac = step / INTERP_STEPS;
        const interpPlotDist = startPlotDist + transferPlotSpan * frac;
        const interpRawEle = startEle + (endEle - startEle) * frac;
        const interpLat = prevLast[0] + (nextFirst[0] - prevLast[0]) * frac;
        const interpLon = prevLast[1] + (nextFirst[1] - prevLast[1]) * frac;

        allPoints.push({
          dist: walkedDist,
          plotDist: interpPlotDist,
          ele: Math.round(interpRawEle),
          rawEle: interpRawEle,
          gradePct: 0,
          slopeCat: 'transfer',
          coord: [interpLat, interpLon],
          isTransfer: true,
          transferDistKm: transferKm,
        });
      }

      plotDist = endPlotDist;
    }

    // Build raw points for this contiguous hiking segment
    const segRaw: {
      dist: number;
      plotDist: number;
      ele: number;
      rawEle: number;
      coord: [number, number];
    }[] = [];

    for (let i = 0; i < seg.length; i++) {
      const curr = seg[i];
      const ele = curr[2] as number;
      if (i > 0) {
        const prev = seg[i - 1];
        const stepKm = calculateDistanceKm(prev[0], prev[1], curr[0], curr[1]);
        walkedDist += stepKm;
        plotDist += stepKm;

        const diff = ele - (prev[2] as number);
        if (diff > 0) ascent += diff;
        else descent += Math.abs(diff);
      }
      if (ele > maxEle) maxEle = ele;
      if (ele < minEle) minEle = ele;

      segRaw.push({
        dist: walkedDist,
        plotDist,
        ele: Math.round(ele),
        rawEle: ele,
        coord: [curr[0], curr[1]],
      });
    }

    // Calculate terrain slope grade (%) within this contiguous segment ONLY (never looking across Přejezdy)
    for (let idx = 0; idx < segRaw.length; idx++) {
      // If sIdx > 0 and idx === 0, the end of the Přejezd already placed the point at seg[0]
      // with slopeCat: 'transfer' so the black line connects to seg[0]. Skip duplicate idx === 0.
      if (sIdx > 0 && idx === 0) continue;

      const pt = segRaw[idx];
      if (idx === 0) {
        allPoints.push({
          ...pt,
          gradePct: 0,
          slopeCat: 'flat',
          isTransfer: false,
        });
        continue;
      }

      let startIdx = idx - 1;
      while (startIdx > 0 && pt.dist - segRaw[startIdx].dist < 0.04) {
        startIdx--;
      }
      const dMeters = (pt.dist - segRaw[startIdx].dist) * 1000;
      const eleDiff = pt.rawEle - segRaw[startIdx].rawEle;
      const gradePct = dMeters > 1 ? (eleDiff / dMeters) * 100 : 0;
      const absGrade = Math.abs(gradePct);

      let slopeCat: ElevationSlopeCat = 'flat';
      if (absGrade >= 20) slopeCat = 'extreme';
      else if (absGrade >= 10) slopeCat = 'steep';
      else if (absGrade >= 5) slopeCat = 'std';

      allPoints.push({
        ...pt,
        gradePct,
        slopeCat,
        isTransfer: false,
      });
    }
  }

  if (allPoints.length < 2 || maxEle === -Infinity || minEle === Infinity) {
    return null;
  }

  const totalPlotDist = allPoints[allPoints.length - 1]?.plotDist || 1;
  const eleRange = maxEle - minEle || 1;

  const transfers: ElevationTransferRange[] = rawTransfers.map((tr) => {
    const startXPct = totalPlotDist > 0 ? (tr.startPlotDist / totalPlotDist) * 100 : 0;
    const endXPct = totalPlotDist > 0 ? (tr.endPlotDist / totalPlotDist) * 100 : 0;
    const midXPct = (startXPct + endXPct) / 2;
    const midEle = (tr.startEle + tr.endEle) / 2;
    const midYPct = 92 - ((midEle - minEle) / eleRange) * 84;
    return {
      ...tr,
      startXPct,
      endXPct,
      midXPct,
      midYPct,
    };
  });

  return {
    title,
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    maxEle: Math.round(maxEle),
    minEle: Math.round(minEle),
    totalWalkedDist: walkedDist,
    totalPlotDist,
    hasTransfers: transfers.length > 0,
    transferCount: transfers.length,
    transfers,
    points: allPoints,
  };
}

export function parseGpxXml(xmlString?: string | null): Coordinate[] {
  if (!xmlString || typeof xmlString !== 'string') return [];
  try {
    const cleanXml = xmlString.trim().replace(/^\uFEFF/, '');
    const xmlDoc = new DOMParser().parseFromString(cleanXml, 'text/xml');

    const coords: Coordinate[] = [];
    const allPts = xmlDoc.querySelectorAll('trkpt, wpt, rtept, TRKPT, WPT, RTEPT');

    allPts.forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') || pt.getAttribute('LAT') || '');
      const lon = parseFloat(
        pt.getAttribute('lon') ||
          pt.getAttribute('lng') ||
          pt.getAttribute('LON') ||
          pt.getAttribute('LNG') ||
          ''
      );

      let ele: number | null = null;
      const eleNodes = ['ele', 'ELE', 'elevation', 'ELEVATION'];
      for (const eleTag of eleNodes) {
        const eleEl = pt.getElementsByTagName(eleTag)[0];
        if (eleEl && eleEl.textContent) {
          const parsed = parseFloat(eleEl.textContent);
          if (!isNaN(parsed)) {
            ele = parsed;
            break;
          }
        }
      }

      if (!isNaN(lat) && !isNaN(lon)) {
        if (ele !== null && !isNaN(ele)) {
          coords.push([lat, lon, ele]);
        } else {
          coords.push([lat, lon]);
        }
      }
    });

    if (coords.length === 0) {
      const coordNodes = xmlDoc.querySelectorAll('coordinates, COORDINATES');
      coordNodes.forEach((node) => {
        const text = node.textContent || '';
        const parts = text.trim().split(/\s+/);
        parts.forEach((p) => {
          const c = p.split(',');
          if (c.length >= 2) {
            const lon = parseFloat(c[0]);
            const lat = parseFloat(c[1]);
            const ele = c.length >= 3 ? parseFloat(c[2]) : null;
            if (!isNaN(lat) && !isNaN(lon)) {
              if (ele !== null && !isNaN(ele)) {
                coords.push([lat, lon, ele]);
              } else {
                coords.push([lat, lon]);
              }
            }
          }
        });
      });
    }

    return coords;
  } catch (e) {
    console.warn('GPX parse error:', e);
    return [];
  }
}

export function normalizeCoords(arr: unknown): Coordinate[] {
  if (!Array.isArray(arr)) return [];
  const result: Coordinate[] = [];

  for (const pt of arr) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const lat = parseFloat(pt[0]);
      const lon = parseFloat(pt[1]);
      const ele = pt[2] !== undefined ? parseFloat(pt[2]) : null;
      if (!isNaN(lat) && !isNaN(lon)) {
        if (ele !== null && !isNaN(ele)) {
          result.push([lat, lon, ele]);
        } else {
          result.push([lat, lon]);
        }
      }
    } else if (pt && typeof pt === 'object') {
      const p = pt as Record<string, unknown>;
      const lat = parseFloat(String(p.lat !== undefined ? p.lat : p.latitude));
      const lon = parseFloat(
        String(p.lon !== undefined ? p.lon : p.lng !== undefined ? p.lng : p.longitude)
      );
      const ele = parseFloat(
        String(p.ele !== undefined ? p.ele : p.elevation !== undefined ? p.elevation : p.alt)
      );
      if (!isNaN(lat) && !isNaN(lon)) {
        if (!isNaN(ele)) {
          result.push([lat, lon, ele]);
        } else {
          result.push([lat, lon]);
        }
      }
    }
  }

  return result;
}

export async function resolveGpxVal(val: unknown): Promise<Coordinate[]> {
  if (!val) return [];
  if (Array.isArray(val)) return normalizeCoords(val);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const inner =
      obj.coordinates ||
      obj.coords ||
      obj.points ||
      obj.latlngs ||
      obj.gpx ||
      obj.data ||
      obj.file;
    if (inner && inner !== val) return await resolveGpxVal(inner);
    return [];
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    if (
      trimmed.includes('<gpx') ||
      trimmed.includes('<trk') ||
      trimmed.includes('<?xml') ||
      trimmed.includes('<kml')
    ) {
      return parseGpxXml(trimmed);
    }
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return await resolveGpxVal(JSON.parse(trimmed));
      } catch {
        // ignore
      }
    }
    if (trimmed.startsWith('data:')) {
      const commaIdx = trimmed.indexOf(',');
      if (commaIdx !== -1) {
        const meta = trimmed.substring(0, commaIdx);
        const content = trimmed.substring(commaIdx + 1);
        if (meta.includes('base64')) {
          try {
            return parseGpxXml(atob(content));
          } catch {
            // ignore
          }
        } else {
          try {
            return parseGpxXml(decodeURIComponent(content));
          } catch {
            // ignore
          }
        }
      }
      return [];
    }

    try {
      const decoded = atob(trimmed.replace(/\s/g, ''));
      if (
        decoded.includes('<gpx') ||
        decoded.includes('<trk') ||
        decoded.includes('<?xml') ||
        decoded.includes('<kml')
      ) {
        return parseGpxXml(decoded);
      }
    } catch {
      // ignore
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        let res = await fetch(trimmed);
        if (!res.ok) res = await fetch('https://corsproxy.io/?' + encodeURIComponent(trimmed));
        if (res.ok) return parseGpxXml(await res.text());
      } catch {
        try {
          const proxyRes = await fetch('https://corsproxy.io/?' + encodeURIComponent(trimmed));
          if (proxyRes.ok) return parseGpxXml(await proxyRes.text());
        } catch {
          // ignore
        }
      }
    }
  }
  return [];
}
