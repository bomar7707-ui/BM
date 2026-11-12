import { Hike } from '../types';
import { calculateDistanceKm, getSegmentDistanceKm } from './gpxParser';
import { parseSafeDate, formatCzechDate, getDisplayDateRange } from './dateUtils';

export interface DailySegmentMetric {
  distKm: number;
  ascentM: number;
  label: string;
}

export interface EnrichedHike {
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

export interface MilestoneStatus {
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
  const day = copy.getDay();
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

export function enrichHikesForMilestones(
  hikes: Hike[],
  filterYear: string = 'all',
  filterParticipant: string = 'all'
): EnrichedHike[] {
  const matching = hikes.filter((trip) => {
    const d =
      parseSafeDate(trip.rawDate) ||
      parseSafeDate(trip.date?.split('–')[0]) ||
      parseSafeDate(trip.date?.split('-')[0]);

    if (filterYear !== 'all') {
      if (!d || d.getFullYear().toString() !== filterYear) return false;
    }
    if (filterParticipant !== 'all') {
      if (!trip.participants) return false;
      const parts = trip.participants
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
      if (!parts.includes(filterParticipant.trim().toLowerCase())) {
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

    let distKm = typeof trip.distance === 'string' ? parseFloat(trip.distance) : trip.distance;
    if (isNaN(distKm)) distKm = 0;

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

  mapped.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return mapped;
}

export function evaluateMilestonesFromEnriched(enrichedHikes: EnrichedHike[]): MilestoneStatus[] {
  const totalKm = enrichedHikes.reduce((acc, h) => acc + h.distKm, 0);
  const totalAscent = enrichedHikes.reduce((acc, h) => acc + h.ascentM, 0);
  const maxSingleKm = enrichedHikes.reduce((max, h) => Math.max(max, h.maxDailyDistKm), 0);
  const maxSingleAscent = enrichedHikes.reduce((max, h) => Math.max(max, h.maxDailyAscentM), 0);
  const maxElevationPoint = enrichedHikes.reduce((max, h) => Math.max(max, h.maxEleM), 0);
  const maxDurationDays = enrichedHikes.reduce((max, h) => Math.max(max, h.durationDays), 0);

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
      currentLabel: isCompleted
        ? '2 / 2 víkendové dny'
        : hasAnyWeekendHike
        ? '1 / 2 víkendové dny'
        : '0 / 2 víkendové dny',
      remainingLabel: isCompleted
        ? 'Splněno (sobota i neděle za sebou)'
        : hasAnyWeekendHike
        ? 'Zbývá: přidat druhý víkendový den hned po sobě (sobota + neděle)'
        : 'Zbývá: absolvovat výšlap v sobotu i v neděli během jednoho víkendu',
    };
  };

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

  const evalAll12Months = (): MilestoneStatus => {
    const monthsByYear = new Map<number, Set<number>>();
    let unlockedBy: EnrichedHike | null = null;
    let unlockedYear: number | null = null;

    for (const h of enrichedHikes) {
      for (const d of h.activeDates) {
        if (d.getTime() <= 0) continue;
        const y = d.getFullYear();
        const m = d.getMonth();
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
}

export function evaluateMilestonesForParticipant(
  hikes: Hike[],
  participantName: string,
  filterYear: string = new Date().getFullYear().toString()
): MilestoneStatus[] {
  const enriched = enrichHikesForMilestones(hikes, filterYear, participantName);
  return evaluateMilestonesFromEnriched(enriched);
}
