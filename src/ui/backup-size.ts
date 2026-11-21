import { backupText, utf8Bytes } from '../domain/backup';
import { State } from '../domain/model';

/**
 * The backup's size as last measured in this run of the app, for Today's housekeeping line. It is
 * measured only when Backup or Settings opens, never on a save, and is never stored.
 */
let measured: number | null = null;

export function measuredBackupBytes(): number | null {
  return measured;
}

/**
 * Measures the backup the state would export, keeps the size for this run and returns it. It runs
 * while a screen renders, so it never throws: a backup over the limit is measured in full (the
 * export itself still refuses it), and a state a backup would refuse measures as null.
 */
export function measureBackup(state: State): number | null {
  try {
    measured = utf8Bytes(backupText(state));
  } catch {
    measured = null;
  }
  return measured;
}
