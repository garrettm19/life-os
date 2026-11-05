import { Block, Routine, State, dateObject, displayDate, shiftDate } from './model';
import { scheduleOn } from './study-schedule';

// The study streak: consecutive scheduled study days completed, derived from dated records every
// time (never stored), so Undo or a past-day edit recalculates it. It is separate from the Day
// Clear streak and stricter: from its starting date, a scheduled study day that was skipped, left
// open or never opened breaks it, because study is a commitment for that day. Whether a
// never-opened day was a study day comes from the schedule recorded for that date, never from
// today's settings. A protected day or a day the objective was moved away from holds it without
// counting; today is in progress until it is done (or explicitly skipped). Days before the starting
// date are never scored. An optional occurrence counts once done and is never a miss: left
// open or skipped, its day is not scored.

export type StudyDayResult = 'kept' | 'missed' | 'held';
export type StudyStreak = {
  current: number;
  best: number;
  /** The first scored date, or null when tracking has not started. */
  since: string | null;
  /** Today's state: kept (done), missed (skipped), or open. */
  today: 'kept' | 'missed' | 'open';
  /** The starting date is still ahead (for example after a clock or time-zone change). */
  later: boolean;
  /** Today is a study day (on the plan, or scheduled). */
  todayDue: boolean;
};

/**
 * Where scoring starts: the plan's explicit starting date, set when the objective became a study
 * objective. Without one nothing is scored, so no earlier day is ever counted.
 */
function streakStart(routine: Routine): string | null {
  return routine.study?.trackFrom ?? null;
}

/** The study objective's occurrence on a date: the required one, or else an optional one. */
export function studyOccurrence(state: State, routine: Routine, date: string): Block | undefined {
  const blocks = state.days[date]?.blocks.filter((b) => b.routineId === routine.id) ?? [];
  return blocks.find((b) => !b.optional) ?? blocks.find((b) => b.optional);
}

/** One scored date before today. */
export function studyDayResult(
  state: State,
  routine: Routine,
  date: string,
): StudyDayResult | null {
  const day = state.days[date];
  const block = studyOccurrence(state, routine, date);
  if (block?.status === 'done') return 'kept';
  if (day?.protection) return 'held';
  // An optional occurrence never counts against anything: not done, the day is not scored.
  if (block?.optional) return null;
  if (block) return 'missed';
  if (day?.moved?.some((m) => m.routineId === routine.id)) return 'held';
  // No occurrence recorded: a miss only if the schedule recorded for that date made it a study day
  // (the day was never opened, so nothing was completed). Without a recorded schedule, never a miss.
  // The schedule does not record optional, so a never-opened day is read the same either way.
  const schedule = scheduleOn(routine, date);
  const scheduled =
    !!schedule && schedule.enabled && schedule.weekdays.includes(dateObject(date).getDay());
  return scheduled ? 'missed' : null;
}

export function studyStreak(state: State, routine: Routine, today: string): StudyStreak {
  const since = streakStart(routine);
  const todayBlock = studyOccurrence(state, routine, today);
  // A skip on a protected day holds, as it will once the day is past; an optional skip is never a miss.
  const todayState =
    todayBlock?.status === 'done'
      ? 'kept'
      : todayBlock?.status === 'skipped' && !todayBlock.optional && !state.days[today]?.protection
        ? 'missed'
        : 'open';
  const schedule = scheduleOn(routine, today);
  const todayDue =
    !!todayBlock ||
    (schedule
      ? schedule.enabled && schedule.weekdays.includes(dateObject(today).getDay())
      : routine.enabled && !!routine.weekdays?.includes(dateObject(today).getDay()));
  if (!since || since > today)
    return {
      current: 0,
      best: 0,
      since,
      today: todayState,
      later: !!since && since > today,
      todayDue,
    };
  let run = 0;
  let best = 0;
  for (let date = since; date < today; date = shiftDate(date, 1)) {
    const result = studyDayResult(state, routine, date);
    if (result === 'kept') best = Math.max(best, ++run);
    else if (result === 'missed') run = 0;
  }
  // Today counts once done; an explicit skip today ends the run; otherwise it is still in progress.
  if (todayState === 'kept') best = Math.max(best, ++run);
  else if (todayState === 'missed') run = 0;
  return { current: run, best, since, today: todayState, later: false, todayDue };
}

/** "Study streak 5 · best 9", or how to start one, in plain words without blame. */
export function studyStreakLine(streak: StudyStreak): string {
  if (!streak.since) return 'Study streak not started';
  if (streak.later) return `Study streak starts ${displayDate(streak.since)}`;
  // After a broken run, the line looks forward while today is still open; the best stays as it was.
  if (streak.current === 0)
    return !streak.best
      ? 'Study streak starts today'
      : streak.today === 'open' && streak.todayDue
        ? `New streak starts today · best ${streak.best}`
        : `Study streak 0 · best ${streak.best}`;
  return `Study streak ${streak.current} · best ${streak.best}`;
}
