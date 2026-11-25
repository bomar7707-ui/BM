import React from 'react';
import { WifiOff, CloudOff, RefreshCw } from 'lucide-react';

interface OfflineIndicatorProps {
  isOnline: boolean;
  isManualOffline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  onClick: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  isOnline,
  isManualOffline,
  pendingCount,
  isSyncing,
  onClick,
}) => {
  const isOffline = !isOnline || isManualOffline;

  if (!isOffline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute md:fixed bottom-3 left-3 z-[1450] flex items-center gap-2 px-3 py-2 rounded-xl shadow-lg border text-xs font-bold transition-all cursor-pointer active:scale-95 ${
        isOffline
          ? 'bg-amber-950/95 text-amber-100 border-amber-500/50 hover:bg-amber-900'
          : 'bg-emerald-950/95 text-emerald-100 border-emerald-500/50 hover:bg-emerald-900'
      }`}
      title="Otevřít správu offline režimu a map"
    >
      {isSyncing ? (
        <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
      ) : isManualOffline ? (
        <CloudOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      ) : !isOnline ? (
        <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      ) : (
        <RefreshCw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      )}

      <span className="whitespace-nowrap">
        {isSyncing
          ? 'Synchronizuji změny…'
          : isManualOffline
          ? 'Ruční offline režim'
          : !isOnline
          ? 'Offline režim (bez signálu)'
          : `Čeká ${pendingCount} změn na synchronizaci`}
      </span>

      {isOffline && pendingCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-200 text-[10px] font-extrabold border border-amber-400/30">
          +{pendingCount}
        </span>
      )}
    </button>
  );
};
