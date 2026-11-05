import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { checkJsonSize } from '../domain/backup';

export async function pickJson(maxBytes: number, label: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    if (Math.max(asset.size ?? 0, file.size ?? 0) > maxBytes)
      throw new Error(`Choose a ${label} file under ${maxBytes / 1_000_000} MB.`);
    const raw = await file.text();
    checkJsonSize(raw, maxBytes, label);
    return raw;
  } finally {
    const root = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri + '/';
    if (file.uri.startsWith(root) && file.exists) file.delete();
  }
}
