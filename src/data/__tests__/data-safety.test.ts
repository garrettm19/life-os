import { beforeEach, describe, expect, jest, it } from '@jest/globals';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeBackup, parseBackup } from '../../domain/backup';
import { restorePreview } from '../../domain/restore-preview';
import { saveCheckpoint } from '../../domain/checkpoints';
import { demoState } from '../../domain/demo';
import { defaultReviewDate, startFocus } from '../../domain/focus';
import { State } from '../../domain/model';
import { newSession } from '../../domain/trading';
import { saveWeeklyReview } from '../../domain/weekly-reviews';

// Data safety on real SQLite (node:sqlite behind the expo-sqlite calls storage makes). Synthetic
// data only. The "known gap" block pins current behavior on purpose: a damaged database that still
// loads without an error. Closing that gap changes those tests deliberately.

type Raw = {
  exec: (sql: string) => void;
  close: () => void;
  prepare: (sql: string) => {
    run: (...p: (string | number)[]) => unknown;
    get: (...p: (string | number)[]) => Record<string, unknown> | undefined;
    all: (...p: (string | number)[]) => Record<string, unknown>[];
  };
};
const harness: { raw: Raw | null } = { raw: null };
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
const storage = () => {
  jest.resetModules();
  // A fresh module per open, so no cached connection carries over between steps.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../storage') as typeof import('../storage');
};
const open = (file = ':memory:'): Raw => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return new DatabaseSync(file) as unknown as Raw;
};
const tables = (raw: Raw) =>
  raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((t) => String(t.name));
const dump = (raw: Raw) =>
  JSON.stringify(tables(raw).map((t) => [t, raw.prepare(`SELECT * FROM ${t}`).all()]));

const TODAY = '2026-11-09';
const at = (h: number) => new Date(2026, 10, 9, h).toISOString();

/** A candle's trading session: its bias labeled, nothing locked. Synthetic, no price. */
const SESSION = {
  ...newSession(TODAY),
  bias: 'bullish' as const,
  biasAt: at(7),
  preparedAt: at(7),
};

/** The fictional demo as a device's own data, with one life log entry and a trading session too. */
function device(): State {
  const s = { ...demoState(TODAY), source: 'personal' as const };
  return {
    ...s,
    tradingSessions: { [TODAY]: SESSION },
    lifeLog: [
      {
        id: 'log-1',
        date: '2026-11-08',
        at: at(8),
        text: 'Synthetic note',
        category: null,
        energy: null,
        mood: null,
        goalId: null,
      },
    ],
  };
}

beforeEach(() => {
  harness.raw = null;
});

describe('the version-3 build fixture through a full version-5 cycle', () => {
  it('upgrades, takes new records, saves, reopens, backs up and restores without loss', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'life-os-cycle-')), 'life-os.db');
    copyFileSync(join(__dirname, 'fixtures', 'v3-build.db'), file);
    harness.raw = open(file);
    const upgraded = await storage().loadState();
    const before = { ...upgraded };
    // Records only a version-4 or version-5 build can make, on top of the upgraded history.
    const routine = upgraded.programs.flatMap((p) => p.routines)[0].id;
    let s = startFocus(
      upgraded,
      {
        title: 'A synthetic focus',
        goalId: null,
        outcome: '',
        evidence: 'career',
        routineIds: [routine],
        leadRoutineId: null,
        cue: '',
        baseline: '',
        target: '',
        reviewDate: defaultReviewDate(TODAY),
      },
      'focus-1',
      at(9),
    );
    s = saveWeeklyReview(
      s,
      { weekStart: TODAY, obstacle: 'Synthetic', adjustment: 'Synthetic', noChange: false },
      'week-1',
      at(10),
    );
    s = saveCheckpoint(
      s,
      {
        date: TODAY,
        method: 'Synthetic set',
        difficulty: 'medium',
        attempted: 4,
        solved: 2,
        minutes: 45,
        fresh: true,
        topics: '',
        next: '',
      },
      'checkpoint-1',
      at(11),
    );
    s = { ...s, tradingSessions: { [TODAY]: SESSION } };
    await storage().saveState(s);
    const reopened = await storage().loadState();
    expect(reopened).toEqual(s);
    // Everything the version-3 build wrote is exactly as it was.
    expect({
      ...reopened,
      focuses: [],
      weeklyReviews: [],
      skillCheckpoints: [],
      tradingSessions: {},
    }).toEqual(before);
    const restored = parseBackup(encodeBackup(reopened, at(12)));
    expect(restored.sourceVersion).toBe(5);
    expect(restored.state).toEqual(reopened);
    harness.raw.close();
  });
});

describe('a malformed row in any table', () => {
  it('is refused on load and leaves every table exactly as it was', async () => {
    harness.raw = open();
    await storage().saveState(device());
    const names = tables(harness.raw).filter((t) => t !== 'metadata');
    // 18 tables in schema 5: metadata plus 17 record tables.
    expect(names).toHaveLength(17);
    for (const table of names) {
      const key = table === 'days' || table === 'trading_sessions' ? 'date' : 'id';
      const row = harness.raw.prepare(`SELECT ${key} AS key, payload FROM ${table} LIMIT 1`).get();
      expect(row).toBeDefined();
      for (const bad of ['{"broken":', '{"id":"x"}']) {
        harness.raw
          .prepare(`UPDATE ${table} SET payload=? WHERE ${key}=?`)
          .run(bad, String(row!.key));
        const snapshot = dump(harness.raw);
        await expect(storage().loadState()).rejects.toThrow();
        expect(dump(harness.raw)).toBe(snapshot);
      }
      harness.raw
        .prepare(`UPDATE ${table} SET payload=? WHERE ${key}=?`)
        .run(String(row!.payload), String(row!.key));
    }
    // With every row repaired, the same database loads again.
    expect(await storage().loadState()).toEqual(device());
  });
});

describe('the 20 MB backup limit', () => {
  // A long synthetic history: life-log entries of the largest allowed text.
  const text = 'x'.repeat(2_000);
  const withLog = (count: number): State => {
    const s = device();
    return {
      ...s,
      lifeLog: Array.from({ length: count }, (_, i) => ({
        id: `log-${i}`,
        date: '2026-11-08',
        at: at(8),
        text,
        category: null,
        energy: null,
        mood: null,
        goalId: null,
      })),
    };
  };

  it('round-trips a backup just under 20 MB, and refuses one just over with a clear message', () => {
    const base = encodeBackup(withLog(0), at(12)).length;
    const perEntry = encodeBackup(withLog(1), at(12)).length - base;
    const under = Math.floor((19_900_000 - base) / perEntry);
    const raw = encodeBackup(withLog(under), at(12));
    expect(raw.length).toBeGreaterThan(19_800_000);
    expect(raw.length).toBeLessThanOrEqual(20_000_000);
    expect(parseBackup(raw).state.lifeLog).toHaveLength(under);
    expect(() => encodeBackup(withLog(under + 100), at(12))).toThrow(/20 MB backup limit/);
  }, 60_000);
});

describe('the restore preview reports content a restore would replace', () => {
  it('reports a backup with the same IDs but older content, and removed goals', () => {
    const current = device();
    const day = Object.keys(current.days).sort()[10];
    const older: State = {
      ...current,
      days: {
        ...current.days,
        [day]: {
          ...current.days[day],
          blocks: current.days[day].blocks.map((b) => ({
            ...b,
            status: 'planned',
            actualAt: null,
          })),
        },
      },
      measurements: current.measurements.map((m, i) =>
        i === 0 ? { ...m, grams: m.grams + 900 } : m,
      ),
      goals: [],
    };
    // Rolled-back completions and a changed weight count as replaced, the missing goals as removed.
    const preview = restorePreview(current, older);
    expect(preview.changes.map((c) => [c.label, c.removed, c.replaced])).toEqual([
      ['goals', current.goals.length, 0],
      ['planned days', 0, 1],
      ['weights', 0, 1],
    ]);
  });
});

describe('known gap: damaged databases that load without an error', () => {
  it('keys a day by its payload date, not its row key', async () => {
    harness.raw = open();
    await storage().saveState(device());
    const row = harness.raw
      .prepare("SELECT date, payload FROM days WHERE date='2026-11-08'")
      .get()!;
    harness.raw
      .prepare('INSERT INTO days (date,payload) VALUES (?,?)')
      .run('2030-01-01', String(row.payload));
    const loaded = await storage().loadState();
    expect(Object.keys(loaded.days)).not.toContain('2030-01-01');
    expect(loaded.days['2026-11-08']).toEqual(device().days['2026-11-08']);
  });

  it('loads data rows without a metadata row as an empty state', async () => {
    harness.raw = open();
    await storage().saveState(device());
    harness.raw.exec('DELETE FROM metadata');
    const loaded = await storage().loadState();
    expect(loaded.programs).toEqual([]);
    // The rows are still on disk at this point; the next save would remove them.
    expect(harness.raw.prepare('SELECT COUNT(*) AS n FROM programs').get()!.n).toBeGreaterThan(0);
  });
});
