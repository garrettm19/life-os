import { beforeEach, expect, jest, test } from '@jest/globals';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBackup } from '../../domain/backup';
import { restorePreview } from '../../domain/restore-preview';
import { demoState } from '../../domain/demo';

// Artifacts written by the version-3 iOS build, the last build before state version 4:
// `fixtures/v3-build.db` is the SQLite database it wrote and `fixtures/v3-build-backup.json` the
// backup it exported, both from a synthetic month (every version-3 record kind: weights, workout
// plans and sessions, money reviews, a timed circuit and its session, activities and study
// sessions, a trading rulebook and reviews, the life log). Some titles and amounts were later
// replaced with plainly synthetic values in both files alike; every record, key and type is as the
// build wrote it. This build must upgrade them exactly.

type Raw = {
  exec: (sql: string) => void;
  close: () => void;
  prepare: (sql: string) => {
    run: (...p: (string | number)[]) => unknown;
    get: (...p: (string | number)[]) => Record<string, unknown> | undefined;
    all: (...p: (string | number)[]) => Record<string, unknown>[];
  };
};
const harness: { raw: Raw | null; fail: boolean } = { raw: null, fail: false };
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const raw = harness.raw!;
    const c = {
      execAsync: async (sql: string) => raw.exec(sql),
      runAsync: async (sql: string, ...p: (string | number)[]) => raw.prepare(sql).run(...p),
      getFirstAsync: async (sql: string) => raw.prepare(sql).get(),
      getAllAsync: async (sql: string) => raw.prepare(sql).all(),
      withExclusiveTransactionAsync: async (action: (tx: unknown) => Promise<void>) => {
        raw.exec('BEGIN');
        try {
          await action(c);
          if (harness.fail) throw new Error('Injected migration failure');
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    };
    return c;
  },
}));

const FIXTURES = join(__dirname, 'fixtures');
const backupRaw = readFileSync(join(FIXTURES, 'v3-build-backup.json'), 'utf8');
const v3 = JSON.parse(backupRaw).state;
const upgraded = {
  ...v3,
  version: 5,
  focuses: [],
  weeklyReviews: [],
  skillCheckpoints: [],
  tradingSessions: {},
};

function copyOfDatabase(): { raw: Raw; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'life-os-v3-')), 'life-os.db');
  copyFileSync(join(FIXTURES, 'v3-build.db'), file);
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return { raw: new DatabaseSync(file) as unknown as Raw, file };
}
const storage = () => {
  jest.resetModules();
  // A fresh module per open, so no cached connection carries over between steps.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../storage') as typeof import('../storage');
};
const userVersion = (raw: Raw) => raw.prepare('PRAGMA user_version').get()!.user_version;

beforeEach(() => {
  harness.fail = false;
});

test('the version-3 build wrote every record kind it knows', () => {
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
  ])
    expect(v3[key].length).toBeGreaterThan(0);
  expect(v3.version).toBe(3);
});

test('its database upgrades to version 5 with every record, day and ID unchanged', async () => {
  const { raw } = copyOfDatabase();
  harness.raw = raw;
  expect(userVersion(raw)).toBe(3);
  const { loadState, saveState } = storage();
  const state = await loadState();
  expect(userVersion(raw)).toBe(5);
  expect(state).toEqual(upgraded);
  // Nothing invented: the new lists start empty.
  expect([state.focuses, state.weeklyReviews, state.skillCheckpoints]).toEqual([[], [], []]);
  expect(state.tradingSessions).toEqual({});
  await saveState(state);
  expect(await storage().loadState()).toEqual(upgraded);
  raw.close();
});

test('a failed upgrade leaves its database exactly as the version-3 build wrote it', async () => {
  const { raw } = copyOfDatabase();
  const dump = () =>
    raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((t) => [t.name, raw.prepare(`SELECT * FROM ${t.name}`).all()]);
  const before = JSON.stringify(dump());
  harness.raw = raw;
  harness.fail = true;
  await expect(storage().loadState()).rejects.toThrow(/Injected migration failure/);
  expect(userVersion(raw)).toBe(3);
  expect(JSON.stringify(dump())).toBe(before);
  // The next launch retries and succeeds.
  harness.fail = false;
  expect(await storage().loadState()).toEqual(upgraded);
  raw.close();
});

test('its backup restores with the same content and says it predates the new records', () => {
  const restored = parseBackup(backupRaw);
  expect(restored.sourceVersion).toBe(3);
  expect(restored.state).toEqual(upgraded);
  // Restoring it over a device that has a focus, reviews and checkpoints says they would go.
  const device = demoState('2026-11-09');
  const labels = restorePreview(device, restored.state)
    .changes.filter((c) => c.removed > 0)
    .map((c) => c.label);
  expect(labels).toEqual(
    expect.arrayContaining(['focus periods', 'weekly reviews', 'skill checkpoints']),
  );
});

test('the restore preview finds no false changes between its upgraded database and its backup', async () => {
  // The database upgrades in SQLite and the backup in the decoder; neither adds anything a restore
  // would report as replaced, so the preview says the backup holds exactly this data.
  const { raw } = copyOfDatabase();
  harness.raw = raw;
  const device = await storage().loadState();
  raw.close();
  expect(restorePreview(device, parseBackup(backupRaw).state).unchanged).toBe(true);
});
