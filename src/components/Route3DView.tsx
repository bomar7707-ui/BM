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
} from 'lucide-react';
import { Hike, Coordinate, PlannedRoute, RoutePart } from '../types';
import { calculateDistanceKm, getSegmentDistanceKm } from '../utils/gpxParser';
import { getDisplayDateRange } from '../utils/dateUtils';
import {
  Terrain3DMap,
  Route3DItem,
  BaseMapStyle3D,
  Terrain3DMapHandle,
  FlightTelemetryState,
} from './Terrain3DMap';

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
    slopeCat: 'flat' | 'std' | 'steep' | 'extreme';
    xPct: number;
    yPct: number;
  } | null>(null);

  // 3D Map Controls State (located in the right sidebar)
  const [baseStyle, setBaseStyle] = useState<BaseMapStyle3D>('outdoor');
  const [exaggeration, setExaggeration] = useState<number>(2.0);
  const [flightState, setFlightState] = useState<FlightTelemetryState>({
    isFlying: false,
    isOrbiting: false,
    flyProgress: null,
  });

  const [elevationData, setElevationData] = useState<{
    title: string;
    ascent: number;
    descent: number;
    maxEle: number;
    minEle: number;
    points: {
      dist: number;
      ele: number;
      rawEle: number;
      gradePct: number;
      slopeCat: 'flat' | 'std' | 'steep' | 'extreme';
      coord: [number, number];
    }[];
  } | null>(null);

  const toggleSegmentVisibility = (mapIndex: number) => {
    setHiddenSegments((prev) => ({
      ...prev,
      [mapIndex]: !prev[mapIndex],
    }));
  };

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

  // Build 3D route items for ONLY the selected route
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

  // Compute elevation profile for the selected route / segment
  useEffect(() => {
    if (!activeRouteInfo) {
      setElevationData(null);
      return;
    }

    const routes = activeRouteInfo.routes;
    let coords: Coordinate[] = [];

    if (selectedMapIndex !== null && routes[selectedMapIndex]) {
      if (!hiddenSegments[selectedMapIndex]) {
        coords = routes[selectedMapIndex].coordinates || [];
      }
    } else {
      routes.forEach((m, idx) => {
        if (!hiddenSegments[idx] && m.coordinates) {
          coords = coords.concat(m.coordinates);
        }
      });
    }

    const ptsWithEle = coords.filter((p) => typeof p[2] === 'number' && !isNaN(p[2]));
    if (ptsWithEle.length < 2) {
      setElevationData(null);
      return;
    }

    let totalDist = 0;
    let ascent = 0;
    let descent = 0;
    let maxEle = ptsWithEle[0][2] as number;
    let minEle = ptsWithEle[0][2] as number;
    const rawPoints: { dist: number; ele: number; rawEle: number; coord: [number, number] }[] = [];

    for (let i = 0; i < ptsWithEle.length; i++) {
      const curr = ptsWithEle[i];
      const ele = curr[2] as number;
      if (i > 0) {
        const prev = ptsWithEle[i - 1];
        totalDist += calculateDistanceKm(prev[0], prev[1], curr[0], curr[1]);
        const diff = ele - (prev[2] as number);
        if (diff > 0) ascent += diff;
        else descent += Math.abs(diff);
      }
      if (ele > maxEle) maxEle = ele;
      if (ele < minEle) minEle = ele;

      rawPoints.push({
        dist: totalDist,
        ele: Math.round(ele),
        rawEle: ele,
        coord: [curr[0], curr[1]],
      });
    }

    const points = rawPoints.map((pt, idx) => {
      if (idx === 0) {
        return { ...pt, gradePct: 0, slopeCat: 'flat' as const };
      }
      let startIdx = idx - 1;
      while (startIdx > 0 && pt.dist - rawPoints[startIdx].dist < 0.04) {
        startIdx--;
      }
      const dMeters = (pt.dist - rawPoints[startIdx].dist) * 1000;
      const eleDiff = pt.rawEle - rawPoints[startIdx].rawEle;
      const gradePct = dMeters > 1 ? (eleDiff / dMeters) * 100 : 0;
      const absGrade = Math.abs(gradePct);

      let slopeCat: 'flat' | 'std' | 'steep' | 'extreme' = 'flat';
      if (absGrade >= 20) slopeCat = 'extreme';
      else if (absGrade >= 10) slopeCat = 'steep';
      else if (absGrade >= 5) slopeCat = 'std';

      return {
        ...pt,
        gradePct,
        slopeCat,
      };
    });

    setElevationData({
      title: `${activeRouteInfo.name}${
        selectedMapIndex !== null ? ` (Část ${selectedMapIndex + 1})` : ''
      }`,
      ascent: Math.round(ascent),
      descent: Math.round(descent),
      maxEle: Math.round(maxEle),
      minEle: Math.round(minEle),
      points,
    });
  }, [activeRouteInfo, selectedMapIndex, hiddenSegments]);

  const handleSelectRouteOn3D = useCallback(
    (_tripId: string, mIdx: number) => {
      onSelectSegment?.(mIdx);
    },
    [onSelectSegment]
  );

  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!elevationData || elevationData.points.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));

    const pts = elevationData.points;
    const totalDist = pts[pts.length - 1]?.dist || 1;
    const targetDist = pct * totalDist;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const diff = Math.abs(pts[i].dist - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const point = pts[closestIdx];
    if (!point) return;

    const range = elevationData.maxEle - elevationData.minEle || 1;
    const xPct =
      totalDist > 0 ? (point.dist / totalDist) * 100 : (closestIdx / (pts.length - 1)) * 100;
    const yPct = 92 - ((point.ele - elevationData.minEle) / range) * 84;

    setHoveredPoint({
      dist: point.dist,
      ele: point.ele,
      gradePct: point.gradePct,
      slopeCat: point.slopeCat,
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
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] bg-slate-100 p-6 text-center space-y-4">
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

  // Calculate ascent for planned route card display if needed
  let totalAscentMeters = 0;
  routes.forEach((r) => {
    const c = r.coordinates || [];
    for (let i = 1; i < c.length; i++) {
      const e1 = c[i - 1][2];
      const e2 = c[i][2];
      if (typeof e1 === 'number' && typeof e2 === 'number' && e2 > e1) {
        totalAscentMeters += e2 - e1;
      }
    }
  });

  return (
    <div className="flex w-full h-[calc(100vh-64px)] relative overflow-hidden bg-slate-900">
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
        <div className="md:hidden absolute top-16 right-3 z-[600]">
          <button
            type="button"
            onClick={() => setRightSidebarOpen(true)}
            className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl shadow-xl font-bold text-xs flex items-center gap-1.5 border border-emerald-500"
          >
            <Layers className="w-4 h-4" />
            <span>3D Ovládání & Karta</span>
          </button>
        </div>

        {/* 3D Terrain Map */}
        <Terrain3DMap
          ref={terrainMapRef}
          routes={routes3D}
          selectedCoords={selectedCoords3D}
          hoveredCoord={hoveredCoord}
          hasBottomPanel={Boolean(elevationData)}
          baseStyle={baseStyle}
          exaggeration={exaggeration}
          onSelectRoute={handleSelectRouteOn3D}
          onFlightStateChange={setFlightState}
        />

        {/* Selected Route Floating Bar + Flyover Telemetry Below It (Top Center) */}
        <div className="absolute top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[600] flex flex-col items-center gap-1.5 max-w-[95vw]">
          <div className="bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-xl border border-slate-200 flex items-center gap-2 flex-wrap justify-center">
            {activeRouteInfo.isPlanned && (
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: activeRouteInfo.color }}
              />
            )}
            <div className="font-extrabold text-xs text-stone-900 truncate max-w-[180px] sm:max-w-[260px]">
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
            <div className="bg-slate-900/95 backdrop-blur-md border border-amber-400/70 px-3.5 py-1 rounded-xl shadow-xl text-xs font-extrabold flex items-center gap-3">
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

        {/* Elevation Profile Panel (Bottom - clean, no overlapping buttons!) */}
        {elevationData && (
          <div className="absolute bottom-4 left-3 right-3 md:left-6 md:right-6 z-[500] bg-white/95 backdrop-blur-md rounded-2xl p-3.5 sm:p-4 shadow-2xl border border-slate-200/90 text-xs transition-all select-none">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5 truncate">
                <div className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg shrink-0">
                  <Mountain className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <h4 className="font-bold text-slate-900 truncate text-xs sm:text-sm">
                    Výškový profil: {elevationData.title}
                  </h4>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 flex flex-wrap gap-3 mt-0.5">
                    <span className="text-emerald-700 font-semibold">
                      +{elevationData.ascent} m stoupání
                    </span>
                    <span className="text-rose-600 font-semibold">
                      -{elevationData.descent} m klesání
                    </span>
                    <span>Max: {elevationData.maxEle} m n.m.</span>
                    <span>Min: {elevationData.minEle} m n.m.</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-auto">
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
                </div>

                <button
                  type="button"
                  onClick={() => setElevationData(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  title="Zavřít výškový profil"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {(() => {
              const range = elevationData.maxEle - elevationData.minEle || 1;
              const pts = elevationData.points;
              const totalDist = pts[pts.length - 1]?.dist || 1;

              const SLOPE_COLORS: Record<'flat' | 'std' | 'steep' | 'extreme', string> = {
                flat: '#10b981',
                std: '#3b82f6',
                steep: '#f59e0b',
                extreme: '#e11d48',
              };

              const SLOPE_LABELS: Record<'flat' | 'std' | 'steep' | 'extreme', string> = {
                flat: 'Rovina (< 5 %)',
                std: 'Standard (5–10 %)',
                steep: 'Prudký svah (10–20 %)',
                extreme: 'Extrém (> 20 %)',
              };

              const yTicks = [
                elevationData.maxEle,
                Math.round(elevationData.minEle + range * 0.66),
                Math.round(elevationData.minEle + range * 0.33),
                elevationData.minEle,
              ];

              const xTickCount = 6;
              const xTicks = Array.from({ length: xTickCount }, (_, idx) =>
                ((totalDist * idx) / (xTickCount - 1)).toFixed(1)
              );

              const coordsXY = pts.map((p, i) => {
                const x =
                  totalDist > 0
                    ? (p.dist / totalDist) * 1000
                    : (i / Math.max(1, pts.length - 1)) * 1000;
                const y = 92 - ((p.ele - elevationData.minEle) / range) * 84;
                return { x, y, slopeCat: p.slopeCat };
              });

              const runs: {
                cat: 'flat' | 'std' | 'steep' | 'extreme';
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
                <div className="space-y-1">
                  <div className="flex items-stretch h-28 sm:h-36 w-full">
                    <div className="w-12 pr-2 flex flex-col justify-between text-[10px] font-medium text-slate-400 text-right py-1 shrink-0">
                      {yTicks.map((val, i) => (
                        <span key={i} className="leading-none">
                          {val} m
                        </span>
                      ))}
                    </div>

                    <div
                      className="flex-1 relative cursor-crosshair bg-slate-50/40 rounded-lg border border-slate-200/70 overflow-hidden"
                      onMouseMove={handleChartMouseMove}
                      onMouseLeave={handleChartMouseLeave}
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
                              strokeWidth="2.5"
                              vectorEffect="non-scaling-stroke"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                            />
                          );
                        })}
                      </svg>

                      {hoveredPoint && (
                        <>
                          <div
                            className="absolute top-0 bottom-0 w-px bg-slate-700/50 pointer-events-none"
                            style={{ left: `${hoveredPoint.xPct}%` }}
                          />
                          <div
                            className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-md pointer-events-none"
                            style={{
                              left: `${hoveredPoint.xPct}%`,
                              top: `${hoveredPoint.yPct}%`,
                              backgroundColor: SLOPE_COLORS[hoveredPoint.slopeCat],
                            }}
                          />
                          <div
                            className="absolute top-2 z-20 bg-slate-900/95 text-white px-2.5 py-1.5 rounded-lg shadow-lg text-[10px] pointer-events-none whitespace-nowrap space-y-0.5"
                            style={{
                              left:
                                hoveredPoint.xPct > 65
                                  ? `calc(${hoveredPoint.xPct}% - 150px)`
                                  : `calc(${hoveredPoint.xPct}% + 10px)`,
                            }}
                          >
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
                          </div>
                        </>
                      )}
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

          {/* Base Map Switcher */}
          <div className="grid grid-cols-3 gap-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700/80 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setBaseStyle('outdoor')}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                baseStyle === 'outdoor'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
            >
              Turistická
            </button>
            <button
              type="button"
              onClick={() => setBaseStyle('satellite')}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                baseStyle === 'satellite'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
            >
              Satelitní 3D
            </button>
            <button
              type="button"
              onClick={() => setBaseStyle('topo')}
              className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer text-center ${
                baseStyle === 'topo'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
            >
              OpenTopo
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
            onClick={onBackTo2D}
            className="text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Vrátit se zpět do 2D s vybranou trasou"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Přepnout do 2D</span>
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
                          onClick={() =>
                            onSelectSegment?.(selectedMapIndex === mIdx ? null : mIdx)
                          }
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
        </div>

        {/* 3. DOLNÍ OVLÁDACÍ PRVKY 3D (ve spodní části pravého panelu - obr. 3) */}
        <div className="mt-auto p-3.5 bg-slate-900 text-white border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Mountain className="w-3.5 h-3.5" />
              <span>Ovládání 3D pohledu</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Vycentrovat 3D (swapped to top full-width & larger) */}
            <button
              type="button"
              onClick={() => terrainMapRef.current?.focusRoute()}
              className="col-span-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 py-3 px-4 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm"
              title="Vycentrovat trasu do 3D pohledu"
            >
              <Maximize2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Vycentrovat 3D</span>
            </button>

            {/* 360° oblet (larger) */}
            <button
              type="button"
              onClick={() => terrainMapRef.current?.toggleOrbit()}
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
              onClick={() => terrainMapRef.current?.toggleFlyover()}
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
              <span>{flightState.isFlying ? 'Zastavit přelet' : '3D přelet trasy'}</span>
            </button>

            {/* Naklopit / Shora */}
            <button
              type="button"
              onClick={() => terrainMapRef.current?.adjustPitch(12)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              title="Více naklopit kameru k horizontu"
            >
              <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
              <span>Naklopit</span>
            </button>

            <button
              type="button"
              onClick={() => terrainMapRef.current?.adjustPitch(-12)}
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
