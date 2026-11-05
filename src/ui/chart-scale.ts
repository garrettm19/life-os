import { daysBetween, shiftDate, shortDate, weekStartOf } from '../domain/model';

// Pure scale helpers for the hand-drawn charts: round axis ticks, short date labels and the rows of
// the four-week calendars.

export { shortDate } from '../domain/model';

/**
 * The round step (1, 2, 2.5 or 5 × a power of ten) for about `count` ticks over a range, and never
 * finer than `minStep`. With `whole`, for a count, only 1, 2 or 5 × a power of ten and never below
 * 1, so no line is labeled half a study day.
 */
function niceStep(range: number, count: number, minStep = 0, whole = false): number {
  const raw = range / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const n = raw / magnitude;
  // [up to, step] pairs, as multiples of the magnitude.
  const ladder = whole ? STEPS_WHOLE : STEPS;
  let step = (ladder.find(([upTo]) => n <= upTo)?.[1] ?? 10) * magnitude;
  while (range / step > 5) step *= 2;
  return Math.max(step, minStep, whole ? 1 : 0);
}

const STEPS: [number, number][] = [
  [1, 1],
  [2, 2],
  [2.5, 2.5],
  [5, 5],
];
const STEPS_WHOLE: [number, number][] = [
  [1, 1],
  [2.5, 2],
  [5, 5],
];

// toPrecision drops float noise such as 0.30000000000000004.
const round = (t: number, step: number) => Number((Math.round(t / step) * step).toPrecision(12));

function ticksBy(lo: number, hi: number, step: number): number[] {
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step)
    ticks.push(round(t, step));
  return ticks;
}

type ScaleOptions = {
  count?: number;
  minSpan?: number;
  minStep?: number;
  floor?: number;
  /** A count (study days, actions): whole-number lines only. */
  whole?: boolean;
};

/**
 * The plotted range widened to the round ticks just below and above the data, so the highest and
 * lowest values always sit between two labeled lines. `minSpan` keeps a small range from looking
 * steep (reps between 5 and 7 are drawn over at least 4).
 */
export function niceScale(
  lo: number,
  hi: number,
  { count = 3, minSpan = 0, minStep = 0, floor, whole = false }: ScaleOptions = {},
): { lo: number; hi: number; ticks: number[] } {
  if (hi - lo < minSpan) {
    const middle = (lo + hi) / 2;
    lo = middle - minSpan / 2;
    hi = middle + minSpan / 2;
    if (floor !== undefined && lo < floor) [lo, hi] = [floor, floor + minSpan];
  }
  // A flat series still gets a visible band around its value.
  if (!(hi > lo)) {
    const pad = Math.max(1, Math.abs(hi) * 0.02);
    lo -= pad;
    hi += pad;
    if (floor !== undefined && lo < floor) lo = floor;
  }
  const step = niceStep(hi - lo, count, minStep, whole);
  const bottom = round(Math.floor(lo / step + 1e-9) * step, step);
  const top = round(Math.ceil(hi / step - 1e-9) * step, step);
  return { lo: bottom, hi: top, ticks: ticksBy(bottom, top, step) };
}

/**
 * `niceScale` with every line's label its own. A label format coarser than the step (weight to
 * 0.1 lb over a 0.1 lb range would give 180.0, 180.1, 180.1) widens the step until no two lines
 * read the same, so each label sits on the value it names and the top line keeps its label.
 */
export function labeledScale(
  lo: number,
  hi: number,
  format: (y: number) => string,
  options: ScaleOptions = {},
): { lo: number; hi: number; ticks: number[] } {
  let scale = niceScale(lo, hi, options);
  for (
    let tries = 0;
    tries < 8 && new Set(scale.ticks.map(format)).size < scale.ticks.length;
    tries++
  )
    scale = niceScale(lo, hi, { ...options, minStep: (scale.ticks[1] - scale.ticks[0]) * 2 });
  return scale;
}

/** The date `span / (count - 1)` days after `first`: an axis label between the two ends. */
export function shiftMiddle(first: string, span: number, count: number): string {
  return shiftDate(first, Math.round(span / (count - 1)));
}

/**
 * The index of the position nearest to `x`: a touch on a chart snaps to the closest point or column,
 * so the reader aims at a date, never at a 2 pt line. The earlier one wins a tie.
 */
export function nearestIndex(positions: number[], x: number): number {
  let best = 0;
  positions.forEach((p, i) => {
    if (Math.abs(p - x) < Math.abs(positions[best] - x)) best = i;
  });
  return best;
}

/** The next position for a VoiceOver swipe or an arrow key; with none selected, the latest. */
export function stepIndex(
  selected: number | null,
  count: number,
  step: 'next' | 'previous' | 'first' | 'last',
): number {
  if (step === 'first') return 0;
  if (step === 'last' || selected === null) return count - 1;
  return Math.max(0, Math.min(count - 1, selected + (step === 'next' ? 1 : -1)));
}

/** Columns never fill their slot: at most 24 pt wide, with at least a 2 pt gap between neighbors. */
export const COLUMN_MAX = 24;
export const COLUMN_GAP = 2;
/** The narrowest column; a year of weeks on a small phone gets 2 pt columns, never hairlines. */
export const COLUMN_MIN = 2;
/** Below this width an outline has no inside to show, so the week in progress is a lighter fill. */
export const OUTLINE_MIN = 6;

/**
 * The slot and column width for `slots` weekly columns across `width` points. The column is whole
 * points, so every column of a year renders at the same width instead of some as hairlines.
 */
export function columnLayout(slots: number, width: number): { slot: number; column: number } {
  const slot = slots > 0 ? width / slots : width;
  return {
    slot,
    column: Math.max(COLUMN_MIN, Math.floor(Math.min(COLUMN_MAX, slot - COLUMN_GAP, slot * 0.7))),
  };
}

/**
 * The readout's place over a plot `width` points wide: anchored to the edge away from the selected
 * position `x`, and never wider than half the chart less a margin, so it never covers the point it
 * reads or the crosshair through it.
 */
export function readoutPlace(
  x: number,
  width: number,
): { side: 'left' | 'right'; maxWidth: number } {
  return {
    side: x < width / 2 ? 'right' : 'left',
    maxWidth: Math.max(0, Math.floor(width / 2) - 8),
  };
}

/**
 * Weekly columns from the first week with a record: the weeks of the range before anything was
 * recorded are left off, so a column chart starts where its line-chart neighbors do instead of
 * crowding a short history into the right edge of a year. Later empty weeks stay, as gaps.
 */
export function fromFirstRecord<T extends { value: number | null }>(weeks: T[]): T[] {
  const first = weeks.findIndex((w) => w.value !== null);
  return first <= 0 ? weeks : weeks.slice(first);
}

/** A column's left edge on a whole point, centered on its slot as nearly as whole points allow. */
export function columnLeft(center: number, column: number): number {
  return Math.round(center - column / 2);
}

/**
 * The dates labeled along the bottom: the first and last, and the middle when the plot is wide
 * enough for three labels and the span long enough for the middle to be its own date. On a weekly
 * chart the middle is the Monday nearest the midpoint, so it names a week the readout can show.
 */
export function axisDates(
  first: string,
  last: string,
  span: number,
  width: number,
  weekly = false,
): string[] {
  if (first === last) return [first];
  if (!(width > 220 && span > 20)) return [first, last];
  let middle = shiftMiddle(first, span, 3);
  if (weekly) {
    const monday = weekStartOf(middle);
    middle = daysBetween(monday, middle) > 3 ? shiftDate(monday, 7) : monday;
  }
  return [first, middle, last];
}

/**
 * An axis label: "Oct 20", with the year when it is not the year of the axis's last date, so a year
 * range reads "Oct 20, 2025 … Oct 12" instead of two dates a week apart.
 */
export function axisLabel(date: string, last: string): string {
  return date.slice(0, 4) === last.slice(0, 4)
    ? shortDate(date)
    : `${shortDate(date)}, ${date.slice(0, 4)}`;
}

/** How far axis text may grow with the text size setting (`maxFontSizeMultiplier`). */
export const AXIS_TEXT_MAX = 1.2;

/**
 * The width of an axis label's box: 64 pt, wider for a label with its year, sized for the largest
 * text the axis allows, so "Oct 20, 2025" never truncates at a larger text size. 6.5 pt a character
 * is generous for the axis's 10 pt SF Pro Semibold, which averages about 5 pt on a date.
 */
export const axisLabelWidth = (label: string) =>
  Math.max(64, Math.ceil(label.length * 6.5 * AXIS_TEXT_MAX));

/** Column headings of the four-week calendars: Monday to Sunday, as on Week. */
export const WEEKDAY_HEADINGS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/**
 * Days oldest first, starting on a Monday, as rows of seven. The days after the last one (the rest
 * of the current week) are `null`, drawn as empty cells.
 */
export function weekRows<T>(days: T[]): (T | null)[][] {
  const rows: (T | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    const row: (T | null)[] = days.slice(i, i + 7);
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  return rows;
}
