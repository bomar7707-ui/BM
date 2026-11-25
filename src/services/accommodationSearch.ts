import { Coordinate } from '../types';
import { calculateDistanceKm } from '../utils/gpxParser';

const QLEVER_ENDPOINTS = [
  'https://qlever.dev/api/osm-planet',
  'https://qlever.cs.uni-freiburg.de/api/osm-planet',
];

const OVERPASS_FALLBACK_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type PoiSubSection = 'accommodation' | 'gastro' | 'parking';

export type AccommodationCategory =
  | 'alpine_hut'
  | 'guest_house'
  | 'hostel'
  | 'camp_site'
  | 'chalet'
  | 'hotel'
  | 'apartment';

export type GastroCategory =
  | 'restaurant'
  | 'pub'
  | 'forest_bar'
  | 'biergarten'
  | 'refreshment'
  | 'cafe'
  | 'bar';

export type ParkingCategory =
  | 'surface'
  | 'layby'
  | 'multi_storey'
  | 'underground'
  | 'caravan';

export type PetPolicy = 'confirmed' | 'unverified' | 'excluded';
export type OneNightPolicy = 'ideal' | 'likely' | 'rental_unverified' | 'excluded';
export type ParkingFeePolicy = 'free' | 'paid' | 'unknown';
export type ParkingAccessPolicy = 'public' | 'customers';

export interface CategoryMeta<C extends string> {
  id: C;
  label: string;
  shortLabel: string;
  color: string;
  hikerFriendlyRank: number;
}

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
  source: 'osm';
  osmUrl?: string;
  rawTags?: Record<string, string>;
}

export interface GastroPlace {
  id: string;
  name: string;
  category: GastroCategory;
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
  openingHours?: string;
  cuisine?: string;
  brewery?: string;
  outdoorSeating: boolean;
  takeaway: boolean;
  petPolicy: PetPolicy;
  petNote: string;
  description?: string;
  source: 'osm';
  osmUrl?: string;
  rawTags?: Record<string, string>;
}

export interface ParkingPlace {
  id: string;
  name: string;
  isNamed: boolean;
  category: ParkingCategory;
  categoryLabel: string;
  lat: number;
  lon: number;
  distanceKm: number;
  elevationM?: number | null;
  address?: string;
  city?: string;
  capacity?: string;
  feePolicy: ParkingFeePolicy;
  feeNote: string;
  accessPolicy: ParkingAccessPolicy;
  accessNote: string;
  surfaceLabel?: string;
  maxstay?: string;
  openingHours?: string;
  operator?: string;
  website?: string;
  description?: string;
  source: 'osm';
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
  preferBbox?: boolean;
  signal?: AbortSignal;
}

export interface SearchAccommodationResult {
  places: AccommodationPlace[];
  warning?: string;
}

export interface SearchGastroResult {
  places: GastroPlace[];
  warning?: string;
}

export interface SearchParkingResult {
  places: ParkingPlace[];
  warning?: string;
}

// ---------------------------------------------------------------------------
// 1. Accommodation Categories & Metadata
// ---------------------------------------------------------------------------
export const ACCOMMODATION_CATEGORIES: CategoryMeta<AccommodationCategory>[] = [
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
  CategoryMeta<AccommodationCategory>
> = ACCOMMODATION_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<AccommodationCategory, CategoryMeta<AccommodationCategory>>
);

// ---------------------------------------------------------------------------
// 2. Gastronomy (Jídlo a pití) Categories & Metadata
// ---------------------------------------------------------------------------
export const GASTRO_CATEGORIES: CategoryMeta<GastroCategory>[] = [
  { id: 'restaurant', label: 'Restaurace a horské hostince', shortLabel: 'Restaurace', color: '#dc2626', hikerFriendlyRank: 1 },
  { id: 'pub', label: 'Hospody, pivnice a výčepy', shortLabel: 'Hospody', color: '#d97706', hikerFriendlyRank: 2 },
  { id: 'forest_bar', label: 'Lesní bary a samoobslužné občerstvení', shortLabel: 'Lesní bary', color: '#059669', hikerFriendlyRank: 3 },
  { id: 'biergarten', label: 'Pivní zahrádky a venkovní posezení', shortLabel: 'Zahrádky', color: '#65a30d', hikerFriendlyRank: 4 },
  { id: 'refreshment', label: 'Občerstvení, bufety a bistra', shortLabel: 'Občerstvení', color: '#ea580c', hikerFriendlyRank: 5 },
  { id: 'cafe', label: 'Kavárny a cukrárny', shortLabel: 'Kavárny', color: '#9333ea', hikerFriendlyRank: 6 },
  { id: 'bar', label: 'Bary a vinárny', shortLabel: 'Bary', color: '#2563eb', hikerFriendlyRank: 7 },
];

export const GASTRO_CATEGORY_META_MAP: Record<
  GastroCategory,
  CategoryMeta<GastroCategory>
> = GASTRO_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<GastroCategory, CategoryMeta<GastroCategory>>
);

// ---------------------------------------------------------------------------
// 3. Parking (Parkování) Categories & Metadata
// ---------------------------------------------------------------------------
export const PARKING_CATEGORIES: CategoryMeta<ParkingCategory>[] = [
  { id: 'surface', label: 'Venkovní parkoviště a odstavné plochy', shortLabel: 'Venkovní parkoviště', color: '#2563eb', hikerFriendlyRank: 1 },
  { id: 'layby', label: 'Odstavná místa a zálivy u silnice', shortLabel: 'Stání u cesty', color: '#059669', hikerFriendlyRank: 2 },
  { id: 'multi_storey', label: 'Parkovací domy', shortLabel: 'Parkovací domy', color: '#7c3aed', hikerFriendlyRank: 3 },
  { id: 'underground', label: 'Podzemní garáže', shortLabel: 'Podzemní garáže', color: '#475569', hikerFriendlyRank: 4 },
  { id: 'caravan', label: 'Stání pro karavany a obytná auta', shortLabel: 'Pro karavany', color: '#d97706', hikerFriendlyRank: 5 },
];

export const PARKING_CATEGORY_META_MAP: Record<
  ParkingCategory,
  CategoryMeta<ParkingCategory>
> = PARKING_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<ParkingCategory, CategoryMeta<ParkingCategory>>
);

const OUTDOOR_SLEEP_REGEX =
  /\b(útuln|přístřeš|bivak|nocovišť|tábořiš|stanoviš|stanov[áé]\s*louk|stellplatz|stání pro obytná|camper\s*park|karavanov[ée]\s*stání|shelter|bivouac|lean-to)\b/i;

function isOutdoorSleepingNameOrLabel(name?: string, label?: string): boolean {
  const combined = `${name || ''} ${label || ''}`.toLowerCase();
  return OUTDOOR_SLEEP_REGEX.test(combined);
}

// Simple in-memory caches for fast repeat views during a session
const accommodationCache = new Map<string, { ts: number; result: SearchAccommodationResult }>();
const gastroCache = new Map<string, { ts: number; result: SearchGastroResult }>();
const parkingCache = new Map<string, { ts: number; result: SearchParkingResult }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Geocode a place, mountain range, peak, or town purely via OpenStreetMap services:
 * Photon (Komoot, fast & CORS-friendly) with OSM Nominatim fallback.
 */
export async function geocodeLocation(
  query: string,
  signal?: AbortSignal
): Promise<GeocodedLocation[]> {
  const clean = query.trim();
  if (!clean) return [];

  // 1. Primary: Photon (Komoot) biased toward Czechia
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      clean
    )}&limit=8&lat=49.8175&lon=15.4730`;
    const res = await fetch(photonUrl, { signal });
    if (res.ok) {
      const json = await res.json();
      const features = Array.isArray(json?.features) ? json.features : [];
      const results: GeocodedLocation[] = [];

      for (const feat of features) {
        const coords = feat?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (isNaN(lat) || isNaN(lon)) continue;

        const props = feat.properties || {};
        const name = String(props.name || props.city || props.county || clean).trim();
        if (!name) continue;

        let bbox: [number, number, number, number] | undefined;
        if (Array.isArray(props.extent) && props.extent.length === 4) {
          // Photon extent is [west, north, east, south]
          const w = Number(props.extent[0]);
          const n = Number(props.extent[1]);
          const e = Number(props.extent[2]);
          const s = Number(props.extent[3]);
          if (![s, w, n, e].some(isNaN)) {
            bbox = [Math.min(s, n), Math.min(w, e), Math.max(s, n), Math.max(w, e)];
          }
        }

        const labelParts = [
          props.city && props.city !== name ? props.city : null,
          props.county && props.county !== name ? props.county : null,
          props.state && props.state !== name ? props.state : null,
          props.country,
        ].filter(Boolean);

        const isDup = results.some(
          (r) =>
            r.name.toLowerCase() === name.toLowerCase() &&
            calculateDistanceKm(r.lat, r.lon, lat, lon) < 1.5
        );
        if (isDup) continue;

        results.push({
          name,
          label: labelParts.slice(0, 3).join(', '),
          lat,
          lon,
          bbox,
        });
        if (results.length >= 6) break;
      }

      if (results.length > 0) return results;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
  }

  // 2. Fallback: OSM Nominatim
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    clean
  )}&limit=6&accept-language=cs`;
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
  const leisure = (tags.leisure || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();
  const building = (tags.building || '').toLowerCase();
  const nameLower = (tags['name:cs'] || tags.name || '').toLowerCase();

  if (tourism === 'alpine_hut') return 'alpine_hut';
  if (tourism === 'guest_house' || tourism === 'bed_and_breakfast' || tourism === 'inn') {
    return 'guest_house';
  }
  if (tourism === 'hostel') return 'hostel';
  if (tourism === 'chalet') return 'chalet';
  if (tourism === 'hotel' || tourism === 'motel') return 'hotel';
  if (tourism === 'apartment') return 'apartment';
  if (tourism === 'holiday_park') return 'camp_site';
  if (tourism === 'resort' || tourism === 'lodge') {
    if (/(kemp|autokemp|camp|chatk)/i.test(nameLower)) return 'camp_site';
    if (/(hotel)/i.test(nameLower)) return 'hotel';
    if (/(bouda|horská chata|turistická chata)/i.test(nameLower)) return 'alpine_hut';
    return 'guest_house';
  }

  if (tourism === 'camp_site' || tourism === 'caravan_site') {
    if (tags.backcountry === 'yes' || tags.impromptu === 'yes') return null;
    const campType = (tags.camp_type || '').toLowerCase();
    if (['primitive', 'basic', 'wilderness', 'bivouac', 'tent_only'].includes(campType)) {
      return null;
    }

    const explicitCabins = hasExplicitCabinsTag(tags);
    if (
      !explicitCabins &&
      tags.cabins === 'no' &&
      tags.bungalows !== 'yes' &&
      tags.chalets !== 'yes'
    ) {
      return null;
    }

    const nameAndDesc = `${tags.name || ''} ${tags.description || ''}`.toLowerCase();
    if (
      tourism === 'caravan_site' &&
      !explicitCabins &&
      !/(autokemp|kemp|camp|chatk|rekreač)/i.test(nameAndDesc)
    ) {
      return null;
    }

    return 'camp_site';
  }

  if (leisure === 'resort') {
    if (/(kemp|autokemp|camp|chatk)/i.test(nameLower)) return 'camp_site';
    if (/(hotel)/i.test(nameLower)) return 'hotel';
    return 'guest_house';
  }

  if ((amenity === 'restaurant' || amenity === 'pub') && (tags.rooms || tags.beds)) {
    if (/(bouda|horská chata|turistická chata)/i.test(nameLower)) return 'alpine_hut';
    return 'guest_house';
  }

  if (building === 'hotel') {
    if (/(maloobchod|obchod|prodejna|budova\s+\d|areál\s+svit|úřad|škola|kancelář)/i.test(nameLower)) {
      return null;
    }
    if (/(ubytovn|hostel|turistick)/i.test(nameLower)) return 'hostel';
    if (/(penzion|pension|privát|dvůr|mlýn|statek|chalup)/i.test(nameLower)) return 'guest_house';
    if (/(chata|bouda)/i.test(nameLower)) return 'alpine_hut';
    if (/(hotel|motel|lázně|lazne|resort|wellness|garni)/i.test(nameLower)) return 'hotel';
    return null;
  }

  return null;
}

const FOREST_BAR_NAME_REGEX =
  /(lesn[íi]\s*(bar|bufet|ob[čc]erstven[íi]|ledni[čc]ka|pivovar|vý[čc]ep|kav[áa]rna)|samoobslu[žz]n[ýáé]\s*(bar|lesn[íi]\s*bar|ob[čc]erstven[íi]|bufet|budka|ledni[čc]ka|chladni[čc]ka|vý[čc]ep|st[áa]nek|skl[íi]pek|kiosek|chata|boud[aě]|lednice)|lu[čc]n[íi]\s*bar|pivn[íi]\s*stud[áa]nk|stud[áa]nkov[ýé]\s*bar|bar\s*v\s*lese|bar\s*u\s*stud[áa]nky)/i;

function isForestBar(tags: Record<string, string>): boolean {
  const amenity = (tags.amenity || '').toLowerCase();
  const vending = (tags.vending || '').toLowerCase();
  const selfService = (tags.self_service || '').toLowerCase();
  const honestyBox = (tags.honesty_box || tags['payment:honesty_box'] || '').toLowerCase();
  const combinedText = `${tags['name:cs'] || ''} ${tags.name || ''} ${tags.official_name || ''} ${tags.alt_name || ''} ${tags.description || ''} ${tags.note || ''}`;

  if (FOREST_BAR_NAME_REGEX.test(combinedText)) {
    return true;
  }

  if (
    (selfService === 'yes' || selfService === 'only' || honestyBox === 'yes') &&
    (amenity === 'bar' ||
      amenity === 'biergarten' ||
      amenity === 'pub' ||
      amenity === 'cafe' ||
      amenity === 'fast_food' ||
      amenity === 'drinking_water' ||
      amenity === 'shelter' ||
      tags.tourism === 'picnic_site')
  ) {
    return true;
  }

  if (amenity === 'vending_machine') {
    if (
      /(lesn[íi]|samoobslu[žz]|stud[áa]nk|lu[čc]n[íi]|horsk[ýé]\s*bar|bar\s*u\s*)/i.test(
        combinedText
      )
    ) {
      return true;
    }
    if (
      (selfService === 'yes' || honestyBox === 'yes') &&
      /(drinks|food|beer|refreshment)/i.test(vending) &&
      /(bar|ob[čc]erstven[íi]|stud[áa]nk|budka|chata|bouda)/i.test(combinedText)
    ) {
      return true;
    }
  }

  return false;
}

function classifyGastroCategory(tags: Record<string, string>): GastroCategory | null {
  const amenity = (tags.amenity || '').toLowerCase();
  const tourism = (tags.tourism || '').toLowerCase();
  const craft = (tags.craft || '').toLowerCase();
  const nameLower = (tags['name:cs'] || tags.name || '').toLowerCase();

  // Check forest bars & self-service trail bars first
  if (isForestBar(tags)) return 'forest_bar';

  if (amenity === 'restaurant' || amenity === 'food_court') return 'restaurant';
  if (amenity === 'pub') return 'pub';
  if (amenity === 'biergarten') return 'biergarten';
  if (amenity === 'fast_food' || amenity === 'ice_cream') return 'refreshment';
  if (amenity === 'cafe') return 'cafe';
  if (amenity === 'bar') return 'bar';

  if (craft === 'brewery' || craft === 'winery') {
    if (/(pivovar|pivnice|šaland|výčep)/i.test(nameLower)) return 'pub';
    return 'bar';
  }

  // Mountain huts and guest houses that explicitly offer restaurant/food/drink service
  if (tourism === 'alpine_hut') {
    if (/(bufet|kiosek|občerstvení|stánek)/i.test(nameLower)) return 'refreshment';
    return 'restaurant';
  }
  if (
    (tourism === 'guest_house' || tourism === 'hotel' || tourism === 'chalet') &&
    (tags.restaurant === 'yes' ||
      tags.food === 'yes' ||
      tags.bar === 'yes' ||
      tags.cuisine ||
      /(restaurace|hostinec|hospoda|hospůdka|pivnice|pivovar|bistro|šynk|koliba|chata|bouda)/i.test(
        nameLower
      ))
  ) {
    if (/(hospoda|hospůdka|pivnice|výčep|šynk)/i.test(nameLower)) return 'pub';
    if (/(bistro|bufet|občerstvení)/i.test(nameLower)) return 'refreshment';
    return 'restaurant';
  }

  return null;
}

function isPubliclyUsableParking(tags: Record<string, string>): {
  usable: boolean;
  accessPolicy: ParkingAccessPolicy;
  accessNote: string;
} {
  const access = (tags.access || '').toLowerCase().trim();
  const parking = (tags.parking || '').toLowerCase().trim();

  // Strictly exclude private, resident-only, staff-only, or forbidden parking lots
  const bannedAccess = new Set([
    'private',
    'no',
    'employees',
    'staff',
    'residents',
    'military',
    'delivery',
    'agricultural',
    'forestry',
    'emergency',
    'disabled',
  ]);
  if (bannedAccess.has(access)) {
    return { usable: false, accessPolicy: 'public', accessNote: '' };
  }
  if (parking === 'private' || parking === 'garages' || parking === 'sheds' || parking === 'carports') {
    return { usable: false, accessPolicy: 'public', accessNote: '' };
  }

  if (access === 'customers' || access === 'visitors' || access === 'destination') {
    return {
      usable: true,
      accessPolicy: 'customers',
      accessNote: 'Pro návštěvníky / hosty areálu či restaurace',
    };
  }

  if (access === 'permissive' || access === 'permit') {
    return {
      usable: true,
      accessPolicy: 'public',
      accessNote: 'Přístupné veřejnosti (příp. s místním povolením)',
    };
  }

  return {
    usable: true,
    accessPolicy: 'public',
    accessNote: 'Veřejně přístupné parkoviště / odstavná plocha',
  };
}

function classifyParkingCategory(tags: Record<string, string>): ParkingCategory | null {
  const amenity = (tags.amenity || '').toLowerCase();
  const tourism = (tags.tourism || '').toLowerCase();
  const highway = (tags.highway || '').toLowerCase();
  const parking = (tags.parking || '').toLowerCase();

  if (tourism === 'caravan_site' || tags.caravans === 'yes' || tags.motorhome === 'yes') {
    return 'caravan';
  }
  if (highway === 'rest_area' || highway === 'services') {
    return 'layby';
  }
  if (amenity !== 'parking' && amenity !== 'parking_space' && amenity !== 'parking_entrance') {
    return null;
  }
  // Skip single individual parking_space polygons inside a larger lot unless named or capacity >= 3
  if (amenity === 'parking_space' && !tags.name && (!tags.capacity || parseInt(tags.capacity, 10) < 3)) {
    return null;
  }
  if (amenity === 'parking_entrance' && parking !== 'underground' && parking !== 'multi-storey') {
    return null;
  }

  if (parking === 'multi-storey' || parking === 'rooftop') return 'multi_storey';
  if (parking === 'underground') return 'underground';
  if (
    parking === 'layby' ||
    parking === 'street_side' ||
    parking === 'lane' ||
    parking === 'shoulder'
  ) {
    return 'layby';
  }

  return 'surface';
}

function evaluateParkingFee(tags: Record<string, string>): {
  feePolicy: ParkingFeePolicy;
  feeNote: string;
} {
  const fee = (tags.fee || '').toLowerCase().trim();
  const charge = (tags.charge || tags['payment:coins'] || '').trim();

  if (fee === 'no' || fee === 'false' || fee === 'none' || fee === 'free') {
    return {
      feePolicy: 'free',
      feeNote: 'Parkování zdarma (potvrzeno v OSM)',
    };
  }
  if (
    fee === 'yes' ||
    fee === 'true' ||
    fee === 'interval' ||
    Boolean(tags.charge) ||
    tags['park_ride'] === 'paid'
  ) {
    return {
      feePolicy: 'paid',
      feeNote: charge && charge !== 'yes' ? `Placené parkoviště (${charge})` : 'Placené parkoviště (automat / poplatek)',
    };
  }
  return {
    feePolicy: 'unknown',
    feeNote: 'Poplatek v OSM neuveden (ověřte značení na místě)',
  };
}

const SURFACE_LABELS_CZ: Record<string, string> = {
  asphalt: 'Asfalt',
  paved: 'Zpevněný povrch',
  concrete: 'Beton',
  paving_stones: 'Dlažba',
  sett: 'Dlažební kostky',
  cobblestone: 'Kočičí hlavy',
  gravel: 'Štěrk',
  fine_gravel: 'Jemný štěrk',
  compacted: 'Zpevněný štěrk',
  unpaved: 'Nezpevněná plocha',
  ground: 'Přírodní povrch',
  dirt: 'Hlína / přírodní',
  grass: 'Travnatá plocha',
  grass_paver: 'Zatravňovací dlažba',
};

const CUISINE_LABELS_CZ: Record<string, string> = {
  czech: 'Česká kuchyně',
  regional: 'Regionální kuchyně',
  local: 'Domácí / místní',
  international: 'Mezinárodní',
  pizza: 'Pizzerie',
  italian: 'Italská',
  burger: 'Burgery',
  grill: 'Gril / steaky',
  steak_house: 'Steakhouse',
  fish: 'Ryby',
  coffee_shop: 'Káva a zákusky',
  cake: 'Zákusky',
  ice_cream: 'Zmrzlina',
  asian: 'Asijská',
  vietnamese: 'Vietnamská',
  indian: 'Indická',
  mexican: 'Mexická',
  kebab: 'Kebab',
};

function formatCuisineCz(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const translated = parts.slice(0, 3).map((p) => CUISINE_LABELS_CZ[p] || p);
  return translated.join(', ');
}

function evaluatePetPolicy(
  tags: Record<string, string>,
  context: 'accommodation' | 'gastro' = 'accommodation'
): {
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
      petNote: 'V datech OSM uvedeno: vstup se psem zakázán',
      petFee,
    };
  }

  if (
    ['yes', 'designated', 'permissive', 'welcome', 'leashed', 'on_leash', 'conditional', 'outside'].includes(
      rawPets
    ) ||
    ['yes', 'designated', 'permissive', 'leashed', 'on_leash', 'outside'].includes(rawDog)
  ) {
    if (rawDog === 'outside' || rawPets === 'outside') {
      return {
        petPolicy: 'confirmed',
        petNote: 'Pes povolen na venkovní zahrádce (OSM)',
        petFee,
      };
    }
    const detail =
      rawDog === 'leashed' || rawPets === 'leashed' || rawDog === 'on_leash'
        ? 'Pes povolen (na vodítku · potvrzeno v OSM)'
        : context === 'gastro'
          ? 'Vstup se psem potvrzen v datech OSM'
          : 'Ubytování se psem potvrzeno v datech OSM';
    return {
      petPolicy: 'confirmed',
      petNote: detail,
      petFee,
    };
  }

  return {
    petPolicy: 'unverified',
    petNote:
      context === 'gastro'
        ? 'Podmínky pro psa v OSM neuvedeny (na zahrádkách a v horských chatách obvykle bez problému)'
        : 'Podmínky pro psa v OSM neuvedeny – ověřte při rezervaci nebo telefonicky',
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

  const numericRooms = parseInt(tags.rooms || '', 10);

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
        oneNightPolicy: !isNaN(numericRooms) && numericRooms >= 4 ? 'ideal' : 'likely',
        oneNightNote:
          !isNaN(numericRooms) && numericRooms >= 4
            ? `Penzion (${numericRooms} pokojů) – jednotlivé pokoje na 1 noc obvykle možné`
            : 'Penzion – 1 noc většinou možná (o víkendech a v sezóně nutno ověřit)',
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
  const step = Math.max(1, Math.floor(referenceCoords.length / 450));
  let minD = Infinity;
  for (let i = 0; i < referenceCoords.length; i += step) {
    const d = calculateDistanceKm(lat, lon, referenceCoords[i][0], referenceCoords[i][1]);
    if (d < minD) minD = d;
  }
  const last = referenceCoords[referenceCoords.length - 1];
  const dLast = calculateDistanceKm(lat, lon, last[0], last[1]);
  if (dLast < minD) minD = dLast;
  return minD;
}

/**
 * Partition a route polyline into contiguous, gap-free overlapping corridor boxes.
 * Guarantees 100% coverage of long trails while tightly hugging diagonal paths.
 */
function buildRouteCorridorBoxes(
  coords: Coordinate[],
  corridorKm = 8.5,
  maxBoxes = 7
): [number, number, number, number][] {
  if (coords.length === 0) return [];

  const step = Math.max(1, Math.floor(coords.length / 400));
  const sampled: Coordinate[] = [];
  for (let i = 0; i < coords.length; i += step) sampled.push(coords[i]);
  const lastPt = coords[coords.length - 1];
  if (sampled[sampled.length - 1] !== lastPt) sampled.push(lastPt);

  const cumDist: number[] = [0];
  let totalKm = 0;
  for (let i = 1; i < sampled.length; i++) {
    totalKm += calculateDistanceKm(
      sampled[i - 1][0],
      sampled[i - 1][1],
      sampled[i][0],
      sampled[i][1]
    );
    cumDist.push(totalKm);
  }

  const chunkCount = Math.max(1, Math.min(maxBoxes, Math.ceil(totalKm / 22)));
  const chunkKm = totalKm > 0 ? totalKm / chunkCount : 1;

  const rawBoxes: [number, number, number, number][] = [];
  let startIdx = 0;

  for (let c = 0; c < chunkCount; c++) {
    const targetDist = c === chunkCount - 1 ? totalKm + 1 : (c + 1) * chunkKm;
    let endIdx = startIdx;
    while (endIdx < sampled.length - 1 && cumDist[endIdx] < targetDist) {
      endIdx++;
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const [lat, lon] = sampled[i];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    const midLat = (minLat + maxLat) / 2;
    const padLat = corridorKm / 111.32;
    const padLon = corridorKm / (111.32 * Math.max(0.25, Math.cos((midLat * Math.PI) / 180)));

    rawBoxes.push([minLat - padLat, minLon - padLon, maxLat + padLat, maxLon + padLon]);
    startIdx = endIdx;
  }

  const merged: [number, number, number, number][] = [];
  for (const box of rawBoxes) {
    if (merged.length === 0) {
      merged.push(box);
      continue;
    }
    const prev = merged[merged.length - 1];
    const uS = Math.min(prev[0], box[0]);
    const uW = Math.min(prev[1], box[1]);
    const uN = Math.max(prev[2], box[2]);
    const uE = Math.max(prev[3], box[3]);
    if (uN - uS <= 0.22 && uE - uW <= 0.32) {
      merged[merged.length - 1] = [uS, uW, uN, uE];
    } else {
      merged.push(box);
    }
  }

  return merged;
}

interface PreparedQueryGeometry {
  useRouteCorridor: boolean;
  cacheKey: string;
  osmBoxes: [number, number, number, number][];
  unionBounds: [number, number, number, number];
  maxRouteCorridorKm: number | null;
}

function prepareQueryGeometry(
  prefix: string,
  input: SearchAreaInput,
  routeCorridorKm: number,
  defaultRadiusKm: number
): PreparedQueryGeometry {
  const {
    centerLat,
    centerLon,
    radiusKm = defaultRadiusKm,
    bbox,
    referenceCoords,
    preferBbox = false,
  } = input;

  const useRouteCorridor = Boolean(referenceCoords && referenceCoords.length >= 2 && !preferBbox);

  const cacheKey = useRouteCorridor
    ? `${prefix}_route_${centerLat.toFixed(2)}_${centerLon.toFixed(2)}_${referenceCoords!.length}`
    : bbox
      ? `${prefix}_bbox_${bbox.map((v) => v.toFixed(2)).join('_')}_${referenceCoords?.length || 0}`
      : `${prefix}_pt_${centerLat.toFixed(2)}_${centerLon.toFixed(2)}_${Math.round(radiusKm)}`;

  let osmBoxes: [number, number, number, number][] = [];
  let unionBounds: [number, number, number, number] = [
    centerLat - 0.1,
    centerLon - 0.14,
    centerLat + 0.1,
    centerLon + 0.14,
  ];
  let maxRouteCorridorKm: number | null = null;

  if (useRouteCorridor && referenceCoords) {
    maxRouteCorridorKm = routeCorridorKm + 1.0;
    osmBoxes = buildRouteCorridorBoxes(referenceCoords, routeCorridorKm, 7);
    unionBounds = [
      Math.min(...osmBoxes.map((b) => b[0])),
      Math.min(...osmBoxes.map((b) => b[1])),
      Math.max(...osmBoxes.map((b) => b[2])),
      Math.max(...osmBoxes.map((b) => b[3])),
    ];
  } else if (bbox) {
    let [s, w, n, e] = bbox;
    const latSpan = Math.abs(n - s);
    const lonSpan = Math.abs(e - w);
    if (latSpan > 0.56 || lonSpan > 0.86) {
      const cLat = (s + n) / 2;
      const cLon = (w + e) / 2;
      s = cLat - 0.28;
      n = cLat + 0.28;
      w = cLon - 0.43;
      e = cLon + 0.43;
    }
    unionBounds = [s, w, n, e];

    const rows = n - s > 0.18 ? 2 : 1;
    const cols = e - w > 0.52 ? 3 : e - w > 0.24 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const rS = s + ((n - s) * r) / rows;
      const rN = s + ((n - s) * (r + 1)) / rows;
      for (let c = 0; c < cols; c++) {
        const cW = w + ((e - w) * c) / cols;
        const cE = w + ((e - w) * (c + 1)) / cols;
        osmBoxes.push([rS, cW, rN, cE]);
      }
    }
  } else {
    const rKm = Math.min(16, Math.max(3, radiusKm));
    const dLat = rKm / 111.32;
    const dLon = rKm / (111.32 * Math.max(0.25, Math.cos((centerLat * Math.PI) / 180)));
    const s = centerLat - dLat;
    const n = centerLat + dLat;
    const w = centerLon - dLon;
    const e = centerLon + dLon;
    unionBounds = [s, w, n, e];

    if (n - s > 0.16 || e - w > 0.24) {
      const midLat = (s + n) / 2;
      const midLon = (w + e) / 2;
      osmBoxes = [
        [s, w, midLat, midLon],
        [s, midLon, midLat, e],
        [midLat, w, n, midLon],
        [midLat, midLon, n, e],
      ];
    } else {
      osmBoxes = [[s, w, n, e]];
    }
  }

  return {
    useRouteCorridor,
    cacheKey,
    osmBoxes,
    unionBounds,
    maxRouteCorridorKm,
  };
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

function buildQleverTourismSparql(polyWkt: string, limit = 650): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?tourism (geof:centroid(?geom) AS ?centroid)
  ?pets ?dog ?pets_allowed ?fee_pets
  ?phone ?cphone ?cmobile ?website ?cwebsite ?email
  ?ele ?capacity ?beds ?rooms ?cabins ?bungalows ?chalets ?min_stay ?camp_type ?backcountry
  ?hours ?street ?housenumber ?city ?village ?town
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  ?osm osmkey:tourism ?tourism .
  VALUES ?tourism { "alpine_hut" "guest_house" "hostel" "chalet" "hotel" "motel" "apartment" "camp_site" "caravan_site" "bed_and_breakfast" "resort" "holiday_park" "lodge" "inn" }
  ?osm osmkey:name ?name .
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:pets ?pets }
  OPTIONAL { ?osm osmkey:dog ?dog }
  OPTIONAL { ?osm osmkey:pets_allowed ?pets_allowed }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:fee:pets> ?fee_pets }
  OPTIONAL { ?osm osmkey:phone ?phone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:phone> ?cphone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:mobile> ?cmobile }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:website> ?cwebsite }
  OPTIONAL { ?osm osmkey:email ?email }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:capacity ?capacity }
  OPTIONAL { ?osm osmkey:beds ?beds }
  OPTIONAL { ?osm osmkey:rooms ?rooms }
  OPTIONAL { ?osm osmkey:cabins ?cabins }
  OPTIONAL { ?osm osmkey:bungalows ?bungalows }
  OPTIONAL { ?osm osmkey:chalets ?chalets }
  OPTIONAL { ?osm osmkey:minimum_stay ?min_stay }
  OPTIONAL { ?osm osmkey:camp_type ?camp_type }
  OPTIONAL { ?osm osmkey:backcountry ?backcountry }
  OPTIONAL { ?osm osmkey:opening_hours ?hours }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:street> ?street }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:housenumber> ?housenumber }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:town> ?town }
} LIMIT ${limit}`;
}

function buildQleverSupplementarySparql(polyWkt: string): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?leisure ?amenity ?building (geof:centroid(?geom) AS ?centroid)
  ?pets ?dog ?phone ?cphone ?website ?cwebsite ?ele ?rooms ?beds ?city ?village
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  {
    ?osm osmkey:leisure "resort" .
    BIND("resort" AS ?leisure)
  } UNION {
    ?osm osmkey:building "hotel" .
    BIND("hotel" AS ?building)
  } UNION {
    ?osm osmkey:amenity ?amenity .
    VALUES ?amenity { "restaurant" "pub" }
    ?osm osmkey:rooms ?rooms .
  }
  ?osm osmkey:name ?name .
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:pets ?pets }
  OPTIONAL { ?osm osmkey:dog ?dog }
  OPTIONAL { ?osm osmkey:phone ?phone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:phone> ?cphone }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:website> ?cwebsite }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:beds ?beds }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
} LIMIT 250`;
}

function buildQleverGastroSparql(polyWkt: string, limit = 650): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?amenity ?tourism (geof:centroid(?geom) AS ?centroid)
  ?cuisine ?brewery ?outdoor_seating ?takeaway ?pets ?dog ?self_service ?vending ?description
  ?phone ?cphone ?cmobile ?website ?cwebsite ?email
  ?ele ?hours ?street ?housenumber ?city ?village ?town
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  {
    ?osm osmkey:amenity ?amenity .
    VALUES ?amenity { "restaurant" "pub" "biergarten" "fast_food" "cafe" "bar" "food_court" "ice_cream" "vending_machine" }
  } UNION {
    ?osm osmkey:tourism "alpine_hut" .
    BIND("alpine_hut" AS ?tourism)
  }
  ?osm osmkey:name ?name .
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:cuisine ?cuisine }
  OPTIONAL { ?osm osmkey:brewery ?brewery }
  OPTIONAL { ?osm osmkey:outdoor_seating ?outdoor_seating }
  OPTIONAL { ?osm osmkey:takeaway ?takeaway }
  OPTIONAL { ?osm osmkey:pets ?pets }
  OPTIONAL { ?osm osmkey:dog ?dog }
  OPTIONAL { ?osm osmkey:self_service ?self_service }
  OPTIONAL { ?osm osmkey:vending ?vending }
  OPTIONAL { ?osm osmkey:description ?description }
  OPTIONAL { ?osm osmkey:phone ?phone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:phone> ?cphone }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:mobile> ?cmobile }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:website> ?cwebsite }
  OPTIONAL { ?osm osmkey:email ?email }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:opening_hours ?hours }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:street> ?street }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:housenumber> ?housenumber }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:town> ?town }
} LIMIT ${limit}`;
}

function buildQleverGastroSupplementarySparql(polyWkt: string): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?amenity ?tourism (geof:centroid(?geom) AS ?centroid)
  ?self_service ?vending ?description ?website ?cwebsite ?ele ?hours ?city ?village
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  ?osm osmkey:name ?name .
  FILTER (REGEX(?name, "(lesn[íi]\\\\s*(bar|bufet|ob[čc]erstven|ledni|vý[čc]ep|kav[áa]rna)|samoobslu[žz]n[ýáé]\\\\s*(bar|lesn[íi]\\\\s*bar|ob[čc]erstven|bufet|budka|ledni|chladni|vý[čc]ep|st[áa]nek)|lu[čc]n[íi]\\\\s*bar|pivn[íi]\\\\s*stud[áa]nk|stud[áa]nkov[ýé]\\\\s*bar|bar\\\\s*v\\\\s*lese|bar\\\\s*u\\\\s*stud[áa]nky)", "i"))
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:amenity ?amenity }
  OPTIONAL { ?osm osmkey:tourism ?tourism }
  OPTIONAL { ?osm osmkey:self_service ?self_service }
  OPTIONAL { ?osm osmkey:vending ?vending }
  OPTIONAL { ?osm osmkey:description ?description }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:contact:website> ?cwebsite }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:opening_hours ?hours }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
} LIMIT 200`;
}

function buildQleverParkingSparql(polyWkt: string, limit = 650): string {
  return `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?amenity ?highway ?tourism (geof:centroid(?geom) AS ?centroid)
  ?parking ?access ?fee ?charge ?capacity ?surface ?maxstay
  ?ele ?hours ?operator ?website ?street ?city ?village ?town
WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${polyWkt}"^^geo:wktLiteral))
  {
    ?osm osmkey:amenity "parking" .
    BIND("parking" AS ?amenity)
  } UNION {
    ?osm osmkey:highway "rest_area" .
    BIND("rest_area" AS ?highway)
  } UNION {
    ?osm osmkey:tourism "caravan_site" .
    BIND("caravan_site" AS ?tourism)
  }
  OPTIONAL { ?osm osmkey:name ?name }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:parking ?parking }
  OPTIONAL { ?osm osmkey:access ?access }
  OPTIONAL { ?osm osmkey:fee ?fee }
  OPTIONAL { ?osm osmkey:charge ?charge }
  OPTIONAL { ?osm osmkey:capacity ?capacity }
  OPTIONAL { ?osm osmkey:surface ?surface }
  OPTIONAL { ?osm osmkey:maxstay ?maxstay }
  OPTIONAL { ?osm osmkey:ele ?ele }
  OPTIONAL { ?osm osmkey:opening_hours ?hours }
  OPTIONAL { ?osm osmkey:operator ?operator }
  OPTIONAL { ?osm osmkey:website ?website }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:street> ?street }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:city> ?city }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:village> ?village }
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:addr:town> ?town }
} LIMIT ${limit}`;
}

interface SparqlBindingVal {
  value?: string;
}

function parseQleverBindings(
  bindings: Record<string, SparqlBindingVal | undefined>[],
  allowUnnamed = false
): RawOsmElement[] {
  const elements: RawOsmElement[] = [];
  for (const row of bindings) {
    const pt = parseWktPoint(row.centroid?.value);
    const name = (row.name_cs?.value || row.name?.value || '').trim();
    if (!pt || (!allowUnnamed && !name)) continue;

    const { type, id } = parseOsmUri(row.osm?.value);
    const tags: Record<string, string> = {};
    if (name) tags.name = name;
    if (row.name_cs?.value) tags['name:cs'] = row.name_cs.value;
    if (row.tourism?.value) tags.tourism = row.tourism.value;
    if (row.leisure?.value) tags.leisure = row.leisure.value;
    if (row.amenity?.value) tags.amenity = row.amenity.value;
    if (row.highway?.value) tags.highway = row.highway.value;
    if (row.building?.value) tags.building = row.building.value;
    if (row.pets?.value) tags.pets = row.pets.value;
    if (row.dog?.value) tags.dog = row.dog.value;
    if (row.pets_allowed?.value) tags.pets_allowed = row.pets_allowed.value;
    if (row.fee_pets?.value) tags['fee:pets'] = row.fee_pets.value;
    if (row.phone?.value) tags.phone = row.phone.value;
    if (row.cphone?.value) tags['contact:phone'] = row.cphone.value;
    if (row.cmobile?.value) tags['contact:mobile'] = row.cmobile.value;
    if (row.website?.value) tags.website = row.website.value;
    if (row.cwebsite?.value) tags['contact:website'] = row.cwebsite.value;
    if (row.email?.value) tags.email = row.email.value;
    if (row.ele?.value) tags.ele = row.ele.value;
    if (row.capacity?.value) tags.capacity = row.capacity.value;
    if (row.beds?.value) tags.beds = row.beds.value;
    if (row.rooms?.value) tags.rooms = row.rooms.value;
    if (row.cabins?.value) tags.cabins = row.cabins.value;
    if (row.bungalows?.value) tags.bungalows = row.bungalows.value;
    if (row.chalets?.value) tags.chalets = row.chalets.value;
    if (row.min_stay?.value) tags.minimum_stay = row.min_stay.value;
    if (row.camp_type?.value) tags.camp_type = row.camp_type.value;
    if (row.backcountry?.value) tags.backcountry = row.backcountry.value;
    if (row.hours?.value) tags.opening_hours = row.hours.value;
    if (row.street?.value) tags['addr:street'] = row.street.value;
    if (row.housenumber?.value) tags['addr:housenumber'] = row.housenumber.value;
    if (row.city?.value) tags['addr:city'] = row.city.value;
    if (row.village?.value) tags['addr:village'] = row.village.value;
    if (row.town?.value) tags['addr:town'] = row.town.value;
    if (row.cuisine?.value) tags.cuisine = row.cuisine.value;
    if (row.brewery?.value) tags.brewery = row.brewery.value;
    if (row.outdoor_seating?.value) tags.outdoor_seating = row.outdoor_seating.value;
    if (row.takeaway?.value) tags.takeaway = row.takeaway.value;
    if (row.self_service?.value) tags.self_service = row.self_service.value;
    if (row.vending?.value) tags.vending = row.vending.value;
    if (row.description?.value) tags.description = row.description.value;
    if (row.parking?.value) tags.parking = row.parking.value;
    if (row.access?.value) tags.access = row.access.value;
    if (row.fee?.value) tags.fee = row.fee.value;
    if (row.charge?.value) tags.charge = row.charge.value;
    if (row.surface?.value) tags.surface = row.surface.value;
    if (row.maxstay?.value) tags.maxstay = row.maxstay.value;
    if (row.operator?.value) tags.operator = row.operator.value;

    elements.push({ type, id, lat: pt.lat, lon: pt.lon, tags });
  }
  return elements;
}

async function fetchQleverSparql(
  endpoint: string,
  sparql: string,
  timeoutMs: number,
  parentSignal?: AbortSignal,
  allowUnnamed = false
): Promise<RawOsmElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort);

  try {
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
    return parseQleverBindings(bindings, allowUnnamed);
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

function mergeUniqueOsmElements(batches: RawOsmElement[][]): RawOsmElement[] {
  const seen = new Set<string>();
  const merged: RawOsmElement[] = [];
  for (const el of batches.flat()) {
    const key = `${el.type || 'node'}_${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(el);
  }
  return merged;
}

async function queryOsmComprehensive(
  boxes: [number, number, number, number][],
  buildMainSparql: (polyWkt: string) => string,
  overpassQuery: string,
  signal?: AbortSignal,
  options?: {
    allowUnnamed?: boolean;
    unionBounds?: [number, number, number, number];
    buildSupplementarySparql?: (unionPolyWkt: string) => string;
  }
): Promise<{ elements: RawOsmElement[]; failed: boolean }> {
  const allowUnnamed = Boolean(options?.allowUnnamed);
  try {
    const mainTasks = boxes.map((box, idx) => {
      const poly = makeWktPolygon(box[0], box[1], box[2], box[3]);
      const sparql = buildMainSparql(poly);
      const primaryEp = QLEVER_ENDPOINTS[idx % QLEVER_ENDPOINTS.length];
      const secondaryEp = QLEVER_ENDPOINTS[(idx + 1) % QLEVER_ENDPOINTS.length];
      return fetchQleverSparql(primaryEp, sparql, 7500, signal, allowUnnamed).catch((err) => {
        if (signal?.aborted) throw err;
        return fetchQleverSparql(secondaryEp, sparql, 6500, signal, allowUnnamed);
      });
    });

    let suppTask: Promise<RawOsmElement[]> = Promise.resolve([]);
    if (options?.unionBounds && options?.buildSupplementarySparql) {
      const u = options.unionBounds;
      const unionPoly = makeWktPolygon(u[0], u[1], u[2], u[3]);
      suppTask = fetchQleverSparql(
        QLEVER_ENDPOINTS[1],
        options.buildSupplementarySparql(unionPoly),
        5500,
        signal,
        allowUnnamed
      ).catch(() => [] as RawOsmElement[]);
    }

    const [settledMain, suppElements] = await Promise.all([
      Promise.allSettled(mainTasks),
      suppTask,
    ]);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const okBatches = settledMain
      .filter((r): r is PromiseFulfilledResult<RawOsmElement[]> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (okBatches.length > 0) {
      if (suppElements.length > 0) okBatches.push(suppElements);
      return { elements: mergeUniqueOsmElements(okBatches), failed: false };
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    void err;
  }

  try {
    const elements = await Promise.any(
      OVERPASS_FALLBACK_ENDPOINTS.map((ep) => fetchOverpassGetSingle(ep, overpassQuery, 7000, signal))
    );
    return { elements, failed: false };
  } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return { elements: [], failed: true };
  }
}

// ===========================================================================
// SUBSECTION 1: ACCOMMODATION SEARCH (Ubytování)
// ===========================================================================
export async function searchAccommodations(
  input: SearchAreaInput
): Promise<SearchAccommodationResult> {
  const { centerLat, centerLon, referenceCoords, signal } = input;
  const geom = prepareQueryGeometry('acc', input, 8.5, 10);

  const cached = accommodationCache.get(geom.cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  const OVERPASS_TOURISM_REGEX =
    '^(alpine_hut|guest_house|hostel|chalet|camp_site|caravan_site|hotel|motel|apartment|bed_and_breakfast|resort|holiday_park|lodge|inn)$';

  const unionParts = geom.osmBoxes
    .map((b) => {
      const area = `(${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)},${b[3].toFixed(4)})`;
      return `  nw["tourism"~"${OVERPASS_TOURISM_REGEX}"]${area};\n  nw["leisure"="resort"]${area};`;
    })
    .join('\n');
  const overpassQuery = `[out:json][timeout:10];\n(\n${unionParts}\n);\nout center tags;`;

  const osmRes = await queryOsmComprehensive(
    geom.osmBoxes,
    (poly) => buildQleverTourismSparql(poly, 650),
    overpassQuery,
    signal,
    {
      allowUnnamed: false,
      unionBounds: geom.unionBounds,
      buildSupplementarySparql: buildQleverSupplementarySparql,
    }
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (osmRes.failed) {
    throw new Error(
      'Databáze OpenStreetMap je momentálně přetížená nebo nedostupná. Zkuste prosím menší výřez mapy nebo akci zopakujte.'
    );
  }

  const places: AccommodationPlace[] = [];

  for (const el of osmRes.elements) {
    const tags = el.tags || {};
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const category = classifyOsmCategory(tags);
    if (!category) continue;

    const name = (tags['name:cs'] || tags.name || tags.official_name || '').trim();
    if (!name) continue;
    if (isOutdoorSleepingNameOrLabel(name, tags.description)) continue;

    const distanceKm = minDistanceToRouteOrCenter(
      lat,
      lon,
      centerLat,
      centerLon,
      referenceCoords
    );
    if (geom.maxRouteCorridorKm !== null && distanceKm > geom.maxRouteCorridorKm) continue;

    const categoryMeta = CATEGORY_META_MAP[category];
    const { petPolicy, petNote, petFee } = evaluatePetPolicy(tags, 'accommodation');
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
      tags.beds
        ? `${tags.beds} lůžek`
        : tags.rooms
          ? `${tags.rooms} pokojů`
          : tags.capacity
            ? `${tags.capacity} míst`
            : undefined;

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
        el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
      rawTags: tags,
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

  const finalResult: SearchAccommodationResult = { places };
  accommodationCache.set(geom.cacheKey, { ts: Date.now(), result: finalResult });
  return finalResult;
}

// ===========================================================================
// SUBSECTION 2: GASTRO / FOOD & DRINK SEARCH (Jídlo a pití)
// ===========================================================================
export async function searchGastroPlaces(
  input: SearchAreaInput
): Promise<SearchGastroResult> {
  const { centerLat, centerLon, referenceCoords, signal } = input;
  const geom = prepareQueryGeometry('gastro', input, 5.5, 9);

  const cached = gastroCache.get(geom.cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  const OVERPASS_GASTRO_REGEX = '^(restaurant|pub|biergarten|fast_food|cafe|bar|food_court|ice_cream)$';
  const OVERPASS_FOREST_BAR_NAME_REGEX =
    '(Lesn[íi]\\\\s*(bar|bufet|ob[čc]erstven)|Samoobslu[žz]n[ýáé]\\\\s*(bar|ob[čc]erstven|bufet|budka|ledni)|Lu[čc]n[íi]\\\\s*bar|Pivn[íi]\\\\s*stud[áa]nk)';
  const unionParts = geom.osmBoxes
    .map((b) => {
      const area = `(${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)},${b[3].toFixed(4)})`;
      return `  nw["amenity"~"${OVERPASS_GASTRO_REGEX}"]${area};\n  nw["tourism"="alpine_hut"]${area};\n  nw["name"~"${OVERPASS_FOREST_BAR_NAME_REGEX}",i]${area};\n  nw["amenity"="vending_machine"]["self_service"="yes"]${area};`;
    })
    .join('\n');
  const overpassQuery = `[out:json][timeout:10];\n(\n${unionParts}\n);\nout center tags;`;

  const osmRes = await queryOsmComprehensive(
    geom.osmBoxes,
    (poly) => buildQleverGastroSparql(poly, 650),
    overpassQuery,
    signal,
    {
      allowUnnamed: false,
      unionBounds: geom.unionBounds,
      buildSupplementarySparql: buildQleverGastroSupplementarySparql,
    }
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (osmRes.failed) {
    throw new Error(
      'Databáze OpenStreetMap je momentálně přetížená nebo nedostupná. Zkuste prosím menší výřez mapy nebo akci zopakujte.'
    );
  }

  const places: GastroPlace[] = [];

  for (const el of osmRes.elements) {
    const tags = el.tags || {};
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const category = classifyGastroCategory(tags);
    if (!category) continue;

    const name = (tags['name:cs'] || tags.name || tags.official_name || '').trim();
    if (!name) continue;

    const distanceKm = minDistanceToRouteOrCenter(
      lat,
      lon,
      centerLat,
      centerLon,
      referenceCoords
    );
    if (geom.maxRouteCorridorKm !== null && distanceKm > geom.maxRouteCorridorKm) continue;

    const categoryMeta = GASTRO_CATEGORY_META_MAP[category];
    const { petPolicy, petNote } = evaluatePetPolicy(tags, 'gastro');
    const { address, city } = buildAddress(tags);

    let elevationM: number | null = null;
    if (tags.ele) {
      const parsedEle = parseFloat(tags.ele.replace(',', '.'));
      if (!isNaN(parsedEle) && parsedEle > 0 && parsedEle < 9000) {
        elevationM = Math.round(parsedEle);
      }
    }

    const outdoorSeating =
      category === 'biergarten' ||
      category === 'forest_bar' ||
      tags.outdoor_seating === 'yes' ||
      tags.outdoor_seating === 'terrace' ||
      tags.outdoor_seating === 'garden';

    const takeaway = tags.takeaway === 'yes' || tags.takeaway === 'only';

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
      openingHours: tags.opening_hours,
      cuisine: formatCuisineCz(tags.cuisine),
      brewery: tags.brewery || tags['real_ale'] === 'yes' ? tags.brewery : undefined,
      outdoorSeating,
      takeaway,
      petPolicy,
      petNote,
      description: tags.description || tags.note,
      source: 'osm',
      osmUrl:
        el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
      rawTags: tags,
    });
  }

  places.sort((a, b) => a.distanceKm - b.distanceKm);

  const finalResult: SearchGastroResult = { places };
  gastroCache.set(geom.cacheKey, { ts: Date.now(), result: finalResult });
  return finalResult;
}

// ===========================================================================
// SUBSECTION 3: PARKING SEARCH (Parkoviště a odstavné plochy)
// ===========================================================================
export async function searchParkingPlaces(
  input: SearchAreaInput
): Promise<SearchParkingResult> {
  const { centerLat, centerLon, referenceCoords, signal } = input;
  const geom = prepareQueryGeometry('parking', input, 4.5, 8);

  const cached = parkingCache.get(geom.cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  const unionParts = geom.osmBoxes
    .map((b) => {
      const area = `(${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)},${b[3].toFixed(4)})`;
      return `  nw["amenity"="parking"]${area};\n  nw["highway"="rest_area"]${area};\n  nw["tourism"="caravan_site"]${area};`;
    })
    .join('\n');
  const overpassQuery = `[out:json][timeout:10];\n(\n${unionParts}\n);\nout center tags;`;

  const osmRes = await queryOsmComprehensive(
    geom.osmBoxes,
    (poly) => buildQleverParkingSparql(poly, 650),
    overpassQuery,
    signal,
    { allowUnnamed: true }
  );

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (osmRes.failed) {
    throw new Error(
      'Databáze OpenStreetMap je momentálně přetížená nebo nedostupná. Zkuste prosím menší výřez mapy nebo akci zopakujte.'
    );
  }

  const rawPlaces: ParkingPlace[] = [];

  for (const el of osmRes.elements) {
    const tags = el.tags || {};
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const accessEval = isPubliclyUsableParking(tags);
    if (!accessEval.usable) continue;

    const category = classifyParkingCategory(tags);
    if (!category) continue;

    const distanceKm = minDistanceToRouteOrCenter(
      lat,
      lon,
      centerLat,
      centerLon,
      referenceCoords
    );
    if (geom.maxRouteCorridorKm !== null && distanceKm > geom.maxRouteCorridorKm) continue;

    const categoryMeta = PARKING_CATEGORY_META_MAP[category];
    const { feePolicy, feeNote } = evaluateParkingFee(tags);
    const { address, city } = buildAddress(tags);
    const street = tags['addr:street'] || tags['addr:place'] || '';

    const rawName = (tags['name:cs'] || tags.name || tags.official_name || '').trim();
    const isNamed = Boolean(rawName);
    let name = rawName;
    if (!name) {
      if (city && street) {
        name = `${categoryMeta.shortLabel} – ${city} (${street})`;
      } else if (city) {
        name = `${categoryMeta.shortLabel} (${city})`;
      } else if (street) {
        name = `${categoryMeta.shortLabel} (${street})`;
      } else if (tags.operator) {
        name = `${categoryMeta.shortLabel} – ${tags.operator}`;
      } else {
        name = categoryMeta.shortLabel;
      }
    }

    let elevationM: number | null = null;
    if (tags.ele) {
      const parsedEle = parseFloat(tags.ele.replace(',', '.'));
      if (!isNaN(parsedEle) && parsedEle > 0 && parsedEle < 9000) {
        elevationM = Math.round(parsedEle);
      }
    }

    const rawCap = tags.capacity ? parseInt(tags.capacity, 10) : NaN;
    const capacity =
      !isNaN(rawCap) && rawCap > 0
        ? `${rawCap} ${rawCap === 1 ? 'místo' : rawCap < 5 ? 'místa' : 'míst'}`
        : undefined;

    const rawSurface = (tags.surface || '').toLowerCase().trim();
    const surfaceLabel = rawSurface ? SURFACE_LABELS_CZ[rawSurface] || rawSurface : undefined;

    rawPlaces.push({
      id: `osm_${el.type || 'node'}_${el.id}`,
      name,
      isNamed,
      category,
      categoryLabel: categoryMeta.label,
      lat,
      lon,
      distanceKm,
      elevationM,
      address,
      city,
      capacity,
      feePolicy,
      feeNote,
      accessPolicy: accessEval.accessPolicy,
      accessNote: accessEval.accessNote,
      surfaceLabel,
      maxstay: tags.maxstay,
      openingHours: tags.opening_hours,
      operator: tags.operator,
      website: normalizeWebsite(tags.website || tags['contact:website']),
      description: tags.description || tags.note,
      source: 'osm',
      osmUrl:
        el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
      rawTags: tags,
    });
  }

  // Sort so named or higher-capacity parking areas come first when deduplicating micro-lots (<65 m apart)
  rawPlaces.sort((a, b) => {
    if (a.isNamed !== b.isNamed) return a.isNamed ? -1 : 1;
    return a.distanceKm - b.distanceKm;
  });

  const deduplicated: ParkingPlace[] = [];
  for (const p of rawPlaces) {
    const isMicroClusterDup = deduplicated.some(
      (existing) =>
        !p.isNamed &&
        existing.category === p.category &&
        calculateDistanceKm(existing.lat, existing.lon, p.lat, p.lon) < 0.065
    );
    if (isMicroClusterDup) continue;
    deduplicated.push(p);
  }

  deduplicated.sort((a, b) => a.distanceKm - b.distanceKm);

  const finalResult: SearchParkingResult = { places: deduplicated.slice(0, 320) };
  parkingCache.set(geom.cacheKey, { ts: Date.now(), result: finalResult });
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
 * Direct Booking.com search URL locked to 1 night, with optional pets allowed filter (nflt=pets%3D1).
 */
export function buildBookingOneNightDogUrl(opts: {
  placeName?: string;
  cityOrArea?: string;
  lat?: number;
  lon?: number;
  checkinIso: string;
  adults: number;
  withDog?: boolean;
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
    lang: 'cs',
  });
  if (opts.withDog !== false) {
    params.set('nflt', 'pets=1');
  }
  if (typeof opts.lat === 'number' && typeof opts.lon === 'number' && !opts.placeName) {
    params.set('latitude', opts.lat.toFixed(5));
    params.set('longitude', opts.lon.toFixed(5));
  }
  return `https://www.booking.com/searchresults.cs.html?${params.toString()}`;
}

export function buildOsmPlaceUrl(place: {
  osmUrl?: string;
  lat: number;
  lon: number;
}): string {
  if (place.osmUrl) return place.osmUrl;
  return `https://www.openstreetmap.org/?mlat=${place.lat.toFixed(6)}&mlon=${place.lon.toFixed(
    6
  )}#map=16/${place.lat.toFixed(6)}/${place.lon.toFixed(6)}`;
}

export function buildGoogleNavigationUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function buildGoogleOneNightDogQueryUrl(
  place: AccommodationPlace,
  withDog = true
): string {
  const suffix = withDog ? 'ubytování se psem 1 noc kontakt' : 'ubytování 1 noc kontakt';
  const q = `${place.name} ${place.city || ''} ${suffix}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function buildGooglePlaceSearchUrl(name: string, city?: string, suffix = ''): string {
  const q = [name, city, suffix].filter(Boolean).join(' ').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
