import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Hands a text file to the iOS share sheet (Save to Files, AirDrop, a chosen app). Nothing is
 * uploaded by Life OS; the temporary copy is deleted afterwards.
 */
export async function exportFile(
  name: string,
  raw: string,
  format: 'json' | 'csv',
): Promise<string> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('File export is not available on this device.');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  try {
    file.write(raw);
    await Sharing.shareAsync(file.uri, {
      mimeType: format === 'json' ? 'application/json' : 'text/csv',
      UTI: format === 'json' ? 'public.json' : 'public.comma-separated-values-text',
      dialogTitle: 'Save Life OS export',
    });
    return 'Export sheet closed. Only the destination you chose received the file.';
  } finally {
    if (file.exists) file.delete();
  }
}
