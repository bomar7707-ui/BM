import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  BedDouble,
  Search,
  MapPin,
  Navigation,
  Phone,
  Globe,
  Mail,
  ExternalLink,
  Calendar,
  Users,
  Dog,
  Moon,
  Mountain,
  RefreshCw,
  Route,
  X,
  CheckCircle2,
  AlertCircle,
  Ban,
  List,
  Map as MapIcon,
  Compass,
  Clock,
  Loader2,
  StopCircle,
} from 'lucide-react';
import { Coordinate, Hike, PlannedRoute } from '../types';
import { ToastType } from './Toast';
import {
  ACCOMMODATION_CATEGORIES,
  AccommodationCategory,
  AccommodationPlace,
  CATEGORY_META_MAP,
  GeocodedLocation,
  buildBookingOneNightDogUrl,
  buildGoogleOneNightDogQueryUrl,
  buildMapyPlaceUrl,
  geocodeLocation,
  getNextDayIso,
  searchAccommodations,
} from '../services/accommodationSearch';

const MAPY_CZ_API_KEY = '3SfstVBaZryBHeEkOsw_DSAc8PwcV140TQvNslWDrQY';

interface AccommodationViewProps {
  hikes: Hike[];
  plannedRoutes: PlannedRoute[];
  onNotify?: (message: string, type?: ToastType) => void;
}

type PetFilterMode = 'no_bans' | 'confirmed_only' | 'all';
type OneNightFilterMode = 'rooms_only' | 'strict_rooms' | 'include_rentals';

const CZECH_REPUBLIC_CENTER = { lat: 49.8175, lon: 15.473 };
const CZECH_REPUBLIC_BOUNDS: L.LatLngBoundsExpression = [
  [48.55, 12.09],
  [51.06, 18.86],
];

function getTomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDateCz(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parseInt(parts[2], 10)}. ${parseInt(parts[1], 10)}. ${parts[0]}`;
}

function extractHikeCoords(hike: Hike): Coordinate[] {
  const list = hike.routes || hike.maps || [];
  const merged: Coordinate[] = [];
  for (const part of list) {
    if (part.coordinates && part.coordinates.length > 0) {
      merged.push(...part.coordinates);
    }
  }
  return merged;
}

function extractPlannedCoords(route: PlannedRoute): Coordinate[] {
  if (route.routes && route.routes.length > 0) {
    const merged: Coordinate[] = [];
    for (const part of route.routes) {
      if (part.coordinates && part.coordinates.length > 0) {
        merged.push(...part.coordinates);
      }
    }
    if (merged.length > 0) return merged;
  }
  return route.coordinates || [];
}

function computeCenterAndBbox(coords: Coordinate[]): {
  centerLat: number;
  centerLon: number;
  bbox: [number, number, number, number];
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const c of coords) {
    if (c[0] < minLat) minLat = c[0];
    if (c[0] > maxLat) maxLat = c[0];
    if (c[1] < minLon) minLon = c[1];
    if (c[1] > maxLon) maxLon = c[1];
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const padLat = Math.max(0.035, (maxLat - minLat) * 0.15);
  const padLon = Math.max(0.055, (maxLon - minLon) * 0.15);

  return {
    centerLat,
    centerLon,
    bbox: [minLat - padLat, minLon - padLon, maxLat + padLat, maxLon + padLon],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const AccommodationView: React.FC<AccommodationViewProps> = ({
  hikes,
  plannedRoutes,
  onNotify,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const routeLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const searchAbortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'user' | 'timeout' | 'superseded' | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userTypingRef = useRef<boolean>(false);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Search & area state
  const [searchInput, setSearchInput] = useState('');
  const [areaLabel, setAreaLabel] = useState('Celá ČR');
  const [searchCenter, setSearchCenter] = useState<{ lat: number; lon: number }>(
    CZECH_REPUBLIC_CENTER
  );
  const [geocodeCandidates, setGeocodeCandidates] = useState<GeocodedLocation[]>([]);
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>('');
  const [activeRouteCoords, setActiveRouteCoords] = useState<Coordinate[] | null>(null);

  // Stay constraints: 1 night + dog + guests
  const [checkinDate, setCheckinDate] = useState<string>(getTomorrowIso);
  const [adults, setAdults] = useState<number>(2);
  const [petFilterMode, setPetFilterMode] = useState<PetFilterMode>('no_bans');
  const [oneNightFilterMode, setOneNightFilterMode] = useState<OneNightFilterMode>('rooms_only');
  const [selectedCategories, setSelectedCategories] = useState<AccommodationCategory[]>([]);
  const [textFilter, setTextFilter] = useState<string>('');

  // Results & UI state
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [places, setPlaces] = useState<AccommodationPlace[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [isDebouncing, setIsDebouncing] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingSeconds, setLoadingSeconds] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cancelledMsg, setCancelledMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [mapMoved, setMapMoved] = useState<boolean>(false);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const checkoutDate = useMemo(() => getNextDayIso(checkinDate), [checkinDate]);

  // Routes that actually have GPS coordinates for "Okolo mé trasy"
  const routesWithCoords = useMemo(() => {
    const items: { key: string; label: string; group: string; coords: Coordinate[] }[] = [];
    for (const r of plannedRoutes) {
      const c = extractPlannedCoords(r);
      if (c.length >= 2) {
        items.push({
          key: `planned:${r.id}`,
          label: `${r.name} (${r.distance} km)`,
          group: 'Plánované trasy',
          coords: c,
        });
      }
    }
    for (const h of hikes) {
      const c = extractHikeCoords(h);
      if (c.length >= 2) {
        items.push({
          key: `hike:${h.id}`,
          label: `${h.name} (${h.distance} km)`,
          group: 'Zapsané výšlapy',
          coords: c,
        });
      }
    }
    return items;
  }, [plannedRoutes, hikes]);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const cancelActiveSearch = useCallback(
    (reason: 'user' | 'timeout' = 'user') => {
      clearTimers();
      setIsDebouncing(false);
      abortReasonRef.current = reason;
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      setIsLoading(false);
      if (reason === 'user') {
        setCancelledMsg('Vyhledávání bylo ručně zastaveno. Můžete upravit oblast nebo hledání spustit znovu.');
      } else {
        setCancelledMsg(null);
        setErrorMsg(
          'Vyhledávání trvalo příliš dlouho a bylo automaticky ukončeno, aby aplikace nezamrzla. Zkuste prosím přiblížit mapu nebo akci zopakovat.'
        );
      }
    },
    [clearTimers]
  );

  const beginAbortableRequest = useCallback((): AbortController => {
    clearTimers();
    setIsDebouncing(false);
    if (searchAbortRef.current) {
      abortReasonRef.current = 'superseded';
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    abortReasonRef.current = null;
    searchAbortRef.current = controller;

    // Watchdog safety guard against hung network requests (14 seconds)
    watchdogTimerRef.current = setTimeout(() => {
      if (searchAbortRef.current === controller) {
        cancelActiveSearch('timeout');
      }
    }, 14000);

    return controller;
  }, [clearTimers, cancelActiveSearch]);

  // Track elapsed loading seconds for user-friendly slow-search feedback
  useEffect(() => {
    if (!isLoading) {
      setLoadingSeconds(0);
      return;
    }
    setLoadingSeconds(0);
    const interval = setInterval(() => {
      setLoadingSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  const executeSearch = useCallback(
    async (
      opts: {
        lat: number;
        lon: number;
        radiusKm?: number;
        bbox?: [number, number, number, number];
        label: string;
        referenceCoords?: Coordinate[];
        fitBounds?: boolean;
      },
      existingController?: AbortController
    ) => {
      const controller = existingController || beginAbortableRequest();

      setHasSearched(true);
      setIsLoading(true);
      setErrorMsg(null);
      setCancelledMsg(null);
      setWarningMsg(null);
      setMapMoved(false);
      setAreaLabel(opts.label);
      setSearchCenter({ lat: opts.lat, lon: opts.lon });

      if (mapInstanceRef.current) {
        if (opts.fitBounds && opts.bbox) {
          mapInstanceRef.current.fitBounds(
            [
              [opts.bbox[0], opts.bbox[1]],
              [opts.bbox[2], opts.bbox[3]],
            ],
            { padding: [24, 24], maxZoom: 13 }
          );
        } else if (opts.fitBounds) {
          mapInstanceRef.current.setView([opts.lat, opts.lon], 12);
        }
      }

      try {
        const { places: results, warning } = await searchAccommodations({
          centerLat: opts.lat,
          centerLon: opts.lon,
          radiusKm: opts.radiusKm ?? 11,
          bbox: opts.bbox,
          referenceCoords: opts.referenceCoords,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (watchdogTimerRef.current) {
          clearTimeout(watchdogTimerRef.current);
          watchdogTimerRef.current = null;
        }
        setPlaces(results);
        setWarningMsg(warning || null);
        setSelectedPlaceId((prev) =>
          prev && results.some((r) => r.id === prev) ? prev : results[0]?.id ?? null
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          if (abortReasonRef.current === 'user') {
            setCancelledMsg(
              'Vyhledávání bylo ručně zastaveno. Můžete upravit oblast nebo hledání spustit znovu.'
            );
          } else if (abortReasonRef.current === 'timeout') {
            setErrorMsg(
              'Vyhledávání trvalo příliš dlouho a bylo automaticky ukončeno, aby aplikace nezamrzla. Zkuste prosím přiblížit mapu nebo akci zopakovat.'
            );
          }
          return;
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Nepodařilo se načíst ubytování. Zkuste to prosím znovu.';
        setPlaces([]);
        setErrorMsg(msg);
      } finally {
        if (watchdogTimerRef.current) {
          clearTimeout(watchdogTimerRef.current);
          watchdogTimerRef.current = null;
        }
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [beginAbortableRequest]
  );

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [CZECH_REPUBLIC_CENTER.lat, CZECH_REPUBLIC_CENTER.lon],
      zoom: 7,
      zoomControl: false,
    });
    map.fitBounds(CZECH_REPUBLIC_BOUNDS, { padding: [16, 16], animate: false });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const mapyOutdoor = L.tileLayer(
      `https://api.mapy.cz/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_CZ_API_KEY}`,
      {
        minZoom: 2,
        maxZoom: 19,
        attribution: '&copy; Seznam.cz a.s., Mapy.cz',
      }
    );

    const mapyAerial = L.tileLayer(
      `https://api.mapy.cz/v1/maptiles/aerial/256/{z}/{x}/{y}?apikey=${MAPY_CZ_API_KEY}`,
      {
        minZoom: 2,
        maxZoom: 19,
        attribution: '&copy; Seznam.cz a.s., Mapy.cz',
      }
    );

    const openTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map data: &copy; OpenStreetMap contributors',
    });

    const osmStandard = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });

    mapyOutdoor.addTo(map);
    L.control
      .layers(
        {
          'Mapy.cz Turistická': mapyOutdoor,
          'Mapy.cz Letecká': mapyAerial,
          OpenTopoMap: openTopo,
          OpenStreetMap: osmStandard,
        },
        undefined,
        { position: 'topleft' }
      )
      .addTo(map);

    routeLayerRef.current.addTo(map);
    markersLayerRef.current.addTo(map);

    map.on('dragend zoomend', () => {
      setMapMoved(true);
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Re-invalidate map size when switching tabs on mobile
  useEffect(() => {
    if (mobileView === 'map' && mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 60);
    }
  }, [mobileView]);

  // Abort active requests cleanly on unmount without running any initial search
  useEffect(() => {
    return () => {
      clearTimers();
      abortReasonRef.current = 'superseded';
      searchAbortRef.current?.abort();
    };
  }, [clearTimers]);

  // Draw active reference hike/route polyline on map
  useEffect(() => {
    routeLayerRef.current.clearLayers();
    if (!activeRouteCoords || activeRouteCoords.length < 2) return;
    const latLngs = activeRouteCoords.map((c) => [c[0], c[1]] as [number, number]);
    const shadow = L.polyline(latLngs, {
      color: '#ffffff',
      weight: 7,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    });
    const line = L.polyline(latLngs, {
      color: '#e11d48',
      weight: 4,
      opacity: 0.95,
      dashArray: '8 6',
      lineCap: 'round',
      lineJoin: 'round',
    });
    routeLayerRef.current.addLayer(shadow);
    routeLayerRef.current.addLayer(line);
  }, [activeRouteCoords]);

  // Apply interactive pet, 1-night, category, and text filters
  const baseEligiblePlaces = useMemo(() => {
    return places.filter((p) => {
      if (petFilterMode === 'confirmed_only' && p.petPolicy !== 'confirmed') return false;
      if (petFilterMode === 'no_bans' && p.petPolicy === 'excluded') return false;

      if (p.oneNightPolicy === 'excluded') return false;
      if (oneNightFilterMode === 'rooms_only' && p.oneNightPolicy === 'rental_unverified') {
        return false;
      }
      if (oneNightFilterMode === 'strict_rooms' && p.oneNightPolicy !== 'ideal') {
        return false;
      }

      if (textFilter.trim()) {
        const q = textFilter.trim().toLowerCase();
        const hay = `${p.name} ${p.city || ''} ${p.address || ''} ${p.categoryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [places, petFilterMode, oneNightFilterMode, textFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<AccommodationCategory, number>> = {};
    for (const p of baseEligiblePlaces) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return counts;
  }, [baseEligiblePlaces]);

  const filteredPlaces = useMemo(() => {
    if (selectedCategories.length === 0) return baseEligiblePlaces;
    const set = new Set(selectedCategories);
    return baseEligiblePlaces.filter((p) => set.has(p.category));
  }, [baseEligiblePlaces, selectedCategories]);

  const confirmedPetCount = useMemo(
    () => filteredPlaces.filter((p) => p.petPolicy === 'confirmed').length,
    [filteredPlaces]
  );

  const selectedPlace = useMemo(
    () => filteredPlaces.find((p) => p.id === selectedPlaceId) || null,
    [filteredPlaces, selectedPlaceId]
  );

  // Render Leaflet markers synced with filteredPlaces & selectedPlaceId
  useEffect(() => {
    const layer = markersLayerRef.current;
    layer.clearLayers();

    filteredPlaces.forEach((place) => {
      const meta = CATEGORY_META_MAP[place.category];
      const isSelected = place.id === selectedPlaceId;
      const isConfirmedPet = place.petPolicy === 'confirmed';

      const size = isSelected ? 34 : 26;
      const borderColor = isSelected ? '#0f172a' : '#ffffff';
      const ringShadow = isSelected
        ? '0 0 0 3px rgba(16, 185, 129, 0.45), 0 4px 12px rgba(15, 23, 42, 0.35)'
        : '0 2px 6px rgba(15, 23, 42, 0.28)';

      const petDotHtml = isConfirmedPet
        ? `<span title="Ubytování se psem potvrzeno" style="position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:9999px;background:#16a34a;border:2px solid #ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></span>`
        : '';

      const iconHtml = `
        <div style="position:relative;width:${size}px;height:${size}px;border-radius:9999px;background:${meta.color};border:2.5px solid ${borderColor};box-shadow:${ringShadow};display:flex;align-items:center;justify-content:center;color:#ffffff;font-family:Inter,sans-serif;font-weight:700;font-size:${isSelected ? 12 : 10}px;cursor:pointer;transition:transform 0.15s ease;">
          ${escapeHtml(meta.shortLabel.slice(0, 1))}
          ${petDotHtml}
        </div>
      `;

      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: '',
          html: iconHtml,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        zIndexOffset: isSelected ? 900 : isConfirmedPet ? 400 : 100,
      });

      marker.bindTooltip(
        `<div style="font-family:Inter,sans-serif;font-size:12px;">
          <strong>${escapeHtml(place.name)}</strong><br/>
          <span style="color:#475569;">${escapeHtml(meta.shortLabel)} · ${place.distanceKm.toFixed(1)} km</span>
        </div>`,
        { direction: 'top', offset: [0, -10] }
      );

      marker.on('click', () => {
        setSelectedPlaceId(place.id);
        const el = itemRefs.current[place.id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      layer.addLayer(marker);
    });
  }, [filteredPlaces, selectedPlaceId]);

  const handleSelectPlace = (place: AccommodationPlace) => {
    setSelectedPlaceId(place.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo([place.lat, place.lon], { animate: true });
    }
  };

  // Unified abortable geocode + accommodation search runner
  const runLocationQuery = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q) return;

      setHasSearched(true);
      setSelectedRouteKey('');
      setActiveRouteCoords(null);
      setGeocodeCandidates([]);
      setCancelledMsg(null);
      setErrorMsg(null);
      setIsLoading(true);

      const controller = beginAbortableRequest();

      try {
        const hits = await geocodeLocation(q, controller.signal);
        if (controller.signal.aborted) return;

        if (hits.length === 0) {
          clearTimers();
          if (searchAbortRef.current === controller) searchAbortRef.current = null;
          setIsLoading(false);
          setErrorMsg(`Místo „${q}“ se nepodařilo najít. Zkuste jiný název pohoří nebo obce.`);
          return;
        }
        setGeocodeCandidates(hits.slice(1, 5));
        const best = hits[0];
        await executeSearch(
          {
            lat: best.lat,
            lon: best.lon,
            radiusKm: 11,
            bbox: best.bbox,
            label: best.name,
            fitBounds: true,
          },
          controller
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          if (abortReasonRef.current === 'user') {
            setCancelledMsg(
              'Vyhledávání bylo ručně zastaveno. Můžete upravit oblast nebo hledání spustit znovu.'
            );
          } else if (abortReasonRef.current === 'timeout') {
            setErrorMsg(
              'Vyhledávání trvalo příliš dlouho a bylo automaticky ukončeno, aby aplikace nezamrzla. Zkuste akci prosím zopakovat.'
            );
          }
          return;
        }
        if (watchdogTimerRef.current) {
          clearTimeout(watchdogTimerRef.current);
          watchdogTimerRef.current = null;
        }
        setIsLoading(false);
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Při hledání lokality došlo k neočekávané chybě. Zkuste to prosím znovu.'
        );
      }
    },
    [beginAbortableRequest, clearTimers, executeSearch]
  );

  // Debounce location search when typing (550 ms) to prevent flooding API on every keystroke
  useEffect(() => {
    if (!userTypingRef.current) return;
    const trimmed = searchInput.trim();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (trimmed.length < 3) {
      setIsDebouncing(false);
      return;
    }

    setIsDebouncing(true);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      userTypingRef.current = false;
      setIsDebouncing(false);
      void runLocationQuery(trimmed);
    }, 550);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [searchInput, runLocationQuery]);

  // Immediate search when submitting the location form
  const handleLocationSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    userTypingRef.current = false;
    setIsDebouncing(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void runLocationQuery(searchInput);
  };

  const handleSearchCurrentMapBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const b = map.getBounds();
    const center = b.getCenter();
    executeSearch({
      lat: center.lat,
      lon: center.lng,
      bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()],
      label: 'Aktuální výřez mapy',
      referenceCoords: activeRouteCoords || undefined,
      fitBounds: false,
    });
  };

  const handleSelectRouteOrigin = (key: string) => {
    userTypingRef.current = false;
    setSelectedRouteKey(key);
    setGeocodeCandidates([]);
    if (!key) {
      setActiveRouteCoords(null);
      return;
    }
    const found = routesWithCoords.find((r) => r.key === key);
    if (!found) return;
    setActiveRouteCoords(found.coords);
    const { centerLat, centerLon, bbox } = computeCenterAndBbox(found.coords);
    setSearchInput(found.label);
    executeSearch({
      lat: centerLat,
      lon: centerLon,
      bbox,
      label: `Okolí trasy: ${found.label.split(' (')[0]}`,
      referenceCoords: found.coords,
      fitBounds: true,
    });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      onNotify?.('Prohlížeč nepodporuje zjištění polohy.', 'warning');
      return;
    }
    userTypingRef.current = false;
    setIsLoading(true);
    setErrorMsg(null);
    setCancelledMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSelectedRouteKey('');
        setActiveRouteCoords(null);
        setGeocodeCandidates([]);
        setSearchInput('Moje aktuální poloha');
        executeSearch({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          radiusKm: 10,
          label: 'Moje poloha',
          fitBounds: true,
        });
      },
      () => {
        setIsLoading(false);
        onNotify?.('Nepodařilo se získat aktuální polohu GPS.', 'warning');
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const toggleCategory = (cat: AccommodationCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const areaBookingUrl = useMemo(
    () =>
      buildBookingOneNightDogUrl({
        cityOrArea: areaLabel.startsWith('Okolí trasy:')
          ? areaLabel.replace('Okolí trasy:', '').trim()
          : areaLabel === 'Aktuální výřez mapy' ||
              areaLabel === 'Moje poloha' ||
              areaLabel === 'Celá ČR'
            ? undefined
            : areaLabel,
        lat: searchCenter.lat,
        lon: searchCenter.lon,
        checkinIso: checkinDate,
        adults,
      }),
    [areaLabel, searchCenter, checkinDate, adults]
  );

  return (
    <div className="flex flex-col md:flex-row w-full h-[calc(100vh-64px)] bg-stone-50 overflow-hidden">
      {/* Mobile List / Map Switcher */}
      <div className="md:hidden flex items-center justify-between px-3 py-2 bg-white border-b border-stone-200 shrink-0">
        <div className="text-xs font-semibold text-stone-700 truncate pr-2">
          {hasSearched ? (
            <>
              {areaLabel} · <span className="tabular-nums">{filteredPlaces.length}</span> míst
            </>
          ) : (
            areaLabel
          )}
        </div>
        <div className="inline-flex bg-stone-100 p-0.5 rounded-lg border border-stone-200 shrink-0">
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              mobileView === 'list' ? 'bg-white text-emerald-700 shadow-xs' : 'text-stone-600'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>Seznam</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              mobileView === 'map' ? 'bg-white text-emerald-700 shadow-xs' : 'text-stone-600'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Mapa</span>
          </button>
        </div>
      </div>

      {/* LEFT SIDEBAR: Search, 1-Night & Dog Constraints, Category Filters & Results */}
      <aside
        className={`${
          mobileView === 'list' ? 'flex' : 'hidden md:flex'
        } flex-col w-full md:w-[410px] lg:w-[440px] h-full bg-white border-r border-stone-200 shrink-0 overflow-hidden`}
      >
        {/* Top Search & Stay Parameters */}
        <div className="p-3.5 border-b border-stone-200 space-y-3 shrink-0 bg-white">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                <BedDouble className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-stone-900 leading-tight">
                  Turistické ubytování se psem
                </h1>
                <p className="text-[11px] text-stone-500">
                  Na 1 noc · chaty, penziony, ubytovny i kempy s chatkami
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUseMyLocation}
              title="Najít v mém okolí"
              className="p-2 rounded-lg border border-stone-200 text-stone-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer shrink-0"
            >
              <Navigation className="w-4 h-4" />
            </button>
          </div>

          {/* Search Location Form with Debounce & Abort Controls */}
          <form onSubmit={handleLocationSearchSubmit} className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  userTypingRef.current = true;
                  setSearchInput(e.target.value);
                }}
                placeholder="Pohoří, vrchol nebo obec (např. Krkonoše)..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-stone-900"
              />
              {isDebouncing && !isLoading && (
                <span
                  title="Automatické vyhledání za okamžik…"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex"
                >
                  <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                </span>
              )}
            </div>
            {isLoading ? (
              <button
                type="button"
                onClick={() => cancelActiveSearch('user')}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
                title="Zastavit probíhající vyhledávání"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                <span>Zastavit</span>
              </button>
            ) : (
              <button
                type="submit"
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Hledat
              </button>
            )}
          </form>

          {/* Alternative geocode suggestions if multiple matches */}
          {geocodeCandidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
              <span>Jiné shody:</span>
              {geocodeCandidates.map((cand, idx) => (
                <button
                  key={`${cand.name}-${idx}`}
                  type="button"
                  onClick={() => {
                    userTypingRef.current = false;
                    setGeocodeCandidates([]);
                    setSearchInput(cand.name);
                    executeSearch({
                      lat: cand.lat,
                      lon: cand.lon,
                      radiusKm: 11,
                      bbox: cand.bbox,
                      label: cand.name,
                      fitBounds: true,
                    });
                  }}
                  className="text-emerald-700 hover:underline cursor-pointer"
                >
                  {cand.name}
                  {cand.label ? ` (${cand.label.split('·')[0].trim()})` : ''}
                </button>
              ))}
            </div>
          )}

          {/* Search Around Saved Hike or Planned Route */}
          {routesWithCoords.length > 0 && (
            <div className="flex items-center gap-2">
              <Route className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <select
                value={selectedRouteKey}
                onChange={(e) => handleSelectRouteOrigin(e.target.value)}
                className="flex-1 text-xs bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-stone-700 focus:outline-none focus:border-emerald-500"
              >
                <option value="">Hledat okolo uložené trasy ze Zápisníku…</option>
                {routesWithCoords.map((item) => (
                  <option key={item.key} value={item.key}>
                    [{item.group}] {item.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Stay Parameters: 1 Night + Adults + Dog */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 flex items-center gap-1 mb-1">
                  <Calendar className="w-3 h-3 text-emerald-600" />
                  <span>Příjezd (1 noc)</span>
                </label>
                <input
                  type="date"
                  value={checkinDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setCheckinDate(e.target.value || getTomorrowIso())}
                  className="w-full text-xs bg-white border border-stone-200 rounded-lg px-2 py-1 text-stone-800 tabular-nums"
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 flex items-center gap-1 mb-1">
                  <Users className="w-3 h-3 text-emerald-600" />
                  <span>Hosté · pes</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={adults}
                    onChange={(e) => setAdults(Number(e.target.value))}
                    className="flex-1 text-xs bg-white border border-stone-200 rounded-lg px-2 py-1 text-stone-800 tabular-nums"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'osoba' : n < 5 ? 'osoby' : 'osob'}
                      </option>
                    ))}
                  </select>
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 px-1.5 py-1 bg-emerald-50 border border-emerald-200 rounded-lg shrink-0"
                    title="Ubytování se psem"
                  >
                    <Dog className="w-3.5 h-3.5" />
                    <span>+1</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-stone-600 pt-0.5 tabular-nums">
              <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                <Moon className="w-3 h-3 text-emerald-600" />
                {formatDateCz(checkinDate)} → {formatDateCz(checkoutDate)} (1 noc)
              </span>
              <a
                href={areaBookingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1 hover:underline"
              >
                <span>Volné na Booking</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Pet & 1-Night Filtering Controls */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1 bg-stone-100 p-0.5 rounded-lg border border-stone-200">
              <button
                type="button"
                onClick={() => setPetFilterMode('no_bans')}
                className={`py-1 px-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                  petFilterMode === 'no_bans'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                title="Zobrazí ubytování s potvrzeným psem i zařízení bez zákazu psů v OSM"
              >
                Bez zákazu psů
              </button>
              <button
                type="button"
                onClick={() => setPetFilterMode('confirmed_only')}
                className={`py-1 px-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                  petFilterMode === 'confirmed_only'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                title="Pouze místa s výslovným potvrzením psa v datech OpenStreetMap"
              >
                Jen potvrzené OSM
              </button>
              <button
                type="button"
                onClick={() => setPetFilterMode('all')}
                className={`py-1 px-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer truncate ${
                  petFilterMode === 'all'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Vše v oblasti
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <select
                value={oneNightFilterMode}
                onChange={(e) => setOneNightFilterMode(e.target.value as OneNightFilterMode)}
                className="flex-1 text-[11px] px-2 py-1 bg-stone-50 border border-stone-200 rounded-md text-stone-700 font-medium focus:outline-none focus:border-emerald-500"
                title="Filtr podle pravděpodobnosti pobytu na 1 noc"
              >
                <option value="rooms_only">1 noc: jen pokoje, boudy a chatky</option>
                <option value="strict_rooms">1 noc: jen hotely, ubytovny a boudy</option>
                <option value="include_rentals">Vše vč. chalup a apartmánů (často víkendy/týdny)</option>
              </select>
              <input
                type="text"
                value={textFilter}
                onChange={(e) => setTextFilter(e.target.value)}
                placeholder="Filtr názvu…"
                className="w-24 text-[11px] px-2 py-1 bg-stone-50 border border-stone-200 rounded-md focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Interactive Facility Category Filters */}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setSelectedCategories([])}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer tabular-nums ${
                selectedCategories.length === 0
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
              }`}
            >
              Vše ({baseEligiblePlaces.length})
            </button>
            {ACCOMMODATION_CATEGORIES.map((cat) => {
              const count = categoryCounts[cat.id] || 0;
              if (count === 0 && !selectedCategories.includes(cat.id)) return null;
              const isSelected = selectedCategories.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors inline-flex items-center gap-1.5 cursor-pointer tabular-nums ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: isSelected ? '#ffffff' : cat.color }}
                  />
                  <span>{cat.shortLabel}</span>
                  <span className={isSelected ? 'text-emerald-100' : 'text-stone-400'}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary Strip */}
        <div className="px-3.5 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between text-[11px] text-stone-600 shrink-0 tabular-nums">
          {hasSearched ? (
            <>
              <span>
                Nalezeno <strong className="text-stone-900">{filteredPlaces.length}</strong> zařízení
              </span>
              <span className="text-emerald-700 font-medium">
                {confirmedPetCount} potvrzeno se psem v OSM
              </span>
            </>
          ) : (
            <span>Zadejte lokalitu, trasu nebo vyhledejte výřez mapy</span>
          )}
        </div>

        {/* Scrollable Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && (
            <div className="space-y-2.5">
              {/* Active Loading Spinner & Slow-Search Manual Abort Bar */}
              <div
                className={`p-3 rounded-xl border text-xs space-y-2 ${
                  loadingSeconds >= 3
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <Loader2
                      className={`w-4 h-4 animate-spin shrink-0 ${
                        loadingSeconds >= 3 ? 'text-amber-600' : 'text-emerald-600'
                      }`}
                    />
                    <span className="tabular-nums">
                      Vyhledávám ubytování ({loadingSeconds} s)…
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancelActiveSearch('user')}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    <span>Zastavit</span>
                  </button>
                </div>
                {loadingSeconds >= 3 && (
                  <p className="text-[11px] text-amber-800 leading-snug">
                    Dotaz do mapových serverů trvá déle než obvykle. Můžete vyhledávání ručně zastavit a zkusit menší oblast.
                  </p>
                )}
              </div>

              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-stone-200 bg-white animate-pulse space-y-2"
                >
                  <div className="h-3.5 bg-stone-200 rounded w-2/3" />
                  <div className="h-2.5 bg-stone-100 rounded w-1/2" />
                  <div className="h-2.5 bg-stone-100 rounded w-5/6" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && cancelledMsg && (
            <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2">
                <StopCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{cancelledMsg}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  executeSearch({
                    lat: searchCenter.lat,
                    lon: searchCenter.lon,
                    radiusKm: 11,
                    label: areaLabel,
                    referenceCoords: activeRouteCoords || undefined,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 font-semibold hover:bg-amber-100 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Spustit hledání znovu</span>
              </button>
            </div>
          )}

          {!isLoading && warningMsg && !errorMsg && (
            <div className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>{warningMsg}</span>
            </div>
          )}

          {!isLoading && errorMsg && (
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  executeSearch({
                    lat: searchCenter.lat,
                    lon: searchCenter.lon,
                    radiusKm: 11,
                    label: areaLabel,
                    referenceCoords: activeRouteCoords || undefined,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 font-semibold hover:bg-rose-100 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Zkusit znovu</span>
              </button>
            </div>
          )}

          {!isLoading && !errorMsg && !cancelledMsg && !hasSearched && (
            <div className="p-5 rounded-xl border border-stone-200 bg-stone-50 text-center space-y-2.5">
              <BedDouble className="w-7 h-7 text-emerald-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-800">
                  Vyhledejte ubytování se psem na 1 noc
                </p>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Napište název pohoří, vrcholu nebo obce výše, vyberte uloženou trasu ze Zápisníku nebo přibližte mapu ČR a klikněte na „Hledat v zobrazené oblasti“.
                </p>
              </div>
            </div>
          )}

          {!isLoading && !errorMsg && !cancelledMsg && hasSearched && filteredPlaces.length === 0 && (
            <div className="p-5 rounded-xl border border-stone-200 bg-stone-50 text-center space-y-3">
              <Mountain className="w-7 h-7 text-stone-400 mx-auto" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-800">
                  V tomto výběru nebyla nalezena žádná zařízení
                </p>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  {petFilterMode === 'confirmed_only'
                    ? 'V OpenStreetMap má mnoho horských chat a penzionů štítek pro psy nevyplněný. Přepněte na „Bez zákazu psů“ nebo ověřte volnou kapacitu na 1 noc s filtrem pro psy přímo na Booking.com.'
                    : 'Zkuste oddálit mapu, vybrat jiný region nebo zrušit filtr kategorií.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {petFilterMode === 'confirmed_only' && (
                  <button
                    type="button"
                    onClick={() => setPetFilterMode('no_bans')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
                  >
                    Zobrazit bez zákazu psů
                  </button>
                )}
                <a
                  href={areaBookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-stone-700 text-xs font-semibold hover:bg-stone-100 inline-flex items-center gap-1"
                >
                  <span>Booking.com (1 noc + pes)</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {!isLoading &&
            !errorMsg &&
            filteredPlaces.map((place) => {
              const meta = CATEGORY_META_MAP[place.category];
              const isSelected = place.id === selectedPlaceId;
              const bookingUrl = buildBookingOneNightDogUrl({
                placeName: place.name,
                cityOrArea: place.city,
                lat: place.lat,
                lon: place.lon,
                checkinIso: checkinDate,
                adults,
              });

              return (
                <div
                  key={place.id}
                  ref={(el) => {
                    itemRefs.current[place.id] = el;
                  }}
                  onClick={() => handleSelectPlace(place)}
                  className={`p-3 rounded-xl border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50/50 border-emerald-500'
                      : 'bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <h3 className="text-xs font-bold text-stone-900 truncate">
                          {place.name}
                        </h3>
                      </div>

                      {/* Unboxed clean inline metadata separated by · */}
                      <p className="text-[11px] text-stone-500 mt-0.5 tabular-nums truncate">
                        {meta.shortLabel}
                        {' · '}
                        {place.distanceKm.toFixed(1)} km
                        {place.city ? ` · ${place.city}` : ''}
                        {place.elevationM ? ` · ${place.elevationM} m n.m.` : ''}
                        {place.capacity ? ` · ${place.capacity}` : ''}
                      </p>
                    </div>

                    {place.phone && (
                      <a
                        href={`tel:${place.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        title={`Zavolat ${place.phone}`}
                        className="p-1.5 rounded-lg border border-stone-200 text-stone-600 hover:text-emerald-700 hover:border-emerald-300 bg-white shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>

                  {/* Semantic Pet + 1-Night Status Line */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        place.petPolicy === 'confirmed'
                          ? 'text-emerald-700'
                          : place.petPolicy === 'excluded'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {place.petPolicy === 'confirmed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : place.petPolicy === 'excluded' ? (
                        <Ban className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Dog className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>
                        {place.petPolicy === 'confirmed'
                          ? 'Se psem potvrzeno'
                          : place.petPolicy === 'excluded'
                            ? 'Bez psů (OSM)'
                            : 'Pes: ověřit'}
                      </span>
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 ${
                        place.oneNightPolicy === 'ideal'
                          ? 'text-stone-700'
                          : place.oneNightPolicy === 'rental_unverified'
                            ? 'text-amber-700 font-medium'
                            : place.oneNightPolicy === 'excluded'
                              ? 'text-rose-700'
                              : 'text-stone-600'
                      }`}
                    >
                      <Moon
                        className={`w-3 h-3 shrink-0 ${
                          place.oneNightPolicy === 'rental_unverified'
                            ? 'text-amber-500'
                            : 'text-stone-400'
                        }`}
                      />
                      <span>
                        {place.oneNightPolicy === 'ideal'
                          ? 'Pokoje běžně na 1 noc'
                          : place.oneNightPolicy === 'rental_unverified'
                            ? 'Pronájem objektu (často víkend/týden)'
                            : place.oneNightPolicy === 'excluded'
                              ? 'Vícedenní minimum'
                              : '1 noc ověřit dle termínu'}
                      </span>
                    </span>
                  </div>

                  {/* Quick Actions Row for Selected Card */}
                  {isSelected && (
                    <div
                      className="mt-2.5 pt-2 border-t border-emerald-200/70 flex flex-wrap items-center gap-2 text-[11px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={bookingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1"
                      >
                        <span>Ověřit 1 noc + pes</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={buildMapyPlaceUrl(place)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 rounded-md bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 font-medium inline-flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3 text-emerald-600" />
                        <span>Mapy.com</span>
                      </a>
                      {place.website && (
                        <a
                          href={place.website}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded-md bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 font-medium inline-flex items-center gap-1"
                        >
                          <Globe className="w-3 h-3" />
                          <span>Web</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMobileView('map');
                          setTimeout(() => {
                            mapInstanceRef.current?.setView([place.lat, place.lon], 14);
                          }, 80);
                        }}
                        className="md:hidden px-2 py-1 rounded-md bg-white border border-stone-200 text-stone-700 font-medium inline-flex items-center gap-1"
                      >
                        <MapIcon className="w-3 h-3" />
                        <span>Na mapě</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </aside>

      {/* RIGHT MAP WORKSPACE */}
      <main
        className={`${
          mobileView === 'map' ? 'block' : 'hidden md:block'
        } flex-1 relative h-full w-full`}
      >
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Map Top Center Floating Loading + Abort Bar or "Search This Area" Button */}
        {isLoading ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[550] bg-white/95 backdrop-blur-xs border border-stone-200 rounded-full shadow-lg pl-3.5 pr-1.5 py-1.5 flex items-center gap-2.5 text-xs">
            <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
            <span className="font-semibold text-stone-800 tabular-nums whitespace-nowrap">
              Hledám ubytování ({loadingSeconds} s)…
            </span>
            <button
              type="button"
              onClick={() => cancelActiveSearch('user')}
              className="px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>Zastavit</span>
            </button>
          </div>
        ) : (
          mapMoved && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500]">
              <button
                type="button"
                onClick={handleSearchCurrentMapBounds}
                className="px-3.5 py-2 rounded-full bg-white hover:bg-stone-50 text-stone-900 border border-stone-300 shadow-lg text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                <span>Hledat v zobrazené oblasti</span>
              </button>
            </div>
          )
        )}

        {/* Compact Category Legend Top Right */}
        <div className="hidden lg:block absolute top-3 right-3 z-[450] bg-white/95 backdrop-blur-xs border border-stone-200 rounded-xl p-2.5 shadow-md text-[11px] space-y-1">
          <div className="font-semibold text-stone-700 pb-0.5 border-b border-stone-100">
            Typy ubytování
          </div>
          {ACCOMMODATION_CATEGORIES.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-stone-600">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <span>{c.shortLabel}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-stone-100 flex items-center gap-1.5 text-emerald-700 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 border border-white shrink-0" />
            <span>Zelená tečka = pes potvrzen</span>
          </div>
        </div>

        {/* Selected Place Detail Drawer */}
        {selectedPlace && (
          <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:w-[400px] z-[550] bg-white border border-stone-200 rounded-2xl shadow-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                  {selectedPlace.categoryLabel}
                </div>
                <h2 className="text-sm font-bold text-stone-900 leading-snug">
                  {selectedPlace.name}
                </h2>
                <p className="text-xs text-stone-500 mt-0.5 tabular-nums">
                  {[
                    selectedPlace.address || selectedPlace.city,
                    `${selectedPlace.distanceKm.toFixed(1)} km`,
                    selectedPlace.elevationM ? `${selectedPlace.elevationM} m n.m.` : null,
                    selectedPlace.capacity,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlaceId(null)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 cursor-pointer shrink-0"
                title="Zavřít detail"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pet & 1-Night Detailed Assessment */}
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5 space-y-1.5 text-xs">
              <div className="flex items-start gap-2">
                <Dog
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    selectedPlace.petPolicy === 'confirmed'
                      ? 'text-emerald-600'
                      : selectedPlace.petPolicy === 'excluded'
                        ? 'text-rose-600'
                        : 'text-amber-600'
                  }`}
                />
                <div className="text-stone-700">
                  <span className="font-semibold">Ubytování se psem: </span>
                  <span>{selectedPlace.petNote}</span>
                  {selectedPlace.petFee && (
                    <span className="text-stone-500"> (poplatek: {selectedPlace.petFee})</span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Moon
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    selectedPlace.oneNightPolicy === 'ideal'
                      ? 'text-emerald-600'
                      : selectedPlace.oneNightPolicy === 'excluded'
                        ? 'text-rose-600'
                        : 'text-amber-600'
                  }`}
                />
                <div className="text-stone-700">
                  <span className="font-semibold">Pobyt na 1 noc: </span>
                  <span>{selectedPlace.oneNightNote}</span>
                </div>
              </div>

              {selectedPlace.openingHours && (
                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
                  <div className="text-stone-600 tabular-nums">{selectedPlace.openingHours}</div>
                </div>
              )}
            </div>

            {/* Direct Contact Info if Present */}
            {(selectedPlace.phone || selectedPlace.email || selectedPlace.website) && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-700">
                {selectedPlace.phone && (
                  <a
                    href={`tel:${selectedPlace.phone}`}
                    className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline font-medium tabular-nums"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{selectedPlace.phone}</span>
                  </a>
                )}
                {selectedPlace.email && (
                  <a
                    href={`mailto:${selectedPlace.email}`}
                    className="inline-flex items-center gap-1.5 text-stone-700 hover:underline"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>{selectedPlace.email}</span>
                  </a>
                )}
                {selectedPlace.website && (
                  <a
                    href={selectedPlace.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-stone-700 hover:underline"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Oficiální web</span>
                  </a>
                )}
              </div>
            )}

            {/* Booking & Map Verification Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={buildBookingOneNightDogUrl({
                  placeName: selectedPlace.name,
                  cityOrArea: selectedPlace.city,
                  lat: selectedPlace.lat,
                  lon: selectedPlace.lon,
                  checkinIso: checkinDate,
                  adults,
                })}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-[160px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <span>Booking (1 noc + pes)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <a
                href={buildMapyPlaceUrl(selectedPlace)}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5 text-emerald-600" />
                <span>Mapy.com</span>
              </a>

              <a
                href={buildGoogleOneNightDogQueryUrl(selectedPlace)}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold inline-flex items-center gap-1.5"
                title="Vyhledat přímý kontakt a pravidla pro psa"
              >
                <Search className="w-3.5 h-3.5 text-stone-600" />
                <span>Kontakt</span>
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
