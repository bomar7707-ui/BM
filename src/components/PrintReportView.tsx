import React, { useMemo, useState } from 'react';
import {
  Printer,
  Download,
  ArrowLeft,
  Route,
  Users,
  Calendar,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { Hike, Coordinate, FilterState } from '../types';
import {
  createShapeDataUrl,
  createProfileDataUrl,
  exportFilteredHikesToPdf,
  formatFilterSummary,
} from '../utils/pdfCanvas';
import { parseSafeDate, getDisplayDateRange } from '../utils/dateUtils';

interface PrintReportViewProps {
  hikes: Hike[];
  filterState: FilterState;
  onFilterChange: (newFilters: Partial<FilterState>) => void;
  onBack: () => void;
  onNotify?: (message: string, type?: 'success' | 'warning' | 'error') => void;
}

export const PrintReportView: React.FC<PrintReportViewProps> = ({
  hikes,
  filterState,
  onFilterChange,
  onBack,
  onNotify,
}) => {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Extract available years and participants for filter bar
  const { availableYears, availableParticipants } = useMemo(() => {
    const years = new Set<number>();
    const parts = new Set<string>();

    hikes.forEach((t) => {
      const d =
        parseSafeDate(t.rawDate) ||
        parseSafeDate(t.date?.split('–')[0]) ||
        parseSafeDate(t.date?.split('-')[0]);
      if (d && !isNaN(d.getFullYear())) years.add(d.getFullYear());
      if (t.participants) {
        t.participants.split(',').forEach((p) => {
          const clean = p.trim();
          if (clean) parts.add(clean);
        });
      }
    });

    return {
      availableYears: Array.from(years).sort((a, b) => b - a),
      availableParticipants: Array.from(parts).sort(),
    };
  }, [hikes]);

  // Filter hikes using the same filters selected in "Mapa a trasy" and sort newest to oldest
  const filteredTrips = useMemo(() => {
    return hikes
      .filter((trip) => {
        const d =
          parseSafeDate(trip.rawDate) ||
          parseSafeDate(trip.date?.split('–')[0]) ||
          parseSafeDate(trip.date?.split('-')[0]);

        if (filterState.year !== 'all') {
          if (!d || d.getFullYear().toString() !== filterState.year) return false;
        }
        if (filterState.month !== 'all') {
          if (!d || (d.getMonth() + 1).toString() !== filterState.month) return false;
        }
        if (filterState.participant !== 'all') {
          if (
            !trip.participants ||
            !trip.participants.toLowerCase().includes(filterState.participant.toLowerCase())
          ) {
            return false;
          }
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
  }, [hikes, filterState]);

  // Pre-generate thumbnails for filtered trips
  const renderedItems = useMemo(() => {
    return filteredTrips.map((hike, index) => {
      const routes = hike.routes || hike.maps || [];
      let allCoords: Coordinate[] = [];
      routes.forEach((m) => {
        if (m.coordinates) allCoords = allCoords.concat(m.coordinates);
      });

      let shapeImg = '';
      let profileImg = '';

      if (allCoords.length > 0) {
        shapeImg = createShapeDataUrl(allCoords);

        const ptsWithEle = allCoords.filter(
          (p) => p.length >= 3 && typeof p[2] === 'number' && !isNaN(p[2])
        );
        if (ptsWithEle.length > 1) {
          let minE = Infinity;
          let maxE = -Infinity;
          ptsWithEle.forEach((p) => {
            const ele = p[2] as number;
            if (ele < minE) minE = ele;
            if (ele > maxE) maxE = ele;
          });
          profileImg = createProfileDataUrl(ptsWithEle, minE, maxE);
        }
      }

      return {
        hike,
        index: index + 1,
        shapeImg,
        profileImg,
      };
    });
  }, [filteredTrips]);

  const totalKm = useMemo(() => {
    return filteredTrips.reduce((acc, h) => {
      const d = typeof h.distance === 'string' ? parseFloat(h.distance) : h.distance;
      return acc + (isNaN(d) ? 0 : d);
    }, 0);
  }, [filteredTrips]);

  const handleSavePdf = () => {
    if (filteredTrips.length === 0) {
      onNotify?.('Žádné trasy neodpovídají zvoleným filtrům.', 'warning');
      return;
    }
    setIsGeneratingPdf(true);
    setTimeout(() => {
      try {
        exportFilteredHikesToPdf(filteredTrips, filterState, {
          autoPrint: false,
          filename: `horsky-zapisnik-sestava-${new Date().toISOString().slice(0, 10)}.pdf`,
        });
        onNotify?.(`PDF sestava (${filteredTrips.length} tras) byla uložena.`, 'success');
      } catch (err) {
        console.error('PDF export error:', err);
        onNotify?.('Chyba při generování PDF souboru.', 'error');
      } finally {
        setIsGeneratingPdf(false);
      }
    }, 50);
  };

  const handlePrint = () => {
    if (filteredTrips.length === 0) {
      onNotify?.('Žádné trasy neodpovídají zvoleným filtrům.', 'warning');
      return;
    }
    const t0 = Date.now();
    try {
      window.focus();
      window.print();
    } catch {
      // ignore
    }
    const elapsed = Date.now() - t0;
    // In sandboxed iframes where window.print() does not open a modal dialog,
    // automatically generate and download an auto-print PDF document.
    if (elapsed < 250) {
      setIsGeneratingPdf(true);
      setTimeout(() => {
        try {
          exportFilteredHikesToPdf(filteredTrips, filterState, {
            autoPrint: true,
            filename: `horsky-zapisnik-tisk-${new Date().toISOString().slice(0, 10)}.pdf`,
          });
          onNotify?.(
            'Přímý tisk je v náhledovém okně omezen – byl stažen PDF dokument připravený k tisku.',
            'success'
          );
        } finally {
          setIsGeneratingPdf(false);
        }
      }, 50);
    }
  };

  const hasActiveFilter =
    filterState.year !== 'all' ||
    filterState.month !== 'all' ||
    filterState.participant !== 'all';

  return (
    <div className="bg-white min-h-screen text-slate-900">
      {/* Top action bar - hidden on print */}
      <div className="no-print sticky top-0 z-50 bg-emerald-700 text-white shadow-md">
        <div className="max-w-5xl mx-auto p-3 px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 text-white px-3.5 py-2 rounded-xl font-bold text-xs transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Zpět na mapu</span>
          </button>

          <div className="text-center hidden md:block">
            <div className="font-extrabold text-sm">Horský zápisník – Tisková sestava a PDF</div>
            <div className="text-[11px] text-emerald-100">
              Zobrazeno {filteredTrips.length} z {hikes.length} výšlapů | {totalKm.toFixed(1)} km
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSavePdf}
              disabled={isGeneratingPdf || filteredTrips.length === 0}
              className="flex items-center gap-2 bg-white hover:bg-emerald-50 disabled:opacity-60 text-emerald-800 px-4 py-2 rounded-xl font-extrabold text-xs shadow-md transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>{isGeneratingPdf ? 'Generuji PDF...' : 'Uložit do PDF'}</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={isGeneratingPdf || filteredTrips.length === 0}
              className="flex items-center gap-2 bg-emerald-900/60 hover:bg-emerald-900/80 disabled:opacity-60 text-white border border-emerald-400/40 px-4 py-2 rounded-xl font-extrabold text-xs shadow-md transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Vytisknout</span>
            </button>
          </div>
        </div>

        {/* Synchronized Filter Bar from Mapa a trasy */}
        <div className="bg-emerald-800/90 border-t border-emerald-600/50 px-4 sm:px-6 py-2.5">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-100 font-semibold">
              <Filter className="w-3.5 h-3.5 text-emerald-300" />
              <span>Filtry sestavy (podle Mapy a tras):</span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-emerald-200 font-medium">Rok:</label>
                <select
                  value={filterState.year}
                  onChange={(e) => onFilterChange({ year: e.target.value })}
                  className="bg-emerald-950/60 border border-emerald-500/40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold outline-none"
                >
                  <option value="all">Všechny</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y.toString()}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-emerald-200 font-medium">Měsíc:</label>
                <select
                  value={filterState.month}
                  onChange={(e) => onFilterChange({ month: e.target.value })}
                  className="bg-emerald-950/60 border border-emerald-500/40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold outline-none"
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

              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-emerald-200 font-medium">Účastník:</label>
                <select
                  value={filterState.participant}
                  onChange={(e) => onFilterChange({ participant: e.target.value })}
                  className="bg-emerald-950/60 border border-emerald-500/40 text-white rounded-lg px-2.5 py-1 text-xs font-semibold outline-none"
                >
                  <option value="all">Všichni</option>
                  {availableParticipants.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {hasActiveFilter && (
                <button
                  onClick={() =>
                    onFilterChange({ year: 'all', month: 'all', participant: 'all' })
                  }
                  className="flex items-center gap-1 bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                  title="Zrušit všechny filtry"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Všechny trasy</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Printable Document Body */}
      <div className="max-w-4xl mx-auto p-6 sm:p-10 space-y-6">
        {/* Title Header */}
        <div className="text-center space-y-1.5 border-b border-slate-200 pb-5">
          <div className="w-24 h-24 mx-auto rounded-full overflow-hidden flex items-center justify-center mb-2">
            <img
              src={`${import.meta.env.BASE_URL}assets/aistudio/Gemini_Generated_Image_sdhf1zsdhf1zsdhf_fd6937b9.jpg`}
              alt="Horský zápisník logo"
              className="w-full h-full object-cover scale-[1.08] mix-blend-multiply"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Horský zápisník & Archív tras
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold">
            Přehled výšlapů a turistických tras • Celkem {filteredTrips.length} položek (
            {totalKm.toFixed(1)} km)
          </p>
          <p className="text-xs text-slate-500 font-medium">
            {formatFilterSummary(filterState)}
          </p>
        </div>

        {/* List of hike cards */}
        {renderedItems.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-sm">
            Žádné trasy neodpovídají zvoleným filtrům.
          </div>
        ) : (
          <div className="space-y-5">
            {renderedItems.map(({ hike, index, shapeImg, profileImg }) => (
              <div
                key={hike.id}
                className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-white break-inside-avoid space-y-3 shadow-2xs"
              >
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-2.5">
                  <h3 className="text-base font-bold text-slate-900">
                    {index}. {hike.name}
                  </h3>
                  <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-stone-400" />
                    {getDisplayDateRange(hike)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1 font-semibold text-emerald-800">
                    <Route className="w-3.5 h-3.5 text-emerald-600" />
                    Vzdálenost: {hike.distance} km
                  </span>
                  {hike.participants && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-stone-400" />
                      Účastníci: {hike.participants}
                    </span>
                  )}
                </div>

                {/* Thumbnails row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Shape preview */}
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Tvar trasy
                    </div>
                    {shapeImg ? (
                      <img
                        src={shapeImg}
                        alt="Tvar trasy"
                        className="max-h-28 mx-auto rounded-lg object-contain"
                      />
                    ) : (
                      <div className="h-24 flex items-center justify-center text-xs text-slate-400 italic">
                        Bez mapových bodů
                      </div>
                    )}
                  </div>

                  {/* Elevation profile preview */}
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Výškový profil
                    </div>
                    {profileImg ? (
                      <img
                        src={profileImg}
                        alt="Výškový profil"
                        className="max-h-28 mx-auto rounded-lg object-contain"
                      />
                    ) : (
                      <div className="h-24 flex items-center justify-center text-xs text-slate-400 italic">
                        Bez výškových dat
                      </div>
                    )}
                  </div>
                </div>

                {/* Note if present */}
                {hike.note && (
                  <div className="text-xs text-slate-600 italic bg-slate-50 p-2.5 rounded-lg border-l-2 border-emerald-500">
                    {hike.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
