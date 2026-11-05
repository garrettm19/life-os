import { withDay } from './data';
import { ActivitySession, State, dateObject, localDate, shiftDate, weekStartOf } from './model';
import { setStatus } from './planner';
import { validateActivitySessions } from './records';

// Duration activities (for example cardio): what was done and for how long. Saving one for an
// objective completes it in the same state change.

export type ActivityInput = {
  id?: string;
  date: string;
  activity: string;
  minutes: number;
  note: string;
  routineId: string | null;
  occurrence?: { date: string; blockId: string };
};

/** Whole minutes from typed text; refuses anything that is not 1–1440. */
export function parseMinutes(text: string): number {
  const value = Number(text.trim());
  if (!/^\d{1,4}$/.test(text.trim()) || value < 1 || value > 1440)
    throw new Error('Enter the minutes you did, from 1 to 1440.');
  return value;
}

export function recordActivity(
  state: State,
  input: ActivityInput,
  newId: string,
  at: string,
): State {
  dateObject(input.date);
  if (input.date > localDate(new Date(at)))
    throw new Error('An activity can be recorded for today or an earlier day.');
  if (!input.activity.trim()) throw new Error('Choose what you did.');
  const existing = input.id ? state.activitySessions.find((a) => a.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('This activity no longer exists.');
  const occurrenceId = input.occurrence?.blockId ?? existing?.occurrenceId ?? null;
  if (
    occurrenceId &&
    state.activitySessions.some((a) => a.occurrenceId === occurrenceId && a.id !== existing?.id)
  )
    throw new Error('This objective already has an activity. Edit that one instead.');
  const session: ActivitySession = {
    id: existing?.id ?? newId,
    date: input.date,
    at: existing?.at ?? at,
    routineId: input.routineId,
    occurrenceId,
    activity: input.activity.trim(),
    minutes: input.minutes,
    note: input.note.trim(),
  };
  const activitySessions = existing
    ? state.activitySessions.map((a) => (a.id === existing.id ? session : a))
    : [...state.activitySessions, session];
  validateActivitySessions(activitySessions);
  let next: State = { ...state, activitySessions };
  if (input.occurrence) {
    const day = next.days[input.occurrence.date];
    const block = day?.blocks.find((b) => b.id === input.occurrence!.blockId);
    if (!day || !block) throw new Error('This objective is no longer on the plan.');
    if (block.status !== 'done') next = withDay(next, setStatus(day, block.id, 'done', at));
  }
  return next;
}

/**
 * Minutes recorded per week (Monday to Sunday) for the last `weeks` weeks, oldest first. Without a
 * routine it totals activities only: study sessions are counted with their own routine, never as
 * cardio.
 */
export function weeklyMinutes(
  state: State,
  today: string,
  weeks = 4,
  routineId: string | null = null,
): { weekStart: string; minutes: number; sessions: number }[] {
  const monday = weekStartOf(today);
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = shiftDate(monday, -7 * (weeks - 1 - i));
    const weekEnd = shiftDate(weekStart, 6);
    const inWeek = state.activitySessions.filter(
      (a) =>
        a.date >= weekStart &&
        a.date <= weekEnd &&
        (routineId === null ? !a.study : a.routineId === routineId),
    );
    return {
      weekStart,
      minutes: inWeek.reduce((sum, a) => sum + a.minutes, 0),
      sessions: inWeek.length,
    };
  });
}
