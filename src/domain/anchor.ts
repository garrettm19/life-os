import { Block, Day, Routine, State, displayTime, localDate, shiftDate } from './model';
import { onItsDays } from './repeat';

// The morning anchor: one checklist routine the user times ("Up by 7:10 AM") and ticks. It is
// an ordinary checklist objective, so Day Cleared, the streak and the widget read it as any other.
// What is added here is only a reading of its ticks: on time means ticked no later than
// ON_TIME_GRACE minutes after the anchor time in force that day (earlier always counts), judged on
// the local clock of the day. Every caption on Today and every figure on Progress's Mornings card
// comes from these functions. The wording says "ticked", never "woke": a tick is not waking up, and
// sleep is never tracked or inferred. A morning that was not on time is never called missed and is
// never counted out loud.

/** Minutes after the anchor time that still count as on time. */
export const ON_TIME_GRACE = 15;
/** The rolling count: the last seven mornings, so it never drops to nothing on a Monday. */
const RECENT_DAYS = 7;

/**
 * on-time: ticked (or corrected to) no later than the window. late: ticked after it. open: today,
 * not ticked yet. not-ticked: a past day that was opened, with the anchor left open. skipped: Skip.
 * free: the anchor was not due (not on the opened day's plan, or not on its days for a day never
 * opened). none: a day it was due that was never opened (not recorded). before: earlier than the
 * anchor's first time. Only on-time, late and not-ticked are judged mornings: the rest are neutral.
 */
export type MorningMark =
  'on-time' | 'late' | 'open' | 'not-ticked' | 'skipped' | 'free' | 'none' | 'before';

export type Morning = {
  date: string;
  mark: MorningMark;
  /** The anchor time in force that day, or null before the first one. */
  upBy: number | null;
  /** The tick (or corrected) time in minutes after that day's local midnight; null when not known. */
  at: number | null;
  /** The time is the user's correction ("I was up at"), not the tick. */
  corrected: boolean;
};

/**
 * Whether a routine can carry the morning anchor: a plain checklist item, ticked once and
 * recording nothing else, so no study plan, record type, workout plan or circuit, not bundled into
 * another routine and not a rotation workout (the rotation decides its days). The decoder, a setup
 * import and Programs all read this one rule.
 */
export function canCarryAnchor(
  routine: Pick<Routine, 'id' | 'checklist' | 'study' | 'capture' | 'bundledInto'>,
  state: Pick<State, 'programs' | 'workoutTemplates' | 'intervalRoutines'>,
): boolean {
  return (
    routine.checklist === true &&
    routine.study === undefined &&
    routine.capture === undefined &&
    (routine.bundledInto ?? null) === null &&
    !state.workoutTemplates.some((t) => t.routineId === routine.id) &&
    !state.intervalRoutines.some((c) => c.routineId === routine.id) &&
    !state.programs.some((p) => p.rotation?.order.includes(routine.id))
  );
}

/** The enabled routine that is the morning anchor, or null. */
export function anchorRoutine(state: State): Routine | null {
  for (const p of state.programs)
    for (const r of p.routines) if (r.enabled && r.anchor?.history.length) return r;
  return null;
}

/** The first date the anchor reads. */
export function anchorSince(routine: Routine): string | null {
  return routine.anchor?.history[0]?.from ?? null;
}

/** The anchor time in force on a date: the last entry from that date or earlier. */
export function upByOn(routine: Routine, date: string): number | null {
  let found: number | null = null;
  for (const e of routine.anchor?.history ?? []) if (e.from <= date) found = e.upBy;
  return found;
}

/** The anchor time set now (the last entry), or null without an anchor. */
export function currentUpBy(routine: Routine): number | null {
  return routine.anchor?.history.at(-1)?.upBy ?? null;
}

/**
 * The routine with its anchor time set to `upBy` on `date`. A first time reads from `from` (today,
 * or the first tick when the user chose to count earlier mornings); a later change adds an entry
 * from `date` (a second change the same day replaces that day's entry), so a morning already judged
 * is never judged again by another time. A first time counted from earlier mornings is kept for
 * them even when it is changed the same day: the history does not say when it was saved, so a
 * change cannot tell a typo from a later change. Ending the anchor and setting it again corrects it.
 */
export function withAnchorTime(
  routine: Routine,
  upBy: number,
  date: string,
  from: string = date,
): Routine {
  if (!Number.isInteger(upBy) || upBy < 0 || upBy > 1439)
    throw new Error('Enter the Up by time as 24-hour time, for example 07:10.');
  const history = [...(routine.anchor?.history ?? [])];
  const last = history.at(-1);
  if (last?.upBy === upBy) return routine;
  if (!last) history.push({ from: from <= date ? from : date, upBy });
  else if (last.from >= date) history[history.length - 1] = { from: last.from, upBy };
  else history.push({ from: date, upBy });
  return { ...routine, anchor: { history } };
}

/** The anchor's block on a day, if the day holds one. */
function anchorBlock(day: Day | undefined, routineId: string): Block | undefined {
  return day?.blocks.find((b) => b.routineId === routineId);
}

/** The first date before `before` on which the routine was ticked, for counting earlier mornings. */
export function firstTick(state: State, routineId: string, before: string): string | null {
  const dates = Object.keys(state.days)
    .filter((d) => d < before)
    .sort();
  for (const d of dates) if (anchorBlock(state.days[d], routineId)?.status === 'done') return d;
  return null;
}

/** Minutes after local midnight of `date` for a tick, or null when it was ticked on another day. */
function tickMinutes(actualAt: string | null, date: string): number | null {
  if (!actualAt) return null;
  const at = new Date(actualAt);
  if (Number.isNaN(at.getTime()) || localDate(at) !== date) return null;
  return at.getHours() * 60 + at.getMinutes();
}

/** One morning, read from its stored day against the anchor time in force that day. */
export function morningOn(state: State, routine: Routine, date: string, today: string): Morning {
  const upBy = upByOn(routine, date);
  const base = { date, upBy, at: null, corrected: false };
  if (upBy === null) return { ...base, mark: 'before' };
  const day = state.days[date];
  // A day not opened is a morning only when it falls on the anchor's days; otherwise it is free, as
  // an opened day without the anchor is.
  if (!day)
    return { ...base, mark: !onItsDays(routine, date) ? 'free' : date >= today ? 'open' : 'none' };
  const block = anchorBlock(day, routine.id);
  if (!block) return { ...base, mark: 'free' };
  if (block.status === 'skipped') return { ...base, mark: 'skipped' };
  if (block.status === 'planned') return { ...base, mark: date >= today ? 'open' : 'not-ticked' };
  const corrected = block.upAt !== undefined;
  const at = corrected ? block.upAt! : tickMinutes(block.actualAt, date);
  // A tick recorded on a later day (a past day marked done afterwards), or with no time, is not
  // judged on time: it reads as ticked after the window.
  const onTime = at !== null && at <= upBy + ON_TIME_GRACE;
  return { date, upBy, at, corrected, mark: onTime ? 'on-time' : 'late' };
}

/**
 * The rolling count: on-time mornings in the last seven days, through today once today is ticked,
 * otherwise through yesterday, so an unticked morning is not counted before it is over. `days`
 * counts only judged mornings (on time, after the window or not ticked): a day before the anchor,
 * not due, skipped or never opened is neutral and left out.
 */
export function recentMornings(
  state: State,
  routine: Routine,
  today: string,
): { onTime: number; days: number } {
  const todays = morningOn(state, routine, today, today).mark;
  const end = todays === 'on-time' || todays === 'late' ? today : shiftDate(today, -1);
  let onTime = 0,
    days = 0;
  for (let i = 0; i < RECENT_DAYS; i++) {
    const m = morningOn(state, routine, shiftDate(end, -i), today);
    if (!judged(m.mark)) continue;
    days++;
    if (m.mark === 'on-time') onTime++;
  }
  return { onTime, days };
}

/** A morning that is read for or against the count; every other mark is neutral. */
function judged(mark: MorningMark): boolean {
  return mark === 'on-time' || mark === 'late' || mark === 'not-ticked';
}

/**
 * Whether `date`'s on-time tick follows a morning that was not on time: the latest earlier judged
 * morning was ticked after the window or left open. A day not due, skipped or never opened is
 * passed over, as it is neutral. The first morning of the anchor is never "back".
 */
export function backOnTime(state: State, routine: Routine, date: string, today: string): boolean {
  if (morningOn(state, routine, date, today).mark !== 'on-time') return false;
  for (let i = 1; i <= 60; i++) {
    const m = morningOn(state, routine, shiftDate(date, -i), today);
    if (m.mark === 'before') return false;
    if (!judged(m.mark)) continue;
    return m.mark !== 'on-time';
  }
  return false;
}

/**
 * Whether the routine's own title already gives its time ("Up by 7:10"), so the caption need not
 * repeat it under the title.
 */
function titleHasTime(routine: Routine, upBy: number): boolean {
  return routine.title.includes(displayTime(upBy).replace(/\s?[AP]M$/, ''));
}

/**
 * The caption under the anchor on Today, the one place a morning is worded there. Before the tick:
 * "Up by 7:10 AM", with "· on time 5 of the last 7" today when at least one recent morning was on
 * time; when the title already gives the time ("Up by 7:10") the caption leaves it out, so it reads
 * "On time 5 of the last 7", or nothing until a morning was on time. Once
 * ticked: "Ticked 7:06 AM" whether on time or not, in the same color; "Back on time · 7:06 AM" for
 * the first on-time tick after a morning that was not. A correction reads "Up at 7:05 AM ·
 * corrected" ("Back on time · up at 7:05 AM · corrected" when it is also back). Never a zero, never
 * "missed". Null before the anchor began, so the row keeps its usual caption.
 */
export function anchorCaption(
  state: State,
  routine: Routine,
  date: string,
  today: string,
): string | null {
  const m = morningOn(state, routine, date, today);
  if (m.upBy === null || m.mark === 'free') return null;
  if (m.mark === 'skipped') return 'Skipped';
  if (m.mark === 'on-time' || m.mark === 'late') {
    const time = m.at === null ? null : displayTime(m.at);
    if (m.mark === 'on-time' && time && backOnTime(state, routine, date, today))
      return m.corrected ? `Back on time · up at ${time} · corrected` : `Back on time · ${time}`;
    if (m.corrected && time) return `Up at ${time} · corrected`;
    return time ? `Ticked ${time}` : 'Ticked';
  }
  const upBy = titleHasTime(routine, m.upBy) ? null : `Up by ${displayTime(m.upBy)}`;
  const recent = date === today ? recentMornings(state, routine, today) : null;
  const count =
    recent && recent.onTime >= 1 ? `on time ${recent.onTime} of the last ${recent.days}` : null;
  if (!count) return upBy;
  return upBy ? `${upBy} · ${count}` : count[0].toUpperCase() + count.slice(1);
}

/**
 * The day with the anchor's tick corrected to `upAt` ("I was up at"), or the correction removed
 * with null. Only a done tick can be corrected, and only to a time no later than the tick.
 */
export function correctMorning(day: Day, blockId: string, upAt: number | null): Day {
  const block = day.blocks.find((b) => b.id === blockId);
  if (!block || block.status !== 'done') throw new Error('Tick it first, then correct the time.');
  if (upAt !== null) {
    if (!Number.isInteger(upAt) || upAt < 0 || upAt > 1439)
      throw new Error('Enter the time as 24-hour time, for example 07:05.');
    const ticked = tickMinutes(block.actualAt, day.date);
    if (ticked !== null && upAt > ticked) throw new Error('Enter a time before the tick.');
  }
  return {
    ...day,
    blocks: day.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const next: Block = { ...b };
      if (upAt === null) delete next.upAt;
      else next.upAt = upAt;
      return next;
    }),
  };
}
