import React, { useMemo, useState } from 'react';
import {
  Trophy,
  Filter,
  CheckCircle2,
  Clock,
  Calendar,
  Footprints,
  Mountain,
  Flame,
  RotateCcw,
  Sparkles,
  MapPin,
} from 'lucide-react';
import { Hike } from '../types';
import { calculateDistanceKm, getSegmentDistanceKm } from '../utils/gpxParser';
import { parseSafeDate, formatCzechDate, getDisplayDateRange } from '../utils/dateUtils';

interface MilestonesViewProps {
  hikes: Hike[];
  onSelectTripOnMap: (tripId: string) => void;
}

interface DailySegmentMetric {
  distKm: number;
  ascentM: number;
  label: string;
}

interface EnrichedHike {
  hike: Hike;
  distKm: number;
  ascentM: number;
  dailySegments: DailySegmentMetric[];
  maxDailyDistKm: number;
  maxDailyAscentM: number;
  maxEleM: number;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  activeDates: Date[];
}

interface MilestoneStatus {
  id: string;
  category: 'distance' | 'elevation' | 'activity';
  icon: string;
  title: string;
  explanation: string;
  humor: string;
  isCompleted: boolean;
  completedDate?: string;
  completedTripName?: string;
  completedTripId?: string;
  progressPct: number;
  currentLabel: string;
  remainingLabel: string;
}

const MONTH_NAMES_CZ = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
];

function getMondayKey(d: Date): number {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  const day = copy.getDay(); // 0 = Sun, 1 = Mon, ...
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  return copy.getTime();
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const MilestonesView: React.FC<MilestonesViewProps> = ({ hikes, onSelectTripOnMap }) => {
  // Independent filters for Milestones (default to current calendar year)
  const currentCalendarYear = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState<string>(currentCalendarYear.toString());
  const [filterParticipant, setFilterParticipant] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');

  // Extract available years and participants from all hikes (always include current calendar year)
  const { availableYears, availableParticipants } = useMemo(() => {
    const years = new Set<number>([currentCalendarYear]);
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
  }, [hikes, currentCalendarYear]);

  // Filter hikes independently and sort chronologically (oldest -> newest) to determine exact unlock dates
  const enrichedHikes = useMemo<EnrichedHike[]>(() => {
    const matching = hikes.filter((trip) => {
      const d =
        parseSafeDate(trip.rawDate) ||
        parseSafeDate(trip.date?.split('–')[0]) ||
        parseSafeDate(trip.date?.split('-')[0]);

      if (filterYear !== 'all') {
        if (!d || d.getFullYear().toString() !== filterYear) return false;
      }
      if (filterParticipant !== 'all') {
        if (
          !trip.participants ||
          !trip.participants.toLowerCase().includes(filterParticipant.toLowerCase())
        ) {
          return false;
        }
      }
      return true;
    });

    const mapped: EnrichedHike[] = matching.map((trip) => {
      const startD =
        parseSafeDate(trip.rawDate) ||
        parseSafeDate(trip.date?.split('–')[0]) ||
        parseSafeDate(trip.date?.split(' - ')[0]) ||
        new Date(0);

      let endD =
        parseSafeDate(trip.endDate) ||
        parseSafeDate(trip.dateTo) ||
        parseSafeDate(trip.date?.split('–')[1]) ||
        parseSafeDate(trip.date?.split(' - ')[1]) ||
        new Date(startD);

      if (isNaN(endD.getTime()) || endD < startD) {
        endD = new Date(startD);
      }

      const normStart = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 12, 0, 0);
      const normEnd = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate(), 12, 0, 0);

      const diffDays =
        normStart.getTime() > 0
          ? Math.max(1, Math.round((normEnd.getTime() - normStart.getTime()) / 86400000) + 1)
          : 1;

      const activeDates: Date[] = [];
      if (normStart.getTime() > 0 && diffDays <= 60) {
        const cur = new Date(normStart);
        while (cur <= normEnd) {
          activeDates.push(new Date(cur));
          cur.setDate(cur.getDate() + 1);
        }
      } else if (normStart.getTime() > 0) {
        activeDates.push(normStart);
      }

      // Distance
      let distKm = typeof trip.distance === 'string' ? parseFloat(trip.distance) : trip.distance;
      if (isNaN(distKm)) distKm = 0;

      // Ascent & Max elevation from coordinates
      let ascentM = 0;
      let maxEleM = 0;
      let calcDistKm = 0;

      const routes = trip.routes || trip.maps || [];
      const isMultiDayTrip = diffDays > 1 || routes.length > 1;
      const dailySegments: DailySegmentMetric[] = [];

      routes.forEach((m, mIdx) => {
        let segAsc = 0;
        if (m.coordinates && m.coordinates.length > 0) {
          for (let i = 0; i < m.coordinates.length; i++) {
            const pt = m.coordinates[i];
            const ele = pt.length >= 3 && typeof pt[2] === 'number' && !isNaN(pt[2]) ? pt[2] : null;
            if (ele !== null && ele > maxEleM) {
              maxEleM = ele;
            }
            if (i > 0) {
              const prev = m.coordinates[i - 1];
              calcDistKm += calculateDistanceKm(prev[0], prev[1], pt[0], pt[1]);
              const prevEle =
                prev.length >= 3 && typeof prev[2] === 'number' && !isNaN(prev[2]) ? prev[2] : null;
              if (ele !== null && prevEle !== null && ele > prevEle) {
                const diffEle = ele - prevEle;
                ascentM += diffEle;
                segAsc += diffEle;
              }
            }
          }
        }

        // Count as daily segment if trip is single-day or has individual daily route segments
        if (!isMultiDayTrip || routes.length > 1) {
          const segDist =
            getSegmentDistanceKm(m, routes.length, isMultiDayTrip ? undefined : trip.distance) ?? 0;
          const segLabel = routes.length > 1 ? `${trip.name} (Úsek ${mIdx + 1})` : trip.name;
          dailySegments.push({
            distKm: segDist,
            ascentM: segAsc,
            label: segLabel,
          });
        }
      });

      if (distKm === 0 && calcDistKm > 0) {
        distKm = calcDistKm;
      }

      // If single-day hike without route segments, record its distance/ascent as a daily segment
      if (!isMultiDayTrip && dailySegments.length === 0) {
        dailySegments.push({
          distKm,
          ascentM,
          label: trip.name,
        });
      }

      const maxDailyDistKm = dailySegments.reduce((max, s) => Math.max(max, s.distKm), 0);
      const maxDailyAscentM = dailySegments.reduce((max, s) => Math.max(max, s.ascentM), 0);

      return {
        hike: trip,
        distKm,
        ascentM,
        dailySegments,
        maxDailyDistKm,
        maxDailyAscentM,
        maxEleM,
        startDate: normStart,
        endDate: normEnd,
        durationDays: diffDays,
        activeDates,
      };
    });

    // Sort oldest to newest
    mapped.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return mapped;
  }, [hikes, filterYear, filterParticipant]);

  // Evaluate all 31 milestones
  const milestones = useMemo<MilestoneStatus[]>(() => {
    const totalKm = enrichedHikes.reduce((acc, h) => acc + h.distKm, 0);
    const totalAscent = enrichedHikes.reduce((acc, h) => acc + h.ascentM, 0);
    const maxSingleKm = enrichedHikes.reduce((max, h) => Math.max(max, h.maxDailyDistKm), 0);
    const maxSingleAscent = enrichedHikes.reduce((max, h) => Math.max(max, h.maxDailyAscentM), 0);
    const maxElevationPoint = enrichedHikes.reduce((max, h) => Math.max(max, h.maxEleM), 0);
    const maxDurationDays = enrichedHikes.reduce((max, h) => Math.max(max, h.durationDays), 0);

    // Helper for cumulative distance milestone
    const evalCumulativeKm = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetKm: number
    ): MilestoneStatus => {
      let runningKm = 0;
      let unlockedBy: EnrichedHike | null = null;
      for (const item of enrichedHikes) {
        runningKm += item.distKm;
        if (runningKm >= targetKm && !unlockedBy) {
          unlockedBy = item;
          break;
        }
      }
      const isCompleted = unlockedBy !== null;
      const pct = Math.min(100, (totalKm / targetKm) * 100);
      const remaining = Math.max(0, targetKm - totalKm);

      return {
        id,
        category: 'distance',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy?.hike.name,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `${totalKm.toFixed(1)} / ${targetKm} km`,
        remainingLabel: isCompleted
          ? `Splněno (${totalKm.toFixed(1)} km celkem)`
          : `Zbývá ještě ${remaining.toFixed(1)} km`,
      };
    };

    // Helper for single-day distance milestone (> targetKm)
    const evalSingleKm = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetKm: number
    ): MilestoneStatus => {
      let unlockedBy: EnrichedHike | null = null;
      let unlockedSegment: DailySegmentMetric | null = null;

      for (const h of enrichedHikes) {
        const seg = h.dailySegments.find((s) => s.distKm > targetKm);
        if (seg) {
          unlockedBy = h;
          unlockedSegment = seg;
          break;
        }
      }

      const isCompleted = unlockedBy !== null && unlockedSegment !== null;
      const pct = isCompleted ? 100 : Math.min(99, (maxSingleKm / targetKm) * 100);
      const diff = Math.max(0.1, targetKm - maxSingleKm);

      return {
        id,
        category: 'distance',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName:
          unlockedBy && unlockedSegment
            ? `${unlockedSegment.label} (${unlockedSegment.distKm.toFixed(1)} km)`
            : undefined,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `Nejdelší denní trasa: ${maxSingleKm.toFixed(1)} / ${targetKm} km`,
        remainingLabel:
          isCompleted && unlockedSegment
            ? `Splněno denní trasou ${unlockedSegment.distKm.toFixed(1)} km`
            : `V jednom dni chybí ještě ${diff.toFixed(1)} km (nejdelší denní zatím ${maxSingleKm.toFixed(1)} km)`,
      };
    };

    // Helper for single-day ascent milestone (> targetM)
    const evalSingleAscent = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetM: number
    ): MilestoneStatus => {
      let unlockedBy: EnrichedHike | null = null;
      let unlockedSegment: DailySegmentMetric | null = null;

      for (const h of enrichedHikes) {
        const seg = h.dailySegments.find((s) => s.ascentM > targetM);
        if (seg) {
          unlockedBy = h;
          unlockedSegment = seg;
          break;
        }
      }

      const isCompleted = unlockedBy !== null && unlockedSegment !== null;
      const pct = isCompleted ? 100 : Math.min(99, (maxSingleAscent / targetM) * 100);
      const diff = Math.max(1, Math.ceil(targetM - maxSingleAscent));

      return {
        id,
        category: 'elevation',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName:
          unlockedBy && unlockedSegment
            ? `${unlockedSegment.label} (+${Math.round(unlockedSegment.ascentM)} m)`
            : undefined,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `Max. denní stoupání: ${Math.round(maxSingleAscent).toLocaleString('cs-CZ')} / ${targetM.toLocaleString('cs-CZ')} m`,
        remainingLabel:
          isCompleted && unlockedSegment
            ? `Splněno denním stoupáním +${Math.round(unlockedSegment.ascentM)} m`
            : `V jednom dni chybí ještě ${diff.toLocaleString('cs-CZ')} m stoupání`,
      };
    };

    // Helper for cumulative ascent milestone (>= targetM)
    const evalCumulativeAscent = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetM: number
    ): MilestoneStatus => {
      let runningAsc = 0;
      let unlockedBy: EnrichedHike | null = null;
      for (const item of enrichedHikes) {
        runningAsc += item.ascentM;
        if (runningAsc >= targetM && !unlockedBy) {
          unlockedBy = item;
          break;
        }
      }
      const isCompleted = unlockedBy !== null;
      const pct = Math.min(100, (totalAscent / targetM) * 100);
      const remaining = Math.max(0, Math.ceil(targetM - totalAscent));

      return {
        id,
        category: 'elevation',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy?.hike.name,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `${Math.round(totalAscent).toLocaleString('cs-CZ')} / ${targetM.toLocaleString('cs-CZ')} m`,
        remainingLabel: isCompleted
          ? `Splněno (${Math.round(totalAscent).toLocaleString('cs-CZ')} m celkem)`
          : `Zbývá nastoupat ještě ${remaining.toLocaleString('cs-CZ')} m`,
      };
    };

    // Helper for peak altitude milestone (> targetM)
    const evalPeakAltitude = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetM: number
    ): MilestoneStatus => {
      const unlockedBy = enrichedHikes.find((h) => h.maxEleM > targetM) || null;
      const isCompleted = unlockedBy !== null;
      const pct = isCompleted ? 100 : Math.min(99, (maxElevationPoint / targetM) * 100);
      const diff = Math.max(1, Math.ceil(targetM - maxElevationPoint));

      return {
        id,
        category: 'elevation',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy
          ? `${unlockedBy.hike.name} (${Math.round(unlockedBy.maxEleM)} m n. m.)`
          : undefined,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `Nejvyšší bod: ${Math.round(maxElevationPoint).toLocaleString('cs-CZ')} / ${targetM.toLocaleString('cs-CZ')} m n. m.`,
        remainingLabel: isCompleted
          ? `Splněno výstupem do ${Math.round(unlockedBy.maxEleM)} m n. m.`
          : `Zbývá vystoupat o ${diff.toLocaleString('cs-CZ')} výškových metrů výše`,
      };
    };

    // Helper for seasonal month milestone
    const evalSeasonalMonths = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      allowedMonthsZeroBased: number[],
      monthDesc: string
    ): MilestoneStatus => {
      const unlockedBy =
        enrichedHikes.find((h) =>
          h.activeDates.some((d) => allowedMonthsZeroBased.includes(d.getMonth()))
        ) || null;
      const isCompleted = unlockedBy !== null;

      return {
        id,
        category: 'activity',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy?.hike.name,
        completedTripId: unlockedBy?.hike.id,
        progressPct: isCompleted ? 100 : 0,
        currentLabel: isCompleted ? '1 / 1 výšlap' : '0 / 1 výšlap',
        remainingLabel: isCompleted
          ? `Splněno v požadovaném období`
          : `Zbývá: 1 výšlap ${monthDesc}`,
      };
    };

    // Helper for multi-day duration milestone
    const evalMultiDay = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      minDays: number
    ): MilestoneStatus => {
      const unlockedBy = enrichedHikes.find((h) => h.durationDays >= minDays) || null;
      const isCompleted = unlockedBy !== null;
      const pct = isCompleted ? 100 : Math.min(95, (maxDurationDays / minDays) * 100);
      const missingDays = Math.max(1, minDays - maxDurationDays);

      return {
        id,
        category: 'activity',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy
          ? `${unlockedBy.hike.name} (${unlockedBy.durationDays} ${
              unlockedBy.durationDays <= 4 ? 'dny' : 'dnů'
            })`
          : undefined,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `Nejdelší akce: ${maxDurationDays} / ${minDays} dnů`,
        remainingLabel: isCompleted
          ? `Splněno (${unlockedBy.durationDays} dnů)`
          : `Zbývá: výšlap o délce alespoň ${minDays} dnů (chybí ${missingDays} ${
              missingDays === 1 ? 'den' : missingDays <= 4 ? 'dny' : 'dnů'
            } oproti nejdelšímu)`,
      };
    };

    // Evaluate Weekend Double (Saturday + Sunday back-to-back)
    const evalWeekendDouble = (): MilestoneStatus => {
      const dayMap = new Map<string, EnrichedHike>();
      enrichedHikes.forEach((h) => {
        h.activeDates.forEach((d) => {
          const key = toDayKey(d);
          if (!dayMap.has(key)) {
            dayMap.set(key, h);
          }
        });
      });

      let unlockedSundayHike: EnrichedHike | null = null;
      let unlockedSundayDate: Date | null = null;
      let hasAnyWeekendHike = false;

      for (const h of enrichedHikes) {
        for (const d of h.activeDates) {
          const dow = d.getDay();
          if (dow === 6 || dow === 0) hasAnyWeekendHike = true;
          if (dow === 6) {
            // Saturday -> check Sunday (+1 day)
            const sun = new Date(d);
            sun.setDate(sun.getDate() + 1);
            const sunHike = dayMap.get(toDayKey(sun));
            if (sunHike) {
              unlockedSundayHike = sunHike;
              unlockedSundayDate = sun;
              break;
            }
          }
        }
        if (unlockedSundayHike) break;
      }

      const isCompleted = unlockedSundayHike !== null;
      return {
        id: 'weekend_double',
        category: 'activity',
        icon: '🔥',
        title: 'Víkendový dvojboj',
        explanation: 'Výšlapy v sobotu i v neděli za sebou.',
        humor:
          'Protože motto „Bolest přejde, krása hor zůstane“ bereš doslova a v pondělí v práci chodíš po schodech výhradně pozadu.',
        isCompleted,
        completedDate: unlockedSundayDate
          ? formatCzechDate(toDayKey(unlockedSundayDate))
          : unlockedSundayHike
          ? getDisplayDateRange(unlockedSundayHike.hike)
          : undefined,
        completedTripName: unlockedSundayHike?.hike.name,
        completedTripId: unlockedSundayHike?.hike.id,
        progressPct: isCompleted ? 100 : hasAnyWeekendHike ? 50 : 0,
        currentLabel: isCompleted ? '2 / 2 víkendové dny' : hasAnyWeekendHike ? '1 / 2 víkendové dny' : '0 / 2 víkendové dny',
        remainingLabel: isCompleted
          ? 'Splněno (sobota i neděle za sebou)'
          : hasAnyWeekendHike
          ? 'Zbývá: přidat druhý víkendový den hned po sobě (sobota + neděle)'
          : 'Zbývá: absolvovat výšlap v sobotu i v neděli během jednoho víkendu',
      };
    };

    // Precompute consecutive weekly streaks
    const weekMap = new Map<number, EnrichedHike>();
    enrichedHikes.forEach((h) => {
      h.activeDates.forEach((d) => {
        if (d.getTime() <= 0) return;
        const wKey = getMondayKey(d);
        if (!weekMap.has(wKey)) {
          weekMap.set(wKey, h);
        }
      });
    });

    const sortedWeeks = Array.from(weekMap.keys()).sort((a, b) => a - b);
    let maxWeeklyStreak = 0;
    let curStreak = 0;
    const streakUnlockHike: Record<number, EnrichedHike | undefined> = {};

    for (let i = 0; i < sortedWeeks.length; i++) {
      if (i === 0) {
        curStreak = 1;
      } else {
        const diffDays = Math.round((sortedWeeks[i] - sortedWeeks[i - 1]) / 86400000);
        if (diffDays === 7) {
          curStreak += 1;
        } else {
          curStreak = 1;
        }
      }
      if (curStreak > maxWeeklyStreak) {
        maxWeeklyStreak = curStreak;
      }
      if (curStreak >= 10 && !streakUnlockHike[10]) {
        streakUnlockHike[10] = weekMap.get(sortedWeeks[i]);
      }
      if (curStreak >= 20 && !streakUnlockHike[20]) {
        streakUnlockHike[20] = weekMap.get(sortedWeeks[i]);
      }
      if (curStreak >= 30 && !streakUnlockHike[30]) {
        streakUnlockHike[30] = weekMap.get(sortedWeeks[i]);
      }
    }

    const evalWeeklyStreak = (
      id: string,
      icon: string,
      title: string,
      explanation: string,
      humor: string,
      targetWeeks: number
    ): MilestoneStatus => {
      const unlockedBy = streakUnlockHike[targetWeeks] || null;
      const isCompleted = unlockedBy !== null;
      const pct = Math.min(100, (maxWeeklyStreak / targetWeeks) * 100);
      const remaining = Math.max(0, targetWeeks - maxWeeklyStreak);

      return {
        id,
        category: 'activity',
        icon,
        title,
        explanation,
        humor,
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy?.hike.name,
        completedTripId: unlockedBy?.hike.id,
        progressPct: pct,
        currentLabel: `Nejdelší šňůra: ${maxWeeklyStreak} / ${targetWeeks} týdnů`,
        remainingLabel: isCompleted
          ? `Splněno (${maxWeeklyStreak} týdnů v řadě)`
          : `Zbývá ještě ${remaining} ${
              remaining === 1 ? 'týden' : remaining <= 4 ? 'týdny' : 'týdnů'
            } v řadě`,
      };
    };

    // Evaluate All 12 Months in a Year ("Celoroční maniak")
    const evalAll12Months = (): MilestoneStatus => {
      const monthsByYear = new Map<number, Set<number>>();
      let unlockedBy: EnrichedHike | null = null;
      let unlockedYear: number | null = null;

      for (const h of enrichedHikes) {
        for (const d of h.activeDates) {
          if (d.getTime() <= 0) continue;
          const y = d.getFullYear();
          const m = d.getMonth(); // 0..11
          if (!monthsByYear.has(y)) {
            monthsByYear.set(y, new Set());
          }
          const mSet = monthsByYear.get(y)!;
          mSet.add(m);
          if (mSet.size === 12 && !unlockedBy) {
            unlockedBy = h;
            unlockedYear = y;
            break;
          }
        }
        if (unlockedBy) break;
      }

      // Find best year if not completed
      let bestYear: number | null = null;
      let bestSet = new Set<number>();
      monthsByYear.forEach((set, yr) => {
        if (set.size > bestSet.size) {
          bestSet = set;
          bestYear = yr;
        }
      });

      const isCompleted = unlockedBy !== null;
      const count = isCompleted ? 12 : bestSet.size;
      const missingMonths: string[] = [];
      for (let m = 0; m < 12; m++) {
        if (!bestSet.has(m)) {
          missingMonths.push(MONTH_NAMES_CZ[m]);
        }
      }

      return {
        id: 'all_12_months',
        category: 'activity',
        icon: '🌍',
        title: 'Celoroční maniak',
        explanation: 'Zaznamenaný alespoň jeden výšlap v každém z 12 měsíců v roce.',
        humor:
          'Podařilo se ti ignorovat roční období a prokázat, že na túru je vhodné vyrazit v jakémkoli počasí. Ocenění za naprostou meteorologickou ignoranci je tvoje.',
        isCompleted,
        completedDate: unlockedBy ? getDisplayDateRange(unlockedBy.hike) : undefined,
        completedTripName: unlockedBy
          ? `${unlockedBy.hike.name} (rok ${unlockedYear})`
          : undefined,
        completedTripId: unlockedBy?.hike.id,
        progressPct: (count / 12) * 100,
        currentLabel: `${count} / 12 měsíců${bestYear && !isCompleted ? ` (rok ${bestYear})` : ''}`,
        remainingLabel: isCompleted
          ? `Splněno všech 12 měsíců v roce ${unlockedYear}`
          : count === 0
          ? 'Zbývá: 12 měsíců'
          : `Zbývá ještě ${12 - count} ${
              12 - count === 1 ? 'měsíc' : 12 - count <= 4 ? 'měsíce' : 'měsíců'
            } (${missingMonths.join(', ')})`,
      };
    };

    // First hike milestone
    const firstHike = enrichedHikes[0] || null;
    const mFirstHike: MilestoneStatus = {
      id: 'first_hike',
      category: 'distance',
      icon: '🥾',
      title: 'První túra',
      explanation: 'Splněno při 1. úspěšném výšlapu.',
      humor:
        'Vítej na cestě! První puchýř na patě a zjištění, že tvoje pohorky po třech letech ve skříni strašně tlačí, jsou oficiálně za tebou.',
      isCompleted: firstHike !== null,
      completedDate: firstHike ? getDisplayDateRange(firstHike.hike) : undefined,
      completedTripName: firstHike?.hike.name,
      completedTripId: firstHike?.hike.id,
      progressPct: firstHike ? 100 : 0,
      currentLabel: firstHike ? '1 / 1 výšlap' : '0 / 1 výšlap',
      remainingLabel: firstHike ? 'Splněno 1. výšlapem' : 'Zbývá: 1 výšlap',
    };

    return [
      // 1. Kilometrové výzvy (Vzdálenost)
      mFirstHike,
      evalCumulativeKm(
        'km_25',
        '🥉',
        'Začátečník s ambicí',
        'Celkově ušlých 25 km.',
        'Už víš, kde máš svaly, o kterých jsi dřív ani netušil, že existují.',
        25
      ),
      evalCumulativeKm(
        'km_50',
        '🥉',
        'Padesátník',
        'Celkově ušlých 50 km.',
        'Polovina stovky v nohou. Tělo sice začíná protestovat, ale motivace jít příští víkend znova je ještě silnější než ranní kofeinový abstinenční příznak.',
        50
      ),
      evalCumulativeKm(
        'km_100',
        '🥈',
        'Stovkař',
        'Celkově ušlých 100 km.',
        'Úctyhodná porce. Tvoje boty už mluví, nohy mají vlastní rozum a mapy.cz (nebo mapy.com) v telefonu jsou tvoje nová životní láska.',
        100
      ),
      evalSingleKm(
        'single_20',
        '🥇',
        'Dvacetikilometrový test',
        'Jednorázová trasa delší než 20 km.',
        'Zjistil jsi, že svačina, co jsi měl sbalenou, byla vlastně snědená už na pátém kilometru.',
        20
      ),
      evalSingleKm(
        'single_30',
        '🥇',
        'Dálkový plazec',
        'Jednorázová trasa delší než 30 km.',
        'Pro ty, kterým denní světlo nestačí. Zjistil jsi, že podzimní tma v lese hluboko od civilizace má nečekaně „kouzelnou“ atmosféru plnou zvuků, které určitě nebyli medvědi.',
        30
      ),
      evalCumulativeKm(
        'km_500',
        '👑',
        'Magický půllitr',
        'Celkově ušlých 500 km.',
        'Klub vyvolených. Tvoje trasy na mapě už dávno netvoří čáry, ale vypadají jako kompletní pavučina psychopatického kartografa.',
        500
      ),
      evalCumulativeKm(
        'km_1000',
        '💎',
        'Kilometrový gigant',
        'Celkově ušlých 1000 km.',
        'Tohle už se dá vykazovat jako regulérní migrace. Pokud nepřestaneš, brzy budeš moct učit ptáky lítat na jih.',
        1000
      ),
      evalCumulativeKm(
        'km_1500',
        '🌌',
        'Chodec nekonečna',
        'Celkově ušlých 1500 km.',
        'Tvé nohy teď patří do seznamu národních památek a pohorky mají právo na vlastní občanský průkaz.',
        1500
      ),

      // 2. Výškové milníky (Převýšení & Stoupání)
      evalSingleAscent(
        'asc_500',
        '🟢',
        'První kopeček',
        'Jednorázové stoupání D+ > 500 m.',
        'První pořádný test plic a stehenních svalů. Zjistil jsi, že kopeček v popisu trasy na internetu byl ve skutečnosti vertikální stěna.',
        500
      ),
      evalSingleAscent(
        'asc_1000',
        '⛰️',
        'Pokořitel tisícovky',
        'Jednorázové stoupání D+ > 1000 m.',
        'Tři sta metrů převýšení za hodinu do kopce? Tvoje tepová frekvence se na chvíli dotkla vesmíru, ale hřeben a výhled stály za ten tichý pláč.',
        1000
      ),
      evalSingleAscent(
        'asc_1500',
        '🏔️',
        'Kamzíkův sen',
        'Jednorázové stoupání D+ > 1500 m.',
        'Začínáš podezřívat gravitaci z osobní msty a začínáš zvažovat, že tvá kolena ti brzy napíšou výpověď.',
        1500
      ),
      evalCumulativeAscent(
        'asc_total_10k',
        '🦅',
        'Hřebenový dravec',
        'Celkově nastoupáno 10 000 m.',
        'Součet stoupání už oficiálně překonal výšku několika dopravních letadel. Gratulace, tvé nohy jsou teď certifikovaný vysokohorský výtah.',
        10000
      ),
      evalCumulativeAscent(
        'asc_total_20k',
        '🦅',
        'Dvojitý Mount Everest',
        'Celkově nastoupáno 20 000 m.',
        'Odteď se můžeš bavit s horolezci na stejné úrovni, i když to chodíš s batohem a psem v Česku a na Slovensku.',
        20000
      ),
      evalCumulativeAscent(
        'asc_total_30k',
        '🦅',
        'Stratosférický chodec',
        'Celkově nastoupáno 30 000 m.',
        'Už jsi výš než oblaka, tvoje nadmořská výška je omezena jen tím, kam ještě vede turistická značka.',
        30000
      ),
      evalCumulativeAscent(
        'asc_total_40k',
        '🦅',
        'Oběžná dráha',
        'Celkově nastoupáno 40 000 m.',
        'Brzy si na tebe budou stěžovat satelity, že jim zavazíš v letové dráze.',
        40000
      ),
      evalCumulativeAscent(
        'asc_total_50k',
        '🦅',
        'Vládce stratosféry (a všeho pod ní)',
        'Celkově nastoupáno 50 000 m.',
        'Tvé tělo se plně adaptovalo a zvažuje, že si začne účtovat mýtné za každý metr, který na něm nastoupáš.',
        50000
      ),
      evalPeakAltitude(
        'peak_1500',
        '🏔️',
        'Vysokohorák',
        'Návštěva bodu nad 1500 m n. m.',
        'Vzduch nahoře je sice řidší, ale tvoje ego a radost z výhledu na inverzi v údolí rostou do gigantických rozměrů.',
        1500
      ),
      evalPeakAltitude(
        'peak_2000',
        '🏔️',
        'Dotek nebes',
        'Návštěva bodu nad 2000 m n. m.',
        'Vítej tam, kde lišky dávají dobrou noc a mraky ti doslova protékají mezi prsty.',
        2000
      ),

      // 3. Časové a sezónní milníky (Aktivita)
      evalSeasonalMonths(
        'season_winter',
        '❄️',
        'Zimní vlk',
        'Výšlap uskutečněný v lednu.',
        'Zatímco normální lidé sedí u kamen, pijí čaj a kynou, ty se s čepicí zmrzlých nudlí u nosu brodíš závějí a tvrdíš všem, jak je venku vlastně krásně.',
        [0],
        'v lednu'
      ),
      evalSeasonalMonths(
        'season_spring',
        '🌱',
        'Jarní blátochod',
        'Výšlap uskutečněný v dubnu.',
        'Optimismus první jarní oblevy tě zahřeje přesně do té chvíle, než ti bota poprvé zajede pět centimetrů do bažiny, co se dřív tvářila jako cesta.',
        [3],
        'v dubnu'
      ),
      evalSeasonalMonths(
        'season_summer',
        '☀️',
        'Letní horkovzdušný balon',
        'Výšlap uskutečněný v červenci.',
        'Sbalil sis vodu pro slona, ale stejně máš na hřebeni pocit, že se z tebe stal sušený plátek ovoce.',
        [6],
        'v červenci'
      ),
      evalSeasonalMonths(
        'season_autumn',
        '🍂',
        'Podzimní inverze',
        'Výšlap uskutečněný v říjnu.',
        'Barevné listí, klid a vůně mlhy. A taky ta úžasná schopnost obléknout si bundu a zase ji po pěti minutách sundat, protože se při stoupání vaříš.',
        [9],
        'v říjnu'
      ),
      evalMultiDay(
        'multiday_2',
        '🏨',
        'Vícedenní přechod',
        'Zaznamenaný výšlap trvající min. 2 dny.',
        'Žádné spaní pod širákem a jehličí ve vlasech – večer tě čeká teplá sprcha, měkká postel v penzionu a pocit, že civilizace má něco do sebe.',
        2
      ),
      evalMultiDay(
        'multiday_6',
        '🏨',
        'Zkušený kočovník',
        'Zaznamenaný výšlap trvající víc než 5 dnů.',
        'Týdenní šňůra výšlapů, kde sice poctivě šlapeš od rána do večera, ale díky večernímu zázemí máš vždy vypráno, usušeno a voníš mýdlem.',
        6
      ),
      evalMultiDay(
        'multiday_11',
        '🏨',
        'Expediční vůdce',
        'Zaznamenaný výšlap trvající víc než 10 dnů.',
        'Desetidenní maraton v nohách, ale protože se spí v suchu a pod střechou, tvoje vybavení i morálka drží pohromadě lépe než leckterá předpověď počasí.',
        11
      ),
      evalWeekendDouble(),
      evalWeeklyStreak(
        'streak_10w',
        '🗓️',
        'Železný základ (10 týdnů)',
        'Výšlapy po 10 týdnů v řadě.',
        'První velký test vytrvalosti. Tvoje okolí už chápe, že víkend bez hřebene prostě neexistuje.',
        10
      ),
      evalWeeklyStreak(
        'streak_20w',
        '🗓️',
        'Půlroční mašina (20 týdnů)',
        'Výšlapy po 20 týdnů v řadě.',
        'Polovina roku v neustálém pohybu. Boty v předsíni už pomalu odmítají chodit do skříně, protože vědí, že brzy půjdou ven zas.',
        20
      ),
      evalWeeklyStreak(
        'streak_30w',
        '🗓️',
        'Nezastavitelný kolos (30 týdnů)',
        'Výšlapy po 30 týdnů v řadě.',
        'Absolutní špička disciplíny. Víkend bez výšlapu v tobě už vyvolává abstinenční příznaky a lehkou paniku.',
        30
      ),
      evalAll12Months(),
    ];
  }, [enrichedHikes]);

  // Filter milestones by status if selected
  const visibleMilestones = useMemo(() => {
    if (filterStatus === 'completed') return milestones.filter((m) => m.isCompleted);
    if (filterStatus === 'pending') return milestones.filter((m) => !m.isCompleted);
    return milestones;
  }, [milestones, filterStatus]);

  const completedCount = useMemo(
    () => milestones.filter((m) => m.isCompleted).length,
    [milestones]
  );

  const categories = [
    {
      id: 'distance' as const,
      title: '1. Kilometrové výzvy (Vzdálenost)',
      subtitle: 'Od prvního puchýře až po mezinárodní migraci',
      icon: Footprints,
      accent: 'from-emerald-600 to-teal-600',
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      id: 'elevation' as const,
      title: '2. Výškové milníky (Převýšení & Stoupání)',
      subtitle: 'Vertikální metry, hřebeny a dotek stratosféry',
      icon: Mountain,
      accent: 'from-indigo-600 to-sky-600',
      badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    },
    {
      id: 'activity' as const,
      title: '3. Časové a sezónní milníky (Aktivita)',
      subtitle: 'Roční období, vícedenní přechody a železná pravidelnost',
      icon: Flame,
      accent: 'from-amber-600 to-orange-600',
      badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
    },
  ];

  const hasCustomFilter =
    filterYear !== currentCalendarYear.toString() ||
    filterParticipant !== 'all' ||
    filterStatus !== 'all';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-7">
      {/* Top Header & Independent Filter Bar */}
      <div className="bg-white rounded-3xl border border-stone-200/90 shadow-xs p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-emerald-600 text-white flex items-center justify-center shadow-md shrink-0">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 tracking-tight">
                Horské milníky a výzvy
              </h1>
              <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
                Přehled splněných trofejí, datumů dosažení a zbývajících cílů
              </p>
            </div>
          </div>

          {/* Overall Progress Pill */}
          <div className="bg-stone-50 border border-stone-200/80 rounded-2xl p-3.5 sm:px-5 flex items-center gap-4">
            <div className="flex-1 min-w-[140px]">
              <div className="flex items-center justify-between text-xs font-bold text-stone-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Celkový postup</span>
                </span>
                <span className="text-emerald-700 font-extrabold">
                  {completedCount} / {milestones.length} ({Math.round((completedCount / milestones.length) * 100)} %)
                </span>
              </div>
              <div className="w-full h-2.5 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${(completedCount / milestones.length) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Independent Filters */}
        <div className="pt-4 border-t border-stone-100 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-400 mr-1 self-center">
              <Filter className="w-3.5 h-3.5 text-emerald-600" />
              <span>Nezávislé filtry milníků:</span>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                Rok
              </label>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="all">Všechny roky</option>
                {availableYears.map((y) => (
                  <option key={y} value={y.toString()}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                Účastník
              </label>
              <select
                value={filterParticipant}
                onChange={(e) => setFilterParticipant(e.target.value)}
                className="bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="all">Všichni účastníci</option>
                {availableParticipants.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                Stav milníku
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed' | 'pending')}
                className="bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              >
                <option value="all">Všechny ({milestones.length})</option>
                <option value="completed">Splněné ({completedCount})</option>
                <option value="pending">Nesplněné ({milestones.length - completedCount})</option>
              </select>
            </div>

            {hasCustomFilter && (
              <button
                type="button"
                onClick={() => {
                  setFilterYear(currentCalendarYear.toString());
                  setFilterParticipant('all');
                  setFilterStatus('all');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Resetovat filtry</span>
              </button>
            )}
          </div>

          <div className="text-xs text-stone-500 font-medium">
            Hodnoceno z <span className="font-bold text-stone-800">{enrichedHikes.length}</span> výšlapů
          </div>
        </div>
      </div>

      {/* Categories */}
      {categories.map((cat) => {
        const catItems = visibleMilestones.filter((m) => m.category === cat.id);
        const allCatItems = milestones.filter((m) => m.category === cat.id);
        const catCompleted = allCatItems.filter((m) => m.isCompleted).length;
        const CatIcon = cat.icon;

        if (catItems.length === 0) return null;

        return (
          <section key={cat.id} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${cat.accent} text-white flex items-center justify-center shadow-xs`}
                >
                  <CatIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-stone-900">{cat.title}</h2>
                  <p className="text-xs text-stone-500">{cat.subtitle}</p>
                </div>
              </div>

              <span
                className={`text-xs font-extrabold px-3 py-1 rounded-full border ${cat.badgeBg}`}
              >
                Splněno {catCompleted} z {allCatItems.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {catItems.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl border p-4 sm:p-5 flex flex-col justify-between transition-all ${
                    m.isCompleted
                      ? 'bg-white border-emerald-300/90 shadow-sm ring-1 ring-emerald-500/10'
                      : 'bg-white/80 border-stone-200/90 opacity-90 hover:opacity-100'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Top Row: Emoji + Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0 border ${
                            m.isCompleted
                              ? 'bg-emerald-50 border-emerald-200 shadow-2xs'
                              : 'bg-stone-100 border-stone-200 grayscale opacity-75'
                          }`}
                        >
                          {m.icon}
                        </div>
                        <div>
                          <h3 className="font-extrabold text-sm sm:text-[15px] text-stone-900 leading-snug">
                            {m.title}
                          </h3>
                          <p className="text-xs font-semibold text-stone-600 mt-0.5">
                            {m.explanation}
                          </p>
                        </div>
                      </div>

                      {m.isCompleted ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Splněno</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-500 border border-stone-200 shrink-0">
                          <Clock className="w-3 h-3 text-stone-400" />
                          <span>Výzva</span>
                        </span>
                      )}
                    </div>

                    {/* Humorous Note */}
                    <div
                      className={`text-xs italic p-3 rounded-xl border-l-3 leading-relaxed ${
                        m.isCompleted
                          ? 'bg-emerald-50/50 text-stone-700 border-emerald-500'
                          : 'bg-stone-50 text-stone-500 border-stone-300'
                      }`}
                    >
                      „{m.humor}“
                    </div>
                  </div>

                  {/* Bottom Progress & Completion / Remaining Info */}
                  <div className="pt-4 mt-4 border-t border-stone-100 space-y-2">
                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-stone-600">{m.currentLabel}</span>
                        <span className={m.isCompleted ? 'text-emerald-700' : 'text-stone-500'}>
                          {Math.round(m.progressPct)} %
                        </span>
                      </div>
                      <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden border border-stone-200/60">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            m.isCompleted
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                              : 'bg-gradient-to-r from-amber-400 to-orange-500'
                          }`}
                          style={{ width: `${Math.max(m.progressPct > 0 ? 4 : 0, m.progressPct)}%` }}
                        />
                      </div>
                    </div>

                    {/* Fulfilled Date & Trip OR Remaining */}
                    {m.isCompleted ? (
                      <div className="bg-emerald-50/80 border border-emerald-200/70 rounded-xl p-2.5 text-[11px] space-y-1">
                        <div className="flex items-center justify-between gap-2 text-emerald-900 font-bold">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Splněno: {m.completedDate || 'Ano'}</span>
                          </span>
                        </div>
                        {m.completedTripName && (
                          <div className="flex items-center justify-between gap-2 text-stone-600">
                            <span className="truncate" title={m.completedTripName}>
                              Výšlap: <strong className="text-stone-800">{m.completedTripName}</strong>
                            </span>
                            {m.completedTripId && (
                              <button
                                type="button"
                                onClick={() => onSelectTripOnMap(m.completedTripId!)}
                                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 hover:text-emerald-900 shrink-0 cursor-pointer hover:underline"
                                title="Zobrazit tuto trasu na mapě"
                              >
                                <MapPin className="w-3 h-3" />
                                <span>Mapa</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl p-2.5 text-[11px] text-amber-900 font-semibold flex items-start gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>{m.remainingLabel}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
