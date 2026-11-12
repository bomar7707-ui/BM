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
  Compass,
  Trophy,
  Route,
} from 'lucide-react';
import { HikerIcon } from './ParticipantsView';

export type ActiveTab =
  | 'journal'
  | 'map'
  | 'planned'
  | 'analytics'
  | 'milestones'
  | 'participants'
  | 'print';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isConnected: boolean;
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
    { id: 'analytics' as ActiveTab, label: 'Analytika', icon: BarChart3, desc: 'Statistiky a rekordy' },
    { id: 'milestones' as ActiveTab, label: 'Milníky', icon: Trophy, desc: 'Výzvy a trofeje' },
  ];

  return (
    <header className="bg-white border-b border-stone-200 sticky top-0 z-[1500] shadow-xs select-none">
      <div className="max-w-7xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab('map')}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
                <Compass className="w-5 h-5" />
              </div>
              <div>
                <div className="font-extrabold text-stone-900 tracking-tight text-base sm:text-lg flex items-center gap-1.5">
                  Horský zápisník
                </div>
                <div className="text-[11px] text-stone-500 hidden sm:block">
                  Archív turistických tras a výšlapů
                </div>
              </div>
            </button>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-stone-100/90 p-1 rounded-xl border border-stone-200/80">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white text-emerald-700 shadow-xs border border-stone-200/80 font-bold'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-white/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-stone-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Status & Quick Actions */}
          <div className="flex items-center gap-2">
            {/* Status Indicator */}
            <div
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                isConnected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
              title={isConnected ? 'Připojeno k Firebase Cloudu' : 'Režim offline / lokální paměť'}
            >
              {isConnected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-[11px]">Cloud</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[11px]">Lokální</span>
                </>
              )}
            </div>

            {/* Mobile Quick Buttons: Analytika & Milníky (replaces Tisk & Export on mobile) */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('analytics');
                setMobileMenuOpen(false);
              }}
              className={`md:hidden bg-white hover:bg-stone-50 border ${
                activeTab === 'analytics'
                  ? 'border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20'
                  : 'border-stone-200 text-stone-700'
              } p-2 rounded-xl text-xs transition-all flex items-center justify-center shadow-xs cursor-pointer`}
              title="Analytika"
            >
              <BarChart3
                className={`w-4 h-4 ${
                  activeTab === 'analytics' ? 'text-emerald-600' : 'text-stone-600'
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('milestones');
                setMobileMenuOpen(false);
              }}
              className={`md:hidden bg-white hover:bg-stone-50 border ${
                activeTab === 'milestones'
                  ? 'border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20'
                  : 'border-stone-200 text-stone-700'
              } p-2 rounded-xl text-xs transition-all flex items-center justify-center shadow-xs cursor-pointer`}
              title="Milníky"
            >
              <Trophy
                className={`w-4 h-4 ${
                  activeTab === 'milestones' ? 'text-emerald-600' : 'text-stone-600'
                }`}
              />
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
                  </div>
                </div>
              )}
            </div>

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
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
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
                className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-bold transition-all text-left col-span-2 ${
                  activeTab === 'participants'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <HikerIcon className="w-4 h-4 text-emerald-600" />
                <span>Účastníci (e-mailové notifikace milníků)</span>
              </button>
            </div>

            {/* Záloha, GPX a export dat inside Mobile Menu */}
            <div className="pt-2 border-t border-stone-100 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-1">
                GPX soubory, záloha a export dat
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
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
