import { State, localDate, shiftDate } from './model';

// A gentle backup reminder. Everything lives on this device only, so a lost phone loses it all
// unless a backup was exported. The reminder is one quiet line on Today, never a notification, and
// only once there is something worth keeping: at least a week of recorded days.

export const BACKUP_REMINDER_DAYS = 14;
const MIN_RECORDED_DAYS = 7;

const recordedDays = (state: State) =>
  Object.values(state.days).filter((d) => d.blocks.some((b) => b.status !== 'planned')).length;

/** Whole days since the last export, or null when there has never been one. */
export function daysSinceBackup(state: State, now: Date): number | null {
  const at = state.settings.lastBackupAt;
  if (!at) return null;
  const from = localDate(new Date(at));
  const today = localDate(now);
  let days = 0;
  for (let d = from; d < today && days < 10_000; d = shiftDate(d, 1)) days++;
  return days;
}

/** The reminder's text, or null when no reminder is due. */
export function backupReminder(state: State, now: Date): string | null {
  if (state.source === 'demo' || recordedDays(state) < MIN_RECORDED_DAYS) return null;
  const since = daysSinceBackup(state, now);
  if (since === null) return 'No backup yet: export one to keep your history safe.';
  if (since < BACKUP_REMINDER_DAYS) return null;
  return `Last backup ${since} days ago: export a fresh one.`;
}

/** "Today", "Yesterday", "5 days ago" or "Never", for Settings. */
export function lastBackupText(state: State, now: Date): string {
  const since = daysSinceBackup(state, now);
  return since === null
    ? 'Never'
    : since === 0
      ? 'Today'
      : since === 1
        ? 'Yesterday'
        : `${since} days ago`;
}
