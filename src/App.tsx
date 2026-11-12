import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { HikeForm } from './components/HikeForm';
import { HikeList } from './components/HikeList';
import { MapView } from './components/MapView';
import { AnalyticsView } from './components/AnalyticsView';
import { MilestonesView } from './components/MilestonesView';
import { PrintReportView } from './components/PrintReportView';
import { PlannedRoutesView } from './components/PlannedRoutesView';
import { ParticipantsView } from './components/ParticipantsView';
import { Toast, ToastType } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import { Hike, FilterState, RoutePart, PlannedRoute, ParticipantProfile } from './types';
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
} from './services/firebase';
import { exportHikesToExcel } from './utils/excelExport';
import { calculateDistanceKm, parseGpxXml } from './utils/gpxParser';
import { evaluateMilestonesForParticipant } from './utils/milestonesUtils';
import { sendMilestoneEmailNotification, downloadMilestoneCardPng } from './utils/milestoneCardGenerator';

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
  const [editingHike, setEditingHike] = useState<Hike | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedMapIndex, setSelectedMapIndex] = useState<number | null>(null);

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

  // Subscribe to Firebase Live Snapshot
  useEffect(() => {
    const unsubscribe = subscribeToHikesLive(
      (data) => {
        setHikes(data);
        setIsConnected(true);
      },
      (err) => {
        console.warn('Firebase error:', err);
        setIsConnected(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Subscribe to Planned Routes Live Snapshot
  useEffect(() => {
    const unsubscribePlanned = subscribeToPlannedRoutesLive((data) => {
      setPlannedRoutes(data);
    });
    return () => {
      unsubscribePlanned();
    };
  }, []);

  // Subscribe to Participant Profiles Live Snapshot
  useEffect(() => {
    const unsubscribeParticipants = subscribeToParticipantsLive((data) => {
      setParticipantProfiles(data);
    });
    return () => {
      unsubscribeParticipants();
    };
  }, []);

  // Total stats
  const { totalDistance, totalTrips } = useMemo(() => {
    const totalKm = hikes.reduce((sum, h) => {
      const d = typeof h.distance === 'string' ? parseFloat(h.distance) : h.distance;
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

  // Handle saving new or edited hike
  const handleSaveHike = async (hikeData: {
    name: string;
    distance: number;
    date: string;
    dateTo?: string;
    participants?: string;
    note?: string;
    routes: RoutePart[];
  }) => {
    const previousHikes = [...hikes];

    if (editingHike) {
      await updateHike(editingHike.id, hikeData);
      const simulatedUpdated: Hike = {
        ...editingHike,
        name: hikeData.name,
        distance: hikeData.distance.toFixed(1),
        date: hikeData.date,
        rawDate: hikeData.date,
        dateTo: hikeData.dateTo || '',
        participants: hikeData.participants || '',
        note: hikeData.note || '',
        routes: hikeData.routes,
        maps: hikeData.routes,
      };
      const updatedList = previousHikes.map((h) =>
        h.id === editingHike.id ? simulatedUpdated : h
      );
      setEditingHike(null);
      showToast('Výšlap byl úspěšně upraven v cloudu', 'success');
      await checkAndNotifyNewMilestones(previousHikes, updatedList, hikeData.participants);
    } else {
      const newId = await addHike(hikeData);
      const simulatedNew: Hike = {
        id: newId,
        name: hikeData.name,
        distance: hikeData.distance.toFixed(1),
        date: hikeData.date,
        rawDate: hikeData.date,
        dateTo: hikeData.dateTo || '',
        participants: hikeData.participants || '',
        note: hikeData.note || '',
        routes: hikeData.routes,
        maps: hikeData.routes,
      };
      const updatedList = [simulatedNew, ...previousHikes];
      showToast('Nový výšlap byl úspěšně uložen do cloudu', 'success');
      await checkAndNotifyNewMilestones(previousHikes, updatedList, hikeData.participants);
    }
  };

  // Handle delete hike
  const handleDeleteHike = (id: string) => {
    const hike = hikes.find((h) => h.id === id);
    setConfirmModal({
      isOpen: true,
      title: 'Smazat záznam z Cloudu',
      message: `Opravdu chcete smazat výšlap "${hike?.name || 'Zvolený výšlap'}"? Data budou trvale odstraněna z Firebase.`,
      confirmText: 'Ano, smazat',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await deleteHike(id);
          if (editingHike?.id === id) setEditingHike(null);
          if (selectedTripId === id) setSelectedTripId(null);
          showToast('Výšlap byl smazán z cloudu', 'success');
        } catch (err: unknown) {
          const e = err as Error;
          showToast(`Chyba při mazání: ${e?.message || 'Zkuste to znovu'}`, 'error');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  // Handle save or update Planned Route
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
      try {
        await updatePlannedRoute(editingId, routeData);
        showToast('Plánovaná trasa byla upravena', 'success');
      } catch {
        const next = plannedRoutes.map((r) => (r.id === editingId ? updatedItem : r));
        setPlannedRoutes(next);
        savePlannedRoutesToStorageSafe(next);
        showToast('Plánovaná trasa byla upravena lokálně', 'success');
      }
      return editingId;
    } else {
      try {
        const newId = await addPlannedRoute(routeData);
        showToast('Plánovaná trasa byla uložena', 'success');
        return newId;
      } catch {
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
        showToast('Plánovaná trasa uložena do paměti prohlížeče', 'success');
        return localId;
      }
    }
  };

  // Handle delete Planned Route
  const handleDeletePlannedRoute = (id: string) => {
    const target = plannedRoutes.find((r) => r.id === id);
    setConfirmModal({
      isOpen: true,
      title: 'Smazat plánovanou trasu',
      message: `Opravdu chcete odstranit plánovanou trasu "${target?.name || 'Zvolená trasa'}"?`,
      confirmText: 'Ano, smazat',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await deletePlannedRoute(id);
          const next = plannedRoutes.filter((r) => r.id !== id);
          setPlannedRoutes(next);
          savePlannedRoutesToStorageSafe(next);
          showToast('Plánovaná trasa byla smazána', 'success');
        } catch {
          const next = plannedRoutes.filter((r) => r.id !== id);
          setPlannedRoutes(next);
          savePlannedRoutesToStorageSafe(next);
          showToast('Plánovaná trasa byla odstraněna', 'success');
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
    try {
      const data = await fetchAllHikes();
      setHikes(data);
      setIsConnected(true);
      showToast(`Úspěšně načteno ${data.length} tras ze Zápisníku!`, 'success');
    } catch (err: unknown) {
      const e = err as Error;
      showToast(`Chyba synchronizace: ${e?.message || 'Zkontrolujte připojení'}`, 'error');
    }
  };

  // Add GPX directly to archive
  const handleAddGpxTrip = async (newTrip: Hike): Promise<string> => {
    try {
      const docId = await addHike({
        name: newTrip.name,
        distance: typeof newTrip.distance === 'string' ? parseFloat(newTrip.distance) : newTrip.distance,
        date: newTrip.date,
        routes: newTrip.routes || [],
      });
      newTrip.id = docId;
      showToast('GPX trasa byla uložena do archívu', 'success');
      return docId;
    } catch {
      // Save locally if cloud write fails
      const updated = [newTrip, ...hikes];
      setHikes(updated);
      saveHikesToStorageSafe(updated);
      showToast('GPX nahráno do lokální paměti', 'warning');
      return newTrip.id;
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

      let distKm = 0;
      for (let i = 1; i < coords.length; i++) {
        distKm += calculateDistanceKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      }

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
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
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

      {/* Printable Report View (Full Page) */}
      {activeTab === 'print' ? (
        <PrintReportView
          hikes={hikes}
          filterState={filterState}
          onFilterChange={(newFilters) =>
            setFilterState((prev) => ({ ...prev, ...newFilters }))
          }
          onBack={() => setActiveTab('map')}
          onNotify={showToast}
        />
      ) : (
        <>
          {/* Top Navbar */}
          <Navbar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isConnected={isConnected}
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
          <main className="flex-1">
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
                onOpenPrint={() => setActiveTab('print')}
                onRefreshCloud={handleRefreshCloud}
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
                onSavePlannedRoute={handleSavePlannedRoute}
                onDeletePlannedRoute={handleDeletePlannedRoute}
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
          </main>
        </>
      )}
    </div>
  );
}
