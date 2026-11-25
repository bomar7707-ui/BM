import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { HikeForm } from './components/HikeForm';
import { HikeList } from './components/HikeList';
import { MapView } from './components/MapView';
import { Route3DView } from './components/Route3DView';
import { AnalyticsView } from './components/AnalyticsView';
import { MilestonesView } from './components/MilestonesView';
import { PrintReportView } from './components/PrintReportView';
import { PlannedRoutesView, DISTINCT_ROUTE_COLORS } from './components/PlannedRoutesView';
import { ParticipantsView } from './components/ParticipantsView';
import { AccommodationView } from './components/AccommodationView';
import { Toast, ToastType } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { OfflineModal } from './components/OfflineModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { Hike, HikeActivity, FilterState, RoutePart, PlannedRoute, ParticipantProfile } from './types';
import {
  subscribeToHikesLive,
  fetchAllHikes,
  addHike,
  updateHike,
  deleteHike,
  replaceAllHikesInFirebase,
  saveHikesToStorageSafe,
  subscribeToPlannedRoutesLive,
  loadPlannedRoutesFromStorage,
  savePlannedRoutesToStorageSafe,
  addPlannedRoute,
  updatePlannedRoute,
  deletePlannedRoute,
  loadParticipantsFromStorage,
  subscribeToParticipantsLive,
  saveParticipantProfile,
  setFirestoreNetworkEnabled,
} from './services/firebase';
import { exportHikesToExcel } from './utils/excelExport';
import {
  parseGpxXml,
  calculateCoordsDistanceKm,
  getEffectiveHikeDistanceKm,
} from './utils/gpxParser';
import { evaluateMilestonesForParticipant } from './utils/milestonesUtils';
import { sendMilestoneEmailNotification, downloadMilestoneCardPng } from './utils/milestoneCardGenerator';
import {
  useOfflineMode,
  useOfflineSyncQueue,
  enqueueOfflineOp,
  syncPendingOfflineOps,
  getPendingOfflineOps,
} from './utils/offlineManager';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [hikes, setHikes] = useState<Hike[]>(() => {
    try {
      const stored = localStorage.getItem('hikingArchiveDataJsonOnly');
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return [];
  });

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState<boolean>(false);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState<boolean>(false);
  const [splashRemoved, setSplashRemoved] = useState<boolean>(false);
  const [editingHike, setEditingHike] = useState<Hike | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedMapIndex, setSelectedMapIndex] = useState<number | null>(null);
  const [selectedPlannedRouteId, setSelectedPlannedRouteId] = useState<string | null>(null);

  // Offline mode & sync queue state
  const { isOnline, isManualOffline, isOffline, setManualOffline } = useOfflineMode();
  const { pendingCount } = useOfflineSyncQueue();
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState<boolean>(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState<boolean>(false);

  // Isolated state for Planned Routes (Plánované trasy)
  const [plannedRoutes, setPlannedRoutes] = useState<PlannedRoute[]>(() =>
    loadPlannedRoutesFromStorage()
  );

  // Participant profiles (Účastníci - emaily a odeslané milníky)
  const [participantProfiles, setParticipantProfiles] = useState<Record<string, ParticipantProfile>>(() =>
    loadParticipantsFromStorage()
  );

  // Journal filter state
  const [filterState, setFilterState] = useState<FilterState>({
    year: 'all',
    month: 'all',
    participant: 'all',
    activity: 'all',
  });

  // Toast
  const [toast, setToast] = useState<{ message: string | null; type: ToastType }>({
    message: null,
    type: 'success',
  });

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type });
  }, []);

  // Confirmation modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Sync Firestore network state with Manual Offline Mode toggle
  useEffect(() => {
    void setFirestoreNetworkEnabled(!isManualOffline);
    if (isManualOffline || !isOnline) {
      setIsConnected(false);
    }
  }, [isManualOffline, isOnline]);

  // Subscribe to Firebase Live Snapshot
  useEffect(() => {
    const unsubscribe = subscribeToHikesLive(
      (data) => {
        // Avoid wiping unsynced local edits while offline
        const hasPendingHikeOps = getPendingOfflineOps().some(
          (o) => o.type === 'add_hike' || o.type === 'update_hike' || o.type === 'delete_hike'
        );
        if (!hasPendingHikeOps) {
          if (data.length > 0 || !isOffline) {
            setHikes(data);
          }
        }
        setIsConnected(!isOffline);
        setIsInitialDataLoaded(true);
      },
      (err) => {
        console.warn('Firebase error:', err);
        setIsConnected(false);
        setIsInitialDataLoaded(true);
      }
    );

    const dataFallbackTimer = window.setTimeout(() => {
      setIsInitialDataLoaded(true);
    }, 2200);

    return () => {
      window.clearTimeout(dataFallbackTimer);
      unsubscribe();
    };
  }, [isOffline]);

  // Minimum splash display duration & fallback safety timer
  useEffect(() => {
    const minTimer = window.setTimeout(() => {
      setMinSplashElapsed(true);
    }, 1100);
    const maxSafetyTimer = window.setTimeout(() => {
      setIsInitialDataLoaded(true);
      setIsMapReady(true);
      setMinSplashElapsed(true);
    }, 3500);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxSafetyTimer);
    };
  }, []);

  const isAppAndMapLoaded =
    minSplashElapsed && isInitialDataLoaded && (isMapReady || activeTab !== 'map');

  useEffect(() => {
    if (!isAppAndMapLoaded) return;
    const fadeTimer = window.setTimeout(() => {
      setSplashRemoved(true);
    }, 550);
    return () => window.clearTimeout(fadeTimer);
  }, [isAppAndMapLoaded]);

  // Subscribe to Planned Routes Live Snapshot
  useEffect(() => {
    const unsubscribePlanned = subscribeToPlannedRoutesLive((data) => {
      const hasPendingPlannedOps = getPendingOfflineOps().some(
        (o) =>
          o.type === 'add_planned' || o.type === 'update_planned' || o.type === 'delete_planned'
      );
      if (!hasPendingPlannedOps && (data.length > 0 || !isOffline)) {
        setPlannedRoutes(data);
      }
    });
    return () => {
      unsubscribePlanned();
    };
  }, [isOffline]);

  // Subscribe to Participant Profiles Live Snapshot
  useEffect(() => {
    const unsubscribeParticipants = subscribeToParticipantsLive((data) => {
      setParticipantProfiles(data);
    });
    return () => {
      unsubscribeParticipants();
    };
  }, []);

  // Replay pending offline edits back to Firebase Cloud
  const handleSyncOfflineQueue = useCallback(
    async (showFeedback = false) => {
      if (isOffline) {
        if (showFeedback) {
          showToast('Jste v offline režimu. Pro synchronizaci se připojte k internetu.', 'warning');
        }
        return;
      }

      const queuedCount = getPendingOfflineOps().length;
      setIsSyncingOffline(true);
      try {
        if (queuedCount > 0) {
          const { synced, failed } = await syncPendingOfflineOps({
            addHike,
            updateHike,
            deleteHike,
            addPlannedRoute,
            updatePlannedRoute,
            deletePlannedRoute,
          });
          if (synced > 0) {
            try {
              const fresh = await fetchAllHikes();
              setHikes(fresh);
              setIsConnected(true);
            } catch {
              // Snapshot listener will catch up
            }
            showToast(
              failed > 0
                ? `Synchronizováno ${synced} změn (${failed} zůstalo ve frontě).`
                : `Synchronizováno ${synced} offline změn s Cloudem!`,
              failed > 0 ? 'warning' : 'success'
            );
          } else if (showFeedback && failed > 0) {
            showToast('Synchronizace se nezdařila. Zkuste to za chvíli znovu.', 'error');
          }
        } else if (showFeedback) {
          const fresh = await fetchAllHikes();
          setHikes(fresh);
          setIsConnected(true);
          showToast(`Úspěšně načteno ${fresh.length} tras z Cloudu.`, 'success');
        }
      } catch (err: unknown) {
        if (showFeedback) {
          const e = err as Error;
          showToast(`Chyba synchronizace: ${e?.message || 'Zkontrolujte připojení'}`, 'error');
        }
      } finally {
        setIsSyncingOffline(false);
      }
    },
    [isOffline, showToast]
  );

  // Auto-sync queued changes when device comes back online
  useEffect(() => {
    if (!isOffline && pendingCount > 0 && !isSyncingOffline) {
      const timer = window.setTimeout(() => {
        void handleSyncOfflineQueue(false);
      }, 900);
      return () => window.clearTimeout(timer);
    }
  }, [isOffline, pendingCount, isSyncingOffline, handleSyncOfflineQueue]);

  const handleToggleManualOffline = useCallback(
    (enabled: boolean) => {
      setManualOffline(enabled);
      showToast(
        enabled
          ? 'Ruční offline režim byl zapnut. Aplikace pracuje z uložených dat a map.'
          : 'Ruční offline režim byl vypnut.',
        enabled ? 'warning' : 'success'
      );
    },
    [setManualOffline, showToast]
  );

  // Total stats (excluding non-contiguous transfers / přejezdy)
  const { totalDistance, totalTrips } = useMemo(() => {
    const totalKm = hikes.reduce((sum, h) => {
      const d = getEffectiveHikeDistanceKm(h);
      return sum + (isNaN(d) ? 0 : d);
    }, 0);
    return {
      totalDistance: totalKm,
      totalTrips: hikes.length,
    };
  }, [hikes]);

  // Save participant profile (email / notified milestones)
  const handleSaveParticipantProfile = useCallback(async (profile: ParticipantProfile) => {
    await saveParticipantProfile(profile);
    setParticipantProfiles(loadParticipantsFromStorage());
  }, []);

  // Check if a newly saved or edited hike unlocked any new milestones for participants with an email
  const checkAndNotifyNewMilestones = async (
    previousHikes: Hike[],
    updatedHikesList: Hike[],
    participantsStr?: string
  ) => {
    if (!participantsStr) return;
    const names = participantsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const name of names) {
      const profile = participantProfiles[name];
      const email = profile?.email?.trim();
      if (!email) continue;

      const beforeCompleted = new Set(
        evaluateMilestonesForParticipant(previousHikes, name)
          .filter((m) => m.isCompleted)
          .map((m) => m.id)
      );
      const afterCompleted = evaluateMilestonesForParticipant(updatedHikesList, name).filter(
        (m) => m.isCompleted
      );
      const alreadyNotified = new Set(profile?.notifiedMilestones || []);

      const newlyUnlocked = afterCompleted.filter(
        (m) => !beforeCompleted.has(m.id) && !alreadyNotified.has(m.id)
      );

      if (newlyUnlocked.length > 0) {
        const nextNotified = Array.from(
          new Set([...alreadyNotified, ...newlyUnlocked.map((m) => m.id)])
        );

        await handleSaveParticipantProfile({
          name,
          email,
          notifiedMilestones: nextNotified,
        });

        for (const milestone of newlyUnlocked) {
          downloadMilestoneCardPng(milestone, name);
          await sendMilestoneEmailNotification({
            participantName: name,
            email,
            milestone,
          });
          showToast(
            `Účastník ${name} splnil milník "${milestone.title}"! Oznámení s milníkem bylo odesláno na ${email}.`,
            'success'
          );
        }
      }
    }
  };

  // Handle saving new or edited hike (seamless online + offline support)
  const handleSaveHike = async (hikeData: {
    name: string;
    distance: number;
    date: string;
    dateTo?: string;
    participants?: string;
    note?: string;
    activity?: HikeActivity;
    routes: RoutePart[];
  }) => {
    const previousHikes = [...hikes];

    if (editingHike) {
      const simulatedUpdated: Hike = {
        ...editingHike,
        name: hikeData.name,
        distance: hikeData.distance.toFixed(1),
        date: hikeData.date,
        rawDate: hikeData.date,
        dateTo: hikeData.dateTo || '',
        participants: hikeData.participants || '',
        note: hikeData.note || '',
        activity: hikeData.activity,
        routes: hikeData.routes,
        maps: hikeData.routes,
      };
      const updatedList = previousHikes.map((h) =>
        h.id === editingHike.id ? simulatedUpdated : h
      );

      if (isOffline) {
        setHikes(updatedList);
        saveHikesToStorageSafe(updatedList);
        enqueueOfflineOp({ type: 'update_hike', id: editingHike.id, payload: hikeData });
        setEditingHike(null);
        showToast('Výšlap uložen v offline režimu (odešle se po připojení)', 'warning');
        return;
      }

      try {
        await updateHike(editingHike.id, hikeData);
        setEditingHike(null);
        showToast('Výšlap byl úspěšně upraven v cloudu', 'success');
        await checkAndNotifyNewMilestones(previousHikes, updatedList, hikeData.participants);
      } catch {
        setHikes(updatedList);
        saveHikesToStorageSafe(updatedList);
        enqueueOfflineOp({ type: 'update_hike', id: editingHike.id, payload: hikeData });
        setEditingHike(null);
        showToast('Výšlap uložen lokálně (odešle se po připojení)', 'warning');
      }
    } else {
      const localId = `offline_hike_${Date.now()}`;
      const makeHike = (id: string): Hike => ({
        id,
        name: hikeData.name,
        distance: hikeData.distance.toFixed(1),
        date: hikeData.date,
        rawDate: hikeData.date,
        dateTo: hikeData.dateTo || '',
        participants: hikeData.participants || '',
        note: hikeData.note || '',
        activity: hikeData.activity,
        routes: hikeData.routes,
        maps: hikeData.routes,
      });

      if (isOffline) {
        const updatedList = [makeHike(localId), ...previousHikes];
        setHikes(updatedList);
        saveHikesToStorageSafe(updatedList);
        enqueueOfflineOp({ type: 'add_hike', localId, payload: hikeData });
        showToast('Nový výšlap uložen v offline režimu (odešle se po připojení)', 'warning');
        return;
      }

      try {
        const newId = await addHike(hikeData);
        const updatedList = [makeHike(newId), ...previousHikes];
        showToast('Nový výšlap byl úspěšně uložen do cloudu', 'success');
        await checkAndNotifyNewMilestones(previousHikes, updatedList, hikeData.participants);
      } catch {
        const updatedList = [makeHike(localId), ...previousHikes];
        setHikes(updatedList);
        saveHikesToStorageSafe(updatedList);
        enqueueOfflineOp({ type: 'add_hike', localId, payload: hikeData });
        showToast('Nový výšlap uložen lokálně (odešle se po připojení)', 'warning');
      }
    }
  };

  // Handle delete hike (seamless online + offline support)
  const handleDeleteHike = (id: string) => {
    const hike = hikes.find((h) => h.id === id);
    setConfirmModal({
      isOpen: true,
      title: isOffline ? 'Smazat záznam (offline)' : 'Smazat záznam z Cloudu',
      message: isOffline
        ? `Opravdu chcete smazat výšlap "${hike?.name || 'Zvolený výšlap'}"? Smazání se provede lokálně a po připojení se propíše do Cloudu.`
        : `Opravdu chcete smazat výšlap "${hike?.name || 'Zvolený výšlap'}"? Data budou trvale odstraněna z Firebase.`,
      confirmText: 'Ano, smazat',
      isDestructive: true,
      onConfirm: async () => {
        try {
          if (isOffline) {
            const next = hikes.filter((h) => h.id !== id);
            setHikes(next);
            saveHikesToStorageSafe(next);
            enqueueOfflineOp({ type: 'delete_hike', id });
            if (editingHike?.id === id) setEditingHike(null);
            if (selectedTripId === id) setSelectedTripId(null);
            showToast('Výšlap smazán lokálně (propíše se po připojení)', 'warning');
          } else {
            await deleteHike(id);
            if (editingHike?.id === id) setEditingHike(null);
            if (selectedTripId === id) setSelectedTripId(null);
            showToast('Výšlap byl smazán z cloudu', 'success');
          }
        } catch {
          const next = hikes.filter((h) => h.id !== id);
          setHikes(next);
          saveHikesToStorageSafe(next);
          enqueueOfflineOp({ type: 'delete_hike', id });
          if (editingHike?.id === id) setEditingHike(null);
          if (selectedTripId === id) setSelectedTripId(null);
          showToast('Výšlap smazán lokálně (propíše se po připojení)', 'warning');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  // Handle save or update Planned Route (seamless online + offline support)
  const handleSavePlannedRoute = async (
    routeData: {
      name: string;
      distance: number;
      link?: string;
      note?: string;
      color?: string;
      routes: RoutePart[];
    },
    editingId?: string
  ): Promise<string> => {
    if (editingId) {
      const updatedItem: PlannedRoute = {
        id: editingId,
        name: routeData.name,
        distance: routeData.distance.toFixed(1),
        link: routeData.link || '',
        note: routeData.note || '',
        color: routeData.color || '',
        gpxName: routeData.routes[0]?.gpxName || '',
        gpxData: routeData.routes[0]?.gpxData || null,
        coordinates: routeData.routes[0]?.coordinates || [],
        routes: routeData.routes,
      };
      if (isOffline) {
        const next = plannedRoutes.map((r) => (r.id === editingId ? updatedItem : r));
        setPlannedRoutes(next);
        savePlannedRoutesToStorageSafe(next);
        enqueueOfflineOp({ type: 'update_planned', id: editingId, payload: routeData });
        showToast('Plánovaná trasa upravena offline (odešle se po připojení)', 'warning');
        return editingId;
      }
      try {
        await updatePlannedRoute(editingId, routeData);
        showToast('Plánovaná trasa byla upravena', 'success');
      } catch {
        const next = plannedRoutes.map((r) => (r.id === editingId ? updatedItem : r));
        setPlannedRoutes(next);
        savePlannedRoutesToStorageSafe(next);
        enqueueOfflineOp({ type: 'update_planned', id: editingId, payload: routeData });
        showToast('Plánovaná trasa upravena lokálně (odešle se po připojení)', 'warning');
      }
      return editingId;
    } else {
      const saveLocally = () => {
        const localId = 'plan_' + Date.now();
        const newItem: PlannedRoute = {
          id: localId,
          name: routeData.name,
          distance: routeData.distance.toFixed(1),
          link: routeData.link || '',
          note: routeData.note || '',
          color: routeData.color || '',
          gpxName: routeData.routes[0]?.gpxName || '',
          gpxData: routeData.routes[0]?.gpxData || null,
          coordinates: routeData.routes[0]?.coordinates || [],
          routes: routeData.routes,
          createdAt: new Date().toISOString(),
        };
        const next = [newItem, ...plannedRoutes];
        setPlannedRoutes(next);
        savePlannedRoutesToStorageSafe(next);
        enqueueOfflineOp({ type: 'add_planned', localId, payload: routeData });
        showToast('Plánovaná trasa uložena lokálně (odešle se po připojení)', 'warning');
        return localId;
      };

      if (isOffline) {
        return saveLocally();
      }
      try {
        const newId = await addPlannedRoute(routeData);
        showToast('Plánovaná trasa byla uložena', 'success');
        return newId;
      } catch {
        return saveLocally();
      }
    }
  };

  // Handle delete Planned Route (seamless online + offline support)
  const handleDeletePlannedRoute = (id: string) => {
    const target = plannedRoutes.find((r) => r.id === id);
    setConfirmModal({
      isOpen: true,
      title: 'Smazat plánovanou trasu',
      message: `Opravdu chcete odstranit plánovanou trasu "${target?.name || 'Zvolená trasa'}"?`,
      confirmText: 'Ano, smazat',
      isDestructive: true,
      onConfirm: async () => {
        const removeLocal = (queueForSync: boolean) => {
          const next = plannedRoutes.filter((r) => r.id !== id);
          setPlannedRoutes(next);
          savePlannedRoutesToStorageSafe(next);
          if (queueForSync) {
            enqueueOfflineOp({ type: 'delete_planned', id });
          }
        };

        try {
          if (isOffline) {
            removeLocal(true);
            showToast('Plánovaná trasa smazána lokálně (propíše se po připojení)', 'warning');
          } else {
            await deletePlannedRoute(id);
            removeLocal(false);
            showToast('Plánovaná trasa byla smazána', 'success');
          }
        } catch {
          removeLocal(true);
          showToast('Plánovaná trasa smazána lokálně (propíše se po připojení)', 'warning');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  // Show trip on Map
  const handleShowOnMap = (tripId: string) => {
    setSelectedTripId(tripId);
    setSelectedMapIndex(null);
    setActiveTab('map');
  };

  // Show trip in Analytics
  const handleShowAnalytics = (tripId: string) => {
    setSelectedTripId(tripId);
    setActiveTab('analytics');
  };

  // Manual Cloud refresh
  const handleRefreshCloud = async () => {
    if (isOffline) {
      showToast('Jste v offline režimu – zobrazují se uložená lokální data.', 'warning');
      return;
    }
    try {
      await handleSyncOfflineQueue(true);
    } catch (err: unknown) {
      const e = err as Error;
      showToast(`Chyba synchronizace: ${e?.message || 'Zkontrolujte připojení'}`, 'error');
    }
  };

  // Add GPX directly to archive
  const handleAddGpxTrip = async (newTrip: Hike): Promise<string> => {
    const payload = {
      name: newTrip.name,
      distance:
        typeof newTrip.distance === 'string' ? parseFloat(newTrip.distance) : newTrip.distance,
      date: newTrip.date,
      routes: newTrip.routes || [],
    };

    const saveLocalGpx = () => {
      const updated = [newTrip, ...hikes];
      setHikes(updated);
      saveHikesToStorageSafe(updated);
      enqueueOfflineOp({ type: 'add_hike', localId: newTrip.id, payload });
      showToast('GPX uloženo lokálně (odešle se po připojení)', 'warning');
      return newTrip.id;
    };

    if (isOffline) {
      return saveLocalGpx();
    }

    try {
      const docId = await addHike(payload);
      newTrip.id = docId;
      showToast('GPX trasa byla uložena do archívu', 'success');
      return docId;
    } catch {
      return saveLocalGpx();
    }
  };

  // Handle GPX file upload from Navbar's Záloha a export dat menu
  const handleImportGpx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const gpxString = event.target?.result as string;
      const coords = parseGpxXml(gpxString);
      if (!coords || coords.length === 0) {
        showToast('Soubor GPX neobsahuje žádné body trasy.', 'error');
        return;
      }

      const distKm = calculateCoordsDistanceKm(coords);

      let trackName = file.name.replace(/\.gpx$/i, '');
      const todayIso = new Date().toISOString().slice(0, 10);
      let trackDate = todayIso;

      try {
        const xmlDoc = new DOMParser().parseFromString(gpxString, 'text/xml');
        const nameEl = xmlDoc.querySelector('trk > name, metadata > name, name');
        if (nameEl?.textContent?.trim()) {
          trackName = nameEl.textContent.trim();
        }
        const timeEl = xmlDoc.querySelector('metadata > time, trkpt > time, time');
        if (timeEl?.textContent?.trim()) {
          const parsedTime = timeEl.textContent.trim().slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(parsedTime)) {
            trackDate = parsedTime;
          }
        }
      } catch {
        // ignore metadata parse error
      }

      const routePart: RoutePart = {
        distance: Math.round(distKm * 10) / 10,
        url: '',
        link: '',
        photos: '',
        photosUrl: '',
        video: '',
        youtube: '',
        gpxData: gpxString,
        gpxName: file.name,
        coordinates: coords,
      };

      const newTrip: Hike = {
        id: 'gpx_' + Date.now(),
        name: trackName,
        date: trackDate,
        rawDate: trackDate,
        distance: distKm.toFixed(1),
        participants: '',
        routes: [routePart],
        maps: [routePart],
      };

      const savedId = await handleAddGpxTrip(newTrip);
      setSelectedTripId(savedId);
      setSelectedMapIndex(null);
      setActiveTab('map');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export JSON backup
  const handleExportJson = () => {
    if (hikes.length === 0) {
      showToast('Zatím nemáte žádné záznamy k exportu.', 'warning');
      return;
    }
    const cleanData = hikes.map((h) => ({
      name: h.name,
      distance: typeof h.distance === 'string' ? parseFloat(h.distance) || 0 : h.distance,
      date: h.date,
      dateTo: h.dateTo || '',
      participants: h.participants || '',
      note: h.note || '',
      activity: h.activity || '',
      routes: (h.routes || h.maps || []).map((r) => ({
        distance: r.distance !== undefined && r.distance !== '' ? parseFloat(String(r.distance)) || 0 : 0,
        link: r.link || r.url || '',
        gpxData: r.gpxData || null,
        gpxName: r.gpxName || '',
        photosUrl: r.photosUrl || r.photos || '',
        youtube: r.youtube || r.video || '',
      })),
    }));
    const blob = new Blob([JSON.stringify(cleanData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vyslapy-firebase-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('JSON záloha byla stažena', 'success');
  };

  // Export Excel
  const handleExportExcel = () => {
    if (hikes.length === 0) {
      showToast('Zatím nemáte žádné záznamy k exportu.', 'warning');
      return;
    }
    exportHikesToExcel(hikes, `vyslapy_excel_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('XLSX soubor byl vygenerován', 'success');
  };

  // Import JSON into Cloud
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedData)) {
          showToast('Soubor neobsahuje platný seznam výšlapů.', 'error');
          return;
        }

        setConfirmModal({
          isOpen: true,
          title: 'Nahrát zálohu do Cloudu',
          message: `Chystáte se nahrát ${importedData.length} záznamů do Firebase. Stávající záznamy budou nahrazeny. Přejete si pokračovat?`,
          confirmText: 'Ano, přepsat v cloudu',
          isDestructive: true,
          onConfirm: async () => {
            try {
              showToast('Probíhá přenos dat do Firebase...', 'warning');
              await replaceAllHikesInFirebase(importedData);
              showToast(`Úspěšně importováno ${importedData.length} výšlapů do cloudu!`, 'success');
            } catch (err: unknown) {
              const e = err as Error;
              showToast(`Chyba importu: ${e?.message || 'Neznámá chyba'}`, 'error');
            } finally {
              setConfirmModal((prev) => ({ ...prev, isOpen: false }));
            }
          },
        });
      } catch {
        showToast('Nepodařilo se přečíst JSON soubor.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="mobile-9-16-outer">
      <div className="mobile-9-16-frame bg-stone-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        {/* Full-Screen Logo Loading Screen on App Startup & Before Map Loads */}
        {!splashRemoved && (
          <div
            className={`absolute md:fixed inset-0 z-[9999] bg-[#fbfaf5] flex flex-col items-center justify-center select-none overflow-hidden transition-opacity duration-500 ${
              isAppAndMapLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            aria-label="Načítání aplikace Horský zápisník"
          >
            <div className="w-[90%] aspect-square md:w-[min(94vw,86vh)] md:h-[min(94vw,86vh)] flex items-center justify-center overflow-hidden">
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/Gemini_Generated_Image_sdhf1zsdhf1zsdhf_fd6937b9.jpg`}
                alt="Horský zápisník logo"
                className="w-full h-full object-cover scale-[1.06] mix-blend-multiply animate-pulse"
                style={{ animationDuration: '2.8s' }}
              />
            </div>
            <div className="absolute bottom-6 sm:bottom-8 flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-stone-900/5 border border-stone-900/10 text-stone-700 text-xs sm:text-sm font-bold tracking-wide">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
              <span>Načítání mapy a tras…</span>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((prev) => ({ ...prev, message: null }))}
        />

        {/* Confirmation Dialog */}
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          isDestructive={confirmModal.isDestructive}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        />

        {/* Offline Mode & Map Download Modal */}
        <OfflineModal
          isOpen={isOfflineModalOpen}
          onClose={() => setIsOfflineModalOpen(false)}
          isOnline={isOnline}
          isManualOffline={isManualOffline}
          onToggleManualOffline={handleToggleManualOffline}
          isConnected={isConnected}
          hikes={hikes}
          plannedRoutes={plannedRoutes}
          selectedTrip={hikes.find((h) => h.id === selectedTripId) || null}
          selectedPlannedRoute={
            plannedRoutes.find((r) => r.id === selectedPlannedRouteId) || null
          }
          pendingCount={pendingCount}
          isSyncing={isSyncingOffline}
          onSyncNow={() => handleSyncOfflineQueue(true)}
          onNotify={showToast}
        />

        {/* Non-intrusive Offline Status Banner */}
        <OfflineIndicator
          isOnline={isOnline}
          isManualOffline={isManualOffline}
          pendingCount={pendingCount}
          isSyncing={isSyncingOffline}
          onClick={() => setIsOfflineModalOpen(true)}
        />

        {/* Printable Report View (Full Page) */}
        {activeTab === 'print' ? (
          <div className="flex-1 min-h-0 overflow-y-auto md:overflow-visible">
            <PrintReportView
              hikes={hikes}
              filterState={filterState}
              onFilterChange={(newFilters) =>
                setFilterState((prev) => ({ ...prev, ...newFilters }))
              }
              onBack={() => setActiveTab('map')}
              onNotify={showToast}
            />
          </div>
        ) : (
          <>
            {/* Top Navbar */}
            <Navbar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              isConnected={isConnected}
              isOffline={isOffline}
              isManualOffline={isManualOffline}
              pendingSyncCount={pendingCount}
              onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
              totalDistance={totalDistance}
              totalTrips={totalTrips}
              onNewHikeClick={() => {
                setEditingHike(null);
                setActiveTab('journal');
              }}
              onExportJson={handleExportJson}
              onExportExcel={handleExportExcel}
              onImportJson={handleImportJson}
              onImportGpx={handleImportGpx}
            />

            {/* Main Views Container */}
            <main className="flex-1 min-h-0 flex flex-col overflow-y-auto md:block md:overflow-visible">
            {/* TAB 1: Zápisník (Journal) */}
            {activeTab === 'journal' && (
              <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-7">
                <HikeForm
                  editingHike={editingHike}
                  onSave={handleSaveHike}
                  onCancelEdit={() => setEditingHike(null)}
                />

                <HikeList
                  hikes={hikes}
                  filterState={filterState}
                  onFilterChange={(newFilters) =>
                    setFilterState((prev) => ({ ...prev, ...newFilters }))
                  }
                  onEdit={(hike) => setEditingHike(hike)}
                  onDelete={handleDeleteHike}
                  onShowOnMap={handleShowOnMap}
                  onShowAnalytics={handleShowAnalytics}
                />
              </div>
            )}

            {/* TAB 2: Interaktivní mapa (Map) */}
            {activeTab === 'map' && (
              <MapView
                hikes={hikes}
                filterState={filterState}
                onFilterChange={(newFilters) =>
                  setFilterState((prev) => ({ ...prev, ...newFilters }))
                }
                selectedTripId={selectedTripId}
                selectedMapIndex={selectedMapIndex}
                onSelectTrip={(id, mIdx = null) => {
                  setSelectedTripId(id);
                  setSelectedMapIndex(mIdx !== undefined ? mIdx : null);
                }}
                onOpenAnalytics={(id) => {
                  if (id) setSelectedTripId(id);
                  setActiveTab('analytics');
                }}
                onOpen3D={() => setActiveTab('route3d')}
                onOpenPrint={() => setActiveTab('print')}
                onRefreshCloud={handleRefreshCloud}
                onMapReady={() => setIsMapReady(true)}
              />
            )}

            {/* SKRYTÁ SEKCE: 3D zobrazení vybrané trasy (bez levého panelu, pouze karta vybrané trasy) */}
            {activeTab === 'route3d' && (
              <Route3DView
                trip={hikes.find((h) => h.id === selectedTripId) || null}
                selectedMapIndex={selectedMapIndex}
                onSelectSegment={(mIdx) => setSelectedMapIndex(mIdx)}
                onBackTo2D={() => setActiveTab('map')}
                onOpenAnalytics={(id) => {
                  if (id) setSelectedTripId(id);
                  setActiveTab('analytics');
                }}
              />
            )}

            {/* TAB 3: Analytika (Analytics) */}
            {activeTab === 'analytics' && (
              <AnalyticsView
                hikes={hikes}
                initialTripId={selectedTripId}
                onSelectTripOnMap={(id) => {
                  setSelectedTripId(id);
                  setSelectedMapIndex(null);
                  setActiveTab('map');
                }}
              />
            )}

            {/* TAB 4: Milníky (Milestones) */}
            {activeTab === 'milestones' && (
              <MilestonesView
                hikes={hikes}
                onSelectTripOnMap={(id) => {
                  setSelectedTripId(id);
                  setSelectedMapIndex(null);
                  setActiveTab('map');
                }}
              />
            )}

            {/* TAB 5: Plánované trasy (Planned Routes) */}
            {activeTab === 'planned' && (
              <PlannedRoutesView
                plannedRoutes={plannedRoutes}
                selectedRouteId={selectedPlannedRouteId}
                onSelectRoute={setSelectedPlannedRouteId}
                onOpen3D={() => setActiveTab('planned3d')}
                onSavePlannedRoute={handleSavePlannedRoute}
                onDeletePlannedRoute={(id) => {
                  if (selectedPlannedRouteId === id) setSelectedPlannedRouteId(null);
                  handleDeletePlannedRoute(id);
                }}
              />
            )}

            {/* SKRYTÁ SEKCE: 3D zobrazení vybrané plánované trasy */}
            {activeTab === 'planned3d' && (
              <Route3DView
                plannedRoute={
                  plannedRoutes.find((r) => r.id === selectedPlannedRouteId) || null
                }
                plannedColor={(() => {
                  const idx = plannedRoutes.findIndex((r) => r.id === selectedPlannedRouteId);
                  const found = idx >= 0 ? plannedRoutes[idx] : null;
                  return (
                    found?.color ||
                    DISTINCT_ROUTE_COLORS[Math.max(0, idx) % DISTINCT_ROUTE_COLORS.length]
                  );
                })()}
                onBackTo2D={() => setActiveTab('planned')}
              />
            )}

            {/* TAB 6: Účastníci (Participants & Milestone Email Notifications) */}
            {activeTab === 'participants' && (
              <ParticipantsView
                hikes={hikes}
                participantProfiles={participantProfiles}
                onSaveProfile={handleSaveParticipantProfile}
                onNotify={showToast}
              />
            )}

            {/* TAB 7: Ubytování (Dog-friendly, 1-night tourist accommodation) */}
            {activeTab === 'accommodation' && (
              <AccommodationView
                hikes={hikes}
                plannedRoutes={plannedRoutes}
                onNotify={showToast}
              />
            )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
