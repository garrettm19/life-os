import { Routine, State, dateObject, localDate, shiftDate } from './model';
import { StudyRun, phaseAt, stageEndsAt } from './study';

// Local study reminders, planned from saved state only, and scheduled on the device (no server).
//
// - The daily study reminder repeats on each scheduled weekday at the chosen time (a weekly
//   calendar trigger: one pending request per weekday that iOS repeats on its own), so it keeps
//   arriving for as long as it is on, even if Life OS is never opened. It is a general reminder: it
//   also arrives on a day already studied, because iOS cannot skip one occurrence of a repeat and
//   reliability matters more than silencing it. At most seven pending requests per study routine.
// - The evening reminder is conditional ("still open"): one-off notifications for open days in a
//   rolling window, scheduled each time the app runs. If the app is not opened for that long, it
//   stops; the app says so.
// Scheduling them needs the user's notification permission and happens elsewhere.

/** How many days ahead conditional (evening) reminders are scheduled. */
export const REMINDER_DAYS = 7;
/** iOS keeps at most 64 pending notifications per app; stay below it, leaving room for alerts. */
export const MAX_REMINDERS = 60;
/**
 * Identifier prefixes, so only Life OS study notifications are ever replaced or canceled. Every
 * study reminder (including the one-off ones of earlier builds) starts with `study:`.
 */
export const REMINDER_PREFIX = 'study:';
export const STAGE_PREFIX = 'study-stage:';

export type PlannedReminder = {
  id: string;
  title: string;
  body: string;
  /** A one-off notification at this wall-clock time (ms), or null for a weekly repeat. */
  at: number | null;
  /** A repeat every week on this weekday (0 = Sunday) at this local time, or null. */
  weekly: { weekday: number; hour: number; minute: number } | null;
};

/** Whether the study routine is still open on a date: due, and not already done, skipped or protected. */
export function studyOpenOn(state: State, routine: Routine, date: string): boolean {
  if (!routine.enabled || routine.bundledInto) return false;
  const day = state.days[date];
  if (day?.protection) return false;
  const block = day?.blocks.find((b) => b.routineId === routine.id);
  if (block) return block.status === 'planned';
  // Moved to another day by a shift: no longer due here.
  if (day?.moved?.some((m) => m.routineId === routine.id)) return false;
  return routine.weekdays?.includes(dateObject(date).getDay()) ?? false;
}

function atLocal(date: string, minutes: number): number {
  const d = dateObject(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** The text of the daily study reminder; a private objective is never named. */
function studyReminderText(routine: Routine): { title: string; body: string } {
  return {
    title: 'Time to study',
    body: routine.private
      ? "Your study objective is on today's plan."
      : `Your ${routine.title} objective is on today's plan.`,
  };
}

/**
 * The study reminders to have scheduled now. For each enabled study routine: the daily reminder
 * as a weekly repeat per scheduled weekday at its study time, and, if chosen, an evening reminder on
 * each still-open day of the coming week. Nothing is planned unless the user turned it on. The
 * result is the same all day for the same saved state, so repeated syncs never add requests.
 */
export function studyReminders(state: State, now: number, days = REMINDER_DAYS): PlannedReminder[] {
  const today = localDate(new Date(now));
  const reminders: PlannedReminder[] = [];
  for (const routine of state.programs.flatMap((p) => p.routines)) {
    const plan = routine.study;
    if (!plan || !routine.enabled || routine.bundledInto) continue;
    const { start, evening } = plan.reminders;
    if (start && plan.at !== null) {
      const text = studyReminderText(routine);
      const hour = Math.floor(plan.at / 60);
      const minute = plan.at % 60;
      for (const weekday of [...new Set(routine.weekdays ?? [])].sort((x, y) => x - y))
        reminders.push({
          id: `${REMINDER_PREFIX}${routine.id}:weekly:${weekday}`,
          ...text,
          at: null,
          weekly: { weekday, hour, minute },
        });
    }
    if (evening !== null) {
      for (let i = 0; i < days; i++) {
        const date = shiftDate(today, i);
        if (!studyOpenOn(state, routine, date)) continue;
        const at = atLocal(date, evening);
        if (at > now)
          reminders.push({
            id: `${REMINDER_PREFIX}${routine.id}:${date}:evening`,
            title: 'Study still open',
            body: routine.private
              ? 'Your study objective is still open today.'
              : `${routine.title} is still open today.`,
            at,
            weekly: null,
          });
      }
    }
  }
  // Repeats first (they matter most), then one-offs by time; capped below the iOS limit.
  return reminders
    .sort(
      (a, b) =>
        (a.at === null ? 0 : 1) - (b.at === null ? 0 : 1) ||
        (a.at ?? 0) - (b.at ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_REMINDERS);
}

/** The notification for the running stage reaching its time, or null when nothing is running. */
export function stageAlert(
  run: StudyRun,
  routine: Routine | undefined,
  now: number,
): PlannedReminder | null {
  if (!routine?.study?.reminders.stageEnd) return null;
  const at = stageEndsAt(run, now);
  if (at === null || phaseAt(run, now) !== 'running') return null;
  const stage = run.stages[run.index];
  const next = run.stages[run.index + 1];
  return {
    id: `${STAGE_PREFIX}${run.blockId}`,
    at,
    weekly: null,
    title: routine.private ? 'Study stage complete' : `${stage.title} · time is up`,
    // A private routine's stage names never reach the lock screen.
    body: !next
      ? 'Every stage is behind. Open Life OS to review and confirm the session.'
      : routine.private
        ? 'The next stage is ready. Open Life OS to start it.'
        : `Next: ${next.title}, ${next.plannedSeconds / 60} minutes. Open Life OS to start it.`,
  };
}
