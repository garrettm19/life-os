import { LOG_CATEGORIES, WeightUnit, dateObject } from './model';

// Validation for the personal records added in state version 2: measurements, the life log,
// workout templates and sessions, and money reviews. Every record is checked before it is saved,
// restored or loaded, so malformed data fails before anything is replaced.

type Raw = Record<string, unknown>;

export const LIMITS = {
  measurements: 20_000,
  lifeLog: 50_000,
  workoutTemplates: 200,
  workoutSessions: 20_000,
  moneyReviews: 5_000,
  intervalRoutines: 50,
  intervalSessions: 20_000,
  intervalSteps: 60,
  activitySessions: 20_000,
  ruleBooks: 20,
  ruleReviews: 20_000,
  rules: 100,
  studyStages: 8,
  /** One study stage: up to four hours. */
  studyStageMinutes: 240,
  /** One interval or rest: up to an hour. */
  intervalSeconds: 3_600,
  exercises: 50,
  sets: 30,
  logText: 2_000,
  note: 2_000,
  nextAction: 300,
  name: 120,
  /** Ten trillion minor units: far above any personal balance, far below float precision limits. */
  money: 10_000_000_000_000,
};

/** Grams per unit; weight is stored canonically in whole grams. */
const GRAMS: Record<WeightUnit, number> = { lb: 453.59237, kg: 1000 };

export function toGrams(value: number, unit: WeightUnit): number {
  return Math.round(value * GRAMS[unit]);
}

export function fromGrams(grams: number, unit: WeightUnit): number {
  return Math.round((grams / GRAMS[unit]) * 10) / 10;
}

export function fail(message: string): never {
  throw new Error(`The saved data contains ${message}.`);
}
export function rec(v: unknown, what: string): asserts v is Raw {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`an invalid ${what}`);
}
export function id(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) fail(`an invalid ${what} ID`);
}
export function ref(v: unknown, what: string) {
  if (v !== null) id(v, what);
}
export function str(v: unknown, max: number, what: string, required = false): asserts v is string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`invalid ${what}`);
}
export function date(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string') fail(`an invalid ${what} date`);
  try {
    dateObject(v);
  } catch {
    fail(`an invalid ${what} date`);
  }
}
export function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
export function stamp(v: unknown, what: string): asserts v is string {
  if (!isTimestamp(v)) fail(`an invalid ${what} timestamp`);
}
export function int(v: unknown, min: number, max: number, what: string, nullable = false) {
  if (nullable && v === null) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    fail(`an invalid ${what}`);
}
/** A positive decimal with at most two places (weights and loads as typed). */
function decimal(v: unknown, min: number, max: number, what: string, nullable = false) {
  if (nullable && v === null) return;
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    Math.abs(v * 100 - Math.round(v * 100)) > 1e-6
  )
    fail(`an invalid ${what}`);
}
function unit(v: unknown): asserts v is WeightUnit {
  if (v !== 'lb' && v !== 'kg') fail('an invalid weight unit');
}
export function list(v: unknown, max: number, what: string): asserts v is unknown[] {
  if (!Array.isArray(v) || v.length > max) fail(`an invalid ${what} list`);
}
export function unique(seen: Set<string>, key: string, what: string) {
  if (seen.has(key)) fail(`a duplicate ${what}`);
  seen.add(key);
}

export function validateMeasurements(v: unknown): void {
  list(v, LIMITS.measurements, 'measurement');
  const ids = new Set<string>();
  const occurrences = new Set<string>();
  const dates = new Set<string>();
  for (const m of v) {
    rec(m, 'measurement');
    id(m.id, 'measurement');
    unique(ids, m.id, 'measurement ID');
    if (m.kind !== 'body-weight') fail('an unknown measurement kind');
    rec(m.entered, 'measurement value');
    unit(m.entered.unit);
    // 20–700 lb (9–318 kg): wide enough for any adult, narrow enough to catch typos like 1804.
    decimal(
      m.entered.value,
      m.entered.unit === 'lb' ? 20 : 9,
      m.entered.unit === 'lb' ? 700 : 318,
      'weight',
    );
    int(m.grams, 1, 400_000, 'weight');
    if (m.grams !== toGrams(m.entered.value as number, m.entered.unit))
      fail('a weight that does not match its entered value');
    date(m.date, 'measurement');
    stamp(m.at, 'measurement');
    if (m.fasted !== null && typeof m.fasted !== 'boolean') fail('an invalid fasted flag');
    str(m.note, LIMITS.note, 'measurement note');
    ref(m.occurrenceId, 'objective');
    if (m.occurrenceId !== null)
      unique(occurrences, m.occurrenceId as string, 'measurement for one objective');
    // One weight per local date, also for restored files.
    unique(dates, `${m.kind}:${m.date}`, 'weight for one date');
  }
}

export function validateLifeLog(v: unknown): void {
  list(v, LIMITS.lifeLog, 'log entry');
  const ids = new Set<string>();
  for (const e of v) {
    rec(e, 'log entry');
    id(e.id, 'log entry');
    unique(ids, e.id, 'log entry ID');
    date(e.date, 'log entry');
    stamp(e.at, 'log entry');
    str(e.text, LIMITS.logText, 'log text', true);
    if (
      e.category !== null &&
      !LOG_CATEGORIES.includes(e.category as (typeof LOG_CATEGORIES)[number])
    )
      fail('an unknown log category');
    int(e.energy, 1, 5, 'energy rating', true);
    int(e.mood, 1, 5, 'mood rating', true);
    ref(e.goalId, 'goal');
  }
}

function validatePlan(p: Raw, what: string) {
  if (p.kind !== undefined && p.kind !== 'time') fail(`an invalid ${what} kind`);
  if (p.seconds !== undefined) int(p.seconds, 1, 7200, `${what} target time`, true);
  int(p.sets, 1, 20, `${what} set count`);
  int(p.repsMin, 1, 100, `${what} rep target`);
  int(p.repsMax, 1, 100, `${what} rep range`, true);
  if (p.repsMax !== null && (p.repsMax as number) < (p.repsMin as number))
    fail(`a ${what} rep range that ends before it starts`);
  decimal(p.load, 0, 2000, `${what} load`, true);
}

export function validateWorkoutTemplates(v: unknown): void {
  list(v, LIMITS.workoutTemplates, 'workout template');
  const ids = new Set<string>();
  const routines = new Set<string>();
  for (const t of v) {
    rec(t, 'workout template');
    id(t.id, 'workout template');
    unique(ids, t.id, 'workout template ID');
    id(t.routineId, 'routine');
    unique(routines, t.routineId, 'workout plan for one routine');
    str(t.title, 200, 'workout title', true);
    str(t.note, LIMITS.note, 'workout note');
    stamp(t.updatedAt, 'workout template');
    list(t.exercises, LIMITS.exercises, 'exercise');
    const exercises = new Set<string>();
    for (const e of t.exercises) {
      rec(e, 'exercise');
      id(e.id, 'exercise');
      unique(exercises, e.id, 'exercise in one workout');
      str(e.name, LIMITS.name, 'exercise name', true);
      validatePlan(e, 'exercise');
      unit(e.unit);
      int(e.restSeconds, 0, 3600, 'rest time', true);
      str(e.note, LIMITS.note, 'exercise note');
    }
  }
}

export function validateWorkoutSessions(v: unknown): void {
  list(v, LIMITS.workoutSessions, 'workout session');
  const ids = new Set<string>();
  for (const s of v) {
    rec(s, 'workout session');
    id(s.occurrenceId, 'workout occurrence');
    if (s.id !== `session:${s.occurrenceId}`) fail('a workout session with a mismatched ID');
    unique(ids, s.id as string, 'workout session');
    id(s.templateId, 'workout template');
    id(s.routineId, 'routine');
    date(s.scheduledDate, 'scheduled workout');
    date(s.date, 'workout');
    stamp(s.startedAt, 'workout start');
    if (s.status === 'completed') stamp(s.finishedAt, 'workout finish');
    else if (s.status === 'active') {
      if (s.finishedAt !== null) fail('an unfinished workout with a finish time');
    } else fail('an invalid workout status');
    str(s.note, LIMITS.note, 'workout note');
    list(s.exercises, LIMITS.exercises, 'session exercise');
    for (const e of s.exercises) {
      rec(e, 'session exercise');
      id(e.exerciseId, 'exercise');
      str(e.name, LIMITS.name, 'exercise name', true);
      unit(e.unit);
      rec(e.plan, 'exercise plan');
      validatePlan(e.plan, 'planned');
      if (e.kind !== undefined && e.kind !== 'time') fail('an invalid exercise kind');
      if (e.substitutedFor !== undefined) {
        rec(e.substitutedFor, 'substituted exercise');
        id(e.substitutedFor.exerciseId, 'substituted exercise');
        str(e.substitutedFor.name, LIMITS.name, 'substituted exercise name', true);
      }
      list(e.sets, LIMITS.sets, 'set');
      for (const set of e.sets) {
        rec(set, 'set');
        int(set.reps, 0, 1000, 'rep count', true);
        decimal(set.load, 0, 2000, 'load', true);
        if (set.seconds !== undefined) int(set.seconds, 1, 86_400, 'set time', true);
        if (typeof set.done !== 'boolean') fail('an invalid set status');
        // A timed set records its seconds; any other set its reps.
        if (set.done && (e.kind === 'time' ? set.seconds == null : set.reps === null))
          fail(
            e.kind === 'time'
              ? 'a completed timed set without its time'
              : 'a completed set without reps',
          );
      }
    }
    // A finished workout is evidence of performance: it needs at least one performed set.
    if (
      s.status === 'completed' &&
      !(s.exercises as { sets: { done: boolean }[] }[]).some((e) => e.sets.some((set) => set.done))
    )
      fail('a finished workout without any logged set');
  }
}

export function validateMoneyReviews(v: unknown): void {
  list(v, LIMITS.moneyReviews, 'money review');
  const ids = new Set<string>();
  const occurrences = new Set<string>();
  for (const r of v) {
    rec(r, 'money review');
    id(r.id, 'money review');
    unique(ids, r.id, 'money review ID');
    date(r.date, 'money review');
    stamp(r.at, 'money review');
    if (typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency))
      fail('an invalid currency');
    for (const key of ['cash', 'savings', 'debt', 'upcoming', 'contributed', 'savingsTarget'])
      int(r[key], 0, LIMITS.money, 'amount', true);
    str(r.nextAction, LIMITS.nextAction, 'next action');
    if (r.priorityDoneAt !== undefined && r.priorityDoneAt !== null)
      stamp(r.priorityDoneAt, 'priority');
    str(r.note, LIMITS.note, 'money note');
    ref(r.goalId, 'goal');
    ref(r.occurrenceId, 'objective');
    if (r.occurrenceId !== null)
      unique(occurrences, r.occurrenceId as string, 'review for one objective');
  }
}

/** Moved-out markers on a day: one per routine, each pointing at another valid date. */
export function validateMoved(v: unknown, day: string): void {
  if (v === undefined) return;
  list(v, 100, 'moved occurrence');
  const routines = new Set<string>();
  for (const m of v) {
    rec(m, 'moved occurrence');
    id(m.routineId, 'routine');
    unique(routines, m.routineId, 'move of one routine');
    date(m.to, 'move target');
    if (m.to === day) fail('an occurrence moved onto its own day');
    stamp(m.at, 'move');
  }
}

function validatePlanIntervals(p: Raw, what: string) {
  int(p.prepSeconds, 0, 600, `${what} preparation time`);
  list(p.steps, LIMITS.intervalSteps, `${what} interval`);
  if (!p.steps.length) fail(`a ${what} without intervals`);
  const ids = new Set<string>();
  for (const step of p.steps) {
    rec(step, `${what} interval`);
    id(step.id, `${what} interval`);
    unique(ids, step.id, `interval in one ${what}`);
    str(step.name, LIMITS.name, `${what} interval name`, true);
    int(step.seconds, 1, LIMITS.intervalSeconds, `${what} interval length`);
    int(step.restAfter, 0, LIMITS.intervalSeconds, `${what} rest length`);
  }
}

export function validateIntervalRoutines(v: unknown): void {
  list(v, LIMITS.intervalRoutines, 'timed circuit');
  const ids = new Set<string>();
  const routines = new Set<string>();
  for (const t of v) {
    rec(t, 'timed circuit');
    id(t.id, 'timed circuit');
    unique(ids, t.id, 'timed circuit ID');
    id(t.routineId, 'routine');
    unique(routines, t.routineId, 'timed circuit for one routine');
    str(t.title, 200, 'circuit title', true);
    stamp(t.updatedAt, 'timed circuit');
    validatePlanIntervals(t, 'circuit');
    rec(t.original, 'original circuit');
    validatePlanIntervals(t.original, 'original circuit');
  }
}

export function validateIntervalSessions(v: unknown): void {
  list(v, LIMITS.intervalSessions, 'circuit session');
  const ids = new Set<string>();
  for (const s of v) {
    rec(s, 'circuit session');
    id(s.id, 'circuit session');
    unique(ids, s.id, 'circuit session');
    id(s.intervalId, 'timed circuit');
    id(s.routineId, 'routine');
    ref(s.occurrenceId, 'objective');
    // One session per objective occurrence, by construction of the ID.
    if (s.occurrenceId !== null && s.id !== `interval:${s.occurrenceId}`)
      fail('a circuit session with a mismatched ID');
    date(s.date, 'circuit session');
    stamp(s.startedAt, 'circuit start');
    stamp(s.finishedAt, 'circuit finish');
    if ((s.finishedAt as string) < (s.startedAt as string))
      fail('a circuit that finished before it started');
    // Up to the longest valid plan: 60 intervals of an hour plus an hour's rest, plus preparation.
    int(s.plannedSeconds, 1, 500_000, 'circuit length');
    list(s.skipped, LIMITS.intervalSteps, 'skipped interval');
    for (const name of s.skipped) str(name, LIMITS.name, 'skipped interval name', true);
  }
}

/** A program's rotation: its own routines, each once, default rest weekdays. */
export function validateRotation(v: unknown, routineIds: Set<string>): void {
  if (v === undefined) return;
  rec(v, 'rotation');
  list(v.order, 100, 'rotation workout');
  if (!v.order.length) fail('a rotation without workouts');
  const seen = new Set<string>();
  for (const r of v.order) {
    id(r, 'rotation workout');
    if (!routineIds.has(r)) fail('a rotation workout from another program');
    unique(seen, r, 'workout in one rotation');
  }
  list(v.restDays, 7, 'rest day');
  const days = new Set<string>();
  for (const d of v.restDays) {
    int(d, 0, 6, 'rest weekday');
    unique(days, String(d), 'rest weekday');
  }
  if (v.restDays.length === 7) fail('a rotation with no training day');
  ref(v.startWith, 'rotation start');
  if (v.startWith !== null && !seen.has(v.startWith as string)) fail('an invalid rotation start');
  if (v.previous !== undefined) {
    list(v.previous, 100, 'earlier schedule');
    const remembered = new Set<string>();
    for (const p of v.previous) {
      rec(p, 'earlier schedule');
      id(p.routineId, 'routine');
      unique(remembered, p.routineId, 'earlier schedule for one workout');
      if (p.weekdays !== null) {
        list(p.weekdays, 7, 'earlier weekday');
        for (const d of p.weekdays) int(d, 0, 6, 'earlier weekday');
      }
      if (typeof p.checklist !== 'boolean') fail('an invalid earlier schedule');
    }
  }
}

/** Rest or train choices on one day: one per program. */
export function validateOverrides(v: unknown): void {
  if (v === undefined) return;
  list(v, 100, 'rotation choice');
  const programs = new Set<string>();
  for (const o of v) {
    rec(o, 'rotation choice');
    id(o.programId, 'program');
    unique(programs, o.programId, 'rotation choice for one program');
    if (o.mode !== 'rest' && o.mode !== 'train') fail('an invalid rotation choice');
    stamp(o.at, 'rotation choice');
  }
}

/** A daily alternation: a valid anchor date and two to seven named variants. */
export function validateAlternate(v: unknown): void {
  if (v === undefined) return;
  rec(v, 'alternation');
  date(v.anchor, 'alternation');
  list(v.variants, 7, 'alternation variant');
  if (v.variants.length < 2) fail('an alternation with fewer than two variants');
  for (const variant of v.variants) {
    rec(variant, 'alternation variant');
    str(variant.title, 200, 'variant name', true);
    list(variant.steps, 100, 'variant step');
    for (const step of variant.steps) str(step, 500, 'variant step');
  }
}

/**
 * A morning anchor: its times, each from a date, oldest first with no two from the same date,
 * each a whole minute of the day. Nothing else is accepted, so a later build's field is never
 * half-read.
 */
export function validateAnchor(v: unknown): void {
  if (v === undefined) return;
  rec(v, 'morning anchor');
  if (Object.keys(v).some((k) => k !== 'history')) fail('an invalid morning anchor');
  list(v.history, 500, 'morning anchor time');
  if (!v.history.length) fail('a morning anchor without a time');
  let last = '';
  for (const e of v.history) {
    rec(e, 'morning anchor time');
    if (Object.keys(e).some((k) => k !== 'from' && k !== 'upBy'))
      fail('an invalid morning anchor time');
    date(e.from, 'morning anchor');
    if ((e.from as string) <= last) fail('morning anchor times out of order');
    last = e.from as string;
    int(e.upBy, 0, 1439, 'morning anchor time');
  }
}

/** Links on an objective: a label and an https address. */
export function validateLinks(v: unknown): void {
  if (v === undefined) return;
  list(v, 10, 'link');
  for (const link of v) {
    rec(link, 'link');
    str(link.label, 120, 'link label', true);
    str(link.url, 2000, 'link address', true);
    if (!/^https:\/\/[^\s]+$/i.test(link.url as string))
      fail('a link that is not an https address');
  }
}

/** Companion links: other routine IDs, each once, never itself. */
export function validateFollows(v: unknown, self: string): void {
  if (v === undefined) return;
  list(v, 50, 'companion link');
  const seen = new Set<string>();
  for (const r of v) {
    id(r, 'companion link');
    if (r === self) fail('a routine that follows itself');
    unique(seen, r, 'companion link');
  }
}

export function validateActivitySessions(v: unknown): void {
  list(v, LIMITS.activitySessions, 'activity');
  const ids = new Set<string>();
  const occurrences = new Set<string>();
  for (const a of v) {
    rec(a, 'activity');
    id(a.id, 'activity');
    unique(ids, a.id, 'activity ID');
    date(a.date, 'activity');
    stamp(a.at, 'activity');
    ref(a.routineId, 'routine');
    ref(a.occurrenceId, 'objective');
    if (a.occurrenceId !== null)
      unique(occurrences, a.occurrenceId as string, 'activity for one objective');
    str(a.activity, LIMITS.name, 'activity type', true);
    int(a.minutes, 1, 1440, 'activity minutes');
    str(a.note, LIMITS.note, 'activity note');
    if (a.study !== undefined) validateStudyRecord(a.study, a.minutes as number);
  }
}

/** What a study session actually ran: stage clocks never above plan, minutes their whole total. */
function validateStudyRecord(v: unknown, minutes: number): void {
  rec(v, 'study session');
  stamp(v.startedAt, 'study session');
  list(v.stages, LIMITS.studyStages, 'study stage');
  if (!v.stages.length) fail('a study session without stages');
  const ids = new Set<string>();
  let seconds = 0;
  let open = false;
  for (const s of v.stages) {
    rec(s, 'study stage');
    id(s.id, 'study stage');
    unique(ids, s.id, 'study stage');
    str(s.title, LIMITS.name, 'study stage name', true);
    int(s.plannedSeconds, 60, LIMITS.studyStageMinutes * 60, 'study stage length');
    int(s.seconds, 0, s.plannedSeconds as number, 'study stage time');
    if (typeof s.done !== 'boolean') fail('an invalid study stage status');
    // Stages are confirmed in order: none is done after one that is not.
    if (s.done && open) fail('a study stage done after an unfinished one');
    if (!s.done) open = true;
    seconds += s.seconds as number;
  }
  if (Math.floor(seconds / 60) !== minutes) fail('study minutes that do not match their stages');
}

/** A study objective's plan: named stages with whole minutes, links, time and reminders. */
export function validateStudyPlan(v: unknown): void {
  rec(v, 'study plan');
  list(v.stages, LIMITS.studyStages, 'study stage');
  if (!v.stages.length) fail('a study plan without stages');
  const ids = new Set<string>();
  let total = 0;
  for (const s of v.stages) {
    rec(s, 'study stage');
    id(s.id, 'study stage');
    unique(ids, s.id, 'study stage');
    str(s.title, LIMITS.name, 'study stage name', true);
    int(s.minutes, 1, LIMITS.studyStageMinutes, 'study stage minutes');
    list(s.links, 5, 'study link');
    validateLinks(s.links);
    total += s.minutes as number;
  }
  if (total > 720) fail('a study plan longer than 12 hours');
  int(v.at, 0, 1439, 'study time', true);
  rec(v.reminders, 'study reminders');
  if (typeof v.reminders.start !== 'boolean' || typeof v.reminders.stageEnd !== 'boolean')
    fail('invalid study reminders');
  int(v.reminders.evening, 0, 1439, 'evening reminder time', true);
  if (v.trackFrom !== undefined) date(v.trackFrom, 'study tracking start');
  if (v.cue !== undefined) str(v.cue, 80, 'study cue', true);
  if (v.schedule !== undefined) {
    list(v.schedule, 500, 'study schedule');
    let last = '';
    for (const e of v.schedule) {
      rec(e, 'study schedule entry');
      date(e.from, 'study schedule');
      if ((e.from as string) <= last) fail('a study schedule out of order');
      last = e.from as string;
      list(e.weekdays, 7, 'study schedule weekday');
      for (const d of e.weekdays) int(d, 0, 6, 'study schedule weekday');
      if (typeof e.enabled !== 'boolean') fail('an invalid study schedule');
    }
  }
}

export function validateRuleBooks(v: unknown): void {
  list(v, LIMITS.ruleBooks, 'rulebook');
  const ids = new Set<string>();
  const routines = new Set<string>();
  for (const b of v) {
    rec(b, 'rulebook');
    id(b.id, 'rulebook');
    unique(ids, b.id, 'rulebook ID');
    id(b.routineId, 'routine');
    unique(routines, b.routineId, 'rulebook for one routine');
    str(b.title, 200, 'rulebook title', true);
    stamp(b.updatedAt, 'rulebook');
    list(b.checkpoints, 30, 'checkpoint');
    const checkpoints = new Set<string>();
    for (const c of b.checkpoints) {
      rec(c, 'checkpoint');
      id(c.id, 'checkpoint');
      unique(checkpoints, c.id, 'checkpoint in one rulebook');
      str(c.text, 300, 'checkpoint', true);
    }
    list(b.rules, LIMITS.rules, 'rule');
    const rules = new Set<string>();
    for (const r of b.rules) {
      rec(r, 'rule');
      id(r.id, 'rule');
      unique(rules, r.id, 'rule in one rulebook');
      str(r.title, 300, 'rule title', true);
      str(r.details, 4000, 'rule details');
    }
    if (b.trading !== undefined) validateTradingProfile(b.trading);
    else if (!b.checkpoints.length && !b.rules.length) fail('an empty rulebook');
  }
}

/** The eight daily process items: the score is out of exactly this many. */
const TRADING_CHECKLIST_SIZE = 8;

function tradingItems(v: unknown, max: number, what: string, exact?: number) {
  list(v, max, what);
  if (exact !== undefined && v.length !== exact) fail(`an invalid ${what} list`);
  const ids = new Set<string>();
  for (const item of v) {
    rec(item, what);
    id(item.id, what);
    unique(ids, item.id, `${what} ID`);
    str(item.title, 300, `${what} title`, true);
    str(item.details, 4000, `${what} details`);
  }
}

/** The most entries a profile can allow in one day. */
export const MAX_ENTRIES = 10;
/** The most losses in a row a session's loss run can be set to. */
export const MAX_LOSS_RUN = 5;
/**
 * The longest entry log: entries taken outside the rules are logged past the limit too, up to the
 * most a review can report.
 */
export const MAX_ENTRY_LOG = 99;
/** The most hard violations a trading process holds. */
export const MAX_VIOLATIONS = 30;
/** The longest line on the session thesis card. */
export const THESIS_LINE = 160;

const THESIS_FIELDS = ['expectation', 'gexReason', 'objective', 'zone', 'invalidation'] as const;
const OUTSIDE_RULES = ['conditions', 'done', 'reset', 'nothing-new', 'window', 'limit'];
const PERMISSIONS = [
  'sweep-reclaim',
  'displacement',
  'cisd',
  'rejection',
  'structure-shift',
  'break-retest',
  'other',
];

/** The highest price, point value or dollar limit kept: far above any market, below float limits. */
export const PRICE_MAX = 10_000_000;
export const GEX_KIND_IDS = [
  'call-wall',
  'put-wall',
  'gamma-flip',
  'vol-trigger',
  'focus',
  'other',
];
export const SETUP_IDS = ['pierce-push', 'sweep-retake', 'double-pierce'];
const TIMEFRAMES = ['5m', '15m'];
/** The exits of a trade closed in one piece; a runner left open ends with one of `RUNNER_EXITS`. */
const EXIT_KINDS = ['objective', 'stopped', 'flat'];
const RUNNER_EXITS = ['expansion', 'runner-stopped', 'runner-structure'];
const REGIME_KINDS = ['range', 'candidate', 'confirmed'];
const REGIME_CONTEXTS = ['daily', 'four-day'];
const RUNNER_STOP_PLANS = ['breakeven', 'original'];
/** The review's six discipline questions, by key. */
export const DISCIPLINE_KEYS = [
  'labeled',
  'distinguished',
  'withBias',
  'namedSetups',
  'noPrediction',
  'followedPlan',
] as const;
/** The most accounts one execution is copied to. */
export const MAX_ACCOUNTS = 20;
/** The most contracts one entry can plan, per account. */
export const MAX_CONTRACTS = 99;
/** The longest instrument name. */
export const INSTRUMENT_NAME = 40;

/** One line of the thesis card: trimmed, one line, 1 to 160 characters. */
export function thesisLine(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || !v || v.length > THESIS_LINE || v !== v.trim() || /[\r\n]/.test(v))
    fail(`an invalid thesis ${what}`);
}

/** A price, a point value or a dollar amount: a finite number above zero, up to `PRICE_MAX`. */
export function positive(v: unknown, what: string, nullable = false): void {
  if (nullable && v === null) return;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > PRICE_MAX)
    fail(`an invalid ${what}`);
}

/** One mapped GEX area: its kind, price, optional zone and the lock it was mapped under. */
export function validateGexArea(v: unknown): void {
  rec(v, 'GEX area');
  if (!GEX_KIND_IDS.includes(v.kind as string)) fail('an invalid GEX kind');
  positive(v.price, 'GEX price');
  positive(v.zone, 'GEX zone', true);
  if (v.lock !== 'evening' && v.lock !== 'morning') fail('an invalid GEX lock');
  date(v.candle, 'GEX candle');
  stamp(v.at, 'GEX area');
}

/**
 * One classification of the HTF candle: its kind and context, when it was made, and the three
 * evidence answers, which a confirmed expansion always has and no other kind does.
 */
export function validateRegime(v: unknown): void {
  rec(v, 'candle classification');
  if (!REGIME_KINDS.includes(v.kind as string)) fail('an invalid candle classification');
  if (!REGIME_CONTEXTS.includes(v.context as string)) fail('an invalid classification context');
  stamp(v.at, 'candle classification');
  if (v.kind === 'confirmed') {
    rec(v.evidence, 'expansion evidence');
    const e = v.evidence;
    if (e.displacement !== true || e.structure !== true || e.room !== true)
      fail('a confirmed expansion without all its evidence');
  } else if (v.evidence !== undefined) fail('expansion evidence on an unconfirmed candle');
}

/**
 * Whether the targets sit in the order the side needs: for a long the invalidation (or stop)
 * below the normal target below the expansion target, for a short the inverse. Each price is
 * strictly beyond the one before it.
 */
export function inOrder(side: unknown, prices: number[]): boolean {
  const up = side === 'long';
  return prices.every((p, i) => i === 0 || (up ? p > prices[i - 1] : p < prices[i - 1]));
}

/** A session thesis card, on the device's session or copied onto its review. */
export function validateThesisCard(v: unknown): void {
  rec(v, 'thesis card');
  // Cards committed before the direction was kept have none.
  if (v.direction !== undefined && v.direction !== 'long' && v.direction !== 'short')
    fail('an invalid thesis direction');
  for (const field of THESIS_FIELDS) thesisLine(v[field], field);
  if (v.addPlan !== null) thesisLine(v.addPlan, 'add plan');
  stamp(v.committedAt, 'thesis card');
  // Cards committed before the cockpit have no prices; the objective and invalidation go together.
  if ((v.objectivePrice === undefined) !== (v.invalidationPrice === undefined))
    fail('a thesis card with only one of its prices');
  if (v.objectivePrice !== undefined) {
    positive(v.objectivePrice, 'thesis objective price');
    positive(v.invalidationPrice, 'thesis invalidation price');
    if (v.objectivePrice === v.invalidationPrice) fail('a thesis objective at its invalidation');
    if (v.direction !== undefined) {
      const long = (v.objectivePrice as number) > (v.invalidationPrice as number);
      if (long !== (v.direction === 'long')) fail('a thesis objective on the wrong side');
    }
  }
  // The expansion objective lies beyond the normal one, and only a card with prices has one.
  if (v.expansionPrice !== undefined) {
    if (v.objectivePrice === undefined || v.direction === undefined)
      fail('an expansion objective without a normal objective');
    positive(v.expansionPrice, 'thesis expansion price');
    if (!inOrder(v.direction, [v.objectivePrice as number, v.expansionPrice as number]))
      fail('an expansion objective short of the normal objective');
  }
  if (v.gex !== undefined) validateGexArea(v.gex);
  if (v.regime !== undefined) {
    validateRegime(v.regime);
    // An expansion candidate or a confirmed expansion is locked with its expansion objective.
    if (v.objectivePrice === undefined) fail('a classified thesis card without prices');
    if ((v.regime as Raw).kind !== 'range' && v.expansionPrice === undefined)
      fail('an expansion thesis card without its expansion objective');
  }
}

/**
 * An entry's plan: the entry, the stop on the losing side, the contracts, the normal target beyond
 * the entry and the expansion target beyond that when there is one; a runner only with an
 * expansion target, from 1 to all but one contract, with one of the fixed stop plans.
 */
function validateEntryPlan(v: unknown, side: unknown): void {
  rec(v, 'entry plan');
  positive(v.entry, 'planned entry price');
  positive(v.stop, 'planned stop price');
  int(v.contracts, 1, MAX_CONTRACTS, 'planned contracts');
  positive(v.normalTarget, 'planned normal target');
  if (v.expansionTarget !== undefined) positive(v.expansionTarget, 'planned expansion target');
  const prices = [v.stop, v.entry, v.normalTarget, v.expansionTarget].filter(
    (p) => p !== undefined,
  ) as number[];
  if (!inOrder(side, prices)) fail('a planned stop or target on the wrong side');
  if (v.runner !== undefined) {
    rec(v.runner, 'planned runner');
    if (v.expansionTarget === undefined) fail('a planned runner without an expansion target');
    int(v.runner.contracts, 1, (v.contracts as number) - 1, 'runner contracts');
    if (!RUNNER_STOP_PLANS.includes(v.runner.stopPlan as string))
      fail('an invalid runner stop plan');
  }
}

/**
 * The entries logged in one session, oldest first: the first is the entry, every later one an
 * add, all on the bias's side, and only an add can be unplanned. An entry that followed the rules
 * had every condition confirmed; one taken outside them names the rules it broke, and only one
 * outside `conditions` can have a condition unconfirmed.
 */
export function validateEntryLog(v: unknown): void {
  list(v, MAX_ENTRY_LOG, 'logged entry');
  let previous = '';
  v.forEach((e, i) => {
    rec(e, 'logged entry');
    stamp(e.at, 'logged entry');
    if (e.at < previous) fail('logged entries out of order');
    previous = e.at;
    if (e.kind !== (i === 0 ? 'entry' : 'add')) fail('an invalid logged entry kind');
    if (e.side !== 'long' && e.side !== 'short') fail('an invalid logged entry side');
    if (i > 0 && e.side !== (v[0] as Raw).side) fail('logged entries on both sides');
    const outside = e.outsideRules;
    if (outside !== undefined) {
      list(outside, OUTSIDE_RULES.length, 'rule an entry was taken outside of');
      if (
        !outside.length ||
        new Set(outside).size !== outside.length ||
        outside.some((r) => !OUTSIDE_RULES.includes(r as string))
      )
        fail('an invalid entry taken outside the rules');
    }
    if (e.permission !== null && !PERMISSIONS.includes(e.permission as string))
      fail('an invalid entry permission');
    for (const condition of [e.zone, e.gexSupports, e.invalidation])
      if (typeof condition !== 'boolean') fail('an invalid logged entry condition');
    if (e.withBias !== undefined && e.withBias !== false) fail('an invalid logged entry side');
    const confirmed =
      e.permission !== null &&
      e.zone === true &&
      e.gexSupports === true &&
      e.invalidation === true &&
      e.withBias === undefined;
    if (confirmed === !!outside?.includes('conditions'))
      fail('a logged entry whose conditions and rules disagree');
    if (e.unplanned !== undefined && (e.unplanned !== true || e.kind !== 'add'))
      fail('an invalid unplanned add');
    // An entry taken on the cockpit keeps its setup, chart, plan and "not chasing" together, and
    // only one that followed every rule has them. Entries logged before it have none.
    const cockpit = [e.setup, e.timeframe, e.notChasing, e.plan].filter((x) => x !== undefined);
    if (cockpit.length) {
      if (cockpit.length !== 4 || !confirmed || outside !== undefined)
        fail('an invalid cockpit entry');
      if (!SETUP_IDS.includes(e.setup as string)) fail('an invalid entry setup');
      if (!TIMEFRAMES.includes(e.timeframe as string)) fail('an invalid entry timeframe');
      if (e.notChasing !== true) fail('an invalid cockpit entry');
      validateEntryPlan(e.plan, e.side);
    }
    // A runner's normal target reached leaves the runner open; it then ends as a runner does.
    if (e.partial !== undefined) {
      rec(e.partial, 'normal target reached');
      if (!(e.plan as Raw | undefined)?.runner) fail('a normal target reached without a runner');
      stamp(e.partial.at, 'normal target reached');
      if ((e.partial.at as string) < (e.at as string)) fail('a normal target before its entry');
    }
    if (e.exit !== undefined) {
      rec(e.exit, 'entry exit');
      if (e.plan === undefined) fail('an exit on an entry without a plan');
      const kinds = e.partial === undefined ? EXIT_KINDS : RUNNER_EXITS;
      if (!kinds.includes(e.exit.kind as string)) fail('an invalid entry exit');
      stamp(e.exit.at, 'entry exit');
      const after = (e.partial as Raw | undefined)?.at ?? e.at;
      if ((e.exit.at as string) < (after as string)) fail('an exit before its entry');
    }
  });
  // At most one planned entry is still open, and only the latest planned one.
  const planned = (v as Raw[]).filter((e) => e.plan !== undefined);
  if (planned.slice(0, -1).some((e) => e.exit === undefined))
    fail('an earlier planned entry still open');
}

/** The review's six discipline answers, each Yes (true) or No (false). */
export function validateDiscipline(v: unknown): void {
  rec(v, 'discipline answers');
  for (const key of DISCIPLINE_KEYS)
    if (typeof v[key] !== 'boolean') fail('an invalid discipline answer');
}

/**
 * A flat-by time: New York "HH:MM" before 18:00, when the next daily candle opens, so it always
 * falls on the candle it is read for.
 */
export function validFlatBy(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h < 18 && m < 60;
}

/** The settings a waiting raise was saved against (`RiskSettings`), each in its own range. */
function validateRiskSettings(v: unknown): void {
  rec(v, 'waiting raise');
  const keys = [
    'tradeRisk',
    'thesisRisk',
    'dailyLoss',
    'dailyLossTotal',
    'maxContracts',
    'accounts',
    'maxEntries',
    'maxLossRun',
    'cooldownMinutes',
  ];
  // The flat-by time is there only when it was set (saved before it existed, it is never there).
  const flat = 'flatBy' in v;
  if (Object.keys(v).length !== keys.length + (flat ? 1 : 0) || !keys.every((k) => k in v))
    fail('an invalid waiting raise');
  if (flat && !validFlatBy(v.flatBy)) fail('an invalid waiting raise');
  positive(v.tradeRisk, 'waiting raise', true);
  positive(v.thesisRisk, 'waiting raise', true);
  positive(v.dailyLoss, 'waiting raise', true);
  positive(v.dailyLossTotal, 'waiting raise', true);
  int(v.maxContracts, 1, MAX_CONTRACTS, 'waiting raise', true);
  int(v.accounts, 1, MAX_ACCOUNTS, 'waiting raise');
  int(v.maxEntries, 1, MAX_ENTRIES, 'waiting raise');
  int(v.maxLossRun, 1, MAX_LOSS_RUN, 'waiting raise');
  int(v.cooldownMinutes, 20, 60, 'waiting raise');
}

/** The trading discipline profile kept with its rulebook. */
export function validateTradingProfile(t: unknown): void {
  rec(t, 'trading profile');
  date(t.since, 'trading start');
  tradingItems(t.framework, 8, 'trading framework step');
  tradingItems(
    t.checklist,
    TRADING_CHECKLIST_SIZE,
    'trading checklist item',
    TRADING_CHECKLIST_SIZE,
  );
  tradingItems(t.violations, MAX_VIOLATIONS, 'hard violation');
  list(t.limits, 20, 'trading limit');
  const limits = new Set<string>();
  for (const l of t.limits) {
    rec(l, 'trading limit');
    id(l.id, 'trading limit');
    unique(limits, l.id, 'trading limit ID');
    str(l.label, 120, 'trading limit label', true);
    str(l.value, 120, 'trading limit value', true);
  }
  int(t.maxFailedTheses, 1, 20, 'failed-thesis limit', true);
  if (t.maxEntries !== undefined) int(t.maxEntries, 1, MAX_ENTRIES, 'entry limit');
  if (t.maxLossRun !== undefined) int(t.maxLossRun, 1, MAX_LOSS_RUN, 'loss run limit');
  if (t.dailyLossTotal !== undefined) positive(t.dailyLossTotal, 'total daily loss limit');
  if (t.raisedOn !== undefined) {
    rec(t.raisedOn, 'waiting raise');
    const keys = Object.keys(t.raisedOn);
    if (keys.length !== 2 || !keys.includes('candle') || !keys.includes('before'))
      fail('an invalid waiting raise');
    date(t.raisedOn.candle, 'waiting raise');
    validateRiskSettings(t.raisedOn.before);
  }
  if (t.moneySetAsideOn !== undefined) date(t.moneySetAsideOn, 'money answer');
  if (t.existingAccountOn !== undefined) date(t.existingAccountOn, 'live account confirmation');
  if (t.flatBy !== undefined && !validFlatBy(t.flatBy)) fail('an invalid flat-by time');
  if (t.fundedSetLost !== undefined) {
    rec(t.fundedSetLost, 'account set pause');
    stamp(t.fundedSetLost.at, 'account set pause');
    date(t.fundedSetLost.until, 'account set pause');
  }
  if (t.instrument !== undefined) {
    rec(t.instrument, 'trading instrument');
    str(t.instrument.name, INSTRUMENT_NAME, 'instrument name', true);
    if (t.instrument.name !== t.instrument.name.trim() || /[\r\n]/.test(t.instrument.name))
      fail('invalid instrument name');
    positive(t.instrument.pointValue, 'point value');
    positive(t.instrument.tick, 'tick size');
  }
  if (t.risk !== undefined) {
    rec(t.risk, 'risk limits');
    int(t.risk.maxContracts, 1, MAX_CONTRACTS, 'contract limit', true);
    positive(t.risk.thesisRisk, 'thesis risk limit', true);
    positive(t.risk.dailyLoss, 'daily loss limit', true);
    if (t.risk.tradeRisk !== undefined) positive(t.risk.tradeRisk, 'risk per trade', true);
  }
  if (t.accounts !== undefined) int(t.accounts, 1, MAX_ACCOUNTS, 'account count');
  if (t.costs !== undefined) {
    rec(t.costs, 'trading costs');
    if (Object.keys(t.costs).some((k) => k !== 'commission' && k !== 'slippageTicks'))
      fail('invalid trading costs');
    decimal(t.costs.commission, 0, 1_000, 'commission', true);
    int(t.costs.slippageTicks, 0, 100, 'slippage', true);
  }
  if (t.attemptsPerThesis !== undefined) int(t.attemptsPerThesis, 1, 2, 'attempts per thesis');
  if (t.cooldownMinutes !== undefined) int(t.cooldownMinutes, 20, 60, 'cooldown length');
  if (t.liveTrading !== undefined && typeof t.liveTrading !== 'boolean')
    fail('an invalid live trading switch');
  if (t.strategy !== undefined) {
    rec(t.strategy, 'trading strategy');
    list(t.strategy.steps, 20, 'strategy step');
    for (const step of t.strategy.steps) {
      rec(step, 'strategy step');
      str(step.title, 120, 'strategy step title', true);
      str(step.summary, 300, 'strategy step summary');
      str(step.detail, 4000, 'strategy step detail');
    }
    str(t.strategy.key, 8000, 'My Key');
    if (t.strategy.retakeRule !== null) str(t.strategy.retakeRule, 300, 'retake rule', true);
  }
  rec(t.reset, 'trading reset');
  int(t.reset.minutes, 1, 120, 'reset length');
  list(t.reset.steps, 12, 'reset step');
  for (const step of t.reset.steps) str(step, 300, 'reset step', true);
}

export function validateRuleReviews(v: unknown): void {
  list(v, LIMITS.ruleReviews, 'rule review');
  const ids = new Set<string>();
  const occurrences = new Set<string>();
  for (const r of v) {
    rec(r, 'rule review');
    id(r.id, 'rule review');
    unique(ids, r.id, 'rule review ID');
    date(r.date, 'rule review');
    stamp(r.at, 'rule review');
    id(r.routineId, 'routine');
    ref(r.occurrenceId, 'objective');
    if (r.occurrenceId !== null)
      unique(occurrences, r.occurrenceId as string, 'rule review for one objective');
    if (r.outcome !== 'reviewed' && r.outcome !== 'none') fail('an invalid review outcome');
    list(r.answers, 30, 'checkpoint answer');
    const answered = new Set<string>();
    for (const a of r.answers) {
      rec(a, 'checkpoint answer');
      id(a.checkpointId, 'checkpoint');
      unique(answered, a.checkpointId, 'answer for one checkpoint');
      if (a.answer !== 'yes' && a.answer !== 'no' && a.answer !== 'na') fail('an invalid answer');
    }
    list(r.violations, LIMITS.rules, 'broken rule');
    const broken = new Set<string>();
    for (const id_ of r.violations) {
      id(id_, 'broken rule');
      unique(broken, id_ as string, 'broken rule');
    }
    // A day without the activity is not scored: no answers and no broken rules.
    if (r.outcome === 'none' && (r.answers.length || r.violations.length))
      fail('a day without the activity that carries answers');
    str(r.note, LIMITS.note, 'review note');
    if (r.trading !== undefined) {
      const t = r.trading;
      rec(t, 'trading review');
      if (t.session !== 'traded' && t.session !== 'no-trade' && t.session !== 'away')
        fail('an invalid trading session');
      // A planned day away is the only unscored trading review.
      if ((t.session === 'away') !== (r.outcome === 'none'))
        fail('a trading review whose session and outcome disagree');
      int(t.entries, 0, 99, 'entry count', true);
      if (t.session !== 'traded' && (t.entries !== null || t.failedTheses !== null))
        fail('a trading review without trades that reports trade counts');
      int(t.failedTheses, 0, 99, 'failed-thesis count', true);
      // PASS or FAIL only: Not applicable never turns into a passed item.
      if ((r.answers as Raw[]).some((a) => a.answer === 'na'))
        fail('a trading review answered Not applicable');
      // A thesis card belongs to a session, the entry log to a traded one.
      if (
        (t.thesis !== undefined && t.session === 'away') ||
        (t.entryLog !== undefined && t.session !== 'traded')
      )
        fail('a trading review whose session log and session disagree');
      if (t.thesis !== undefined) validateThesisCard(t.thesis);
      if (t.entryLog !== undefined) validateEntryLog(t.entryLog);
      if (t.discipline !== undefined) {
        if (t.session === 'away') fail('discipline answers on a day away');
        validateDiscipline(t.discipline);
      }
      if (t.ownCandle !== undefined && t.ownCandle !== true) fail('an invalid review candle');
    }
    if (r.editedAt !== undefined) {
      stamp(r.editedAt, 'review correction');
      if (r.trading === undefined || (r.editedAt as string) < (r.at as string))
        fail('an invalid review correction');
    }
  }
}
