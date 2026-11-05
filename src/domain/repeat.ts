import { Routine, dateObject, daysBetween, weekStartOf } from './model';

// Repeats: a routine can come up every N weeks on its weekdays, for things like a haircut every
// three weeks or a measurement every other Sunday. Weeks run Monday to Sunday and are counted from
// the week of `anchor`, which is always an "on" week. Missing an occurrence never shifts the pattern.

export const MAX_REPEAT_WEEKS = 12;

/** Whether a date falls in one of the routine's repeat weeks (always true without a repeat). */
export function inRepeatWeek(routine: Pick<Routine, 'repeat'>, date: string): boolean {
  const repeat = routine.repeat;
  if (!repeat || repeat.everyWeeks <= 1) return true;
  const weeks = daysBetween(weekStartOf(repeat.anchor), weekStartOf(date)) / 7;
  return ((weeks % repeat.everyWeeks) + repeat.everyWeeks) % repeat.everyWeeks === 0;
}

/** The one weekday rule: the routine's weekdays include this date's, in a repeat week. */
export function onItsDays(routine: Pick<Routine, 'weekdays' | 'repeat'>, date: string): boolean {
  return !!routine.weekdays?.includes(dateObject(date).getDay()) && inRepeatWeek(routine, date);
}

/** "Every 3 weeks" or null for a weekly routine. */
export function repeatText(routine: Pick<Routine, 'repeat'>): string | null {
  const every = routine.repeat?.everyWeeks ?? 1;
  return every > 1 ? `Every ${every} weeks` : null;
}

/** A repeat read back from storage or a setup file. Throws on anything else. */
export function validateRepeat(raw: unknown, routine: { study?: unknown; bundledInto?: unknown }) {
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object') throw new Error('Invalid repeat.');
  const { everyWeeks, anchor } = raw as { everyWeeks?: unknown; anchor?: unknown };
  if (
    !Number.isInteger(everyWeeks) ||
    (everyWeeks as number) < 1 ||
    (everyWeeks as number) > MAX_REPEAT_WEEKS
  )
    throw new Error(`Repeat every 1 to ${MAX_REPEAT_WEEKS} weeks.`);
  if (typeof anchor !== 'string') throw new Error('Invalid repeat.');
  dateObject(anchor);
  // Study keeps its own dated schedule and bundled steps follow their parent's days.
  if (
    routine.study !== undefined ||
    (routine.bundledInto !== null && routine.bundledInto !== undefined)
  )
    throw new Error('A study objective or a bundled step cannot repeat every few weeks.');
}
