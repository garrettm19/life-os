import { MAX_BACKUP_BYTES } from './backup';
import { backupReminder } from './backup-reminder';
import { State, localDate, shiftDate, weekStartOf } from './model';
import { findRoutine } from './objectives';
import { reviewFor } from './weekly-reviews';

// The one housekeeping line on Today. At most one thing asks for a moment at a time, in this
// order: the weekly review, a backup that is due, then a backup nearing its size limit. Each is
// optional in tone, never a notification, and never shown for the demo.

/** Recorded days a week needs before a review of it is worth asking for. */
const MIN_REVIEW_DAYS = 4;

const recorded = (state: State, date: string) =>
  !!state.days[date]?.blocks.some((b) => b.status !== 'planned');

/**
 * The week whose review Today may ask for, or null: from Sunday 3 PM through Monday, for the week
 * just ending (Sunday) or just ended (Monday), as the course correction on Progress chooses it. Only
 * when that week has no review, holds at least four recorded days, and no money review is still
 * open on today's list, so the two weekly rituals never stack.
 */
export function weeklyReviewDue(state: State, now: Date): string | null {
  if (state.source === 'demo' || !state.programs.length) return null;
  const today = localDate(now);
  const thisWeek = weekStartOf(today);
  const sundayAfternoon = now.getDay() === 0 && now.getHours() >= 15;
  const monday = today === thisWeek;
  if (!sundayAfternoon && !monday) return null;
  const week = monday ? shiftDate(thisWeek, -7) : thisWeek;
  if (reviewFor(state, week) || (monday && reviewFor(state, thisWeek))) return null;
  let days = 0;
  for (let i = 0; i < 7; i++) if (recorded(state, shiftDate(week, i))) days++;
  if (days < MIN_REVIEW_DAYS) return null;
  const moneyOpen = state.days[today]?.blocks.some(
    (b) =>
      b.status === 'planned' &&
      !!b.routineId &&
      findRoutine(state.programs, b.routineId)?.capture === 'money',
  );
  return moneyOpen ? null : week;
}

/** A backup above 70% of the 20 MB limit: worth knowing before an export is refused. */
export function backupSizeWarning(bytes: number | null): boolean {
  return bytes !== null && bytes > MAX_BACKUP_BYTES * 0.7;
}

export type Housekeeping =
  | { kind: 'review'; week: string; text: string }
  | { kind: 'backup'; text: string }
  | { kind: 'size'; text: string };

/**
 * The single housekeeping line, or null. `measured` is the backup's size in bytes when Backup or
 * Settings last measured it in this run of the app; it is never measured on a save.
 */
export function housekeepingLine(
  state: State,
  now: Date,
  measured: number | null,
): Housekeeping | null {
  const week = weeklyReviewDue(state, now);
  if (week) return { kind: 'review', week, text: 'Two minutes on your week? ›' };
  const backup = backupReminder(state, now);
  if (backup) return { kind: 'backup', text: backup };
  if (state.source !== 'demo' && backupSizeWarning(measured))
    return {
      kind: 'size',
      text:
        measured! > MAX_BACKUP_BYTES
          ? 'Your backup is over its 20 MB limit ›'
          : `Your backup is ${Math.round((measured! / MAX_BACKUP_BYTES) * 100)}% of its 20 MB limit ›`,
    };
  return null;
}
