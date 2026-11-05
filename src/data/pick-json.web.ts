import * as DocumentPicker from 'expo-document-picker';
import { checkJsonSize } from '../domain/backup';

export async function pickJson(maxBytes: number, label: string): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    base64: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if ((asset.size ?? 0) > maxBytes)
    throw new Error(`Choose a ${label} file under ${maxBytes / 1_000_000} MB.`);
  if (!asset.file)
    throw new Error('This browser could not read the selected file. Try another browser.');
  const raw = await asset.file.text();
  checkJsonSize(raw, maxBytes, label);
  return raw;
}
