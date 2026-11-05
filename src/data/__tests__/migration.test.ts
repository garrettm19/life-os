import { beforeEach, expect, jest, test } from '@jest/globals';
import { withDay } from '../../domain/data';
import { basicState } from '../../test-support/basic-state';
import { ensureChecklistDay, generateDay, replanDay, setStatus } from '../../domain/planner';
import { State } from '../../domain/model';
import { trainingState } from '../../test-support/fixtures';
import { recordWeight } from '../../domain/measurements';
import { saveMoneyReview } from '../../domain/money';
import { saveLog } from '../../domain/lifelog';
import { finishSession, saveSession, startSession } from '../../domain/workouts';
import { CORE_CIRCUIT, completeCircuit, newCircuit, saveCircuit } from '../../domain/intervals';
import { recordActivity } from '../../domain/activity';
import { parseRules, saveRuleBook, saveRuleReview } from '../../domain/rules';
import { newSession } from '../../domain/trading';

// Real SQLite executes the production SQL; only the native bridge is substituted. Each test opens a
// fresh module (no cached connection) against a database it prepares first.
type Raw = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...p: (string | number)[]) => unknown;
    get: (...p: (string | number)[]) => Record<string, unknown> | undefined;
    all: (...p: (string | number)[]) => Record<string, unknown>[];
  };
};
const harness: { raw: Raw | null; fail: boolean } = { raw: null, fail: false };

type Connection = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: (string | number)[]) => Promise<unknown>;
  getFirstAsync: (sql: string) => Promise<unknown>;
  getAllAsync: (sql: string) => Promise<unknown>;
  withExclusiveTransactionAsync: (action: (tx: Connection) => Promise<void>) => Promise<void>;
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const raw = harness.raw!;
    const connection: Connection = {
      execAsync: async (sql: string) => raw.exec(sql),
      runAsync: async (sql: string, ...params: (string | number)[]) =>
        raw.prepare(sql).run(...params),
      getFirstAsync: async (sql: string) => raw.prepare(sql).get(),
      getAllAsync: async (sql: string) => raw.prepare(sql).all(),
      withExclusiveTransactionAsync: async (action) => {
        raw.exec('BEGIN');
        try {
          await action(connection);
          if (harness.fail) throw new Error('Injected migration failure');
          raw.exec('COMMIT');
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      },
    };
    return connection;
  },
}));

function freshDatabase(): Raw {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return new DatabaseSync(':memory:') as unknown as Raw;
}

/** A database exactly as version 1 of the app wrote it, holding a synthetic recorded history. */
function versionOneDatabase() {
  const raw = freshDatabase();
  raw.exec(`
    CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE programs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE days (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  const state = basicState();
  const day = generateDay('2026-11-09', state.settings, state.programs);
  const recorded = replanDay(
    setStatus(day, day.blocks[0].id, 'done', '2026-11-09T14:00:00.000Z'),
    state.settings,
    720,
    '2026-11-09T15:00:00.000Z',
  );
  const { programs, goals, settings, notes, source } = state;
  raw
    .prepare('INSERT INTO metadata (id,payload) VALUES (1,?)')
    .run(JSON.stringify({ version: 1, source, settings, notes }));
  for (const p of programs)
    raw.prepare('INSERT INTO programs (id,payload) VALUES (?,?)').run(p.id, JSON.stringify(p));
  for (const g of goals)
    raw.prepare('INSERT INTO goals (id,payload) VALUES (?,?)').run(g.id, JSON.stringify(g));
  raw
    .prepare('INSERT INTO days (date,payload) VALUES (?,?)')
    .run(recorded.date, JSON.stringify(recorded));
  const snapshot = () =>
    ['metadata', 'programs', 'goals', 'days'].map((t) =>
      raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
    );
  return { raw, recorded, programs, goals, snapshot };
}

async function storage() {
  let module: typeof import('../storage') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('../storage');
  });
  return module!;
}
const version = (raw: Raw) => raw.prepare('PRAGMA user_version').get()!.user_version;
const tables = (raw: Raw) =>
  raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

beforeEach(() => {
  harness.fail = false;
});

test('upgrading a version-1 database keeps every goal, program, day and revision', async () => {
  const db = versionOneDatabase();
  const before = db.snapshot();
  harness.raw = db.raw;
  const { loadState, saveState } = await storage();
  const state = await loadState();
  expect(version(db.raw)).toBe(5);
  expect(tables(db.raw)).toEqual(
    expect.arrayContaining([
      'measurements',
      'life_log',
      'workout_templates',
      'workout_sessions',
      'money_reviews',
      'interval_routines',
      'interval_sessions',
      'trading_sessions',
    ]),
  );
  // The migration only adds tables: existing rows are byte-for-byte unchanged.
  expect(db.snapshot()).toEqual(before);
  expect(state.version).toBe(5);
  expect(state.tradingSessions).toEqual({});
  expect(state.programs).toEqual(db.programs);
  expect(state.goals).toEqual(db.goals);
  expect(state.days[db.recorded.date]).toEqual(db.recorded);
  expect(state.days[db.recorded.date].revisions).toHaveLength(1);
  expect(state.measurements).toEqual([]);
  expect(state.workoutSessions).toEqual([]);
  // The first save writes version-5 metadata; the history reads back the same.
  await saveState(state);
  expect(await loadState()).toEqual(state);
});

test('opening an already migrated database again changes nothing', async () => {
  const db = versionOneDatabase();
  harness.raw = db.raw;
  const first = await (await storage()).loadState();
  const migrated = db.snapshot();
  const second = await (await storage()).loadState();
  expect(version(db.raw)).toBe(5);
  expect(second).toEqual(first);
  expect(db.snapshot()).toEqual(migrated);
});

test('a failure part-way through migration leaves the version-1 database exactly as it was', async () => {
  const db = versionOneDatabase();
  const before = db.snapshot();
  harness.raw = db.raw;
  harness.fail = true;
  await expect((await storage()).loadState()).rejects.toThrow('Injected migration failure');
  expect(version(db.raw)).toBe(1);
  expect(tables(db.raw)).toEqual(['days', 'goals', 'metadata', 'programs']);
  expect(db.snapshot()).toEqual(before);
  // The next launch retries and succeeds.
  harness.fail = false;
  const state = await (await storage()).loadState();
  expect(state.days[db.recorded.date]).toEqual(db.recorded);
});

test('a database from a newer app version is refused without being touched', async () => {
  const db = versionOneDatabase();
  db.raw.exec('PRAGMA user_version = 6');
  const before = db.snapshot();
  harness.raw = db.raw;
  await expect((await storage()).loadState()).rejects.toThrow(/newer version/);
  expect(version(db.raw)).toBe(6);
  expect(db.snapshot()).toEqual(before);
});

test('a new installation creates the full version-5 schema', async () => {
  harness.raw = freshDatabase();
  const { loadState } = await storage();
  expect((await loadState()).version).toBe(5);
  expect(version(harness.raw)).toBe(5);
  expect(tables(harness.raw)).toHaveLength(18);
  expect(tables(harness.raw)).toContain('trading_sessions');
});

test('record rows beside version-1 metadata are refused instead of silently dropped', async () => {
  const db = versionOneDatabase();
  harness.raw = db.raw;
  await (await storage()).loadState();
  db.raw
    .prepare('INSERT INTO measurements (id,payload) VALUES (?,?)')
    .run('m1', JSON.stringify({ id: 'm1' }));
  await expect((await storage()).loadState()).rejects.toThrow(/do not match/);
});

/** A database exactly as the version-2 build wrote it, holding synthetic personal records. */
function versionTwoDatabase() {
  const raw = freshDatabase();
  raw.exec(`
    CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE programs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE days (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE measurements (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE life_log (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE workout_templates (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE money_reviews (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    PRAGMA user_version = 2;
  `);
  const state = basicState();
  const day = generateDay('2026-11-09', state.settings, state.programs);
  const recorded = setStatus(day, day.blocks[0].id, 'done', '2026-11-09T14:00:00.000Z');
  const { programs, goals, settings, notes, source } = state;
  raw
    .prepare('INSERT INTO metadata (id,payload) VALUES (1,?)')
    .run(JSON.stringify({ version: 2, source, settings, notes }));
  for (const p of programs)
    raw.prepare('INSERT INTO programs (id,payload) VALUES (?,?)').run(p.id, JSON.stringify(p));
  for (const g of goals)
    raw.prepare('INSERT INTO goals (id,payload) VALUES (?,?)').run(g.id, JSON.stringify(g));
  raw
    .prepare('INSERT INTO days (date,payload) VALUES (?,?)')
    .run(recorded.date, JSON.stringify(recorded));
  const weight = {
    id: 'w1',
    kind: 'body-weight',
    grams: 81647,
    entered: { value: 180, unit: 'lb' },
    date: '2026-11-09',
    at: '2026-11-09T14:00:00.000Z',
    fasted: true,
    note: '',
    occurrenceId: null,
  };
  raw
    .prepare('INSERT INTO measurements (id,payload) VALUES (?,?)')
    .run('w1', JSON.stringify(weight));
  const snapshot = () =>
    ['metadata', 'programs', 'goals', 'days', 'measurements'].map((t) =>
      raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
    );
  return { raw, recorded, weight, snapshot };
}

test('upgrading a version-2 database keeps every record and adds the timed-circuit tables', async () => {
  const db = versionTwoDatabase();
  const before = db.snapshot();
  harness.raw = db.raw;
  const { loadState, saveState } = await storage();
  const state = await loadState();
  expect(version(db.raw)).toBe(5);
  expect(tables(db.raw)).toEqual(
    expect.arrayContaining(['interval_routines', 'interval_sessions']),
  );
  expect(tables(db.raw)).toHaveLength(18);
  // Only tables were added: every existing row is byte-for-byte unchanged.
  expect(db.snapshot()).toEqual(before);
  expect(state.version).toBe(5);
  expect(state.measurements).toEqual([db.weight]);
  expect(state.days[db.recorded.date]).toEqual(db.recorded);
  expect(state.intervalRoutines).toEqual([]);
  expect(state.intervalSessions).toEqual([]);
  await saveState(state);
  expect(await loadState()).toEqual(state);
});

test('a failure part-way through the version-3 migration leaves the version-2 database as it was', async () => {
  const db = versionTwoDatabase();
  const before = db.snapshot();
  const tablesBefore = tables(db.raw);
  harness.raw = db.raw;
  harness.fail = true;
  await expect((await storage()).loadState()).rejects.toThrow('Injected migration failure');
  expect(version(db.raw)).toBe(2);
  expect(tables(db.raw)).toEqual(tablesBefore);
  expect(db.snapshot()).toEqual(before);
  harness.fail = false;
  const state = await (await storage()).loadState();
  expect(state.measurements).toEqual([db.weight]);
});

test('circuit rows beside version-2 metadata are refused instead of silently dropped', async () => {
  const db = versionTwoDatabase();
  harness.raw = db.raw;
  await (await storage()).loadState();
  db.raw
    .prepare('INSERT INTO interval_sessions (id,payload) VALUES (?,?)')
    .run('s1', JSON.stringify({ id: 's1' }));
  await expect((await storage()).loadState()).rejects.toThrow(/do not match/);
});

// A version-2 state with every record type that build could hold: a workout plan with a
// finished, logged session, a weight, a money review, a log entry, and a day with its history.
const DAY = '2026-11-09';
const at = (h: number) => new Date(2026, 10, 9, h).toISOString();
function version2State(): State {
  let s = trainingState();
  s = withDay(s, ensureChecklistDay(DAY, s.settings, s.programs, undefined, at(9)));
  const block = s.days[DAY].blocks.find((b) => b.routineId === 'upper')!;
  s = startSession(s, DAY, block, at(10));
  const session = s.workoutSessions[0];
  const logged = {
    ...session,
    exercises: session.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((set, i) => ({ ...set, reps: 8 - i, load: 135, done: true })),
    })),
  };
  s = finishSession(saveSession(s, logged), DAY, block.id, logged, at(11));
  s = recordWeight(s, { value: 181.2, unit: 'lb', date: DAY, fasted: true, note: '' }, 'w1', at(8));
  s = saveMoneyReview(
    s,
    {
      date: DAY,
      currency: 'USD',
      cash: 1234_56,
      savings: null,
      debt: 9876_54,
      upcoming: null,
      contributed: null,
      savingsTarget: null,
      nextAction: 'Pay card',
      note: '',
      goalId: null,
    },
    'm1',
    at(12),
  );
  return saveLog(
    s,
    { date: DAY, text: 'Synthetic note', category: null, energy: 3, mood: null, goalId: null },
    'l1',
    at(13),
  );
}

/** Writes a state exactly as the version-2 build stored it: v2 tables and version-2 metadata. */
function versionTwoFrom(state: State) {
  const raw = freshDatabase();
  raw.exec(`
    CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE programs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE days (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE measurements (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE life_log (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE workout_templates (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE money_reviews (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    PRAGMA user_version = 2;
  `);
  const { programs, goals, days, settings, notes, source } = state;
  raw
    .prepare('INSERT INTO metadata (id,payload) VALUES (1,?)')
    .run(JSON.stringify({ version: 2, source, settings, notes }));
  const put = (table: string, key: string, payload: object) =>
    raw
      .prepare(`INSERT INTO ${table} (${table === 'days' ? 'date' : 'id'},payload) VALUES (?,?)`)
      .run(key, JSON.stringify(payload));
  for (const p of programs) put('programs', p.id, p);
  for (const g of goals) put('goals', g.id, g);
  for (const d of Object.values(days)) put('days', d.date, d);
  for (const m of state.measurements) put('measurements', m.id, m);
  for (const e of state.lifeLog) put('life_log', e.id, e);
  for (const t of state.workoutTemplates) put('workout_templates', t.id, t);
  for (const w of state.workoutSessions) put('workout_sessions', w.id, w);
  for (const r of state.moneyReviews) put('money_reviews', r.id, r);
  const snapshot = () =>
    [
      'metadata',
      'programs',
      'goals',
      'days',
      'measurements',
      'life_log',
      'workout_templates',
      'workout_sessions',
      'money_reviews',
    ].map((t) => raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());
  return { raw, snapshot };
}

test('a full version-2 database upgrades with every workout set, weight, money figure and day intact', async () => {
  const before = version2State();
  const db = versionTwoFrom(before);
  const rows = db.snapshot();
  harness.raw = db.raw;
  const { loadState, saveState } = await storage();
  const state = await loadState();
  expect(version(db.raw)).toBe(5);
  expect(db.snapshot()).toEqual(rows);
  for (const key of [
    'programs',
    'goals',
    'days',
    'measurements',
    'lifeLog',
    'workoutTemplates',
    'workoutSessions',
    'moneyReviews',
  ] as const)
    expect(state[key]).toEqual(before[key]);
  expect(state.workoutSessions[0].exercises[0].sets.map((x) => x.reps)).toEqual([8, 7, 6]);
  expect(state.moneyReviews[0]).toMatchObject({ cash: 1234_56, savings: null, debt: 9876_54 });
  // Opening again after the upgrade changes nothing; saving and reopening reads back the same.
  const again = await (await storage()).loadState();
  expect(again).toEqual(state);
  await saveState(state);
  expect(await (await storage()).loadState()).toEqual(state);
  // The first save writes version-5 metadata; the record rows themselves are unchanged by it.
  expect(
    JSON.parse(db.raw.prepare('SELECT payload FROM metadata').get()!.payload as string).version,
  ).toBe(5);
  expect(db.snapshot().slice(1)).toEqual(rows.slice(1));
});

test('every version-3 record type survives a save and a reopen', async () => {
  let s = version2State();
  s = {
    ...s,
    programs: s.programs.map((p) =>
      p.id === 'training'
        ? {
            ...p,
            routines: [
              ...p.routines,
              { ...p.routines[0], id: 'abs', title: 'Core', weekdays: [1] },
              { ...p.routines[0], id: 'cardio', title: 'Cardio', capture: 'activity' as const },
              {
                ...p.routines[0],
                id: 'rules',
                title: 'Rules',
                capture: 'rules' as const,
                private: true,
              },
            ],
          }
        : p,
    ),
  };
  s = saveCircuit(s, newCircuit('abs', 'Core', CORE_CIRCUIT, 'c1', at(9)));
  s = withDay(s, {
    ...s.days[DAY],
    blocks: [
      ...s.days[DAY].blocks,
      {
        ...s.days[DAY].blocks[0],
        id: `${DAY}:routine:abs`,
        routineId: 'abs',
        title: 'Core',
        status: 'planned',
        actualAt: null,
      },
    ],
  });
  s = completeCircuit(s, {
    intervalId: 'c1',
    date: DAY,
    blockId: `${DAY}:routine:abs`,
    startedAt: at(14),
    finishedAt: at(15),
    skipped: ['Toe Taps'],
  });
  s = recordActivity(
    s,
    { date: DAY, activity: 'Bike', minutes: 30, note: '', routineId: 'cardio' },
    'a1',
    at(16),
  );
  s = saveRuleBook(s, {
    id: 'b1',
    routineId: 'rules',
    title: 'Rules',
    checkpoints: [{ id: 'checkpoint-1', text: 'Planned first' }],
    rules: parseRules('1. Plan first'),
    updatedAt: at(9),
  });
  s = saveRuleReview(
    s,
    {
      date: DAY,
      routineId: 'rules',
      outcome: 'reviewed',
      answers: [{ checkpointId: 'checkpoint-1', answer: 'na' }],
      violations: ['rule-1'],
      note: '',
    },
    'r1',
    at(17),
  );
  harness.raw = freshDatabase();
  const { loadState, saveState } = await storage();
  await loadState();
  await saveState(s);
  const back = await (await storage()).loadState();
  expect(back).toEqual(s);
  expect(back.intervalSessions[0].skipped).toEqual(['Toe Taps']);
  expect(back.activitySessions).toHaveLength(1);
  expect(back.ruleReviews[0].violations).toEqual(['rule-1']);
});

// Version 4 adds the focus, weekly reviews and skill checkpoints (synthetic records).
const FOCUS = {
  id: 'f1',
  title: 'Interview readiness',
  goalId: null,
  outcome: 'Solve new medium problems under time',
  evidence: 'career' as const,
  routineIds: ['upper'],
  leadRoutineId: 'upper',
  cue: '',
  baseline: '',
  target: '',
  startDate: DAY,
  reviewDate: '2027-02-01',
  status: 'active' as const,
  endedAt: null,
  createdAt: at(9),
  updatedAt: at(9),
};
const REVIEW = {
  id: 'week-2026-11-09',
  weekStart: '2026-11-09',
  focusId: 'f1',
  obstacle: 'Late evenings',
  adjustment: 'Study before dinner',
  noChange: false,
  at: at(10),
  updatedAt: at(10),
};
const CHECKPOINT = {
  id: 'k1',
  date: DAY,
  at: at(11),
  method: 'Unseen problems',
  difficulty: 'medium' as const,
  attempted: 4,
  solved: 2,
  minutes: 60,
  fresh: true,
  topics: '',
  next: 'Graphs',
};

/** Rewrites a current database as the version-4 build left it: no version-5 table or metadata. */
function asVersionFour(raw: Raw) {
  raw.exec('DROP TABLE trading_sessions; PRAGMA user_version = 4;');
  const meta = JSON.parse(raw.prepare('SELECT payload FROM metadata').get()!.payload as string);
  delete meta.tradingSessionsImported;
  delete meta.tradingSessionsUnreadable;
  raw
    .prepare('UPDATE metadata SET payload=? WHERE id=1')
    .run(JSON.stringify({ ...meta, version: 4 }));
}

/** Rewrites a current database as the version-3 build left it: no version-4 tables or metadata. */
function asVersionThree(raw: Raw) {
  asVersionFour(raw);
  raw.exec(
    'DROP TABLE focuses; DROP TABLE weekly_reviews; DROP TABLE skill_checkpoints; PRAGMA user_version = 3;',
  );
  const meta = JSON.parse(raw.prepare('SELECT payload FROM metadata').get()!.payload as string);
  raw
    .prepare('UPDATE metadata SET payload=? WHERE id=1')
    .run(JSON.stringify({ ...meta, version: 3 }));
}

test('upgrading a version-3 database keeps every record and adds the version-4 tables', async () => {
  harness.raw = freshDatabase();
  const s = version2State();
  await (await storage()).saveState(s);
  asVersionThree(harness.raw);
  const before = (await storage()).loadState;
  const state = await before();
  expect(version(harness.raw)).toBe(5);
  expect(state.version).toBe(5);
  expect(state.focuses).toEqual([]);
  expect(state.tradingSessions).toEqual({});
  expect({
    ...state,
    focuses: undefined,
    weeklyReviews: undefined,
    skillCheckpoints: undefined,
  }).toEqual({
    ...s,
    focuses: undefined,
    weeklyReviews: undefined,
    skillCheckpoints: undefined,
    // Data from before the move keeps the device's trading records to move in on load.
    tradingSessionsImported: undefined,
  });
});

test('version-4 rows beside version-3 metadata are refused instead of silently dropped', async () => {
  harness.raw = freshDatabase();
  await (await storage()).saveState(version2State());
  asVersionThree(harness.raw);
  await (await storage()).loadState();
  const meta = JSON.parse(
    harness.raw.prepare('SELECT payload FROM metadata').get()!.payload as string,
  );
  expect(meta.version).toBe(3);
  harness.raw
    .prepare('INSERT INTO focuses (id,payload) VALUES (?,?)')
    .run('f1', JSON.stringify(FOCUS));
  await expect((await storage()).loadState()).rejects.toThrow(/do not match/);
});

test('the focus, weekly reviews and skill checkpoints survive a save and a reopen', async () => {
  const s = {
    ...version2State(),
    focuses: [FOCUS],
    weeklyReviews: [REVIEW],
    skillCheckpoints: [CHECKPOINT],
  };
  harness.raw = freshDatabase();
  const { loadState, saveState } = await storage();
  await loadState();
  await saveState(s);
  const back = await (await storage()).loadState();
  expect(back).toEqual(s);
});

// A candle's trading session, kept by its candle date since version 5. Synthetic: no price.
const SESSION = {
  ...newSession(DAY),
  bias: 'bullish' as const,
  biasAt: at(8),
  preparedAt: at(8),
  preflight: { at: at(8) },
};

test('upgrading a version-4 database keeps every record and adds the trading sessions table', async () => {
  harness.raw = freshDatabase();
  const s = { ...version2State(), focuses: [FOCUS], weeklyReviews: [REVIEW] };
  await (await storage()).saveState(s);
  asVersionFour(harness.raw);
  const rows = harness.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((t) => [t.name, harness.raw!.prepare(`SELECT * FROM ${t.name} ORDER BY 1`).all()]);
  const state = await (await storage()).loadState();
  expect(version(harness.raw)).toBe(5);
  expect(tables(harness.raw)).toContain('trading_sessions');
  expect(state.version).toBe(5);
  // Nothing invented: no session, and the device's own records are still to be moved in.
  expect(state.tradingSessions).toEqual({});
  expect(state.tradingSessionsImported).toBeUndefined();
  expect({ ...state, tradingSessionsImported: true }).toEqual(s);
  // Only a table was added: every existing row is unchanged.
  for (const [name, before] of rows)
    expect(harness.raw.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()).toEqual(before);
});

test('trading session rows beside version-4 metadata are refused instead of silently dropped', async () => {
  harness.raw = freshDatabase();
  await (await storage()).saveState(version2State());
  asVersionFour(harness.raw);
  await (await storage()).loadState();
  harness.raw
    .prepare('INSERT INTO trading_sessions (date,payload) VALUES (?,?)')
    .run(DAY, JSON.stringify(SESSION));
  await expect((await storage()).loadState()).rejects.toThrow(/do not match/);
});

test('trading sessions survive a save and a reopen, one row per candle date', async () => {
  const s = {
    ...version2State(),
    tradingSessions: { [DAY]: SESSION },
    tradingSessionsUnreadable: { '2026-11-06': '{not json' },
  };
  harness.raw = freshDatabase();
  const { loadState, saveState } = await storage();
  await loadState();
  await saveState(s);
  expect(harness.raw.prepare('SELECT date FROM trading_sessions').all()).toEqual([{ date: DAY }]);
  expect(await (await storage()).loadState()).toEqual(s);
  // A session that does not read back as one for its date is never saved.
  await expect(saveState({ ...s, tradingSessions: { '2026-11-10': SESSION } })).rejects.toThrow(
    /invalid trading session/,
  );
  expect(await (await storage()).loadState()).toEqual(s);
});
