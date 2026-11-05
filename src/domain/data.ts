import { canCarryAnchor } from './anchor';
import { validateDayOrder } from './day-order';
import { validateRepeat } from './repeat';
import {
  Block,
  Day,
  Program,
  ProgramRotation,
  Routine,
  RuleBook,
  Settings,
  State,
  TradingItem,
  TradingProfile,
  emptyState,
  validateRoutine,
  validateSettings,
  dateObject,
  localDate,
  validateWindow,
} from './model';
import { PROTECTION_REASONS } from './objectives';
import {
  validateFocuses,
  validateSkillCheckpoints,
  validateWeeklyReviews,
} from './direction-records';
import { recordStudySchedule } from './study-schedule';
import { candleDate } from './market-clock';
import { withCounterBiasViolation } from './trading-rules';
import { withRaises } from './trading-safeguards';
import { validateTradingSessions } from './trading-sessions';
import { recordDueTimed } from './planner';
import {
  MAX_VIOLATIONS,
  validateActivitySessions,
  validateRuleBooks,
  validateRuleReviews,
  validateIntervalRoutines,
  validateIntervalSessions,
  validateLifeLog,
  validateMeasurements,
  validateMoneyReviews,
  validateAlternate,
  validateAnchor,
  validateFollows,
  validateLinks,
  validateMoved,
  validateOverrides,
  validateRotation,
  validateStudyPlan,
  validateTradingProfile,
  validateWorkoutSessions,
  validateWorkoutTemplates,
} from './records';

// Validating and upgrading saved state. `decodeState` is the one check on every way data enters or
// is kept: a load, each save, a backup restore, a setup import and Start tracking. `upgrade` moves
// older state up one version at a time with the newer records empty, and refuses data that claims
// an older version while carrying a newer version's fields. Also here: the setup-file import
// (`parseSetup`) and `withDay`, which replaces one stored day.
// Tests: __tests__/records.test.ts and integrity.test.ts; the upgrades of a real version-3
// database and backup are in src/data/__tests__/version-3-build.test.ts and migration.test.ts.

function record(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('The file contains an invalid record.');
}
function strings(v: unknown): asserts v is string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new Error('The file contains an invalid list.');
}
function text(v: unknown) {
  if (typeof v !== 'string' || v.length > 10000) throw new Error('The file contains invalid text.');
}
function numeric(v: unknown) {
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v)))
    throw new Error('The file contains an invalid number.');
}
function flag(v: unknown) {
  if (typeof v !== 'boolean') throw new Error('The file contains an invalid option.');
}
function validateBlock(v: unknown): asserts v is Block {
  record(v);
  for (const k of ['id', 'title']) text(v[k]);
  for (const k of ['routineId', 'programId', 'actualAt', 'reason']) if (v[k] !== null) text(v[k]);
  strings(v.steps);
  if (v.bundledSteps !== undefined) {
    if (!Array.isArray(v.bundledSteps) || v.bundledSteps.length > 500)
      throw new Error('Invalid bundled routines.');
    const ids = new Set<string>();
    for (const step of v.bundledSteps) {
      record(step);
      for (const key of ['id', 'routineId', 'programId', 'title']) {
        text(step[key]);
        if (!(step[key] as string).trim()) throw new Error('Invalid bundled routine details.');
      }
      strings(step.steps);
      if (step.optional !== undefined) flag(step.optional);
      if (!['planned', 'done', 'skipped'].includes(String(step.status)))
        throw new Error('Invalid bundled completion status.');
      if (step.status === 'planned') {
        if (step.actualAt !== null)
          throw new Error('A planned bundled routine has an actual timestamp.');
      } else if (
        typeof step.actualAt !== 'string' ||
        !Number.isFinite(Date.parse(step.actualAt)) ||
        new Date(step.actualAt).toISOString() !== step.actualAt
      )
        throw new Error('Invalid bundled completion timestamp.');
      if (ids.has(step.id as string)) throw new Error('Duplicate bundled occurrence.');
      ids.add(step.id as string);
    }
  }
  numeric(v.start);
  numeric(v.duration);
  flag(v.fixed);
  if (v.checklist !== undefined) flag(v.checklist);
  if (v.private !== undefined) flag(v.private);
  if (v.optional !== undefined) flag(v.optional);
  validateWindow(v);
  if (!['planned', 'done', 'skipped'].includes(String(v.status)))
    throw new Error('The file contains an invalid completion status.');
  // A corrected morning time belongs to a done tick only.
  if (
    v.upAt !== undefined &&
    (v.status !== 'done' ||
      typeof v.upAt !== 'number' ||
      !Number.isInteger(v.upAt) ||
      v.upAt < 0 ||
      v.upAt > 1439)
  )
    throw new Error('The file contains an invalid corrected morning time.');
  if (
    v.start !== null &&
    (!Number.isInteger(v.start) || (v.start as number) < 0 || (v.start as number) >= 1440)
  )
    throw new Error('Invalid block time.');
  if (
    v.duration !== null &&
    (!Number.isInteger(v.duration) || (v.duration as number) < 1 || (v.duration as number) > 720)
  )
    throw new Error('Invalid block duration.');
  if (
    v.start !== null &&
    (v.duration === null || (v.start as number) + (v.duration as number) > 1440)
  )
    throw new Error('Invalid scheduled interval.');
}
const RECORD_KEYS = [
  'measurements',
  'lifeLog',
  'workoutTemplates',
  'workoutSessions',
  'moneyReviews',
] as const;
/** Record lists added in state version 3. */
const V3_RECORD_KEYS = [
  'intervalRoutines',
  'intervalSessions',
  'activitySessions',
  'ruleBooks',
  'ruleReviews',
] as const;

/** Record lists added in state version 4: the focus, weekly reviews and skill checkpoints. */
const V4_RECORD_KEYS = ['focuses', 'weeklyReviews', 'skillCheckpoints'] as const;

/** Added in state version 5: the trading sessions, by candle date (an object, not a list). */
const V5_KEYS = ['tradingSessions'] as const;
/** Optional fields that only version 5 data can carry. */
const V5_OPTIONAL_KEYS = ['tradingSessionsUnreadable', 'tradingSessionsImported'] as const;

/**
 * Version 1 had no personal records; version 2 had no timed circuits; version 3 had no focus,
 * weekly reviews or skill checkpoints; version 4 kept no trading sessions (they were on the device
 * only, and are moved in once by `importDeviceSessions`). Each upgrades one step with what it
 * lacked empty; nothing else changes. A file claiming an older version while carrying a newer
 * version's fields is malformed and refused, so a newer file is never half-read.
 */
function upgrade(input: Record<string, unknown>): Record<string, unknown> {
  const steps: [number, readonly string[]][] = [
    [1, RECORD_KEYS],
    [2, V3_RECORD_KEYS],
    [3, V4_RECORD_KEYS],
    [4, V5_KEYS],
  ];
  for (const [i, [from, adds]] of steps.entries()) {
    if (input.version !== from) continue;
    const later = [...steps.slice(i).flatMap(([, keys]) => keys), ...V5_OPTIONAL_KEYS];
    if (later.some((key) => input[key] !== undefined))
      throw new Error('This file uses an unsupported version.');
    const empty = (key: string) => ((V5_KEYS as readonly string[]).includes(key) ? {} : []);
    input = { ...input, version: from + 1, ...Object.fromEntries(adds.map((k) => [k, empty(k)])) };
  }
  return input;
}

/**
 * Validates a whole state. `unchangedDays` and `unchangedSessions` name dates whose stored day or
 * trading session is byte-for-byte what was already validated and saved (the save compares
 * serialized rows), so their checks are not repeated; every other part is always checked.
 */
export function decodeState(
  input: unknown,
  {
    unchangedDays,
    unchangedSessions,
  }: { unchangedDays?: ReadonlySet<string>; unchangedSessions?: ReadonlySet<string> } = {},
): State {
  record(input);
  if (input.notes === undefined) input = { ...input, notes: [] };
  record(input);
  input = upgrade(input);
  record(input);
  strings(input.notes);
  if (input.version !== 5 || !['empty', 'demo', 'personal'].includes(String(input.source)))
    throw new Error('This file uses an unsupported version.');
  validateMeasurements(input.measurements);
  validateLifeLog(input.lifeLog);
  validateWorkoutTemplates(input.workoutTemplates);
  validateWorkoutSessions(input.workoutSessions);
  validateMoneyReviews(input.moneyReviews);
  validateIntervalRoutines(input.intervalRoutines);
  validateIntervalSessions(input.intervalSessions);
  validateActivitySessions(input.activitySessions);
  validateRuleBooks(input.ruleBooks);
  validateRuleReviews(input.ruleReviews);
  validateFocuses(input.focuses);
  validateWeeklyReviews(input.weeklyReviews);
  validateSkillCheckpoints(input.skillCheckpoints);
  validateTradingSessions(
    input.tradingSessions,
    input.tradingSessionsUnreadable,
    input.tradingSessionsImported,
    unchangedSessions,
  );
  // A routine has at most one of a workout plan, a timed circuit or a study plan.
  const linked = new Set(
    [
      ...(input.workoutTemplates as { routineId: string }[]),
      ...(input.intervalRoutines as { routineId: string }[]),
    ].map((x) => x.routineId),
  );
  if (
    !Array.isArray(input.goals) ||
    !Array.isArray(input.programs) ||
    input.programs.length > 500 ||
    input.goals.length > 1000
  )
    throw new Error('Invalid goals or programs.');
  const goalIds = new Set<string>(),
    programIds = new Set<string>(),
    routineIds = new Set<string>();
  let anchors = 0;
  for (const g of input.goals) {
    record(g);
    text(g.id);
    text(g.title);
    text(g.desiredState);
    if (goalIds.has(g.id as string)) throw new Error('Duplicate goal ID.');
    goalIds.add(g.id as string);
  }
  for (const p of input.programs) {
    record(p);
    text(p.id);
    text(p.title);
    text(p.group);
    strings(p.goalIds);
    if (programIds.has(p.id as string)) throw new Error('Duplicate program ID.');
    programIds.add(p.id as string);
    if (p.goalIds.some((id) => !goalIds.has(id)))
      throw new Error('A program refers to a missing goal.');
    if (!Array.isArray(p.routines) || p.routines.length > 100) throw new Error('Invalid routines.');
    for (const r of p.routines) {
      record(r);
      text(r.id);
      text(r.title);
      strings(r.steps);
      numeric(r.duration);
      numeric(r.preferredStart);
      if (r.thursdayStart !== undefined) numeric(r.thursdayStart);
      flag(r.enabled);
      flag(r.fixed);
      if (r.checklist !== undefined) flag(r.checklist);
      if (r.private !== undefined) flag(r.private);
      if (r.optional !== undefined) flag(r.optional);
      if (
        r.capture !== undefined &&
        !['weight', 'money', 'activity', 'rules'].includes(String(r.capture))
      )
        throw new Error('Invalid routine record type.');
      if (
        r.activities !== undefined &&
        (!Array.isArray(r.activities) ||
          r.activities.length > 20 ||
          r.activities.some((a) => typeof a !== 'string' || !a.trim() || a.length > 120))
      )
        throw new Error('Invalid activity choices.');
      if (r.bundledInto !== null) text(r.bundledInto);
      if (
        r.weekdays !== null &&
        (!Array.isArray(r.weekdays) || r.weekdays.some((x) => typeof x !== 'number'))
      )
        throw new Error('Invalid weekdays.');
      validateRoutine(r as unknown as Routine);
      validateFollows(r.follows, r.id as string);
      validateAlternate(r.alternate);
      validateLinks(r.links);
      validateRepeat(r.repeat, r);
      validateDayOrder(r.dayOrder);
      if (r.anchor !== undefined) {
        validateAnchor(r.anchor);
        if (r.enabled && ++anchors > 1)
          throw new Error('Only one routine can be the morning anchor.');
      }
      if (r.study !== undefined) {
        validateStudyPlan(r.study);
        if (r.capture !== undefined || linked.has(r.id as string))
          throw new Error('A study objective cannot record anything else.');
      }
      if (routineIds.has(r.id as string)) throw new Error('Duplicate routine ID.');
      routineIds.add(r.id as string);
    }
    validateRotation(p.rotation, new Set((p.routines as { id: string }[]).map((r) => r.id)));
  }
  // The anchor is a plain checklist item, ticked once and recording nothing else; read once
  // every program, rotation and linked plan is known.
  for (const p of input.programs as Program[])
    for (const r of p.routines)
      if (r.anchor !== undefined && !canCarryAnchor(r, input as unknown as State))
        throw new Error('Only a plain checklist routine can be the morning anchor.');
  record(input.settings);
  for (const k of [
    'wake',
    'bedtime',
    'workStart',
    'workEnd',
    'scrumStart',
    'scrumDuration',
    'thursdayMeetingStart',
    'thursdayMeetingDuration',
    'gymTravel',
    'eveningWorkMinutes',
  ])
    numeric(input.settings[k]);
  validateSettings(input.settings as unknown as Settings);
  if (
    input.settings.widgetDayStatus !== undefined &&
    typeof input.settings.widgetDayStatus !== 'boolean'
  )
    throw new Error('Invalid widget setting.');
  if (
    input.settings.timerCue !== undefined &&
    !['voice', 'beep', 'mute'].includes(String(input.settings.timerCue))
  )
    throw new Error('Invalid timer sound setting.');
  if (
    input.settings.lastBackupAt !== undefined &&
    (typeof input.settings.lastBackupAt !== 'string' ||
      Number.isNaN(Date.parse(input.settings.lastBackupAt)))
  )
    throw new Error('Invalid last backup time.');
  record(input.days);
  for (const [date, day] of Object.entries(input.days)) {
    if (unchangedDays?.has(date)) continue;
    dateObject(date);
    record(day);
    if (day.date !== date || !Array.isArray(day.blocks) || !Array.isArray(day.revisions))
      throw new Error('Invalid day.');
    if (day.protection !== undefined) {
      record(day.protection);
      if (
        typeof day.protection.reason !== 'string' ||
        !PROTECTION_REASONS.includes(
          day.protection.reason as (typeof PROTECTION_REASONS)[number],
        ) ||
        typeof day.protection.at !== 'string' ||
        !Number.isFinite(Date.parse(day.protection.at)) ||
        new Date(day.protection.at).toISOString() !== day.protection.at
      )
        throw new Error('Invalid day protection.');
    }
    if (
      day.dueTimed !== undefined &&
      (!Array.isArray(day.dueTimed) ||
        day.dueTimed.some((id) => typeof id !== 'string' || !id) ||
        new Set(day.dueTimed).size !== day.dueTimed.length)
    )
      throw new Error('Invalid due timed sessions.');
    validateMoved(day.moved, date);
    validateOverrides(day.rotation);
    const ids = new Set<string>();
    for (const b of day.blocks) {
      validateBlock(b);
      if (ids.has(b.id)) throw new Error('Duplicate occurrence.');
      ids.add(b.id);
      if (b.movedFrom !== undefined) {
        dateObject(b.movedFrom);
        // A moved occurrence keeps the ID of its original day; it never claims to come from here.
        if (b.movedFrom === date || b.id !== `${b.movedFrom}:routine:${b.routineId}`)
          throw new Error('Invalid moved occurrence.');
        if (b.bundledSteps?.length)
          throw new Error('A moved occurrence cannot carry bundled steps.');
      }
      for (const step of b.bundledSteps ?? []) {
        if (step.id !== `${date}:bundled:${step.routineId}`)
          throw new Error('Invalid bundled occurrence ID.');
        if (ids.has(step.id)) throw new Error('Duplicate bundled occurrence.');
        ids.add(step.id);
      }
    }
    for (const r of day.revisions) {
      record(r);
      text(r.at);
      text(r.reason);
      if (!Array.isArray(r.blocks)) throw new Error('Invalid history.');
      const historyIds = new Set<string>();
      for (const block of r.blocks) {
        validateBlock(block);
        if (block.bundledSteps?.some((step) => step.id !== `${date}:bundled:${step.routineId}`))
          throw new Error('Invalid historical bundled occurrence ID.');
        for (const id of [block.id, ...(block.bundledSteps ?? []).map((step) => step.id)]) {
          if (historyIds.has(id))
            throw new Error('The file contains duplicate historical occurrences.');
          historyIds.add(id);
        }
      }
    }
  }
  return input as unknown as State;
}
// Widget disclosure and the timer sound are device choices: a setup file can neither set nor clear
// them.
function withWidgetPreference(incoming: Settings, existing: Settings): Settings {
  const next = { ...incoming };
  delete next.widgetDayStatus;
  delete next.timerCue;
  delete next.lastBackupAt;
  if (existing.widgetDayStatus !== undefined) next.widgetDayStatus = existing.widgetDayStatus;
  if (existing.timerCue !== undefined) next.timerCue = existing.timerCue;
  if (existing.lastBackupAt !== undefined) next.lastBackupAt = existing.lastBackupAt;
  return next;
}

/** The file's programs with any morning anchor left out, since a file never sets one. */
function withoutAnchors(programs: unknown[]): unknown[] {
  return programs.map((p) =>
    p && typeof p === 'object' && Array.isArray((p as { routines?: unknown }).routines)
      ? {
          ...p,
          routines: (p as { routines: unknown[] }).routines.map((r) => {
            if (!r || typeof r !== 'object' || !('anchor' in r)) return r;
            const { anchor: _anchor, ...rest } = r as Record<string, unknown>;
            return rest;
          }),
        }
      : p,
  );
}

/** Settings made in the app that an older setup file does not know about. */
const APP_ROUTINE_FIELDS = [
  'follows',
  'optional',
  'alternate',
  'links',
  'activities',
  'study',
  'repeat',
] as const;

/**
 * An imported program that replaces one on the device keeps what was set up in the app:
 * - per routine, companions, optional, alternation, links, activity choices and a repeat every few
 *   weeks the file does not mention;
 * - the morning anchor as it is on the device: it is set in Programs only, so a file can neither
 *   add one nor change its times (`parseSetup` drops it where the routine can no longer carry it);
 * - a study plan already on the device, as it is (its stages, time, reminders and streak start);
 *   a study plan new from the file starts its streak today, never earlier;
 * - a routine paused on the device stays paused;
 * - a routine's place in the order of the day, wherever the routine sat on the device; the file's
 *   order applies only to a routine that has none;
 * - a rotation's rest days, starting workout and remembered schedules (the file sets its order);
 * - a routine added in the app that the file does not have (an import merges, never deletes one),
 *   after the file's, still in the rotation when it was in it on the device.
 * Rotation workouts are always checklist objectives without weekdays or a repeat (the rotation
 * decides their days), and a rotation workout cannot also be a companion. A study objective or a
 * bundled step never keeps a repeat either.
 */
function keepAppSettings(
  incoming: Program,
  existing: State,
  date: string,
  fileRoutineIds: ReadonlySet<string>,
): Program {
  const before = existing.programs.find((p) => p.id === incoming.id);
  const rotation = keptRotation(incoming.rotation, before?.rotation);
  const members = new Set(rotation?.order ?? []);
  const routines = incoming.routines.map((r) => {
    const old = before?.routines.find((x) => x.id === r.id);
    const kept: Routine = { ...r };
    for (const key of APP_ROUTINE_FIELDS)
      if (kept[key] === undefined && old?.[key] !== undefined)
        (kept as Record<string, unknown>)[key] = old[key];
    if (old?.study && r.study) kept.study = old.study;
    // A plan new from the file: its streak and schedule start today, so no earlier day is judged.
    if (!old?.study && kept.study) {
      const fresh = { ...kept.study };
      delete fresh.trackFrom;
      delete fresh.schedule;
      kept.study = fresh;
    }
    if (old && !old.enabled) kept.enabled = false;
    // An order of the day already on the device, set in the app or by an earlier import, wins over
    // the file's: the file only places a routine that has none.
    const placed = existing.programs.flatMap((p) => p.routines).find((x) => x.id === r.id);
    if (placed?.dayOrder !== undefined) kept.dayOrder = placed.dayOrder;
    // A file that now gives the routine a record type replaces its in-app study plan.
    if (r.capture !== undefined && r.study === undefined) delete kept.study;
    // An imported change of days or pausing is recorded in the study schedule from today on.
    if (kept.study) Object.assign(kept, recordStudySchedule(old, kept, date));
    // The morning anchor is the device's: its history is never replaced or re-dated.
    if (old?.anchor) kept.anchor = old.anchor;
    else delete kept.anchor;
    // Study keeps its own dated schedule and a bundled step follows its parent's days.
    if (
      kept.repeat &&
      (kept.study !== undefined || (kept.bundledInto !== null && kept.bundledInto !== undefined))
    )
      delete kept.repeat;
    if (!members.has(r.id)) return kept;
    if (kept.follows?.length)
      throw new Error(`${r.title} follows other workouts, so it cannot also be in the rotation.`);
    const member: Routine = { ...kept, checklist: true, weekdays: [] };
    delete member.repeat;
    return member;
  });
  const deviceOnly = (before?.routines ?? []).filter((r) => !fileRoutineIds.has(r.id));
  const all = [...routines, ...deviceOnly];
  const result: Program = { ...incoming, routines: all };
  // A kept rotation only keeps the workouts the imported program still has.
  if (rotation) {
    const ids = new Set(all.map((r) => r.id));
    const kept = deviceOnly
      .filter((r) => before?.rotation?.order.includes(r.id) && !rotation.order.includes(r.id))
      .map((r) => r.id);
    const order = [...rotation.order, ...kept].filter((id) => ids.has(id));
    if (order.length) {
      const previous = rememberedSchedules(rotation, before, order);
      const next: ProgramRotation = {
        ...rotation,
        order,
        startWith: rotation.startWith && ids.has(rotation.startWith) ? rotation.startWith : null,
      };
      delete next.previous;
      if (previous.length) next.previous = previous;
      result.rotation = next;
    }
  }
  return result;
}

/**
 * Each rotation workout's own schedule from before it joined: kept for workouts still in the order,
 * and recorded for a device workout the file now puts in the rotation, so leaving it later gives
 * its days back. A workout new from the file has no earlier schedule to remember.
 */
function rememberedSchedules(
  rotation: ProgramRotation,
  before: Program | undefined,
  order: string[],
): NonNullable<ProgramRotation['previous']> {
  const inOrder = new Set(order);
  const kept = (rotation.previous ?? []).filter((p) => inOrder.has(p.routineId));
  const wasMember = new Set(before?.rotation?.order ?? []);
  for (const id of order) {
    const old = before?.routines.find((r) => r.id === id);
    if (!old || wasMember.has(id) || kept.some((p) => p.routineId === id)) continue;
    kept.push({
      routineId: id,
      weekdays: old.weekdays ? [...old.weekdays] : null,
      checklist: !!old.checklist,
    });
  }
  return kept;
}

/** The file's rotation order with the device's rest days, start and remembered schedules. */
export function keptRotation(
  file: ProgramRotation | undefined,
  device: ProgramRotation | undefined,
): ProgramRotation | undefined {
  if (!file || !device) return file ?? device;
  const startWith =
    device.startWith && file.order.includes(device.startWith) ? device.startWith : file.startWith;
  return {
    ...file,
    restDays: [...device.restDays],
    startWith: startWith ?? null,
    ...(device.previous && { previous: device.previous }),
  };
}

/**
 * A process already on the device, imported again: its items take the file's wording by ID, hard
 * violations new in the file are added after the device's own, and nothing is removed, so every
 * recorded review keeps its items. New violations are added only while the process holds fewer
 * than `MAX_VIOLATIONS`; the preview names any left out, and the rest of the setup still imports.
 * The limits, the reset, the start date and an entry limit set in the app stay as they are; the
 * file's entry limit applies only where the device has none. So do the file's instrument (whole,
 * when the device has none) and each of its numeric risk limits (where the device's is not set).
 */
function withFileWording(device: TradingProfile, file: TradingProfile): TradingProfile {
  const reword = (items: TradingItem[], from: TradingItem[]) =>
    items.map((item) => {
      const match = from.find((x) => x.id === item.id);
      return match ? { ...item, title: match.title, details: match.details } : item;
    });
  const known = new Set(device.violations.map((v) => v.id));
  const room = Math.max(0, MAX_VIOLATIONS - device.violations.length);
  const risk = withFileRisk(device.risk, file.risk);
  return {
    ...device,
    framework: reword(device.framework, file.framework),
    checklist: reword(device.checklist, file.checklist),
    violations: [
      ...reword(device.violations, file.violations),
      ...file.violations
        .filter((v) => !known.has(v.id))
        .slice(0, room)
        .map((v) => ({ id: v.id, title: v.title, details: v.details })),
    ],
    ...(device.maxEntries === undefined &&
      file.maxEntries !== undefined && { maxEntries: file.maxEntries }),
    ...(!device.instrument && file.instrument && { instrument: { ...file.instrument } }),
    ...(risk && { risk }),
  };
}

/**
 * The device's risk limits with each one it has not set taken from the file; the device's own,
 * unchanged, when the file sets none it lacks.
 */
function withFileRisk(
  device: TradingProfile['risk'],
  file: TradingProfile['risk'],
): TradingProfile['risk'] {
  if (!file) return device;
  if (!device) return { ...file };
  const keys = ['tradeRisk', 'maxContracts', 'thesisRisk', 'dailyLoss'] as const;
  if (keys.every((k) => (device[k] ?? null) !== null || (file[k] ?? null) === null)) return device;
  const tradeRisk = device.tradeRisk ?? file.tradeRisk;
  return {
    ...(tradeRisk !== undefined && { tradeRisk }),
    maxContracts: device.maxContracts ?? file.maxContracts,
    thesisRisk: device.thesisRisk ?? file.thesisRisk,
    dailyLoss: device.dailyLoss ?? file.dailyLoss,
  };
}

/**
 * What a setup import starts from on a device showing the demo: an empty plan, so nothing of the
 * fictional person is merged, that keeps the device's own preferences (the widget's Day Cleared
 * opt-in and the timer cue), as Start tracking does. The demo's last backup time is dropped: a
 * backup of the demo holds none of the imported setup.
 */
export function replacingDemo(demo: State): State {
  const empty = emptyState();
  return {
    ...empty,
    // The same device choices an import onto a personal device keeps, from the one list.
    settings: withWidgetPreference(empty.settings, { ...demo.settings, lastBackupAt: undefined }),
  };
}

/**
 * Imports a setup file: goals and programs merge by ID; settings and notes apply only when the file
 * has them. Optional `workoutTemplates`, `intervalRoutines` and `ruleBooks` are added only for
 * routines that do not already have one: an existing plan, circuit or rulebook is never replaced.
 * Recorded history is never touched.
 */
export function parseSetup(raw: string, existing: State, now = new Date().toISOString()): State {
  if (raw.length > 2_000_000) throw new Error('Choose a setup file under 2 MB.');
  const setup: unknown = JSON.parse(raw);
  record(setup);
  if (setup.format !== 'life-os-setup-v1')
    throw new Error('Choose a Life OS setup file (life-os-setup-v1).');
  if (!Array.isArray(setup.goals) || !Array.isArray(setup.programs))
    throw new Error('The setup needs goals and programs.');
  if (existing.source === 'demo') existing = replacingDemo(existing);
  // Validate imported data before merging: malformed IDs cannot override existing data. A morning
  // anchor in the file is not read: the anchor is set in Programs only.
  const incoming = decodeState({
    version: 1,
    source: 'personal',
    goals: setup.goals,
    programs: withoutAnchors(setup.programs),
    settings: setup.settings ?? existing.settings,
    notes: setup.notes ?? [],
    days: {},
  });
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...new Map([...a, ...b].map((x) => [x.id, x])).values(),
  ];
  const fileRoutineIds = new Set(incoming.programs.flatMap((p) => p.routines.map((r) => r.id)));
  const programs = merge(
    existing.programs,
    incoming.programs.map((p) =>
      keepAppSettings(p, existing, localDate(new Date(now)), fileRoutineIds),
    ),
  );
  // Today and later days follow the imported catalog's timed obligations; past days stay as recorded.
  const today = localDate(new Date(now));
  const days = Object.fromEntries(
    Object.entries(existing.days).map(([date, day]) => [
      date,
      date >= today ? recordDueTimed(day, programs) : day,
    ]),
  );
  const routineIds = new Set(programs.flatMap((p) => p.routines.map((r) => r.id)));
  /** Adds only records for known routines that have none yet; existing ones always win. */
  const addNew = <T extends { id: string; routineId: string }>(
    current: T[],
    list: unknown,
  ): T[] => {
    if (list === undefined) return current;
    if (!Array.isArray(list)) throw new Error('The setup contains an invalid record list.');
    const taken = new Set(current.map((x) => x.routineId));
    const ids = new Set(current.map((x) => x.id));
    const added = (list as T[]).filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        routineIds.has(x.routineId) &&
        !taken.has(x.routineId) &&
        !ids.has(x.id),
    );
    return [...current, ...added];
  };
  /**
   * The trading process arrives with its rulebook. For a rulebook already on the device that has
   * none yet, only the process is attached: its checkpoints, rules and every review stay as they
   * are. It starts no earlier than today, so no past day is judged by it. A process already on
   * the device takes only the file's item wording and new hard violations (`withFileWording`).
   * Either way a process without the counter-bias violation gets it (`withCounterBiasViolation`).
   */
  const withTrading = (books: RuleBook[], list: unknown): RuleBook[] => {
    if (!Array.isArray(list)) return books;
    const before = new Map(existing.ruleBooks.map((b) => [b.id, b]));
    return books.map((book) => {
      const incoming = (list as Partial<RuleBook>[]).find(
        (x) => x && typeof x === 'object' && x.routineId === book.routineId && x.trading,
      );
      const kept = before.get(book.id)?.trading;
      if (kept) {
        if (!incoming?.trading) return book;
        validateTradingProfile(incoming.trading);
        // A limit the file raises (an entry cap set where the device had none) waits like any raise.
        const trading = withRaises(
          kept,
          withCounterBiasViolation(withFileWording(kept, incoming.trading)),
          candleDate(Date.parse(now)),
        );
        // Importing the same file again changes nothing, not even the rulebook's time.
        return JSON.stringify(trading) === JSON.stringify(kept)
          ? book
          : { ...book, trading, updatedAt: now };
      }
      // New from the file or attached now: either way it starts no earlier than today.
      const attached = book.trading ?? incoming?.trading;
      if (!attached) return book;
      // Live trading is turned on only in the app, never by a file, and so are the money answer
      // and the live-account confirmation; the accounts start at 1 and go up only in Your
      // limits, through their clean sessions.
      const {
        liveTrading: _live,
        accounts: _accounts,
        moneySetAsideOn: _money,
        existingAccountOn: _existing,
        raisedOn: _raised,
        ...trading
      } = withCounterBiasViolation(attached);
      return {
        ...book,
        trading: { ...trading, since: trading.since > today ? trading.since : today },
      };
    });
  };
  const workoutTemplates = addNew(existing.workoutTemplates, setup.workoutTemplates);
  const intervalRoutines = addNew(existing.intervalRoutines, setup.intervalRoutines);
  return decodeState({
    ...existing,
    source: 'personal',
    goals: merge(existing.goals, incoming.goals),
    // A device anchor on a routine the file made something else (a record type, a workout plan or
    // circuit, a bundled step or a rotation workout) goes with that change.
    programs: programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => {
        if (!r.anchor || canCarryAnchor(r, { programs, workoutTemplates, intervalRoutines }))
          return r;
        const plain = { ...r };
        delete plain.anchor;
        return plain;
      }),
    })),
    settings:
      setup.settings === undefined
        ? existing.settings
        : withWidgetPreference(incoming.settings, existing.settings),
    notes: setup.notes === undefined ? existing.notes : incoming.notes,
    days,
    workoutTemplates,
    intervalRoutines,
    ruleBooks: withTrading(addNew(existing.ruleBooks, setup.ruleBooks), setup.ruleBooks),
  });
}
export function withDay(state: State, day: Day): State {
  return { ...state, days: { ...state.days, [day.date]: day } };
}
