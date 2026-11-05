import { keptRotation, parseSetup, replacingDemo } from './data';
import { Program, RuleBook, Routine, State, TradingItem, TradingProfile } from './model';
import { isManaged } from './rotation';
import { reconcileEditedRoutine, upsertRoutine } from './routines';
import { recordCapStops } from './trading-live';
import { loggedBlockIds } from './workouts';

// Setup import with a preview. The preview is computed from a dry run of the real import, so it
// describes exactly what Import would do: programs and routines added or replaced, plans, circuits
// and rulebooks added or left alone, a trading process reworded, and existing routines with the
// same name as an incoming one.

export type SetupConflict = {
  title: string;
  /** The routine already on this device. */
  existing: { id: string; program: string };
  /** The incoming routine with the same name and a different ID. */
  incoming: { id: string; program: string };
};

/** What a re-import changes in a trading process already on the device (`withFileWording`). */
export type TradingUpdate = {
  /** Framework steps, review items and hard violations whose title or details change. */
  reworded: number;
  violationsAdded: number;
  /** The entry limit the file sets where the device had none, or null. */
  maxEntries: number | null;
  /** The instrument's name, when the file sets the instrument where the device had none. */
  instrument: string | null;
  /** The numeric risk limits the file sets where the device had none, in order. */
  risk: ('maxContracts' | 'thesisRisk' | 'dailyLoss')[];
};

export type SetupPreview = {
  programsAdded: string[];
  programsReplaced: string[];
  programsUnchanged: string[];
  routinesAdded: string[];
  routinesReplaced: string[];
  plansAdded: number;
  circuitsAdded: number;
  rulebooksAdded: number;
  /** Of the rulebooks added, those that bring the Trading discipline process with them. */
  rulebooksWithTrading: number;
  /**
   * Rulebooks already on the device that gain the Trading discipline process (their rules and
   * reviews are kept). A rulebook new from the file is counted in `rulebooksWithTrading` instead.
   */
  tradingAdded: number;
  /** How the import changes a trading process already on the device, or null when it does not. */
  tradingUpdated: TradingUpdate | null;
  /**
   * Hard violations new in the file that a process already on the device has no room for: it holds
   * at most `MAX_VIOLATIONS`. They are left out; everything else imports.
   */
  violationsLeftOut: string[];
  /**
   * Plans, circuits and rulebooks in the file for routines that already have one, kept as they
   * are, by kind; a rulebook whose trading process the import changes is not among them.
   */
  recordsKept: { plans: number; circuits: number; rulebooks: number };
  optionalRoutines: string[];
  /**
   * What the file places in the order of the day: routines that had no order on this device, a
   * rotation once by its program's name, and never a bundled step, which sits inside its parent.
   */
  orderSet: string[];
  settingsReplaced: boolean;
  notesReplaced: boolean;
  /** Existing active routines named like an incoming routine with another ID. */
  conflicts: SetupConflict[];
  /** Choices made on this device that the import keeps instead of the file's. */
  keptOnDevice: string[];
  /** Recorded history on this device, all of it kept. */
  historyKept: { days: number; records: number };
  /** What the imported programs still need before they work fully (see `setupGaps`). */
  gaps: string[];
};

const RECORD_LISTS = [
  'measurements',
  'lifeLog',
  'workoutSessions',
  'moneyReviews',
  'intervalSessions',
  'activitySessions',
  'ruleReviews',
] as const;

/** Days with anything recorded (done or skipped) and every record, on a device. */
function history(state: State): { days: number; records: number } {
  return {
    days: Object.values(state.days).filter((d) => d.blocks.some((b) => b.status !== 'planned'))
      .length,
    records: RECORD_LISTS.reduce((n, key) => n + state[key].length, 0),
  };
}

/**
 * What a setup still needs before it works fully, in the user's words: active objectives with no
 * days (they would never appear) and a trading process without limits. A rotation workout without a
 * workout plan is not a gap: it is a plain checklist workout. Empty when nothing is missing.
 * Restricted to `programIds` when given.
 */
export function setupGaps(state: State, programIds?: Set<string>): string[] {
  const gaps: string[] = [];
  const programs = state.programs.filter((p) => !programIds || programIds.has(p.id));
  for (const program of programs)
    for (const routine of program.routines) {
      if (!routine.enabled || isManaged(state.programs, routine)) continue;
      if (routine.weekdays === null && !routine.bundledInto)
        gaps.push(
          `${routine.title} has no days chosen yet, so it comes up every day. Choose its days in Programs.`,
        );
      else if (routine.weekdays !== null && !routine.weekdays.length)
        gaps.push(
          `${routine.title} has no days yet, so it never comes up. Set its days in Programs.`,
        );
    }
  for (const book of state.ruleBooks) {
    const program = programs.find((p) => p.routines.some((r) => r.id === book.routineId));
    if (program && book.trading && !book.trading.limits.length)
      gaps.push('Trading discipline has no limits written yet. Add yours on the Trading page.');
  }
  return gaps;
}

/**
 * Device choices the import keeps over the file's, described per routine or program. `imported` is
 * the catalog after the import, so a choice the import has to drop is never listed as kept.
 */
function keptChoices(file: Program[], existing: State, imported: Program[]): string[] {
  const kept: string[] = [];
  // The order of the day stays with the routine wherever it sits on the device.
  const placed = new Map(routinesOf(existing.programs).map((x) => [x.routine.id, x.routine]));
  for (const r of file.flatMap((p) => p.routines ?? [])) {
    const old = placed.get(r.id);
    if (old?.dayOrder !== undefined && r.dayOrder !== undefined && r.dayOrder !== old.dayOrder)
      kept.push(`${old.title}: your place in the order of the day`);
  }
  for (const incoming of file) {
    const before = existing.programs.find((p) => p.id === incoming.id);
    if (!before) continue;
    const file = incoming.rotation;
    const merged = keptRotation(file, before.rotation);
    const days = (d: number[] | undefined) => [...(d ?? [])].sort((a, b) => a - b).join();
    if (
      file &&
      before.rotation &&
      merged &&
      (days(merged.restDays) !== days(file.restDays) ||
        (merged.startWith ?? null) !== (file.startWith ?? null))
    )
      kept.push(`${before.title}: your rest days and starting workout`);
    const plan = (p: Routine['study']) =>
      JSON.stringify(p && { stages: p.stages, at: p.at, reminders: p.reminders, cue: p.cue });
    const after = imported.find((p) => p.id === incoming.id);
    for (const r of incoming.routines ?? []) {
      const old = before.routines.find((x) => x.id === r.id);
      if (!old) continue;
      if (old.study && r.study && plan(old.study) !== plan(r.study))
        kept.push(`${old.title}: your study plan, reminders and streak`);
      if (!old.enabled && r.enabled !== false) kept.push(`${old.title}: stays paused`);
      const every = after?.routines.find((x) => x.id === r.id)?.repeat?.everyWeeks ?? 1;
      if (r.repeat === undefined && every > 1)
        kept.push(`${old.title}: repeats every ${every} weeks`);
    }
  }
  return kept;
}

const name = (title: string) => title.trim().toLowerCase();

function routinesOf(programs: Program[]): { routine: Routine; program: Program }[] {
  return programs.flatMap((program) => program.routines.map((routine) => ({ routine, program })));
}

/** Items whose title or details differ between two versions of one list, matched by ID. */
function reworded(before: TradingItem[], after: TradingItem[]): number {
  return before.filter((item) => {
    const next = after.find((x) => x.id === item.id);
    return next && (next.title !== item.title || next.details !== item.details);
  }).length;
}

function tradingUpdate(before: TradingProfile, after: TradingProfile): TradingUpdate {
  return {
    reworded:
      reworded(before.framework, after.framework) +
      reworded(before.checklist, after.checklist) +
      reworded(before.violations, after.violations),
    violationsAdded: after.violations.length - before.violations.length,
    maxEntries:
      before.maxEntries === undefined && after.maxEntries !== undefined ? after.maxEntries : null,
    instrument: !before.instrument && after.instrument ? after.instrument.name : null,
    risk: (['maxContracts', 'thesisRisk', 'dailyLoss'] as const).filter(
      (k) => (before.risk?.[k] ?? null) === null && (after.risk?.[k] ?? null) !== null,
    ),
  };
}

/**
 * The titles of the file's new hard violations that a process already on the device did not take,
 * because it was full (`withFileWording`).
 */
function violationsLeftOut(before: RuleBook[], after: RuleBook[], list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const left: string[] = [];
  for (const book of before) {
    if (!book.trading) continue;
    const file = (list as Partial<RuleBook>[]).find(
      (x) => x && typeof x === 'object' && x.routineId === book.routineId && x.trading,
    )?.trading;
    const taken = new Set(
      after.find((x) => x.id === book.id)?.trading?.violations.map((v) => v.id),
    );
    for (const v of file?.violations ?? []) if (!taken.has(v.id)) left.push(v.title);
  }
  return left;
}

function countRecords(raw: string, key: string): number {
  const value = (JSON.parse(raw) as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : 0;
}

/** What importing `raw` would change. Throws, like the import itself, for an invalid file. */
export function previewSetup(raw: string, device: State, now: string): SetupPreview {
  // Importing over the demo replaces it, exactly as the import does.
  const existing = device.source === 'demo' ? replacingDemo(device) : device;
  const next = mergedSetup(raw, existing, now);
  const file = JSON.parse(raw) as Record<string, unknown>;
  const before = new Map(existing.programs.map((p) => [p.id, p]));
  const incomingIds = new Set(
    ((file.programs as { id?: unknown }[]) ?? []).map((p) => String(p.id)),
  );
  const imported = next.programs.filter((p) => incomingIds.has(p.id));
  const fileRoutines = (file.programs as Program[]) ?? [];
  const existingRoutines = routinesOf(existing.programs);
  const existingIds = new Set(existingRoutines.map((x) => x.routine.id));
  const importedRoutines = routinesOf(imported);
  const changed = (p: Program) => JSON.stringify(before.get(p.id)) !== JSON.stringify(p);
  const added = (key: 'workoutTemplates' | 'intervalRoutines' | 'ruleBooks') =>
    next[key].length - existing[key].length;
  // Rulebooks already on the device whose trading process the import adds or changes.
  const processChanged = existing.ruleBooks.filter(
    (b) =>
      JSON.stringify(b.trading) !==
      JSON.stringify(next.ruleBooks.find((x) => x.id === b.id)?.trading),
  );
  const updated = processChanged.find((b) => b.trading);
  const after = updated && next.ruleBooks.find((x) => x.id === updated.id)!.trading!;
  const existingBooks = new Set(existing.ruleBooks.map((b) => b.id));
  const newBooks = next.ruleBooks.filter((b) => !existingBooks.has(b.id));
  return {
    programsAdded: imported.filter((p) => !before.has(p.id)).map((p) => p.title),
    programsReplaced: imported.filter((p) => before.has(p.id) && changed(p)).map((p) => p.title),
    programsUnchanged: imported.filter((p) => before.has(p.id) && !changed(p)).map((p) => p.title),
    routinesAdded: importedRoutines
      .filter((x) => !existingIds.has(x.routine.id))
      .map((x) => x.routine.title),
    routinesReplaced: importedRoutines
      .filter((x) => {
        const old = existingRoutines.find((e) => e.routine.id === x.routine.id);
        return old && JSON.stringify(old.routine) !== JSON.stringify(x.routine);
      })
      .map((x) => x.routine.title),
    plansAdded: added('workoutTemplates'),
    circuitsAdded: added('intervalRoutines'),
    rulebooksAdded: added('ruleBooks'),
    rulebooksWithTrading: newBooks.filter((b) => b.trading).length,
    tradingAdded: existing.ruleBooks.filter(
      (b) => !b.trading && next.ruleBooks.find((x) => x.id === b.id)?.trading,
    ).length,
    tradingUpdated: updated && after ? tradingUpdate(updated.trading!, after) : null,
    violationsLeftOut: violationsLeftOut(existing.ruleBooks, next.ruleBooks, file.ruleBooks),
    recordsKept: {
      plans: countRecords(raw, 'workoutTemplates') - added('workoutTemplates'),
      circuits: countRecords(raw, 'intervalRoutines') - added('intervalRoutines'),
      // Only rulebooks carry a trading process, so a changed one is only ever among them.
      rulebooks: countRecords(raw, 'ruleBooks') - added('ruleBooks') - processChanged.length,
    },
    optionalRoutines: importedRoutines
      .filter((x) => x.routine.optional)
      .map((x) => x.routine.title),
    orderSet: [
      ...new Set(
        importedRoutines
          .filter(
            (x) =>
              x.routine.dayOrder !== undefined &&
              !x.routine.bundledInto &&
              existingRoutines.find((e) => e.routine.id === x.routine.id)?.routine.dayOrder ===
                undefined,
          )
          .map((x) =>
            x.program.rotation?.order.includes(x.routine.id) ? x.program.title : x.routine.title,
          ),
      ),
    ],
    settingsReplaced:
      file.settings !== undefined &&
      JSON.stringify(next.settings) !== JSON.stringify(existing.settings),
    notesReplaced:
      file.notes !== undefined && JSON.stringify(next.notes) !== JSON.stringify(existing.notes),
    conflicts: sameNamed(existing, imported),
    keptOnDevice: keptChoices(fileRoutines, existing, imported),
    historyKept: history(existing),
    gaps: setupGaps(next, incomingIds),
  };
}

/** Active routines on the device named like an incoming routine that has a different ID. */
function sameNamed(existing: State, imported: Program[]): SetupConflict[] {
  const conflicts: SetupConflict[] = [];
  for (const { routine, program } of routinesOf(imported)) {
    for (const other of routinesOf(existing.programs)) {
      if (
        other.routine.id !== routine.id &&
        other.routine.enabled &&
        !other.routine.bundledInto &&
        !imported.some((p) => p.id === other.program.id) &&
        name(other.routine.title) === name(routine.title)
      )
        conflicts.push({
          title: routine.title,
          existing: { id: other.routine.id, program: other.program.title },
          incoming: { id: routine.id, program: program.title },
        });
    }
  }
  return conflicts;
}

/**
 * "1 timed circuit and 1 rulebook": the records a preview leaves alone, each kind named apart as
 * the line of what it adds does; empty when there are none.
 */
export function keptRecordsText(kept: SetupPreview['recordsKept']): string {
  const parts = (
    [
      [kept.plans, 'workout plan'],
      [kept.circuits, 'timed circuit'],
      [kept.rulebooks, 'rulebook'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : (parts[0] ?? '');
}

/**
 * The setup merged into the device (`parseSetup`), with today's and later planned, unrecorded
 * occurrences of every routine the file changed brought in line with it, as an edit in Programs
 * would (`reconcileEditedRoutine`). An unchanged file changes no day.
 */
function mergedSetup(raw: string, existing: State, now: string): State {
  let next = parseSetup(raw, existing, now);
  // A session cap the file cut, reached already, is saved as the session's stop, as in Your limits.
  for (const book of next.ruleBooks)
    if (book.trading) next = recordCapStops(next, book.routineId, now);
  const before = new Map(existing.programs.flatMap((p) => p.routines).map((r) => [r.id, r]));
  const keep = loggedBlockIds(existing);
  let days = next.days;
  for (const routine of next.programs.flatMap((p) => p.routines)) {
    const previous = before.get(routine.id);
    if (!previous || JSON.stringify(previous) === JSON.stringify(routine)) continue;
    days = reconcileEditedRoutine(days, next.programs, routine, previous, now, keep);
  }
  return days === next.days ? next : { ...next, days };
}

/**
 * Imports a setup file. With `pauseSameNamed`, existing routines named like an incoming one are
 * paused (never deleted): their history stays, and pausing removes only their planned, unrecorded
 * occurrences from today on, as pausing always does.
 */
export function importSetup(
  raw: string,
  existing: State,
  now: string,
  options: { pauseSameNamed: boolean },
): State {
  if (existing.source === 'demo') existing = replacingDemo(existing);
  let next = mergedSetup(raw, existing, now);
  if (!options.pauseSameNamed) return next;
  const incomingIds = new Set(
    ((JSON.parse(raw) as { programs: { id?: unknown }[] }).programs ?? []).map((p) => String(p.id)),
  );
  const conflicts = sameNamed(
    existing,
    next.programs.filter((p) => incomingIds.has(p.id)),
  );
  for (const id of new Set(conflicts.map((c) => c.existing.id))) {
    const program = next.programs.find((p) => p.routines.some((r) => r.id === id));
    const routine = program?.routines.find((r) => r.id === id);
    if (!program || !routine) continue;
    next = upsertRoutine(next, program, { ...routine, enabled: false }, now);
  }
  return next;
}
