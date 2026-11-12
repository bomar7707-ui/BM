import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import {
  Layers,
  Eye,
  EyeOff,
  Minus,
  RotateCcw,
  Mountain,
  TrendingUp,
  TrendingDown,
  Compass,
  X,
  ExternalLink,
  MapPin,
  Menu,
  Route,
  FileUp,
  Check,
  Plus,
  Pencil,
  Trash2,
  Link as LinkIcon,
  FileText,
} from 'lucide-react';
import { PlannedRoute, Coordinate, RoutePart } from '../types';
import { calculateDistanceKm, parseGpxXml } from '../utils/gpxParser';

interface PlannedRoutesViewProps {
  plannedRoutes: PlannedRoute[];
  onSavePlannedRoute: (
    data: {
      name: string;
      distance: number;
      link?: string;
      note?: string;
      color?: string;
      routes: RoutePart[];
    },
    editingId?: string
  ) => Promise<string>;
  onDeletePlannedRoute: (id: string) => void;
}

const MAPY_CZ_API_KEY = '3SfstVBaZryBHeEkOsw_DSAc8PwcV140TQvNslWDrQY';

// High-contrast distinct colors so every planned route stands out clearly on the map
export const DISTINCT_ROUTE_COLORS = [
  '#2563eb', // modrá
  '#d97706', // jantarová
  '#7c3aed', // fialová
  '#059669', // smaragdová
  '#db2777', // purpurová
  '#0891b2', // azurová
  '#ea580c', // oranžová
  '#4f46e5', // indigová
  '#65a30d', // limetková
  '#9333ea', // ametystová
  '#0d9488', // tyrkysová
  '#ca8a04', // zlatá
];

export const PlannedRoutesView: React.FC<PlannedRoutesViewProps> = ({
  plannedRoutes,
  onSavePlannedRoute,
  onDeletePlannedRoute,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const polylinesLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const hoverMarkerRef = useRef<L.Marker | null>(null);
  const routesListContainerRef = useRef<HTMLDivElement>(null);
  const routeItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gpxFileInputRef = useRef<HTMLInputElement>(null);

  // Mobile drawer states
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // Selected planned route on map / list
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Hidden planned routes by id
  const [hiddenRoutes, setHiddenRoutes] = useState<Record<string, boolean>>({});

  // Simplified journal form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mapLink, setMapLink] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [note, setNote] = useState('');
  const [gpxData, setGpxData] = useState<string | null>(null);
  const [gpxName, setGpxName] = useState<string>('');
  const [gpxCoords, setGpxCoords] = useState<Coordinate[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Assign a deterministic distinct color to each planned route
  const routeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    plannedRoutes.forEach((r, idx) => {
      map[r.id] = r.color || DISTINCT_ROUTE_COLORS[idx % DISTINCT_ROUTE_COLORS.length];
    });
    return map;
  }, [plannedRoutes]);

  const toggleRouteVisibility = (id: string) => {
    setHiddenRoutes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Extract coordinates for a planned route
  const getRouteCoordinates = (route: PlannedRoute): Coordinate[] => {
    if (route.routes && route.routes.length > 0) {
      const merged: Coordinate[] = [];
      route.routes.forEach((part) => {
        if (part.coordinates && part.coordinates.length > 0) {
          merged.push(...part.coordinates);
        }
      });
      if (merged.length > 0) return merged;
    }
    return route.coordinates || [];
  };

  // Populate form when editing a planned route
  const handleStartEdit = (route: PlannedRoute) => {
    setEditingId(route.id);
    setName(route.name);
    const firstPart = route.routes?.[0];
    setMapLink(route.link || firstPart?.link || firstPart?.url || '');
    setDistanceInput(String(route.distance || ''));
    setNote(route.note || '');
    setGpxData(route.gpxData || firstPart?.gpxData || null);
    setGpxName(
      route.gpxName ||
        firstPart?.gpxName ||
        (getRouteCoordinates(route).length > 0 ? 'Uložená GPX trasa' : '')
    );
    setGpxCoords(getRouteCoordinates(route));
    setFormError(null);
    setLeftSidebarOpen(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setMapLink('');
    setDistanceInput('');
    setNote('');
    setGpxData(null);
    setGpxName('');
    setGpxCoords([]);
    setFormError(null);
  };

  // Handle GPX file upload in simplified journal
  const handleGpxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const xmlString = event.target?.result as string;
      const coords = parseGpxXml(xmlString);
      if (!coords || coords.length === 0) {
        setFormError('Vybraný GPX soubor neobsahuje žádné souřadnice trasy.');
        return;
      }

      let distKm = 0;
      for (let i = 1; i < coords.length; i++) {
        distKm += calculateDistanceKm(
          coords[i - 1][0],
          coords[i - 1][1],
          coords[i][0],
          coords[i][1]
        );
      }

      setGpxData(xmlString);
      setGpxName(file.name);
      setGpxCoords(coords);
      setDistanceInput((Math.round(distKm * 10) / 10).toFixed(1));
      setFormError(null);

      // Auto-fill route name from GPX metadata or filename if currently empty
      if (!name.trim()) {
        let extractedName = file.name.replace(/\.gpx$/i, '');
        try {
          const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');
          const nameEl = xmlDoc.querySelector('trk > name, metadata > name, name');
          if (nameEl?.textContent?.trim()) {
            extractedName = nameEl.textContent.trim();
          }
        } catch {
          // ignore
        }
        setName(extractedName);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Handle saving the planned route
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const finalName =
      name.trim() ||
      (gpxName ? gpxName.replace(/\.gpx$/i, '') : '') ||
      `Plánovaná trasa ${plannedRoutes.length + 1}`;

    if (!mapLink.trim() && gpxCoords.length === 0 && !gpxData) {
      setFormError('Zadejte alespoň odkaz na mapu nebo nahrajte GPX soubor.');
      return;
    }

    const parsedDist = parseFloat(distanceInput.replace(',', '.'));
    const finalDist = !isNaN(parsedDist) && parsedDist > 0 ? Math.round(parsedDist * 10) / 10 : 0;

    const routePart: RoutePart = {
      distance: finalDist,
      link: mapLink.trim(),
      url: mapLink.trim(),
      gpxData: gpxData,
      gpxName: gpxName,
      hasGpx: gpxCoords.length > 0 || !!gpxData,
      coordinates: gpxCoords,
      visible: true,
    };

    // Automatically choose a distinct color (preserve when editing, or pick first unused color)
    const usedColors = new Set(plannedRoutes.map((r) => routeColorMap[r.id]));
    const firstUnusedColor = DISTINCT_ROUTE_COLORS.find((c) => !usedColors.has(c));
    const autoColor = editingId
      ? routeColorMap[editingId] || DISTINCT_ROUTE_COLORS[0]
      : firstUnusedColor ||
        DISTINCT_ROUTE_COLORS[plannedRoutes.length % DISTINCT_ROUTE_COLORS.length];

    setIsSaving(true);
    try {
      const savedId = await onSavePlannedRoute(
        {
          name: finalName,
          distance: finalDist,
          link: mapLink.trim(),
          note: note.trim(),
          color: autoColor,
          routes: [routePart],
        },
        editingId || undefined
      );
      resetForm();
      if (savedId) {
        setSelectedRouteId(savedId);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Overall stats for planned routes
  const stats = useMemo(() => {
    let totalKm = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    plannedRoutes.forEach((route) => {
      const distNum =
        typeof route.distance === 'string' ? parseFloat(route.distance) : route.distance;
      if (!isNaN(distNum)) totalKm += distNum;

      const coords = getRouteCoordinates(route);
      let prevEle: number | null = null;
      coords.forEach((pt) => {
        const ele = pt[2];
        if (typeof ele === 'number' && !isNaN(ele)) {
          if (prevEle !== null) {
            const diff = ele - prevEle;
            if (diff > 0) totalAscent += diff;
            else totalDescent += Math.abs(diff);
          }
          prevEle = ele;
        }
      });
    });

    return {
      count: plannedRoutes.length,
      totalDistance: totalKm,
      totalAscent: Math.round(totalAscent),
      totalDescent: Math.round(totalDescent),
    };
  }, [plannedRoutes]);

  // Selected planned route object
  const selectedRoute = useMemo(() => {
    if (!selectedRouteId) return null;
    return plannedRoutes.find((r) => r.id === selectedRouteId) || null;
  }, [plannedRoutes, selectedRouteId]);

  // Auto-scroll selected planned route into view in the right sidebar list
  useEffect(() => {
    if (!selectedRouteId) return;
    const container = routesListContainerRef.current;
    const itemEl = routeItemRefs.current[selectedRouteId];
    if (container && itemEl) {
      const targetTop = Math.max(0, itemEl.offsetTop - container.offsetTop - 12);
      container.scrollTo({
        top: targetTop,
        behavior: 'smooth',
      });
    }
  }, [selectedRouteId]);

  // Elevation profile state
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

  const [hoveredPoint, setHoveredPoint] = useState<{
    dist: number;
    ele: number;
    gradePct: number;
    slopeCat: 'flat' | 'std' | 'steep' | 'extreme';
    xPct: number;
    yPct: number;
  } | null>(null);

  // Initialize Leaflet Map (same foundation as MapView)
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [49.7422, 15.3366],
      zoom: 7,
      zoomControl: false,
    });

    map.createPane('selectedTripPane');
    const selectedPane = map.getPane('selectedTripPane');
    if (selectedPane) {
      selectedPane.style.zIndex = '650';
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const mapyOutdoor = L.tileLayer(
      `https://api.mapy.cz/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_CZ_API_KEY}`,
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

    mapyOutdoor.addTo(map);
    L.control
      .layers(
        { 'Mapy.cz Outdoor': mapyOutdoor, OpenTopoMap: openTopo },
        undefined,
        { position: 'topleft' }
      )
      .addTo(map);

    polylinesLayerRef.current.addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Compute elevation profile when selectedRoute changes
  useEffect(() => {
    if (!selectedRoute || hiddenRoutes[selectedRoute.id]) {
      setElevationData(null);
      if (hoverMarkerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(hoverMarkerRef.current);
        hoverMarkerRef.current = null;
      }
      return;
    }

    const coords = getRouteCoordinates(selectedRoute);
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
      title: selectedRoute.name,
      ascent: Math.round(ascent),
      descent: Math.round(descent),
      maxEle: Math.round(maxEle),
      minEle: Math.round(minEle),
      points,
    });
  }, [selectedRoute, hiddenRoutes]);

  // Render Planned Routes Polylines on Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    polylinesLayerRef.current.clearLayers();
    const bounds = L.latLngBounds([]);
    let hasCoords = false;

    const unselectedLines: { layer: L.Polyline; shadow: L.Polyline }[] = [];
    const selectedLines: { layer: L.Polyline; shadow: L.Polyline }[] = [];

    plannedRoutes.forEach((route, idx) => {
      if (hiddenRoutes[route.id]) return;
      const coords = getRouteCoordinates(route);
      if (!coords || coords.length === 0) return;

      hasCoords = true;
      const isSelected = route.id === selectedRouteId;
      const baseColor =
        routeColorMap[route.id] || DISTINCT_ROUTE_COLORS[idx % DISTINCT_ROUTE_COLORS.length];

      const lineColor = isSelected ? '#e11d48' : baseColor;
      const shadowColor = isSelected ? '#881337' : '#ffffff';
      const shadowOpacity = isSelected ? 0.95 : 0.85;
      const weight = isSelected ? 8 : 5.5;
      const opacity = isSelected ? 1.0 : 0.95;

      const latLngs = coords.map((pt) => [pt[0], pt[1]] as [number, number]);

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

      mainLine.bindPopup(
        `<b>${route.name}</b><br>Plánovaná délka: ${route.distance || '-'} km${
          route.note ? `<br><span style="color:#64748b">${route.note}</span>` : ''
        }`
      );

      mainLine.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedRouteId(route.id);
      });

      mainLine.on('mouseover', function (this: L.Polyline) {
        if (!isSelected) {
          this.setStyle({ weight: 8, opacity: 1 });
          shadowLine.setStyle({ weight: 11, opacity: 1 });
        }
      });

      mainLine.on('mouseout', function (this: L.Polyline) {
        if (!isSelected) {
          this.setStyle({ weight: 5.5, opacity: 0.95 });
          shadowLine.setStyle({ weight: 8.5, opacity: 0.85 });
        }
      });

      if (isSelected) {
        selectedLines.push({ layer: mainLine, shadow: shadowLine });
        mainLine.getLatLngs().forEach((ll) => bounds.extend(ll as L.LatLng));
      } else {
        unselectedLines.push({ layer: mainLine, shadow: shadowLine });
        if (!selectedRouteId) {
          mainLine.getLatLngs().forEach((ll) => bounds.extend(ll as L.LatLng));
        }
      }
    });

    unselectedLines.forEach((item) => {
      polylinesLayerRef.current.addLayer(item.shadow);
      polylinesLayerRef.current.addLayer(item.layer);
    });

    selectedLines.forEach((item) => {
      polylinesLayerRef.current.addLayer(item.shadow);
      polylinesLayerRef.current.addLayer(item.layer);
      item.shadow.bringToFront();
      item.layer.bringToFront();
      setTimeout(() => item.layer.openPopup(), 100);
    });

    if (hasCoords && bounds.isValid()) {
      map.fitBounds(bounds, {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [40, selectedRouteId ? 190 : 40],
        maxZoom: 15,
      });
    }
  }, [plannedRoutes, selectedRouteId, hiddenRoutes, routeColorMap]);

  // Elevation Profile Chart Hover Handler
  const handleChartMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!elevationData || !mapInstanceRef.current || elevationData.points.length === 0) return;

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

    const coord = point.coord;

    if (!hoverMarkerRef.current) {
      hoverMarkerRef.current = L.marker(coord, {
        icon: L.divIcon({ className: 'elevation-marker', iconSize: [16, 16] }),
        pane: 'selectedTripPane',
      }).addTo(mapInstanceRef.current);
    } else {
      hoverMarkerRef.current.setLatLng(coord);
    }
  };

  const handleChartMouseLeave = () => {
    setHoveredPoint(null);
    if (hoverMarkerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }
  };

  return (
    <div className="flex w-full h-[calc(100vh-64px)] relative overflow-hidden bg-slate-100">
      {/* Mobile Backdrop */}
      {(leftSidebarOpen || rightSidebarOpen) && (
        <div
          onClick={() => {
            setLeftSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
          className="fixed inset-0 bg-slate-900/40 z-[900] backdrop-blur-xs md:hidden"
        />
      )}

      {/* LEFT SIDEBAR: Simplified Journal (Zjednodušený zápisník) + Summary */}
      <aside
        className={`absolute md:relative z-[950] md:z-20 w-[300px] sm:w-[310px] bg-white border-r border-slate-200 flex flex-col h-full shadow-2xl md:shadow-none transition-transform duration-300 ${
          leftSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-teal-600 to-emerald-700 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
                <Compass className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-sm tracking-tight">Plánované trasy</h2>
                <p className="text-[10px] text-emerald-100">Zjednodušený zápisník a mapa</p>
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
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {/* Simplified Form */}
          <form
            onSubmit={handleSubmit}
            className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-3.5 space-y-3 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                {editingId ? (
                  <>
                    <Pencil className="w-3.5 h-3.5 text-amber-600" />
                    <span>Upravit plánovanou trasu</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Nová plánovaná trasa</span>
                  </>
                )}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[10px] font-bold text-rose-600 hover:text-rose-700 underline cursor-pointer"
                >
                  Zrušit
                </button>
              )}
            </div>

            {formError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-medium px-2.5 py-2 rounded-xl">
                {formError}
              </div>
            )}

            {/* Route Name */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Název trasy (nepovinné u GPX)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="např. Přechod Jeseníků..."
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            {/* Map Link */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Odkaz na mapu (Mapy.cz / Mapy.com)
              </label>
              <div className="relative">
                <LinkIcon className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={mapLink}
                  onChange={(e) => setMapLink(e.target.value)}
                  placeholder="https://mapy.com/s/..."
                  className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* GPX File Upload & Distance side-by-side */}
            <div className="grid grid-cols-[1fr_90px] gap-2 items-end">
              <div className="min-w-0">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 truncate">
                  GPX soubor trasy
                </label>
                <input
                  ref={gpxFileInputRef}
                  type="file"
                  accept=".gpx"
                  onChange={handleGpxUpload}
                  className="hidden"
                />

                {gpxCoords.length > 0 ? (
                  <div className="h-9 flex items-center justify-between bg-emerald-50/90 border border-emerald-200 rounded-xl px-2 text-xs">
                    <div className="flex items-center gap-1 text-emerald-800 font-semibold truncate pr-1">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate text-[11px]" title={gpxName}>
                        {gpxName || 'GPX načteno'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => gpxFileInputRef.current?.click()}
                        className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 bg-white px-1.5 py-0.5 rounded border border-emerald-200 cursor-pointer"
                      >
                        Změnit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGpxData(null);
                          setGpxName('');
                          setGpxCoords([]);
                        }}
                        className="text-rose-600 hover:text-rose-800 p-0.5 cursor-pointer"
                        title="Odebrat GPX"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => gpxFileInputRef.current?.click()}
                    className="h-9 w-full bg-white hover:bg-emerald-50/60 border border-dashed border-emerald-300 text-emerald-700 rounded-xl px-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer truncate"
                  >
                    <FileUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">Nahrát GPX</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Délka (km)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={distanceInput}
                  onChange={(e) => setDistanceInput(e.target.value)}
                  placeholder="0.0"
                  className="h-9 w-full bg-white border border-slate-200 rounded-xl px-2.5 text-xs text-slate-800 font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Larger Note Field */}
            <div>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                <FileText className="w-3 h-3 text-slate-400" />
                <span>Poznámka</span>
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Chata, parkování, zajímavosti po cestě..."
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-medium outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y"
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2.5 px-3 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>
                {isSaving
                  ? 'Ukládám...'
                  : editingId
                  ? 'Uložit změny trasy'
                  : 'Přidat do plánovaných tras'}
              </span>
            </button>
          </form>

          {/* Statistics Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
              <span>Souhrn plánů</span>
              <Mountain className="w-3.5 h-3.5 text-emerald-600" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Plánované trasy</span>
                <div className="text-base font-bold text-slate-900 mt-0.5">{stats.count}</div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Celková délka</span>
                <div className="text-base font-bold text-emerald-600 mt-0.5">
                  {stats.totalDistance.toFixed(1)} km
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Nastoupáno</span>
                <div className="text-sm font-bold text-rose-600 mt-0.5 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{stats.totalAscent.toLocaleString('cs-CZ')} m</span>
                </div>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-2xs">
                <span className="text-[10px] text-slate-500 block font-medium">Sestoupáno</span>
                <div className="text-sm font-bold text-sky-600 mt-0.5 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>{stats.totalDescent.toLocaleString('cs-CZ')} m</span>
                </div>
              </div>
            </div>
          </div>

          {/* Small Logo & Motto */}
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
        {/* Mobile Toggle Floating Buttons */}
        <div className="md:hidden absolute top-3 left-3 z-[400] flex gap-2">
          <button
            onClick={() => setLeftSidebarOpen(true)}
            className="bg-white/95 backdrop-blur-md px-3 h-10 flex items-center gap-1.5 rounded-xl shadow-lg border border-slate-200 text-slate-700 hover:text-emerald-600 text-xs font-bold"
          >
            <Menu className="w-4 h-4" />
            <span>Nová trasa</span>
          </button>
        </div>

        <div className="md:hidden absolute bottom-24 left-1/2 -translate-x-1/2 z-[400]">
          <button
            onClick={() => setRightSidebarOpen(true)}
            className="bg-emerald-600 text-white px-5 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 border border-emerald-500"
          >
            <Layers className="w-4 h-4" />
            <span>Plánované trasy ({plannedRoutes.length})</span>
          </button>
        </div>

        {/* Leaflet Map Div */}
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Selected Planned Route Floating Bar (Top Center) */}
        {selectedRoute && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[600] bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-xl border border-slate-200 flex items-center gap-2 flex-wrap justify-center max-w-[95vw]">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: routeColorMap[selectedRoute.id] || '#2563eb' }}
            />
            <div className="font-extrabold text-xs text-stone-900 truncate max-w-[180px] sm:max-w-[260px]">
              {selectedRoute.name}
            </div>

            <div className="flex items-center gap-1.5">
              {(selectedRoute.link || selectedRoute.routes?.[0]?.link) && (
                <a
                  href={
                    (selectedRoute.link || selectedRoute.routes?.[0]?.link)!.startsWith('http')
                      ? selectedRoute.link || selectedRoute.routes?.[0]?.link
                      : `https://${selectedRoute.link || selectedRoute.routes?.[0]?.link}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Mapa</span>
                </a>
              )}

              <button
                onClick={() => handleStartEdit(selectedRoute)}
                className="bg-white hover:bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                <span>Upravit</span>
              </button>

              <button
                onClick={() => setSelectedRouteId(null)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                title="Zrušit výběr"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Elevation Profile Panel (Bottom) */}
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
                  onClick={() => setElevationData(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
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
                          <linearGradient id="planEleGrad-flat" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
                          </linearGradient>
                          <linearGradient id="planEleGrad-std" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
                          </linearGradient>
                          <linearGradient id="planEleGrad-steep" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.50" />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.06" />
                          </linearGradient>
                          <linearGradient id="planEleGrad-extreme" x1="0%" y1="0%" x2="0%" y2="100%">
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
                              fill={`url(#planEleGrad-${run.cat})`}
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

      {/* RIGHT SIDEBAR: Planned Routes List */}
      <aside
        className={`absolute md:relative right-0 z-[950] md:z-20 w-[320px] sm:w-[350px] bg-white border-l border-slate-200 flex flex-col h-full shadow-2xl md:shadow-none transition-transform duration-300 ${
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
              Plánované trasy ({plannedRoutes.length})
            </h3>
          </div>

          {selectedRouteId && (
            <button
              onClick={() => setSelectedRouteId(null)}
              className="text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Zrušit výběr</span>
            </button>
          )}
        </div>

        {/* Planned Routes List */}
        <div
          ref={routesListContainerRef}
          className="flex-1 overflow-y-auto p-3 space-y-2.5 relative"
        >
          {plannedRoutes.length === 0 ? (
            <div className="text-center py-8 px-4 text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-1">
              <p className="font-semibold text-slate-500 not-italic">Zatím žádné plánované trasy</p>
              <p>Vložte vlevo odkaz na mapu nebo nahrajte GPX soubor pro naplánování výšlapu.</p>
            </div>
          ) : (
            plannedRoutes.map((route, idx) => {
              const isSelected = route.id === selectedRouteId;
              const isVisible = !hiddenRoutes[route.id];
              const coords = getRouteCoordinates(route);
              const hasGeom = coords.length > 0;
              const color =
                routeColorMap[route.id] ||
                DISTINCT_ROUTE_COLORS[idx % DISTINCT_ROUTE_COLORS.length];
              const mapUrl = route.link || route.routes?.[0]?.link || route.routes?.[0]?.url || '';

              // Calculate ascent if coordinates have elevation
              let routeAscent = 0;
              for (let i = 1; i < coords.length; i++) {
                const e1 = coords[i - 1][2];
                const e2 = coords[i][2];
                if (typeof e1 === 'number' && typeof e2 === 'number' && e2 > e1) {
                  routeAscent += e2 - e1;
                }
              }

              return (
                <div
                  key={route.id}
                  ref={(el) => {
                    routeItemRefs.current[route.id] = el;
                  }}
                  className={`p-3 rounded-xl border text-xs transition-all space-y-2 ${
                    isSelected
                      ? 'border-rose-400 bg-rose-50/25 shadow-xs ring-1 ring-rose-300'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 overflow-hidden">
                      {/* Visibility Toggle Button */}
                      {hasGeom ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRouteVisibility(route.id);
                          }}
                          className={`w-6 h-6 mt-0.5 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            isVisible
                              ? 'text-white shadow-2xs'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-500'
                          }`}
                          style={isVisible ? { backgroundColor: color } : undefined}
                          title={
                            isVisible
                              ? 'Skrýt tuto plánovanou trasu na mapě'
                              : 'Zobrazit tuto plánovanou trasu na mapě'
                          }
                        >
                          {isVisible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span
                          className="w-6 h-6 mt-0.5 rounded-lg flex items-center justify-center shrink-0 text-white"
                          style={{ backgroundColor: color }}
                          title="Pouze odkaz na mapu (bez GPX)"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </span>
                      )}

                      {/* Title & Metrics */}
                      <div
                        onClick={() => setSelectedRouteId(isSelected ? null : route.id)}
                        className="cursor-pointer flex-1 overflow-hidden"
                      >
                        <div
                          className={`font-bold truncate text-[13px] flex items-center gap-1.5 ${
                            isSelected ? 'text-rose-700' : 'text-slate-900 hover:text-emerald-700'
                          } ${!isVisible ? 'line-through text-slate-400' : ''}`}
                          title={route.name}
                        >
                          <span className="truncate">{route.name}</span>
                        </div>

                        <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <Route className="w-3 h-3 text-emerald-600" />
                            <span>{route.distance || '0.0'} km</span>
                          </span>
                          {routeAscent > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold">
                              <TrendingUp className="w-3 h-3" />
                              <span>+{Math.round(routeAscent)} m</span>
                            </span>
                          )}
                        </div>

                        {route.note && (
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 italic">
                            {route.note}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action Icon Buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      {mapUrl && (
                        <a
                          href={mapUrl.startsWith('http') ? mapUrl : `https://${mapUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:text-emerald-800 p-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 rounded-md transition-colors flex items-center justify-center"
                          title="Otevřít odkaz na mapu"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEdit(route)}
                        className="text-amber-700 hover:text-amber-800 p-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="Upravit plánovanou trasu"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeletePlannedRoute(route.id)}
                        className="text-rose-700 hover:text-rose-800 p-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="Smazat plánovanou trasu"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
