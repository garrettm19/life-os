import { compareCheckpoints, comparisonLine } from './checkpoints';
import { focusRoutines } from './focus';
import { weightIn } from './measurements';
import { Block, Focus, MoneyReview, Routine, State, shiftDate, shortDate } from './model';
import { MoneyTotal, formatMoney, sortedReviews } from './money';
import { isContainer } from './objectives';
import { studyDayResult, studyOccurrence } from './study-streak';
import { tradingBook, tradingDayReader } from './trading';
import { completedSessions } from './workouts';

// What the records say about a focus over a window: consistency of its routines and the outcome
// evidence for its kind. Every line is a recorded fact with its dates; a missing value says so and
// is never zero. Nothing is scored, projected or combined into one number.

export type EvidenceLine = { label: string; value: string };

const NOT_YET = 'Not recorded yet';

/**
 * Study days kept in [from, to] by the study streak's own rules (a scheduled day never opened is
 * missed, a protected day holds, nothing before tracking started is scored; today counts once done).
 * The streak is left to the Study tile above the course correction, so it is shown once.
 */
function studyLine(
  state: State,
  routine: Routine,
  from: string,
  to: string,
  today: string,
): EvidenceLine {
  const trackFrom = routine.study?.trackFrom;
  let kept = 0;
  let missed = 0;
  if (trackFrom)
    for (let date = from < trackFrom ? trackFrom : from; date <= to; date = shiftDate(date, 1)) {
      if (date > today) break;
      if (date === today) {
        if (studyOccurrence(state, routine, date)?.status === 'done') kept++;
        continue;
      }
      const result = studyDayResult(state, routine, date);
      if (result === 'kept') kept++;
      if (result === 'missed') missed++;
    }
  return {
    label: routine.title,
    value:
      kept + missed ? `${kept} of ${kept + missed} study days kept` : 'No scored study days yet',
  };
}

export type RecordedDays = { done: number; due: number };

/**
 * Days a routine was done, of the days it was recorded on the plan in [from, to] through today. A
 * day never opened is not counted either way: without a recorded plan there is no telling it was
 * due. A protected day counts only where it was done, and today only once done or skipped. An
 * optional routine's occurrences count only with `optional`, since they are never required.
 */
export function recordedDays(
  state: State,
  routine: Routine,
  from: string,
  today: string,
  to = today,
  optional = false,
): RecordedDays {
  const withOptional = new Set(optional ? [routine.id] : []);
  return recordedDaysOf(state, [routine], from, today, to, withOptional).get(routine.id)!;
}

/**
 * `recordedDays` for several routines in one pass over the stored days, by routine ID; the
 * optional occurrences of the routines in `withOptional` count too. A bundled routine's occurrences
 * are the steps it left inside its parent's block (optional when the step or its parent is, as Day
 * Cleared reads them). The parent's own check counts for the parent routine, unless `asDayCleared`:
 * then a container counts for no routine of its own, as Day Cleared never counts it, and a
 * skip is not due, as Day Cleared excuses it.
 */
export function recordedDaysOf(
  state: State,
  routines: Routine[],
  from: string,
  today: string,
  to = today,
  withOptional: ReadonlySet<string> = new Set(),
  asDayCleared = false,
): Map<string, RecordedDays> {
  const counts = new Map(routines.map((r): [string, RecordedDays] => [r.id, { done: 0, due: 0 }]));
  const end = to < today ? to : today;
  // Only recorded days can count, so the stored days are read instead of every calendar date.
  for (const [date, day] of Object.entries(state.days)) {
    if (date < from || date > end) continue;
    // Each routine's first occurrence on the day, as `find` would return it.
    const first = new Map<string, Pick<Block, 'status'>>();
    const take = (routineId: string | null, item: Pick<Block, 'status'>, optional: boolean) => {
      if (
        routineId !== null &&
        counts.has(routineId) &&
        !first.has(routineId) &&
        (withOptional.has(routineId) || !optional)
      )
        first.set(routineId, item);
    };
    for (const b of day.blocks)
      if (!asDayCleared || !isContainer(b)) take(b.routineId, b, !!b.optional);
    for (const b of day.blocks)
      for (const step of b.bundledSteps ?? [])
        take(step.routineId, step, !!step.optional || !!b.optional);
    for (const [routineId, block] of first) {
      const count = counts.get(routineId)!;
      if (block.status === 'done') {
        count.done++;
        count.due++;
      } else if (
        !day.protection &&
        !(date === today && block.status === 'planned') &&
        // Day Cleared excuses a skip: it is not due there, so it is never a miss here either.
        !(asDayCleared && block.status === 'skipped')
      )
        count.due++;
    }
  }
  return counts;
}

/**
 * How often a routine was done on the days it was recorded on the plan in [from, to]
 * (`recordedDays`); a study objective by the study streak's rules.
 */
export function consistency(
  state: State,
  routine: Routine,
  from: string,
  today: string,
  to = today,
): EvidenceLine {
  if (routine.study) return studyLine(state, routine, from, to, today);
  const { done, due } = recordedDays(state, routine, from, today, to);
  return {
    label: routine.title,
    value: due
      ? `Done on ${done} of ${due} recorded days`
      : 'Not on a recorded plan in this period',
  };
}

/** First and latest reported value of a money total in the window, with the actual change. */
export function moneyLine(
  state: State,
  field: MoneyTotal,
  from: string | null,
  today: string,
): EvidenceLine {
  const label = { debt: 'Debt', savings: 'Savings', cash: 'Cash' }[field];
  const reviews = sortedReviews(state).filter((r) => r[field] !== null && r.date <= today);
  const latest = reviews.at(-1);
  if (!latest) return { label, value: 'Not reported yet' };
  const same = reviews.filter((r) => r.currency === latest.currency);
  const other = same.length < reviews.length ? ' · reports in another currency not compared' : '';
  // The start: the last report on or before the window opened, else the first one after it.
  const baseline: MoneyReview =
    (from ? same.filter((r) => r.date <= from).at(-1) : undefined) ??
    same.find((r) => !from || r.date >= from)!;
  const fmt = (r: MoneyReview) => `${formatMoney(r[field]!, r.currency)} (${shortDate(r.date)})`;
  if (baseline.id === latest.id)
    return { label, value: `${fmt(latest)} · one report so far${other}` };
  const delta = latest[field]! - baseline[field]!;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return {
    label,
    value: `${fmt(baseline)} → ${fmt(latest)} · ${sign}${formatMoney(Math.abs(delta), latest.currency)}${other}`,
  };
}

/** The most-logged exercise's heaviest completed set, first session against latest. */
export function liftLine(state: State, from: string, today: string): EvidenceLine | null {
  const sessions = completedSessions(state, from, today);
  const heaviest = new Map<string, { date: string; load: number; unit: string }[]>();
  for (const s of sessions)
    for (const e of s.exercises) {
      const loads = e.sets.filter((x) => x.done && x.load !== null).map((x) => x.load!);
      if (!loads.length) continue;
      const list = heaviest.get(e.name) ?? [];
      list.push({ date: s.date, load: Math.max(...loads), unit: e.unit });
      heaviest.set(e.name, list);
    }
  const [name, points] = [...heaviest.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!name || !points) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted.at(-1)!;
  const unitOk = sorted.every((p) => p.unit === first.unit);
  const text = (p: typeof first) => `${p.load} ${p.unit} (${shortDate(p.date)})`;
  return {
    label: `${name} · heaviest set`,
    value: !unitOk
      ? `${text(last)} · earlier sessions use another unit, so they are not compared`
      : sorted.length === 1
        ? `${text(last)} · one session so far`
        : `${text(first)} → ${text(last)}`,
  };
}

export function weightLine(state: State, from: string | null, today: string): EvidenceLine | null {
  const list = state.measurements
    .filter((m) => m.kind === 'body-weight' && (!from || m.date >= from) && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const unit = list.at(-1)!.entered.unit;
  const text = (m: (typeof list)[number]) => `${weightIn(m, unit)} ${unit} (${shortDate(m.date)})`;
  return {
    label: 'Body weight',
    value: list.length === 1 ? text(list[0]) : `${text(list[0])} → ${text(list.at(-1)!)}`,
  };
}

export function tradingLines(state: State, from: string, to: string, today = to): EvidenceLine[] {
  const book = tradingBook(state);
  if (!book?.trading) return [{ label: 'Trading process', value: 'Not set up' }];
  const counts = { clean: 0, broken: 0, away: 0, missed: 0 };
  const read = tradingDayReader(state, book);
  let hard = 0;
  for (let date = from; date <= to && date <= today; date = shiftDate(date, 1)) {
    const d = read(date, today);
    if (d.status in counts) counts[d.status as keyof typeof counts]++;
    hard += d.review?.trading ? d.review.violations.length : 0;
  }
  return [
    {
      label: 'Trading sessions',
      value: `${counts.clean} clean · ${counts.broken} rule-broken · ${counts.missed} not reviewed`,
    },
    { label: 'Hard violations', value: String(hard) },
  ];
}

function trainingLines(state: State, from: string, today: string): EvidenceLine[] {
  const sessions = completedSessions(state, from, today);
  const minutes = state.activitySessions
    .filter((a) => !a.study && a.date >= from && a.date <= today)
    .reduce((n, a) => n + a.minutes, 0);
  return [
    { label: 'Workouts finished', value: sessions.length ? String(sessions.length) : NOT_YET },
    liftLine(state, from, today),
    weightLine(state, from, today),
    minutes ? { label: 'Cardio and activity', value: `${minutes} min recorded` } : null,
  ].filter((l): l is EvidenceLine => !!l);
}

/**
 * The evidence for a focus from `from` (its start by default) to `today`: its routines'
 * consistency, then the outcome records for its kind.
 */
export function focusEvidence(
  state: State,
  focus: Focus,
  today: string,
  from = focus.startDate,
  to = today,
): EvidenceLine[] {
  const end = to > today ? today : to;
  const start = from > end ? end : from;
  const book = tradingBook(state);
  const routines = focusRoutines(state, focus).filter(
    (r) => !(focus.evidence === 'trading' && r.id === book?.routineId),
  );
  const lines = routines.map((r) => consistency(state, r, start, today, end));
  if (focus.evidence === 'career')
    lines.push({ label: 'Skill checkpoints', value: comparisonLine(compareCheckpoints(state)) });
  if (focus.evidence === 'money')
    lines.push(...(['debt', 'savings'] as const).map((f) => moneyLine(state, f, start, end)));
  if (focus.evidence === 'training') lines.push(...trainingLines(state, start, end));
  if (focus.evidence === 'trading') lines.push(...tradingLines(state, start, end, today));
  return lines;
}
