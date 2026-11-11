import React, { useMemo } from 'react';
import {
  Calendar,
  Route,
  Users,
  MapPin,
  Camera,
  Youtube,
  Download,
  Trash2,
  Edit3,
  Filter,
  BarChart2,
  Compass,
  Search,
} from 'lucide-react';
import { Hike, FilterState } from '../types';
import { parseSafeDate, getDisplayDateRange } from '../utils/dateUtils';
import { getSegmentDistanceKm } from '../utils/gpxParser';

interface HikeListProps {
  hikes: Hike[];
  filterState: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
  onEdit: (hike: Hike) => void;
  onDelete: (id: string) => void;
  onShowOnMap: (hikeId: string) => void;
  onShowAnalytics: (hikeId: string) => void;
}

export const HikeList: React.FC<HikeListProps> = ({
  hikes,
  filterState,
  onFilterChange,
  onEdit,
  onDelete,
  onShowOnMap,
  onShowAnalytics,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');

  // Extract all distinct years and participants for filter dropdowns
  const { availableYears, availableParticipants } = useMemo(() => {
    const years = new Set<number>();
    const parts = new Set<string>();

    hikes.forEach((h) => {
      const d = parseSafeDate(h.rawDate) || parseSafeDate(h.date?.split('–')[0]) || parseSafeDate(h.date?.split('-')[0]);
      if (d && !isNaN(d.getFullYear())) {
        years.add(d.getFullYear());
      }
      if (h.participants) {
        h.participants.split(',').forEach((p) => {
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

  // Filtered and sorted list
  const filteredHikes = useMemo(() => {
    return hikes
      .filter((h) => {
        const d = parseSafeDate(h.rawDate) || parseSafeDate(h.date?.split('–')[0]) || parseSafeDate(h.date?.split('-')[0]);

        if (filterState.year !== 'all') {
          if (!d || d.getFullYear().toString() !== filterState.year) return false;
        }

        if (filterState.month !== 'all') {
          if (!d || (d.getMonth() + 1).toString() !== filterState.month) return false;
        }

        if (filterState.participant !== 'all') {
          if (!h.participants || !h.participants.toLowerCase().includes(filterState.participant.toLowerCase())) {
            return false;
          }
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = h.name.toLowerCase().includes(q);
          const matchNote = h.note ? h.note.toLowerCase().includes(q) : false;
          const matchPart = h.participants ? h.participants.toLowerCase().includes(q) : false;
          if (!matchName && !matchNote && !matchPart) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const dateA =
          parseSafeDate(a.rawDate) || parseSafeDate(a.date?.split('–')[0]) || parseSafeDate(a.date?.split('-')[0]) || new Date(0);
        const dateB =
          parseSafeDate(b.rawDate) || parseSafeDate(b.date?.split('–')[0]) || parseSafeDate(b.date?.split('-')[0]) || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
  }, [hikes, filterState, searchQuery]);

  const filteredDistance = useMemo(() => {
    return filteredHikes.reduce((sum, h) => {
      const d = typeof h.distance === 'string' ? parseFloat(h.distance) : h.distance;
      return sum + (isNaN(d) ? 0 : d);
    }, 0);
  }, [filteredHikes]);

  const renderLinkifiedText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-700 hover:text-emerald-900 underline font-medium break-all"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="space-y-5">
      {/* Filters & Statistics Header */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-stone-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Compass className="w-5 h-5 text-emerald-600" />
              <span>Historie výšlapů</span>
            </h3>
            <span className="text-xs bg-stone-100 text-stone-600 font-bold px-2 py-0.5 rounded-full">
              {filteredHikes.length} z {hikes.length}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-900 bg-emerald-50 px-3.5 py-1.5 rounded-xl border border-emerald-200 shadow-2xs self-start sm:self-auto">
            <Route className="w-4 h-4 text-emerald-600" />
            <span>Součet: {filteredDistance.toFixed(1)} km</span>
          </div>
        </div>

        {/* Filter inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Search box */}
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Hledat název, poznámku..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800"
            />
          </div>

          {/* Year */}
          <div>
            <select
              value={filterState.year}
              onChange={(e) => onFilterChange({ year: e.target.value })}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800 font-medium"
            >
              <option value="all">Všechny roky</option>
              {availableYears.map((y) => (
                <option key={y} value={y.toString()}>
                  Rok {y}
                </option>
              ))}
            </select>
          </div>

          {/* Month */}
          <div>
            <select
              value={filterState.month}
              onChange={(e) => onFilterChange({ month: e.target.value })}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800 font-medium"
            >
              <option value="all">Všechny měsíce</option>
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

          {/* Participant */}
          <div>
            <select
              value={filterState.participant}
              onChange={(e) => onFilterChange({ participant: e.target.value })}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800 font-medium"
            >
              <option value="all">Všichni účastníci</option>
              {availableParticipants.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* List items */}
      {filteredHikes.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 border border-stone-200 border-dashed text-center">
          <Filter className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <h4 className="text-stone-700 font-bold text-sm">Nenalezeny žádné výšlapy</h4>
          <p className="text-stone-500 text-xs mt-1">
            Zkuste upravit filtry nebo vyhledávání výše.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredHikes.map((hike) => {
            const routes = hike.routes || hike.maps || [];
            const isMultiDay = Boolean(hike.dateTo && hike.dateTo !== hike.date);
            const distNum = typeof hike.distance === 'string' ? parseFloat(hike.distance) : hike.distance;

            return (
              <div
                key={hike.id}
                className="bg-white p-4 sm:p-5 rounded-2xl border border-stone-200 shadow-2xs hover:shadow-md transition-shadow relative overflow-hidden group space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4
                        onClick={() => onEdit(hike)}
                        className="text-base sm:text-lg font-bold text-stone-900 hover:text-emerald-700 cursor-pointer transition-colors"
                        title="Klikněte pro úpravu výšlapu"
                      >
                        {hike.name}
                      </h4>
                      {isMultiDay && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                          Vícedenní
                        </span>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-2.5 text-xs text-stone-600">
                      <span className="flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-100">
                        <Route className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          {routes.length > 1 ? 'Celkem: ' : ''}
                          {!isNaN(distNum) ? distNum.toFixed(1) : hike.distance} km
                        </span>
                      </span>

                      <span className="flex items-center gap-1 text-stone-500 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        <span>{getDisplayDateRange(hike)}</span>
                      </span>

                      {hike.participants && (
                        <span className="flex items-center gap-1 text-stone-600 bg-stone-50 px-2 py-0.5 rounded-md border border-stone-200">
                          <Users className="w-3 h-3 text-stone-400" />
                          <span>{hike.participants}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex items-center gap-1.5 shrink-0 self-start">
                    <button
                      onClick={() => onShowOnMap(hike.id)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl transition-all shadow-2xs hover:scale-102"
                      title="Zobrazit a zvýraznit na interaktivní mapě"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Mapa</span>
                    </button>

                    <button
                      onClick={() => onShowAnalytics(hike.id)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 px-2.5 py-1.5 rounded-xl transition-colors border border-stone-200"
                      title="Zobrazit statistiky této trasy"
                    >
                      <BarChart2 className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="hidden sm:inline">Statistiky</span>
                    </button>

                    <button
                      onClick={() => onEdit(hike)}
                      className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
                      title="Upravit záznam"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDelete(hike.id)}
                      className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Smazat záznam z Cloudu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Multi-Section Routes Pills */}
                {routes.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-stone-100">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                      Úseky trasy ({routes.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {routes.map((r, idx) => {
                        const linkUrl = r.link || r.url;
                        const photoUrl = r.photosUrl || r.photos;
                        const videoUrl = r.youtube || r.video;
                        const hasGpx = r.hasGpx || Boolean(r.coordinates && r.coordinates.length > 0);
                        const segDist = getSegmentDistanceKm(r, routes.length, hike.distance);

                        return (
                          <div
                            key={idx}
                            className="bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-lg flex items-center gap-2 text-xs"
                          >
                            <span className="font-semibold text-stone-600 text-[11px] flex items-center gap-1.5">
                              <span>{routes.length > 1 ? `Úsek ${idx + 1}` : 'Trasa'}:</span>
                              {segDist !== null && (
                                <span className="font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80 text-[10px]">
                                  {segDist.toFixed(1)} km
                                </span>
                              )}
                            </span>

                            {linkUrl && (
                              <a
                                href={linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900 bg-emerald-100/60 px-1.5 py-0.5 rounded text-[11px] transition-colors"
                              >
                                <MapPin className="w-3 h-3" />
                                <span>Mapa</span>
                              </a>
                            )}

                            {photoUrl && (
                              <a
                                href={photoUrl.startsWith('http') ? photoUrl : `https://${photoUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:text-amber-900 bg-amber-100/60 px-1.5 py-0.5 rounded text-[11px] transition-colors"
                              >
                                <Camera className="w-3 h-3" />
                                <span>Fotky</span>
                              </a>
                            )}

                            {videoUrl && (
                              <a
                                href={videoUrl.startsWith('http') ? videoUrl : `https://${videoUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-rose-700 hover:text-rose-900 bg-rose-100/60 px-1.5 py-0.5 rounded text-[11px] transition-colors"
                              >
                                <Youtube className="w-3 h-3" />
                                <span>Video</span>
                              </a>
                            )}

                            {r.gpxData ? (
                              <a
                                href={`data:application/gpx+xml;charset=utf-8,${encodeURIComponent(r.gpxData)}`}
                                download={`${(hike.name + (routes.length > 1 ? `_usek_${idx + 1}` : ''))
                                  .replace(/[^a-z0-9]/gi, '_')
                                  .toLowerCase()}.gpx`}
                                className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:text-sky-900 bg-sky-100/60 hover:bg-sky-200/70 px-1.5 py-0.5 rounded text-[11px] transition-colors"
                                title="Stáhnout GPX soubor"
                              >
                                <Download className="w-3 h-3" />
                                <span>GPX</span>
                              </a>
                            ) : hasGpx ? (
                              <span
                                className="inline-flex items-center gap-1 font-semibold text-sky-700 bg-sky-100/60 px-1.5 py-0.5 rounded text-[11px]"
                                title="Trasa má k dispozici souřadnice / výškový profil"
                              >
                                <Download className="w-3 h-3" />
                                <span>GPX</span>
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Note */}
                {hike.note && (
                  <div className="text-xs text-stone-600 bg-stone-50/80 p-2.5 rounded-xl border-l-2 border-emerald-500 whitespace-pre-line leading-relaxed">
                    {renderLinkifiedText(hike.note)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
