import { State } from '../domain/model';
import { importDeviceSessions, keepSessionsImported } from '../domain/trading-sessions';

/** Key prefix of the device-only in-progress circuit slots. */
export const ACTIVE_PREFIX = 'life-os-active-circuit:';
/** Key prefix of the device-only study sessions in progress. */
export const STUDY_PREFIX = 'life-os-active-study:';
/**
 * Key prefix of the trading sessions earlier builds kept on this device. They are moved into the
 * saved data once (`importSessionsOnLoad`) and then left as they are: never written, read again or
 * cleared.
 */
export const TRADING_PREFIX = 'life-os-trading-session:';

/** Whether a device storage key holds session state that belongs to the saved plan. */
export function isSessionKey(key: string): boolean {
  return key.startsWith(ACTIVE_PREFIX) || key.startsWith(STUDY_PREFIX);
}

/**
 * The loaded data with the trading sessions earlier builds kept on this device moved in, saved
 * before anything else can change it; the data unchanged once they were. A failed read or save
 * throws, so the data never loads without them and they are tried again on the next load.
 */
export async function importSessionsOnLoad(
  state: State,
  read: () => Promise<[string, string][]>,
  save: (state: State) => Promise<void>,
): Promise<State> {
  if (state.tradingSessionsImported) return state;
  const next = importDeviceSessions(state, await read());
  await save(next);
  return next;
}

/** Device-only session state kept beside the saved plan: circuits and study sessions. */
export type SessionStore = {
  snapshot: () => Promise<[string, string][]>;
  clear: (keys: string[]) => Promise<void>;
  put: (entries: [string, string][]) => Promise<void>;
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * Replaces the whole saved state (Reset, restore, Explore demo, Start tracking) without leaving
 * session state that belongs to the data being replaced; `next` receives the state it replaces.
 * The trading sessions are part of the saved state and are replaced with it: a restore brings back
 * the backup's, a Reset clears them. This device's earlier trading records stay moved in
 * (`keepSessionsImported`), so an older backup never brings them back.
 * Session slots are cleared before the new state is saved, so even a crash right after the save
 * cannot leave a paused circuit from the old data; if the save is refused or fails, the slots are
 * put back exactly as they were and nothing has changed.
 */
export function replaceAllState(
  next: (current: State) => State,
  change: (operation: (current: State) => State) => Promise<boolean>,
  store: SessionStore,
): Promise<boolean> {
  // One replacement at a time: a second one starts only after the first saved or put slots back.
  const run = queue.then(() => replaceOnce(next, change, store));
  queue = run.catch(() => {});
  return run;
}

/*
 * Trade-off: the slots are cleared before saving. If the app is killed between the two, a paused
 * circuit is lost although the plan was not replaced; the opposite order could instead let a run
 * from replaced data resume, which is worse (a false record). Losing a paused run is recoverable:
 * the circuit simply starts again.
 */
async function replaceOnce(
  next: (current: State) => State,
  change: (operation: (current: State) => State) => Promise<boolean>,
  store: SessionStore,
): Promise<boolean> {
  let saved: [string, string][];
  try {
    saved = await store.snapshot();
  } catch {
    // Without a snapshot the slots cannot be put back on failure, so nothing is replaced.
    return change(() => {
      throw new Error('Could not prepare this device for the change. Nothing was replaced.');
    });
  }
  try {
    await store.clear(saved.map(([k]) => k));
  } catch {
    await store.put(saved).catch(() => {});
    return change(() => {
      throw new Error('Could not prepare this device for the change. Nothing was replaced.');
    });
  }
  const ok = await change((current) => keepSessionsImported(next(current), current));
  if (!ok) await store.put(saved).catch(() => {});
  return ok;
}
