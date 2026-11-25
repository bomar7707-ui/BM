import { useEffect, useState } from 'react';

export type MapaStylePreset = 'atlas' | 'natural' | 'light' | 'dark' | 'satellite';

export interface MapaLayerVisibility {
  hillshade: boolean;
  hypsometry: boolean;
  forests: boolean;
  contours: boolean;
  hydrology: boolean;
  highways: boolean;
  railways: boolean;
  cities: boolean;
  peaks: boolean;
  borders: boolean;
  districts: boolean;
  graticule: boolean;
}

export interface MapaSettings {
  stylePreset: MapaStylePreset;
  layers: MapaLayerVisibility;
}

export const MAPA_STYLE_PRESETS: readonly {
  id: MapaStylePreset;
  label: string;
  desc: string;
  swatch: [string, string, string];
}[] = [
  {
    id: 'atlas',
    label: 'Fyzický atlas',
    desc: 'Hypsometrická výšková pásma, batymetrie a stínovaný reliéf',
    swatch: ['#E8E7D8', '#BCDCA0', '#8EC0E8'],
  },
  {
    id: 'natural',
    label: 'Přírodní terén',
    desc: 'Biomy, lesnatost pohoří, údolní nivy a výrazný stín',
    swatch: ['#E6EAD7', '#AED492', '#86B8E2'],
  },
  {
    id: 'light',
    label: 'Světlý kartografický',
    desc: 'Čistý podklad vhodný pro tisk a datové překryvy',
    swatch: ['#F7F6F0', '#C8E2AE', '#A4CEF0'],
  },
  {
    id: 'dark',
    label: 'Tmavý reliéf',
    desc: 'Kontrastní tmavý podklad se zvýrazněným vodstvem',
    swatch: ['#1B262C', '#2E4738', '#25547B'],
  },
  {
    id: 'satellite',
    label: 'Satelitní (Sentinel-2)',
    desc: 'Bezoblačné satelitní snímky ESA Sentinel-2 s hybridními popisky',
    swatch: ['#1F3B2B', '#4B5B44', '#163A59'],
  },
];

export const MAPA_LAYER_ITEMS: readonly {
  key: keyof MapaLayerVisibility;
  label: string;
}[] = [
  { key: 'hillshade', label: 'Stínovaný reliéf (SRTM DEM)' },
  { key: 'hypsometry', label: 'Výšková hypsometrie' },
  { key: 'forests', label: 'Lesy, mokřady, NP a CHKO' },
  { key: 'contours', label: 'Vrstevnice (adaptivní 10–200 m)' },
  { key: 'hydrology', label: 'Řeky, potoky, přehrady a rybníky' },
  { key: 'highways', label: 'Dálnice, silnice I.–III. tř. a ulice' },
  { key: 'railways', label: 'Železniční síť a tratě' },
  { key: 'cities', label: 'Města, obce, zástavba a budovy' },
  { key: 'peaks', label: 'Vrcholy a kóty (▲)' },
  { key: 'borders', label: 'Státní hranice a kraje' },
  { key: 'districts', label: 'Hranice okresů (77)' },
  { key: 'graticule', label: 'Zeměpisná síť WGS84' },
];

export const DEFAULT_MAPA_SETTINGS: MapaSettings = {
  stylePreset: 'atlas',
  layers: {
    hillshade: true,
    hypsometry: true,
    forests: true,
    contours: true,
    hydrology: true,
    highways: true,
    railways: true,
    cities: true,
    peaks: true,
    borders: true,
    districts: false,
    graticule: false,
  },
};

const STORAGE_KEY = 'horsky_zapisnik_mapa_v13_settings';

function loadInitialSettings(): MapaSettings {
  if (typeof window === 'undefined') return cloneSettings(DEFAULT_MAPA_SETTINGS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneSettings(DEFAULT_MAPA_SETTINGS);
    const parsed = JSON.parse(raw);
    const validStyle = MAPA_STYLE_PRESETS.some((s) => s.id === parsed?.stylePreset)
      ? (parsed.stylePreset as MapaStylePreset)
      : DEFAULT_MAPA_SETTINGS.stylePreset;
    const layers: MapaLayerVisibility = { ...DEFAULT_MAPA_SETTINGS.layers };
    if (parsed?.layers && typeof parsed.layers === 'object') {
      for (const item of MAPA_LAYER_ITEMS) {
        if (typeof parsed.layers[item.key] === 'boolean') {
          layers[item.key] = parsed.layers[item.key];
        }
      }
    }
    return { stylePreset: validStyle, layers };
  } catch {
    return cloneSettings(DEFAULT_MAPA_SETTINGS);
  }
}

function cloneSettings(s: MapaSettings): MapaSettings {
  return {
    stylePreset: s.stylePreset,
    layers: { ...s.layers },
  };
}

let currentSettings: MapaSettings = loadInitialSettings();
const listeners = new Set<(settings: MapaSettings) => void>();

export function getMapaSettings(): MapaSettings {
  return currentSettings;
}

export function getMapaSettingsSignature(s: MapaSettings = currentSettings): string {
  const l = s.layers;
  return [
    s.stylePreset,
    l.hillshade ? 1 : 0,
    l.hypsometry ? 1 : 0,
    l.forests ? 1 : 0,
    l.contours ? 1 : 0,
    l.hydrology ? 1 : 0,
    l.highways ? 1 : 0,
    l.railways ? 1 : 0,
    l.cities ? 1 : 0,
    l.peaks ? 1 : 0,
    l.borders ? 1 : 0,
    l.districts ? 1 : 0,
    l.graticule ? 1 : 0,
  ].join(':');
}

export function updateMapaSettings(updater: (prev: MapaSettings) => MapaSettings): void {
  const next = cloneSettings(updater(cloneSettings(currentSettings)));
  if (getMapaSettingsSignature(next) === getMapaSettingsSignature(currentSettings)) return;
  currentSettings = next;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    }
  } catch {
    // Ignore private-mode storage errors
  }
  listeners.forEach((fn) => fn(currentSettings));
}

export function setMapaStylePreset(stylePreset: MapaStylePreset): void {
  updateMapaSettings((prev) => ({ ...prev, stylePreset }));
}

export function toggleMapaLayer(key: keyof MapaLayerVisibility): void {
  updateMapaSettings((prev) => ({
    ...prev,
    layers: {
      ...prev.layers,
      [key]: !prev.layers[key],
    },
  }));
}

export function resetMapaSettings(): void {
  updateMapaSettings(() => cloneSettings(DEFAULT_MAPA_SETTINGS));
}

export function subscribeMapaSettings(listener: (settings: MapaSettings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMapaSettings(): MapaSettings {
  const [settings, setSettings] = useState<MapaSettings>(() => getMapaSettings());
  useEffect(() => {
    setSettings(getMapaSettings());
    return subscribeMapaSettings(setSettings);
  }, []);
  return settings;
}
