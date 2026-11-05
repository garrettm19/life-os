import { TRADING_PREFIX } from '../state/session-store';

// Browser preview: earlier builds kept each day's trading session in localStorage, beside the plan.
// They are read once to move them into the saved data and are never written or deleted.

/** Every trading session record earlier builds kept here: its date and its text as stored. */
export async function readDeviceSessions(): Promise<[string, string][]> {
  if (typeof window === 'undefined') return [];
  const records: [string, string][] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(TRADING_PREFIX)) continue;
    const text = window.localStorage.getItem(key);
    if (text !== null) records.push([key.slice(TRADING_PREFIX.length), text]);
  }
  return records;
}
