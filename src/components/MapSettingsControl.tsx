import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, X, Check, Maximize2 } from 'lucide-react';
import {
  MAPA_LAYER_ITEMS,
  MAPA_STYLE_PRESETS,
  DEFAULT_MAPA_SETTINGS,
  getMapaSettingsSignature,
  resetMapaSettings,
  setMapaStylePreset,
  toggleMapaLayer,
  useMapaSettings,
} from '../utils/mapSettings';

interface MapSettingsControlProps {
  /** Additional positioning classes for the floating wrapper */
  className?: string;
  /** Which horizontal side the popover expands from */
  align?: 'left' | 'right';
  /** Handler to recenter the map back onto all routes */
  onCenterAllRoutes?: () => void;
  /** Tooltip text for the recenter button */
  centerAllTitle?: string;
  /** Optional extra icon buttons rendered alongside map settings & recenter */
  extraButtons?: React.ReactNode;
}

export const MapSettingsControl: React.FC<MapSettingsControlProps> = ({
  className = 'top-3 left-3',
  align = 'left',
  onCenterAllRoutes,
  centerAllTitle = 'Vycentrovat mapu zpět na všechny trasy',
  extraButtons,
}) => {
  const settings = useMapaSettings();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const isModified =
    getMapaSettingsSignature(settings) !== getMapaSettingsSignature(DEFAULT_MAPA_SETTINGS);
  const activeStyle =
    MAPA_STYLE_PRESETS.find((p) => p.id === settings.stylePreset) ?? MAPA_STYLE_PRESETS[0];

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={`absolute z-[650] ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Floating icon buttons row */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-10 h-10 flex items-center justify-center rounded-xl shadow-lg border transition-all backdrop-blur-md cursor-pointer ${
            isOpen
              ? 'bg-emerald-800 text-white border-emerald-900 shadow-emerald-900/20'
              : 'bg-white/95 hover:bg-white text-slate-800 hover:text-emerald-700 border-slate-200/90 hover:border-slate-300'
          }`}
          title={`Nastavení mapy (${activeStyle.label})`}
          aria-label="Nastavení mapy"
        >
          <SlidersHorizontal className="w-4 h-4 shrink-0" />
        </button>

        {onCenterAllRoutes && (
          <button
            type="button"
            onClick={onCenterAllRoutes}
            className="w-10 h-10 flex items-center justify-center rounded-xl shadow-lg border transition-all backdrop-blur-md cursor-pointer bg-white/95 hover:bg-white text-slate-800 hover:text-emerald-700 border-slate-200/90 hover:border-slate-300 active:scale-95"
            title={centerAllTitle}
            aria-label={centerAllTitle}
          >
            <Maximize2 className="w-4 h-4 shrink-0" />
          </button>
        )}

        {extraButtons}
      </div>

      {/* Popover panel */}
      {isOpen && (
        <div
          className={`mt-2 w-[min(300px,calc(100vw-24px))] sm:w-[330px] max-h-[min(68vh,540px)] flex flex-col bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden ${
            align === 'right' ? 'right-0 absolute' : 'left-0 absolute'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/70 shrink-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-emerald-700" />
              <span className="text-sm font-semibold text-slate-800">Nastavení mapy</span>
              <span className="text-[10px] font-medium text-slate-400">v1.3</span>
            </div>
            <div className="flex items-center gap-1">
              {isModified && (
                <button
                  type="button"
                  onClick={resetMapaSettings}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                  title="Obnovit výchozí nastavení mapy"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Výchozí</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                aria-label="Zavřít nastavení mapy"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto px-4 py-3.5 space-y-4">
            {/* Section 1: Map style preset */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 mb-2">Styl mapy</h3>
              <div className="grid grid-cols-1 gap-1.5">
                {MAPA_STYLE_PRESETS.map((opt) => {
                  const active = settings.stylePreset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setMapaStylePreset(opt.id)}
                      className={`w-full text-left px-3 py-2 rounded-xl border transition-all flex items-start gap-2.5 cursor-pointer ${
                        active
                          ? 'border-emerald-700 bg-emerald-50/70 shadow-xs'
                          : 'border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/70'
                      }`}
                    >
                      {/* Miniature 3-stripe palette swatch */}
                      <span
                        className="mt-0.5 w-6 h-6 rounded-md overflow-hidden border border-black/10 shrink-0 flex flex-col"
                        aria-hidden="true"
                      >
                        <span className="flex-1" style={{ backgroundColor: opt.swatch[0] }} />
                        <span className="flex-1" style={{ backgroundColor: opt.swatch[1] }} />
                        <span className="flex-1" style={{ backgroundColor: opt.swatch[2] }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              active ? 'text-emerald-900' : 'text-slate-800'
                            }`}
                          >
                            {opt.label}
                          </span>
                          {active && <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />}
                        </span>
                        <span className="block text-[11px] leading-snug text-slate-500 mt-0.5">
                          {opt.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section 2: Kartografické vrstvy (exact Mapa v1.3 12-layer checklist) */}
            <section>
              <h3 className="text-xs font-semibold text-slate-500 mb-2">
                Kartografické vrstvy
              </h3>
              <div className="divide-y divide-slate-200/70 border border-slate-200/90 rounded-xl overflow-hidden bg-white">
                {MAPA_LAYER_ITEMS.map((item) => {
                  const checked = settings.layers[item.key];
                  return (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] text-slate-800 hover:bg-slate-50/90 transition-colors cursor-pointer select-none"
                    >
                      <span className="leading-snug">{item.label}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMapaLayer(item.key)}
                        className="w-4 h-4 rounded accent-[#1f5c35] border-slate-300 cursor-pointer shrink-0"
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
