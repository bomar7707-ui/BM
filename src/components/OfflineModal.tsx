import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Wifi,
  WifiOff,
  CloudOff,
  RefreshCw,
  Download,
  Trash2,
  HardDrive,
  CheckCircle2,
  Map as MapIcon,
  Smartphone,
  Share,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { Hike, PlannedRoute } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  OfflineTileCacheStats,
  OfflineDownloadProgress,
  getOfflineTileCacheStats,
  clearOfflineTileCache,
  downloadOfflineMapArea,
  collectCoordsFromHike,
  collectCoordsFromPlannedRoute,
  collectCoordsFromAll,
  formatBytesCz,
} from '../utils/offlineManager';
import {
  resolveVectorTileTemplate,
  TERRARIUM_DEM_URL,
  SENTINEL2_TILE_URL,
} from '../utils/customMapLayer';

interface OfflineModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  isManualOffline: boolean;
  onToggleManualOffline: (enabled: boolean) => void;
  isConnected: boolean;
  hikes: Hike[];
  plannedRoutes: PlannedRoute[];
  selectedTrip: Hike | null;
  selectedPlannedRoute: PlannedRoute | null;
  pendingCount: number;
  isSyncing: boolean;
  onSyncNow: () => Promise<void>;
  onNotify: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

export const OfflineModal: React.FC<OfflineModalProps> = ({
  isOpen,
  onClose,
  isOnline,
  isManualOffline,
  onToggleManualOffline,
  isConnected,
  hikes,
  plannedRoutes,
  selectedTrip,
  selectedPlannedRoute,
  pendingCount,
  isSyncing,
  onSyncNow,
  onNotify,
}) => {
  const { canInstall, isInstalled, isIOS, install } = usePWAInstall();
  const [cacheStats, setCacheStats] = useState<OfflineTileCacheStats | null>(null);
  const [includeSatellite, setIncludeSatellite] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadLabel, setDownloadLabel] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<OfflineDownloadProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isOffline = !isOnline || isManualOffline;

  const refreshStats = async () => {
    const stats = await getOfflineTileCacheStats();
    setCacheStats(stats);
  };

  useEffect(() => {
    if (isOpen) {
      void refreshStats();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const selectedRouteInfo = useMemo(() => {
    if (selectedTrip) {
      const coords = collectCoordsFromHike(selectedTrip);
      if (coords.length > 0) {
        return { label: selectedTrip.name, coords };
      }
    }
    if (selectedPlannedRoute) {
      const coords = collectCoordsFromPlannedRoute(selectedPlannedRoute);
      if (coords.length > 0) {
        return { label: selectedPlannedRoute.name, coords };
      }
    }
    return null;
  }, [selectedTrip, selectedPlannedRoute]);

  const allCoords = useMemo(
    () => collectCoordsFromAll(hikes, plannedRoutes),
    [hikes, plannedRoutes]
  );

  if (!isOpen) return null;

  const handleStartDownload = async (coords: [number, number][], label: string) => {
    if (isOffline) {
      onNotify('Pro stažení mapových podkladů vypněte offline režim a připojte se k internetu.', 'warning');
      return;
    }
    if (coords.length === 0) {
      onNotify('Nebyly nalezeny žádné GPX souřadnice ke stažení mapy.', 'warning');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsDownloading(true);
    setDownloadLabel(label);
    setDownloadProgress({ done: 0, total: 0, downloaded: 0, skipped: 0, failed: 0 });

    try {
      const vectorTemplate = await resolveVectorTileTemplate();
      const result = await downloadOfflineMapArea(coords, {
        vectorTemplate,
        terrariumUrl: TERRARIUM_DEM_URL,
        satelliteUrl: SENTINEL2_TILE_URL,
        includeSatellite,
        signal: controller.signal,
        onProgress: (p) => setDownloadProgress({ ...p }),
      });

      await refreshStats();

      if (controller.signal.aborted) {
        onNotify('Stahování offline map bylo zrušeno.', 'warning');
      } else {
        onNotify(
          `Offline mapa připravena (${result.downloaded} nových dlaždic, ${result.skipped} již uloženo).`,
          'success'
        );
      }
    } catch (err: unknown) {
      const e = err as Error;
      onNotify(`Chyba při stahování mapy: ${e?.message || 'Zkuste to znovu'}`, 'error');
    } finally {
      abortControllerRef.current = null;
      setIsDownloading(false);
    }
  };

  const handleCancelDownload = () => {
    abortControllerRef.current?.abort();
  };

  const handleClearTileCache = async () => {
    await clearOfflineTileCache();
    await refreshStats();
    onNotify('Mezipaměť offline map byla vymazána.', 'success');
  };

  const handleInstallApp = async () => {
    const accepted = await install();
    if (accepted) {
      onNotify('Horský zápisník byl nainstalován do vašeho zařízení.', 'success');
    }
  };

  const progressPct =
    downloadProgress && downloadProgress.total > 0
      ? Math.min(100, Math.round((downloadProgress.done / downloadProgress.total) * 100))
      : 0;

  return (
    <div
      className="absolute md:fixed inset-0 z-[2100] flex items-center justify-center bg-stone-900/60 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-lg max-h-[90%] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 bg-stone-50/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isOffline
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {isOffline ? <CloudOff className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-stone-900 leading-tight">
                Offline režim a mapy
              </h2>
              <p className="text-xs text-stone-500">
                {isManualOffline
                  ? 'Ručně přepnuto do offline režimu'
                  : !isOnline
                  ? 'Zařízení nemá připojení k internetu'
                  : isConnected
                  ? 'Online · synchronizováno s Firebase Cloudem'
                  : 'Online · lokální záloha aktivní'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-200/70 transition-colors cursor-pointer"
            aria-label="Zavřít"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* 1. Manual Offline Mode Switch */}
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-stone-50 border border-stone-200">
            <div className="min-w-0">
              <div className="text-sm font-bold text-stone-800 flex items-center gap-1.5">
                {isManualOffline ? (
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span>Ruční offline režim</span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5 leading-snug">
                Vypne síťové požadavky a pracuje pouze z uložených dat a stažených map v zařízení.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isManualOffline}
              onClick={() => onToggleManualOffline(!isManualOffline)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                isManualOffline ? 'bg-amber-500' : 'bg-stone-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  isManualOffline ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 2. Local Data & Cloud Sync Status */}
          <div className="space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Uložená data v zařízení
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 text-center">
                <div className="text-lg font-extrabold text-stone-900">{hikes.length}</div>
                <div className="text-[11px] text-stone-500 font-medium">Výšlapů</div>
              </div>
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 text-center">
                <div className="text-lg font-extrabold text-stone-900">{plannedRoutes.length}</div>
                <div className="text-[11px] text-stone-500 font-medium">Plánů</div>
              </div>
              <div
                className={`p-3 rounded-xl border text-center ${
                  pendingCount > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900'
                }`}
              >
                <div className="text-lg font-extrabold">{pendingCount}</div>
                <div className="text-[11px] font-medium opacity-80">Ke syncu</div>
              </div>
            </div>

            {pendingCount > 0 ? (
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="font-medium leading-snug">
                    {isOffline
                      ? 'Změny jsou bezpečně uložené lokálně a odešlou se po připojení.'
                      : 'Čekají neodeslané offline úpravy.'}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isOffline || isSyncing}
                  onClick={() => void onSyncNow()}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Odeslat</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs text-stone-500 px-1">
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Všechny záznamy jsou zálohovány v zařízení
                </span>
                <button
                  type="button"
                  disabled={isOffline || isSyncing}
                  onClick={() => void onSyncNow()}
                  className="text-emerald-700 hover:text-emerald-800 disabled:opacity-40 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Obnovit z Cloudu</span>
                </button>
              </div>
            )}
          </div>

          {/* 3. Offline Map Tile Cache & Pre-Downloader */}
          <div className="space-y-3 pt-1 border-t border-stone-100">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                <MapIcon className="w-3.5 h-3.5" />
                <span>Offline mapové podklady (2D i 3D)</span>
              </div>
              {cacheStats && (
                <span className="text-[11px] font-semibold text-stone-500 flex items-center gap-1">
                  <HardDrive className="w-3.5 h-3.5 text-stone-400" />
                  {cacheStats.totalTiles} dlaždic
                  {cacheStats.usageBytes !== null && ` · ${formatBytesCz(cacheStats.usageBytes)}`}
                </span>
              )}
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              Všechny prohlédnuté mapy se ukládají automaticky. Před túrou si můžete předem stáhnout
              vektorové podklady i výškový reliéf (DEM) pro vybranou trasu nebo celý archív.
            </p>

            {/* Satellite include checkbox */}
            <label className="flex items-center gap-2 text-xs text-stone-700 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSatellite}
                onChange={(e) => setIncludeSatellite(e.target.checked)}
                disabled={isDownloading}
                className="rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
              />
              <Layers className="w-3.5 h-3.5 text-stone-400" />
              <span>Zahrnout také satelitní snímky (větší velikost)</span>
            </label>

            {/* Download Progress */}
            {isDownloading && downloadProgress && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span className="truncate pr-2">Stahuji: {downloadLabel}</span>
                  <span className="shrink-0">{progressPct} %</span>
                </div>
                <div className="w-full h-2 rounded-full bg-emerald-200/80 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-150"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-emerald-800">
                  <span>
                    {downloadProgress.done} / {downloadProgress.total} dlaždic
                    {downloadProgress.skipped > 0 ? ` (${downloadProgress.skipped} v paměti)` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelDownload}
                    className="font-bold text-red-600 hover:text-red-700 cursor-pointer"
                  >
                    Zrušit
                  </button>
                </div>
              </div>
            )}

            {/* Download Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedRouteInfo && (
                <button
                  type="button"
                  disabled={isOffline || isDownloading}
                  onClick={() =>
                    void handleStartDownload(selectedRouteInfo.coords, selectedRouteInfo.label)
                  }
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="truncate">Stáhnout vybranou trasu</span>
                </button>
              )}

              <button
                type="button"
                disabled={isOffline || isDownloading || allCoords.length === 0}
                onClick={() => void handleStartDownload(allCoords, 'Všechny trasy v archívu')}
                className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                  selectedRouteInfo
                    ? 'bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200'
                    : 'sm:col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Stáhnout mapy všech tras</span>
              </button>
            </div>

            {cacheStats && cacheStats.totalTiles > 0 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-stone-500">
                  Mapa: {cacheStats.vectorTiles} · Reliéf DEM: {cacheStats.demTiles}
                  {cacheStats.satelliteTiles > 0 ? ` · Satelit: ${cacheStats.satelliteTiles}` : ''}
                </span>
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => void handleClearTileCache()}
                  className="text-[11px] font-bold text-red-600 hover:text-red-700 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Vymazat mapy</span>
                </button>
              </div>
            )}
          </div>

          {/* 4. Mandatory In-App PWA Install Section (auto-hidden when already installed) */}
          {!isInstalled && (
            <div className="pt-3 border-t border-stone-100 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Aplikace do telefonu (PWA)</span>
              </div>

              {canInstall ? (
                <button
                  type="button"
                  onClick={() => void handleInstallApp()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Nainstalovat Horský zápisník na plochu</span>
                </button>
              ) : isIOS ? (
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-700 flex items-start gap-2.5">
                  <Share className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    Pro plný offline provoz na iPhonu klepněte v Safari na{' '}
                    <strong className="text-stone-900">Sdílet</strong> a zvolte{' '}
                    <strong className="text-stone-900">Přidat na plochu</strong>.
                  </span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-600">
                  Aplikaci můžete kdykoli nainstalovat z nabídky prohlížeče (ikona instalace v
                  adresním řádku), aby se spouštěla na celou obrazovku i bez internetu.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
