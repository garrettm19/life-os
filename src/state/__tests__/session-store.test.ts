import { describe, expect, it, jest } from '@jest/globals';
import { decodeState } from '../../domain/data';
import { demoState } from '../../domain/demo';
import { emptyState, State } from '../../domain/model';
import { startTracking } from '../../domain/start-tracking';
import { newSession } from '../../domain/trading';
import { trainingState } from '../../test-support/fixtures';
import {
  ACTIVE_PREFIX,
  STUDY_PREFIX,
  isSessionKey,
  TRADING_PREFIX,
  importSessionsOnLoad,
  replaceAllState,
  SessionStore,
} from '../session-store';

const AT = new Date(2026, 10, 9, 8).toISOString();

// The device-only session slots modeled as a map, with optional injected failures.
function memoryStore(
  initial: [string, string][],
  fail: Partial<Record<keyof SessionStore, boolean>> = {},
) {
  const data = new Map(initial);
  const store: SessionStore = {
    async snapshot() {
      if (fail.snapshot) throw new Error('snapshot failed');
      return [...data.entries()].filter(([k]) => isSessionKey(k));
    },
    async clear(keys) {
      if (fail.clear) throw new Error('clear failed');
      for (const k of keys) data.delete(k);
    },
    async put(entries) {
      for (const [k, v] of entries) data.set(k, v);
    },
  };
  return { data, store };
}

/** A save queue like the app's: applies the operation, or fails like a refused save. */
function saver(initial: State, accept = true) {
  let state = initial;
  const change = async (operation: (current: State) => State) => {
    try {
      const next = operation(state);
      if (!accept) throw new Error('Synthetic save failure');
      state = next;
      return true;
    } catch {
      return false;
    }
  };
  return { change, current: () => state };
}

const paused: [string, string] = [`${ACTIVE_PREFIX}2026-11-09:routine:abs`, '{"run":"paused"}'];
const other: [string, string] = ['unrelated-key', 'kept'];

describe('whole-state replacement and in-progress circuits', () => {
  it('a successful Reset or restore clears every in-progress circuit and nothing else', async () => {
    const { data, store } = memoryStore([paused, other]);
    const app = saver(trainingState());
    expect(await replaceAllState(() => emptyState(), app.change, store)).toBe(true);
    expect(app.current()).toEqual(emptyState());
    expect([...data.keys()]).toEqual(['unrelated-key']);
  });

  it('Start tracking builds on the demo being replaced and clears its timer slots', async () => {
    const study: [string, string] = [`${STUDY_PREFIX}2026-11-09:demo-study`, '{"index":1}'];
    const trading: [string, string] = [`${TRADING_PREFIX}2026-11-09`, '{"failedTheses":1}'];
    const { data, store } = memoryStore([paused, study, trading, other]);
    const demo = demoState('2026-11-09');
    const app = saver(demo);
    const now = new Date(2026, 10, 9, 10).toISOString();
    expect(
      await replaceAllState(
        (current) => startTracking(current, '2026-11-09', now),
        app.change,
        store,
      ),
    ).toBe(true);
    expect(app.current()).toEqual(startTracking(demo, '2026-11-09', now));
    // The trading record an earlier build kept is left as it is: it was moved in once already.
    expect([...data.keys()]).toEqual([trading[0], 'unrelated-key']);
  });

  it('a refused or failed save leaves the plan and the paused circuit exactly as they were', async () => {
    const { data, store } = memoryStore([paused, other]);
    const before = trainingState();
    const app = saver(before, false);
    expect(await replaceAllState(() => emptyState(), app.change, store)).toBe(false);
    expect(app.current()).toBe(before);
    expect([...data.entries()]).toEqual([other, paused]);
  });

  it('a replacement that throws while building the new state changes nothing', async () => {
    const { data, store } = memoryStore([paused]);
    const before = trainingState();
    const app = saver(before);
    const ok = await replaceAllState(
      () => {
        throw new Error('Invalid backup');
      },
      app.change,
      store,
    );
    expect(ok).toBe(false);
    expect(app.current()).toBe(before);
    expect([...data.entries()]).toEqual([paused]);
  });

  it('if the slots cannot be read or cleared, nothing is replaced', async () => {
    for (const fail of [{ snapshot: true }, { clear: true }]) {
      const { data, store } = memoryStore([paused], fail);
      const before = trainingState();
      const app = saver(before);
      expect(await replaceAllState(() => emptyState(), app.change, store)).toBe(false);
      expect(app.current()).toBe(before);
      expect([...data.entries()]).toEqual([paused]);
    }
  });
});

describe('overlapping replacements', () => {
  it('run one after the other, so a failed first one cannot put back slots after a second succeeds', async () => {
    const { data, store } = memoryStore([paused]);
    let accept = false;
    let state: State = trainingState();
    const change = async (operation: (current: State) => State) => {
      await new Promise((r) => setTimeout(r, 5));
      try {
        const next = operation(state);
        if (!accept) {
          accept = true;
          throw new Error('first save fails');
        }
        state = next;
        return true;
      } catch {
        return false;
      }
    };
    const [first, second] = await Promise.all([
      replaceAllState(() => emptyState(), change, store),
      replaceAllState(() => emptyState(), change, store),
    ]);
    expect([first, second]).toEqual([false, true]);
    // The second replacement saw the slot put back by the first, and cleared it.
    expect([...data.keys()]).toEqual([]);
  });

  it('clears a study session in progress with the circuit slots, and nothing else', async () => {
    const study: [string, string] = [`${STUDY_PREFIX}2026-11-09:routine:study`, '{"index":1}'];
    const other: [string, string] = ['life-os-v1', '{}'];
    expect(isSessionKey(study[0])).toBe(true);
    expect(isSessionKey(paused[0])).toBe(true);
    expect(isSessionKey(other[0])).toBe(false);
    const { data, store } = memoryStore([paused, study, other]);
    const { change } = saver(trainingState());
    expect(await replaceAllState(() => emptyState(), change, store)).toBe(true);
    expect([...data.keys()]).toEqual(['life-os-v1']);
  });

  it('replaces the trading sessions with the saved data, and leaves the device records alone', async () => {
    // Earlier builds kept the sessions on the device; they are in the saved data now, so a Reset
    // clears them with it and a restore brings back the backup's. The device records are left as
    // they are, and the flag that they were moved in stays, so they never come back.
    const trading: [string, string] = [`${TRADING_PREFIX}2026-11-09`, '{"failedTheses":1}'];
    expect(isSessionKey(trading[0])).toBe(false);
    const { data, store } = memoryStore([trading, ['life-os-v1', '{}']]);
    const session = { ...newSession('2026-11-09'), bias: 'bullish' as const, biasAt: AT };
    const device = { ...trainingState(), tradingSessions: { '2026-11-09': session } };
    const app = saver(device);
    expect(await replaceAllState(() => emptyState(), app.change, store)).toBe(true);
    expect(app.current().tradingSessions).toEqual({});
    expect(app.current().tradingSessionsImported).toBe(true);
    expect([...data.keys()]).toEqual([trading[0], 'life-os-v1']);
    // A backup made before sessions were kept in backups restores with none, and the flag stays.
    const { tradingSessions: _sessions, tradingSessionsImported: _flag, ...v4 } = device;
    const older = decodeState(JSON.parse(JSON.stringify({ ...v4, version: 4 })));
    expect(older.tradingSessions).toEqual({});
    expect(older.tradingSessionsImported).toBeUndefined();
    const again = saver(device);
    expect(await replaceAllState(() => older, again.change, store)).toBe(true);
    expect(again.current().tradingSessionsImported).toBe(true);
    // Restoring a backup that holds them brings them back as saved.
    const restore = saver(emptyState());
    expect(await replaceAllState(() => device, restore.change, store)).toBe(true);
    expect(restore.current().tradingSessions).toEqual({ '2026-11-09': session });
  });
});

describe('moving the device trading records in on load', () => {
  const session = { ...newSession('2026-11-09'), bias: 'bearish' as const, biasAt: AT };
  const older = () => withoutSessions(trainingState());

  it('moves them in once and saves before the data is used', async () => {
    const saved: State[] = [];
    const read = jest.fn(async (): Promise<[string, string][]> => [
      ['2026-11-09', JSON.stringify(session)],
    ]);
    const save = async (s: State) => {
      saved.push(s);
    };
    const loaded = await importSessionsOnLoad(older(), read, save);
    expect(loaded.tradingSessions).toEqual({ '2026-11-09': session });
    expect(loaded.tradingSessionsImported).toBe(true);
    expect(saved).toEqual([loaded]);
    // Loaded again, the records are never read again, even if they changed on the device.
    expect(await importSessionsOnLoad(loaded, read, save)).toBe(loaded);
    expect(read).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it('marks data with nothing to move in, so the device is never read again', async () => {
    const saved: State[] = [];
    const loaded = await importSessionsOnLoad(
      older(),
      async () => [],
      async (s) => {
        saved.push(s);
      },
    );
    expect(loaded.tradingSessions).toEqual({});
    expect(loaded.tradingSessionsImported).toBe(true);
    expect(saved).toEqual([loaded]);
  });

  it('fails the load when the device records or the save fail, so it is tried again', async () => {
    await expect(
      importSessionsOnLoad(
        older(),
        async () => {
          throw new Error('read failed');
        },
        async () => {},
      ),
    ).rejects.toThrow('read failed');
    await expect(
      importSessionsOnLoad(
        older(),
        async () => [['2026-11-09', JSON.stringify(session)]],
        async () => {
          throw new Error('save failed');
        },
      ),
    ).rejects.toThrow('save failed');
  });
});

/** The data as a build before version 5 saved it: no sessions moved in yet. */
function withoutSessions(state: State): State {
  const { tradingSessionsImported: _flag, ...rest } = state;
  return { ...rest, tradingSessions: {} };
}
