import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  Layers,
  Eye,
  EyeOff,
  Minus,
  Filter,
  BarChart2,
  RotateCcw,
  Mountain,
  TrendingUp,
  TrendingDown,
  Navigation,
  X,
  ExternalLink,
  MapPin,
  Camera,
  Youtube,
  CloudDownload,
  Menu,
  Calendar,
  Route,
  Users,
} from 'lucide-react';
import { Hike, Coordinate, FilterState } from '../types';
import { ActivityIcon, ACTIVITY_OPTIONS } from './ActivityBadge';
import {
  getSegmentDistanceKm,
  getEffectiveHikeDistanceKm,
  computeRouteElevationStats,
  computeElevationProfileData,
  splitIntoContiguousSegments,
  ElevationProfileData,
  ElevationSlopeCat,
} from '../utils/gpxParser';
import { parseSafeDate, getDisplayDateRange } from '../utils/dateUtils';
import { createCustomMapaTileLayer } from '../utils/customMapLayer';
import { MapSettingsControl } from './MapSettingsControl';
interface MapViewProps {
  hikes: Hike[];
  filterState: FilterState;
  onFilterChange: (newFilters: Partial<FilterState>) => void;
  selectedTripId: string | null;
  selectedMapIndex: number | null;
  onSelectTrip: (tripId: string | null, mapIndex?: number | null) => void;
  onOpenAnalytics: (tripId?: string) => void;
  onOpen3D?: () => void;
  onOpenPrint?: () => void;
  onRefreshCloud: () => Promise<void>;
  onMapReady?: () => void;
}

const PALETTE = [
  '#00b4d8',
  '#ff6b35',
  '#f72585',
  '#4361ee',
  '#7209b7',
  '#ff9f1c',
  '#00f5d4',
  '#e0aaff',
  '#3a86ff',
  '#fb8500',
];

export const MapView: React.FC<MapViewProps> = ({
  hikes,
  filterState,
  onFilterChange,
  selectedTripId,
  selectedMapIndex,
  onSelectTrip,
  onOpenAnalytics,
  onOpen3D,
  onRefreshCloud,
  onMapReady,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const hoverMarkerRef = useRef<L.Marker | null>(null);
  const tripsListContainerRef = useRef<HTMLDivElement>(null);
  const tripItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filterYear = filterState.year;
  const filterMonth = filterState.month;
  const filterParticipant = filterState.participant;
  const filterActivity = filterState.activity || 'all';

  // Mobile drawer states
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track hidden individual route segments by key `${tripId}_${mapIndex}`
  const [hiddenSegments, setHiddenSegments] = useState<Record<string, boolean>>({});

  const toggleSegmentVisibility = (tripId: string, mapIndex: number) => {
    const key = `${tripId}_${mapIndex}`;
    setHiddenSegments((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Elevation profile data
  const [elevationData, setElevationData] = useState<ElevationProfileData | null>(null);

  // Color map by year
  const { availableYears, availableParticipants, yearColorMap } = useMemo(() => {
    const years = new Set<number>();
    const parts = new Set<string>();

    hikes.forEach((t) => {
      const d = parseSafeDate(t.rawDate) || parseSafeDate(t.date?.split('–')[0]) || parseSafeDate(t.date?.split('-')[0]);
      if (d && !isNaN(d.getFullYear())) years.add(d.getFullYear());
      if (t.participants) {
        t.participants.split(',').forEach((p) => {
          const clean = p.trim();
          if (clean) parts.add(clean);
        });
      }
    });

    const sortedYears = Array.from(years).sort((a, b) => a - b);
    const colorMap: Record<number, string> = {};
    sortedYears.forEach((y, i) => {
      colorMap[y] = PALETTE[i % PALETTE.length];
    });

    return {
      availableYears: sortedYears.reverse(),
      availableParticipants: Array.from(parts).sort(),
      yearColorMap: colorMap,
    };
  }, [hikes]);

  // Filtered trips for map (sorted from newest to oldest)
  const filteredTrips = useMemo(() => {
    return hikes
      .filter((trip) => {
        const d =
          parseSafeDate(trip.rawDate) ||
          parseSafeDate(trip.date?.split('–')[0]) ||
          parseSafeDate(trip.date?.split('-')[0]);
        if (filterYear !== 'all') {
          if (!d || d.getFullYear().toString() !== filterYear) return false;
        }
        if (filterMonth !== 'all') {
          if (!d || (d.getMonth() + 1).toString() !== filterMonth) return false;
        }
        if (filterParticipant !== 'all') {
          if (
            !trip.participants ||
            !trip.participants.toLowerCase().includes(filterParticipant.toLowerCase())
          ) {
            return false;
          }
        }
        if (filterActivity !== 'all') {
          if (trip.activity !== filterActivity) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dateA =
          parseSafeDate(a.rawDate) ||
          parseSafeDate(a.date?.split('–')[0]) ||
          parseSafeDate(a.date?.split('-')[0]) ||
          new Date(0);
        const dateB =
          parseSafeDate(b.rawDate) ||
          parseSafeDate(b.date?.split('–')[0]) ||
          parseSafeDate(b.date?.split('-')[0]) ||
          new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
  }, [hikes, filterYear, filterMonth, filterParticipant, filterActivity]);

  // Overall statistics for left sidebar (excluding non-contiguous Přejezd transfers)
  const stats = useMemo(() => {
    let totalKm = 0;
    let totalAscent = 0;
    let totalDescent = 0;
    let maxEle = -Infinity;
    let maxTripName = '';

    filteredTrips.forEach((trip) => {
      const distNum = getEffectiveHikeDistanceKm(trip);
      if (!isNaN(distNum) && distNum > 0) totalKm += distNum;

      const routes = trip.routes || trip.maps || [];
      const eleStats = computeRouteElevationStats(routes);
      totalAscent += eleStats.ascent;
      totalDescent += eleStats.descent;
      if (eleStats.maxEle !== null && eleStats.maxEle > maxEle) {
        maxEle = eleStats.maxEle;
        maxTripName = trip.name;
      }
    });

    return {
      tripsCount: filteredTrips.length,
      totalDistance: totalKm,
      totalAscent: Math.round(totalAscent),
      totalDescent: Math.round(totalDescent),
      maxElevation: maxEle !== -Infinity ? Math.round(maxEle) : null,
      maxElevationTripName: maxTripName,
    };
  }, [filteredTrips]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [49.7422, 15.3366], // Center of Czech Republic
      zoom: 7,
      zoomControl: false,
    });
    map.attributionControl.setPrefix(false);

    map.createPane('selectedTripPane');
    const selectedPane = map.getPane('selectedTripPane');
    if (selectedPane) {
      selectedPane.style.zIndex = '650';
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const tileLayer = createCustomMapaTileLayer();
    let notifiedReady = false;
    const markReady = () => {
      if (!notifiedReady) {
        notifiedReady = true;
        onMapReady?.();
      }
    };
    tileLayer.once('load', markReady);
    let loadedTileCount = 0;
    tileLayer.on('tileload', () => {
      loadedTileCount += 1;
      if (loadedTileCount >= 4) {
        markReady();
      }
    });
    tileLayer.addTo(map);

    polylinesLayerRef.current.addTo(map);
    mapInstanceRef.current = map;

    const readyFallbackTimer = window.setTimeout(markReady, 2200);

    return () => {
      window.clearTimeout(readyFallbackTimer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Selected trip object
  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return hikes.find((t) => t.id === selectedTripId) || null;
  }, [hikes, selectedTripId]);

  // Automatically scroll the selected trip into view in the "Načtené trasy" list
  useEffect(() => {
    if (!selectedTripId) return;
    const container = tripsListContainerRef.current;
    const itemEl = tripItemRefs.current[selectedTripId];
    if (container && itemEl) {
      const targetTop = Math.max(0, itemEl.offsetTop - container.offsetTop - 12);
      container.scrollTo({
        top: targetTop,
        behavior: 'smooth',
      });
    }
  }, [selectedTripId, selectedMapIndex]);

  // Compute elevation profile when selectedTrip or selectedMapIndex changes
  useEffect(() => {
    if (!selectedTrip) {
      setElevationData(null);
      if (hoverMarkerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(hoverMarkerRef.current);
        hoverMarkerRef.current = null;
      }
      return;
    }

    const routes = selectedTrip.routes || selectedTrip.maps || [];
    const coordGroups: Coordinate[][] = [];

    if (selectedMapIndex !== null && routes[selectedMapIndex]) {
      if (!hiddenSegments[`${selectedTrip.id}_${selectedMapIndex}`]) {
        const c = routes[selectedMapIndex].coordinates || [];
        if (c.length > 0) coordGroups.push(c);
      }
    } else {
      routes.forEach((m, idx) => {
        if (!hiddenSegments[`${selectedTrip.id}_${idx}`] && m.coordinates && m.coordinates.length > 0) {
          coordGroups.push(m.coordinates);
        }
      });
    }

    const title = `${selectedTrip.name}${
      selectedMapIndex !== null ? ` (Část ${selectedMapIndex + 1})` : ''
    }`;
    const profile = computeElevationProfileData(coordGroups, title);
    setElevationData(profile);
  }, [selectedTrip, selectedMapIndex, hiddenSegments]);

  // Render Polylines to Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    polylinesLayerRef.current.clearLayers();
    const bounds = L.latLngBounds([]);

    const unselectedLines: { layer: L.Polyline; shadow: L.Polyline; ts: number }[] = [];
    const selectedLines: { layer: L.Polyline; shadow: L.Polyline; ts: number }[] = [];

    filteredTrips.forEach((trip) => {
      const d = parseSafeDate(trip.rawDate) || parseSafeDate(trip.date?.split('–')[0]);
      const tripYear = d ? d.getFullYear() : null;
      const baseColor = tripYear && yearColorMap[tripYear] ? yearColorMap[tripYear] : '#00b4d8';
      const timestamp = d ? d.getTime() : 0;

      const routes = trip.routes || trip.maps || [];
      routes.forEach((mapObj, mIdx) => {
        const isSegmentVisible =
          mapObj.visible !== false && !hiddenSegments[`${trip.id}_${mIdx}`];
        if (isSegmentVisible && mapObj.coordinates && mapObj.coordinates.length > 0) {
          const isSelected =
            trip.id === selectedTripId &&
            (selectedMapIndex === null || selectedMapIndex === mIdx);

          const lineColor = isSelected ? '#e11d48' : baseColor;
          const shadowColor = isSelected ? '#881337' : '#ffffff';
          const shadowOpacity = isSelected ? 0.95 : 0.75;
          const weight = isSelected ? 8 : 5.5;
          const opacity = isSelected ? 1.0 : 0.95;

          const latLngs = mapObj.coordinates.map((pt) => [pt[0], pt[1]] as [number, number]);

          const shadowLine = L.polyline(latLngs, {
            color: shadowColor,
            weight: weight + 3,
            opacity: shadowOpacity,
            lineCap: 'round',
            lineJoin: 'round',
            pane: isSelected ? 'selectedTripPane' : 'overlayPane',
          });

          const mainLine = L.polyline(latLngs, {
            color: lineColor,
            weight: weight,
            opacity: opacity,
            lineCap: 'round',
            lineJoin: 'round',
            pane: isSelected ? 'selectedTripPane' : 'overlayPane',
          });

          const segDist = getSegmentDistanceKm(mapObj, routes.length, trip.distance);
          const totalEffectiveKm = getEffectiveHikeDistanceKm(trip);
          const distPopupText =
            routes.length > 1 && segDist !== null
              ? `Délka úseku: ${segDist.toFixed(1)} km (Celkem: ${totalEffectiveKm.toFixed(1)} km)`
              : `Délka: ${segDist !== null ? segDist.toFixed(1) : totalEffectiveKm.toFixed(1)} km`;

          mainLine.bindPopup(
            `<b>${trip.name}${routes.length > 1 ? ` (Úsek ${mIdx + 1})` : ''}</b><br>Datum: ${trip.date || '-'}<br>${distPopupText}`
          );

          mainLine.on('click', () => {
            onSelectTrip(trip.id, mIdx);
          });

          if (isSelected) {
            selectedLines.push({ layer: mainLine, shadow: shadowLine, ts: timestamp });
          } else {
            unselectedLines.push({ layer: mainLine, shadow: shadowLine, ts: timestamp });
          }

          latLngs.forEach((coord) => bounds.extend(coord));
        }
      });
    });

    // Add unselected lines first
    unselectedLines.sort((a, b) => a.ts - b.ts);
    unselectedLines.forEach((item) => {
      polylinesLayerRef.current.addLayer(item.shadow);
      polylinesLayerRef.current.addLayer(item.layer);
    });

    // Add selected lines on top
    selectedLines.forEach((item) => {
      polylinesLayerRef.current.addLayer(item.shadow);
      polylinesLayerRef.current.addLayer(item.layer);
      if (item.layer.bringToFront) item.layer.bringToFront();
    });

    // Zoom to selected trip if present
    if (selectedTrip) {
      const routes = selectedTrip.routes || selectedTrip.maps || [];
      let selCoords: Coordinate[] = [];
      if (selectedMapIndex !== null && routes[selectedMapIndex]) {
        if (!hiddenSegments[`${selectedTrip.id}_${selectedMapIndex}`]) {
          selCoords = routes[selectedMapIndex].coordinates || [];
        }
      } else {
        routes.forEach((m, idx) => {
          if (!hiddenSegments[`${selectedTrip.id}_${idx}`] && m.coordinates) {
            selCoords = selCoords.concat(m.coordinates);
          }
        });
      }

      if (selCoords.length > 0) {
        const selBounds = L.latLngBounds(selCoords.map((p) => [p[0], p[1]]));
        map.fitBounds(selBounds, {
          paddingBottomRight: [40, elevationData ? 240 : 60],
          paddingTopLeft: [40, 80],
        });
      }
    }
  }, [filteredTrips, selectedTripId, selectedMapIndex, yearColorMap, selectedTrip, elevationData, onSelectTrip, hiddenSegments]);

  // Hovered point on elevation chart
  const [hoveredPoint, setHoveredPoint] = useState<{
    dist: number;
    ele: number;
    gradePct: number;
    slopeCat: ElevationSlopeCat;
    isTransfer?: boolean;
    transferDistKm?: number;
    xPct: number;
    yPct: number;
  } | null>(null);

  // Shared Elevation Profile Chart Pointer / Touch Updater
  const updateChartHoverByClientX = (clientX: number, rect: DOMRect) => {
    if (!elevationData || elevationData.points.length === 0 || rect.width <= 0) return;

    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));

    const pts = elevationData.points;
    const totalPlotDist = elevationData.totalPlotDist || 1;
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

    const point = pts[closestIdx];
    if (!point) return;

    const range = elevationData.maxEle - elevationData.minEle || 1;
    const xPct =
      totalPlotDist > 0
        ? (point.plotDist / totalPlotDist) * 100
        : (closestIdx / Math.max(1, pts.length - 1)) * 100;
    const yPct = 92 - ((point.ele - elevationData.minEle) / range) * 84;

    setHoveredPoint({
      dist: point.dist,
      ele: point.ele,
      gradePct: point.gradePct,
      slopeCat: point.slopeCat,
      isTransfer: point.isTransfer,
      transferDistKm: point.transferDistKm,
      xPct,
      yPct,
    });

    const coord = point.coord;

    if (mapInstanceRef.current) {
      if (!hoverMarkerRef.current) {
        hoverMarkerRef.current = L.marker(coord, {
          icon: L.divIcon({ className: 'elevation-marker', iconSize: [16, 16] }),
          pane: 'selectedTripPane',
        }).addTo(mapInstanceRef.current);
      } else {
        hoverMarkerRef.current.setLatLng(coord);
      }
    }
  };

  // Elevation Profile Chart Mouse & Touch Handlers
  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    updateChartHoverByClientX(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const handleChartTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      updateChartHoverByClientX(e.touches[0].clientX, e.currentTarget.getBoundingClientRect());
    }
  };

  const handleChartMouseLeave = () => {
    setHoveredPoint(null);
    if (hoverMarkerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }
  };

  const handleFetchClick = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshCloud();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex w-full h-full md:h-[calc(100vh-64px)] relative overflow-hidden bg-slate-100">
      {/* Mobile Backdrop */}
      {(leftSidebarOpen || rightSidebarOpen) && (
        <div
          onClick={() => {
            setLeftSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
          className="absolute inset-0 bg-slate-900/40 z-[900] backdrop-blur-xs md:hidden"
        />
      )}

      {/* LEFT SIDEBAR: Stats & Quick Actions */}
      <aside
        className={`absolute md:relative z-[950] md:z-20 w-[280px] max-w-[88%] md:max-w-none sm:w-[260px] bg-white border-r border-slate-200 flex flex-col h-full shadow-2xl md:shadow-none transition-transform duration-300 ${
          leftSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-emerald-600 to-teal-700 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                <Navigation className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-sm tracking-tight">Archív Tras</h2>
                <p className="text-[10px] text-emerald-100">Mapový přehled výšlapů</p>
              </div>
            </div>
            <button
              onClick={() => setLeftSidebarOpen(false)}
              className="md:hidden text-white/80 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          {/* Horský zápisník Logo right below the header row */}
          <div className="pt-1 pb-1 flex items-center justify-center">
            <div className="w-44 h-44 rounded-full overflow-hidden flex items-center justify-center">
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/Gemini_Generated_Image_sdhf1zsdhf1zsdhf_fd6937b9.jpg`}
                alt="Horský zápisník logo"
                className="w-full h-full object-cover scale-[1.08] mix-blend-multiply select-none"
              />
            </div>
          </div>

          {/* Cloud Sync Button */}
          <button
            onClick={handleFetchClick}
            disabled={isRefreshing}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2 px-3 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-2"
          >
            <CloudDownload className={`w-4 h-4 ${isRefreshing ? 'animate-bounce' : ''}`} />
            <span>{isRefreshing ? 'Synchronizuji...' : 'Načíst data ze Zápisníku'}</span>
          </button>

          {/* Statistics Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Statistiky archívu</span>
              <Mountain className="w-3.5 h-3.5 text-emerald-600" />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Zobrazené výšlapy</span>
                <div className="text-base font-bold text-slate-900 mt-0.5">{stats.tripsCount}</div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Celková vzdálenost</span>
                <div className="text-base font-bold text-emerald-600 mt-0.5">
                  {stats.totalDistance.toFixed(1)} km
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Nastoupáno</span>
                <div className="text-base font-bold text-rose-600 mt-0.5 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{stats.totalAscent.toLocaleString('cs-CZ')} m</span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Sestoupáno</span>
                <div className="text-base font-bold text-sky-600 mt-0.5 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>{stats.totalDescent.toLocaleString('cs-CZ')} m</span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Nejvyšší bod</span>
                <div className="text-xs font-bold text-indigo-700 mt-0.5">
                  {stats.maxElevation ? `${stats.maxElevation.toLocaleString('cs-CZ')} m n.m.` : '-'}
                </div>
                {stats.maxElevationTripName && (
                  <div className="text-[10px] text-slate-500 truncate" title={stats.maxElevationTripName}>
                    {stats.maxElevationTripName}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Small Logo & Motto below Statistiky archívu */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 flex items-center gap-3 shadow-2xs">
            <img
              src={`${import.meta.env.BASE_URL}assets/aistudio/logo_55070224.png`}
              alt="Horské logo"
              className="w-12 h-12 object-contain shrink-0 select-none mix-blend-multiply"
            />
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-700 leading-snug">
              KDYŽ NEMÁŠ CESTU, NEMŮŽEŠ ZTRATIT CÍL
            </p>
          </div>
        </div>
      </aside>

      {/* CENTER MAP CONTAINER */}
      <main className="flex-1 w-full h-full relative">
        {/* Mobile Top-Right Button: Seznam tras */}
        <div className="md:hidden absolute top-3 right-3 z-[550]">
          <button
            type="button"
            onClick={() => setRightSidebarOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-10 px-3.5 rounded-xl shadow-lg font-bold text-xs flex items-center gap-1.5 border border-emerald-500 active:scale-95 transition-all"
            title="Otevřít seznam tras a filtry"
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>Trasy ({filteredTrips.length})</span>
          </button>
        </div>

        {/* 2D Leaflet Map Div */}
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Map Settings Control (icon-only) + Center All Routes icon + Mobile Přehled icon */}
        <MapSettingsControl
          className="top-3 left-3 md:top-4 md:left-4"
          onCenterAllRoutes={() => {
            onSelectTrip(null, null);
            const map = mapInstanceRef.current;
            if (!map) return;

            const allBounds = L.latLngBounds([]);
            filteredTrips.forEach((trip) => {
              const routes = trip.routes || trip.maps || [];
              routes.forEach((mapObj, mIdx) => {
                const isSegmentVisible =
                  mapObj.visible !== false && !hiddenSegments[`${trip.id}_${mIdx}`];
                if (isSegmentVisible && mapObj.coordinates && mapObj.coordinates.length > 0) {
                  mapObj.coordinates.forEach((pt) => allBounds.extend([pt[0], pt[1]]));
                }
              });
            });

            if (allBounds.isValid()) {
              map.fitBounds(allBounds, { padding: [40, 40] });
            } else {
              map.setView([49.8, 15.5], 7);
            }
          }}
          extraButtons={
            <button
              type="button"
              onClick={() => setLeftSidebarOpen(true)}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl shadow-lg border transition-all backdrop-blur-md cursor-pointer bg-white/95 hover:bg-white text-slate-800 hover:text-emerald-700 border-slate-200/90 hover:border-slate-300 active:scale-95"
              title="Statistiky archívu a synchronizace"
              aria-label="Přehled a statistiky archívu"
            >
              <BarChart2 className="w-4 h-4 text-emerald-600 shrink-0" />
            </button>
          }
        />

        {/* Selected Trip Floating Bar (Top Center - clean, non-clipping layout on mobile) */}
        {selectedTrip && (
          <div className="absolute top-15 sm:top-4 left-1/2 -translate-x-1/2 z-[600] bg-white/95 backdrop-blur-md px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-2xl shadow-xl border border-slate-200 flex flex-col sm:flex-row items-center gap-1 sm:gap-2 w-[calc(100%-20px)] sm:w-auto max-w-[95%]">
            <div className="flex items-center gap-1.5 max-w-[90%] sm:max-w-[280px]">
              <ActivityIcon activity={selectedTrip.activity} />
              <div className="font-extrabold text-xs text-stone-900 truncate">
                {selectedTrip.name}
              </div>
            </div>

            <div className="flex items-center justify-center gap-1 sm:gap-1.5 flex-wrap w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onOpen3D?.()}
                className="bg-slate-900 hover:bg-emerald-700 text-white border border-slate-700 px-2 py-1 sm:px-2.5 rounded-lg text-[11px] sm:text-xs font-extrabold flex items-center gap-1 shadow-2xs cursor-pointer transition-all shrink-0"
                title="Zobrazit vybranou trasu ve 3D"
              >
                <Mountain className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>3D</span>
              </button>

              <button
                onClick={() => onOpenAnalytics(selectedTrip.id)}
                className="bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 sm:px-2.5 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-2xs shrink-0"
              >
                <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                <span>Statistiky</span>
              </button>

              {(() => {
                const routes = selectedTrip.routes || selectedTrip.maps || [];
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
                        className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-2xs shrink-0"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
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
                        className="bg-white hover:bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-2xs shrink-0"
                      >
                        <Camera className="w-3 h-3 shrink-0" />
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
                        className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 px-2 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 shadow-2xs shrink-0"
                      >
                        <Youtube className="w-3 h-3 shrink-0" />
                        <span>Video</span>
                      </a>
                    )}
                  </>
                );
              })()}

              <button
                onClick={() => onSelectTrip(null)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2 py-1 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 shrink-0"
                title="Zrušit výběr"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* Legend in Top Right */}
        <div className="hidden sm:block absolute top-4 right-4 z-[400] bg-white/95 backdrop-blur-md p-3 rounded-2xl shadow-lg border border-slate-200/80 text-xs space-y-1.5 max-h-[30vh] overflow-y-auto">
          <div className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">
            Legenda roků
          </div>
          <div className="space-y-1">
            {availableYears.map((y) => (
              <div key={y} className="flex items-center gap-2">
                <span
                  className="w-3.5 h-1.5 rounded-full"
                  style={{ backgroundColor: yearColorMap[y] || '#00b4d8' }}
                />
                <span className="font-medium text-slate-600 text-[11px]">Rok {y}</span>
              </div>
            ))}
            <div className="pt-1 border-t border-slate-100 flex items-center gap-2">
              <span className="w-3.5 h-1.5 rounded-full bg-rose-600 shadow-xs" />
              <span className="font-bold text-rose-700 text-[11px]">Vybraná trasa</span>
            </div>
          </div>
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
                  <div className="text-[10px] sm:text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 mt-0.5 leading-tight">
                    <span className="text-emerald-700 font-semibold">
                      +{elevationData.ascent} m stoupání
                    </span>
                    <span className="text-rose-600 font-semibold">
                      -{elevationData.descent} m klesání
                    </span>
                    <span>Max: {elevationData.maxEle} m n.m.</span>
                    <span>Min: {elevationData.minEle} m n.m.</span>
                    {elevationData.hasTransfers && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-900 text-white text-[9px] sm:text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        <span>
                          {elevationData.transferCount === 1
                            ? '1 přejezd'
                            : `${elevationData.transferCount} přejezdy`}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* Terrain Slope Legend matching AnalyticsView + Přejezd */}
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
                  {elevationData.hasTransfers && (
                    <span className="inline-flex items-center gap-1 pl-2 border-l border-slate-300 text-slate-950 font-extrabold">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                      <span>Přejezd</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={() => setElevationData(null)}
                  className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                  title="Zavřít výškový profil"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Precision Elevation Chart Colored by Terrain Slope Analysis + Black Přejezdy */}
            {(() => {
              const range = elevationData.maxEle - elevationData.minEle || 1;
              const pts = elevationData.points;
              const totalPlotDist = elevationData.totalPlotDist || 1;
              const totalWalkedDist = elevationData.totalWalkedDist || 0;

              const SLOPE_COLORS: Record<ElevationSlopeCat, string> = {
                flat: '#10b981', // emerald-500 (Rovina < 5%)
                std: '#3b82f6', // blue-500 (Standard 5 - 10%)
                steep: '#f59e0b', // amber-500 (Prudký 10 - 20%)
                extreme: '#e11d48', // rose-600 (Extrém > 20%)
                transfer: '#111827', // černá barva (Přejezd)
              };

              const SLOPE_LABELS: Record<ElevationSlopeCat, string> = {
                flat: 'Rovina (< 5 %)',
                std: 'Standard (5–10 %)',
                steep: 'Prudký svah (10–20 %)',
                extreme: 'Extrém (> 20 %)',
                transfer: 'Přejezd (mimo statistiky)',
              };

              // 4 horizontal grid levels
              const yTicks = [
                elevationData.maxEle,
                Math.round(elevationData.minEle + range * 0.66),
                Math.round(elevationData.minEle + range * 0.33),
                elevationData.minEle,
              ];

              // 6 distance ticks along X axis showing walked km (and 'Přejezd' if a tick lands inside a transfer)
              const xTickCount = 6;
              const xTicks = Array.from({ length: xTickCount }, (_, idx) => {
                if (idx === 0) return '0.0 km';
                if (idx === xTickCount - 1) return `${totalWalkedDist.toFixed(1)} km`;
                if (!elevationData.hasTransfers) {
                  return `${((totalWalkedDist * idx) / (xTickCount - 1)).toFixed(1)} km`;
                }
                const targetPlot = (totalPlotDist * idx) / (xTickCount - 1);
                let closest = pts[0];
                let minD = Infinity;
                for (let i = 0; i < pts.length; i++) {
                  const d = Math.abs(pts[i].plotDist - targetPlot);
                  if (d < minD) {
                    minD = d;
                    closest = pts[i];
                  }
                }
                if (closest?.isTransfer) {
                  return 'Přejezd';
                }
                return `${(closest ? closest.dist : 0).toFixed(1)} km`;
              });

              const coordsXY = pts.map((p, i) => {
                const x =
                  totalPlotDist > 0
                    ? (p.plotDist / totalPlotDist) * 1000
                    : (i / Math.max(1, pts.length - 1)) * 1000;
                const y = 92 - ((p.ele - elevationData.minEle) / range) * 84;
                return { x, y, slopeCat: p.slopeCat };
              });

              // Group contiguous segments with identical slope category into runs
              const runs: {
                cat: ElevationSlopeCat;
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
                    {/* Y-Axis Elevation Labels */}
                    <div className="w-10 sm:w-12 pr-1.5 sm:pr-2 flex flex-col justify-between text-[9px] sm:text-[10px] font-medium text-slate-400 text-right py-0.5 sm:py-1 shrink-0">
                      {yTicks.map((val, i) => (
                        <span key={i} className="leading-none">
                          {val} m
                        </span>
                      ))}
                    </div>

                    {/* Chart Plot Area */}
                    <div
                      className="flex-1 relative cursor-crosshair bg-slate-50/40 rounded-lg border border-slate-200/70 overflow-hidden touch-none"
                      onMouseMove={handleChartMouseMove}
                      onMouseLeave={handleChartMouseLeave}
                      onTouchStart={handleChartTouchMove}
                      onTouchMove={handleChartTouchMove}
                      onTouchEnd={handleChartMouseLeave}
                    >
                      {/* Horizontal Grid Lines */}
                      <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none">
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/60 w-full" />
                        <div className="border-b border-slate-200/40 w-full" />
                      </div>

                      {/* Crisp Non-Scaling SVG Curve Colored by Slope + Black Přejezdy */}
                      <svg
                        className="w-full h-full block"
                        preserveAspectRatio="none"
                        viewBox="0 0 1000 100"
                      >
                        <defs>
                          <linearGradient id="eleGrad-flat" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
                          </linearGradient>
                          <linearGradient id="eleGrad-std" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
                          </linearGradient>
                          <linearGradient id="eleGrad-steep" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.50" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.06" />
                          </linearGradient>
                          <linearGradient id="eleGrad-extreme" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#e11d48" stopOpacity="0.55" />
                            <stop offset="100%" stopColor="#e11d48" stopOpacity="0.08" />
                          </linearGradient>
                          <linearGradient id="eleGrad-transfer" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#111827" stopOpacity="0.48" />
                            <stop offset="100%" stopColor="#111827" stopOpacity="0.08" />
                          </linearGradient>
                        </defs>

                        {/* Area fills per slope segment run */}
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
                              fill={`url(#eleGrad-${run.cat})`}
                            />
                          );
                        })}

                        {/* Vertical dashed boundary lines for Přejezdy */}
                        {elevationData.transfers.map((tr, tIdx) => {
                          const x1 = (tr.startXPct * 10).toFixed(1);
                          const x2 = (tr.endXPct * 10).toFixed(1);
                          return (
                            <g key={`transfer-bounds-${tIdx}`}>
                              <line
                                x1={x1}
                                y1="0"
                                x2={x1}
                                y2="100"
                                stroke="#111827"
                                strokeWidth="1.2"
                                strokeDasharray="3 3"
                                strokeOpacity="0.45"
                                vectorEffect="non-scaling-stroke"
                              />
                              <line
                                x1={x2}
                                y1="0"
                                x2={x2}
                                y2="100"
                                stroke="#111827"
                                strokeWidth="1.2"
                                strokeDasharray="3 3"
                                strokeOpacity="0.45"
                                vectorEffect="non-scaling-stroke"
                              />
                            </g>
                          );
                        })}

                        {/* Top stroke lines per slope segment run */}
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
                      </svg>

                      {/* Direct "Přejezd" Labels on each black transfer segment */}
                      {elevationData.transfers.map((tr, tIdx) => (
                        <div
                          key={`transfer-label-${tIdx}`}
                          className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 px-1.5 py-0.5 rounded-md bg-slate-950/90 text-white text-[9px] sm:text-[10px] font-extrabold tracking-wide shadow-sm border border-white/25 flex items-center gap-1 whitespace-nowrap"
                          style={{
                            left: `${tr.midXPct}%`,
                            top: `${Math.max(22, Math.min(76, tr.midYPct - 14))}%`,
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
                          <span>Přejezd</span>
                        </div>
                      ))}

                      {/* Hover Crosshair, Circular Point & Tooltip */}
                      {hoveredPoint && (
                        <>
                          {/* Vertical Line */}
                          <div
                            className="absolute top-0 bottom-0 w-px bg-slate-700/50 pointer-events-none"
                            style={{ left: `${hoveredPoint.xPct}%` }}
                          />
                          {/* Unstretched Circular Marker matching slope/transfer color */}
                          <div
                            className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-md pointer-events-none"
                            style={{
                              left: `${hoveredPoint.xPct}%`,
                              top: `${hoveredPoint.yPct}%`,
                              backgroundColor: SLOPE_COLORS[hoveredPoint.slopeCat],
                            }}
                          />
                          {/* Floating Tooltip */}
                          <div
                            className="absolute top-2 z-20 bg-slate-900/95 text-white px-2.5 py-1.5 rounded-lg shadow-lg text-[10px] pointer-events-none whitespace-nowrap space-y-0.5"
                            style={{
                              left:
                                hoveredPoint.xPct > 65
                                  ? `calc(${hoveredPoint.xPct}% - 165px)`
                                  : `calc(${hoveredPoint.xPct}% + 10px)`,
                            }}
                          >
                            {hoveredPoint.isTransfer ? (
                              <>
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full bg-slate-950 border border-white inline-block" />
                                  <span>Úsek: Přejezd (mimo statistiky)</span>
                                </div>
                                {hoveredPoint.transferDistKm !== undefined && (
                                  <div className="font-semibold text-slate-300">
                                    Vzdušný přesun:{' '}
                                    <span className="text-white">
                                      {hoveredPoint.transferDistKm.toFixed(1)} km
                                    </span>
                                  </div>
                                )}
                                <div className="font-semibold text-slate-300">
                                  Ušlá vzdálenost:{' '}
                                  <span className="text-white">{hoveredPoint.dist.toFixed(2)} km</span>
                                </div>
                                <div className="font-semibold text-emerald-400">
                                  Výška: <span className="text-white">{hoveredPoint.ele} m n. m.</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="font-semibold text-slate-300">
                                  Vzdálenost:{' '}
                                  <span className="text-white">{hoveredPoint.dist.toFixed(2)} km</span>
                                </div>
                                <div className="font-semibold text-emerald-400">
                                  Výška: <span className="text-white">{hoveredPoint.ele} m n. m.</span>
                                </div>
                                <div className="font-semibold flex items-center gap-1.5">
                                  <span
                                    className="w-2 h-2 rounded-full inline-block"
                                    style={{ backgroundColor: SLOPE_COLORS[hoveredPoint.slopeCat] }}
                                  />
                                  <span className="text-slate-300">Sklon:</span>
                                  <span className="text-white">
                                    {hoveredPoint.gradePct >= 0 ? '+' : ''}
                                    {hoveredPoint.gradePct.toFixed(1)} % (
                                    {SLOPE_LABELS[hoveredPoint.slopeCat]})
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* X-Axis Distance Labels */}
                  <div className="flex justify-between pl-12 pr-1 text-[10px] font-medium text-slate-400">
                    {xTicks.map((distLabel, i) => (
                      <span
                        key={i}
                        className={distLabel === 'Přejezd' ? 'text-slate-900 font-bold' : ''}
                      >
                        {distLabel}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR: Trips List & Filters */}
      <aside
        className={`absolute md:relative right-0 z-[950] md:z-20 w-[320px] max-w-[88%] md:max-w-none sm:w-[360px] bg-white border-l border-slate-200 flex flex-col h-full shadow-2xl md:shadow-none transition-transform duration-300 ${
          rightSidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRightSidebarOpen(false)}
              className="md:hidden text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Načtené trasy ({filteredTrips.length})
            </h3>
          </div>

          {selectedTripId && (
            <button
              onClick={() => onSelectTrip(null)}
              className="text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Zrušit výběr</span>
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="p-3 bg-slate-50/70 border-b border-slate-100 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Filter className="w-3 h-3 text-emerald-600" />
            <span>Filtry zobrazení</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Rok</label>
              <select
                value={filterYear}
                onChange={(e) => onFilterChange({ year: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium outline-none"
              >
                <option value="all">Všechny</option>
                {availableYears.map((y) => (
                  <option key={y} value={y.toString()}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Měsíc</label>
              <select
                value={filterMonth}
                onChange={(e) => onFilterChange({ month: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium outline-none"
              >
                <option value="all">Všechny</option>
                <option value="1">Leden</option>
                <option value="2">Únor</option>
                <option value="3">Březen</option>
                <option value="4">Duben</option>
                <option value="5">Květen</option>
                <option value="6">Červen</option>
                <option value="7">Červenec</option>
                <option value="8">Srpen</option>
                <option value="9">Září</option>
                <option value="10">Říjen</option>
                <option value="11">Listopad</option>
                <option value="12">Prosinec</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Účastník</label>
              <select
                value={filterParticipant}
                onChange={(e) => onFilterChange({ participant: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium outline-none"
              >
                <option value="all">Všichni</option>
                {availableParticipants.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Aktivita</label>
              <select
                value={filterActivity}
                onChange={(e) => onFilterChange({ activity: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium outline-none"
              >
                <option value="all">Všechny</option>
                {ACTIVITY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Trips list */}
        <div ref={tripsListContainerRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 relative">
          {filteredTrips.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-dashed border-slate-200">
              Žádné trasy neodpovídají zvoleným filtrům.
            </div>
          ) : (
            filteredTrips.map((trip) => {
              const isSelected = trip.id === selectedTripId;
              const routes = trip.routes || trip.maps || [];
              const effectiveTripDist = getEffectiveHikeDistanceKm(trip);

              return (
                <div
                  key={trip.id}
                  ref={(el) => {
                    tripItemRefs.current[trip.id] = el;
                  }}
                  className={`p-3 rounded-xl border text-xs transition-all space-y-2 ${
                    isSelected
                      ? 'border-rose-400 bg-rose-50/20 shadow-xs ring-1 ring-rose-300'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      onClick={() => {
                        onSelectTrip(trip.id);
                        setRightSidebarOpen(false);
                      }}
                      className="cursor-pointer flex-1 overflow-hidden"
                    >
                      <div
                        className={`font-bold flex items-center gap-1.5 text-[13px] ${
                          isSelected ? 'text-rose-700' : 'text-slate-900 hover:text-emerald-700'
                        }`}
                        title={trip.name}
                      >
                        <ActivityIcon activity={trip.activity} />
                        <span className="truncate">{trip.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          {getDisplayDateRange(trip)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <Route className="w-3 h-3 text-emerald-600" />
                          <span>
                            Celkem: {effectiveTripDist.toFixed(1)} km
                          </span>
                        </span>
                      </div>
                      {trip.participants && (
                        <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-1 truncate">
                          <Users className="w-3 h-3 text-teal-600 shrink-0" />
                          <span className="truncate">{trip.participants}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Route parts */}
                  {routes.length > 0 && (
                    <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                      {routes.map((mapObj, mIdx) => {
                        const hasGeom = Boolean(mapObj.coordinates && mapObj.coordinates.length > 0);
                        const isPartSelected = isSelected && selectedMapIndex === mIdx;
                        const isVisible =
                          mapObj.visible !== false && !hiddenSegments[`${trip.id}_${mIdx}`];
                        const segDist = getSegmentDistanceKm(mapObj, routes.length, trip.distance);

                        return (
                          <div
                            key={mIdx}
                            className={`flex items-center justify-between py-1.5 px-2 rounded-lg border text-xs transition-colors ${
                              isPartSelected
                                ? 'bg-rose-50/80 border-rose-200'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200/60'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 overflow-hidden flex-1 pr-1.5">
                              {hasGeom ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSegmentVisibility(trip.id, mIdx);
                                  }}
                                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                    isVisible
                                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                                      : 'bg-slate-200 hover:bg-slate-300 text-slate-500'
                                  }`}
                                  title={
                                    isVisible
                                      ? 'Skrýt tuto část trasy na mapě'
                                      : 'Zobrazit tuto část trasy na mapě'
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
                                  onSelectTrip(trip.id, mIdx);
                                  setRightSidebarOpen(false);
                                }}
                                className={`font-medium cursor-pointer truncate text-[11px] transition-colors flex items-center gap-1.5 ${
                                  isVisible
                                    ? 'text-slate-700 hover:text-emerald-600'
                                    : 'text-slate-400 line-through'
                                }`}
                                title="Kliknutím zvýrazníte tuto část trasy"
                              >
                                <span>Část {mIdx + 1}</span>
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
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
