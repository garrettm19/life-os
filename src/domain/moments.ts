import { anchorRoutine, backOnTime, morningOn } from './anchor';
import { State, dateObject, displayDate, displayTime, shiftDate, weekStartOf } from './model';
import { weightIn } from './measurements';
import { formatMoney } from './money';
import { dayClearStreak, dayOutcome } from './objectives';

// Progress worth feeling, read only from what was recorded: a lift heavier than every earlier
// session, the Day Clear streak reaching a new best or a round number, a money review that shows
// debt down or savings up, the morning anchor ticked on time again after a morning that was not,
// and the long view since the first record. Nothing is scored or awarded and nothing is stored:
// every moment is derived again from the records, so Undo or a correction changes it too. No
// points, levels or badges (docs/decisions/0003-one-rule-for-day-cleared.md).

export type MomentKind = 'streak' | 'lift' | 'money' | 'morning';

export type Moment = {
  id: string;
  kind: MomentKind;
  /** Which way the number moved: up for a lift or savings, down for debt. */
  direction?: 'up' | 'down';
  /** The headline in a few words: "Bench press 165 lb". */
  title: string;
  /** What makes it worth noticing: "Heaviest yet, up from 160 lb". */
  detail: string;
};

/** Round streak lengths worth saying out loud. */
export const STREAK_MARKS = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

const heaviest = (sets: { load: number | null; done: boolean }[]) =>
  sets.reduce<number | null>(
    (best, s) =>
      s.done && s.load !== null && s.load > 0 && (best === null || s.load > best) ? s.load : best,
    null,
  );

/**
 * Exercises whose heaviest completed set on `date` beats every earlier completed session of the same
 * exercise in the same unit. A first-ever session is not a best: there is nothing to beat yet.
 */
export function liftBests(state: State, date: string): Moment[] {
  const sessions = state.workoutSessions.filter((s) => s.status === 'completed' && s.date <= date);
  // The bar to beat comes from earlier days only, so a second session today is compared with what
  // was lifted before today, never with this morning's set.
  const before = new Map<string, number>();
  const today = new Map<string, { name: string; unit: string; load: number }>();
  for (const session of sessions)
    for (const exercise of session.exercises) {
      if (exercise.kind === 'time') continue;
      const load = heaviest(exercise.sets);
      if (load === null) continue;
      const key = `${exercise.exerciseId}:${exercise.unit}`;
      if (session.date < date) before.set(key, Math.max(before.get(key) ?? 0, load));
      else if (load > (today.get(key)?.load ?? 0))
        today.set(key, { name: exercise.name, unit: exercise.unit, load });
    }
  return [...today.entries()]
    .filter(([key, t]) => before.has(key) && t.load > before.get(key)!)
    .map(([key, t]) => ({
      id: `lift:${key}:${date}`,
      kind: 'lift' as const,
      direction: 'up' as const,
      title: `${t.name} ${t.load} ${t.unit}`,
      detail: `Heaviest yet, up from ${before.get(key)} ${t.unit}`,
    }));
}

/** The Day Clear streak through `date`, when that day is cleared and reaches a mark or a new best. */
export function streakMoment(state: State, date: string, today: string): Moment | null {
  if (dayOutcome(state, date) !== 'cleared') return null;
  const { current, best } = dayClearStreak(state, date, today);
  const earlierBest = dayClearStreak(state, shiftDate(date, -1), today).best;
  // A new best counts once there was a real run to beat; the first days of the first run are not
  // each announced as a record.
  const newBest = current === best && current > earlierBest && earlierBest >= 3;
  if (!newBest && !STREAK_MARKS.includes(current)) return null;
  return {
    id: `streak:${date}`,
    kind: 'streak',
    title: `${current}-day streak`,
    detail: newBest
      ? `Your longest run yet, past ${earlierBest}`
      : `${current} cleared days in a row`,
  };
}

/** A money review dated `date` that shows debt down or savings up since the review before it. */
export function moneyMoment(state: State, date: string): Moment | null {
  const reviews = state.moneyReviews
    .filter((r) => r.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  const today = reviews.filter((r) => r.date === date).at(-1);
  if (!today) return null;
  const earlier = reviews.filter((r) => r.date < date && r.currency === today.currency);
  const lastWith = (field: 'debt' | 'savings') => earlier.filter((r) => r[field] !== null).at(-1);
  const firstWith = (field: 'debt' | 'savings') => earlier.find((r) => r[field] !== null);
  const previousDebt = lastWith('debt');
  if (today.debt !== null && previousDebt && today.debt < previousDebt.debt!) {
    const first = firstWith('debt')!;
    const since = first.debt! - today.debt;
    return {
      id: `money:debt:${date}`,
      kind: 'money',
      direction: 'down',
      title: `Debt down ${formatMoney(previousDebt.debt! - today.debt, today.currency)}`,
      detail:
        first.id === previousDebt.id
          ? `Since ${displayDate(first.date)}`
          : `${formatMoney(since, today.currency)} down since ${displayDate(first.date)}`,
    };
  }
  const previousSavings = lastWith('savings');
  if (today.savings !== null && previousSavings && today.savings > previousSavings.savings!)
    return {
      id: `money:savings:${date}`,
      kind: 'money',
      direction: 'up',
      title: `Savings up ${formatMoney(today.savings - previousSavings.savings!, today.currency)}`,
      detail: `Since ${displayDate(previousSavings.date)}`,
    };
  return null;
}

/**
 * The morning anchor ticked on time on `date` after a morning that was not: coming back is
 * what is worth noticing, never the mornings before it.
 */
export function morningMoment(state: State, date: string, today: string): Moment | null {
  const routine = anchorRoutine(state);
  if (!routine || !backOnTime(state, routine, date, today)) return null;
  const m = morningOn(state, routine, date, today);
  return {
    id: `morning:${date}`,
    kind: 'morning',
    title: 'Back on time',
    detail: `${m.corrected ? 'Up at' : 'Ticked'} ${displayTime(m.at!)} · up by ${displayTime(m.upBy!)}`,
  };
}

/** Everything worth noticing about one day, most personal first: the streak, mornings, lifts, money. */
export function dayMoments(state: State, date: string, today: string): Moment[] {
  const streak = streakMoment(state, date, today);
  const morning = morningMoment(state, date, today);
  const money = moneyMoment(state, date);
  return [
    ...(streak ? [streak] : []),
    ...(morning ? [morning] : []),
    ...liftBests(state, date),
    ...(money ? [money] : []),
  ];
}

/** The streak before and after `date`, for counting up: the run held into the day, then through it. */
export function streakStep(state: State, date: string, today: string) {
  const held = dayClearStreak(state, shiftDate(date, -1), today);
  return {
    before: held.current,
    after: dayClearStreak(state, date, today).current,
    /** The best run before this day, to tell a new best from a tie. */
    bestBefore: held.best,
  };
}

export type WeekDayMark = {
  date: string;
  /** One letter for the weekday: M, T, W… */
  letter: string;
  /**
   * cleared, protected, missed (a past day not cleared), open (today, unfinished), later, free
   * (nothing was due), none (never opened).
   */
  mark: 'cleared' | 'protected' | 'missed' | 'open' | 'later' | 'free' | 'none';
  today: boolean;
};

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The seven days ending on `date`, each read with the one Day Cleared rule: the run being built,
 * whatever the weekday. A day never opened, or with nothing due, is `none`: it neither counts nor
 * breaks anything.
 */
export function weekMarks(state: State, date: string, today: string): WeekDayMark[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = shiftDate(date, i - 6);
    const outcome = dayOutcome(state, day);
    const mark: WeekDayMark['mark'] =
      day > today
        ? 'later'
        : outcome === 'cleared'
          ? 'cleared'
          : outcome === 'protected'
            ? 'protected'
            : outcome === 'open'
              ? day === today
                ? 'open'
                : 'missed'
              : outcome === 'empty'
                ? 'free'
                : 'none';
    return { date: day, letter: LETTERS[dateObject(day).getDay()], mark, today: day === today };
  });
}

export type Highlight = {
  id: string;
  label: string;
  value: string;
  detail: string;
  /** Workouts only: the lift that grew most, first and heaviest load, for the card's scoreboard. */
  lift?: { name: string; from: number; to: number; unit: string };
};

/**
 * The long view, since the first record of each kind: cleared days and the best run, workouts and
 * the lift that grew most, debt and savings from the first report to the latest, and body weight
 * from the first weigh-in. Only what was recorded; a kind with no records says nothing.
 */
export function journey(state: State, today: string): Highlight[] {
  const out: Highlight[] = [];
  const dates = Object.keys(state.days)
    .filter((d) => d <= today)
    .sort();
  const cleared = dates.filter((d) => dayOutcome(state, d) === 'cleared');
  if (cleared.length) {
    const { best } = dayClearStreak(state, today, today);
    out.push({
      id: 'cleared',
      label: 'Days cleared',
      value: String(cleared.length),
      detail: `Best run ${best}`,
    });
  }
  const sessions = state.workoutSessions
    .filter((s) => s.status === 'completed' && s.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt));
  if (sessions.length) {
    const first = new Map<string, { name: string; unit: string; load: number }>();
    const latest = new Map<string, number>();
    for (const s of sessions)
      for (const e of s.exercises) {
        if (e.kind === 'time') continue;
        const load = heaviest(e.sets);
        if (load === null) continue;
        const key = `${e.exerciseId}:${e.unit}`;
        if (!first.has(key)) first.set(key, { name: e.name, unit: e.unit, load });
        latest.set(key, Math.max(latest.get(key) ?? 0, load));
      }
    const grew = [...first.entries()]
      .map(([key, f]) => ({
        ...f,
        gain: (latest.get(key) ?? f.load) - f.load,
        top: latest.get(key)!,
      }))
      .filter((x) => x.gain > 0)
      // The biggest absolute gain is the lift that grew most in a way you feel (a main lift, not a
      // light accessory doubling from a small start).
      .sort((a, b) => b.gain - a.gain || a.name.localeCompare(b.name))[0];
    out.push({
      id: 'workouts',
      label: 'Workouts done',
      value: String(sessions.length),
      detail: grew
        ? `${grew.name} ${grew.load} → ${grew.top} ${grew.unit}`
        : `Since ${displayDate(sessions[0].date)}`,
      ...(grew
        ? { lift: { name: grew.name, from: grew.load, to: grew.top, unit: grew.unit } }
        : {}),
    });
  }
  const money = state.moneyReviews
    .filter((r) => r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  const currency = money.at(-1)?.currency;
  const debts = money.filter((r) => r.currency === currency && r.debt !== null);
  if (debts.length > 1 && debts.at(-1)!.debt! < debts[0].debt!)
    out.push({
      id: 'debt',
      label: 'Debt paid down',
      value: formatMoney(debts[0].debt! - debts.at(-1)!.debt!, currency),
      detail: `${formatMoney(debts[0].debt!, currency)} → ${formatMoney(debts.at(-1)!.debt!, currency)} since ${displayDate(debts[0].date)}`,
    });
  const savings = money.filter((r) => r.currency === currency && r.savings !== null);
  if (savings.length > 1 && savings.at(-1)!.savings! > savings[0].savings!)
    out.push({
      id: 'savings',
      label: 'Savings added',
      value: formatMoney(savings.at(-1)!.savings! - savings[0].savings!, currency),
      detail: `Since ${displayDate(savings[0].date)}`,
    });
  // Body weight from the first weigh-in to the latest, in the latest one's unit. Its direction is
  // the user's to read: it is never called progress or a setback.
  const weights = state.measurements
    .filter((m) => m.kind === 'body-weight' && m.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length > 1) {
    const unit = weights.at(-1)!.entered.unit;
    out.push({
      id: 'weight',
      label: 'Body weight',
      value: `${weightIn(weights.at(-1)!, unit)} ${unit}`,
      detail: `${weightIn(weights[0], unit)} ${unit} on ${displayDate(weights[0].date)}`,
    });
  }
  return out;
}

export type WeekCount = { weekStart: string; cleared: number; current: boolean };

/** Cleared days in each of the last `weeks` Monday-to-Sunday weeks, oldest first. */
export function clearedByWeek(state: State, today: string, weeks = 6): WeekCount[] {
  const thisWeek = weekStartOf(today);
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = shiftDate(thisWeek, (i - weeks + 1) * 7);
    let cleared = 0;
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(weekStart, d);
      if (date <= today && dayOutcome(state, date) === 'cleared') cleared += 1;
    }
    return { weekStart, cleared, current: weekStart === thisWeek };
  });
}

/**
 * The first date the long view reads: the earliest saved day, finished workout, money check-in or
 * weigh-in on or before today; null with none.
 */
export function startedOn(state: State, today: string): string | null {
  const dates = [
    ...Object.keys(state.days),
    ...state.workoutSessions.filter((s) => s.status === 'completed').map((s) => s.date),
    ...state.moneyReviews.map((r) => r.date),
    ...state.measurements.filter((m) => m.kind === 'body-weight').map((m) => m.date),
  ].filter((d) => d <= today);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Earlier full weeks needed before last week can be called the best since the start. */
const BEST_AFTER = 2;

/**
 * How far you've come's headline: last week's cleared days, set only against the user's own
 * earlier weeks since the first saved day. It names a best week, a week matching the best or a rise
 * on the week before; otherwise it gives last week's count alone, and with nothing cleared last week
 * there is no headline, so a quiet week is never the first thing said.
 */
export function weekHeadline(state: State, today: string): string | null {
  const saved = Object.keys(state.days).filter((d) => d <= today);
  if (!saved.length) return null;
  const first = weekStartOf(saved.reduce((a, b) => (a < b ? a : b)));
  const lastWeek = shiftDate(weekStartOf(today), -7);
  if (first > lastWeek) return null;
  const count = (weekStart: string) => {
    let n = 0;
    for (let d = 0; d < 7; d++)
      if (dayOutcome(state, shiftDate(weekStart, d)) === 'cleared') n += 1;
    return n;
  };
  const earlier: number[] = [];
  for (let w = first; w < lastWeek; w = shiftDate(w, 7)) earlier.push(count(w));
  const last = count(lastWeek);
  if (!last) return null;
  const days = `${last} ${last === 1 ? 'day' : 'days'} cleared last week`;
  if (!earlier.length) return `${last} ${last === 1 ? 'day' : 'days'} cleared in your first week.`;
  const best = Math.max(...earlier);
  if (earlier.length >= BEST_AFTER && last > best)
    return `${days}, your best week since you started.`;
  if (earlier.length >= BEST_AFTER && last === best) return `${days}, matching your best week.`;
  const before = earlier.at(-1)!;
  // An empty week before is never named: "up from 0" would put it forward.
  if (before > 0 && last > before) return `${days}, up from ${before} the week before.`;
  return `${days}.`;
}
