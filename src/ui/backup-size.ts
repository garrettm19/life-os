import { encodeBackup, utf8Bytes } from '../domain/backup';
import { State } from '../domain/model';

/**
 * The backup's size as last measured in this run of the app, for Today's housekeeping line. It is
 * measured only when Backup or Settings opens, never on a save, and is never stored.
 */
let measured: number | null = null;

export function measuredBackupBytes(): number | null {
  return measured;
}

/** Measures the backup the state would export, keeps the size for this run and returns it. */
export function measureBackup(state: State): number {
  measured = utf8Bytes(encodeBackup(state));
  return measured;
}
