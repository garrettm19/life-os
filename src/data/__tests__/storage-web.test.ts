import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as data from '../../domain/data';
import { withDay } from '../../domain/data';
import { shiftDate, State } from '../../domain/model';
import { makeBlock, setStatus } from '../../domain/planner';
import { basicState } from '../../test-support/basic-state';
import { loadState, saveState } from '../storage.web';

// The browser preview keeps the whole state in one localStorage document under the same key.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  };
});

test('a version-1 browser document loads upgraded, and the first save writes version 5', async () => {
  const v1: Record<string, unknown> = { ...JSON.parse(JSON.stringify(basicState())), version: 1 };
  for (const key of [
    'measurements',
    'lifeLog',
    'workoutTemplates',
    'workoutSessions',
    'moneyReviews',
    'intervalRoutines',
    'intervalSessions',
    'activitySessions',
    'ruleBooks',
    'ruleReviews',
    'focuses',
    'weeklyReviews',
    'skillCheckpoints',
    'tradingSessions',
    'tradingSessionsImported',
  ])
    delete v1[key];
  store.set('life-os-v1', JSON.stringify(v1));
  const loaded = await loadState();
  expect(loaded.version).toBe(5);
  expect(loaded.tradingSessions).toEqual({});
  expect(loaded.programs).toEqual(basicState().programs);
  // Loading alone never rewrites the stored document.
  expect(JSON.parse(store.get('life-os-v1')!).version).toBe(1);
  await saveState(loaded);
  expect(JSON.parse(store.get('life-os-v1')!).version).toBe(5);
});

test('a document from a newer version is refused and left untouched', async () => {
  const newer = JSON.stringify({ ...basicState(), version: 6 });
  store.set('life-os-v1', newer);
  await expect(loadState()).rejects.toThrow(/unsupported version/);
  expect(store.get('life-os-v1')).toBe(newer);
});

// Synthetic data only: two years of days with one done walk each.
const DATE = '2026-11-08';
const WALK = `${DATE}:manual:walk`;
function twoYears(): State {
  const state = basicState();
  for (let ago = 730; ago >= 1; ago--) {
    const date = shiftDate('2026-11-09', -ago);
    const block = {
      ...makeBlock(`${date}:manual:walk`, 'Walk', 7 * 60, 30),
      status: 'done' as const,
    };
    state.days[date] = { date, blocks: [block], revisions: [] };
  }
  return state;
}
/** The day with its walk listed twice, which the decoder refuses. */
const duplicated = (state: State) => ({
  ...state.days[DATE],
  blocks: [...state.days[DATE].blocks, state.days[DATE].blocks[0]],
});

describe('saving a long history', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('re-checks only the day that changed, so a tick does not validate two years', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    const decode = jest.spyOn(data, 'decodeState');
    const unticked = withDay(loaded, setStatus(loaded.days[DATE], WALK, 'planned'));
    await saveState(unticked);
    const unchanged = decode.mock.calls[0][1]?.unchangedDays;
    expect(unchanged?.size).toBe(729);
    expect(unchanged?.has(DATE)).toBe(false);
    // The next save compares with the state just saved.
    await saveState(withDay(unticked, setStatus(unticked.days[DATE], WALK, 'done')));
    expect(decode.mock.calls[1][1]?.unchangedDays?.size).toBe(729);
    expect(JSON.parse(store.get('life-os-v1')!).days[DATE].blocks[0].status).toBe('done');
  });

  test('a changed day is still validated: an invalid one is refused and nothing is written', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    const before = store.get('life-os-v1');
    await expect(saveState(withDay(loaded, duplicated(loaded)))).rejects.toThrow(
      /Duplicate occurrence/,
    );
    expect(store.get('life-os-v1')).toBe(before);
  });

  test('a date with no day is refused, never written as an unreadable document', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    const before = store.get('life-os-v1');
    // Neither the loaded state nor this one has a day for the date: both read as undefined.
    const missing = shiftDate(DATE, 400);
    expect(loaded.days[missing]).toBeUndefined();
    const broken = { ...loaded, days: { ...loaded.days, [missing]: undefined } };
    await expect(saveState(broken as unknown as State)).rejects.toThrow();
    expect(store.get('life-os-v1')).toBe(before);
    expect(await loadState()).toEqual(loaded);
  });

  test('a refused save is not taken as saved: the next save compares with the last saved state', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    const refused = withDay(loaded, duplicated(loaded));
    await expect(saveState(refused)).rejects.toThrow();
    const decode = jest.spyOn(data, 'decodeState');
    // The refused day object is offered again: it was never saved, so it is checked again.
    await expect(saveState(refused)).rejects.toThrow(/Duplicate occurrence/);
    expect(decode.mock.calls[0][1]?.unchangedDays?.has(DATE)).toBe(false);
  });

  test('compares days by content, so a day edited in place is still checked', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    // The same day object, changed in place: identity would call it unchanged.
    loaded.days[DATE].blocks.push(loaded.days[DATE].blocks[0]);
    await expect(saveState(loaded)).rejects.toThrow(/Duplicate occurrence/);
  });

  test('writes one document that reads back as the saved state', async () => {
    store.set('life-os-v1', JSON.stringify(twoYears()));
    const loaded = await loadState();
    const next = withDay(loaded, setStatus(loaded.days[DATE], WALK, 'planned'));
    await saveState(next);
    expect(JSON.parse(store.get('life-os-v1')!)).toEqual(JSON.parse(JSON.stringify(next)));
    expect(await loadState()).toEqual(JSON.parse(JSON.stringify(next)));
  });
});
