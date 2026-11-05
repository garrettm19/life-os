import { LoggedSet, State, WeightUnit, dateObject, localDate, shiftDate } from './model';
import { fromGrams } from './records';
import { onItsDays } from './repeat';

// Progress series for the graphs. Everything is computed from actual records: a missing day stays
// missing, nothing is interpolated, units are never mixed, and different exercises are never
// combined. Rendering lives in the UI; these functions are pure and tested.

export type Range = '1m' | '3m' | '6m' | 'all';

/** The first date inside a range ending today (inclusive); null for all time. */
export function rangeStart(range: Range, today: string): string | null {
  if (range === 'all') return null;
  const months = range === '1m' ? 1 : range === '3m' ? 3 : 6;
  const d = dateObject(today);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  // The same day of the month, or the month's last day when it is shorter (31 Mar → 28 Feb).
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
  d.setDate(Math.min(day, last));
  return localDate(d);
}

function inRange(date: string, from: string | null, today: string): boolean {
  return (from === null || date >= from) && date <= today;
}

/** A point on a time axis: `x` is a local date, `y` a number in the series' unit. */
export type Point = { date: string; y: number };

// Strength.

export type ExerciseOption = {
  /** Identity of the series: the plan's exercise ID in one unit. */
  key: string;
  exerciseId: string;
  unit: WeightUnit;
  name: string;
  sessions: number;
};

export type StrengthPoint = {
  date: string;
  sessionId: string;
  /** Load of the representative set, or null for a set logged without a load. */
  load: number | null;
  reps: number;
  /** Every working set performed for this exercise in that session, in order. */
  sets: LoggedSet[];
};

const keyOf = (exerciseId: string, unit: WeightUnit) => `${exerciseId}|${unit}`;

/** Exercises with at least one completed working set, most recently trained first. */
export function exerciseOptions(state: State): ExerciseOption[] {
  const found = new Map<string, ExerciseOption & { last: string }>();
  const sessions = state.workoutSessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.finishedAt!.localeCompare(b.finishedAt!));
  for (const session of sessions)
    for (const e of session.exercises) {
      if (!e.sets.some((set) => set.done)) continue;
      const key = keyOf(e.exerciseId, e.unit);
      const prior = found.get(key);
      found.set(key, {
        key,
        exerciseId: e.exerciseId,
        unit: e.unit,
        // The most recent name, so a renamed exercise reads as it is called now.
        name: e.name,
        sessions: (prior?.sessions ?? 0) + 1,
        last: session.date,
      });
    }
  return [...found.values()]
    .sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name))
    .map(({ last: _last, ...option }) => option);
}

/**
 * The representative set of one session: the heaviest completed working set and, among sets at
 * that load, the one with the most reps. Sets without a load rank below any loaded set.
 */
export function representativeSet(sets: LoggedSet[]): { load: number | null; reps: number } | null {
  let best: { load: number | null; reps: number } | null = null;
  for (const set of sets) {
    if (!set.done || set.reps === null) continue;
    const load = set.load;
    if (
      !best ||
      (load ?? -1) > (best.load ?? -1) ||
      ((load ?? -1) === (best.load ?? -1) && set.reps > best.reps)
    )
      best = { load, reps: set.reps };
  }
  return best;
}

/** One point per completed session of an exercise in one unit, oldest first. */
export function strengthSeries(
  state: State,
  key: string,
  range: Range,
  today: string,
): StrengthPoint[] {
  return strengthSince(state, key, rangeStart(range, today), today);
}

/** `strengthSeries` from a date (inclusive; null for all time) through `today`. */
export function strengthSince(
  state: State,
  key: string,
  from: string | null,
  today: string,
): StrengthPoint[] {
  const points: (StrengthPoint & { at: string })[] = [];
  for (const session of state.workoutSessions) {
    if (session.status !== 'completed' || !inRange(session.date, from, today)) continue;
    const sets = session.exercises
      .filter((e) => keyOf(e.exerciseId, e.unit) === key)
      .flatMap((e) => e.sets.filter((set) => set.done && set.reps !== null));
    const best = representativeSet(sets);
    if (!best) continue;
    points.push({
      date: session.date,
      sessionId: session.id,
      load: best.load,
      reps: best.reps,
      sets,
      at: session.finishedAt!,
    });
  }
  return points
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at))
    .map(({ at: _at, ...point }) => point);
}

// Body weight.

export type WeightSeries = {
  unit: WeightUnit;
  points: Point[];
  /** Seven-day average at each measured date that has enough measurements in its week. */
  average: Point[];
};

/** Measurements in a week needed before a seven-day average is shown for it. */
const AVERAGE_MIN = 4;

/**
 * Measured body weights from a date (inclusive; null for all time) through `today`, in one unit
 * (the most recently used one; others are converted from the stored grams and rounded to 0.1). The
 * seven-day average uses only actual measurements in the trailing week and is omitted where fewer
 * than four exist, so it never stands in for missing days.
 */
export function weightSince(state: State, from: string | null, today: string): WeightSeries | null {
  const all = state.measurements
    .filter((m) => m.kind === 'body-weight' && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) return null;
  const unit = [...all].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!.entered.unit;
  const value = (m: (typeof all)[number]) =>
    m.entered.unit === unit ? m.entered.value : fromGrams(m.grams, unit);
  const points = all
    .filter((m) => inRange(m.date, from, today))
    .map((m) => ({ date: m.date, y: value(m) }));
  const average: Point[] = [];
  for (const point of points) {
    const weekStart = shiftDate(point.date, -6);
    const week = all.filter((m) => m.date >= weekStart && m.date <= point.date);
    if (week.length < AVERAGE_MIN) continue;
    const grams = week.reduce((sum, m) => sum + m.grams, 0) / week.length;
    average.push({ date: point.date, y: fromGrams(Math.round(grams), unit) });
  }
  return { unit, points, average };
}

// Money.

export type MoneyTotal = 'cash' | 'savings' | 'debt';
export type MoneySeries = { currency: string; points: Point[]; otherCurrency: number };

/**
 * Reported values of one money total from a date (inclusive; null for all time) through `today`, in
 * the most recently used currency, in minor units (cents), one per date. Reviews that left the
 * field blank are not points; reviews in another currency are counted, not converted.
 */
export function moneySince(
  state: State,
  field: MoneyTotal,
  from: string | null,
  today: string,
): MoneySeries | null {
  const reviews = [...state.moneyReviews].sort(
    (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at),
  );
  if (!reviews.length) return null;
  const currency = reviews.at(-1)!.currency;
  const shown = reviews.filter((r) => inRange(r.date, from, today) && r[field] !== null);
  // One point per date: when two reviews on one date both reported the figure, the later one is the
  // correction, so it stands for that date.
  const byDate = new Map<string, number>();
  for (const r of shown) if (r.currency === currency) byDate.set(r.date, r[field]!);
  return {
    currency,
    points: [...byDate].map(([date, y]) => ({ date, y })),
    otherCurrency: shown.filter((r) => r.currency !== currency).length,
  };
}

// Cardio.

/**
 * Target minutes for the Monday–Sunday week starting `weekStart`: duration × the days a routine is
 * due that week (a repeat counts only in its repeat weeks), when every activity routine due that
 * week agrees.
 */
export function cardioTarget(
  state: State,
  weekStart: string,
  routineId: string | null = null,
): number | null {
  const week = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i));
  const routines = state.programs
    .flatMap((p) => p.routines)
    .filter((r) => r.capture === 'activity' && (routineId === null || r.id === routineId));
  const targets = [
    ...new Set(
      routines
        .map((r) => (r.duration ? r.duration * week.filter((d) => onItsDays(r, d)).length : 0))
        .filter((t) => t > 0),
    ),
  ];
  return targets.length === 1 ? targets[0] : null;
}
