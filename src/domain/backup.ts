import { decodeState } from './data';
import { State, localDate } from './model';
import { occupied, overlaps } from './planner';
import { isTimestamp } from './records';

export const MAX_BACKUP_BYTES = 20_000_000;
/**
 * Backup format 5 carries state version 5 (format 2 added personal records, format 3 timed circuits,
 * format 4 the focus, weekly reviews and skill checkpoints, format 5 the trading sessions). Format
 * 1–4 files still restore and upgrade with the newer records empty. Builds that only know an older
 * format reject a newer one outright, so they can never restore a file while silently dropping its
 * records.
 */
export const BACKUP_VERSION = 5;
export type Backup = { format: 'life-os-backup'; version: 5; createdAt: string; state: State };

/**
 * The backup's file name: `LifeOS-backup-` with the local date and time it was made
 * (`LifeOS-backup-2026-10-15-0800.json`), so the right file can be picked in Files.
 */
export function backupName(now = new Date()): string {
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `LifeOS-backup-${localDate(now)}-${time}.json`;
}

export function checkJsonSize(raw: string, maxBytes: number, label: string): void {
  let bytes = 0;
  if (raw.length <= maxBytes) {
    for (const point of raw) {
      const code = point.codePointAt(0)!;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (bytes > maxBytes) break;
    }
  } else bytes = maxBytes + 1;
  if (bytes > maxBytes) throw new Error(`Choose a ${label} file under ${maxBytes / 1_000_000} MB.`);
}
function timestamp(value: unknown): asserts value is string {
  if (!isTimestamp(value)) throw new Error('The backup contains an invalid timestamp.');
}
function validateBackupState(input: unknown): State {
  const state = decodeState(input);
  for (const day of Object.values(state.days)) {
    if (day.commitmentsKey !== undefined && typeof day.commitmentsKey !== 'string')
      throw new Error('The backup contains an invalid plan fingerprint.');
    for (const block of day.blocks) if (block.actualAt !== null) timestamp(block.actualAt);
    const active = day.blocks.filter(occupied).sort((a, b) => a.start! - b.start!);
    for (let i = 1; i < active.length; i++)
      if (overlaps(active[i - 1], active[i]))
        throw new Error('The backup contains overlapping active blocks.');
    if (day.protection) timestamp(day.protection.at);
    for (const revision of day.revisions) {
      timestamp(revision.at);
      const ids = new Set<string>();
      for (const block of revision.blocks) {
        if (ids.has(block.id)) throw new Error('The backup contains duplicate historical blocks.');
        ids.add(block.id);
        if (block.actualAt !== null) timestamp(block.actualAt);
      }
    }
  }
  return state;
}
// Three things belong to this installation and never travel in a backup. The public Day Cleared
// widget and live trading are choices made on this phone: a restore leaves both off until the user
// turns them on again (also for files written before this rule), so live trading is turned on only
// by its own switch, with the money question asked again. Nor does a backup carry the time of the
// last export: a restored history is as safe as the backup it came from, so restoring records that
// backup's own time instead (`restoredState`).
export function withoutInstallationChoices(state: State): State {
  const live = state.ruleBooks.some((b) => b.trading?.liveTrading !== undefined);
  if (
    !live &&
    state.settings.widgetDayStatus === undefined &&
    state.settings.lastBackupAt === undefined
  )
    return state;
  const settings = { ...state.settings };
  delete settings.widgetDayStatus;
  delete settings.lastBackupAt;
  const ruleBooks = live
    ? state.ruleBooks.map((book) => {
        if (book.trading?.liveTrading === undefined) return book;
        const trading = { ...book.trading };
        delete trading.liveTrading;
        return { ...book, trading };
      })
    : state.ruleBooks;
  return { ...state, settings, ruleBooks };
}

export function encodeBackup(state: State, createdAt = new Date().toISOString()): string {
  timestamp(createdAt);
  const backup: Backup = {
    format: 'life-os-backup',
    version: BACKUP_VERSION,
    createdAt,
    state: withoutInstallationChoices(validateBackupState(state)),
  };
  const raw = JSON.stringify(backup);
  try {
    checkJsonSize(raw, MAX_BACKUP_BYTES, 'backup');
  } catch {
    // Exporting, not choosing a file: say what happened rather than "choose a file under 20 MB".
    throw new Error(
      'Your saved history is larger than the 20 MB backup limit, so it cannot be exported yet. Nothing was changed.',
    );
  }
  return raw;
}
/** A parsed backup, plus the format it was written in (1 means before personal records existed). */
export type ParsedBackup = Backup & { sourceVersion: 1 | 2 | 3 | 4 | 5 };

/** What a restore saves: the backup's state, with the backup's own time as the last backup. */
export function restoredState(backup: ParsedBackup): State {
  return {
    ...backup.state,
    settings: { ...backup.state.settings, lastBackupAt: backup.createdAt },
  };
}

/**
 * What to do after a restore, in order: what the backup cannot bring back to this phone. Widgets,
 * notification permission and the two installation choices (`withoutInstallationChoices`) are
 * set on the phone itself; live trading is named only where the restored data has a trading
 * rulebook.
 */
export function afterRestore(restored: State): string[] {
  return [
    'Add the Life OS widgets to your Home Screen and Lock Screen again if they are gone.',
    "The widget's Day Cleared status is off: turn it on in Settings if you want it.",
    "After a reinstall or on a new phone, allow notifications for Life OS in the iPhone's Settings so reminders arrive.",
    ...(restored.ruleBooks.some((b) => b.trading)
      ? [
          'Live trading is off: turn it on again in Your limits if you trade live. It asks the money question again, and for a live account you already trade, its confirmation.',
        ]
      : []),
  ];
}

export function parseBackup(raw: string): ParsedBackup {
  checkJsonSize(raw, MAX_BACKUP_BYTES, 'backup');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This backup is not valid JSON. Your saved data has not changed.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Choose a Life OS backup file.');
  const backup = value as Record<string, unknown>;
  if (backup.format !== 'life-os-backup' || ![1, 2, 3, 4, 5].includes(backup.version as number))
    throw new Error(
      'Choose a supported Life OS backup (version 1 to 5). Setup files are imported separately.',
    );
  // Each format carries exactly its own state version: a format-1 file claiming version-2 state (or
  // the reverse) is malformed, not something to guess about.
  const state = backup.state as Record<string, unknown> | null;
  if (!state || typeof state !== 'object' || state.version !== backup.version)
    throw new Error(
      'This backup does not match its stated version. Your saved data has not changed.',
    );
  timestamp(backup.createdAt);
  return {
    format: 'life-os-backup',
    version: BACKUP_VERSION,
    createdAt: backup.createdAt,
    state: withoutInstallationChoices(validateBackupState(backup.state)),
    sourceVersion: backup.version as 1 | 2 | 3 | 4 | 5,
  };
}
