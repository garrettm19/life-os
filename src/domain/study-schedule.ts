import { Routine, StudySchedule } from './model';

/**
 * Keeps the study plan's record of its schedule current after a routine edit made on `date`: the
 * starting date is set if missing, and a change of days or of pausing adds an entry from that date
 * (a second change the same day replaces that day's entry). Earlier entries are never rewritten.
 */
export function recordStudySchedule(
  previous: Routine | undefined,
  next: Routine,
  date: string,
): Routine {
  if (!next.study) return next;
  const current = {
    weekdays: [...(next.weekdays ?? [])].sort((a, b) => a - b),
    enabled: next.enabled,
  };
  const trackFrom = next.study.trackFrom ?? previous?.study?.trackFrom ?? date;
  const schedule = [...(next.study.schedule ?? previous?.study?.schedule ?? [])];
  const last = schedule.at(-1);
  const same =
    last &&
    last.enabled === current.enabled &&
    last.weekdays.join(',') === current.weekdays.join(',');
  if (!same) {
    // Each entry starts on the day it was set: earlier days are never given a schedule after the fact.
    const from = date;
    if (last?.from === from) schedule.pop();
    schedule.push({ from, ...current });
  }
  return { ...next, study: { ...next.study, trackFrom, schedule } };
}

/** The study schedule in effect on a date, or null when none was recorded by then. */
export function scheduleOn(routine: Routine, date: string): StudySchedule | null {
  const entries = routine.study?.schedule ?? [];
  let found: StudySchedule | null = null;
  for (const e of entries) if (e.from <= date) found = e;
  return found;
}
