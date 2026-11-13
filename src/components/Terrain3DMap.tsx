import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Coordinate } from '../types';
import { calculateDistanceKm } from '../utils/gpxParser';

if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(new URL(maplibreWorkerUrl, window.location.href).href);
}

export interface Route3DItem {
  id: string;
  tripId: string;
  mapIndex: number;
  name: string;
  date?: string;
  distanceLabel?: string;
  color: string;
  isSelected: boolean;
  coordinates: Coordinate[];
}

export type BaseMapStyle3D = 'outdoor' | 'satellite' | 'topo';

export interface FlightTelemetryState {
  isFlying: boolean;
  isOrbiting: boolean;
  flyProgress: {
    distKm: number;
    eleM: number | null;
    pct: number;
  } | null;
}

export interface Terrain3DMapHandle {
  toggleFlyover: () => void;
  toggleOrbit: () => void;
  focusRoute: () => void;
  adjustPitch: (delta: number) => void;
}

interface Terrain3DMapProps {
  routes: Route3DItem[];
  selectedCoords: Coordinate[];
  hoveredCoord?: [number, number] | null;
  hasBottomPanel?: boolean;
  baseStyle: BaseMapStyle3D;
  exaggeration: number;
  onSelectRoute?: (tripId: string, mapIndex: number) => void;
  onFlightStateChange?: (state: FlightTelemetryState) => void;
}

const MAPY_CZ_API_KEY = '3SfstVBaZryBHeEkOsw_DSAc8PwcV140TQvNslWDrQY';

// Calculate geographic bearing between two [lat, lon] points in degrees
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const Terrain3DMap = forwardRef<Terrain3DMapHandle, Terrain3DMapProps>(
  (
    {
      routes,
      selectedCoords,
      hoveredCoord,
      hasBottomPanel = false,
      baseStyle,
      exaggeration,
      onSelectRoute,
      onFlightStateChange,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const hoverMarkerRef = useRef<maplibregl.Marker | null>(null);
    const flyMarkerRef = useRef<maplibregl.Marker | null>(null);
    const routeMarkersRef = useRef<maplibregl.Marker[]>([]);
    const animFrameRef = useRef<number | null>(null);
    const orbitFrameRef = useRef<number | null>(null);

    // Keep latest callbacks/props in refs so map initialization never re-runs on parent re-render
    const onSelectRouteRef = useRef(onSelectRoute);
    onSelectRouteRef.current = onSelectRoute;

    const onFlightStateChangeRef = useRef(onFlightStateChange);
    onFlightStateChangeRef.current = onFlightStateChange;

    const hasBottomPanelRef = useRef(hasBottomPanel);
    hasBottomPanelRef.current = hasBottomPanel;

    const selectedCoordsRef = useRef(selectedCoords);
    selectedCoordsRef.current = selectedCoords;

    const routesRef = useRef(routes);
    routesRef.current = routes;

    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const isFlyingRef = useRef(false);
    const isOrbitingRef = useRef(false);

    const emitFlightState = useCallback(
      (
        flying: boolean,
        orbiting: boolean,
        progress: { distKm: number; eleM: number | null; pct: number } | null
      ) => {
        isFlyingRef.current = flying;
        isOrbitingRef.current = orbiting;
        onFlightStateChangeRef.current?.({
          isFlying: flying,
          isOrbiting: orbiting,
          flyProgress: progress,
        });
      },
      []
    );

    // Stop any active flyover or orbit animation
    const stopAnimations = useCallback(() => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (orbitFrameRef.current) {
        cancelAnimationFrame(orbitFrameRef.current);
        orbitFrameRef.current = null;
      }
      if (flyMarkerRef.current) {
        flyMarkerRef.current.remove();
        flyMarkerRef.current = null;
      }
      emitFlightState(false, false, null);
    }, [emitFlightState]);

    // Initialize MapLibre 3D Map ONCE on mount
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        center: [15.3366, 49.7422],
        zoom: 7.5,
        pitch: 60,
        bearing: -15,
        maxPitch: 82,
        style: {
          version: 8,
          sky: {
            'sky-color': '#bae6fd',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#f0f9ff',
            'horizon-fog-blend': 0.5,
            'fog-color': '#f8fafc',
            'fog-ground-blend': 0.3,
          },
          sources: {
            'terrain-dem': {
              type: 'raster-dem',
              tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 15,
            },
            'hillshade-dem': {
              type: 'raster-dem',
              tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 15,
            },
            'mapy-outdoor': {
              type: 'raster',
              tiles: [
                `https://api.mapy.cz/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_CZ_API_KEY}`,
              ],
              tileSize: 256,
              maxzoom: 19,
              attribution: '&copy; Seznam.cz a.s., Mapy.cz | 3D DEM AWS Terrarium',
            },
            'esri-satellite': {
              type: 'raster',
              tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              ],
              tileSize: 256,
              maxzoom: 18,
              attribution: '&copy; Esri World Imagery',
            },
            opentopomap: {
              type: 'raster',
              tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              maxzoom: 17,
              attribution: '&copy; OpenTopoMap',
            },
            'routes-unselected': {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            },
            'routes-selected': {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            },
          },
          layers: [
            {
              id: 'layer-outdoor',
              type: 'raster',
              source: 'mapy-outdoor',
              layout: { visibility: 'visible' },
            },
            {
              id: 'layer-satellite',
              type: 'raster',
              source: 'esri-satellite',
              layout: { visibility: 'none' },
            },
            {
              id: 'layer-topo',
              type: 'raster',
              source: 'opentopomap',
              layout: { visibility: 'none' },
            },
            {
              id: 'layer-hillshade',
              type: 'hillshade',
              source: 'hillshade-dem',
              paint: {
                'hillshade-exaggeration': 0.35,
                'hillshade-shadow-color': '#0f172a',
                'hillshade-highlight-color': '#ffffff',
                'hillshade-accent-color': '#334155',
              },
            },
            // Unselected routes casing
            {
              id: 'routes-unselected-casing',
              type: 'line',
              source: 'routes-unselected',
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': '#ffffff',
                'line-width': 7,
                'line-opacity': 0.8,
              },
            },
            // Unselected routes main line
            {
              id: 'routes-unselected-line',
              type: 'line',
              source: 'routes-unselected',
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': ['get', 'color'],
                'line-width': 4.5,
                'line-opacity': 0.92,
              },
            },
            // Selected route outer glow
            {
              id: 'routes-selected-glow',
              type: 'line',
              source: 'routes-selected',
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': '#ffffff',
                'line-width': 13,
                'line-opacity': 0.9,
              },
            },
            // Selected route dark border
            {
              id: 'routes-selected-casing',
              type: 'line',
              source: 'routes-selected',
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': '#881337',
                'line-width': 9.5,
                'line-opacity': 0.95,
              },
            },
            // Selected route vivid core
            {
              id: 'routes-selected-line',
              type: 'line',
              source: 'routes-selected',
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
              },
              paint: {
                'line-color': '#e11d48',
                'line-width': 6,
                'line-opacity': 1,
              },
            },
          ],
          terrain: {
            source: 'terrain-dem',
            exaggeration: 2.0,
          },
        },
      });

      map.addControl(
        new maplibregl.NavigationControl({
          visualizePitch: true,
          showCompass: true,
          showZoom: true,
        }),
        'bottom-right'
      );

      map.on('load', () => {
        setIsMapLoaded(true);
      });

      const handleLineClick = (e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature || !onSelectRouteRef.current) return;
        const tripId = feature.properties?.tripId;
        const mapIndex = Number(feature.properties?.mapIndex ?? 0);
        if (tripId) {
          onSelectRouteRef.current(tripId, mapIndex);
        }
      };

      map.on('click', 'routes-unselected-line', handleLineClick);
      map.on('click', 'routes-selected-line', handleLineClick);

      map.on('mouseenter', 'routes-unselected-line', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'routes-unselected-line', () => {
        map.getCanvas().style.cursor = '';
      });

      // Stop orbit animation if user manually drags/rotates the map
      map.on('mousedown', () => {
        if (orbitFrameRef.current) {
          cancelAnimationFrame(orbitFrameRef.current);
          orbitFrameRef.current = null;
          emitFlightState(isFlyingRef.current, false, null);
        }
      });

      mapRef.current = map;

      return () => {
        stopAnimations();
        map.remove();
        mapRef.current = null;
      };
    }, [stopAnimations, emitFlightState]);

    // Update Base Map Layer when baseStyle changes
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoaded) return;

      map.setLayoutProperty(
        'layer-outdoor',
        'visibility',
        baseStyle === 'outdoor' ? 'visible' : 'none'
      );
      map.setLayoutProperty(
        'layer-satellite',
        'visibility',
        baseStyle === 'satellite' ? 'visible' : 'none'
      );
      map.setLayoutProperty(
        'layer-topo',
        'visibility',
        baseStyle === 'topo' ? 'visible' : 'none'
      );
    }, [baseStyle, isMapLoaded]);

    // Update 3D Terrain Exaggeration when changed
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoaded) return;
      map.setTerrain({
        source: 'terrain-dem',
        exaggeration,
      });
    }, [exaggeration, isMapLoaded]);

    // Update GeoJSON route lines when routes change
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoaded) return;

      const unselectedFeatures: GeoJSON.Feature[] = [];
      const selectedFeatures: GeoJSON.Feature[] = [];

      routes.forEach((r) => {
        if (!r.coordinates || r.coordinates.length < 2) return;
        const lineCoords = r.coordinates.map((pt) => [pt[1], pt[0]]); // [lon, lat]
        const feature: GeoJSON.Feature = {
          type: 'Feature',
          properties: {
            id: r.id,
            tripId: r.tripId,
            mapIndex: r.mapIndex,
            name: r.name,
            color: r.color,
          },
          geometry: {
            type: 'LineString',
            coordinates: lineCoords,
          },
        };

        if (r.isSelected) {
          selectedFeatures.push(feature);
        } else {
          unselectedFeatures.push(feature);
        }
      });

      const unselSource = map.getSource('routes-unselected') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (unselSource) {
        unselSource.setData({
          type: 'FeatureCollection',
          features: unselectedFeatures,
        });
      }

      const selSource = map.getSource('routes-selected') as maplibregl.GeoJSONSource | undefined;
      if (selSource) {
        selSource.setData({
          type: 'FeatureCollection',
          features: selectedFeatures,
        });
      }
    }, [routes, isMapLoaded]);

    // Frame camera & place Start / Finish / Peak markers
    const focusSelectedRoute3D = useCallback(() => {
      const map = mapRef.current;
      if (!map || !isMapLoaded) return;

      stopAnimations();

      routeMarkersRef.current.forEach((m) => m.remove());
      routeMarkersRef.current = [];

      const curSelectedCoords = selectedCoordsRef.current;
      const curRoutes = routesRef.current;

      const coordsToFrame =
        curSelectedCoords.length >= 2
          ? curSelectedCoords
          : curRoutes.flatMap((r) => r.coordinates);

      if (coordsToFrame.length < 2) return;

      const bounds = new maplibregl.LngLatBounds();
      coordsToFrame.forEach((pt) => bounds.extend([pt[1], pt[0]]));

      if (curSelectedCoords.length >= 2) {
        const startPt = curSelectedCoords[0];
        const endPt = curSelectedCoords[curSelectedCoords.length - 1];

        let maxEle = -Infinity;
        let peakPt: Coordinate | null = null;
        curSelectedCoords.forEach((pt) => {
          if (typeof pt[2] === 'number' && !isNaN(pt[2]) && pt[2] > maxEle) {
            maxEle = pt[2];
            peakPt = pt;
          }
        });

        // Start marker
        const startEl = document.createElement('div');
        startEl.className =
          'px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold shadow-lg border-2 border-white whitespace-nowrap select-none';
        startEl.textContent = 'START';
        const startMarker = new maplibregl.Marker({ element: startEl, anchor: 'bottom' })
          .setLngLat([startPt[1], startPt[0]])
          .addTo(map);
        routeMarkersRef.current.push(startMarker);

        // End marker
        const endEl = document.createElement('div');
        endEl.className =
          'px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold shadow-lg border-2 border-white whitespace-nowrap select-none';
        endEl.textContent = 'CÍL';
        const endMarker = new maplibregl.Marker({ element: endEl, anchor: 'bottom' })
          .setLngLat([endPt[1], endPt[0]])
          .addTo(map);
        routeMarkersRef.current.push(endMarker);

        // Peak marker
        if (peakPt && maxEle > -Infinity) {
          const pPt = peakPt as Coordinate;
          const peakEl = document.createElement('div');
          peakEl.className =
            'px-2.5 py-1 rounded-xl bg-slate-900/90 text-amber-300 text-[11px] font-extrabold shadow-xl border border-amber-400/70 whitespace-nowrap select-none flex items-center gap-1';
          peakEl.innerHTML = `<span>🏔️</span><span>${Math.round(maxEle)} m n.m.</span>`;
          const peakMarker = new maplibregl.Marker({ element: peakEl, anchor: 'bottom' })
            .setLngLat([pPt[1], pPt[0]])
            .addTo(map);
          routeMarkersRef.current.push(peakMarker);
        }

        const routeBearing = calculateBearing(startPt[0], startPt[1], endPt[0], endPt[1]);

        map.fitBounds(bounds, {
          padding: {
            top: 80,
            bottom: hasBottomPanelRef.current ? 240 : 80,
            left: 60,
            right: 60,
          },
          pitch: 62,
          bearing: (routeBearing + 25) % 360,
          duration: 1200,
          maxZoom: 14.8,
        });
      } else {
        map.fitBounds(bounds, {
          padding: 80,
          pitch: 55,
          bearing: -15,
          duration: 1200,
          maxZoom: 13.5,
        });
      }
    }, [isMapLoaded, stopAnimations]);

    // Trigger camera focus ONLY when the route identity/geometry or map load state changes
    const routeSignature = routes
      .map((r) => `${r.id}:${r.isSelected ? 1 : 0}:${r.coordinates.length}`)
      .join('|');

    useEffect(() => {
      if (!isMapLoaded) return;
      focusSelectedRoute3D();
    }, [isMapLoaded, routeSignature, focusSelectedRoute3D]);

    // Synchronize hover marker from bottom elevation profile chart WITHOUT touching camera or route layers
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isMapLoaded) return;

      if (!hoveredCoord) {
        if (hoverMarkerRef.current) {
          hoverMarkerRef.current.remove();
          hoverMarkerRef.current = null;
        }
        return;
      }

      const [lat, lon] = hoveredCoord;
      if (!hoverMarkerRef.current) {
        const el = document.createElement('div');
        el.className =
          'w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-[0_0_12px_rgba(0,0,0,0.85)] pointer-events-none';
        hoverMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lon, lat])
          .addTo(map);
      } else {
        hoverMarkerRef.current.setLngLat([lon, lat]);
      }
    }, [hoveredCoord, isMapLoaded]);

    // Virtual 3D Flyover along the selected route
    const handleToggleFlyover = useCallback(() => {
      const map = mapRef.current;
      const coords = selectedCoordsRef.current;
      if (!map || coords.length < 2) return;

      if (isFlyingRef.current) {
        stopAnimations();
        return;
      }

      stopAnimations();

      const cumDist: number[] = [0];
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        cumDist.push(cumDist[i - 1] + calculateDistanceKm(prev[0], prev[1], curr[0], curr[1]));
      }
      const totalDist = cumDist[cumDist.length - 1] || 1;

      const el = document.createElement('div');
      el.className =
        'w-5 h-5 rounded-full bg-amber-400 border-3 border-slate-900 shadow-[0_0_16px_#f59e0b]';
      flyMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([coords[0][1], coords[0][0]])
        .addTo(map);

      const durationMs = Math.min(110000, Math.max(38000, totalDist * 3200));
      const startTime = performance.now();
      let smoothBearing = calculateBearing(
        coords[0][0],
        coords[0][1],
        coords[Math.min(5, coords.length - 1)][0],
        coords[Math.min(5, coords.length - 1)][1]
      );

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / durationMs);
        const targetDist = t * totalDist;

        let idx = 0;
        while (idx < cumDist.length - 2 && cumDist[idx + 1] < targetDist) {
          idx++;
        }

        const segStartDist = cumDist[idx];
        const segEndDist = cumDist[idx + 1];
        const segFrac =
          segEndDist > segStartDist ? (targetDist - segStartDist) / (segEndDist - segStartDist) : 0;

        const p1 = coords[idx];
        const p2 = coords[idx + 1] || p1;

        const lat = p1[0] + (p2[0] - p1[0]) * segFrac;
        const lon = p1[1] + (p2[1] - p1[1]) * segFrac;
        const ele =
          typeof p1[2] === 'number' && typeof p2[2] === 'number'
            ? Math.round(p1[2] + (p2[2] - p1[2]) * segFrac)
            : typeof p1[2] === 'number'
            ? Math.round(p1[2])
            : null;

        const lookAheadIdx = Math.min(
          coords.length - 1,
          idx + Math.max(5, Math.floor(coords.length * 0.06))
        );
        const lookPt = coords[lookAheadIdx];
        if (lookPt && (lookPt[0] !== lat || lookPt[1] !== lon)) {
          const targetBearing = calculateBearing(lat, lon, lookPt[0], lookPt[1]);
          const diff = ((targetBearing - smoothBearing + 540) % 360) - 180;
          smoothBearing = (smoothBearing + diff * 0.025 + 360) % 360;
        }

        flyMarkerRef.current?.setLngLat([lon, lat]);
        emitFlightState(true, false, {
          distKm: targetDist,
          eleM: ele,
          pct: Math.round(t * 100),
        });

        map.jumpTo({
          center: [lon, lat],
          zoom: 14.3,
          pitch: 66,
          bearing: smoothBearing,
        });

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          emitFlightState(false, false, null);
        }
      };

      emitFlightState(true, false, { distKm: 0, eleM: null, pct: 0 });
      animFrameRef.current = requestAnimationFrame(step);
    }, [stopAnimations, emitFlightState]);

    // 360° Orbit around current center (time-based ~24°/sec = 15s per full rotation)
    const handleToggleOrbit = useCallback(() => {
      const map = mapRef.current;
      if (!map) return;

      if (isOrbitingRef.current) {
        stopAnimations();
        return;
      }

      stopAnimations();
      emitFlightState(false, true, null);

      let lastTime = performance.now();
      const degPerSecond = 24;

      const stepOrbit = (now: number) => {
        if (!mapRef.current) return;
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;
        mapRef.current.setBearing((mapRef.current.getBearing() + degPerSecond * dt) % 360);
        orbitFrameRef.current = requestAnimationFrame(stepOrbit);
      };

      orbitFrameRef.current = requestAnimationFrame(stepOrbit);
    }, [stopAnimations, emitFlightState]);

    // Adjust camera pitch in steps
    const handleAdjustPitch = useCallback((delta: number) => {
      const map = mapRef.current;
      if (!map) return;
      const nextPitch = Math.max(0, Math.min(80, map.getPitch() + delta));
      map.easeTo({ pitch: nextPitch, duration: 350 });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        toggleFlyover: handleToggleFlyover,
        toggleOrbit: handleToggleOrbit,
        focusRoute: focusSelectedRoute3D,
        adjustPitch: handleAdjustPitch,
      }),
      [handleToggleFlyover, handleToggleOrbit, focusSelectedRoute3D, handleAdjustPitch]
    );

    return (
      <div className="w-full h-full relative bg-slate-900 overflow-hidden">
        {/* MapLibre 3D WebGL Container */}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  }
);
