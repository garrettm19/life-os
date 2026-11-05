import { test, expect, jest } from '@jest/globals';
import { encodeBackup, parseBackup } from '../../domain/backup';
import { generateDay, setBundledStatus, setStatus } from '../../domain/planner';
import { basicState } from '../../test-support/basic-state';
import { shiftDate } from '../../domain/model';
import { loadState, saveState } from '../storage';
import { deleteMeasurement, recordWeight } from '../../domain/measurements';
import { saveLog } from '../../domain/lifelog';
import { AT, trainingState } from '../../test-support/fixtures';

jest.mock('expo-sqlite', () => {
  // Real SQLite executes the production SQL. The adapter substitutes only the native bridge.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  let fail = false;
  const writes: string[] = [];
  const connection = {
    execAsync: async (sql: string) => {
      writes.push(sql);
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...params: (string | number)[]) => {
      writes.push(sql);
      return raw.prepare(sql).run(...params);
    },
    getFirstAsync: async (sql: string) => raw.prepare(sql).get(),
    getAllAsync: async (sql: string) => raw.prepare(sql).all(),
    withExclusiveTransactionAsync: async (
      action: (tx: {
        execAsync: (sql: string) => Promise<void>;
        runAsync: (sql: string, ...params: (string | number)[]) => Promise<unknown>;
      }) => Promise<void>,
    ) => {
      raw.exec('BEGIN');
      try {
        await action(connection);
        if (fail) throw new Error('Injected write failure');
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return {
    openDatabaseAsync: async () => connection,
    testAdapter: {
      raw,
      writes,
      fail: (v: boolean) => {
        fail = v;
      },
    },
  };
});
// The native mock exposes a test-only fault injector.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adapter = require('expo-sqlite').testAdapter as {
  raw: {
    prepare: (sql: string) => {
      get: () => { user_version: number };
      all: () => unknown[];
      run: (...params: string[]) => unknown;
    };
  };
  writes: string[];
  fail: (value: boolean) => void;
};
const writesDuring = async (action: () => Promise<unknown>) => {
  adapter.writes.length = 0;
  await action();
  return [...adapter.writes];
};
test('creates a versioned database and round-trips structured records', async () => {
  expect((await loadState()).programs).toHaveLength(0);
  expect(adapter.raw.prepare('PRAGMA user_version').get().user_version).toBe(5);
  const state = basicState();
  await saveState(state);
  expect(await loadState()).toEqual(state);
  expect(adapter.raw.prepare('SELECT * FROM programs').all()).toHaveLength(state.programs.length);
});
test('a mid-transaction write failure rolls back instead of erasing the saved plan', async () => {
  const before = await loadState();
  adapter.fail(true);
  await expect(saveState({ ...before, notes: ['A change that must not persist'] })).rejects.toThrow(
    'Injected write failure',
  );
  adapter.fail(false);
  expect(await loadState()).toEqual(before);
});

test('restoring a backup persists history together and a failed restore keeps the prior state', async () => {
  const before = await loadState();
  const target = basicState();
  target.notes = ['Synthetic restored note'];
  target.programs.push({
    id: 'accessory',
    title: 'Synthetic accessory',
    group: 'Examples',
    goalIds: [],
    routines: [
      {
        ...target.programs[1].routines[0],
        id: 'accessory-1',
        title: 'Accessory practice',
        weekdays: [1],
        bundledInto: 'strength',
        duration: null,
      },
    ],
  });
  const day = generateDay('2026-11-09', target.settings, target.programs);
  const parent = day.blocks.find((b) => b.programId === 'strength')!;
  const completed = setBundledStatus(day, parent.id, parent.bundledSteps![0].id, 'done');
  target.days[day.date] = setStatus(completed, day.blocks[0].id, 'done');
  const restored = parseBackup(encodeBackup(target)).state;
  adapter.fail(true);
  await expect(saveState(restored)).rejects.toThrow('Injected write failure');
  adapter.fail(false);
  expect(await loadState()).toEqual(before);
  await saveState(restored);
  expect(await loadState()).toEqual(target);
});

test('a routine change rewrites only the changed day, not the whole history', async () => {
  const state = basicState();
  let date = '2026-12-01';
  for (let i = 0; i < 30; i++) {
    state.days[date] = generateDay(date, state.settings, state.programs);
    date = shiftDate(date, 1);
  }
  await saveState(state);
  const loaded = await loadState();
  const target = loaded.days['2026-12-10'];
  const next = {
    ...loaded,
    days: { ...loaded.days, [target.date]: setStatus(target, target.blocks[0].id, 'done') },
  };
  const writes = await writesDuring(() => saveState(next));
  expect(writes.filter((sql) => sql.includes('INTO days'))).toHaveLength(1);
  expect(writes.some((sql) => sql.includes('INTO programs') || sql.includes('DELETE'))).toBe(false);
  expect(await loadState()).toEqual(next);
});

test('rows missing from the next state are deleted, and a failure forces a full rewrite', async () => {
  const before = await loadState();
  const smaller = basicState();
  smaller.programs = smaller.programs.slice(1);
  adapter.fail(true);
  await expect(saveState(smaller)).rejects.toThrow('Injected write failure');
  adapter.fail(false);
  expect(await loadState()).toEqual(before);

  await saveState(before);
  adapter.fail(true);
  await expect(saveState(smaller)).rejects.toThrow('Injected write failure');
  adapter.fail(false);
  const retry = await writesDuring(() => saveState(smaller));
  expect(retry.some((sql) => sql.includes('DELETE FROM programs; DELETE FROM goals'))).toBe(true);
  expect(await loadState()).toEqual(smaller);
  expect(adapter.raw.prepare('SELECT * FROM days').all()).toHaveLength(0);
});

test('personal records save in their own tables, roll back on failure and delete cleanly', async () => {
  const base = trainingState();
  const withWeight = recordWeight(
    base,
    { value: 180.4, unit: 'lb', date: '2026-11-15', fasted: null, note: '' },
    'w1',
    new Date(2026, 10, 30, 12).toISOString(),
  );
  await saveState(withWeight);
  expect(await loadState()).toEqual(withWeight);
  expect(adapter.raw.prepare('SELECT * FROM measurements').all()).toHaveLength(1);
  const withLog = saveLog(
    withWeight,
    {
      text: 'Synthetic note',
      date: '2026-11-15',
      category: null,
      energy: null,
      mood: null,
      goalId: null,
    },
    'l1',
    AT,
  );
  // Adding a log entry writes only that row.
  const writes = await writesDuring(() => saveState(withLog));
  expect(writes.filter((sql) => sql.includes('INTO life_log'))).toHaveLength(1);
  expect(writes.some((sql) => sql.includes('INTO measurements') || sql.includes('INTO days'))).toBe(
    false,
  );
  adapter.fail(true);
  await expect(saveState(deleteMeasurement(withLog, 'w1'))).rejects.toThrow(
    'Injected write failure',
  );
  adapter.fail(false);
  expect(await loadState()).toEqual(withLog);
  await saveState(deleteMeasurement(withLog, 'w1'));
  expect(adapter.raw.prepare('SELECT * FROM measurements').all()).toHaveLength(0);
  expect((await loadState()).lifeLog).toHaveLength(1);
});

test('a save re-validates the days that changed, and never trusts a changed invalid day', async () => {
  const state = basicState();
  const date = '2026-10-10';
  const first = { ...state, days: { [date]: generateDay(date, state.settings, state.programs) } };
  await saveState(first);
  // Unchanged days were validated when saved; a broken change to one is still refused.
  const broken = structuredClone(first);
  broken.days[date].blocks[0].status = 'finished' as never;
  await expect(saveState(broken)).rejects.toThrow();
  expect(await loadState()).toEqual(first);
  // A valid change saves, and a day already saved stays as it was.
  const next = shiftDate(date, 1);
  const second = {
    ...first,
    days: { ...first.days, [next]: generateDay(next, first.settings, first.programs) },
  };
  await saveState(second);
  expect(await loadState()).toEqual(second);
});

test('a save after a failed load re-validates the rows that load could not read', async () => {
  const state = basicState();
  const date = '2026-10-12';
  const first = { ...state, days: { [date]: generateDay(date, state.settings, state.programs) } };
  await saveState(first);
  // The saved day is damaged on disk: still JSON, but not a valid day.
  const broken = structuredClone(first);
  broken.days[date].blocks[0].status = 'finished' as never;
  adapter.raw
    .prepare('UPDATE days SET payload=? WHERE date=?')
    .run(JSON.stringify(broken.days[date]), date);
  await expect(loadState()).rejects.toThrow();
  // Rows from a load that failed were never validated, so the same damaged day is not trusted as
  // already saved.
  await expect(saveState(broken)).rejects.toThrow();
  await saveState(first);
  expect(await loadState()).toEqual(first);
});
