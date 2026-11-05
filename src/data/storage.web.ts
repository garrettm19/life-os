import { State, emptyState } from '../domain/model';
import { decodeState } from '../domain/data';
const key = 'life-os-v1';

// Each day's and trading session's JSON as last loaded or saved, so a save validates only the ones
// whose content changed. Unknown (before a load, or after a failed save) means validate everything.
let committed: { days: Map<string, string>; sessions: Map<string, string> } | undefined;

const dayPayloads = (state: State) =>
  new Map(Object.entries(state.days).map(([date, day]) => [date, JSON.stringify(day)]));
const sessionPayloads = (state: State) =>
  new Map(Object.entries(state.tradingSessions).map(([date, s]) => [date, JSON.stringify(s)]));

/** The dates whose payload is the one already saved. A missing one (undefined) is never the same. */
function same(next: Map<string, string>, previous: Map<string, string> | undefined): Set<string> {
  const unchanged = new Set<string>();
  if (previous)
    for (const [date, payload] of next)
      if (payload !== undefined && previous.get(date) === payload) unchanged.add(date);
  return unchanged;
}

export async function loadState(): Promise<State> {
  if (typeof window === 'undefined') return emptyState();
  const raw = window.localStorage.getItem(key);
  const state = raw ? decodeState(JSON.parse(raw)) : emptyState();
  committed = { days: dayPayloads(state), sessions: sessionPayloads(state) };
  return state;
}
export async function saveState(state: State): Promise<void> {
  const days = dayPayloads(state);
  const sessions = sessionPayloads(state);
  const previous = committed;
  // Days and trading sessions whose serialized content matches what is already saved were
  // validated when they were saved or loaded; only the changed ones (and everything else) are
  // checked again. A missing day serializes to undefined, as a date never saved reads, so it is
  // always checked.
  decodeState(state, {
    unchangedDays: same(days, previous?.days),
    unchangedSessions: same(sessions, previous?.sessions),
  });
  committed = undefined;
  // One document as before, built from the day payloads so no day is serialized twice.
  const { days: _days, ...rest } = state;
  const head = JSON.stringify(rest);
  const body = [...days].map(([date, payload]) => `${JSON.stringify(date)}:${payload}`).join(',');
  window.localStorage.setItem(key, `${head.slice(0, -1)},"days":{${body}}}`);
  committed = { days, sessions };
}
