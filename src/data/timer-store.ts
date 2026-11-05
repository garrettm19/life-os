import Storage from 'expo-sqlite/kv-store';
import { ActiveCircuit, decodeActiveCircuit } from '../domain/intervals';
import { ACTIVE_PREFIX, SessionStore, isSessionKey } from '../state/session-store';

// The circuit in progress, kept on this device only so an interruption can be recovered. It is not
// part of the plan or of backups: only a finished circuit becomes a record. A whole-state
// replacement (Reset, restore, Explore demo, Start tracking) clears every slot; see
// `replaceAllState`.
/** One slot per objective, so starting another circuit never overwrites a paused one. */
const key = (blockId: string) => `${ACTIVE_PREFIX}${blockId}`;

export async function loadActiveCircuit(blockId: string): Promise<ActiveCircuit | null> {
  try {
    const raw = await Storage.getItemAsync(key(blockId));
    const saved = raw ? decodeActiveCircuit(JSON.parse(raw)) : null;
    return saved?.blockId === blockId ? saved : null;
  } catch {
    return null;
  }
}

export async function saveActiveCircuit(
  blockId: string,
  value: ActiveCircuit | null,
): Promise<void> {
  if (value) await Storage.setItemAsync(key(blockId), JSON.stringify(value));
  else await Storage.removeItemAsync(key(blockId));
}

/** Every saved in-progress circuit and study slot, raw, for a full-state replacement. */
export const sessionStore: SessionStore = {
  async snapshot() {
    const keys = (await Storage.getAllKeysAsync()).filter(isSessionKey);
    const entries: [string, string][] = [];
    for (const k of keys) {
      const value = await Storage.getItemAsync(k);
      if (value !== null) entries.push([k, value]);
    }
    return entries;
  },
  async clear(keys) {
    for (const k of keys) await Storage.removeItemAsync(k);
  },
  async put(entries) {
    for (const [k, value] of entries) await Storage.setItemAsync(k, value);
  },
};
