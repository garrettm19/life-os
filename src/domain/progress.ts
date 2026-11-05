import { weeklyMinutes } from './activity';
import {
  Morning,
  anchorRoutine,
  anchorSince,
  currentUpBy,
  morningOn,
  recentMornings,
} from './anchor';
import { careerProgress, careerRoutines } from './career';
import { recordedDaysOf } from './focus-evidence';
import { weightChange, weightHistory } from './measurements';
import {
  Routine,
  State,
  WeightUnit,
  calendarDays,
  dateObject,
  daysBetween,
  displayDate,
  displayTime,
  shiftDate,
  shortDate,
  weekStartOf,
} from './model';
import { fieldChanges, formatMoney, sortedReviews } from './money';
import { StreakRun, dayClearRuns, dayProgress } from './objectives';
import {
  Point,
  StrengthPoint,
  cardioTarget,
  exerciseOptions,
  moneySince,
  strengthSince,
  weightSince,
} from './series';
import { StudyCalendar, studyCalendar } from './study-calendar';
import { StudyStreak, studyStreakLine } from './study-streak';
import { tradingBook, tradingSummary } from './trading';

// Progress: every tile and chart on the Progress tab, worked out from the records each time. Each
// figure reuses the rule that already defines it (Day Cleared and the Day Clear streak from
// objectives.ts, study days from the study streak, trading sessions from the trading reader, the
// series from series.ts), so a chart can never disagree with the screen the figure comes from.
// Nothing is stored, projected, interpolated or scored: a week with nothing recorded is a gap, not
// a zero. Everything is pure in (state, range, today), so a screen memoizes it per saved state.

// Ranges.

export type ProgressRange = '4w' | '12w' | '1y';
export const PROGRESS_RANGES: { value: ProgressRange; label: string }[] = [
  { value: '4w', label: '4 weeks' },
  { value: '12w', label: '12 weeks' },
  { value: '1y', label: '1 year' },
];
/** Four weeks to start: a month reads against the month before; 12 weeks and a year are a tap away. */
export const DEFAULT_PROGRESS_RANGE: ProgressRange = '4w';

const WEEKS: Record<ProgressRange, number> = { '4w': 4, '12w': 12, '1y': 52 };

type Words = {
  /** "12 weeks", "1 year" */
  label: string;
  /** "Last 12 weeks", "Last year" */
  last: string;
  /** "in the last 12 weeks" */
  within: string;
  /** "previous 12 weeks" */
  previous: string;
  /** "12 weeks ago" */
  ago: string;
};

const WORDS: Record<ProgressRange, Words> = {
  '4w': {
    label: '4 weeks',
    last: 'Last 4 weeks',
    within: 'in the last 4 weeks',
    previous: 'previous 4 weeks',
    ago: '4 weeks ago',
  },
  '12w': {
    label: '12 weeks',
    last: 'Last 12 weeks',
    within: 'in the last 12 weeks',
    previous: 'previous 12 weeks',
    ago: '12 weeks ago',
  },
  '1y': {
    label: '1 year',
    last: 'Last year',
    within: 'in the last year',
    previous: 'previous year',
    ago: 'a year ago',
  },
};

export type RangeWindow = {
  range: ProgressRange;
  weeks: number;
  /** The Monday of the first week. */
  from: string;
  /** Today: the range is whole Monday-to-Sunday weeks, the last one in progress. */
  to: string;
  /**
   * The same number of days just before, ending on the same weekday as today, so this week so far
   * is compared with the same part of a week, never with a whole one.
   */
  previous: { from: string; to: string };
  /** The Monday of each week in the range, oldest first. */
  weekStarts: string[];
  /** Every date from `previous.from` through today, oldest first: both ranges, read once. */
  dates: string[];
  words: Words;
  /** "Jul 27 to Oct 17", with the years when the range crosses one. */
  text: string;
};

function spanText(from: string, to: string): string {
  const year = (d: string) => d.slice(0, 4);
  return year(from) === year(to)
    ? `${shortDate(from)} to ${shortDate(to)}`
    : `${shortDate(from)}, ${year(from)} to ${shortDate(to)}, ${year(to)}`;
}

/**
 * "Oct 20", or "Oct 20, 2025" for a date in another year than `today`: a year range otherwise reads
 * "since Oct 20" as three days from now.
 */
export function dateText(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? shortDate(date)
    : `${shortDate(date)}, ${date.slice(0, 4)}`;
}

/** "Mon, Oct 20", or "Mon, Oct 20, 2025" for a date in another year than `today`. */
export function dayText(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? displayDate(date)
    : `${displayDate(date)}, ${date.slice(0, 4)}`;
}

/** Every date from `from` through `to`, oldest first. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

export function rangeWindow(range: ProgressRange, today: string): RangeWindow {
  dateObject(today);
  const weeks = WEEKS[range];
  const thisWeek = weekStartOf(today);
  const from = shiftDate(thisWeek, -7 * (weeks - 1));
  const weekStarts = Array.from({ length: weeks }, (_, i) => shiftDate(from, 7 * i));
  const previous = { from: shiftDate(from, -7 * weeks), to: shiftDate(today, -7 * weeks) };
  return {
    range,
    weeks,
    from,
    to: today,
    previous,
    weekStarts,
    dates: datesBetween(previous.from, today),
    words: WORDS[range],
    text: spanText(from, today),
  };
}

/** "+3 vs previous 12 weeks", "−2 vs previous 12 weeks", "Same as previous 12 weeks". */
export function changeText(delta: number, versus: string): string {
  if (delta === 0) return `Same as ${versus}`;
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs ${versus}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const percent = (part: number, whole: number) => Math.round((100 * part) / whole);
/** A difference of two loads or weights, without binary-fraction noise (182.5 − 180 = 2.5). */
const difference = (a: number, b: number) => Math.round((a - b) * 100) / 100;

// Shared shapes.

export type ChartState = 'empty' | 'sparse' | 'chart';

export type CardText = {
  /** The plain-language sentence above the chart. */
  headline: string;
  /**
   * `chart` with two points or more; `sparse` with one (the figure, no chart frame); `empty` with
   * none in the range.
   */
  state: ChartState;
  /** The one line shown in place of the chart: what will fill it, or what starts the line. */
  note: string | null;
  /** For VoiceOver: the headline and the range. */
  summary: string;
};

function cardText(
  window: RangeWindow,
  headline: string,
  points: number,
  notes: { empty: string; sparse: string },
): CardText {
  const state: ChartState = points === 0 ? 'empty' : points === 1 ? 'sparse' : 'chart';
  return {
    headline,
    state,
    note: state === 'empty' ? notes.empty : state === 'sparse' ? notes.sparse : null,
    summary: `${headline}. ${window.words.last}, ${window.text}.`,
  };
}

/** One week's column or point: `value` is null where nothing was recorded (a gap, never 0). */
export type WeekPoint = { weekStart: string; inProgress: boolean; value: number | null };

const within = (date: string, from: string, to: string) => date >= from && date <= to;

type Counts<K extends string> = Record<K, number>;
type Tally<K extends string> = { weeks: Counts<K>[]; range: Counts<K>; previous: Counts<K> };

/**
 * Adds up per-date counts into each week of the range, the range and the previous range, reading
 * each date once, so a year of weeks stays linear in the days.
 */
function tally<K extends string>(
  window: RangeWindow,
  keys: readonly K[],
  read: (date: string) => Partial<Counts<K>> | undefined,
): Tally<K> {
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Counts<K>;
  const weeks = window.weekStarts.map(zero);
  const range = zero();
  const previous = zero();
  // `dates` starts with the previous range's 7 × weeks days; the range starts at that index.
  const start = 7 * window.weeks;
  window.dates.forEach((date, i) => {
    if (i < start && date > window.previous.to) return;
    const counts = read(date);
    if (!counts) return;
    const into = i < start ? [previous] : [range, weeks[Math.floor((i - start) / 7)]];
    for (const total of into) for (const k of keys) total[k] += counts[k] ?? 0;
  });
  return { weeks, range, previous };
}

const inProgress = (window: RangeWindow, weekStart: string) => weekStart === weekStartOf(window.to);

/**
 * A sparkline of about a dozen points: a tile is too small for more to read as a trend. Points are
 * gathered by week, or by four weeks over a year (13 points), and each span gives its total, its
 * last value (a streak as it stood) or its mean (a score, to one decimal).
 */
function sparkOf(window: RangeWindow, points: Point[], fold: 'sum' | 'last' | 'mean'): Point[] {
  const span = window.weeks > 12 ? 28 : 7;
  const spans = new Map<number, number[]>();
  for (const p of points) {
    const i = Math.floor(daysBetween(window.from, p.date) / span);
    spans.set(i, [...(spans.get(i) ?? []), p.y]);
  }
  return [...spans].map(([i, ys]) => ({
    date: shiftDate(window.from, i * span),
    y:
      fold === 'last'
        ? ys.at(-1)!
        : fold === 'sum'
          ? ys.reduce((a, b) => a + b, 0)
          : Math.round((10 * ys.reduce((a, b) => a + b, 0)) / ys.length) / 10,
  }));
}

// Tiles.

export type TileId = 'streak' | 'cleared' | 'study' | 'trading';

export type Tile = {
  id: TileId;
  label: string;
  /** The figure; null while nothing is recorded that would fill it. */
  value: string | null;
  /** The line under the figure: the best run, the share, the study streak. */
  detail: string | null;
  /** The change against the previous range; null with nothing to compare it with. */
  delta: number | null;
  /** The change in words ("+3 vs previous 12 weeks"), or why there is none; null when empty. */
  change: string | null;
  /** A small trend under the figure, oldest first: one point per week or per session. */
  spark: Point[];
  /** What will fill an empty tile, in one short line; null once it has a value. */
  empty: string | null;
};

/**
 * The Day Clear streak now, against the streak as it stood at the same point a range ago. `runs` is
 * `dayClearRuns` through today.
 */
export function streakTile(window: RangeWindow, runs: StreakRun[]): Tile {
  const label = 'Day Clear streak';
  // Until a day has ever been cleared (best is 0 only then), the tile says what fills it: a day
  // opened on Today and still open is no run of 0 days.
  if (!runs.length || runs.at(-1)!.best === 0)
    return {
      id: 'streak',
      label,
      value: null,
      detail: null,
      delta: null,
      change: null,
      spark: [],
      empty: 'Clear a day on Today to start the streak.',
    };
  const { current, best } = runs.at(-1)!;
  // The run as it stood on a date: the last recorded day on or before it. Dates are asked in
  // order, so one pass over the runs answers them all.
  let next = 0;
  let found: StreakRun | undefined;
  const at = (date: string) => {
    while (next < runs.length && runs[next].date <= date) found = runs[next++];
    return found;
  };
  const then = at(window.previous.to);
  const delta = then ? current - then.current : null;
  const spark: Point[] = [];
  for (const weekStart of window.weekStarts) {
    const end = shiftDate(weekStart, 6);
    // A week with no recorded day carries the run it held: Not recorded never breaks it.
    const run = at(end < window.to ? end : window.to);
    if (run) spark.push({ date: weekStart, y: run.current });
  }
  return {
    id: 'streak',
    label,
    value: plural(current, 'day'),
    detail: `Best ${best}`,
    delta,
    change:
      delta === null ? `Nothing recorded ${window.words.ago}` : changeText(delta, window.words.ago),
    spark: sparkOf(window, spark, 'last'),
    empty: null,
  };
}

/**
 * Days cleared, of the days that counted: cleared days and days that ended without being cleared,
 * read with the one Day Cleared rule. A protected day, a day with nothing due, a day never opened
 * and today while it can still be finished are left out, as the streak leaves them out.
 */
function clearedDays(window: RangeWindow, runs: StreakRun[]): Tally<'cleared' | 'counted'> {
  const marks = new Map<string, 'cleared' | 'missed'>();
  for (const run of runs) {
    if (run.outcome === 'cleared') marks.set(run.date, 'cleared');
    else if (run.outcome === 'open' && !run.held) marks.set(run.date, 'missed');
  }
  return tally(window, ['cleared', 'counted'], (date) => {
    const mark = marks.get(date);
    return mark && { counted: 1, cleared: mark === 'cleared' ? 1 : 0 };
  });
}

export function clearedTile(window: RangeWindow, runs: StreakRun[]): Tile {
  const { range, previous, weeks } = clearedDays(window, runs);
  const label = 'Days cleared';
  if (!range.counted)
    return {
      id: 'cleared',
      label,
      value: null,
      detail: null,
      delta: null,
      change: null,
      spark: [],
      empty: 'A day counts here once it is cleared or over.',
    };
  const delta = previous.counted ? range.cleared - previous.cleared : null;
  return {
    id: 'cleared',
    label,
    value: `${range.cleared} of ${range.counted}`,
    detail: `${percent(range.cleared, range.counted)}% cleared`,
    delta,
    change:
      delta === null
        ? `Nothing recorded in the ${window.words.previous}`
        : changeText(delta, window.words.previous),
    spark: sparkOf(
      window,
      weeks.flatMap((w, i) => (w.counted ? [{ date: window.weekStarts[i], y: w.cleared }] : [])),
      'sum',
    ),
    empty: null,
  };
}

// Study, by the study streak's own rules (study-calendar.ts): a scheduled day is kept or missed, a
// protected or moved-away day is held, and nothing before tracking started is scored.

export type StudyDays = {
  routines: Routine[];
  calendars: Map<string, StudyCalendar>;
  /** The required study objectives (`careerRoutines`): the ones the tile and card count. */
  counted: Set<string>;
  /**
   * Study days scored, by week and range: a day is kept when a required study objective was
   * completed, and eligible when it was kept or missed.
   */
  counts: Tally<'kept' | 'eligible'>;
  streak: StudyStreak | null;
};

export function studyDays(state: State, window: RangeWindow): StudyDays {
  const routines = state.programs
    .flatMap((p) => p.routines)
    .filter((r) => r.study && !r.bundledInto);
  const span = window.dates.length;
  const calendars = new Map(routines.map((r) => [r.id, studyCalendar(state, r, window.to, span)]));
  const counted = new Set(careerRoutines(state).map((r) => r.id));
  const marks = new Map<string, 'kept' | 'missed'>();
  for (const routine of routines) {
    // The Study tile and card count required study objectives only, as career progress does.
    if (!counted.has(routine.id)) continue;
    for (const day of calendars.get(routine.id)!.days) {
      if (day.mark === 'completed') marks.set(day.date, 'kept');
      else if (day.mark === 'missed' && !marks.has(day.date)) marks.set(day.date, 'missed');
    }
  }
  const first = routines.find((r) => counted.has(r.id));
  return {
    routines,
    calendars,
    counted,
    counts: tally(window, ['kept', 'eligible'], (date) => {
      const mark = marks.get(date);
      return mark && { eligible: 1, kept: mark === 'kept' ? 1 : 0 };
    }),
    streak: first ? calendars.get(first.id)!.streak : null,
  };
}

export function studyTile(window: RangeWindow, days: StudyDays): Tile {
  const { range, previous, weeks } = days.counts;
  const label = 'Study days';
  if (!range.eligible)
    return {
      id: 'study',
      label,
      value: null,
      detail: null,
      delta: null,
      change: null,
      spark: [],
      empty: days.streak?.since
        ? 'Finish a study session to start counting.'
        : 'Study days count once the study streak starts.',
    };
  const delta = previous.eligible ? range.kept - previous.kept : null;
  return {
    id: 'study',
    label,
    // With its denominator, so "28 of 29" never reads against the streak line under it.
    value: `${range.kept} of ${range.eligible}`,
    detail: days.streak ? studyStreakLine(days.streak) : null,
    delta,
    change:
      delta === null
        ? `Nothing recorded in the ${window.words.previous}`
        : changeText(delta, window.words.previous),
    spark: sparkOf(
      window,
      weeks.flatMap((w, i) => (w.eligible ? [{ date: window.weekStarts[i], y: w.kept }] : [])),
      'sum',
    ),
    empty: null,
  };
}

// Trading, by the trading reader: a reviewed session is clean or rule-broken, scored out of the
// checklist's eight items; a day away is unscored and a trading day left without a review is never
// clean.

/** One reviewed session: its process score, whether it was rule-clean and its hard violations. */
export type TradingPoint = Point & { clean: boolean; violations: number };

export type TradingDays = {
  routineId: string;
  total: number;
  sessions: TradingPoint[];
  missed: string[];
};

export function tradingDays(state: State, window: RangeWindow): TradingDays | null {
  const book = tradingBook(state);
  if (!book?.trading) return null;
  const summary = tradingSummary(state, book, window.to, window.dates.length);
  return {
    routineId: book.routineId,
    total: book.trading.checklist.length,
    sessions: summary.days
      .filter((d) => (d.status === 'clean' || d.status === 'broken') && d.score !== undefined)
      .map((d) => ({
        date: d.date,
        y: d.score!,
        clean: d.status === 'clean',
        violations: d.review!.violations.length,
      })),
    missed: summary.days.filter((d) => d.status === 'missed').map((d) => d.date),
  };
}

export function tradingTile(window: RangeWindow, days: TradingDays): Tile {
  const range = days.sessions.filter((s) => within(s.date, window.from, window.to));
  const previous = days.sessions.filter((s) =>
    within(s.date, window.previous.from, window.previous.to),
  );
  // Honesty first: rule-clean sessions lead, with the hard violations recorded; the latest score
  // follows, named as such, and the clean streak is on Trading only.
  const label = 'Rule-clean sessions';
  if (!range.length)
    return {
      id: 'trading',
      label,
      value: null,
      detail: null,
      delta: null,
      change: null,
      spark: [],
      empty: 'Review a trading session to start the count.',
    };
  const clean = range.filter((s) => s.clean).length;
  const violations = range.reduce((sum, s) => sum + s.violations, 0);
  const delta = previous.length ? clean - previous.filter((s) => s.clean).length : null;
  return {
    id: 'trading',
    label,
    value: `${clean} of ${range.length}`,
    detail: `${violations} hard violation${violations === 1 ? '' : 's'} recorded · last score ${range.at(-1)!.y}/${days.total}`,
    delta,
    change:
      delta === null
        ? `No reviewed session in the ${window.words.previous}`
        : changeText(delta, window.words.previous),
    spark: sparkOf(
      window,
      range.map((s) => ({ date: s.date, y: s.clean ? 1 : 0 })),
      'sum',
    ),
    empty: null,
  };
}

// Charts.

export type ConsistencyWeek = WeekPoint & { done: number; total: number };
export type ConsistencyCard = CardText & {
  /** `value` is the percentage done (0 to 100), null for a week with nothing due recorded. */
  weeks: ConsistencyWeek[];
  /** Percentage done in the range and in the previous range; null with nothing due. */
  share: number | null;
  previousShare: number | null;
};

/**
 * Required objectives done of those due, from each recorded day's `dayProgress` (optional
 * objectives are never in it, and a skipped one is excused, so it is not due). A protected day
 * counts only what was done there, today only what is already done, and a day never opened not at
 * all.
 */
function dueOn(state: State, date: string, today: string) {
  const day = state.days[date];
  if (!day || date > today) return undefined;
  const p = dayProgress(day, state.programs, date);
  if (day.protection || date === today) return { done: p.done, total: p.done };
  return { done: p.done, total: p.total };
}

export function consistencyCard(state: State, window: RangeWindow): ConsistencyCard {
  const {
    weeks: counts,
    range,
    previous,
  } = tally(window, ['done', 'total'], (date) => dueOn(state, date, window.to));
  const weeks = counts.map(({ done, total }, i): ConsistencyWeek => ({
    weekStart: window.weekStarts[i],
    inProgress: inProgress(window, window.weekStarts[i]),
    value: total ? percent(done, total) : null,
    done,
    total,
  }));
  const share = range.total ? percent(range.done, range.total) : null;
  const previousShare = previous.total ? percent(previous.done, previous.total) : null;
  const headline =
    share === null
      ? `Nothing due was recorded ${window.words.within}`
      : `${share}% of required objectives done ${window.words.within}${
          previousShare === null
            ? ''
            : share > previousShare
              ? `, up from ${previousShare}%`
              : share < previousShare
                ? `, down from ${previousShare}%`
                : `, the same as the ${window.words.previous}`
        }`;
  return {
    ...cardText(window, headline, weeks.filter((w) => w.value !== null).length, {
      empty: 'Finish objectives on Today to start the line.',
      sparse: 'The next week starts the line.',
    }),
    weeks,
    share,
    previousShare,
  };
}

export type WeightCard = CardText & {
  unit: WeightUnit;
  points: Point[];
  /**
   * The seven-day average at each weigh-in whose week has enough weigh-ins (series.ts), for the
   * readout: a number beside the point, never a second line.
   */
  average: Point[];
  /** Measured change from the first weigh-in in the range to the latest; null with fewer than two. */
  change: number | null;
};

export function weightCard(state: State, window: RangeWindow): WeightCard {
  const series = weightSince(state, window.from, window.to);
  const points = series?.points ?? [];
  const unit = series?.unit ?? 'lb';
  const inRange = weightHistory(state, unit).filter((p) => within(p.date, window.from, window.to));
  const measured = weightChange(inRange);
  const last = points.at(-1);
  const headline = !last
    ? `No weigh-ins ${window.words.within}`
    : !measured
      ? `${last.y} ${unit} on ${dateText(last.date, window.to)}`
      : measured.change === 0
        ? `No change since ${dateText(measured.from.date, window.to)}`
        : `${measured.change < 0 ? 'Down' : 'Up'} ${Math.abs(measured.change)} ${unit} since ${dateText(measured.from.date, window.to)}`;
  return {
    ...cardText(window, headline, points.length, {
      empty: 'Record a weigh-in to start the line.',
      sparse: 'The next weigh-in starts the line.',
    }),
    unit,
    points,
    average: series?.average ?? [],
    change: measured?.change ?? null,
  };
}

export type Lift = CardText & {
  /** The series identity from `exerciseOptions` (exercise and unit). */
  key: string;
  name: string;
  unit: WeightUnit;
  /** Load of the heaviest working set, or reps for an exercise never logged with a load. */
  measure: 'load' | 'reps';
  /** Every finished session of the lift in the range, with its heaviest working set. */
  sessions: StrengthPoint[];
  /** The line: one point per session with a load (or per session, for reps). */
  points: Point[];
  /** Last point minus the first in the range; null with fewer than two. */
  change: number | null;
};

export type StrengthCard = CardText & {
  /** Lifts with a finished session in the range, most recently trained first: the chips. */
  lifts: Lift[];
};

export function strengthCard(state: State, window: RangeWindow): StrengthCard {
  const lifts: Lift[] = [];
  for (const option of exerciseOptions(state)) {
    const sessions = strengthSince(state, option.key, window.from, window.to);
    if (!sessions.length) continue;
    const measure = sessions.some((s) => s.load !== null) ? 'load' : 'reps';
    const points =
      measure === 'load'
        ? sessions.filter((s) => s.load !== null).map((s) => ({ date: s.date, y: s.load! }))
        : sessions.map((s) => ({ date: s.date, y: s.reps }));
    const amount = (y: number) => (measure === 'load' ? `${y} ${option.unit}` : plural(y, 'rep'));
    const first = points[0];
    const last = points.at(-1)!;
    const change = points.length > 1 ? difference(last.y, first.y) : null;
    const headline =
      change === null
        ? `${option.name} ${amount(last.y)} on ${dateText(last.date, window.to)}`
        : change === 0
          ? `${option.name} held at ${amount(last.y)} ${window.words.within}`
          : `${option.name} ${change > 0 ? 'up' : 'down'} ${amount(Math.abs(change))} ${window.words.within}`;
    lifts.push({
      ...cardText(window, headline, points.length, {
        empty: '',
        sparse: 'The next session starts the line.',
      }),
      key: option.key,
      name: option.name,
      unit: option.unit,
      measure,
      sessions,
      points,
      change,
    });
  }
  const headline = lifts.length
    ? lifts[0].headline
    : `No finished workouts with logged sets ${window.words.within}`;
  return {
    ...cardText(
      window,
      headline,
      lifts.length ? Math.max(...lifts.map((l) => l.points.length)) : 0,
      {
        empty: 'Finish a workout with logged sets to start the line.',
        sparse: 'The next session starts the line.',
      },
    ),
    lifts,
  };
}

export type StudyWeek = WeekPoint & {
  /** Study days kept (the column), of the days that were scored. */
  kept: number;
  eligible: number;
  /** Minutes recorded by timed study sessions that week; one-tap days have none. */
  minutes: number;
};
export type StudyCard = CardText & { weeks: StudyWeek[]; kept: number; eligible: number };

/**
 * The Study tile has the range's study days and the streak, so the card's headline says where the
 * weeks are going: the latest finished week with scored days against the one before it ("Last week
 * 3 of 6 study days kept, down from 7 of 7"). Before any week with scored days has finished, this
 * week's days are the tile's figure, so the headline says only that no week has finished; when the
 * one finished week holds every scored day of the range, its days are the tile's figure too, so it
 * says only that it was the first.
 */
function recentStudy(
  window: RangeWindow,
  weeks: StudyWeek[],
  range: { kept: number; eligible: number },
): string {
  const finished = weeks.filter((w) => !w.inProgress && w.eligible);
  const last = finished.at(-1);
  if (!last) return `No finished study week ${window.words.within}`;
  const name =
    last.weekStart === shiftDate(weekStartOf(window.to), -7)
      ? 'Last week'
      : `The week of ${dateText(last.weekStart, window.to)}`;
  const text = `${name} ${last.kept} of ${plural(last.eligible, 'study day')} kept`;
  const before = finished.at(-2);
  if (!before)
    return last.kept === range.kept && last.eligible === range.eligible
      ? `${name} was the first study week ${window.words.within}`
      : text;
  const share = last.kept / last.eligible;
  const earlier = before.kept / before.eligible;
  const which =
    before.weekStart === shiftDate(last.weekStart, -7)
      ? 'the week before'
      : `the week of ${dateText(before.weekStart, window.to)}`;
  if (share === earlier) return `${text}, the same share as ${which}`;
  return `${text}, ${share > earlier ? 'up' : 'down'} from ${before.kept} of ${before.eligible}${
    which === 'the week before' ? '' : ` in ${which}`
  }`;
}

export function studyCard(state: State, window: RangeWindow, days: StudyDays): StudyCard {
  const ids = new Set(
    careerRoutines(state)
      .filter((r) => r.study)
      .map((r) => r.id),
  );
  const minutesOn = new Map<string, number>();
  for (const a of state.activitySessions)
    if (a.study && a.routineId !== null && ids.has(a.routineId))
      minutesOn.set(a.date, (minutesOn.get(a.date) ?? 0) + a.minutes);
  const minutes = tally(window, ['minutes'], (date) => {
    const m = minutesOn.get(date);
    return m === undefined ? undefined : { minutes: m };
  });
  const weeks = days.counts.weeks.map(({ kept, eligible }, i): StudyWeek => ({
    weekStart: window.weekStarts[i],
    inProgress: inProgress(window, window.weekStarts[i]),
    value: eligible ? kept : null,
    kept,
    eligible,
    minutes: minutes.weeks[i].minutes,
  }));
  const { kept, eligible } = days.counts.range;
  const headline = eligible
    ? recentStudy(window, weeks, { kept, eligible })
    : `No scored study days ${window.words.within}`;
  return {
    ...cardText(window, headline, weeks.filter((w) => w.value !== null).length, {
      empty: days.streak?.since
        ? 'Finish a study session to start the chart.'
        : 'Study days count once the study streak starts.',
      sparse: 'The next week of study starts the chart.',
    }),
    weeks,
    kept,
    eligible,
  };
}

export type CardioWeek = WeekPoint & {
  minutes: number;
  sessions: number;
  /** The week's target minutes from the activity routines, when they agree on one. */
  target: number | null;
  /** The week reached its target; null without one. */
  hit: boolean | null;
};
export type CardioCard = CardText & {
  weeks: CardioWeek[];
  /** The target line: drawn only when every week in the range has the same target. */
  target: number | null;
};

/**
 * "4 of the last 6 weeks hit 90 cardio minutes": the judged weeks against their target, called
 * "the last" only when they are the most recent weeks that could be judged.
 */
function targetLine(
  judged: CardioWeek[],
  candidates: CardioWeek[],
  target: number | null,
  today: string,
) {
  const goal = target === null ? 'their cardio target' : `${target} cardio minutes`;
  const hit = judged.filter((w) => w.hit).length;
  const recent = candidates.slice(-judged.length).every((w) => w.hit !== null);
  if (judged.length === 1) {
    const week = judged[0];
    const which = week.inProgress
      ? 'This week'
      : recent
        ? 'Last week'
        : `The week of ${dateText(week.weekStart, today)}`;
    return `${which} ${hit ? 'hit' : 'fell short of'} ${target === null ? 'its cardio target' : goal}`;
  }
  const weeks = `${recent ? 'the last ' : ''}${judged.length} weeks`;
  return hit === judged.length ? `Each of ${weeks} hit ${goal}` : `${hit} of ${weeks} hit ${goal}`;
}

/**
 * The first date an activity was recorded at all: a cardio session, or an activity routine on a
 * stored day's plan (its block, or its timed session recorded as due). `routineId` narrows it to
 * one routine; null is every activity.
 */
function firstActivity(state: State, routineId: string | null): string | undefined {
  const ids = new Set(
    routinesOf(state)
      .filter((r) => r.capture === 'activity' && (routineId === null || r.id === routineId))
      .map((r) => r.id),
  );
  let first: string | undefined;
  const seen = (date: string) => {
    if (first === undefined || date < first) first = date;
  };
  for (const a of state.activitySessions)
    if (routineId === null ? !a.study : a.routineId === routineId) seen(a.date);
  for (const [date, day] of Object.entries(state.days))
    if (
      (first === undefined || date < first) &&
      (day.blocks.some((b) => b.routineId !== null && ids.has(b.routineId)) ||
        day.dueTimed?.some((id) => ids.has(id)))
    )
      seen(date);
  return first;
}

/**
 * Cardio minutes per week. `routineId` narrows it to one activity routine's own sessions and target,
 * as the activity chips do; null is every activity.
 */
export function cardioCard(
  state: State,
  window: RangeWindow,
  routineId: string | null = null,
): CardioCard {
  const weeks = weeklyMinutes(state, window.to, window.weeks, routineId).map((w): CardioWeek => {
    const target = cardioTarget(state, w.weekStart, routineId);
    return {
      weekStart: w.weekStart,
      inProgress: inProgress(window, w.weekStart),
      value: w.sessions ? w.minutes : null,
      minutes: w.minutes,
      sessions: w.sessions,
      target,
      hit: target === null ? null : w.minutes >= target,
    };
  });
  const target = weeks.every((w) => w.target !== null && w.target === weeks[0].target)
    ? weeks[0].target
    : null;
  // A week is judged against its target once it is over (or already reached it), and only from
  // the activity's first recorded occurrence on: weeks before it was on the plan are not misses,
  // and the week it started in, partly before it, counts only once it reached the target.
  const first = firstActivity(state, routineId);
  const candidates = weeks.filter(
    (w) =>
      first !== undefined &&
      shiftDate(w.weekStart, 6) >= first &&
      ((w.weekStart >= first && !w.inProgress) || w.hit),
  );
  const judged = candidates.filter((w) => w.hit !== null);
  const total = weeks.reduce((sum, w) => sum + w.minutes, 0);
  const headline = !weeks.some((w) => w.sessions)
    ? `No cardio recorded ${window.words.within}`
    : judged.length
      ? targetLine(judged, candidates, target, window.to)
      : `${total} cardio minutes recorded ${window.words.within}`;
  return {
    ...cardText(window, headline, weeks.filter((w) => w.value !== null).length, {
      empty: 'Record a cardio session to start the chart.',
      sparse: 'The next week with cardio starts the chart.',
    }),
    weeks,
    target,
  };
}

export type JobsWeek = WeekPoint & {
  /**
   * Career objectives done (the column), of the times one was due on a recorded day: with two
   * career objectives a day counts twice, so these are objectives, never days.
   */
  done: number;
  due: number;
};
export type JobsCard = CardText & { weeks: JobsWeek[]; done: number; previousDone: number | null };

export function jobsCard(state: State, window: RangeWindow): JobsCard {
  const byDate = new Map<string, Counts<'done' | 'due'>>();
  for (const line of careerProgress(state, window.to, window.dates.length)) {
    if (line.study) continue;
    for (const { date, mark } of line.marks) {
      if (mark === 'none') continue;
      const counts = byDate.get(date) ?? { done: 0, due: 0 };
      counts.due++;
      if (mark === 'done') counts.done++;
      byDate.set(date, counts);
    }
  }
  const { weeks: counts, range, previous } = tally(window, ['done', 'due'], (d) => byDate.get(d));
  const weeks = counts.map(({ done, due }, i): JobsWeek => ({
    weekStart: window.weekStarts[i],
    inProgress: inProgress(window, window.weekStarts[i]),
    value: due ? done : null,
    done,
    due,
  }));
  const previousDone = previous.due ? previous.done : null;
  const headline = !range.due
    ? `No career days recorded ${window.words.within}`
    : `${plural(range.done, 'career action')} ${window.words.within}${
        previousDone === null
          ? ''
          : range.done > previousDone
            ? `, up from ${previousDone}`
            : range.done < previousDone
              ? `, down from ${previousDone}`
              : `, the same as the ${window.words.previous}`
      }`;
  return {
    ...cardText(window, headline, weeks.filter((w) => w.value !== null).length, {
      empty: 'Do a career objective on Today to start the chart.',
      sparse: 'The next week of career objectives starts the chart.',
    }),
    weeks,
    done: range.done,
    previousDone,
  };
}

export type MoneyCard = CardText & {
  currency: string;
  /** Reported balances in cents, one point per date, on one dollar scale. */
  debt: Point[];
  savings: Point[];
  /** Last minus first reported in the range; null with fewer than two reports. */
  debtChange: number | null;
  savingsChange: number | null;
  /** Reviews in another currency, counted and never converted. */
  otherCurrency: number;
  /**
   * The latest check-in's change against the one before it, per balance ("Latest check-in, Nov 8:
   * savings −$100.00 since Nov 1"); null when it says nothing the headline does not, because the
   * check-in before it is where the range's line starts, or when the latest is outside the range.
   */
  latest: string | null;
};

export function moneyCard(state: State, window: RangeWindow): MoneyCard {
  const debtSeries = moneySince(state, 'debt', window.from, window.to);
  const savingsSeries = moneySince(state, 'savings', window.from, window.to);
  const currency = debtSeries?.currency ?? 'USD';
  const debt = debtSeries?.points ?? [];
  const savings = savingsSeries?.points ?? [];
  const changeOf = (points: Point[]) => (points.length > 1 ? points.at(-1)!.y - points[0].y : null);
  const debtChange = changeOf(debt);
  const savingsChange = changeOf(savings);
  const clause = (name: string, points: Point[], change: number | null) => {
    if (!points.length) return null;
    if (change === null)
      return {
        text: `${name} ${formatMoney(points[0].y, currency)} on ${dateText(points[0].date, window.to)}`,
      };
    const words =
      change === 0
        ? `${name} unchanged`
        : `${name} ${change < 0 ? 'down' : 'up'} ${formatMoney(Math.abs(change), currency)}`;
    return { text: words, since: points[0].date };
  };
  // Debt first: becoming debt-free is the money goal.
  const parts = [
    clause('Debt', debt, debtChange),
    clause('Savings', savings, savingsChange),
  ].filter((p): p is { text: string; since?: string } => p !== null);
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  const withSince = (p: { text: string; since?: string }) =>
    p.since ? `${p.text} since ${dateText(p.since, window.to)}` : p.text;
  const headline = !parts.length
    ? `No money check-in ${window.words.within}`
    : parts.length === 2 && parts[0].since && parts[0].since === parts[1].since
      ? `${parts[0].text} and ${lower(parts[1].text)} since ${dateText(parts[0].since, window.to)}`
      : parts.map((p, i) => (i ? lower(withSince(p)) : withSince(p))).join(' · ');
  return {
    ...cardText(window, headline, Math.max(debt.length, savings.length), {
      empty: 'Add a money check-in to start the lines.',
      sparse: 'The next money check-in starts the lines.',
    }),
    currency,
    debt,
    savings,
    debtChange,
    savingsChange,
    otherCurrency: Math.max(debtSeries?.otherCurrency ?? 0, savingsSeries?.otherCurrency ?? 0),
    latest: latestCheckIn(state, window, { debt, savings }),
  };
}

function latestCheckIn(
  state: State,
  window: RangeWindow,
  lines: { debt: Point[]; savings: Point[] },
): string | null {
  const latest = sortedReviews(state).at(-1);
  if (!latest || !within(latest.date, window.from, window.to)) return null;
  const all = fieldChanges(state, latest);
  // Debt first, as in the headline.
  const changes = (['debt', 'savings'] as const).flatMap((field) => {
    const c = all.find((f) => f.field === field)!;
    if (c.delta === null || !c.previous) return [];
    // The range's line starts at that check-in, so the headline already says this change.
    if (lines[field][0]?.date === c.previous.date) return [];
    const amount = formatMoney(Math.abs(c.delta), latest.currency);
    return [
      {
        text: c.delta === 0 ? `${field} unchanged` : `${field} ${c.delta < 0 ? '−' : '+'}${amount}`,
        since: c.previous.date,
      },
    ];
  });
  if (!changes.length) return null;
  const since = (d: string) => `since ${dateText(d, window.to)}`;
  const words =
    changes.length === 2 && changes[0].since === changes[1].since
      ? `${changes[0].text} and ${changes[1].text} ${since(changes[0].since)}`
      : changes.map((c) => `${c.text} ${since(c.since)}`).join(' · ');
  return `Latest check-in, ${dateText(latest.date, window.to)}: ${words}`;
}

export type TradingCard = CardText & {
  routineId: string;
  /** Process score per reviewed session (0 to `total`), clean sessions flagged. */
  points: TradingPoint[];
  total: number;
  clean: number;
  /** Trading days in the range left without a review: never clean. */
  missed: number;
};

const meanOf = (points: Point[]) =>
  points.length
    ? Math.round((10 * points.reduce((a, p) => a + p.y, 0)) / points.length) / 10
    : null;

export function tradingCard(window: RangeWindow, days: TradingDays): TradingCard {
  const points = days.sessions.filter((s) => within(s.date, window.from, window.to));
  const clean = points.filter((p) => p.clean).length;
  // The tile above has the rule-clean sessions, the hard violations and the latest score, so the
  // card says where the scores went: their mean in the range against the previous range's.
  const mean = meanOf(points);
  const before = meanOf(
    days.sessions.filter((s) => within(s.date, window.previous.from, window.previous.to)),
  );
  const headline =
    mean === null
      ? `No reviewed trading sessions ${window.words.within}`
      : `Process score averaged ${mean} of ${days.total} ${window.words.within}${
          before === null
            ? ''
            : mean > before
              ? `, up from ${before}`
              : mean < before
                ? `, down from ${before}`
                : `, the same as the ${window.words.previous}`
        }`;
  return {
    ...cardText(window, headline, points.length, {
      empty: 'Review a trading session to start the line.',
      sparse: 'The next reviewed session starts the line.',
    }),
    routineId: days.routineId,
    points,
    total: days.total,
    clean,
    missed: days.missed.filter((d) => within(d, window.from, window.to)).length,
  };
}

export type HabitRow = {
  routineId: string;
  title: string;
  done: number;
  due: number;
  /** Percentage done of the recorded days (0 to 100). */
  share: number;
  /** Encouraged, never required: it never counts toward Day Cleared. */
  optional: boolean;
  private: boolean;
};
export type HabitsCard = CardText & {
  /**
   * Each routine recorded in the range: required ones first, then optional ones, each most done
   * first, so the steadiest habit is on top and the rest stay readable below it.
   */
  rows: HabitRow[];
};

/**
 * Each routine's completion in the range: a required study objective by the study streak's rules,
 * every other routine (an optional study objective too) by its recorded days (`recordedDaysOf`)
 * read as Day Cleared reads them. A bundled routine is its own row, read from the steps it left in
 * its parent's blocks, and a parent holding steps is a container that counts for no row on that day
 * whatever its own check says; a routine with no recorded day in the range is left out.
 */
export function habitsCard(state: State, window: RangeWindow, days: StudyDays): HabitsCard {
  const rows: HabitRow[] = [];
  const routines = state.programs.flatMap((p) => p.routines);
  // An optional study objective is left out of the Study tile and card, so it is read like every
  // other optional routine: by its recorded days.
  const byStreak = (r: Routine) => !!r.study && days.counted.has(r.id);
  const recorded = recordedDaysOf(
    state,
    routines.filter((r) => !byStreak(r)),
    window.from,
    window.to,
    window.to,
    new Set(routines.filter((r) => r.optional).map((r) => r.id)),
    // A workout that only hosts bundled steps is a container, never a habit row by itself.
    true,
  );
  for (const routine of routines) {
    const calendar = byStreak(routine) ? days.calendars.get(routine.id) : undefined;
    const { done, due } = calendar
      ? calendar.days
          .filter((d) => within(d.date, window.from, window.to))
          .reduce(
            (acc, d) => ({
              done: acc.done + (d.mark === 'completed' ? 1 : 0),
              due: acc.due + (d.mark === 'completed' || d.mark === 'missed' ? 1 : 0),
            }),
            { done: 0, due: 0 },
          )
      : recorded.get(routine.id)!;
    if (!due) continue;
    rows.push({
      routineId: routine.id,
      title: routine.title,
      done,
      due,
      share: percent(done, due),
      optional: !!routine.optional,
      private: !!routine.private,
    });
  }
  // Required habits first, then optional ones, each most done first (over more days when the share
  // is the same): the top bar is the habit the headline names.
  rows.sort(
    (a, b) =>
      Number(a.optional) - Number(b.optional) ||
      b.share - a.share ||
      b.due - a.due ||
      a.title.localeCompare(b.title),
  );
  const required = rows.filter((r) => !r.optional);
  const steadiest = required[0];
  // The headline leads with what held, never with the habit that slipped: that one is in the bars.
  const headline = !rows.length
    ? `No habits recorded ${window.words.within}`
    : !steadiest
      ? `Only optional habits were recorded ${window.words.within}`
      : required.every((r) => r.share === 100)
        ? `Every required habit done on all its recorded days ${window.words.within}`
        : !steadiest.done
          ? `No required habit done yet ${window.words.within}`
          : `${steadiest.title}: done on ${steadiest.done} of ${plural(steadiest.due, 'day')}`;
  // A bar list reads with a single habit too, so it is never sparse.
  return {
    ...cardText(window, headline, rows.length ? 2 : 0, {
      empty: 'Habits appear here once they are on a day’s plan.',
      sparse: '',
    }),
    rows,
  };
}

// Mornings.

export type MorningsCard = {
  routineId: string;
  /** "Up by 7:10 AM": the anchor time set now. */
  upBy: string;
  /** The first date the anchor reads. */
  since: string;
  /** `start` until two mornings are ticked: one line says what starts the calendar. */
  state: 'start' | 'chart';
  /** "On time 5 of the last 7", or the anchor time when none of the last seven was on time. */
  headline: string;
  /** In place of the calendar while starting. */
  note: string | null;
  /**
   * This month so far against the same days of last month: "November: 9 by the 16th · October: 6
   * by the 16th", "December 2–16: 15 · November 2–16: 14" when the anchor began during last month,
   * "Started Nov 2" with no days of last month to compare, never a comparison with nothing.
   */
  month: MonthLine | null;
  /**
   * "Usually ticked by 7:12 AM · half of mornings between 7:00 AM and 7:25 AM", from three ticks or
   * more: the median, and the middle half when it spans a minute or more.
   */
  usual: string | null;
  /**
   * Five Monday-to-Sunday weeks through today, oldest first, from the week the anchor began when
   * that is later.
   */
  days: Morning[];
  /** For VoiceOver: the card in one sentence. */
  summary: string;
};

/** The month line, in words and as the two figures the card sets side by side. */
export type MonthLine = {
  text: string;
  spoken: string;
  direction: 'up' | 'down' | null;
  /** On-time mornings this month so far (from the day the anchor began, when that was last month). */
  now: number;
  /** The same days of last month; null with none of them to compare, or none on time there. */
  before: number | null;
  /** Last month's name: "October". */
  lastName: string;
  /**
   * The span the figures cover, under them: "Same days of October", "November 2–16 · October
   * 2–16", "Started Oct 26"; null for this month alone.
   */
  span: string | null;
  /** The change in a few words: "↑ 5 more", "Same as October", "Fewer than October". */
  change: string | null;
};

/** Weeks in the Mornings calendar. */
export const MORNING_WEEKS = 5;
/** Days the usual tick time is read over. */
const USUAL_DAYS = 28;

const monthName = (date: string) => dateObject(date).toLocaleDateString('en-US', { month: 'long' });
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
/** The value below which a share `q` of the sorted values lies, interpolated between neighbors. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (at - lo);
}

/**
 * The usual tick time from sorted minutes: the median, then the middle half of the mornings as the
 * times it runs between (a share stated as what it is, half, never "most").
 */
function usualLine(times: number[]): string {
  const median = `Usually ticked by ${displayTime(Math.round(quantile(times, 0.5)))}`;
  const low = Math.round(quantile(times, 0.25)),
    high = Math.round(quantile(times, 0.75));
  return low === high
    ? median
    : `${median} · half of mornings between ${displayTime(low)} and ${displayTime(high)}`;
}

/** What a day on the Mornings calendar was, in words: the readout and VoiceOver say the same. */
export function morningWords(m: Morning): string {
  const time = m.at === null ? '' : ` ${displayTime(m.at)}`;
  const fix = m.corrected ? ', corrected' : '';
  switch (m.mark) {
    case 'on-time':
      return m.corrected ? `on time, up at${time}${fix}` : `on time, ticked${time}`;
    case 'late':
      return m.corrected
        ? `after the window, up at${time}${fix}`
        : m.at === null
          ? 'ticked after the window'
          : `ticked${time}, after the window`;
    case 'open':
      return 'today, not ticked yet';
    case 'not-ticked':
      return 'not ticked';
    case 'skipped':
      return 'skipped';
    case 'free':
      return 'not due';
    case 'none':
      return 'not recorded';
    case 'before':
      return 'before the anchor started';
  }
}

/**
 * The month line: on-time mornings this month so far against the same days of last month. When the
 * anchor began during last month, both months count from that day of the month ("December 2–16: 15
 * · November 2–16: 14"), so the first month is compared as soon as it can be, on the same days.
 */
function monthLine(
  state: State,
  routine: Routine,
  since: string,
  today: string,
): MorningsCard['month'] {
  const day = Number(today.slice(8));
  const first = `${today.slice(0, 8)}01`;
  const lastMonth = shiftDate(first, -1);
  const lastFirst = `${lastMonth.slice(0, 8)}01`;
  // The same days of last month: through the same date, or its last day when it is shorter.
  const lastEnd =
    lastMonth.slice(8) < today.slice(8) ? lastMonth : `${lastMonth.slice(0, 8)}${today.slice(8)}`;
  const count = (from: string, to: string) =>
    datesBetween(from, to).filter((d) => morningOn(state, routine, d, today).mark === 'on-time')
      .length;
  const name = monthName(today);
  const lastName = monthName(lastMonth);
  // Began after the same date of last month (or this month): no days of last month to set against
  // these, so say when it started, never compare with nothing or with fewer days.
  if (since > lastEnd) {
    const now = count(first, today);
    const nowText = `${name}: ${now} by the ${ordinal(day)}`;
    const nowSpoken = `${name}: ${plural(now, 'morning')} on time by the ${ordinal(day)}`;
    const started = `Started ${shortDate(since)}`;
    const alone = { direction: null, now, before: null, lastName, span: started, change: null };
    return now
      ? { text: `${nowText} · ${started}`, spoken: `${nowSpoken}. ${started}.`, ...alone }
      : { text: started, spoken: `${started}.`, ...alone };
  }
  // Began during last month (no later than today's date there): both months from the day it began.
  const from = since > lastFirst ? Number(since.slice(8)) : 1;
  const pad = String(from).padStart(2, '0');
  const now = count(`${today.slice(0, 8)}${pad}`, today);
  const before = count(`${lastMonth.slice(0, 8)}${pad}`, lastEnd);
  const lastDay = Number(lastEnd.slice(8));
  const span = (month: string, to: number, n: number) =>
    from === 1 ? `${month}: ${n} by the ${ordinal(to)}` : `${month} ${from}–${to}: ${n}`;
  const spokenSpan = (to: number) =>
    from === 1 ? `by the ${ordinal(to)}` : `from the ${ordinal(from)} to the ${ordinal(to)}`;
  const nowText = span(name, day, now);
  const nowSpoken = `${name}: ${plural(now, 'morning')} on time ${spokenSpan(day)}`;
  // Nothing on time this month yet: no line, so last month is never set against nothing.
  if (!now) return null;
  if (!before)
    return {
      text: nowText,
      spoken: `${nowSpoken}.`,
      direction: null,
      now,
      before: null,
      lastName,
      span: null,
      change: null,
    };
  const thenText = span(lastName, lastDay, before);
  const direction = now > before ? 'up' : now < before ? 'down' : null;
  // Spoken, a rise gives its size; a fall gives only its direction, never a count of shortfall.
  const versus =
    direction === 'up'
      ? `${now - before} more than ${lastName}`
      : direction === 'down'
        ? `fewer than ${lastName}`
        : `the same as ${lastName}`;
  return {
    text: `${nowText} · ${thenText}`,
    spoken: `${nowSpoken}, ${versus}, which had ${before} ${spokenSpan(lastDay)}.`,
    direction,
    now,
    before,
    lastName,
    span:
      from === 1
        ? `Same days of ${lastName}`
        : `${name} ${from}–${day} · ${lastName} ${from}–${lastDay}`,
    // A rise gives its size; a fall only its direction, in neutral words.
    change:
      direction === 'up'
        ? `↑ ${now - before} more`
        : direction === 'down'
          ? `Fewer than ${lastName}`
          : `Same as ${lastName}`,
  };
}

/**
 * The Mornings card, shown first on Progress while an enabled routine is the morning anchor: the
 * rolling count of the last seven mornings (no Monday reset and no run that resets), this month
 * against the same days of last month, five weeks of mornings as a calendar and the usual tick
 * time. Every morning is read by `morningOn`, the rule Today's caption uses.
 */
export function mornings(state: State, today: string): MorningsCard | null {
  const routine = anchorRoutine(state);
  const since = routine && anchorSince(routine);
  if (!routine || !since) return null;
  const upBy = `Up by ${displayTime(currentUpBy(routine)!)}`;
  const recent = recentMornings(state, routine, today);
  // Five weeks, or fewer while the anchor is newer: weeks wholly before it are not drawn.
  const first = shiftDate(today, -(calendarDays(today, MORNING_WEEKS) - 1));
  const startWeek = weekStartOf(since);
  const days = datesBetween(startWeek > first && startWeek <= today ? startWeek : first, today).map(
    (d) => morningOn(state, routine, d, today),
  );
  const ticks =
    since <= today
      ? datesBetween(since, today).map((d) => morningOn(state, routine, d, today))
      : [];
  const judged = ticks.filter((m) => m.mark === 'on-time' || m.mark === 'late');
  const start = judged.length < 2;
  // The count leads once there is one; while starting, or with none of the last seven on time,
  // the anchor time does, so a zero is never the headline.
  const headline =
    !start && recent.onTime ? `On time ${recent.onTime} of the last ${recent.days}` : upBy;
  const month = monthLine(state, routine, since, today);
  const times = ticks
    .filter((m) => m.date > shiftDate(today, -USUAL_DAYS) && m.at !== null)
    .map((m) => m.at!)
    .sort((a, b) => a - b);
  const usual = times.length >= 3 ? usualLine(times) : null;
  const note = !judged.length
    ? 'Your first tick starts the calendar.'
    : start
      ? `First tick ${dayText(judged[0].date, today)}. The calendar fills in from the next one.`
      : null;
  return {
    routineId: routine.id,
    upBy,
    since,
    state: start ? 'start' : 'chart',
    headline,
    note,
    month: start ? null : month,
    usual: start ? null : usual,
    days,
    summary: `${[
      'Mornings',
      headline,
      headline === upBy ? null : upBy,
      start ? note : month?.spoken,
      start ? null : usual,
    ]
      .filter((part): part is string => !!part)
      .map((part) => part.replace(/\.$/, ''))
      .join('. ')}.`,
  };
}

// The tab.

export type ProgressData = {
  window: RangeWindow;
  /** First, while an enabled routine is the morning anchor; it reads its own spans, not the range. */
  mornings: MorningsCard | null;
  /** The KPI row, in order: the streak, days cleared, then study and trading when they exist. */
  tiles: Tile[];
  /**
   * Each card is null when its kind is neither in the plan nor in the records; a routine paused in
   * Programs is not in the plan.
   */
  consistency: ConsistencyCard | null;
  weight: WeightCard | null;
  strength: StrengthCard | null;
  study: StudyCard | null;
  cardio: CardioCard | null;
  jobs: JobsCard | null;
  money: MoneyCard | null;
  trading: TradingCard | null;
  habits: HabitsCard | null;
};

const routinesOf = (state: State) => state.programs.flatMap((p) => p.routines);

/** Everything the Progress tab shows for one range, from the records as they are now. */
export function progress(state: State, range: ProgressRange, today: string): ProgressData {
  const window = rangeWindow(range, today);
  const routines = routinesOf(state);
  // A routine paused in Programs is not in the plan: a tile or card that only the plan puts here
  // waits until it is resumed, and its records stay. Records of their own (weigh-ins, cardio
  // sessions, finished workouts, money check-ins) still show theirs.
  const planned = routines.filter((r) => r.enabled);
  const isPlanned = (id: string) => planned.some((r) => r.id === id);
  const recorded = Object.keys(state.days).some((d) => d <= today);
  const study = studyDays(state, window);
  const hasStudy = careerRoutines(state).some((r) => r.study && r.enabled);
  const read = tradingDays(state, window);
  const trading = read && isPlanned(read.routineId) ? read : null;
  // One walk of the stored days gives both the streak and the cleared days.
  const runs = dayClearRuns(state, today, today);
  const tiles = [
    streakTile(window, runs),
    clearedTile(window, runs),
    ...(hasStudy ? [studyTile(window, study)] : []),
    ...(trading ? [tradingTile(window, trading)] : []),
  ];
  const has = (capture: Routine['capture']) => planned.some((r) => r.capture === capture);
  const habits = routines.length ? habitsCard(state, window, study) : null;
  return {
    window,
    mornings: mornings(state, today),
    tiles,
    consistency: routines.length || recorded ? consistencyCard(state, window) : null,
    weight:
      has('weight') || state.measurements.some((m) => m.kind === 'body-weight')
        ? weightCard(state, window)
        : null,
    strength:
      state.workoutTemplates.some((t) => isPlanned(t.routineId)) || exerciseOptions(state).length
        ? strengthCard(state, window)
        : null,
    study: hasStudy ? studyCard(state, window, study) : null,
    cardio:
      has('activity') || state.activitySessions.some((a) => !a.study)
        ? cardioCard(state, window)
        : null,
    jobs: careerRoutines(state).some((r) => !r.study && r.enabled) ? jobsCard(state, window) : null,
    money: has('money') || state.moneyReviews.length ? moneyCard(state, window) : null,
    trading: trading ? tradingCard(window, trading) : null,
    habits: habits && (planned.length || habits.rows.length) ? habits : null,
  };
}

// Saved states are replaced, never changed in place, so one result per state, range and day is
// kept for as long as that state is: switching ranges back and forth recomputes nothing.
const cache = new WeakMap<State, Map<string, ProgressData>>();

/** `progress`, memoized per saved state, range and day. */
export function progressOf(state: State, range: ProgressRange, today: string): ProgressData {
  let byKey = cache.get(state);
  if (!byKey) cache.set(state, (byKey = new Map()));
  const key = `${range}|${today}`;
  let data = byKey.get(key);
  if (!data) byKey.set(key, (data = progress(state, range, today)));
  return data;
}
