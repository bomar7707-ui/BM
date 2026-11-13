import React, { useMemo, useState } from 'react';
import {
  Trophy,
  Route,
  CalendarCheck,
  TrendingUp,
  TrendingDown,
  Mountain,
  Layers,
  ArrowUp,
  ArrowDown,
  Filter,
  CalendarDays,
  Compass,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
} from 'recharts';
import { Hike, FilterState } from '../types';
import { calculateDistanceKm, getSegmentDistanceKm } from '../utils/gpxParser';
import { parseSafeDate, formatCzechDate } from '../utils/dateUtils';

interface AnalyticsViewProps {
  hikes: Hike[];
  initialTripId?: string | null;
  onSelectTripOnMap: (tripId: string) => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  hikes,
  initialTripId,
  onSelectTripOnMap,
}) => {
  const currentCalendarYear = new Date().getFullYear();
  const [selectedTripId, setSelectedTripId] = useState<string>(initialTripId || 'all');
  const [filterYear, setFilterYear] = useState<string>(() => {
    if (initialTripId && initialTripId !== 'all') {
      const found = hikes.find((h) => h.id === initialTripId);
      const d =
        parseSafeDate(found?.rawDate) ||
        parseSafeDate(found?.date?.split('–')[0]) ||
        parseSafeDate(found?.date?.split('-')[0]);
      if (d && !isNaN(d.getFullYear())) return d.getFullYear().toString();
    }
    return currentCalendarYear.toString();
  });
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterParticipant, setFilterParticipant] = useState<string>('all');

  // Available options (always include current calendar year)
  const { availableYears, availableParticipants } = useMemo(() => {
    const years = new Set<number>([currentCalendarYear]);
    const parts = new Set<string>();

    hikes.forEach((t) => {
      const d = parseSafeDate(t.rawDate) || parseSafeDate(t.date?.split('–')[0]) || parseSafeDate(t.date?.split('-')[0]);
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

  // Filtered hikes for analytics
  const filteredHikes = useMemo(() => {
    return hikes.filter((trip) => {
      if (selectedTripId !== 'all' && trip.id !== selectedTripId) return false;

      const d = parseSafeDate(trip.rawDate) || parseSafeDate(trip.date?.split('–')[0]) || parseSafeDate(trip.date?.split('-')[0]);
      if (filterYear !== 'all') {
        if (!d || d.getFullYear().toString() !== filterYear) return false;
      }
      if (filterMonth !== 'all') {
        if (!d || (d.getMonth() + 1).toString() !== filterMonth) return false;
      }
      if (filterParticipant !== 'all') {
        if (!trip.participants || !trip.participants.toLowerCase().includes(filterParticipant.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [hikes, selectedTripId, filterYear, filterMonth, filterParticipant]);

  // Overall analytics calculations
  const analytics = useMemo(() => {
    let maxDailyDist = { val: 0, name: '-' };
    let maxMultiDayDist = { val: 0, name: '-' };
    let maxDailyAsc = { val: 0, name: '-' };
    let maxMultiDayAsc = { val: 0, name: '-' };
    let maxEle = { val: 0, name: '-' };
    let totalAscentAll = 0;
    let totalDescentAll = 0;
    let totalKmAll = 0;

    const activityByDay: Record<string, number> = {};
    const monthlyKm: number[] = Array(12).fill(0);
    let totalActiveDays = 0;

    // Gradient buckets
    let distFlat = 0,
      distStd = 0,
      distSteep = 0,
      distExtreme = 0;

    // Altitudinal zones buckets
    let distZ1 = 0,
      distZ2 = 0,
      distZ3 = 0,
      distZ4 = 0;

    // Ascent & descent incline breakdown
    let ascGrad1 = 0,
      ascGrad2 = 0,
      ascGrad3 = 0,
      ascGrad4 = 0;
    let descGrad1 = 0,
      descGrad2 = 0,
      descGrad3 = 0,
      descGrad4 = 0;

    filteredHikes.forEach((trip) => {
      const distNum = typeof trip.distance === 'string' ? parseFloat(trip.distance) : trip.distance;
      const routes = trip.routes || trip.maps || [];

      const startD = parseSafeDate(trip.rawDate) || parseSafeDate(trip.date?.split('–')[0]);
      let endD =
        parseSafeDate(trip.endDate) ||
        parseSafeDate(trip.dateTo) ||
        parseSafeDate(trip.date?.split('–')[1]) ||
        (startD ? new Date(startD) : null);
      if (startD && endD && endD < startD) endD = new Date(startD);

      let diffDays = 1;
      if (startD && endD) {
        const sNorm = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 12, 0, 0);
        const eNorm = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate(), 12, 0, 0);
        diffDays = Math.max(1, Math.round((eNorm.getTime() - sNorm.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      }

      const isMultiDayTrip = diffDays > 1 || routes.length > 1;

      if (!isNaN(distNum)) {
        totalKmAll += distNum;
        if (isMultiDayTrip) {
          if (distNum > maxMultiDayDist.val) {
            maxMultiDayDist = { val: distNum, name: trip.name };
          }
        } else {
          if (distNum > maxDailyDist.val) {
            maxDailyDist = { val: distNum, name: trip.name };
          }
        }
      }

      let tripAsc = 0;
      let tripDesc = 0;
      let tripMaxEle = 0;

      routes.forEach((m, mIdx) => {
        const segLabel = routes.length > 1 ? `${trip.name} (Úsek ${mIdx + 1})` : trip.name;
        if (!isMultiDayTrip || routes.length > 1) {
          const segDist = getSegmentDistanceKm(
            m,
            routes.length,
            isMultiDayTrip ? undefined : trip.distance
          );
          if (segDist !== null && segDist > maxDailyDist.val) {
            maxDailyDist = { val: segDist, name: segLabel };
          }
        }

        if (!m.coordinates || m.coordinates.length < 2) return;

        let segAsc = 0;

        for (let i = 1; i < m.coordinates.length; i++) {
          const p1 = m.coordinates[i - 1];
          const p2 = m.coordinates[i];

          const dKm = calculateDistanceKm(p1[0], p1[1], p2[0], p2[1]);
          const dMeters = dKm * 1000;

          // Elevations
          const ele1 = p1.length >= 3 && p1[2] !== null && !isNaN(p1[2] as number) ? (p1[2] as number) : null;
          const ele2 = p2.length >= 3 && p2[2] !== null && !isNaN(p2[2] as number) ? (p2[2] as number) : null;

          if (ele2 !== null && ele2 > tripMaxEle) tripMaxEle = ele2;
          if (ele1 !== null && ele1 > tripMaxEle) tripMaxEle = ele1;

          if (ele1 !== null && ele2 !== null) {
            const eleDiff = ele2 - ele1;
            if (eleDiff > 0) {
              tripAsc += eleDiff;
              segAsc += eleDiff;
            } else {
              tripDesc += Math.abs(eleDiff);
            }

            // Altitudinal zone based on ele2
            if (ele2 < 500) distZ1 += dKm;
            else if (ele2 < 1000) distZ2 += dKm;
            else if (ele2 < 1500) distZ3 += dKm;
            else distZ4 += dKm;

            // Gradient
            if (dMeters > 0) {
              const grade = (Math.abs(eleDiff) / dMeters) * 100;
              if (grade < 5) distFlat += dKm;
              else if (grade < 10) distStd += dKm;
              else if (grade < 20) distSteep += dKm;
              else distExtreme += dKm;

              if (eleDiff > 0) {
                if (grade < 5) ascGrad1 += eleDiff;
                else if (grade < 10) ascGrad2 += eleDiff;
                else if (grade < 20) ascGrad3 += eleDiff;
                else ascGrad4 += eleDiff;
              } else if (eleDiff < 0) {
                const absDiff = Math.abs(eleDiff);
                if (grade < 5) descGrad1 += absDiff;
                else if (grade < 10) descGrad2 += absDiff;
                else if (grade < 20) descGrad3 += absDiff;
                else descGrad4 += absDiff;
              }
            }
          } else {
            distFlat += dKm;
            distZ1 += dKm;
          }
        }

        if ((!isMultiDayTrip || routes.length > 1) && segAsc > maxDailyAsc.val) {
          maxDailyAsc = { val: Math.round(segAsc), name: segLabel };
        }
      });

      totalAscentAll += tripAsc;
      totalDescentAll += tripDesc;

      if (isMultiDayTrip) {
        if (tripAsc > maxMultiDayAsc.val) {
          maxMultiDayAsc = { val: Math.round(tripAsc), name: trip.name };
        }
      } else {
        if (tripAsc > maxDailyAsc.val) {
          maxDailyAsc = { val: Math.round(tripAsc), name: trip.name };
        }
      }
      if (tripMaxEle > maxEle.val) maxEle = { val: Math.round(tripMaxEle), name: trip.name };

      // Calendar day activity
      if (startD && endD) {
        const sNorm = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 12, 0, 0);
        const kmPerDay = !isNaN(distNum) ? distNum / diffDays : 0;

        for (let i = 0; i < diffDays; i++) {
          const currentDay = new Date(sNorm);
          currentDay.setDate(currentDay.getDate() + i);
          const dayKey = currentDay.toISOString().slice(0, 10);
          if (!activityByDay[dayKey]) {
            activityByDay[dayKey] = 0;
            totalActiveDays++;
          }
          activityByDay[dayKey] += kmPerDay;

          const mIdx = currentDay.getMonth();
          if (mIdx >= 0 && mIdx < 12) {
            monthlyKm[mIdx] += kmPerDay;
          }
        }
      }
    });

    const totalGradDist = distFlat + distStd + distSteep + distExtreme;
    const totalZoneDist = distZ1 + distZ2 + distZ3 + distZ4;
    const totalAscGrad = ascGrad1 + ascGrad2 + ascGrad3 + ascGrad4;
    const totalDescGrad = descGrad1 + descGrad2 + descGrad3 + descGrad4;

    return {
      totalKm: totalKmAll,
      activeDays: totalActiveDays,
      avgKmPerDay: totalActiveDays > 0 ? totalKmAll / totalActiveDays : 0,
      avgAscPerDay: totalActiveDays > 0 ? totalAscentAll / totalActiveDays : 0,
      maxDailyDist,
      maxMultiDayDist,
      maxDailyAsc,
      maxMultiDayAsc,
      maxEle,
      totalAscent: Math.round(totalAscentAll),
      totalDescent: Math.round(totalDescentAll),
      activityByDay,
      monthlyKm,
      gradients: {
        flat: { km: distFlat, pct: totalGradDist > 0 ? (distFlat / totalGradDist) * 100 : 0 },
        std: { km: distStd, pct: totalGradDist > 0 ? (distStd / totalGradDist) * 100 : 0 },
        steep: { km: distSteep, pct: totalGradDist > 0 ? (distSteep / totalGradDist) * 100 : 0 },
        extreme: { km: distExtreme, pct: totalGradDist > 0 ? (distExtreme / totalGradDist) * 100 : 0 },
      },
      zones: {
        z1: { km: distZ1, pct: totalZoneDist > 0 ? (distZ1 / totalZoneDist) * 100 : 0 },
        z2: { km: distZ2, pct: totalZoneDist > 0 ? (distZ2 / totalZoneDist) * 100 : 0 },
        z3: { km: distZ3, pct: totalZoneDist > 0 ? (distZ3 / totalZoneDist) * 100 : 0 },
        z4: { km: distZ4, pct: totalZoneDist > 0 ? (distZ4 / totalZoneDist) * 100 : 0 },
      },
      ascGradients: {
        a1: { m: Math.round(ascGrad1), pct: totalAscGrad > 0 ? (ascGrad1 / totalAscGrad) * 100 : 0 },
        a2: { m: Math.round(ascGrad2), pct: totalAscGrad > 0 ? (ascGrad2 / totalAscGrad) * 100 : 0 },
        a3: { m: Math.round(ascGrad3), pct: totalAscGrad > 0 ? (ascGrad3 / totalAscGrad) * 100 : 0 },
        a4: { m: Math.round(ascGrad4), pct: totalAscGrad > 0 ? (ascGrad4 / totalAscGrad) * 100 : 0 },
      },
      descGradients: {
        d1: { m: Math.round(descGrad1), pct: totalDescGrad > 0 ? (descGrad1 / totalDescGrad) * 100 : 0 },
        d2: { m: Math.round(descGrad2), pct: totalDescGrad > 0 ? (descGrad2 / totalDescGrad) * 100 : 0 },
        d3: { m: Math.round(descGrad3), pct: totalDescGrad > 0 ? (descGrad3 / totalDescGrad) * 100 : 0 },
        d4: { m: Math.round(descGrad4), pct: totalDescGrad > 0 ? (descGrad4 / totalDescGrad) * 100 : 0 },
      },
    };
  }, [filteredHikes]);

  // Detailed cumulative elevation data for each hike (sorted oldest to newest)
  const cumulativeElevationData = useMemo(() => {
    const sorted = [...filteredHikes].sort((a, b) => {
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
      return dateA.getTime() - dateB.getTime();
    });

    let runningAscent = 0;
    let runningDescent = 0;
    let runningDistance = 0;

    return sorted.map((trip, index) => {
      const routes = trip.routes || trip.maps || [];
      let tripAsc = 0;
      let tripDesc = 0;
      let tripMaxEle = 0;

      routes.forEach((m) => {
        if (!m.coordinates || m.coordinates.length < 2) return;
        for (let i = 1; i < m.coordinates.length; i++) {
          const p1 = m.coordinates[i - 1];
          const p2 = m.coordinates[i];
          const ele1 =
            p1.length >= 3 && p1[2] !== null && !isNaN(p1[2] as number) ? (p1[2] as number) : null;
          const ele2 =
            p2.length >= 3 && p2[2] !== null && !isNaN(p2[2] as number) ? (p2[2] as number) : null;

          if (ele1 !== null && ele1 > tripMaxEle) tripMaxEle = ele1;
          if (ele2 !== null && ele2 > tripMaxEle) tripMaxEle = ele2;

          if (ele1 !== null && ele2 !== null) {
            const diff = ele2 - ele1;
            if (diff > 0) tripAsc += diff;
            else tripDesc += Math.abs(diff);
          }
        }
      });

      const ascRounded = Math.round(tripAsc);
      const descRounded = Math.round(tripDesc);
      const distNum =
        typeof trip.distance === 'string' ? parseFloat(trip.distance) || 0 : trip.distance || 0;

      runningAscent += ascRounded;
      runningDescent += descRounded;
      runningDistance += distNum;

      const dateStr = formatCzechDate(trip.date || trip.rawDate);
      const shortName = trip.name.length > 18 ? `${trip.name.slice(0, 16)}…` : trip.name;

      return {
        index: index + 1,
        id: trip.id,
        name: trip.name,
        shortLabel: `${index + 1}. ${shortName}`,
        date: dateStr,
        distance: Number(distNum.toFixed(1)),
        cumulativeDistance: Number(runningDistance.toFixed(1)),
        hikeAscent: ascRounded,
        hikeDescent: descRounded,
        cumulativeAscent: runningAscent,
        cumulativeDescent: runningDescent,
        maxElevation: Math.round(tripMaxEle),
      };
    });
  }, [filteredHikes]);

  // If a single hike is selected, also compute its step-by-step cumulative elevation along the route
  const singleTripCumulativeProfile = useMemo(() => {
    if (selectedTripId === 'all' || filteredHikes.length !== 1) return null;
    const trip = filteredHikes[0];
    const routes = trip.routes || trip.maps || [];
    const allCoords = routes.flatMap((r) => r.coordinates || []);
    const ptsWithEle = allCoords.filter((p) => typeof p[2] === 'number' && !isNaN(p[2] as number));
    if (ptsWithEle.length < 2) return null;

    let cumDist = 0;
    let cumAsc = 0;
    let cumDesc = 0;

    const rawSteps: {
      distKm: number;
      altitude: number;
      cumulativeAscent: number;
      cumulativeDescent: number;
    }[] = [
      {
        distKm: 0,
        altitude: Math.round(ptsWithEle[0][2] as number),
        cumulativeAscent: 0,
        cumulativeDescent: 0,
      },
    ];

    for (let i = 1; i < ptsWithEle.length; i++) {
      const prev = ptsWithEle[i - 1];
      const curr = ptsWithEle[i];
      cumDist += calculateDistanceKm(prev[0], prev[1], curr[0], curr[1]);
      const diff = (curr[2] as number) - (prev[2] as number);
      if (diff > 0) cumAsc += diff;
      else cumDesc += Math.abs(diff);

      rawSteps.push({
        distKm: Number(cumDist.toFixed(2)),
        altitude: Math.round(curr[2] as number),
        cumulativeAscent: Math.round(cumAsc),
        cumulativeDescent: Math.round(cumDesc),
      });
    }

    // Downsample to at most ~120 points for smooth Recharts rendering
    const maxPts = 120;
    if (rawSteps.length <= maxPts) return rawSteps;
    const stride = (rawSteps.length - 1) / (maxPts - 1);
    const sampled = [];
    for (let i = 0; i < maxPts; i++) {
      sampled.push(rawSteps[Math.min(rawSteps.length - 1, Math.round(i * stride))]);
    }
    return sampled;
  }, [selectedTripId, filteredHikes]);

  // Target Year for Heatmap
  const heatmapYear = useMemo(() => {
    if (filterYear !== 'all') return parseInt(filterYear, 10);
    if (availableYears.length > 0) return availableYears[0];
    return new Date().getFullYear();
  }, [filterYear, availableYears]);

  // Heatmap Cells Matrix
  const heatmapMatrix = useMemo(() => {
    const startDate = new Date(heatmapYear, 0, 1, 12, 0, 0);
    const endDate = new Date(heatmapYear, 11, 31, 12, 0, 0);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    let startDayOfWeek = startDate.getDay();
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // 0 = Mon, 6 = Sun

    const cells: ({ date: string; dist: number; levelClass: string } | null)[][] = Array(7)
      .fill(null)
      .map(() => Array(54).fill(null));

    for (let i = 0; i < totalDays; i++) {
      const curr = new Date(heatmapYear, 0, i + 1, 12, 0, 0);
      const dayStr = curr.toISOString().slice(0, 10);

      const col = Math.floor((i + startDayOfWeek) / 7);
      let row = curr.getDay();
      row = row === 0 ? 6 : row - 1;

      const dist = analytics.activityByDay[dayKeyForDate(curr)] || 0;
      let levelClass = '';
      if (dist > 0 && dist < 10) levelClass = 'level-1';
      else if (dist >= 10 && dist < 20) levelClass = 'level-2';
      else if (dist >= 20 && dist < 35) levelClass = 'level-3';
      else if (dist >= 35) levelClass = 'level-4';

      if (cells[row] && col < 54) {
        cells[row][col] = { date: dayStr, dist, levelClass };
      }
    }

    return cells;
  }, [heatmapYear, analytics.activityByDay]);

  function dayKeyForDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  return (
    <div className="w-full bg-slate-50 min-h-[calc(100vh-64px)] p-4 sm:p-7 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header & Filter Card */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-500" />
                <span>Analytika a statistiky</span>
              </h2>
              <p className="text-xs text-slate-500">
                Podrobné rozbory profilu terénu, výškových zón a aktivity
              </p>
            </div>

            {selectedTripId !== 'all' && (
              <button
                onClick={() => onSelectTripOnMap(selectedTripId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-2xs self-start sm:self-auto transition-transform hover:scale-102"
              >
                <Compass className="w-4 h-4" />
                <span>Zobrazit trasu v mapě</span>
              </button>
            )}
          </div>

          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Vybraná trasa
              </label>
              <select
                value={selectedTripId}
                onChange={(e) => setSelectedTripId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none"
              >
                <option value="all">Všechny trasy souhrnně</option>
                {[...hikes]
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
                  })
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({formatCzechDate(t.date || t.rawDate)})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Rok
              </label>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none"
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
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Měsíc
              </label>
              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none"
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

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Účastník
              </label>
              <select
                value={filterParticipant}
                onChange={(e) => setFilterParticipant(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none"
              >
                <option value="all">Všichni</option>
                {availableParticipants.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Primary Statistics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Active Days - Moved to the left and stretched across both rows */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs sm:row-span-2 lg:row-span-2 flex flex-col justify-between">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 shrink-0">
                <CalendarCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[11px] uppercase font-bold tracking-wider text-slate-500 mb-1">
                  Aktivní dny
                </div>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {analytics.activeDays}{' '}
                  <span className="text-xs font-semibold text-slate-500 block mt-1">dnů na cestě</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                <span className="text-slate-500 font-medium">Průměrná délka:</span>
                <strong className="text-slate-900 font-extrabold">
                  {analytics.avgKmPerDay.toFixed(1)} km/den
                </strong>
              </div>
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                <span className="text-slate-500 font-medium">Průměrné převýšení:</span>
                <strong className="text-slate-900 font-extrabold">
                  {Math.round(analytics.avgAscPerDay)} m/den
                </strong>
              </div>
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                <span className="text-slate-500 font-medium">Počet výšlapů:</span>
                <strong className="text-emerald-700 font-extrabold">
                  {filteredHikes.length}
                </strong>
              </div>
            </div>
          </div>

          {/* Row 1, Col 2: Total Km */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 shrink-0">
              <Route className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Celkové kilometry
              </div>
              <div className="text-lg sm:text-xl font-black text-emerald-700">
                {analytics.totalKm.toFixed(1)} km
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">Ve vybraném období</div>
            </div>
          </div>

          {/* Row 1, Col 3: Longest Daily Route */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Nejdelší denní trasa
              </div>
              <div className="text-lg sm:text-xl font-black text-emerald-600">
                {analytics.maxDailyDist.val.toFixed(1)} km
              </div>
              <div
                className="text-[11px] text-slate-500 truncate"
                title={analytics.maxDailyDist.name}
              >
                {analytics.maxDailyDist.name}
              </div>
            </div>
          </div>

          {/* Row 1, Col 4: Longest Cumulative Route (Multi-day) */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-teal-50 rounded-xl text-teal-600 shrink-0">
              <Route className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Nejdelší kumulovaná trasa (vícedenní)
              </div>
              <div className="text-lg sm:text-xl font-black text-teal-700">
                {analytics.maxMultiDayDist.val.toFixed(1)} km
              </div>
              <div
                className="text-[11px] text-slate-500 truncate"
                title={analytics.maxMultiDayDist.name}
              >
                {analytics.maxMultiDayDist.name}
              </div>
            </div>
          </div>

          {/* Row 1, Col 5: Highest elevation reached */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600 shrink-0">
              <Mountain className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Nejvyšší dosažený bod
              </div>
              <div className="text-lg sm:text-xl font-black text-indigo-700">
                {analytics.maxEle.val.toLocaleString('cs-CZ')} m n.m.
              </div>
              <div className="text-[11px] text-slate-500 truncate" title={analytics.maxEle.name}>
                {analytics.maxEle.name}
              </div>
            </div>
          </div>

          {/* Row 2, Col 2: Total Ascent */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-sky-50 rounded-xl text-sky-600 shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Celkově nastoupáno
              </div>
              <div className="text-lg sm:text-xl font-black text-sky-700">
                {analytics.totalAscent.toLocaleString('cs-CZ')} m
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">Součet převýšení</div>
            </div>
          </div>

          {/* Row 2, Col 3: Highest Daily Ascent */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-rose-50 rounded-xl text-rose-600 shrink-0">
              <ArrowUp className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Nejvyšší denní stoupání
              </div>
              <div className="text-lg sm:text-xl font-black text-rose-600">
                {analytics.maxDailyAsc.val.toLocaleString('cs-CZ')} m
              </div>
              <div
                className="text-[11px] text-slate-500 truncate"
                title={analytics.maxDailyAsc.name}
              >
                {analytics.maxDailyAsc.name}
              </div>
            </div>
          </div>

          {/* Row 2, Col 4: Highest Cumulative Ascent (Multi-day) */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-pink-50 rounded-xl text-pink-600 shrink-0">
              <ArrowUp className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Nejvyšší kumulované stoupání (vícedenní)
              </div>
              <div className="text-lg sm:text-xl font-black text-pink-600">
                {analytics.maxMultiDayAsc.val.toLocaleString('cs-CZ')} m
              </div>
              <div
                className="text-[11px] text-slate-500 truncate"
                title={analytics.maxMultiDayAsc.name}
              >
                {analytics.maxMultiDayAsc.name}
              </div>
            </div>
          </div>

          {/* Row 2, Col 5: Total Descent */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-start gap-3">
            <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600 shrink-0">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5">
                Celkově sestoupáno
              </div>
              <div className="text-lg sm:text-xl font-black text-amber-600">
                {analytics.totalDescent.toLocaleString('cs-CZ')} m
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">Součet klesání</div>
            </div>
          </div>
        </div>

        {/* Detailed Cumulative Elevation Chart per Hike (Recharts) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-rose-600" />
                <span>
                  {singleTripCumulativeProfile
                    ? `Detailní graf kumulativního převýšení trasy: ${filteredHikes[0]?.name}`
                    : 'Detailní graf kumulativního převýšení pro každý výšlap'}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {singleTripCumulativeProfile
                  ? 'Průběh kumulovaného stoupání, klesání a nadmořské výšky po kilometrech vybraného výšlapu'
                  : 'Chronologický nárůst celkového nastoupaného a sestoupaného převýšení napříč jednotlivými výšlapy'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                Kumulativní stoupání: +{analytics.totalAscent.toLocaleString('cs-CZ')} m
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 font-bold">
                Kumulativní klesání: -{analytics.totalDescent.toLocaleString('cs-CZ')} m
              </span>
            </div>
          </div>

          {cumulativeElevationData.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              Pro zvolený filtr nejsou k dispozici žádné výšlapy s výškovými daty.
            </div>
          ) : singleTripCumulativeProfile ? (
            <div className="h-80 sm:h-96 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={singleTripCumulativeProfile}
                  margin={{ top: 10, right: 20, left: 5, bottom: 10 }}
                >
                  <defs>
                    <linearGradient id="cumAscSingleGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="cumDescSingleGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="distKm"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(val) => `${val} km`}
                  />
                  <YAxis
                    yAxisId="cum"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(val) => `${val} m`}
                  />
                  <YAxis
                    yAxisId="alt"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#059669' }}
                    tickFormatter={(val) => `${val} m n.m.`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid #334155',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#cbd5e1', fontWeight: 700, marginBottom: '4px' }}
                    labelFormatter={(val) => `Vzdálenost na trase: ${val} km`}
                    formatter={(value: unknown, name: unknown) => [
                      `${Number(value).toLocaleString('cs-CZ')} m`,
                      String(name),
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Area
                    yAxisId="cum"
                    type="monotone"
                    dataKey="cumulativeAscent"
                    name="Kumulativní stoupání (+m)"
                    stroke="#e11d48"
                    strokeWidth={2.5}
                    fill="url(#cumAscSingleGrad)"
                  />
                  <Area
                    yAxisId="cum"
                    type="monotone"
                    dataKey="cumulativeDescent"
                    name="Kumulativní klesání (-m)"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fill="url(#cumDescSingleGrad)"
                  />
                  <Line
                    yAxisId="alt"
                    type="monotone"
                    dataKey="altitude"
                    name="Nadmořská výška (m n.m.)"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-85 sm:h-100 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={cumulativeElevationData}
                  margin={{ top: 10, right: 20, left: 5, bottom: 20 }}
                >
                  <defs>
                    <linearGradient id="cumAscentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="cumDescentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    interval="preserveStartEnd"
                    angle={-20}
                    textAnchor="end"
                    height={55}
                  />
                  <YAxis
                    yAxisId="cumulative"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(val) => `${Number(val).toLocaleString('cs-CZ')} m`}
                  />
                  <YAxis
                    yAxisId="single"
                    orientation="right"
                    tick={{ fontSize: 11, fill: '#059669' }}
                    tickFormatter={(val) => `+${val} m`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0].payload as (typeof cumulativeElevationData)[number];
                      return (
                        <div className="bg-slate-900/95 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs space-y-1.5">
                          <div className="font-extrabold text-sm text-emerald-400">
                            {row.index}. {row.name}
                          </div>
                          <div className="text-slate-300 text-[11px]">
                            Datum: <span className="text-white font-semibold">{row.date}</span> •
                            Délka: <span className="text-white font-semibold">{row.distance} km</span>
                          </div>
                          <div className="border-t border-slate-700/80 pt-1.5 space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-emerald-300">Stoupání výšlapu:</span>
                              <span className="font-bold text-white">
                                +{row.hikeAscent.toLocaleString('cs-CZ')} m
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-amber-300">Klesání výšlapu:</span>
                              <span className="font-bold text-white">
                                -{row.hikeDescent.toLocaleString('cs-CZ')} m
                              </span>
                            </div>
                            {row.maxElevation > 0 && (
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-indigo-300">Max. výška výšlapu:</span>
                                <span className="font-bold text-white">
                                  {row.maxElevation.toLocaleString('cs-CZ')} m n.m.
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="border-t border-slate-700/80 pt-1.5 space-y-1">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-rose-400 font-semibold">
                                Kumulativní stoupání celkem:
                              </span>
                              <span className="font-extrabold text-rose-300">
                                +{row.cumulativeAscent.toLocaleString('cs-CZ')} m
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-sky-400 font-semibold">
                                Kumulativní klesání celkem:
                              </span>
                              <span className="font-extrabold text-sky-300">
                                -{row.cumulativeDescent.toLocaleString('cs-CZ')} m
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }} />
                  <Bar
                    yAxisId="single"
                    dataKey="hikeAscent"
                    name="Stoupání daného výšlapu (+m)"
                    fill="#10b981"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={32}
                  />
                  <Area
                    yAxisId="cumulative"
                    type="monotone"
                    dataKey="cumulativeAscent"
                    name="Kumulativní stoupání (+m)"
                    stroke="#e11d48"
                    strokeWidth={2.5}
                    fill="url(#cumAscentGrad)"
                  />
                  <Area
                    yAxisId="cumulative"
                    type="monotone"
                    dataKey="cumulativeDescent"
                    name="Kumulativní klesání (-m)"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fill="url(#cumDescentGrad)"
                  />
                  {cumulativeElevationData.length > 10 && (
                    <Brush
                      dataKey="shortLabel"
                      height={22}
                      stroke="#10b981"
                      fill="#f8fafc"
                      travellerWidth={8}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Gradient Breakdown Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Mountain className="w-4 h-4 text-teal-600" />
              <span>Analýza sklonu terénu (procento stoupání / klesání)</span>
            </h3>
          </div>

          <div className="space-y-2">
            <div className="h-4 w-full bg-slate-100 rounded-xl overflow-hidden flex shadow-inner">
              <div
                style={{ width: `${analytics.gradients.flat.pct}%` }}
                className="bg-emerald-400 h-full transition-all duration-500"
                title={`Rovina (< 5%): ${analytics.gradients.flat.km.toFixed(1)} km`}
              />
              <div
                style={{ width: `${analytics.gradients.std.pct}%` }}
                className="bg-blue-500 h-full transition-all duration-500"
                title={`Standard (5 - 10%): ${analytics.gradients.std.km.toFixed(1)} km`}
              />
              <div
                style={{ width: `${analytics.gradients.steep.pct}%` }}
                className="bg-amber-500 h-full transition-all duration-500"
                title={`Prudký svah (10 - 20%): ${analytics.gradients.steep.km.toFixed(1)} km`}
              />
              <div
                style={{ width: `${analytics.gradients.extreme.pct}%` }}
                className="bg-rose-600 h-full transition-all duration-500"
                title={`Extrém (> 20%): ${analytics.gradients.extreme.km.toFixed(1)} km`}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Rovina (&lt; 5%)</div>
                  <div className="font-bold text-slate-800">
                    {analytics.gradients.flat.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.gradients.flat.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Standard (5–10%)</div>
                  <div className="font-bold text-slate-800">
                    {analytics.gradients.std.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.gradients.std.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Prudký (10–20%)</div>
                  <div className="font-bold text-slate-800">
                    {analytics.gradients.steep.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.gradients.steep.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-rose-600 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Extrém (&gt; 20%)</div>
                  <div className="font-bold text-slate-800">
                    {analytics.gradients.extreme.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.gradients.extreme.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Altitudinal Zones Breakdown Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Výškové zóny trasy (nadmořská výška)</span>
            </h3>
          </div>

          <div className="space-y-2">
            <div className="h-4 w-full bg-slate-100 rounded-xl overflow-hidden flex shadow-inner">
              <div
                style={{ width: `${analytics.zones.z1.pct}%` }}
                className="bg-teal-400 h-full transition-all duration-500"
              />
              <div
                style={{ width: `${analytics.zones.z2.pct}%` }}
                className="bg-blue-500 h-full transition-all duration-500"
              />
              <div
                style={{ width: `${analytics.zones.z3.pct}%` }}
                className="bg-indigo-600 h-full transition-all duration-500"
              />
              <div
                style={{ width: `${analytics.zones.z4.pct}%` }}
                className="bg-purple-700 h-full transition-all duration-500"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-teal-400 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Do 500 m n.m.</div>
                  <div className="font-bold text-slate-800">
                    {analytics.zones.z1.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.zones.z1.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">500 – 1000 m n.m.</div>
                  <div className="font-bold text-slate-800">
                    {analytics.zones.z2.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.zones.z2.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-indigo-600 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">1000 – 1500 m n.m.</div>
                  <div className="font-bold text-slate-800">
                    {analytics.zones.z3.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.zones.z3.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-purple-700 shrink-0" />
                <div>
                  <div className="text-[10px] text-slate-500 font-bold">Nad 1500 m n.m.</div>
                  <div className="font-bold text-slate-800">
                    {analytics.zones.z4.km.toFixed(1)} km{' '}
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({analytics.zones.z4.pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Ascent & Descent Incline Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Ascent Breakdown */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <ArrowUp className="w-4 h-4 text-rose-600" />
              <span>Detailní analýza stoupání</span>
            </h3>
            <div className="space-y-2">
              <div className="h-4 w-full bg-slate-100 rounded-xl overflow-hidden flex shadow-inner">
                <div style={{ width: `${analytics.ascGradients.a1.pct}%` }} className="bg-emerald-400 h-full" />
                <div style={{ width: `${analytics.ascGradients.a2.pct}%` }} className="bg-blue-500 h-full" />
                <div style={{ width: `${analytics.ascGradients.a3.pct}%` }} className="bg-amber-500 h-full" />
                <div style={{ width: `${analytics.ascGradients.a4.pct}%` }} className="bg-rose-600 h-full" />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Mírné (&lt; 5%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.ascGradients.a1.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.ascGradients.a1.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Standard (5–10%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.ascGradients.a2.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.ascGradients.a2.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Prudké (10–20%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.ascGradients.a3.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.ascGradients.a3.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-600 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Extrém (&gt; 20%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.ascGradients.a4.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.ascGradients.a4.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Descent Breakdown */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <ArrowDown className="w-4 h-4 text-sky-600" />
              <span>Detailní analýza klesání</span>
            </h3>
            <div className="space-y-2">
              <div className="h-4 w-full bg-slate-100 rounded-xl overflow-hidden flex shadow-inner">
                <div style={{ width: `${analytics.descGradients.d1.pct}%` }} className="bg-emerald-400 h-full" />
                <div style={{ width: `${analytics.descGradients.d2.pct}%` }} className="bg-blue-500 h-full" />
                <div style={{ width: `${analytics.descGradients.d3.pct}%` }} className="bg-amber-500 h-full" />
                <div style={{ width: `${analytics.descGradients.d4.pct}%` }} className="bg-rose-600 h-full" />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Mírné (&lt; 5%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.descGradients.d1.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.descGradients.d1.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Standard (5–10%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.descGradients.d2.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.descGradients.d2.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Prudké (10–20%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.descGradients.d3.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.descGradients.d3.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-600 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold">Extrém (&gt; 20%)</div>
                    <div className="font-bold text-slate-800">
                      {analytics.descGradients.d4.m} m{' '}
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({analytics.descGradients.d4.pct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Monthly Activity Section (obr. 1) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-emerald-600" />
              <span>Měsíční aktivita (Kilometry podle kalendářního měsíce)</span>
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              Celkem: {Math.round(analytics.totalKm).toLocaleString('cs-CZ')} km
            </span>
          </div>

          {(() => {
            const monthShortLabels = [
              'Led',
              'Úno',
              'Bře',
              'Dub',
              'Kvě',
              'Čer',
              'Čer',
              'Srp',
              'Zář',
              'Říj',
              'Lis',
              'Pro',
            ];
            const monthFullNames = [
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
            const maxMonthKm = Math.max(...analytics.monthlyKm, 1);

            return (
              <div className="pt-2">
                <div className="grid grid-cols-12 gap-2 sm:gap-3 items-end h-36 sm:h-44 px-1">
                  {analytics.monthlyKm.map((km, idx) => {
                    const heightPct = km > 0 ? Math.max(8, (km / maxMonthKm) * 100) : 0;
                    return (
                      <div
                        key={idx}
                        className="flex flex-col items-center justify-end h-full group relative"
                        title={`${monthFullNames[idx]}: ${km.toFixed(1)} km`}
                      >
                        {km > 0 && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-6 bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm whitespace-nowrap pointer-events-none z-10">
                            {km.toFixed(1)} km
                          </div>
                        )}
                        <div className="w-full flex items-end justify-center h-full">
                          <div
                            style={{ height: `${heightPct}%` }}
                            className={`w-full rounded-t-xl transition-all duration-500 ${
                              km > 0
                                ? 'bg-emerald-600 group-hover:bg-emerald-500 shadow-2xs'
                                : 'bg-slate-100 h-1 rounded-t-sm'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-12 gap-2 sm:gap-3 pt-2.5 pb-1 border-b border-slate-100 text-center px-1">
                  {monthShortLabels.map((label, idx) => (
                    <div key={idx} className="text-[11px] font-medium text-slate-500">
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Heatmap Section */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 overflow-hidden">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-emerald-600" />
              <span>Matice dnů aktivity (kalendář celého roku)</span>
            </h3>
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
              Rok {heatmapYear}
            </span>
          </div>

          <div className="flex overflow-x-auto pb-2">
            <div className="flex flex-col text-[10px] font-medium text-slate-400 mr-2.5 justify-between h-[105px] sticky left-0 bg-white">
              <div>PO</div>
              <div>ÚT</div>
              <div>ST</div>
              <div>ČT</div>
              <div>PÁ</div>
              <div>SO</div>
              <div>NE</div>
            </div>

            <div className="heatmap-grid flex-1">
              {Array.from({ length: 54 }).map((_, c) =>
                Array.from({ length: 7 }).map((__, r) => {
                  const cell = heatmapMatrix[r]?.[c];
                  if (!cell) {
                    return (
                      <div
                        key={`${r}-${c}`}
                        className="heatmap-cell opacity-0 pointer-events-none"
                      />
                    );
                  }
                  return (
                    <div
                      key={`${r}-${c}`}
                      className={`heatmap-cell ${cell.levelClass}`}
                      title={
                        cell.dist > 0
                          ? `${formatCzechDate(cell.date)}: ${cell.dist.toFixed(1)} km`
                          : formatCzechDate(cell.date)
                      }
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* Heatmap Legend */}
          <div className="flex items-center justify-end gap-2 text-[10px] text-slate-400 font-medium pt-1 border-t border-slate-100">
            <span>Méně km</span>
            <div className="w-3 h-3 rounded-xs bg-[#f1f5f9]" />
            <div className="w-3 h-3 rounded-xs bg-[#a7f3d0]" title="< 10 km" />
            <div className="w-3 h-3 rounded-xs bg-[#34d399]" title="10 – 20 km" />
            <div className="w-3 h-3 rounded-xs bg-[#10b981]" title="20 – 35 km" />
            <div className="w-3 h-3 rounded-xs bg-[#059669]" title="> 35 km" />
            <span>Více km</span>
          </div>
        </div>
      </div>
    </div>
  );
};
