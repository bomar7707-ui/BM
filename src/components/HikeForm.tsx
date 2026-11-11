import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Trash2,
  MapPin,
  Camera,
  Youtube,
  FileCode,
  Save,
  X,
  Compass,
  Calendar,
  Users,
  FileText,
  CheckCircle2,
  AlertCircle,
  Route,
} from 'lucide-react';
import { Hike, RoutePart } from '../types';
import {
  parseGpxXml,
  calculateCoordsDistanceKm,
  getSegmentDistanceKm,
} from '../utils/gpxParser';

interface HikeFormProps {
  editingHike: Hike | null;
  onSave: (hikeData: {
    name: string;
    distance: number;
    date: string;
    dateTo?: string;
    participants?: string;
    note?: string;
    routes: RoutePart[];
  }) => Promise<void>;
  onCancelEdit: () => void;
}

export const HikeForm: React.FC<HikeFormProps> = ({
  editingHike,
  onSave,
  onCancelEdit,
}) => {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState('');
  const [participants, setParticipants] = useState('');
  const [note, setNote] = useState('');
  const [routes, setRoutes] = useState<RoutePart[]>([
    {
      distance: '',
      link: '',
      photosUrl: '',
      youtube: '',
      gpxData: null,
      gpxName: '',
      coordinates: [],
      visible: true,
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  // Sum of all route segment distances
  const totalCalculatedDistance = useMemo(() => {
    const sum = routes.reduce((acc, r) => {
      const val =
        r.distance !== undefined && r.distance !== ''
          ? parseFloat(String(r.distance).replace(',', '.'))
          : NaN;
      return acc + (!isNaN(val) && val > 0 ? val : 0);
    }, 0);
    return Math.round(sum * 10) / 10;
  }, [routes]);

  useEffect(() => {
    if (editingHike) {
      setName(editingHike.name || '');
      setDate(editingHike.date || editingHike.rawDate || new Date().toISOString().slice(0, 10));
      setDateTo(editingHike.dateTo || editingHike.endDate || '');
      setParticipants(editingHike.participants || '');
      setNote(editingHike.note || '');

      const initialRoutes = editingHike.routes || editingHike.maps || [];
      if (initialRoutes.length > 0) {
        const mappedRoutes = initialRoutes.map((r) => {
          const segDist = getSegmentDistanceKm(r, initialRoutes.length, editingHike.distance);
          return {
            distance: segDist !== null ? String(segDist) : '',
            link: r.link || r.url || '',
            photosUrl: r.photosUrl || r.photos || '',
            youtube: r.youtube || r.video || '',
            gpxData: r.gpxData || null,
            gpxName: r.gpxName || (r.hasGpx ? 'GPX trasa' : ''),
            coordinates: r.coordinates || [],
            visible: r.visible !== false,
          };
        });

        // If multi-segment legacy hike had no segment distances or GPX coords at all, preserve total on segment 1
        const anyHasDist = mappedRoutes.some(
          (r) => r.distance !== '' && parseFloat(String(r.distance)) > 0
        );
        if (!anyHasDist && editingHike.distance) {
          const fallbackNum = parseFloat(String(editingHike.distance));
          if (!isNaN(fallbackNum) && fallbackNum > 0) {
            mappedRoutes[0].distance = String(fallbackNum);
          }
        }

        setRoutes(mappedRoutes);
      } else if (editingHike.gpx) {
        const coords = parseGpxXml(editingHike.gpx);
        const gpxDist = calculateCoordsDistanceKm(coords);
        const fallbackDist =
          parseFloat(String(editingHike.distance || '')) ||
          (gpxDist > 0 ? Math.round(gpxDist * 10) / 10 : '');
        setRoutes([
          {
            distance: fallbackDist ? String(fallbackDist) : '',
            link: '',
            photosUrl: '',
            youtube: '',
            gpxData: editingHike.gpx,
            gpxName: 'Původní GPX',
            coordinates: coords,
            visible: true,
          },
        ]);
      } else {
        setRoutes([
          {
            distance: editingHike.distance ? String(editingHike.distance) : '',
            link: '',
            photosUrl: '',
            youtube: '',
            gpxData: null,
            gpxName: '',
            coordinates: [],
            visible: true,
          },
        ]);
      }

      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      resetForm();
    }
  }, [editingHike]);

  const resetForm = () => {
    setName('');
    setDate(new Date().toISOString().slice(0, 10));
    setDateTo('');
    setParticipants('');
    setNote('');
    setRoutes([
      {
        distance: '',
        link: '',
        photosUrl: '',
        youtube: '',
        gpxData: null,
        gpxName: '',
        coordinates: [],
        visible: true,
      },
    ]);
    setErrorMsg(null);
  };

  const addRouteSection = () => {
    setRoutes((prev) => [
      ...prev,
      {
        distance: '',
        link: '',
        photosUrl: '',
        youtube: '',
        gpxData: null,
        gpxName: '',
        coordinates: [],
        visible: true,
      },
    ]);
  };

  const removeRouteSection = (index: number) => {
    setRoutes((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      if (next.length === 0) {
        return [
          {
            distance: '',
            link: '',
            photosUrl: '',
            youtube: '',
            gpxData: null,
            gpxName: '',
            coordinates: [],
            visible: true,
          },
        ];
      }
      return next;
    });
  };

  const updateRouteField = (index: number, field: keyof RoutePart, value: string) => {
    setRoutes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleGpxFile = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('GPX soubor je moc velký (> 2 MB). Zkuste ho zmenšit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const coords = parseGpxXml(content);
      const calcKm = calculateCoordsDistanceKm(coords);

      setRoutes((prev) => {
        const next = [...prev];
        const currentDist = next[index].distance;
        const shouldAutoFillDist =
          (!currentDist || parseFloat(String(currentDist)) <= 0) && calcKm > 0;

        next[index] = {
          ...next[index],
          distance: shouldAutoFillDist
            ? (Math.round(calcKm * 10) / 10).toString()
            : currentDist,
          gpxData: content,
          gpxName: file.name,
          coordinates: coords,
          hasGpx: coords.length > 0,
        };
        return next;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Zadejte název vrcholu nebo trasy.');
      return;
    }
    if (totalCalculatedDistance <= 0) {
      setErrorMsg('Zadejte platnou délku v kilometrech alespoň u jednoho úseku trasy.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const normalizedRoutes: RoutePart[] = routes.map((r) => {
      const d =
        r.distance !== undefined && r.distance !== ''
          ? parseFloat(String(r.distance).replace(',', '.'))
          : NaN;
      return {
        ...r,
        distance: !isNaN(d) && d > 0 ? Math.round(d * 10) / 10 : 0,
      };
    });

    try {
      await onSave({
        name: name.trim(),
        distance: totalCalculatedDistance,
        date,
        dateTo: dateTo.trim() || undefined,
        participants: participants.trim() || undefined,
        note: note.trim() || undefined,
        routes: normalizedRoutes,
      });
      if (!editingHike) {
        resetForm();
      }
    } catch (err: unknown) {
      console.error('Error saving hike:', err);
      const e = err as Error;
      setErrorMsg(`Chyba při ukládání: ${e?.message || 'Zkuste to prosím znovu.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={formRef}
      className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden relative"
    >
      <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400" />

      <div className="p-5 sm:p-7">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-stone-900">
                {editingHike ? 'Úprava výšlapu' : 'Zadat nový výšlap'}
              </h2>
              <p className="text-xs text-stone-500">
                {editingHike
                  ? 'Změny se ihned propíší do cloudu i mapy'
                  : 'Záznam se uloží do Firebase databáze a zobrazí v mapě'}
              </p>
            </div>
          </div>

          {editingHike && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="text-stone-400 hover:text-stone-600 p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
              title="Zrušit úpravy"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Hike Name */}
            <div className="sm:col-span-8">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1">
                Název vrcholu / Trasa <span className="text-emerald-600">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Např. Lysá hora z Ostravice"
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm transition-all text-stone-900"
              />
            </div>

            {/* Auto-Summed Total Distance Display */}
            <div className="sm:col-span-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1">
                Celková délka trasy
              </label>
              <div className="w-full px-3.5 py-2 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-emerald-900 font-extrabold text-sm">
                  <Route className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{totalCalculatedDistance.toFixed(1)} km</span>
                </div>
                <span className="text-[10px] font-semibold text-emerald-700 bg-white/90 px-2 py-0.5 rounded-md border border-emerald-200/70">
                  {routes.length > 1 ? `Součet ${routes.length} úseků` : 'Podle úseku'}
                </span>
              </div>
            </div>

            {/* Date From */}
            <div className="sm:col-span-6">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-stone-400" />
                Datum od <span className="text-emerald-600">*</span>
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm transition-all text-stone-800"
              />
            </div>

            {/* Date To */}
            <div className="sm:col-span-6">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-stone-400" />
                Datum do <span className="text-stone-400 font-normal">(volitelné pro vícedenní)</span>
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm transition-all text-stone-800"
              />
            </div>

            {/* Participants */}
            <div className="sm:col-span-12">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-stone-400" />
                Účastníci <span className="text-stone-400 font-normal">(oddělujte čárkou nebo text)</span>
              </label>
              <input
                type="text"
                value={participants}
                onChange={(e) => setParticipants(e.target.value)}
                placeholder="Např. Martin, Petr, se psem..."
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm transition-all text-stone-900"
              />
            </div>

            {/* Multi-Section Routes Container */}
            <div className="sm:col-span-12">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-600">
                  Části trasy (Délka úseku, Mapy, GPX data, Fotogalerie, YouTube videa)
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-stone-500 font-medium">
                    {routes.length} {routes.length === 1 ? 'úsek' : routes.length < 5 ? 'úseky' : 'úseků'}
                  </span>
                  {routes.length > 1 && (
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      Celkem: {totalCalculatedDistance.toFixed(1)} km
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {routes.map((route, idx) => {
                  const segNum =
                    route.distance !== undefined && route.distance !== ''
                      ? parseFloat(String(route.distance))
                      : NaN;

                  return (
                    <div
                      key={idx}
                      className="p-3.5 sm:p-4 bg-stone-50 border border-stone-200/90 rounded-xl relative space-y-3 transition-colors hover:border-stone-300"
                    >
                      <div className="flex items-center justify-between border-b border-stone-200/60 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-stone-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] flex items-center justify-center font-bold">
                              {idx + 1}
                            </span>
                            Úsek {idx + 1}
                          </span>
                          {!isNaN(segNum) && segNum > 0 && (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80">
                              {segNum.toFixed(1)} km
                            </span>
                          )}
                        </div>
                        {routes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRouteSection(idx)}
                            className="text-stone-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition-colors"
                            title="Odebrat tento úsek"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Segment Distance (km) */}
                        <div>
                          <label className="block text-[11px] font-semibold text-stone-700 mb-1 flex items-center gap-1">
                            <Route className="w-3 h-3 text-emerald-600" />
                            <span>
                              Délka úseku (km) <span className="text-emerald-600">*</span>
                            </span>
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            required={idx === 0 && totalCalculatedDistance <= 0}
                            placeholder="Např. 14.5"
                            value={route.distance !== undefined ? String(route.distance) : ''}
                            onChange={(e) => updateRouteField(idx, 'distance', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-xs font-bold text-stone-900"
                          />
                        </div>

                        {/* Map link */}
                        <div>
                          <label className="block text-[11px] font-semibold text-stone-600 mb-1 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-emerald-600" />
                            Odkaz na Mapy.cz
                          </label>
                          <input
                            type="url"
                            placeholder="https://mapy.cz/s/..."
                            value={route.link || ''}
                            onChange={(e) => updateRouteField(idx, 'link', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800"
                          />
                        </div>

                        {/* Photos link */}
                        <div>
                          <label className="block text-[11px] font-semibold text-stone-600 mb-1 flex items-center gap-1">
                            <Camera className="w-3 h-3 text-amber-600" />
                            Odkaz na fotogalerii
                          </label>
                          <input
                            type="url"
                            placeholder="https://photos.app.goo.gl/..."
                            value={route.photosUrl || ''}
                            onChange={(e) => updateRouteField(idx, 'photosUrl', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800"
                          />
                        </div>

                        {/* YouTube link */}
                        <div>
                          <label className="block text-[11px] font-semibold text-stone-600 mb-1 flex items-center gap-1">
                            <Youtube className="w-3 h-3 text-rose-600" />
                            Odkaz na YouTube
                          </label>
                          <input
                            type="url"
                            placeholder="https://youtube.com/watch?v=..."
                            value={route.youtube || ''}
                            onChange={(e) => updateRouteField(idx, 'youtube', e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none text-xs text-stone-800"
                          />
                        </div>
                      </div>

                      {/* GPX file upload badge */}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-stone-300 hover:border-emerald-400 rounded-lg cursor-pointer text-xs font-semibold text-stone-700 hover:text-emerald-700 shadow-2xs transition-colors">
                          <FileCode className="w-3.5 h-3.5 text-stone-500" />
                          <span>{route.gpxName || 'Nahrát GPX soubor'}</span>
                          <input
                            type="file"
                            accept=".gpx"
                            className="hidden"
                            onChange={(e) => handleGpxFile(idx, e)}
                          />
                        </label>
                        {route.coordinates && route.coordinates.length > 0 && (
                          <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {route.coordinates.length} bodů trasy načteno
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={addRouteSection}
                  className="w-full py-2 px-3 border border-dashed border-emerald-300 hover:border-emerald-500 text-emerald-700 hover:bg-emerald-50/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Přidat další úsek trasy</span>
                </button>
              </div>
            </div>

            {/* Note */}
            <div className="sm:col-span-12">
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-stone-400" />
                Poznámka / Zápisky <span className="text-stone-400 font-normal">(volitelné)</span>
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Jaké bylo počasí, podmínky na hřebeni, zajímavosti..."
                className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm transition-all text-stone-900"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-sm shadow-emerald-600/20 flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{editingHike ? 'Uložit změny výšlapu' : 'Přidat výšlap do zápisníku'}</span>
            </button>

            {editingHike && (
              <button
                type="button"
                onClick={onCancelEdit}
                className="bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold py-3 px-6 rounded-xl transition-colors text-sm"
              >
                Zrušit úpravy
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
