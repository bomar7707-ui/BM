import { Coordinate } from '../types';
import { calculateDistanceKm } from '../utils/gpxParser';

const MAPY_CZ_API_KEY = '3SfstVBaZryBHeEkOsw_DSAc8PwcV140TQvNslWDrQY';

const QLEVER_ENDPOINTS = [
  'https://qlever.dev/api/osm-planet',
  'https://qlever.cs.uni-freiburg.de/api/osm-planet',
];

const OVERPASS_FALLBACK_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type AccommodationCategory =
  | 'alpine_hut'
  | 'guest_house'
  | 'hostel'
  | 'camp_site'
  | 'chalet'
  | 'hotel'
  | 'apartment';

export type PetPolicy = 'confirmed' | 'unverified' | 'excluded';
export type OneNightPolicy = 'ideal' | 'likely' | 'rental_unverified' | 'excluded';

export interface AccommodationPlace {
  id: string;
  name: string;
  category: AccommodationCategory;
  categoryLabel: string;
  lat: number;
  lon: number;
  distanceKm: number;
  elevationM?: number | null;
  address?: string;
  city?: string;
  phone?: string;
  website?: string;
  email?: string;
  capacity?: string;
  rooms?: string;
  openingHours?: string;
  operator?: string;
  description?: string;
  petPolicy: PetPolicy;
  petNote: string;
  petFee?: string;
  oneNightPolicy: OneNightPolicy;
  oneNightNote: string;
  source: 'osm' | 'mapy' | 'osm+mapy';
  osmUrl?: string;
  rawTags?: Record<string, string>;
}

export interface GeocodedLocation {
  name: string;
  label: string;
  lat: number;
  lon: number;
  bbox?: [number, number, number, number]; // [south, west, north, east]
}

export interface SearchAreaInput {
  centerLat: number;
  centerLon: number;
  radiusKm?: number;
  bbox?: [number, number, number, number]; // [south, west, north, east]
  referenceCoords?: Coordinate[];
  signal?: AbortSignal;
}

export interface SearchAccommodationResult {
  places: AccommodationPlace[];
  warning?: string;
}

export const ACCOMMODATION_CATEGORIES: {
  id: AccommodationCategory;
  label: string;
  shortLabel: string;
  color: string;
  hikerFriendlyRank: number;
}[] = [
  { id: 'alpine_hut', label: 'Horské chaty a boudy', shortLabel: 'Horské chaty', color: '#059669', hikerFriendlyRank: 1 },
  { id: 'guest_house', label: 'Penziony a priváty', shortLabel: 'Penziony', color: '#2563eb', hikerFriendlyRank: 2 },
  { id: 'hostel', label: 'Turistické ubytovny', shortLabel: 'Ubytovny', color: '#7c3aed', hikerFriendlyRank: 3 },
  { id: 'camp_site', label: 'Kempy a autokempy s chatkami', shortLabel: 'Kempy (chatky)', color: '#d97706', hikerFriendlyRank: 4 },
  { id: 'chalet', label: 'Chaty a chalupy', shortLabel: 'Chatky', color: '#ea580c', hikerFriendlyRank: 5 },
  { id: 'hotel', label: 'Hotely a motely', shortLabel: 'Hotely', color: '#475569', hikerFriendlyRank: 6 },
  { id: 'apartment', label: 'Apartmány', shortLabel: 'Apartmány', color: '#0891b2', hikerFriendlyRank: 7 },
];

export const CATEGORY_META_MAP: Record<
  AccommodationCategory,
  { label: string; shortLabel: string; color: string; hikerFriendlyRank: number }
> = ACCOMMODATION_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = {
      label: item.label,
      shortLabel: item.shortLabel,
      color: item.color,
      hikerFriendlyRank: item.hikerFriendlyRank,
    };
    return acc;
  },
  {} as Record<AccommodationCategory, { label: string; shortLabel: string; color: string; hikerFriendlyRank: number }>
);

const OUTDOOR_SLEEP_REGEX =
  /\b(útuln|přístřeš|bivak|nocovišť|tábořiš|stanoviš|stanov[áé]\s*louk|stellplatz|stání pro obytná|camper\s*park|karavanov[ée]\s*stání|shelter|bivouac|lean-to)\b/i;

function isOutdoorSleepingNameOrLabel(name?: string, label?: string): boolean {
  const combined = `${name || ''} ${label || ''}`.toLowerCase();
  return OUTDOOR_SLEEP_REGEX.test(combined);
}

// Simple in-memory cache for fast repeat views during a session
const searchCache = new Map<string, { ts: number; result: SearchAccommodationResult }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Geocode a place, mountain range, or town via Mapy.cz Geocode API (with Nominatim fallback).
 */
export async function geocodeLocation(
  query: string,
  signal?: AbortSignal
): Promise<GeocodedLocation[]> {
  const clean = query.trim();
  if (!clean) return [];

  try {
    const url = `https://api.mapy.cz/v1/geocode?query=${encodeURIComponent(
      clean
    )}&lang=cs&limit=6&apikey=${MAPY_CZ_API_KEY}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.items) && json.items.length > 0) {
        const results: GeocodedLocation[] = [];
        for (const item of json.items) {
          const lat = item?.position?.lat;
          const lon = item?.position?.lon;
          if (typeof lat !== 'number' || typeof lon !== 'number') continue;
          let bbox: [number, number, number, number] | undefined;
          if (Array.isArray(item.bbox) && item.bbox.length === 4) {
            bbox = [item.bbox[1], item.bbox[0], item.bbox[3], item.bbox[2]];
          }
          const regionText = Array.isArray(item.regionalStructure)
            ? item.regionalStructure
                .slice(0, 3)
                .map((r: { name?: string }) => r?.name)
                .filter(Boolean)
                .join(', ')
            : '';
          results.push({
            name: item.name || clean,
            label: [item.label, regionText || item.location].filter(Boolean).join(' · '),
            lat,
            lon,
            bbox,
          });
        }
        if (results.length > 0) return results;
      }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
  }

  // Fallback to OSM Nominatim
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    clean
  )}&limit=5&accept-language=cs`;
  const nomRes = await fetch(nomUrl, { signal });
  if (!nomRes.ok) return [];
  const nomJson = await nomRes.json();
  if (!Array.isArray(nomJson)) return [];

  const mapped: (GeocodedLocation | null)[] = nomJson.map(
    (item: { display_name?: string; lat?: string; lon?: string; boundingbox?: string[] }) => {
      const lat = parseFloat(item.lat || '');
      const lon = parseFloat(item.lon || '');
      if (isNaN(lat) || isNaN(lon)) return null;
      let bbox: [number, number, number, number] | undefined;
      if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
        const s = parseFloat(item.boundingbox[0]);
        const n = parseFloat(item.boundingbox[1]);
        const w = parseFloat(item.boundingbox[2]);
        const e = parseFloat(item.boundingbox[3]);
        if (![s, n, w, e].some(isNaN)) {
          bbox = [s, w, n, e];
        }
      }
      const parts = (item.display_name || clean).split(',').map((s) => s.trim());
      return {
        name: parts[0] || clean,
        label: parts.slice(1, 4).join(', '),
        lat,
        lon,
        bbox,
      };
    }
  );

  return mapped.filter((x): x is GeocodedLocation => x !== null);
}

function hasExplicitCabinsTag(tags: Record<string, string>): boolean {
  return (
    tags.cabins === 'yes' ||
    tags.bungalows === 'yes' ||
    tags.chalets === 'yes' ||
    tags.static_caravans === 'yes' ||
    tags.huts === 'yes' ||
    tags.rooms === 'yes'
  );
}

function classifyOsmCategory(tags: Record<string, string>): AccommodationCategory | null {
  const tourism = (tags.tourism || '').toLowerCase();
  if (tourism === 'alpine_hut') return 'alpine_hut';
  if (tourism === 'guest_house') return 'guest_house';
  if (tourism === 'hostel') return 'hostel';
  if (tourism === 'chalet') return 'chalet';
  if (tourism === 'hotel' || tourism === 'motel') return 'hotel';
  if (tourism === 'apartment') return 'apartment';

  if (tourism === 'camp_site' || tourism === 'caravan_site') {
    if (tags.backcountry === 'yes' || tags.impromptu === 'yes') return null;
    const campType = (tags.camp_type || '').toLowerCase();
    if (['primitive', 'basic', 'wilderness', 'bivouac', 'tent_only'].includes(campType)) {
      return null;
    }

    const explicitCabins = hasExplicitCabinsTag(tags);
    // Exclude if explicitly marked as no cabins/bungalows
    if (
      !explicitCabins &&
      tags.cabins === 'no' &&
      tags.bungalows !== 'yes' &&
      tags.chalets !== 'yes'
    ) {
      return null;
    }

    const nameAndDesc = `${tags.name || ''} ${tags.description || ''}`.toLowerCase();
    // If caravan_site (often pure RV parking / stellplatz), require cabins tag or camp/autokemp name
    if (
      tourism === 'caravan_site' &&
      !explicitCabins &&
      !/(autokemp|kemp|camp|chatk|rekreač)/i.test(nameAndDesc)
    ) {
      return null;
    }

    return 'camp_site';
  }

  return null;
}

function classifyMapyCategory(
  name: string,
  label: string
): AccommodationCategory | null {
  const nameLower = name.toLowerCase();
  const labelLower = label.toLowerCase();

  // Reject stellplatz / camper parking without cabins
  if (
    labelLower.includes('stellplatz') ||
    labelLower.includes('stání pro obytná') ||
    nameLower.includes('stellplatz') ||
    nameLower.includes('camper park')
  ) {
    return null;
  }

  // Only keep actual accommodation or camp POIs
  if (
    labelLower &&
    !labelLower.includes('ubytování') &&
    !labelLower.includes('kemp') &&
    !labelLower.includes('chata') &&
    !labelLower.includes('hotel') &&
    !labelLower.includes('penzion')
  ) {
    return null;
  }

  if (labelLower.includes('kemp') || /\b(autokemp|kemp)\b/i.test(nameLower)) {
    return 'camp_site';
  }
  if (labelLower.includes('hotel') || /\b(hotel|motel|botel)\b/i.test(nameLower)) {
    return 'hotel';
  }
  if (labelLower.includes('penzion') || /\b(penzion|pension)\b/i.test(nameLower)) {
    return 'guest_house';
  }
  if (labelLower.includes('ubytovna') || /\b(ubytovna|hostel|turistická ubytovna)\b/i.test(nameLower)) {
    return 'hostel';
  }
  if (labelLower.includes('apartmán') || /\b(apartmán|apartmány|apartment)\b/i.test(nameLower)) {
    return 'apartment';
  }

  // Only classify as real mountain hut (alpine_hut) when the name clearly indicates a staffed mountain bouda/chata
  if (
    /\b(horská\s+chata|horská\s+bouda|turistická\s+chata|chata\s+kčt)\b/i.test(nameLower) ||
    /\bbouda\b/i.test(nameLower)
  ) {
    return 'alpine_hut';
  }

  // General "Ubytování - rekreační zařízení" or cottages/chalupas are self-catering chalets (often multi-night)
  return 'chalet';
}

function evaluatePetPolicy(tags: Record<string, string>): {
  petPolicy: PetPolicy;
  petNote: string;
  petFee?: string;
} {
  const rawPets = (tags.pets || tags.pets_allowed || tags.animal || '').toLowerCase().trim();
  const rawDog = (tags.dog || tags.dogs || '').toLowerCase().trim();
  const petFee = tags['fee:pets'] || tags['pets:fee'] || tags['charge:pets'] || undefined;

  const excludedTokens = ['no', 'false', 'prohibited', 'forbidden', 'none'];
  if (excludedTokens.includes(rawPets) || excludedTokens.includes(rawDog)) {
    return {
      petPolicy: 'excluded',
      petNote: 'V datech OSM uvedeno: bez psů / domácích mazlíčků',
      petFee,
    };
  }

  if (
    ['yes', 'designated', 'permissive', 'welcome', 'leashed', 'on_leash', 'conditional'].includes(
      rawPets
    ) ||
    ['yes', 'designated', 'permissive', 'leashed', 'on_leash'].includes(rawDog)
  ) {
    const detail =
      rawDog === 'leashed' || rawPets === 'leashed' || rawDog === 'on_leash'
        ? 'Pes povolen (na vodítku · potvrzeno v OSM)'
        : 'Ubytování se psem potvrzeno v datech OSM';
    return {
      petPolicy: 'confirmed',
      petNote: detail,
      petFee,
    };
  }

  return {
    petPolicy: 'unverified',
    petNote: 'Podmínky pro psa v OSM neuvedeny – ověřte při rezervaci nebo telefonicky',
    petFee,
  };
}

function evaluateOneNightPolicy(
  tags: Record<string, string>,
  category: AccommodationCategory
): { oneNightPolicy: OneNightPolicy; oneNightNote: string } {
  const minStayStr = tags.minimum_stay || tags.min_stay || tags['stay:minimum'] || '';
  if (minStayStr) {
    const match = minStayStr.match(/\d+/);
    if (match) {
      const nights = parseInt(match[0], 10);
      if (nights >= 2) {
        return {
          oneNightPolicy: 'excluded',
          oneNightNote: `Uvedeno minimum ${nights} nocí (${minStayStr})`,
        };
      }
      if (nights === 1) {
        return {
          oneNightPolicy: 'ideal',
          oneNightNote: 'Potvrzena možnost ubytování na 1 noc',
        };
      }
    }
  }

  const descLower = `${tags.description || ''} ${tags.note || ''}`.toLowerCase();
  if (
    /pouze\s*týden|jen\s*týden|týdenní\s*pobyt|min\.?\s*[2-7]\s*noc|minimum\s*[2-7]\s*night|od\s*[2-7]\s*noc/i.test(
      descLower
    )
  ) {
    return {
      oneNightPolicy: 'excluded',
      oneNightNote: 'V popisu uvedeno omezení na vícedenní / týdenní pobyt',
    };
  }

  switch (category) {
    case 'alpine_hut':
      return {
        oneNightPolicy: 'ideal',
        oneNightNote: 'Horská bouda / chata – pokoje i na 1 noc (termín ověřte na webu / tel.)',
      };
    case 'hostel':
      return {
        oneNightPolicy: 'ideal',
        oneNightNote: 'Turistická ubytovna / hostel – lůžka na 1 noc běžně',
      };
    case 'hotel':
      return {
        oneNightPolicy: 'ideal',
        oneNightNote: 'Hotel / motel – jednotlivé pokoje na 1 noc běžně',
      };
    case 'guest_house':
      return {
        oneNightPolicy: 'likely',
        oneNightNote: 'Penzion – 1 noc většinou možná (o víkendech a v sezóně nutno ověřit)',
      };
    case 'camp_site':
      return {
        oneNightPolicy: 'likely',
        oneNightNote: hasExplicitCabinsTag(tags)
          ? 'Kemp s chatkami (potvrzeno v OSM) – 1 noc dle sezónní dostupnosti'
          : 'Kemp / autokemp – ověřte chatku na 1 noc (v létě bývají týdenní turnusy)',
      };
    case 'apartment':
      return {
        oneNightPolicy: 'rental_unverified',
        oneNightNote: 'Apartmán – často vyžaduje min. 2–7 nocí (ověřte termín na Booking / webu)',
      };
    case 'chalet':
      return {
        oneNightPolicy: 'rental_unverified',
        oneNightNote:
          'Rekreační chata / chalupa k pronájmu – často jen víkendy (PÁ–NE) či týdny, ne 1 noc',
      };
  }
}

function buildAddress(tags: Record<string, string>): { address?: string; city?: string } {
  const street = tags['addr:street'] || tags['addr:place'] || '';
  const houseNo = tags['addr:housenumber'] || tags['addr:conscriptionnumber'] || '';
  const city =
    tags['addr:city'] ||
    tags['addr:village'] ||
    tags['addr:town'] ||
    tags['addr:hamlet'] ||
    '';
  const line = [street, houseNo].filter(Boolean).join(' ');
  const full = [line, city].filter(Boolean).join(', ');
  return {
    address: full || undefined,
    city: city || undefined,
  };
}

function normalizePhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.split(';')[0].trim();
}

function normalizeWebsite(raw?: string): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(';')[0].trim();
  if (!first) return undefined;
  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

function minDistanceToRouteOrCenter(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  referenceCoords?: Coordinate[]
): number {
  if (!referenceCoords || referenceCoords.length === 0) {
    return calculateDistanceKm(lat, lon, centerLat, centerLon);
  }
  const step = Math.max(1, Math.floor(referenceCoords.length / 220));
  let minD = Infinity;
  for (let i = 0; i < referenceCoords.length; i += step) {
    const d = calculateDistanceKm(lat, lon, referenceCoords[i][0], referenceCoords[i][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Sample up to 4 evenly spaced anchors along a route so long trails don't produce huge slow bboxes.
 */
function pickRouteAnchors(coords: Coordinate[], maxAnchors = 4): { lat: number; lon: number }[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [{ lat: coords[0][0], lon: coords[0][1] }];

  const first = coords[0];
  const last = coords[coords.length - 1];
  const directSpanKm = calculateDistanceKm(first[0], first[1], last[0], last[1]);
  const count = directSpanKm > 25 ? maxAnchors : directSpanKm > 10 ? 3 : 2;

  const anchors: { lat: number; lon: number }[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(
      coords.length - 1,
      Math.round((i / Math.max(1, count - 1)) * (coords.length - 1))
    );
    const pt = coords[idx];
    if (
      !anchors.some((a) => calculateDistanceKm(a.lat, a.lon, pt[0], pt[1]) < 4.5)
    ) {
      anchors.push({ lat: pt[0], lon: pt[1] });
    }
  }
  return anchors;
}

interface RawOsmElement {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

function makeWktPolygon(s: number, w: number, n: number, e: number): string {
  const sf = s.toFixed(4);
  const wf = w.toFixed(4);
  const nf = n.toFixed(4);
  const ef = e.toFixed(4);
  return `POLYGON((${wf} ${sf}, ${ef} ${sf}, ${ef} ${nf}, ${wf} ${nf}, ${wf} ${sf}))`;
}

function parseWktPoint(wkt?: string): { lat: number; lon: number } | null {
  if (!wkt) return null;
  const m = wkt.match(/POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

function parseOsmUri(uri?: string): { type: string; id: string } {
  if (!uri) return { type: 'node', id: '' };
  const m = uri.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  return { type: 'node', id: uri };
}

function buildQleverAccommodationSparql(polyWkt: string, limit = 450): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?tourism (geof:centroid(?geom) AS ?centroid)
  ?pets ?dog ?pets_allowed ?fee_pets
  ?phone ?cphone ?website ?cwebsite ?email
  ?ele ?capacity ?beds ?cabins ?bungalows ?min_stay ?camp_type ?backcountry
  ?hours ?city ?village
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  ?osm osmkey:tourism ?tourism .
  VALUES ?tourism { "alpine_hut" "guest_house" "hostel" "chalet" "hotel" "motel" "apartment" "camp_site" "caravan_site" }
  ?osm osmkey:name ?name .
  OPTIONAL { ?osm osmkey:pets ?pets }
  OPTIONAL { ?osm osmkey:dog ?dog }
  OPTIONAL { ?osm osmkey:pets_allowed ?pets_allowed }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:fee:pets> ?fee_pets }
  OPTIONAL { ?osm osmkey:phone ?phone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:phone> ?cphone }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:website> ?cwebsite }
  OPTIONAL { ?osm osmkey:email ?email }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:capacity ?capacity }
  OPTIONAL { ?osm osmkey:beds ?beds }
  OPTIONAL { ?osm osmkey:cabins ?cabins }
  OPTIONAL { ?osm osmkey:bungalows ?bungalows }
  OPTIONAL { ?osm osmkey:minimum_stay ?min_stay }
  OPTIONAL { ?osm osmkey:camp_type ?camp_type }
  OPTIONAL { ?osm osmkey:backcountry ?backcountry }
  OPTIONAL { ?osm osmkey:opening_hours ?hours }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
} LIMIT ${limit}`;
}

interface SparqlBindingVal {
  value?: string;
}

async function fetchQleverSingleBox(
  endpoint: string,
  polyWkt: string,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<RawOsmElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort);

  try {
    const sparql = buildQleverAccommodationSparql(polyWkt, 450);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
      },
      body: `query=${encodeURIComponent(sparql)}`,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`QLever HTTP ${res.status}`);
    }
    const data = await res.json();
    const bindings: Record<string, SparqlBindingVal | undefined>[] = data?.results?.bindings;
    if (!Array.isArray(bindings)) {
      throw new Error('Neplatná odpověď z OSM QLever API');
    }

    const elements: RawOsmElement[] = [];
    for (const row of bindings) {
      const pt = parseWktPoint(row.centroid?.value);
      const name = row.name?.value?.trim();
      const tourism = row.tourism?.value?.trim();
      if (!pt || !name || !tourism) continue;

      const { type, id } = parseOsmUri(row.osm?.value);
      const tags: Record<string, string> = {
        name,
        tourism,
      };
      if (row.pets?.value) tags.pets = row.pets.value;
      if (row.dog?.value) tags.dog = row.dog.value;
      if (row.pets_allowed?.value) tags.pets_allowed = row.pets_allowed.value;
      if (row.fee_pets?.value) tags['fee:pets'] = row.fee_pets.value;
      if (row.phone?.value) tags.phone = row.phone.value;
      if (row.cphone?.value) tags['contact:phone'] = row.cphone.value;
      if (row.website?.value) tags.website = row.website.value;
      if (row.cwebsite?.value) tags['contact:website'] = row.cwebsite.value;
      if (row.email?.value) tags.email = row.email.value;
      if (row.ele?.value) tags.ele = row.ele.value;
      if (row.capacity?.value) tags.capacity = row.capacity.value;
      if (row.beds?.value) tags.beds = row.beds.value;
      if (row.cabins?.value) tags.cabins = row.cabins.value;
      if (row.bungalows?.value) tags.bungalows = row.bungalows.value;
      if (row.min_stay?.value) tags.minimum_stay = row.min_stay.value;
      if (row.camp_type?.value) tags.camp_type = row.camp_type.value;
      if (row.backcountry?.value) tags.backcountry = row.backcountry.value;
      if (row.hours?.value) tags.opening_hours = row.hours.value;
      if (row.city?.value) tags['addr:city'] = row.city.value;
      if (row.village?.value) tags['addr:village'] = row.village.value;

      elements.push({
        type,
        id,
        lat: pt.lat,
        lon: pt.lon,
        tags,
      });
    }
    return elements;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function fetchOverpassGetSingle(
  endpoint: string,
  query: string,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<RawOsmElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort);

  try {
    const url = `${endpoint}?data=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, */*',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Overpass HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.elements)) {
      throw new Error('Neplatná odpověď z Overpass API');
    }
    return data.elements as RawOsmElement[];
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function queryOsmFast(
  boxes: [number, number, number, number][],
  overpassQuery: string,
  signal?: AbortSignal
): Promise<{ elements: RawOsmElement[]; failed: boolean }> {
  // Primary: fast CORS-friendly QLever OSM Planet (fallback to secondary QLever mirror on error)
  try {
    if (boxes.length === 1) {
      const poly = makeWktPolygon(boxes[0][0], boxes[0][1], boxes[0][2], boxes[0][3]);
      try {
        const elements = await fetchQleverSingleBox(QLEVER_ENDPOINTS[0], poly, 6500, signal);
        return { elements, failed: false };
      } catch (primaryErr) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        void primaryErr;
        const elements = await fetchQleverSingleBox(QLEVER_ENDPOINTS[1], poly, 6500, signal);
        return { elements, failed: false };
      }
    }

    // Multiple corridor boxes (route mode): balance across endpoints in parallel
    const settled = await Promise.allSettled(
      boxes.map((box, idx) => {
        const poly = makeWktPolygon(box[0], box[1], box[2], box[3]);
        const primaryEp = QLEVER_ENDPOINTS[idx % QLEVER_ENDPOINTS.length];
        const secondaryEp = QLEVER_ENDPOINTS[(idx + 1) % QLEVER_ENDPOINTS.length];
        return fetchQleverSingleBox(primaryEp, poly, 7500, signal).catch(() =>
          fetchQleverSingleBox(secondaryEp, poly, 6500, signal)
        );
      })
    );
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const okBatches = settled
      .filter((r): r is PromiseFulfilledResult<RawOsmElement[]> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (okBatches.length > 0) {
      const seen = new Set<string>();
      const merged: RawOsmElement[] = [];
      for (const el of okBatches.flat()) {
        const key = `${el.type || 'node'}_${el.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(el);
      }
      return { elements: merged, failed: false };
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    void err;
  }

  // Secondary fallback: Overpass GET mirrors (in case QLever is temporarily unreachable)
  try {
    const elements = await Promise.any(
      OVERPASS_FALLBACK_ENDPOINTS.map((ep) => fetchOverpassGetSingle(ep, overpassQuery, 6500, signal))
    );
    return { elements, failed: false };
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return { elements: [], failed: true };
  }
}

async function fetchMapyAccommodationPOIs(
  anchors: { lat: number; lon: number }[],
  radiusKm: number,
  signal?: AbortSignal
): Promise<{
  items: {
    name: string;
    label: string;
    lat: number;
    lon: number;
    category: AccommodationCategory;
    city?: string;
  }[];
  failed: boolean;
}> {
  const queries: { q: string }[] = [
    { q: 'hotel' },
    { q: 'penzion' },
    { q: 'horská bouda' },
    { q: 'turistická ubytovna' },
    { q: 'autokemp' },
  ];

  const precisionMeters = Math.min(20000, Math.max(4500, Math.round(radiusKm * 1000)));
  let okCount = 0;
  let totalRequests = 0;

  const targetAnchors = anchors.slice(0, 3);
  const requests: Promise<
    {
      name: string;
      label: string;
      lat: number;
      lon: number;
      category: AccommodationCategory;
      city?: string;
    }[]
  >[] = [];

  for (const anchor of targetAnchors) {
    for (const { q } of queries) {
      totalRequests++;
      requests.push(
        (async () => {
          try {
            const url = `https://api.mapy.cz/v1/geocode?query=${encodeURIComponent(
              q
            )}&type=poi&lang=cs&limit=15&preferNear=${anchor.lon.toFixed(
              5
            )},${anchor.lat.toFixed(5)}&preferNearPrecision=${precisionMeters}&apikey=${MAPY_CZ_API_KEY}`;
            const res = await fetch(url, { signal });
            if (!res.ok) return [];
            okCount++;
            const json = await res.json();
            const items = Array.isArray(json?.items) ? json.items : [];
            return items
              .map(
                (it: {
                  name?: string;
                  label?: string;
                  location?: string;
                  position?: { lat?: number; lon?: number };
                }) => {
                  const rawName = (it.name || '').trim();
                  const rawLabel = (it.label || '').trim();
                  const cat = classifyMapyCategory(rawName, rawLabel);
                  if (!cat) return null;
                  return {
                    name: rawName,
                    label: rawLabel,
                    city: it.location || undefined,
                    lat: it.position?.lat,
                    lon: it.position?.lon,
                    category: cat,
                  };
                }
              )
              .filter(
                (
                  item: {
                    name: string;
                    label: string;
                    lat?: number;
                    lon?: number;
                    category: AccommodationCategory;
                    city?: string;
                  } | null
                ): item is {
                  name: string;
                  label: string;
                  lat: number;
                  lon: number;
                  category: AccommodationCategory;
                  city?: string;
                } =>
                  item !== null &&
                  Boolean(item.name) &&
                  typeof item.lat === 'number' &&
                  typeof item.lon === 'number' &&
                  !isOutdoorSleepingNameOrLabel(item.name, item.label) &&
                  anchors.some(
                    (a) =>
                      calculateDistanceKm(a.lat, a.lon, item.lat!, item.lon!) <=
                      Math.max(12, radiusKm * 1.35)
                  )
              );
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') throw err;
            return [];
          }
        })()
      );
    }
  }

  const settled = await Promise.all(requests);
  const flat = settled.flat();

  // Deduplicate POIs returned across multiple anchors or category queries
  const deduped: typeof flat = [];
  for (const poi of flat) {
    const duplicate = deduped.some(
      (existing) =>
        existing.name.toLowerCase() === poi.name.toLowerCase() &&
        calculateDistanceKm(existing.lat, existing.lon, poi.lat, poi.lon) < 0.25
    );
    if (!duplicate) deduped.push(poi);
  }

  return {
    items: deduped,
    failed: totalRequests > 0 && okCount === 0,
  };
}

/**
 * Search real indoor accommodation facilities using Overpass API (fast mirror race) + Mapy.cz POI enrichment.
 */
export async function searchAccommodations(
  input: SearchAreaInput
): Promise<SearchAccommodationResult> {
  const { centerLat, centerLon, radiusKm = 10, bbox, referenceCoords, signal } = input;

  const cacheKey = referenceCoords
    ? `route_${centerLat.toFixed(2)}_${centerLon.toFixed(2)}_${referenceCoords.length}`
    : bbox
      ? `bbox_${bbox.map((v) => v.toFixed(2)).join('_')}`
      : `pt_${centerLat.toFixed(2)}_${centerLon.toFixed(2)}_${Math.round(radiusKm)}`;

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  let overpassQuery = '';
  let osmBoxes: [number, number, number, number][] = [];
  let anchors: { lat: number; lon: number }[] = [{ lat: centerLat, lon: centerLon }];
  let effectiveRadiusKm = radiusKm;

  if (referenceCoords && referenceCoords.length >= 2) {
    // Route-corridor mode: compact anchor boxes along the route
    anchors = pickRouteAnchors(referenceCoords, 3);
    const corridorMeters = 5500;
    effectiveRadiusKm = 6.5;
    osmBoxes = anchors.map((a) => [a.lat - 0.055, a.lon - 0.085, a.lat + 0.055, a.lon + 0.085]);
    const unionParts = anchors
      .map(
        (a) =>
          `  nw["tourism"~"^(alpine_hut|guest_house|hostel|chalet|camp_site|caravan_site|hotel|motel|apartment)$"](around:${corridorMeters},${a.lat.toFixed(
            5
          )},${a.lon.toFixed(5)});`
      )
      .join('\n');
    overpassQuery = `[out:json][timeout:8];\n(\n${unionParts}\n);\nout center tags;`;
  } else if (bbox) {
    let [s, w, n, e] = bbox;
    const latSpan = Math.abs(n - s);
    const lonSpan = Math.abs(e - w);
    if (latSpan > 0.28 || lonSpan > 0.42) {
      const cLat = (s + n) / 2;
      const cLon = (w + e) / 2;
      s = cLat - 0.14;
      n = cLat + 0.14;
      w = cLon - 0.21;
      e = cLon + 0.21;
    }
    osmBoxes = [[s, w, n, e]];
    const areaClause = `(${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)})`;
    effectiveRadiusKm = Math.max(8, Math.min(18, calculateDistanceKm(s, w, n, e) / 2));
    overpassQuery = `[out:json][timeout:8];\n(\n  nw["tourism"~"^(alpine_hut|guest_house|hostel|chalet|camp_site|caravan_site|hotel|motel|apartment)$"]${areaClause};\n);\nout center tags;`;
  } else {
    const rKm = Math.min(16, Math.max(3, radiusKm));
    const dLat = rKm / 111.32;
    const dLon = rKm / (111.32 * Math.max(0.25, Math.cos((centerLat * Math.PI) / 180)));
    osmBoxes = [[centerLat - dLat, centerLon - dLon, centerLat + dLat, centerLon + dLon]];
    const rMeters = Math.round(rKm * 1000);
    const areaClause = `(around:${rMeters},${centerLat.toFixed(5)},${centerLon.toFixed(5)})`;
    overpassQuery = `[out:json][timeout:8];\n(\n  nw["tourism"~"^(alpine_hut|guest_house|hostel|chalet|camp_site|caravan_site|hotel|motel|apartment)$"]${areaClause};\n);\nout center tags;`;
  }

  const [osmRes, mapyRes] = await Promise.all([
    queryOsmFast(osmBoxes, overpassQuery, signal),
    fetchMapyAccommodationPOIs(anchors, effectiveRadiusKm, signal),
  ]);

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (osmRes.failed && mapyRes.failed) {
    throw new Error('Nepodařilo se načíst data o ubytování. Zkontrolujte připojení a zkuste to znovu.');
  }

  const places: AccommodationPlace[] = [];

  for (const el of osmRes.elements) {

    const tags = el.tags || {};
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const category = classifyOsmCategory(tags);
    if (!category) continue;

    const name = (tags.name || tags['name:cs'] || tags.official_name || '').trim();
    if (!name) continue;
    if (isOutdoorSleepingNameOrLabel(name, tags.description)) continue;

    const categoryMeta = CATEGORY_META_MAP[category];
    const { petPolicy, petNote, petFee } = evaluatePetPolicy(tags);
    const { oneNightPolicy, oneNightNote } = evaluateOneNightPolicy(tags, category);
    const { address, city } = buildAddress(tags);

    let elevationM: number | null = null;
    if (tags.ele) {
      const parsedEle = parseFloat(tags.ele.replace(',', '.'));
      if (!isNaN(parsedEle) && parsedEle > 0 && parsedEle < 9000) {
        elevationM = Math.round(parsedEle);
      }
    }

    const capacity =
      tags.capacity || tags.beds
        ? `${tags.beds || tags.capacity} ${tags.beds ? 'lůžek' : 'míst'}`
        : undefined;

    const distanceKm = minDistanceToRouteOrCenter(
      lat,
      lon,
      centerLat,
      centerLon,
      referenceCoords
    );

    places.push({
      id: `osm_${el.type || 'node'}_${el.id}`,
      name,
      category,
      categoryLabel: categoryMeta.label,
      lat,
      lon,
      distanceKm,
      elevationM,
      address,
      city,
      phone: normalizePhone(tags.phone || tags['contact:phone'] || tags['contact:mobile']),
      website: normalizeWebsite(tags.website || tags['contact:website'] || tags.url),
      email: tags.email || tags['contact:email'],
      capacity,
      rooms: tags.rooms,
      openingHours: tags.opening_hours,
      operator: tags.operator,
      description: tags.description || tags.note,
      petPolicy,
      petNote,
      petFee,
      oneNightPolicy,
      oneNightNote,
      source: 'osm',
      osmUrl:
        el.type && el.id
          ? `https://www.openstreetmap.org/${el.type}/${el.id}`
          : undefined,
      rawTags: tags,
    });
  }

  // Merge unique Mapy.cz POI hits (or enrich OSM records with missing city names)
  for (const poi of mapyRes.items) {
    const match = places.find(
      (p) =>
        calculateDistanceKm(p.lat, p.lon, poi.lat, poi.lon) < 0.14 ||
        (p.name.toLowerCase() === poi.name.toLowerCase() &&
          calculateDistanceKm(p.lat, p.lon, poi.lat, poi.lon) < 0.4)
    );
    if (match) {
      if (!match.city && poi.city) match.city = poi.city;
      match.source = 'osm+mapy';
      continue;
    }

    const meta = CATEGORY_META_MAP[poi.category];
    const distanceKm = minDistanceToRouteOrCenter(
      poi.lat,
      poi.lon,
      centerLat,
      centerLon,
      referenceCoords
    );

    const { petPolicy, petNote } = evaluatePetPolicy({});
    const { oneNightPolicy, oneNightNote } = evaluateOneNightPolicy({}, poi.category);

    places.push({
      id: `mapy_${poi.lat.toFixed(5)}_${poi.lon.toFixed(5)}_${poi.name}`,
      name: poi.name,
      category: poi.category,
      categoryLabel: meta.label,
      lat: poi.lat,
      lon: poi.lon,
      distanceKm,
      elevationM: null,
      city: poi.city,
      petPolicy,
      petNote: `${petNote} (zdroj Mapy.com)`,
      oneNightPolicy,
      oneNightNote,
      source: 'mapy',
    });
  }

  const petWeight: Record<PetPolicy, number> = { confirmed: 0, unverified: 1, excluded: 2 };
  const nightWeight: Record<OneNightPolicy, number> = {
    ideal: 0,
    likely: 1,
    rental_unverified: 2,
    excluded: 3,
  };

  places.sort((a, b) => {
    const pw = petWeight[a.petPolicy] - petWeight[b.petPolicy];
    if (pw !== 0) return pw;
    const nw = nightWeight[a.oneNightPolicy] - nightWeight[b.oneNightPolicy];
    if (nw !== 0) return nw;
    return a.distanceKm - b.distanceKm;
  });

  const warning = osmRes.failed
    ? 'Databáze OpenStreetMap neodpověděla včas — zobrazena ověřená ubytování z Mapy.com.'
    : undefined;

  const finalResult: SearchAccommodationResult = { places, warning };
  searchCache.set(cacheKey, { ts: Date.now(), result: finalResult });
  return finalResult;
}

/**
 * Compute checkout date (+1 day) for a strict 1-night stay.
 */
export function getNextDayIso(checkinIso: string): string {
  const parts = checkinIso.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Direct Booking.com search URL locked to 1 night + pets allowed (nflt=pets%3D1).
 */
export function buildBookingOneNightDogUrl(opts: {
  placeName?: string;
  cityOrArea?: string;
  lat?: number;
  lon?: number;
  checkinIso: string;
  adults: number;
}): string {
  const checkoutIso = getNextDayIso(opts.checkinIso);
  const query = [opts.placeName, opts.cityOrArea].filter(Boolean).join(' ').trim();
  const params = new URLSearchParams({
    ss: query || `${opts.lat?.toFixed(4)},${opts.lon?.toFixed(4)}`,
    checkin: opts.checkinIso,
    checkout: checkoutIso,
    group_adults: String(Math.max(1, opts.adults)),
    no_rooms: '1',
    group_children: '0',
    nflt: 'pets=1',
    lang: 'cs',
  });
  if (typeof opts.lat === 'number' && typeof opts.lon === 'number' && !opts.placeName) {
    params.set('latitude', opts.lat.toFixed(5));
    params.set('longitude', opts.lon.toFixed(5));
  }
  return `https://www.booking.com/searchresults.cs.html?${params.toString()}`;
}

export function buildMapyPlaceUrl(place: Pick<AccommodationPlace, 'name' | 'lat' | 'lon'>): string {
  return `https://mapy.cz/turisticka?q=${encodeURIComponent(place.name)}&x=${place.lon.toFixed(
    6
  )}&y=${place.lat.toFixed(6)}&z=16`;
}

export function buildGoogleOneNightDogQueryUrl(place: AccommodationPlace): string {
  const q = `${place.name} ${place.city || ''} ubytování se psem 1 noc kontakt`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
