import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'error';

interface ToastProps {
  message: string | null;
  type?: ToastType;
  onClose: () => void;
  durationMs?: number;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'success',
  onClose,
  durationMs = 3800,
}) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs, onClose]);

  if (!message) return null;

  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
  };

  return (
    <div className="fixed bottom-6 right-6 z-[2000] flex items-center gap-3 bg-stone-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-stone-800 text-xs sm:text-sm font-medium animate-in slide-in-from-bottom-5 duration-300">
      {icons[type]}
      <span>{message}</span>
      <button
        onClick={onClose}
        className="text-stone-400 hover:text-white ml-2 p-0.5 rounded-md"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
