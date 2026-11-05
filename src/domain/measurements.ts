import { withDay } from './data';
import {
  Measurement,
  State,
  WeightUnit,
  dateObject,
  daysBetween,
  localDate,
  shiftDate,
  shortDate,
  weekdayShort,
} from './model';
import { setStatus } from './planner';
import { fromGrams, toGrams, validateMeasurements } from './records';

/**
 * The difference of two weights (each at most two decimals) to one decimal place. It is taken in
 * whole hundredths first, so 180.7 − 180.25 is exactly 0.45, and halves round away from zero
 * whether the weight went up or down.
 */
function change(to: number, from: number): number {
  const hundredths = Math.round(to * 100) - Math.round(from * 100);
  return (Math.sign(hundredths) * Math.round(Math.abs(hundredths) / 10)) / 10;
}

/** Parses typed weight ("180.4", "180,4") or explains what is wrong. */
export function parseWeight(text: string, unit: WeightUnit): number {
  const cleaned = text.trim().replace(',', '.');
  if (!cleaned) throw new Error('Enter your weight.');
  // Size is the range check's to say: any number of whole digits is a number.
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned))
    throw new Error('Use a number like 180.4, with at most two decimals.');
  const value = Number(cleaned);
  const [min, max] = unit === 'lb' ? [20, 700] : [9, 318];
  if (value < min || value > max)
    throw new Error(`Enter a weight between ${min} and ${max} ${unit}.`);
  return value;
}

/** The value to show in `unit`: exactly as typed when units match, else converted from grams. */
export function weightIn(m: Measurement, unit: WeightUnit): number {
  return m.entered.unit === unit ? m.entered.value : fromGrams(m.grams, unit);
}

export type WeightInput = {
  /** Present when correcting an existing measurement. */
  id?: string;
  value: number;
  unit: WeightUnit;
  date: string;
  fasted: boolean | null;
  note: string;
  /** The weekly objective being completed, if any: marked Done in the same save. */
  occurrence?: { date: string; blockId: string };
};

/**
 * Records or corrects a body-weight measurement. One weight per local date: a second entry for the
 * same date is refused so a double tap or a forgotten earlier entry never creates a duplicate.
 * Completing the linked objective happens in the same state change, so it saves together or not
 * at all.
 */
export function recordWeight(state: State, input: WeightInput, newId: string, at: string): State {
  dateObject(input.date);
  if (input.date > localDate(new Date(at)))
    throw new Error('A weight can be recorded for today or an earlier day.');
  const existing = input.id ? state.measurements.find((m) => m.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('This measurement no longer exists.');
  const sameDay = state.measurements.find(
    (m) => m.kind === 'body-weight' && m.date === input.date && m.id !== existing?.id,
  );
  if (sameDay)
    throw new Error('A weight is already recorded for that date. Edit that entry instead.');
  const occurrenceId = input.occurrence?.blockId ?? existing?.occurrenceId ?? null;
  const linked = occurrenceId
    ? state.measurements.find((m) => m.occurrenceId === occurrenceId && m.id !== existing?.id)
    : undefined;
  if (linked) throw new Error('This objective already has a weight. Edit that entry instead.');
  const measurement: Measurement = {
    id: existing?.id ?? newId,
    kind: 'body-weight',
    grams: toGrams(input.value, input.unit),
    entered: { value: input.value, unit: input.unit },
    date: input.date,
    at: existing?.at ?? at,
    fasted: input.fasted,
    note: input.note.trim(),
    occurrenceId,
  };
  const measurements = existing
    ? state.measurements.map((m) => (m.id === existing.id ? measurement : m))
    : [...state.measurements, measurement];
  validateMeasurements(measurements);
  let next: State = { ...state, measurements };
  if (input.occurrence) {
    const day = next.days[input.occurrence.date];
    const block = day?.blocks.find((b) => b.id === input.occurrence!.blockId);
    if (!day || !block) throw new Error('This objective no longer exists.');
    if (block.status !== 'done') next = withDay(next, setStatus(day, block.id, 'done', at));
  }
  return next;
}

/**
 * Removes one measurement from history, charts and summaries. By default the weigh-in it completed
 * stays done (the action happened; the app then shows that its measurement is gone). With
 * `undoObjective` the user also returns that objective to planned, in the same save.
 */
export function deleteMeasurement(
  state: State,
  id: string,
  options: { undoObjective?: boolean } = {},
): State {
  const measurement = state.measurements.find((m) => m.id === id);
  if (!measurement) throw new Error('This measurement no longer exists.');
  let next: State = { ...state, measurements: state.measurements.filter((m) => m.id !== id) };
  if (options.undoObjective && measurement.occurrenceId) {
    const day = Object.values(next.days).find((d) =>
      d.blocks.some((b) => b.id === measurement.occurrenceId && b.status === 'done'),
    );
    if (day) next = withDay(next, setStatus(day, measurement.occurrenceId, 'planned'));
  }
  return next;
}

export type WeightPoint = {
  id: string;
  date: string;
  value: number;
  /** Change from the previous entry; null for the first. */
  change: number | null;
  /** Calendar days since the previous entry, so a change is never read as week to week. */
  days: number | null;
};

/**
 * Weight history oldest first, each with its change from the previous recorded entry. Missing weeks
 * are simply absent; nothing is interpolated or filled with zero.
 */
export function weightHistory(state: State, unit: WeightUnit): WeightPoint[] {
  const sorted = state.measurements
    .filter((m) => m.kind === 'body-weight')
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  return sorted.map((m, i) => {
    const value = weightIn(m, unit);
    const previous = i > 0 ? weightIn(sorted[i - 1], unit) : null;
    return {
      id: m.id,
      date: m.date,
      value,
      change: previous === null ? null : change(value, previous),
      days: i > 0 ? daysBetween(sorted[i - 1].date, m.date) : null,
    };
  });
}

/**
 * A weigh-in's change from the entry before it, named by that entry's day ("−0.4 lb since Tue"),
 * or by its date once it is a week or more back ("+1.2 lb since Oct 3"). Null for the first entry.
 */
export function changeSince(point: WeightPoint, unit: WeightUnit): string | null {
  if (point.change === null || point.days === null) return null;
  const before = shiftDate(point.date, -point.days);
  const sign = point.change > 0 ? '+' : point.change < 0 ? '−' : '±';
  return `${sign}${Math.abs(point.change)} ${unit} since ${point.days < 7 ? weekdayShort(before) : shortDate(before)}`;
}

/** Measured change between the first and last entry in a window; null with fewer than two. */
export function weightChange(
  points: WeightPoint[],
): { from: WeightPoint; to: WeightPoint; change: number } | null {
  if (points.length < 2) return null;
  const from = points[0];
  const to = points[points.length - 1];
  return { from, to, change: change(to.value, from.value) };
}
