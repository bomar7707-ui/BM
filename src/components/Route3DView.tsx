import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Eye,
  EyeOff,
  Minus,
  BarChart2,
  Mountain,
  X,
  ExternalLink,
  MapPin,
  Camera,
  Youtube,
  Calendar,
  Route,
  Users,
  ArrowLeft,
  Layers,
  Play,
  Pause,
  RotateCw,
  Maximize2,
  ChevronUp,
  ChevronDown,
  TrendingUp,
  Compass,
} from 'lucide-react';
import { Hike, Coordinate, PlannedRoute, RoutePart } from '../types';
import {
  calculateDistanceKm,
  getSegmentDistanceKm,
  splitIntoContiguousSegments,
  computeRouteElevationStats,
  computeElevationProfileData,
  ElevationProfileData,
  SlopeCategory,
} from '../utils/gpxParser';
import { getDisplayDateRange } from '../utils/dateUtils';
import {
  Terrain3DMap,
  Route3DItem,
  Terrain3DMapHandle,
  FlightTelemetryState,
  DioramaPOI,
  DioramaPOICategory,
} from './Terrain3DMap';
import { MapSettingsControl } from './MapSettingsControl';

const QLEVER_OSM_ENDPOINT = 'https://qlever.dev/api/osm-planet';

// Automatically discover significant peaks & points of interest along a route via OpenStreetMap (QLever)
async function fetchRoutePeaksAndPOIs(
  coords: Coordinate[],
  routeName: string,
  signal: AbortSignal
): Promise<DioramaPOI[]> {
  if (coords.length < 2) return [];

  // 1. Subsample route coordinates and compute cumulative distance + bounding box
  const step = Math.max(1, Math.floor(coords.length / 350));
  const sampleCoords: { lat: number; lon: number; ele: number | null; distKm: number }[] = [];
  let totalDistKm = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (let i = 0; i < coords.length; i += step) {
    const c = coords[i];
    if (c[0] < minLat) minLat = c[0];
    if (c[0] > maxLat) maxLat = c[0];
    if (c[1] < minLon) minLon = c[1];
    if (c[1] > maxLon) maxLon = c[1];
    if (sampleCoords.length > 0) {
      const prev = sampleCoords[sampleCoords.length - 1];
      totalDistKm += calculateDistanceKm(prev.lat, prev.lon, c[0], c[1]);
    }
    sampleCoords.push({
      lat: c[0],
      lon: c[1],
      ele: typeof c[2] === 'number' && !isNaN(c[2]) ? Math.round(c[2]) : null,
      distKm: totalDistKm,
    });
  }

  const padLat = 0.025;
  const padLon = 0.038;
  const s = (minLat - padLat).toFixed(4);
  const n = (maxLat + padLat).toFixed(4);
  const w = (minLon - padLon).toFixed(4);
  const e = (maxLon + padLon).toFixed(4);
  const poly = `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;

  const sparql = `
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm ?name ?name_cs ?natural ?tourism ?historic ?man_made ?ele (geof:centroid(?geom) AS ?centroid) WHERE {
  ?osm geo:hasGeometry/geo:asWKT ?geom .
  FILTER (geof:sfIntersects(?geom, "${poly}"^^geo:wktLiteral))
  {
    ?osm osmkey:natural ?natural .
    VALUES ?natural { "peak" "saddle" "spring" }
  } UNION {
    ?osm osmkey:tourism ?tourism .
    VALUES ?tourism { "viewpoint" "alpine_hut" }
  } UNION {
    ?osm osmkey:historic ?historic .
    VALUES ?historic { "castle" "ruins" }
  } UNION {
    ?osm osmkey:man_made ?man_made .
    VALUES ?man_made { "tower" }
  }
  ?osm osmkey:name ?name .
  OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:cs> ?name_cs }
  OPTIONAL { ?osm osmkey:ele ?ele }
} LIMIT 250`;

  let bindings: Record<string, { value?: string } | undefined>[] = [];
  try {
    const res = await fetch(QLEVER_OSM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
      },
      body: `query=${encodeURIComponent(sparql)}`,
      signal,
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.results?.bindings)) {
        bindings = json.results.bindings;
      }
    }
  } catch {
    bindings = [];
  }

  if (signal.aborted) return [];

  const maxCorridorKm = totalDistKm > 35 ? 2.4 : 1.75;

  const getRouteProximity = (lat: number, lon: number) => {
    let minD = Infinity;
    let nearestEle: number | null = null;
    let routeKmAtNearest = 0;
    for (const pt of sampleCoords) {
      const d = calculateDistanceKm(lat, lon, pt.lat, pt.lon);
      if (d < minD) {
        minD = d;
        nearestEle = pt.ele;
        routeKmAtNearest = pt.distKm;
      }
    }
    return { minD, nearestEle, routeKmAtNearest };
  };

  const candidates: (DioramaPOI & { priority: number; routeKm: number })[] = [];

  for (const row of bindings) {
    const wkt = row.centroid?.value || '';
    const m = wkt.match(/POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (!m) continue;
    const lon = parseFloat(m[1]);
    const lat = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const cleanName = (row.name_cs?.value || row.name?.value || '').trim();
    if (!cleanName) continue;

    const { minD, nearestEle, routeKmAtNearest } = getRouteProximity(lat, lon);
    if (minD > maxCorridorKm) continue;

    let parsedEle: number | null = null;
    if (row.ele?.value) {
      const num = parseFloat(row.ele.value.replace(',', '.'));
      if (!isNaN(num) && num > 100 && num < 9000) parsedEle = Math.round(num);
    }
    if (parsedEle === null && minD < 0.25 && nearestEle !== null) {
      parsedEle = nearestEle;
    }

    const nat = (row.natural?.value || '').toLowerCase();
    const tour = (row.tourism?.value || '').toLowerCase();
    const hist = (row.historic?.value || '').toLowerCase();
    const man = (row.man_made?.value || '').toLowerCase();

    let category: DioramaPOICategory = 'peak';
    let priority = 70;

    if (nat === 'peak') {
      category = 'peak';
      priority = 105;
    } else if (tour === 'viewpoint' || man === 'tower') {
      category = 'viewpoint';
      priority = 96;
    } else if (tour === 'alpine_hut') {
      category = 'hut';
      priority = 88;
    } else if (hist === 'castle' || hist === 'ruins') {
      category = 'historic';
      priority = 84;
    } else if (nat === 'saddle') {
      category = 'saddle';
      priority = 78;
    } else if (nat === 'spring') {
      category = 'spring';
      priority = 72;
    }

    const proximityBonus = Math.max(0, (maxCorridorKm - minD) * 26);
    const eleBonus = parsedEle ? parsedEle / 100 : 0;

    candidates.push({
      id: `osm_${category}_${lat.toFixed(4)}_${lon.toFixed(4)}`,
      name: cleanName,
      lat,
      lon,
      ele: parsedEle,
      category,
      distanceFromRouteKm: minD,
      priority: priority + proximityBonus + eleBonus,
      routeKm: routeKmAtNearest,
    });
  }

  // Sort by priority to pick the best non-overlapping peaks & POIs along the route
  candidates.sort((a, b) => b.priority - a.priority);

  const maxPois = totalDistKm > 40 ? 15 : 10;
  const minPoiSpacingKm = Math.max(0.45, totalDistKm / 45);
  const selected: (DioramaPOI & { routeKm: number })[] = [];
  const seenNames = new Set<string>();

  for (const cand of candidates) {
    const normName = cand.name.toLowerCase();
    if (seenNames.has(normName)) continue;

    const tooClose = selected.some(
      (s) => calculateDistanceKm(s.lat, s.lon, cand.lat, cand.lon) < minPoiSpacingKm
    );
    if (tooClose) continue;

    seenNames.add(normName);
    selected.push(cand);
    if (selected.length >= maxPois) break;
  }

  // Order selected POIs along the route progression from START to CÍL
  selected.sort((a, b) => a.routeKm - b.routeKm);

  // Fallback if offline
  if (selected.length === 0) {
    let maxEle = -Infinity;
    let bestPt: Coordinate | null = null;
    for (const c of coords) {
      if (typeof c[2] === 'number' && !isNaN(c[2]) && c[2] > maxEle) {
        maxEle = c[2];
        bestPt = c;
      }
    }
    if (bestPt && isFinite(maxEle)) {
      return [
        {
          id: 'local_peak_main',
          name: `Nejvyšší bod (${routeName})`,
          lat: bestPt[0],
          lon: bestPt[1],
          ele: Math.round(maxEle),
          category: 'peak',
          distanceFromRouteKm: 0,
        },
      ];
    }
  }

  return selected.map(({ routeKm: _rk, ...poi }) => poi);
}

interface Route3DViewProps {
  trip?: Hike | null;
  plannedRoute?: PlannedRoute | null;
  plannedColor?: string;
  selectedMapIndex?: number | null;
  onSelectSegment?: (mapIndex: number | null) => void;
  onBackTo2D: () => void;
  onOpenAnalytics?: (tripId?: string) => void;
}

export const Route3DView: React.FC<Route3DViewProps> = ({
  trip = null,
  plannedRoute = null,
  plannedColor = '#2563eb',
  selectedMapIndex = null,
  onSelectSegment,
  onBackTo2D,
  onOpenAnalytics,
}) => {
  const terrainMapRef = useRef<Terrain3DMapHandle | null>(null);

  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [hiddenSegments, setHiddenSegments] = useState<Record<number, boolean>>({});
  const [hoveredCoord, setHoveredCoord] = useState<[number, number] | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    dist: number;
    ele: number;
    gradePct: number;
    slopeCat: SlopeCategory;
    isTransfer: boolean;
    xPct: number;
    yPct: number;
  } | null>(null);

  // 3D Map Controls State (located in the right sidebar)
  const [exaggeration, setExaggeration] = useState<number>(2.0);
  const [flightState, setFlightState] = useState<FlightTelemetryState>({
    isFlying: false,
    isOrbiting: false,
    flyProgress: null,
  });

  // Automatically discovered Peaks & POIs along the route in the 3D diorama
  const [routePois, setRoutePois] = useState<DioramaPOI[]>([]);
  const [isLoadingPois, setIsLoadingPois] = useState<boolean>(false);
  const [showPois, setShowPois] = useState<boolean>(true);
  const [hiddenPois, setHiddenPois] = useState<Record<string, boolean>>({});
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null);

  const [elevationData, setElevationData] = useState<ElevationProfileData | null>(null);

  const toggleSegmentVisibility = (mapIndex: number) => {
    setHiddenSegments((prev) => ({
      ...prev,
      [mapIndex]: !prev[mapIndex],
    }));
  };

  const togglePoiVisibility = (poiId: string) => {
    setHiddenPois((prev) => {
      const nextHidden = !prev[poiId];
      if (nextHidden && highlightedPoiId === poiId) {
        setHighlightedPoiId(null);
      }
      return {
        ...prev,
        [poiId]: nextHidden,
      };
    });
  };

  const visibleRoutePois = useMemo(
    () => routePois.filter((poi) => !hiddenPois[poi.id]),
    [routePois, hiddenPois]
  );

  // Normalize either Hike or PlannedRoute into a common structure for 3D rendering
  const activeRouteInfo = useMemo(() => {
    if (trip) {
      const routes: RoutePart[] = trip.routes || trip.maps || [];
      return {
        isPlanned: false,
        id: trip.id,
        name: trip.name,
        distance: trip.distance,
        dateLabel: getDisplayDateRange(trip),
        participants: trip.participants || '',
        note: trip.note || '',
        color: '#00b4d8',
        routes,
      };
    }

    if (plannedRoute) {
      let routes: RoutePart[] = [];
      if (plannedRoute.routes && plannedRoute.routes.length > 0) {
        routes = plannedRoute.routes;
      } else if (plannedRoute.coordinates && plannedRoute.coordinates.length > 0) {
        routes = [
          {
            distance: plannedRoute.distance,
            link: plannedRoute.link,
            url: plannedRoute.link,
            coordinates: plannedRoute.coordinates,
            visible: true,
          },
        ];
      } else if (plannedRoute.link) {
        routes = [
          {
            distance: plannedRoute.distance,
            link: plannedRoute.link,
            url: plannedRoute.link,
            coordinates: [],
            visible: true,
          },
        ];
      }

      return {
        isPlanned: true,
        id: plannedRoute.id,
        name: plannedRoute.name,
        distance: plannedRoute.distance,
        dateLabel: '',
        participants: '',
        note: plannedRoute.note || '',
        color: plannedColor,
        routes,
      };
    }

    return null;
  }, [trip, plannedRoute, plannedColor]);

  // Build 3D route items for ONLY the selected route (split across any internal Přejezdy)
  const { routes3D, selectedCoords3D } = useMemo(() => {
    if (!activeRouteInfo) {
      return { routes3D: [] as Route3DItem[], selectedCoords3D: [] as Coordinate[] };
    }

    const items: Route3DItem[] = [];
    let selCoords: Coordinate[] = [];
    const routes = activeRouteInfo.routes;

    routes.forEach((mapObj, mIdx) => {
      const isVisible = mapObj.visible !== false && !hiddenSegments[mIdx];
      if (isVisible && mapObj.coordinates && mapObj.coordinates.length > 1) {
        const isSelected = selectedMapIndex === null || selectedMapIndex === mIdx;
        items.push({
          id: `${activeRouteInfo.id}_${mIdx}`,
          tripId: activeRouteInfo.id,
          mapIndex: mIdx,
          name: `${activeRouteInfo.name}${routes.length > 1 ? ` (Část ${mIdx + 1})` : ''}`,
          date: activeRouteInfo.dateLabel,
          color: activeRouteInfo.color,
          isSelected,
          coordinates: mapObj.coordinates,
        });

        if (isSelected) {
          selCoords = selCoords.concat(mapObj.coordinates);
        }
      }
    });

    return { routes3D: items, selectedCoords3D: selCoords };
  }, [activeRouteInfo, selectedMapIndex, hiddenSegments]);

  // Compute elevation profile for the selected route / segment (with Přejezdy marked in black and excluded from stats)
  useEffect(() => {
    if (!activeRouteInfo) {
      setElevationData(null);
      return;
    }

    const routes = activeRouteInfo.routes;
    const coordGroups: Coordinate[][] = [];

    if (selectedMapIndex !== null && routes[selectedMapIndex]) {
      if (!hiddenSegments[selectedMapIndex] && routes[selectedMapIndex].coordinates) {
        coordGroups.push(routes[selectedMapIndex].coordinates!);
      }
    } else {
      routes.forEach((m, idx) => {
        if (!hiddenSegments[idx] && m.coordinates && m.coordinates.length > 0) {
          coordGroups.push(m.coordinates);
        }
      });
    }

    const title = `${activeRouteInfo.name}${
      selectedMapIndex !== null ? ` (Část ${selectedMapIndex + 1})` : ''
    }`;
    const profile = computeElevationProfileData(coordGroups, title);
    setElevationData(profile);
  }, [activeRouteInfo, selectedMapIndex, hiddenSegments]);

  const handleSelectRouteOn3D = useCallback(
    (_tripId: string, mIdx: number) => {
      onSelectSegment?.(mIdx);
    },
    [onSelectSegment]
  );

  // Automatically discover significant peaks and POIs along the route whenever selected route changes
  useEffect(() => {
    const coordsForPoi =
      selectedCoords3D.length >= 2
        ? selectedCoords3D
        : routes3D.flatMap((r) => r.coordinates);

    if (!activeRouteInfo || coordsForPoi.length < 2) {
      setRoutePois([]);
      setHighlightedPoiId(null);
      return;
    }

    const controller = new AbortController();
    setIsLoadingPois(true);
    setHighlightedPoiId(null);

    fetchRoutePeaksAndPOIs(coordsForPoi, activeRouteInfo.name, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setRoutePois(found);
          setIsLoadingPois(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsLoadingPois(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeRouteInfo, selectedCoords3D, routes3D]);

  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!elevationData || elevationData.points.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));

    const pts = elevationData.points;
    const totalPlotDist =
      elevationData.totalPlotDist || pts[pts.length - 1]?.plotDist || 1;
    const targetPlotDist = pct * totalPlotDist;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].plotDist - targetPlotDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const insideTransfer = elevationData.transfers.find(
      (tr) => targetPlotDist >= tr.startPlotDist && targetPlotDist <= tr.endPlotDist
    );

    const point = pts[closestIdx];
    if (!point) return;

    const range = elevationData.maxEle - elevationData.minEle || 1;
    const xPct =
      totalPlotDist > 0
        ? (point.plotDist / totalPlotDist) * 100
        : (closestIdx / Math.max(1, pts.length - 1)) * 100;
    const yPct = 92 - ((point.ele - elevationData.minEle) / range) * 84;
    const isTransferHover = Boolean(insideTransfer) || point.isTransfer;

    setHoveredPoint({
      dist: point.dist,
      ele: point.ele,
      gradePct: isTransferHover ? 0 : point.gradePct,
      slopeCat: isTransferHover ? 'transfer' : point.slopeCat,
      isTransfer: isTransferHover,
      xPct,
      yPct,
    });
    setHoveredCoord(point.coord);
  };

  const handleChartTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!elevationData || elevationData.points.length === 0 || e.touches.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const x = e.touches[0].clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));

    const pts = elevationData.points;
    const totalPlotDist =
      elevationData.totalPlotDist || pts[pts.length - 1]?.plotDist || 1;
    const targetPlotDist = pct * totalPlotDist;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].plotDist - targetPlotDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const insideTransfer = elevationData.transfers.find(
      (tr) => targetPlotDist >= tr.startPlotDist && targetPlotDist <= tr.endPlotDist
    );

    const point = pts[closestIdx];
    if (!point) return;

    const range = elevationData.maxEle - elevationData.minEle || 1;
    const xPct =
      totalPlotDist > 0
        ? (point.plotDist / totalPlotDist) * 100
        : (closestIdx / Math.max(1, pts.length - 1)) * 100;
    const yPct = 92 - ((point.ele - elevationData.minEle) / range) * 84;
    const isTransferHover = Boolean(insideTransfer) || point.isTransfer;

    setHoveredPoint({
      dist: point.dist,
      ele: point.ele,
      gradePct: isTransferHover ? 0 : point.gradePct,
      slopeCat: isTransferHover ? 'transfer' : point.slopeCat,
      isTransfer: isTransferHover,
      xPct,
      yPct,
    });
    setHoveredCoord(point.coord);
  };

  const handleChartMouseLeave = () => {
    setHoveredPoint(null);
    setHoveredCoord(null);
  };

  if (!activeRouteInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] md:h-[calc(100vh-64px)] bg-slate-100 p-6 text-center space-y-4">
        <p className="text-sm font-semibold text-slate-600">
          Pro 3D zobrazení není vybrána žádná trasa.
        </p>
        <button
          type="button"
          onClick={onBackTo2D}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-md cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Zpět do 2D</span>
        </button>
      </div>
    );
  }

  const routes = activeRouteInfo.routes;

  // Calculate ascent for planned route card display (excluding Přejezdy)
  const { ascent: totalAscentMeters } = computeRouteElevationStats(routes);

  return (
    <div className="flex w-full h-[calc(100vh-100px)] md:h-[calc(100vh-64px)] relative overflow-hidden bg-slate-900">
      {/* Mobile Backdrop */}
      {rightSidebarOpen && (
        <div
          onClick={() => setRightSidebarOpen(false)}
          className="fixed inset-0 bg-slate-900/40 z-[900] backdrop-blur-xs md:hidden"
        />
      )}

      {/* CENTER 3D MAP CONTAINER (No Left Sidebar!) */}
      <main className="flex-1 w-full h-full relative">
        {/* Mobile Button to open Selected Route Panel & 3D Controls */}
        <div className="md:hidden absolute top-3 right-3 z-[600]">
          <button
            type="button"
            onClick={() => setRightSidebarOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-10 px-3.5 rounded-xl shadow-xl font-bold text-xs flex items-center gap-1.5 border border-emerald-500 active:scale-95 transition-all"
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>3D Ovládání</span>
          </button>
        </div>

        {/* 3D Terrain Map */}
        <Terrain3DMap
          ref={terrainMapRef}
          routes={routes3D}
          selectedCoords={selectedCoords3D}
          hoveredCoord={hoveredCoord}
          hasBottomPanel={Boolean(elevationData)}
          exaggeration={exaggeration}
          pois={visibleRoutePois}
          showPois={showPois}
          highlightedPoiId={highlightedPoiId}
          onSelectPoi={(poi) => setHighlightedPoiId(poi.id)}
          onSelectRoute={handleSelectRouteOn3D}
          onFlightStateChange={setFlightState}
        />

        {/* Map Settings Control (Mapa v1.3 styles & 12 cartographic layers synced with 3D texture) + Center 3D Route icon */}
        <MapSettingsControl
          className="top-3 left-3 md:top-4 md:left-4"
          onCenterAllRoutes={() => {
            setHighlightedPoiId(null);
            terrainMapRef.current?.focusRoute();
          }}
          centerAllTitle="Vycentrovat trasu do 3D pohledu"
        />

        {/* Selected Route Floating Bar (Desktop only - hidden on mobile per obr. 5) + Flyover Telemetry */}
        <div className="absolute top-15 sm:top-4 left-1/2 -translate-x-1/2 z-[600] flex flex-col items-center gap-1.5 max-w-[95vw] pointer-events-none">
          <div className="hidden md:flex pointer-events-auto bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-xl border border-slate-200 items-center gap-2 flex-wrap justify-center">
            {activeRouteInfo.isPlanned && (
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: activeRouteInfo.color }}
              />
            )}
            <div className="font-extrabold text-xs text-stone-900 truncate max-w-[260px]">
              {activeRouteInfo.name}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Switch back to 2D keeping the selected route */}
              <button
                type="button"
                onClick={onBackTo2D}
                className="bg-slate-900 hover:bg-emerald-700 text-white border border-slate-700 px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1 shadow-2xs cursor-pointer transition-all"
                title="Přepnout zpět do 2D"
              >
                <Mountain className="w-3.5 h-3.5 text-emerald-400" />
                <span>2D</span>
              </button>

              {/* Toggle 3D Peaks & POIs on Diorama */}
              <button
                type="button"
                onClick={() => setShowPois((prev) => !prev)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer border transition-all ${
                  showPois
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200'
                }`}
                title={
                  showPois
                    ? 'Skrýt vrcholy a body zájmu v 3D diorámatu'
                    : 'Zobrazit vrcholy a body zájmu v 3D diorámatu'
                }
              >
                <Compass className="w-3.5 h-3.5" />
                <span>
                  Vrcholy (
                  {visibleRoutePois.length === routePois.length
                    ? routePois.length
                    : `${visibleRoutePois.length}/${routePois.length}`}
                  )
                </span>
              </button>

              {!activeRouteInfo.isPlanned && onOpenAnalytics && (
                <button
                  type="button"
                  onClick={() => onOpenAnalytics(activeRouteInfo.id)}
                  className="bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span>Statistiky</span>
                </button>
              )}

              {(() => {
                const firstMap = routes.find((r) => r.link || r.url);
                const firstPhotos = routes.find((r) => r.photosUrl || r.photos);
                const firstVideo = routes.find((r) => r.youtube || r.video);

                return (
                  <>
                    {firstMap && (
                      <a
                        href={
                          (firstMap.link || firstMap.url)!.startsWith('http')
                            ? firstMap.link || firstMap.url
                            : `https://${firstMap.link || firstMap.url}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Mapa</span>
                      </a>
                    )}
                    {firstPhotos && (
                      <a
                        href={
                          (firstPhotos.photosUrl || firstPhotos.photos)!.startsWith('http')
                            ? firstPhotos.photosUrl || firstPhotos.photos
                            : `https://${firstPhotos.photosUrl || firstPhotos.photos}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="bg-white hover:bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                      >
                        <Camera className="w-3 h-3" />
                        <span>Fotky</span>
                      </a>
                    )}
                    {firstVideo && (
                      <a
                        href={
                          (firstVideo.youtube || firstVideo.video)!.startsWith('http')
                            ? firstVideo.youtube || firstVideo.video
                            : `https://${firstVideo.youtube || firstVideo.video}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                      >
                        <Youtube className="w-3 h-3" />
                        <span>Video</span>
                      </a>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {flightState.flyProgress && (
            <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md border border-amber-400/70 px-3.5 py-1 rounded-xl shadow-xl text-xs font-extrabold flex items-center gap-3">
              <span className="text-amber-400">
                {flightState.flyProgress.distKm.toFixed(1)} km
              </span>
              {flightState.flyProgress.eleM !== null && (
                <span className="text-emerald-300">{flightState.flyProgress.eleM} m</span>
              )}
              <span className="text-slate-300">{flightState.flyProgress.pct}%</span>
            </div>
          )}
        </div>

        {/* Elevation Profile Panel (Bottom - 40% smaller on mobile) */}
        {elevationData && (
          <div className="absolute bottom-2 sm:bottom-3 left-2.5 right-2.5 md:left-6 md:right-6 z-[500] bg-white/95 backdrop-blur-md rounded-xl sm:rounded-2xl px-2.5 py-1.5 sm:px-4 sm:py-2.5 shadow-2xl border border-slate-200/90 text-xs transition-all select-none">
            <div className="flex items-start sm:items-center justify-between gap-2 mb-1 sm:mb-1.5">
              <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
                <div className="hidden sm:flex p-1.5 bg-emerald-100 text-emerald-800 rounded-lg shrink-0">
                  <Mountain className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-900 truncate text-[11px] sm:text-sm leading-tight">
                    Výškový profil: {elevationData.title}
                  </h4>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 flex flex-wrap gap-x-2 sm:gap-x-3 gap-y-0.5 mt-0.5 leading-tight">
                    <span className="text-emerald-700 font-semibold">
                      +{elevationData.ascent} m stoupání
                    </span>
                    <span className="text-rose-600 font-semibold">
                      -{elevationData.descent} m klesání
                    </span>
                    <span>Max: {elevationData.maxEle} m n.m.</span>
                    <span>Min: {elevationData.minEle} m n.m.</span>
                    {elevationData.transfers.length > 0 && (
                      <span className="text-slate-900 font-bold">
                        • {elevationData.transfers.length}× Přejezd
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <div className="hidden sm:flex items-center gap-2.5 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-xl text-[10px] font-semibold text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span>Rovina (&lt;5%)</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span>Standard (5–10%)</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span>Prudký (10–20%)</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
                    <span>Extrém (&gt;20%)</span>
                  </span>
                  {elevationData.transfers.length > 0 && (
                    <span className="inline-flex items-center gap-1 font-bold text-slate-900">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                      <span>Přejezd</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setElevationData(null)}
                  className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Zavřít výškový profil"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {(() => {
              const range = elevationData.maxEle - elevationData.minEle || 1;
              const pts = elevationData.points;
              const totalPlotDist =
                elevationData.totalPlotDist || pts[pts.length - 1]?.plotDist || 1;
              const totalWalkedDist =
                elevationData.totalWalkedDist || pts[pts.length - 1]?.dist || 0;

              const SLOPE_COLORS: Record<SlopeCategory, string> = {
                flat: '#10b981',
                std: '#3b82f6',
                steep: '#f59e0b',
                extreme: '#e11d48',
                transfer: '#111827',
              };

              const SLOPE_LABELS: Record<SlopeCategory, string> = {
                flat: 'Rovina (< 5 %)',
                std: 'Standard (5–10 %)',
                steep: 'Prudký svah (10–20 %)',
                extreme: 'Extrém (> 20 %)',
                transfer: 'Přejezd (mimo statistiky)',
              };

              const yTicks = [
                elevationData.maxEle,
                Math.round(elevationData.minEle + range * 0.66),
                Math.round(elevationData.minEle + range * 0.33),
                elevationData.minEle,
              ];

              const xTickCount = 6;
              const xTicks = Array.from({ length: xTickCount }, (_, idx) => {
                if (idx === 0) return '0.0';
                if (idx === xTickCount - 1) return totalWalkedDist.toFixed(1);
                const targetPlot = (totalPlotDist * idx) / (xTickCount - 1);
                let bestPt = pts[0];
                let minDiff = Infinity;
                for (let k = 0; k < pts.length; k++) {
                  const d = Math.abs(pts[k].plotDist - targetPlot);
                  if (d < minDiff) {
                    minDiff = d;
                    bestPt = pts[k];
                  }
                }
                return (bestPt?.dist ?? 0).toFixed(1);
              });

              const coordsXY = pts.map((p, i) => {
                const x =
                  totalPlotDist > 0
                    ? (p.plotDist / totalPlotDist) * 1000
                    : (i / Math.max(1, pts.length - 1)) * 1000;
                const y = 92 - ((p.ele - elevationData.minEle) / range) * 84;
                return { x, y, slopeCat: p.slopeCat };
              });

              const runs: {
                cat: SlopeCategory;
                points: { x: number; y: number }[];
              }[] = [];

              for (let i = 1; i < coordsXY.length; i++) {
                const prevPt = coordsXY[i - 1];
                const currPt = coordsXY[i];
                const cat = currPt.slopeCat;

                if (runs.length > 0 && runs[runs.length - 1].cat === cat) {
                  runs[runs.length - 1].points.push({ x: currPt.x, y: currPt.y });
                } else {
                  runs.push({
                    cat,
                    points: [
                      { x: prevPt.x, y: prevPt.y },
                      { x: currPt.x, y: currPt.y },
                    ],
                  });
                }
              }

              return (
                <div className="space-y-0.5">
                  <div className="flex items-stretch h-12 sm:h-24 w-full">
                    <div className="w-10 sm:w-12 pr-1.5 sm:pr-2 flex flex-col justify-between text-[9px] sm:text-[10px] font-medium text-slate-400 text-right py-0.5 sm:py-1 shrink-0">
                      {yTicks.map((val, i) => (
                        <span key={i} className="leading-none">
                          {val} m
                        </span>
                      ))}
                    </div>

                    <div
                      className="flex-1 relative cursor-crosshair bg-slate-50/40 rounded-lg border border-slate-200/70 overflow-hidden touch-none"
                      onMouseMove={handleChartMouseMove}
                      onMouseLeave={handleChartMouseLeave}
                      onTouchStart={handleChartTouchMove}
                      onTouchMove={handleChartTouchMove}
                      onTouchEnd={handleChartMouseLeave}
                    >
                      <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none">
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/40 w-full" />
                      </div>

                      <svg
                        className="w-full h-full block"
                        preserveAspectRatio="none"
                        viewBox="0 0 1000 100"
                      >
                        <defs>
                          <linearGradient id="eleGrad3D-flat" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
                          </linearGradient>
                          <linearGradient id="eleGrad3D-std" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
                          </linearGradient>
                          <linearGradient id="eleGrad3D-steep" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.50" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.06" />
                          </linearGradient>
                          <linearGradient id="eleGrad3D-extreme" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#e11d48" stopOpacity="0.55" />
                            <stop offset="100%" stopColor="#e11d48" stopOpacity="0.08" />
                          </linearGradient>
                          <linearGradient id="eleGrad3D-transfer" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#111827" stopOpacity="0.38" />
                            <stop offset="100%" stopColor="#111827" stopOpacity="0.08" />
                          </linearGradient>
                        </defs>

                        {runs.map((run, rIdx) => {
                          const first = run.points[0];
                          const last = run.points[run.points.length - 1];
                          const polyCoords = run.points
                            .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
                            .join(' L ');
                          const areaD = `M ${first.x.toFixed(1)},100 L ${polyCoords} L ${last.x.toFixed(1)},100 Z`;
                          return (
                            <path
                              key={`area-${rIdx}`}
                              d={areaD}
                              fill={`url(#eleGrad3D-${run.cat})`}
                            />
                          );
                        })}

                        {runs.map((run, rIdx) => {
                          const polyCoords = run.points
                            .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
                            .join(' L ');
                          return (
                            <path
                              key={`line-${rIdx}`}
                              d={`M ${polyCoords}`}
                              fill="none"
                              stroke={SLOPE_COLORS[run.cat]}
                              strokeWidth={run.cat === 'transfer' ? '3' : '2.5'}
                              vectorEffect="non-scaling-stroke"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          );
                        })}

                        {/* Vertical dashed boundary lines for each Přejezd */}
                        {elevationData.transfers.map((tr, tIdx) => {
                          const x1 =
                            totalPlotDist > 0 ? (tr.startPlotDist / totalPlotDist) * 1000 : 0;
                          const x2 =
                            totalPlotDist > 0 ? (tr.endPlotDist / totalPlotDist) * 1000 : 0;
                          return (
                            <g key={`tr3d-bound-${tIdx}`}>
                              <line
                                x1={x1}
                                y1={0}
                                x2={x1}
                                y2={100}
                                stroke="#111827"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                                vectorEffect="non-scaling-stroke"
                                opacity="0.55"
                              />
                              <line
                                x1={x2}
                                y1={0}
                                x2={x2}
                                y2={100}
                                stroke="#111827"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                                vectorEffect="non-scaling-stroke"
                                opacity="0.55"
                              />
                            </g>
                          );
                        })}
                      </svg>

                      {/* Direct "Přejezd" badges positioned over black transfer segments */}
                      {elevationData.transfers.map((tr, tIdx) => {
                        const midPlot = (tr.startPlotDist + tr.endPlotDist) / 2;
                        const xPct =
                          totalPlotDist > 0
                            ? Math.max(4, Math.min(96, (midPlot / totalPlotDist) * 100))
                            : 50;
                        const midEle = (tr.startEle + tr.endEle) / 2;
                        const yPct = Math.max(
                          20,
                          Math.min(76, 92 - ((midEle - elevationData.minEle) / range) * 84)
                        );
                        return (
                          <div
                            key={`tr3d-label-${tIdx}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 bg-slate-950/90 text-white text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded-md shadow-sm border border-slate-700 whitespace-nowrap flex items-center gap-1"
                            style={{ left: `${xPct}%`, top: `${yPct}%` }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
                            <span>Přejezd</span>
                          </div>
                        );
                      })}

                      {(() => {
                        // Compute live chart point from mouse hover OR active 3D flyover
                        let activePoint: {
                          dist: number;
                          ele: number;
                          gradePct: number;
                          slopeCat: SlopeCategory;
                          isTransfer: boolean;
                          xPct: number;
                          yPct: number;
                          isFlyover?: boolean;
                        } | null = hoveredPoint;

                        if (
                          !activePoint &&
                          flightState.flyProgress &&
                          pts.length > 1
                        ) {
                          const targetPlotDist =
                            (flightState.flyProgress.pct / 100) * totalPlotDist;
                          let idx = 0;
                          while (
                            idx < pts.length - 2 &&
                            pts[idx + 1].plotDist < targetPlotDist
                          ) {
                            idx++;
                          }
                          const p1 = pts[idx];
                          const p2 = pts[idx + 1] || p1;
                          const segPlotDist = p2.plotDist - p1.plotDist;
                          const frac =
                            segPlotDist > 0
                              ? Math.max(
                                  0,
                                  Math.min(1, (targetPlotDist - p1.plotDist) / segPlotDist)
                                )
                              : 0;

                          const interpDist = p1.dist + (p2.dist - p1.dist) * frac;
                          const interpPlotDist = p1.plotDist + (p2.plotDist - p1.plotDist) * frac;
                          const interpEle = Math.round(p1.rawEle + (p2.rawEle - p1.rawEle) * frac);
                          const xPct =
                            totalPlotDist > 0
                              ? Math.max(0, Math.min(100, (interpPlotDist / totalPlotDist) * 100))
                              : 0;
                          const yPct = 92 - ((interpEle - elevationData.minEle) / range) * 84;

                          activePoint = {
                            dist: interpDist,
                            ele: interpEle,
                            gradePct: p2.gradePct,
                            slopeCat: p2.slopeCat,
                            isTransfer: p2.isTransfer,
                            xPct,
                            yPct,
                            isFlyover: true,
                          };
                        }

                        if (!activePoint) return null;

                        return (
                          <>
                            <div
                              className={`absolute top-0 bottom-0 pointer-events-none ${
                                activePoint.isFlyover
                                  ? 'w-0.5 bg-amber-500/80 shadow-[0_0_8px_#f59e0b]'
                                  : 'w-px bg-slate-700/50'
                              }`}
                              style={{ left: `${activePoint.xPct}%` }}
                            />
                            <div
                              className={`absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white pointer-events-none ${
                                activePoint.isFlyover
                                  ? 'shadow-[0_0_12px_#f59e0b] ring-2 ring-amber-400/70'
                                  : 'shadow-md'
                              }`}
                              style={{
                                left: `${activePoint.xPct}%`,
                                top: `${activePoint.yPct}%`,
                                backgroundColor: activePoint.isFlyover
                                  ? '#f59e0b'
                                  : SLOPE_COLORS[activePoint.slopeCat],
                              }}
                            />
                            <div
                              className="absolute top-2 z-20 bg-slate-900/95 text-white px-2.5 py-1.5 rounded-lg shadow-lg text-[10px] pointer-events-none whitespace-nowrap space-y-0.5"
                              style={{
                                left:
                                  activePoint.xPct > 65
                                    ? `calc(${activePoint.xPct}% - 150px)`
                                    : `calc(${activePoint.xPct}% + 10px)`,
                              }}
                            >
                              <div className="font-semibold text-slate-300">
                                Vzdálenost:{' '}
                                <span className="text-white">{activePoint.dist.toFixed(2)} km</span>
                              </div>
                              <div className="font-semibold text-emerald-400">
                                Výška: <span className="text-white">{activePoint.ele} m n. m.</span>
                              </div>
                              <div className="font-semibold flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full inline-block"
                                  style={{ backgroundColor: SLOPE_COLORS[activePoint.slopeCat] }}
                                />
                                {activePoint.isTransfer ? (
                                  <span className="text-white font-bold">
                                    Úsek: {SLOPE_LABELS.transfer}
                                  </span>
                                ) : (
                                  <>
                                    <span className="text-slate-300">Sklon:</span>
                                    <span className="text-white">
                                      {activePoint.gradePct >= 0 ? '+' : ''}
                                      {activePoint.gradePct.toFixed(1)} % (
                                      {SLOPE_LABELS[activePoint.slopeCat]})
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex justify-between pl-12 pr-1 text-[10px] font-medium text-slate-400">
                    {xTicks.map((distLabel, i) => (
                      <span key={i}>{distLabel} km</span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR:
          1. Top 3D controls ABOVE "Vybraná trasa (3D)" (obr. 2)
          2. "Vybraná trasa (3D)" + Selected Route Card
          3. Bottom 3D controls in the bottom section of the right panel (obr. 3) */}
      <aside
        className={`absolute md:relative right-0 z-[950] md:z-20 w-[330px] sm:w-[365px] bg-white border-l border-slate-200 flex flex-col h-full shadow-2xl md:shadow-none transition-transform duration-300 ${
          rightSidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        }`}
      >
        {/* 1. HORNÍ OVLÁDACÍ PRVKY 3D (nad panelem Vybraná trasa - obr. 2) */}
        <div className="p-3 bg-slate-900 text-white border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
              <Layers className="w-3.5 h-3.5" />
              <span>Mapový podklad 3D</span>
            </div>
            <button
              type="button"
              onClick={() => setRightSidebarOpen(false)}
              className="md:hidden text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Terrain Vertical Exaggeration Selector */}
          <div className="flex items-center justify-between bg-slate-800/90 px-2.5 py-1.5 rounded-xl border border-slate-700/80 text-[11px] font-bold">
            <span className="text-slate-300 text-[11px]">Převýšení terénu:</span>
            <div className="flex items-center gap-1">
              {[
                { val: 1.0, label: '1×' },
                { val: 1.4, label: '1.4×' },
                { val: 2.0, label: '2×' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setExaggeration(opt.val)}
                  className={`px-2.5 py-0.5 rounded-lg transition-all cursor-pointer ${
                    exaggeration === opt.val
                      ? 'bg-amber-500 text-slate-950 font-extrabold'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                  title={`Zvýraznění výšek 3D terénu (${opt.label})`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. PANEL VYBRANÁ TRASA (3D) + KARTA VYBRANÉ TRASY */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Vybraná trasa (3D)
          </h3>

          <button
            type="button"
            onClick={() => {
              setRightSidebarOpen(false);
              onBackTo2D();
            }}
            className="text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Vrátit se zpět do 2D s vybranou trasou"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Zpět do 2D</span>
          </button>
        </div>

        {/* Selected Route Card */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          <div className="p-3.5 rounded-xl border border-rose-400 bg-rose-50/20 shadow-xs ring-1 ring-rose-300 text-xs space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div
                onClick={() => onSelectSegment?.(null)}
                className="cursor-pointer flex-1 overflow-hidden"
              >
                <div
                  className="font-bold text-rose-700 text-sm leading-snug"
                  title={activeRouteInfo.name}
                >
                  {activeRouteInfo.name}
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap items-center gap-2.5">
                  {activeRouteInfo.dateLabel && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {activeRouteInfo.dateLabel}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <Route className="w-3 h-3 text-emerald-600" />
                    <span>
                      {activeRouteInfo.isPlanned ? 'Plánováno:' : 'Celkem:'}{' '}
                      {activeRouteInfo.distance || '0.0'} km
                    </span>
                  </span>
                  {activeRouteInfo.isPlanned && totalAscentMeters > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold">
                      <TrendingUp className="w-3 h-3" />
                      <span>+{Math.round(totalAscentMeters)} m</span>
                    </span>
                  )}
                </div>
                {activeRouteInfo.participants && (
                  <div className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-1">
                    <Users className="w-3 h-3 text-teal-600 shrink-0" />
                    <span>{activeRouteInfo.participants}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Route parts */}
            {routes.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-200/70">
                {routes.map((mapObj, mIdx) => {
                  const hasGeom = Boolean(mapObj.coordinates && mapObj.coordinates.length > 0);
                  const isPartSelected = selectedMapIndex === mIdx;
                  const isVisible = mapObj.visible !== false && !hiddenSegments[mIdx];
                  const segDist = getSegmentDistanceKm(
                    mapObj,
                    routes.length,
                    activeRouteInfo.distance
                  );

                  return (
                    <div
                      key={mIdx}
                      className={`flex items-center justify-between py-1.5 px-2 rounded-lg border text-xs transition-colors ${
                        isPartSelected
                          ? 'bg-rose-50/80 border-rose-200'
                          : 'bg-white hover:bg-slate-50 border-slate-200/70'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden flex-1 pr-1.5">
                        {hasGeom ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSegmentVisibility(mIdx);
                            }}
                            className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                              isVisible
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                                : 'bg-slate-200 hover:bg-slate-300 text-slate-500'
                            }`}
                            title={
                              isVisible
                                ? 'Skrýt tuto část trasy ve 3D'
                                : 'Zobrazit tuto část trasy ve 3D'
                            }
                          >
                            {isVisible ? (
                              <Eye className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3" />
                            )}
                          </button>
                        ) : (
                          <span
                            className="w-5 h-5 rounded-md flex items-center justify-center bg-slate-100 text-slate-400 shrink-0"
                            title="Chybí GPX trasa"
                          >
                            <Minus className="w-3 h-3" />
                          </span>
                        )}

                        <span
                          onClick={() => {
                            onSelectSegment?.(selectedMapIndex === mIdx ? null : mIdx);
                            setRightSidebarOpen(false);
                          }}
                          className={`font-medium cursor-pointer truncate text-[11px] transition-colors flex items-center gap-1.5 ${
                            isVisible
                              ? 'text-slate-700 hover:text-emerald-600'
                              : 'text-slate-400 line-through'
                          }`}
                          title="Kliknutím vyberete tuto část trasy"
                        >
                          <span>{activeRouteInfo.isPlanned ? 'GPX trasa' : `Část ${mIdx + 1}`}</span>
                          {segDist !== null && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/80 shrink-0">
                              {segDist.toFixed(1)} km
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {(mapObj.link || mapObj.url) && (
                          <a
                            href={
                              (mapObj.link || mapObj.url)!.startsWith('http')
                                ? mapObj.link || mapObj.url
                                : `https://${mapObj.link || mapObj.url}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:text-emerald-800 p-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 rounded-md transition-colors flex items-center justify-center"
                            title="Otevřít na Mapy.cz"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {(mapObj.photosUrl || mapObj.photos) && (
                          <a
                            href={
                              (mapObj.photosUrl || mapObj.photos)!.startsWith('http')
                                ? mapObj.photosUrl || mapObj.photos
                                : `https://${mapObj.photosUrl || mapObj.photos}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-700 hover:text-amber-800 p-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-md transition-colors flex items-center justify-center"
                            title="Fotogalerie k úseku"
                          >
                            <Camera className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {(mapObj.youtube || mapObj.video) && (
                          <a
                            href={
                              (mapObj.youtube || mapObj.video)!.startsWith('http')
                                ? mapObj.youtube || mapObj.video
                                : `https://${mapObj.youtube || mapObj.video}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-rose-700 hover:text-rose-800 p-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 rounded-md transition-colors flex items-center justify-center"
                            title="Video k úseku"
                          >
                            <Youtube className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Optional Note */}
            {activeRouteInfo.note && (
              <div className="pt-2 border-t border-slate-200/70">
                <div className="text-[11px] text-slate-600 italic bg-white/90 p-2.5 rounded-lg border-l-2 border-emerald-500">
                  {activeRouteInfo.note}
                </div>
              </div>
            )}
          </div>

          {/* Automatically Discovered Peaks & Points of Interest Section */}
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                <Compass className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  Významné vrcholy a POI (
                  {visibleRoutePois.length === routePois.length
                    ? routePois.length
                    : `${visibleRoutePois.length}/${routePois.length}`}
                  )
                </span>
              </div>

              <div className="flex items-center gap-1">
                {Object.values(hiddenPois).some(Boolean) && (
                  <button
                    type="button"
                    onClick={() => {
                      setHiddenPois({});
                      setShowPois(true);
                    }}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50 cursor-pointer transition-colors"
                    title="Znovu zapnout všechny jednotlivě vypnuté vrcholy a body zájmu"
                  >
                    Zapnout vše
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPois((prev) => !prev)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border cursor-pointer transition-colors ${
                    showPois
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-100'
                  }`}
                  title={
                    showPois
                      ? 'Skrýt všechny vrcholy a body zájmu ve 3D'
                      : 'Zobrazit zapnuté vrcholy a body zájmu ve 3D'
                  }
                >
                  {showPois ? 'Zobrazeno ve 3D' : 'Skryto'}
                </button>
              </div>
            </div>

            {isLoadingPois ? (
              <div className="text-[11px] text-slate-500 py-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <span>Vyhledávám vrcholy a body zájmu podél trasy…</span>
              </div>
            ) : routePois.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-1">
                V bezprostředním okolí trasy nebyly nalezeny žádné pojmenované body.
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                {routePois.map((poi) => {
                  const isSelected = highlightedPoiId === poi.id;
                  const isPoiVisible = showPois && !hiddenPois[poi.id];
                  const icon =
                    poi.category === 'peak'
                      ? '⛰️'
                      : poi.category === 'viewpoint'
                      ? '🔭'
                      : poi.category === 'hut'
                      ? '🏡'
                      : poi.category === 'saddle'
                      ? '🚩'
                      : poi.category === 'historic'
                      ? '🏰'
                      : '💧';

                  return (
                    <div
                      key={poi.id}
                      className={`w-full px-2 py-1.5 rounded-lg border text-[11px] flex items-center justify-between gap-2 transition-all ${
                        isSelected
                          ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-300 font-bold text-slate-900'
                          : 'bg-white hover:bg-slate-100/80 border-slate-200/80 text-slate-700 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {/* Individual POI visibility toggle button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!showPois) {
                              setShowPois(true);
                              setHiddenPois((prev) => ({
                                ...prev,
                                [poi.id]: false,
                              }));
                            } else {
                              togglePoiVisibility(poi.id);
                            }
                          }}
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            isPoiVisible
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-500'
                          }`}
                          title={
                            isPoiVisible
                              ? `Vypnout bod "${poi.name}" ve 3D zobrazení`
                              : `Zapnout bod "${poi.name}" ve 3D zobrazení`
                          }
                          aria-label={
                            isPoiVisible
                              ? `Vypnout bod ${poi.name} ve 3D`
                              : `Zapnout bod ${poi.name} ve 3D`
                          }
                        >
                          {isPoiVisible ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowPois(true);
                            setHiddenPois((prev) => ({
                              ...prev,
                              [poi.id]: false,
                            }));
                            setHighlightedPoiId(isSelected ? null : poi.id);
                            terrainMapRef.current?.focusLocation(poi.lat, poi.lon);
                            setRightSidebarOpen(false);
                          }}
                          className={`flex items-center gap-1.5 truncate text-left flex-1 cursor-pointer ${
                            isPoiVisible
                              ? 'text-slate-800 hover:text-amber-700'
                              : 'text-slate-400 line-through'
                          }`}
                          title="Kliknutím zaměříte kameru na tento bod v 3D diorámatu"
                        >
                          <span>{icon}</span>
                          <span className="truncate">{poi.name}</span>
                        </button>
                      </div>

                      <div
                        onClick={() => {
                          setShowPois(true);
                          setHiddenPois((prev) => ({
                            ...prev,
                            [poi.id]: false,
                          }));
                          setHighlightedPoiId(isSelected ? null : poi.id);
                          terrainMapRef.current?.focusLocation(poi.lat, poi.lon);
                          setRightSidebarOpen(false);
                        }}
                        className="flex items-center gap-1.5 shrink-0 text-[10px] cursor-pointer"
                      >
                        {poi.ele && (
                          <span
                            className={`font-extrabold px-1.5 py-0.2 rounded border ${
                              isPoiVisible
                                ? 'text-amber-700 bg-amber-50 border-amber-200'
                                : 'text-slate-400 bg-slate-100 border-slate-200'
                            }`}
                          >
                            {poi.ele} m
                          </span>
                        )}
                        <span className="text-slate-400">
                          {poi.distanceFromRouteKm < 0.1
                            ? 'na trase'
                            : `${poi.distanceFromRouteKm.toFixed(1)} km`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 3. DOLNÍ OVLÁDACÍ PRVKY 3D (ve spodní části pravého panelu - obr. 3) */}
        <div className="mt-auto p-3.5 bg-slate-900 text-white border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Mountain className="w-3.5 h-3.5" />
              <span>Ovládání 3D pohledu</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setRightSidebarOpen(false);
                onBackTo2D();
              }}
              className="text-[11px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 rounded-lg border border-emerald-500 flex items-center gap-1 cursor-pointer transition-colors"
              title="Vrátit se zpět do 2D"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Zpět do 2D</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Vycentrovat 3D (swapped to top full-width & larger) */}
            <button
              type="button"
              onClick={() => {
                setHighlightedPoiId(null);
                terrainMapRef.current?.focusRoute();
                setRightSidebarOpen(false);
              }}
              className="col-span-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 py-3 px-4 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm"
              title="Vycentrovat trasu do 3D pohledu"
            >
              <Maximize2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Vycentrovat 3D</span>
            </button>

            {/* 360° oblet (larger) */}
            <button
              type="button"
              onClick={() => {
                terrainMapRef.current?.toggleOrbit();
                setRightSidebarOpen(false);
              }}
              className={`py-3 px-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 border transition-all cursor-pointer shadow-sm ${
                flightState.isOrbiting
                  ? 'bg-indigo-600 text-white border-indigo-400'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
              }`}
              title="Otáčet 3D kameru kolem terénu o 360°"
            >
              <RotateCw
                className={`w-4 h-4 shrink-0 ${
                  flightState.isOrbiting ? 'animate-spin' : 'text-indigo-400'
                }`}
              />
              <span>360° oblet</span>
            </button>

            {/* 3D přelet trasy (swapped & larger) */}
            <button
              type="button"
              disabled={selectedCoords3D.length < 2}
              onClick={() => {
                terrainMapRef.current?.toggleFlyover();
                setRightSidebarOpen(false);
              }}
              className={`py-3 px-3 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 border transition-all cursor-pointer disabled:opacity-40 shadow-sm ${
                flightState.isFlying
                  ? 'bg-amber-500 text-slate-950 border-amber-300 animate-pulse'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
              }`}
              title="Spustit plynulý 3D přelet kamery podél vybrané trasy"
            >
              {flightState.isFlying ? (
                <Pause className="w-4 h-4 shrink-0" />
              ) : (
                <Play className="w-4 h-4 shrink-0" />
              )}
              <span>
                {flightState.isFlying
                  ? 'Zastavit přelet'
                  : flightState.flyProgress &&
                    flightState.flyProgress.pct > 0 &&
                    flightState.flyProgress.pct < 100
                  ? 'Pokračovat v přeletu'
                  : '3D přelet trasy'}
              </span>
            </button>

            {/* Naklopit / Shora */}
            <button
              type="button"
              onClick={() => {
                terrainMapRef.current?.adjustPitch(12);
                setRightSidebarOpen(false);
              }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              title="Více naklopit kameru k horizontu"
            >
              <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
              <span>Naklopit</span>
            </button>

            <button
              type="button"
              onClick={() => {
                terrainMapRef.current?.adjustPitch(-12);
                setRightSidebarOpen(false);
              }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              title="Narovnat pohled více shora"
            >
              <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
              <span>Shora</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
