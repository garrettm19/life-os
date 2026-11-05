import Storage from 'expo-sqlite/kv-store';
import { TRADING_PREFIX } from '../state/session-store';

// Earlier builds kept each day's trading session on this device only, under
// `life-os-trading-session:<date>`. The sessions now live in the saved data; these records are read
// once to move them in (`importDeviceSessions`) and are never written or deleted.

/**
 * Every trading session record earlier builds kept on this device: its date and its text exactly
 * as stored. A storage failure throws: it is not "none".
 */
export async function readDeviceSessions(): Promise<[string, string][]> {
  const keys = (await Storage.getAllKeysAsync()).filter((k) => k.startsWith(TRADING_PREFIX));
  const records: [string, string][] = [];
  for (const key of keys) {
    const text = await Storage.getItemAsync(key);
    if (text !== null) records.push([key.slice(TRADING_PREFIX.length), text]);
  }
  return records;
}
