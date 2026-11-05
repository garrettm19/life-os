import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { State, emptyState } from '../domain/model';
import { decodeState } from '../domain/data';

// The device store. The state is kept in SQLite (`life-os.db`): one table per record type, each row
// a key and a JSON payload, and the remaining state fields (version, settings, notes and the like)
// in one `metadata` row. The schema is versioned with `PRAGMA user_version` and upgraded in one
// exclusive transaction; a database from a newer build is refused. A load decodes every row through
// `decodeState`. A save validates the state first, then, in one exclusive transaction, writes only
// the rows whose payload changed and deletes the removed ones; after a failed write the next save
// rewrites every row. The web build uses storage.web.ts instead (one localStorage document).
// Tests, on real SQLite through node:sqlite: __tests__/storage.test.ts, migration.test.ts,
// data-safety.test.ts and version-3-build.test.ts.

/** SQLite schema version. Independent of the app-state version and the backup format version. */
export const SCHEMA_VERSION = 5;

const V1 = `
  CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
  CREATE TABLE programs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE goals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE days (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
`;
// Version 2 adds one table per personal record type. Rows follow the existing pattern: a primary
// key and a validated JSON payload. Existing tables and rows are untouched.
const V2 = `
  CREATE TABLE measurements (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE life_log (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE workout_templates (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE money_reviews (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
`;
// Version 3 adds timed circuits and their sessions, duration activities, rulebooks and rule
// reviews, in the same row pattern.
const V3 = `
  CREATE TABLE interval_routines (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE interval_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE activity_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE rule_books (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE rule_reviews (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
`;
// Version 4 adds the focus, weekly reviews and skill checkpoints, in the same row pattern.
const V4 = `
  CREATE TABLE focuses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE weekly_reviews (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE skill_checkpoints (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
`;
// Version 5 adds each daily candle's trading session, keyed by its candle date, in the same row
// pattern. Earlier builds kept the sessions outside the database; they are moved in on load.
const V5 = `
  CREATE TABLE trading_sessions (date TEXT PRIMARY KEY, payload TEXT NOT NULL);
`;

let database: Promise<SQLiteDatabase> | undefined;
async function db() {
  database ??= (async () => {
    const connection = await openDatabaseAsync('life-os.db');
    await connection.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = async () =>
      (await connection.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
        ?.user_version ?? 0;
    const found = await version();
    if (found > SCHEMA_VERSION) throw new Error('This database needs a newer version of Life OS.');
    if (found < SCHEMA_VERSION)
      // One exclusive transaction: a failure part-way rolls back to the previous version and data.
      await connection.withExclusiveTransactionAsync(async (tx) => {
        await tx.execAsync(
          `${found === 0 ? V1 : ''}${found <= 1 ? V2 : ''}${found <= 2 ? V3 : ''}${found <= 3 ? V4 : ''}${V5} PRAGMA user_version = ${SCHEMA_VERSION};`,
        );
      });
    return connection;
  })();
  try {
    return await database;
  } catch (error) {
    database = undefined;
    throw error;
  }
}

const tables = {
  programs: 'id',
  goals: 'id',
  days: 'date',
  measurements: 'id',
  life_log: 'id',
  workout_templates: 'id',
  workout_sessions: 'id',
  money_reviews: 'id',
  interval_routines: 'id',
  interval_sessions: 'id',
  activity_sessions: 'id',
  rule_books: 'id',
  rule_reviews: 'id',
  focuses: 'id',
  weekly_reviews: 'id',
  skill_checkpoints: 'id',
  trading_sessions: 'date',
} as const;
type Table = keyof typeof tables;
type Rows = Record<Table, Map<string, string>>;

// Payloads known to be committed and valid, so a save rewrites and re-validates only changed rows.
// Unknown means validate and rewrite all.
let committed: Rows | undefined;

function rowsOf(state: State): { rows: Rows; metadata: Record<string, unknown> } {
  const {
    programs,
    goals,
    days,
    measurements,
    lifeLog,
    workoutTemplates,
    workoutSessions,
    moneyReviews,
    intervalRoutines,
    intervalSessions,
    activitySessions,
    ruleBooks,
    ruleReviews,
    focuses,
    weeklyReviews,
    skillCheckpoints,
    tradingSessions,
    ...metadata
  } = state;
  const byId = <T extends { id: string }>(items: T[]) =>
    new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  return {
    metadata,
    rows: {
      programs: byId(programs),
      goals: byId(goals),
      days: new Map(Object.values(days).map((d) => [d.date, JSON.stringify(d)])),
      measurements: byId(measurements),
      life_log: byId(lifeLog),
      workout_templates: byId(workoutTemplates),
      workout_sessions: byId(workoutSessions),
      money_reviews: byId(moneyReviews),
      interval_routines: byId(intervalRoutines),
      interval_sessions: byId(intervalSessions),
      activity_sessions: byId(activitySessions),
      rule_books: byId(ruleBooks),
      rule_reviews: byId(ruleReviews),
      focuses: byId(focuses),
      weekly_reviews: byId(weeklyReviews),
      skill_checkpoints: byId(skillCheckpoints),
      trading_sessions: new Map(
        Object.values(tradingSessions).map((t) => [t.date, JSON.stringify(t)]),
      ),
    },
  };
}

export async function loadState(): Promise<State> {
  // Rows become the committed snapshot only once they decode: a save after a failed load must
  // validate every row instead of trusting ones that were never read successfully.
  committed = undefined;
  const connection = await db();
  const meta = await connection.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM metadata WHERE id=1',
  );
  const rows = {} as Rows;
  for (const [table, key] of Object.entries(tables) as [Table, string][])
    rows[table] = new Map(
      (
        await connection.getAllAsync<{ key: string; payload: string }>(
          `SELECT ${key} AS key, payload FROM ${table}`,
        )
      ).map((r) => [r.key, r.payload]),
    );
  if (!meta) {
    committed = rows;
    return emptyState();
  }
  const parse = (table: Table) => [...rows[table].values()].map((p) => JSON.parse(p));
  const metadata = JSON.parse(meta.payload);
  // A database migrated from an older version still holds that version's metadata until the next
  // save; the decoder upgrades it with the newer record lists empty, which matches the new, empty
  // tables. Newer record rows beside older metadata would mean a damaged database, so they are
  // refused, not dropped.
  const v2Tables: Table[] = [
    'measurements',
    'life_log',
    'workout_templates',
    'workout_sessions',
    'money_reviews',
  ];
  const v3Tables: Table[] = [
    'interval_routines',
    'interval_sessions',
    'activity_sessions',
    'rule_books',
    'rule_reviews',
  ];
  const v4Tables: Table[] = ['focuses', 'weekly_reviews', 'skill_checkpoints'];
  const v5Tables: Table[] = ['trading_sessions'];
  const newer =
    metadata.version === 1
      ? [...v2Tables, ...v3Tables, ...v4Tables, ...v5Tables]
      : metadata.version === 2
        ? [...v3Tables, ...v4Tables, ...v5Tables]
        : metadata.version === 3
          ? [...v4Tables, ...v5Tables]
          : metadata.version === 4
            ? v5Tables
            : [];
  if (newer.some((table) => rows[table].size))
    throw new Error('Saved records do not match the saved plan version.');
  const records = {
    ...(metadata.version !== 1 && {
      measurements: parse('measurements'),
      lifeLog: parse('life_log'),
      workoutTemplates: parse('workout_templates'),
      workoutSessions: parse('workout_sessions'),
      moneyReviews: parse('money_reviews'),
    }),
    ...(metadata.version !== 1 &&
      metadata.version !== 2 && {
        intervalRoutines: parse('interval_routines'),
        intervalSessions: parse('interval_sessions'),
        activitySessions: parse('activity_sessions'),
        ruleBooks: parse('rule_books'),
        ruleReviews: parse('rule_reviews'),
      }),
    ...(metadata.version >= 4 && {
      focuses: parse('focuses'),
      weeklyReviews: parse('weekly_reviews'),
      skillCheckpoints: parse('skill_checkpoints'),
    }),
    ...(metadata.version >= 5 && {
      tradingSessions: Object.fromEntries(parse('trading_sessions').map((t) => [t.date, t])),
    }),
  };
  const state = decodeState({
    ...metadata,
    ...records,
    programs: parse('programs'),
    goals: parse('goals'),
    days: Object.fromEntries(parse('days').map((d) => [d.date, d])),
  });
  committed = rows;
  return state;
}

export async function saveState(state: State): Promise<void> {
  const { rows: next, metadata } = rowsOf(state);
  const previous = committed;
  // Days and trading sessions whose serialized content matches what is already saved were
  // validated when they were saved or loaded; only the changed ones (and everything else) are
  // checked again.
  const unchanged = (table: 'days' | 'trading_sessions') => {
    const same = new Set<string>();
    if (previous)
      for (const [date, payload] of next[table])
        if (previous[table].get(date) === payload) same.add(date);
    return same;
  };
  decodeState(state, {
    unchangedDays: unchanged('days'),
    unchangedSessions: unchanged('trading_sessions'),
  });
  const connection = await db();
  committed = undefined;
  await connection.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO metadata (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      JSON.stringify(metadata),
    );
    if (!previous)
      await tx.execAsync(
        Object.keys(tables)
          .map((table) => `DELETE FROM ${table};`)
          .join(' '),
      );
    for (const [table, key] of Object.entries(tables) as [Table, string][]) {
      const before = previous?.[table] ?? new Map<string, string>();
      for (const id of before.keys())
        if (!next[table].has(id)) await tx.runAsync(`DELETE FROM ${table} WHERE ${key}=?`, id);
      for (const [id, payload] of next[table])
        if (before.get(id) !== payload)
          await tx.runAsync(
            `INSERT INTO ${table} (${key},payload) VALUES (?,?) ON CONFLICT(${key}) DO UPDATE SET payload=excluded.payload`,
            id,
            payload,
          );
    }
  });
  committed = next;
}
