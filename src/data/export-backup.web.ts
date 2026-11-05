import { backupName, checkJsonSize, MAX_BACKUP_BYTES } from '../domain/backup';

/** Downloads the backup. The download has started once this returns, so the export is `confirmed`. */
export async function exportBackup(raw: string): Promise<{ notice: string; confirmed: boolean }> {
  checkJsonSize(raw, MAX_BACKUP_BYTES, 'backup');
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = backupName();
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return {
    notice: 'Backup download started. Keep the file somewhere you can recover it.',
    confirmed: true,
  };
}
