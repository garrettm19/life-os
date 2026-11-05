import { ActiveCircuit, decodeActiveCircuit } from '../domain/intervals';
import { ACTIVE_PREFIX, SessionStore, isSessionKey } from '../state/session-store';

// Browser preview: the circuit in progress lives in localStorage, beside the plan.
const key = (blockId: string) => `${ACTIVE_PREFIX}${blockId}`;

export async function loadActiveCircuit(blockId: string): Promise<ActiveCircuit | null> {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(blockId));
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
  if (typeof window === 'undefined') return;
  if (value) window.localStorage.setItem(key(blockId), JSON.stringify(value));
  else window.localStorage.removeItem(key(blockId));
}

export const sessionStore: SessionStore = {
  async snapshot() {
    if (typeof window === 'undefined') return [];
    const entries: [string, string][] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && isSessionKey(k)) entries.push([k, window.localStorage.getItem(k)!]);
    }
    return entries;
  },
  async clear(keys) {
    if (typeof window === 'undefined') return;
    for (const k of keys) window.localStorage.removeItem(k);
  },
  async put(entries) {
    if (typeof window === 'undefined') return;
    for (const [k, value] of entries) window.localStorage.setItem(k, value);
  },
};
