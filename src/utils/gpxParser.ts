import { Coordinate, RoutePart } from '../types';

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

export function calculateCoordsDistanceKm(coords?: Coordinate[]): number {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += calculateDistanceKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return total;
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
    const gpxDist = calculateCoordsDistanceKm(part.coordinates);
    if (gpxDist > 0) {
      return Math.round(gpxDist * 10) / 10;
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
