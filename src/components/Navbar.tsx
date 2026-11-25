import React, { useState, useRef, useEffect } from 'react';
import {
  BookOpen,
  MapPin,
  BarChart3,
  Printer,
  Cloud,
  CloudOff,
  Download,
  Upload,
  FileSpreadsheet,
  FileUp,
  Menu,
  X,
  Trophy,
  Route,
  Compass,
  WifiOff,
  Smartphone,
} from 'lucide-react';
import { HikerIcon } from './ParticipantsView';
import { LOGO_DATA_URL } from '../assets/logoDataUrl';
import { usePWAInstall } from '../hooks/usePWAInstall';

export type ActiveTab =
  | 'journal'
  | 'map'
  | 'route3d'
  | 'planned'
  | 'planned3d'
  | 'accommodation'
  | 'analytics'
  | 'milestones'
  | 'participants'
  | 'print';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isConnected: boolean;
  isOffline: boolean;
  isManualOffline: boolean;
  pendingSyncCount: number;
  onOpenOfflineModal: () => void;
  totalDistance?: number;
  totalTrips?: number;
  onNewHikeClick?: () => void;
  onExportJson: () => void;
  onExportExcel: () => void;
  onImportJson: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportGpx: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isConnected,
  isOffline,
  isManualOffline,
  pendingSyncCount,
  onOpenOfflineModal,
  onExportJson,
  onExportExcel,
  onImportJson,
  onImportGpx,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const { canInstall, isInstalled, install } = usePWAInstall();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dataMenuRef.current && !dataMenuRef.current.contains(event.target as Node)) {
        setDataMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { id: 'map' as ActiveTab, label: 'Mapa a trasy', icon: MapPin, desc: 'Interaktivní zobrazení' },
    { id: 'planned' as ActiveTab, label: 'Plánované trasy', icon: Route, desc: 'Plánování a GPX' },
    { id: 'journal' as ActiveTab, label: 'Zápisník', icon: BookOpen, desc: 'Zadávání a správa' },
    { id: 'accommodation' as ActiveTab, label: 'Zázemí na trase', icon: Compass, desc: 'Ubytování, jídlo a parkování' },
    { id: 'analytics' as ActiveTab, label: 'Analytika', icon: BarChart3, desc: 'Statistiky a rekordy' },
    { id: 'milestones' as ActiveTab, label: 'Milníky', icon: Trophy, desc: 'Výzvy a trofeje' },
  ];

  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-[1500] shadow-xs select-none shrink-0">
      <div className="max-w-7xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('map')}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
            >
              <img
                src={LOGO_DATA_URL}
                alt="Horský zápisník logo"
                className="w-11 h-11 rounded-full object-contain shadow-sm group-hover:scale-105 transition-transform shrink-0"
              />
              <div>
                <div className="font-extrabold text-stone-900 tracking-tight text-base sm:text-lg flex items-center gap-1.5 whitespace-nowrap">
                  Horský zápisník
                </div>
                <div className="text-[11px] text-stone-500 hidden xl:block whitespace-nowrap">
                  Archív turistických tras a výšlapů
                </div>
              </div>
            </button>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-stone-100/90 p-1 rounded-xl border border-stone-200/80">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id ||
                (item.id === 'map' && activeTab === 'route3d') ||
                (item.id === 'planned' && activeTab === 'planned3d');
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white text-emerald-700 shadow-xs border border-stone-200/80 font-bold'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-white/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600' : 'text-stone-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Status & Quick Actions */}
          <div className="flex items-center gap-2">
            {/* Offline / Cloud Status Button (clickable on both mobile and desktop) */}
            <button
              type="button"
              onClick={onOpenOfflineModal}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-95 ${
                isOffline
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
                  : isConnected
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
              }`}
              title={
                isManualOffline
                  ? 'Ruční offline režim – klikněte pro nastavení a stažení map'
                  : isOffline
                  ? 'Offline režim (bez signálu) – klikněte pro správu'
                  : isConnected
                  ? 'Připojeno k Firebase Cloudu – klikněte pro offline režim a mapy'
                  : 'Lokální paměť – klikněte pro offline režim a synchronizaci'
              }
            >
              {isOffline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-[11px]">Offline</span>
                </>
              ) : isConnected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="text-[11px] hidden sm:inline">Cloud</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-[11px] hidden sm:inline">Lokální</span>
                </>
              )}
              {pendingSyncCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-600 text-white text-[10px] font-extrabold leading-tight">
                  {pendingSyncCount}
                </span>
              )}
            </button>

            {/* Desktop Tisk a PDF Button */}
            <button
              type="button"
              onClick={() => setActiveTab('print')}
              className={`hidden md:flex bg-white hover:bg-stone-50 border ${
                activeTab === 'print'
                  ? 'border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20'
                  : 'border-stone-200 text-stone-700'
              } px-3 py-2 rounded-xl text-xs font-semibold transition-all items-center gap-1.5 shadow-xs cursor-pointer`}
              title="Tisk a PDF sestava"
            >
              <Printer className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tisk a PDF</span>
            </button>

            {/* Desktop Účastníci Button (Hiker icon, placed between Tisk and Export) */}
            <button
              type="button"
              onClick={() => setActiveTab('participants')}
              className={`hidden md:flex bg-white hover:bg-stone-50 border ${
                activeTab === 'participants'
                  ? 'border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20'
                  : 'border-stone-200 text-stone-700'
              } p-2 rounded-xl text-xs transition-all items-center justify-center shadow-xs cursor-pointer`}
              title="Účastníci a e-mailové notifikace milníků"
            >
              <HikerIcon
                className={`w-4 h-4 ${
                  activeTab === 'participants' ? 'text-emerald-600' : 'text-stone-600'
                }`}
              />
            </button>

            {/* Desktop Data & GPX Menu */}
            <div
              ref={dataMenuRef}
              className="hidden md:block relative"
              onMouseEnter={() => setDataMenuOpen(true)}
              onMouseLeave={() => setDataMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => setDataMenuOpen((prev) => !prev)}
                className={`bg-white hover:bg-stone-50 border ${
                  dataMenuOpen ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-stone-200'
                } text-stone-700 p-2 rounded-xl text-xs transition-all flex items-center justify-center shadow-xs cursor-pointer`}
                title="Záloha, GPX a export dat"
              >
                <Download className="w-4 h-4 text-stone-600" />
              </button>

              {/* Dropdown with hover bridge (pt-1.5) and high z-index */}
              {dataMenuOpen && (
                <div className="absolute right-0 top-full pt-1.5 w-60 z-[1600]">
                  <div className="bg-white border border-stone-200 rounded-xl shadow-2xl p-2 space-y-1 text-xs">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-2.5 py-1">
                      GPX soubory
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDataMenuOpen(false);
                        gpxInputRef.current?.click();
                      }}
                      className="w-full text-left px-2.5 py-2 hover:bg-emerald-50 rounded-lg flex items-center gap-2.5 text-stone-700 hover:text-emerald-800 font-semibold transition-colors cursor-pointer"
                    >
                      <FileUp className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Nahrát GPX soubor</span>
                    </button>

                    <div className="border-t border-stone-100 my-1"></div>

                    <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-2.5 py-1">
                      Záloha a export dat
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDataMenuOpen(false);
                        onExportJson();
                      }}
                      className="w-full text-left px-2.5 py-2 hover:bg-stone-50 rounded-lg flex items-center gap-2.5 text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Export JSON (Záloha)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDataMenuOpen(false);
                        onExportExcel();
                      }}
                      className="w-full text-left px-2.5 py-2 hover:bg-stone-50 rounded-lg flex items-center gap-2.5 text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Export XLSX (Excel)</span>
                    </button>
                    <div className="border-t border-stone-100 my-1"></div>
                    <button
                      type="button"
                      onClick={() => {
                        setDataMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full text-left px-2.5 py-2 hover:bg-stone-50 rounded-lg flex items-center gap-2.5 text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>Importovat JSON</span>
                    </button>
                    <div className="border-t border-stone-100 my-1"></div>
                    <button
                      type="button"
                      onClick={() => {
                        setDataMenuOpen(false);
                        onOpenOfflineModal();
                      }}
                      className="w-full text-left px-2.5 py-2 hover:bg-amber-50 rounded-lg flex items-center gap-2.5 text-stone-700 hover:text-amber-900 font-semibold transition-colors cursor-pointer"
                    >
                      <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Offline režim a mapy</span>
                    </button>
                    {canInstall && !isInstalled && (
                      <button
                        type="button"
                        onClick={() => {
                          setDataMenuOpen(false);
                          void install();
                        }}
                        className="w-full text-left px-2.5 py-2 hover:bg-emerald-50 rounded-lg flex items-center gap-2.5 text-emerald-700 font-bold transition-colors cursor-pointer"
                      >
                        <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Nainstalovat aplikaci</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Version Label next to Export */}
            <span
              className="hidden md:inline-block text-[10px] font-medium text-stone-400 select-none ml-0.5"
              title="Verze aplikace 4.1"
            >
              v4.1
            </span>

            {/* Hidden File Inputs (shared between desktop and mobile) */}
            <input
              type="file"
              ref={gpxInputRef}
              accept=".gpx"
              className="hidden"
              onChange={onImportGpx}
            />
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              className="hidden"
              onChange={onImportJson}
            />

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50"
              title="Nástroje, účastníci a záloha dat"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Quick Navigation Strip (1-tap access to all primary sections) */}
        <div className="md:hidden flex items-center gap-1 pb-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'map' as ActiveTab, shortLabel: 'Mapa', icon: MapPin },
            { id: 'planned' as ActiveTab, shortLabel: 'Plánované', icon: Route },
            { id: 'journal' as ActiveTab, shortLabel: 'Zápisník', icon: BookOpen },
            { id: 'accommodation' as ActiveTab, shortLabel: 'Zázemí', icon: Compass },
            { id: 'analytics' as ActiveTab, shortLabel: 'Analytika', icon: BarChart3 },
            { id: 'milestones' as ActiveTab, shortLabel: 'Milníky', icon: Trophy },
          ].map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id ||
              (item.id === 'map' && activeTab === 'route3d') ||
              (item.id === 'planned' && activeTab === 'planned3d');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Navigation Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden py-3 border-t border-stone-200 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setActiveTab('map');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'map'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <MapPin className="w-4 h-4" />
                <span>Mapa a trasy</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('journal');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'journal'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                <span>Zápisník</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('planned');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'planned'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Route className="w-4 h-4" />
                <span>Plánované trasy</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('accommodation');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'accommodation'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span>Zázemí na trase</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('print');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'print'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Printer className="w-4 h-4 text-emerald-600" />
                <span>Tisk a PDF sestava</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('participants');
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                  activeTab === 'participants'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <HikerIcon className="w-4 h-4 text-emerald-600" />
                <span>Účastníci (notifikace)</span>
              </button>
            </div>

            {/* Záloha, GPX a export dat inside Mobile Menu */}
            <div className="pt-2 border-t border-stone-100 space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  GPX soubory, záloha a export dat
                </div>
                <span className="text-[10px] font-medium text-stone-400 select-none">v4.1</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    gpxInputRef.current?.click();
                  }}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/70 text-left"
                >
                  <FileUp className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Nahrát GPX</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onExportJson();
                  }}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold bg-stone-50 hover:bg-stone-100 text-stone-700 text-left"
                >
                  <Download className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Export JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onExportExcel();
                  }}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold bg-stone-50 hover:bg-stone-100 text-stone-700 text-left"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Export XLSX</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold bg-stone-50 hover:bg-stone-100 text-stone-700 text-left"
                >
                  <Upload className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Import JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenOfflineModal();
                  }}
                  className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold text-left border ${
                    isOffline
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200'
                  } ${canInstall && !isInstalled ? '' : 'col-span-2'}`}
                >
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Offline režim a mapy
                    {pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}
                  </span>
                </button>

                {canInstall && !isInstalled && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void install();
                    }}
                    className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white text-left"
                  >
                    <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Nainstalovat</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
