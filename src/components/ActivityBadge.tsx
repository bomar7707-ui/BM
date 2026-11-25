import React from 'react';
import { Bike } from 'lucide-react';
import { HikeActivity } from '../types';

export interface ActivityOption {
  id: HikeActivity;
  label: string;
  colorClass: string;
  activeBgClass: string;
  badgeClass: string;
}

export const ACTIVITY_OPTIONS: ActivityOption[] = [
  {
    id: 'hiking',
    label: 'Turistika',
    colorClass: 'text-emerald-700',
    activeBgClass: 'bg-emerald-600 text-white border-emerald-600 shadow-xs',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    id: 'running',
    label: 'Běh',
    colorClass: 'text-amber-700',
    activeBgClass: 'bg-amber-600 text-white border-amber-600 shadow-xs',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  {
    id: 'cycling',
    label: 'Kolo',
    colorClass: 'text-sky-700',
    activeBgClass: 'bg-sky-600 text-white border-sky-600 shadow-xs',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
];

export function normalizeHikeActivity(raw: unknown): HikeActivity | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'hiking' || v === 'turistika') return 'hiking';
  if (v === 'running' || v === 'běh' || v === 'beh') return 'running';
  if (v === 'cycling' || v === 'kolo' || v === 'bike') return 'cycling';
  return undefined;
}

export const ActivitySvg: React.FC<{ activity: HikeActivity; className?: string }> = ({
  activity,
  className = 'w-3.5 h-3.5',
}) => {
  if (activity === 'hiking') {
    // Crisp hiker with backpack & trekking pole icon
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <circle cx="13" cy="4" r="2" />
        <path d="M7 9.5a2 2 0 0 1 2-2h1.5v6H7z" />
        <path d="M10.5 7.5H13l2.5 3.5H19" />
        <path d="M18.5 8v13" />
        <path d="M11 13.5 8.5 21" />
        <path d="m13 13.5 2.5 4.5v3" />
      </svg>
    );
  }

  if (activity === 'running') {
    // Crisp runner in motion icon
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <circle cx="15" cy="4" r="2" />
        <path d="m10.5 9.5-3 1.5-1.5 2.5" />
        <path d="m10.5 9.5 3.5 1 2.5 3 3-1" />
        <path d="m14 10.5-2.5 4.5 3.5 2.5 1 3.5" />
        <path d="m11.5 15-4.5 1-2.5 3" />
      </svg>
    );
  }

  return <Bike className={className} />;
};

export const ActivityIcon: React.FC<{
  activity?: HikeActivity;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}> = ({ activity, showLabel = false, size = 'sm' }) => {
  if (!activity) return null;
  const option = ACTIVITY_OPTIONS.find((o) => o.id === activity);
  if (!option) return null;

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 rounded-md border font-bold shrink-0 ${
        option.badgeClass
      } ${
        showLabel
          ? 'px-1.5 py-0.5 text-[10px]'
          : size === 'sm'
          ? 'w-5 h-5'
          : 'w-6 h-6'
      }`}
      title={`Aktivita: ${option.label}`}
      aria-label={`Aktivita: ${option.label}`}
    >
      <ActivitySvg
        activity={activity}
        className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'}
      />
      {showLabel && <span>{option.label}</span>}
    </span>
  );
};
