import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { backupName, checkJsonSize, MAX_BACKUP_BYTES } from '../domain/backup';

/**
 * Offers the backup through the share sheet. The sheet closes the same way after a save and after
 * a cancel, so the export is never `confirmed`: the user says whether the file was saved.
 */
export async function exportBackup(raw: string): Promise<{ notice: string; confirmed: boolean }> {
  checkJsonSize(raw, MAX_BACKUP_BYTES, 'backup');
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File export is not available on this device.');
  const file = new File(Paths.cache, backupName());
  // Names go by the minute: a copy left by an interrupted export of the same minute is replaced.
  file.create({ overwrite: true });
  try {
    file.write(raw);
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Save Life OS backup',
    });
    return {
      notice:
        'Export sheet closed. Life OS cannot tell whether the file was saved. If you saved it to Files or another destination, confirm below.',
      confirmed: false,
    };
  } finally {
    if (file.exists) file.delete();
  }
}
