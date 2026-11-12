import { useCallback, useState } from 'react';
import { encodeBackup } from '../domain/backup';
import { exportBackup } from '../data/export-backup';
import { useApp } from '../state/app-state';

/**
 * Exporting a backup, shared by the Backup page and Today's reminder line, so both behave the same.
 * On iPhone the share sheet closes the same way after a save and a cancel, so an export is left
 * unconfirmed until the person says they saved it: only that (`confirmSaved`), or a download that
 * is known to have started (the web), records the time for the reminder.
 */
export function useBackupExport() {
  const { state, change, clearError } = useApp();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  // Only the time of the export is kept, for the backup reminder; it never travels in a backup.
  const recordBackup = useCallback(() => {
    const at = new Date().toISOString();
    return change((s) => ({ ...s, settings: { ...s.settings, lastBackupAt: at } }));
  }, [change]);
  const reset = useCallback(() => {
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
  }, []);
  const save = async () => {
    setWorking(true);
    reset();
    clearError();
    try {
      const result = await exportBackup(encodeBackup(state));
      setNotice(result.notice);
      if (result.confirmed) await recordBackup();
      else setUnconfirmed(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not export the backup. Your saved data has not changed.',
      );
    } finally {
      setWorking(false);
    }
  };
  const confirmSaved = async () => {
    setWorking(true);
    try {
      if (await recordBackup()) {
        setUnconfirmed(false);
        setNotice('Backup time recorded.');
        return true;
      }
      return false;
    } finally {
      setWorking(false);
    }
  };
  return { working, error, notice, unconfirmed, save, confirmSaved, reset };
}
