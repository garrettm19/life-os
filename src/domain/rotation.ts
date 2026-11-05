import { copyBlock } from './bundles';
import { withDay } from './data';
import {
  Block,
  Day,
  Program,
  ProgramRotation,
  Routine,
  State,
  dateObject,
  daysBetween,
  localDate,
  shiftDate,
} from './model';
import { circuitSessionFor } from './intervals';
import {
  checklistNeedsEnsure,
  ensureChecklistDay,
  recordDueTimed,
  revision,
  setStatus,
} from './planner';
import { validateRotation } from './records';
import { doneSets, loggedBlockIds, sessionFor } from './workouts';

// Workout rotations and companion objectives.
//
// A rotation is an ordered list of workout routines in one program, one per training day. Nothing
// about its progress is stored: the next workout is derived from the last one completed, so a rest
// day, a missed day, a move or an Undo can never advance or corrupt the sequence. Only today's
// workout is placed on the plan (when Today opens); later days are a projection, because which
// workout comes next depends on what actually happens today.
//
// A companion routine (for example a home routine after certain gym days) is due on any day that
// holds an occurrence of a routine it follows. It is its own objective: completing the parent never
// completes it. An explicit move uses the same `movedFrom` / `moved` markers as a workout shift, so
// generation never recreates it on the original day and the parent stays put.
//
// Tests: __tests__/rotation.test.ts and rotation-cycle.test.ts.

export function rotationProgram(
  programs: Program[],
  routineId: string | null,
): Program | undefined {
  if (!routineId) return undefined;
  return programs.find((p) => p.rotation?.order.includes(routineId));
}

function routineIn(programs: Program[], routineId: string): Routine | undefined {
  for (const p of programs) {
    const r = p.routines.find((x) => x.id === routineId);
    if (r) return r;
  }
  return undefined;
}

/**
 * The routines a program's rotation can hold, in program order: its current members and the
 * routines with a workout plan. A program without any workout plan offers its plain routines
 * instead, so a rotation of plain checklist workouts (no exercises) can be edited too: not a
 * bundled step or a companion, and not a study, circuit, recording, alternating or repeating
 * objective.
 */
export function rotationWorkouts(state: State, program: Program): Routine[] {
  const members = new Set(program.rotation?.order ?? []);
  const planned = program.routines.some((r) => hasPlan(state, r.id));
  return program.routines.filter(
    (r) =>
      members.has(r.id) ||
      (planned
        ? hasPlan(state, r.id)
        : !r.bundledInto &&
          !r.follows?.length &&
          !r.study &&
          !r.capture &&
          !r.alternate &&
          !r.repeat &&
          !state.intervalRoutines.some((c) => c.routineId === r.id)),
  );
}

/**
 * Whether Programs offers the rotation editor for a program: always once it has a rotation, and
 * for setting one up only when it has a workout plan, so a program of plain objectives (a job
 * search, a cardio tick) is never offered one.
 */
export function offersRotation(state: State, program: Program): boolean {
  return !!program.rotation || program.routines.some((r) => hasPlan(state, r.id));
}

function hasPlan(state: State, routineId: string): boolean {
  return state.workoutTemplates.some((t) => t.routineId === routineId);
}

/** A routine whose occurrences come from a rotation or a companion link, not from weekdays. */
export function isManaged(programs: Program[], routine: Routine): boolean {
  return !!routine.follows?.length || !!rotationProgram(programs, routine.id);
}

/** The most recently completed rotation workout before a date, with the date it was done. */
function lastCompleted(
  state: State,
  program: Program,
  before: string,
): { routineId: string; date: string } | null {
  const order = new Set(program.rotation?.order ?? []);
  const dates = Object.keys(state.days)
    .filter((d) => d < before)
    .sort()
    .reverse();
  for (const date of dates) {
    const done = state.days[date].blocks
      .filter((b) => b.status === 'done' && b.routineId && order.has(b.routineId))
      .sort((a, b) => (b.actualAt ?? '').localeCompare(a.actualAt ?? ''));
    if (done.length) return { routineId: done[0].routineId!, date };
  }
  return null;
}

/** The workout after `routineId` in the rotation, skipping paused routines. */
function after(program: Program, routineId: string | null): string | null {
  const rotation = program.rotation!;
  const enabled = (id: string) => !!program.routines.find((r) => r.id === id)?.enabled;
  const order = rotation.order;
  const from = routineId === null ? -1 : order.indexOf(routineId);
  if (routineId === null) {
    const start = rotation.startWith && enabled(rotation.startWith) ? rotation.startWith : null;
    if (start) return start;
  }
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(from + i + order.length) % order.length];
    if (enabled(candidate)) return candidate;
  }
  return null;
}

/** The workout due next on `date`: the one after the last completed before it. */
export function nextWorkout(state: State, program: Program, date: string): string | null {
  return after(program, lastCompleted(state, program, date)?.routineId ?? null);
}

/** Whether a program rests on a date: the user's choice for that day, else its rest weekdays. */
export function isRestDay(program: Program, day: Day | undefined, date: string): boolean {
  const choice = day?.rotation?.find((o) => o.programId === program.id);
  if (choice) return choice.mode === 'rest';
  return program.rotation!.restDays.includes(dateObject(date).getDay());
}

function memberBlocks(program: Program, day: Day | undefined): Block[] {
  const order = new Set(program.rotation?.order ?? []);
  return day?.blocks.filter((b) => b.routineId && order.has(b.routineId)) ?? [];
}

/**
 * Routines due on a date by rotation or companion link, in addition to weekday recurrence. A
 * rotation workout is added only on the actual day, only on a training day, and only when the day
 * has no workout of that rotation yet (done, planned, skipped or moved). Workouts already on the
 * day stay due so the daily ensure never removes them.
 */
export function extraDue(state: State, date: string, today: string): Set<string> {
  const day = state.days[date];
  const due = new Set<string>();
  for (const program of state.programs) {
    if (!program.rotation) continue;
    const present = memberBlocks(program, day);
    for (const b of present) {
      const routine = program.routines.find((r) => r.id === b.routineId);
      if (routine?.enabled) due.add(b.routineId!);
    }
    const movedOff = day?.moved?.some((m) => program.rotation!.order.includes(m.routineId));
    if (date !== today || present.length || movedOff || isRestDay(program, day, date)) continue;
    const next = nextWorkout(state, program, date);
    if (next) due.add(next);
  }
  const onDay = new Set([...(day?.blocks.map((b) => b.routineId) ?? []), ...due]);
  const movedOut = new Set(day?.moved?.map((m) => m.routineId) ?? []);
  const heldElsewhere = openCompanionMoves(state, date);
  for (const program of state.programs)
    for (const routine of program.routines)
      if (
        routine.enabled &&
        // A rotation workout is placed by its rotation only, never as a companion.
        !rotationProgram(state.programs, routine.id) &&
        routine.follows?.some((id) => onDay.has(id)) &&
        !movedOut.has(routine.id) &&
        !heldElsewhere.has(routine.id)
      )
        due.add(routine.id);
  return due;
}

// Planned companion moves by routine and the dates holding them, built once per saved history (a
// save replaces `days` and `programs`), so opening several days does not rescan every stored day.
const companionMoves = new WeakMap<
  State['days'],
  { programs: State['programs']; byRoutine: Map<string, Set<string>> }
>();

/** Planned companion occurrences sitting on another day by an explicit move. */
function openCompanionMoves(state: State, exceptDate: string): Set<string> {
  let index = companionMoves.get(state.days);
  if (!index || index.programs !== state.programs) {
    const byRoutine = new Map<string, Set<string>>();
    for (const [date, other] of Object.entries(state.days))
      for (const block of other.blocks) {
        if (block.status !== 'planned' || !block.routineId || !block.movedFrom) continue;
        if (!routineIn(state.programs, block.routineId)?.follows?.length) continue;
        const dates = byRoutine.get(block.routineId) ?? new Set<string>();
        dates.add(date);
        byRoutine.set(block.routineId, dates);
      }
    index = { programs: state.programs, byRoutine };
    companionMoves.set(state.days, index);
  }
  const held = new Set<string>();
  for (const [routineId, dates] of index.byRoutine)
    if (dates.size > 1 || !dates.has(exceptDate)) held.add(routineId);
  return held;
}

/** Occurrences on a date that generation must keep: logged workouts and managed routines. */
export function planKeep(state: State, date: string): Set<string> {
  const keep = loggedBlockIds(state);
  for (const b of state.days[date]?.blocks ?? []) {
    const routine = b.routineId ? routineIn(state.programs, b.routineId) : undefined;
    if (routine && isManaged(state.programs, routine)) keep.add(b.id);
  }
  return keep;
}

/** Whether opening a date on Today needs to add or remove due checklist items. */
export function needsEnsure(state: State, date: string, today: string): boolean {
  return checklistNeedsEnsure(
    date,
    state.programs,
    state.days[date],
    today,
    loggedBlockIds(state),
    extraDue(state, date, today),
  );
}

/** Today's (or another day's) due checklist items, including rotation workouts and companions. */
export function ensureDay(state: State, date: string, now: string): State {
  const today = localDate(new Date(now));
  return withDay(
    state,
    ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      state.days[date],
      now,
      loggedBlockIds(state),
      extraDue(state, date, today),
    ),
  );
}

function setChoice(day: Day, programId: string, mode: 'rest' | 'train' | null, now: string): Day {
  const others = (day.rotation ?? []).filter((o) => o.programId !== programId);
  const rotation = mode ? [...others, { programId, mode, at: now }] : others;
  const next: Day = { ...day, rotation };
  if (!rotation.length) delete next.rotation;
  return next;
}

/**
 * Takes a rest day: the day's planned rotation workout (and companions that only followed it) come
 * off the plan, and the workout stays next for the following training day. A workout already done
 * or with logged sets is kept; rest is refused rather than hiding those sets.
 */
export function restDay(state: State, programId: string, date: string, now: string): State {
  const program = state.programs.find((p) => p.id === programId);
  if (!program?.rotation) throw new Error('This program has no rotation.');
  if (date < localDate(new Date(now))) throw new Error('Only today and later days can rest.');
  const day = state.days[date] ?? { date, blocks: [], revisions: [] };
  const members = memberBlocks(program, day);
  if (members.some((b) => b.status === 'done'))
    throw new Error('A workout is already done today. Undo it first to rest instead.');
  const logged = members.find((b) => {
    const session = sessionFor(state, b.id);
    return session?.status === 'active' && doneSets(session) > 0;
  });
  if (logged)
    throw new Error(
      `${logged.title} has logged sets. Finish it, or keep it for later, instead of resting.`,
    );
  if (members.some((b) => b.bundledSteps?.some((step) => step.status !== 'planned')))
    throw new Error('Part of this workout is already recorded. Undo it first to rest instead.');
  const keep = loggedBlockIds(state);
  const leaving = new Set(
    members.filter((b) => b.status === 'planned' && !b.movedFrom).map((b) => b.id),
  );
  const leavingRoutines = new Set(
    day.blocks.filter((b) => leaving.has(b.id)).map((b) => b.routineId),
  );
  const remaining = day.blocks.filter((b) => !leaving.has(b.id));
  const stillPresent = new Set(remaining.map((b) => b.routineId));
  // A companion leaves too when nothing it follows remains and nothing on it is recorded or logged.
  const blocks = remaining.filter((b) => {
    const routine = b.routineId ? routineIn(state.programs, b.routineId) : undefined;
    if (!routine?.follows?.length || b.status !== 'planned' || keep.has(b.id)) return true;
    // An independently moved companion stays even if its parent is resting.
    if (b.movedFrom) return true;
    if (b.bundledSteps?.some((step) => step.status !== 'planned')) return true;
    // A timed circuit already run keeps its occurrence, so its record is never orphaned.
    if (circuitSessionFor(state, b.id)) return true;
    const followsLeaving = routine.follows.some((id) => leavingRoutines.has(id));
    const followsPresent = routine.follows.some((id) => stillPresent.has(id));
    return !followsLeaving || followsPresent;
  });
  const changed = blocks.length !== day.blocks.length;
  const planned = changed
    ? revision(day, blocks.map(copyBlock), 'Rest day', now)
    : { ...day, blocks: day.blocks.map(copyBlock) };
  const weekday = dateObject(date).getDay();
  const restsByDefault = program.rotation.restDays.includes(weekday);
  return withDay(state, setChoice(planned, programId, restsByDefault ? null : 'rest', now));
}

/**
 * Skip on Today. A planned rotation workout on today or a later day is not marked skipped:
 * Skip rests its program that day (`restDay`, with the same refusals), so the workout and the
 * companions that came with it leave the day and the workout stays next for the following training
 * day. Any other objective, and a workout on a past day or moved there, is marked skipped: excused
 * for the day, never done.
 */
export function skipObjective(state: State, date: string, blockId: string, now: string): State {
  const day = state.days[date];
  const block = day?.blocks.find((b) => b.id === blockId);
  if (!day || !block) throw new Error('This block no longer exists.');
  const program = rotationProgram(state.programs, block.routineId);
  if (program && block.status === 'planned' && !block.movedFrom && date >= localDate(new Date(now)))
    return restDay(state, program.id, date, now);
  return withDay(state, setStatus(day, blockId, 'skipped', now));
}

/**
 * Programs that rest on a date by the user's choice (Rest today, or Skip on the workout), on a day
 * they would otherwise train: Today shows each as a quiet row in the workout's place, with Undo
 * (`trainDay`). A default rest weekday is not a choice and reads as a rest day instead.
 */
export function restedByChoice(state: State, date: string): Program[] {
  const day = state.days[date];
  return state.programs.filter(
    (p) =>
      !!p.rotation &&
      !!day?.rotation?.some((o) => o.programId === p.id && o.mode === 'rest') &&
      !p.rotation.restDays.includes(dateObject(date).getDay()),
  );
}

/** Trains on a date the program would otherwise rest; Today then adds the next workout. */
export function trainDay(state: State, programId: string, date: string, now: string): State {
  const program = state.programs.find((p) => p.id === programId);
  if (!program?.rotation) throw new Error('This program has no rotation.');
  if (date < localDate(new Date(now))) throw new Error('Only today and later days can change.');
  const day = state.days[date] ?? { date, blocks: [], revisions: [] };
  const restsByDefault = program.rotation.restDays.includes(dateObject(date).getDay());
  return withDay(state, setChoice(day, programId, restsByDefault ? 'train' : null, now));
}

export type ProjectedDay = {
  date: string;
  routineId: string | null;
  kind: 'done' | 'skipped' | 'planned' | 'projected' | 'rest';
};

/**
 * The rotation over the coming days: what is recorded or planned for today, then each later
 * training day taking the following workout, assuming each planned one gets done. A projection,
 * not a plan: nothing here is saved.
 */
export function projectRotation(
  state: State,
  program: Program,
  today: string,
  days = 7,
): ProjectedDay[] {
  if (!program.rotation) return [];
  const result: ProjectedDay[] = [];
  let pointer = nextWorkout(state, program, today);
  for (let i = 0; i < days; i++) {
    const date = shiftDate(today, i);
    const day = state.days[date];
    const present = memberBlocks(program, day);
    if (present.length) {
      const b = present[0];
      result.push({
        date,
        routineId: b.routineId,
        kind: b.status === 'done' ? 'done' : b.status === 'skipped' ? 'skipped' : 'planned',
      });
      if (b.status !== 'skipped') pointer = after(program, b.routineId);
      continue;
    }
    if (isRestDay(program, day, date) || !pointer) {
      result.push({ date, routineId: null, kind: 'rest' });
      continue;
    }
    result.push({ date, routineId: pointer, kind: 'projected' });
    pointer = after(program, pointer);
  }
  return result;
}

export type ProjectedWorkout = {
  program: Program;
  routineId: string;
  title: string;
  /** Companions that would come with it on the day, by title. */
  companions: string[];
};

/**
 * The rotation workouts projected onto a later day (each is placed only on its actual day), so
 * Today can say what that day is expected to hold, as Week and the Tomorrow preview do. Nothing is
 * saved and the day's count is unchanged.
 */
export function projectedWorkouts(state: State, date: string, today: string): ProjectedWorkout[] {
  if (date <= today) return [];
  const day = state.days[date];
  const present = new Set([
    ...(day?.blocks.map((b) => b.routineId) ?? []),
    ...(day?.moved?.map((m) => m.routineId) ?? []),
  ]);
  return state.programs.flatMap((program): ProjectedWorkout[] => {
    if (!program.rotation || memberBlocks(program, day).length) return [];
    const projected = projectRotation(state, program, today, daysBetween(today, date) + 1).at(-1);
    if (projected?.kind !== 'projected' || !projected.routineId) return [];
    const routineId = projected.routineId;
    const title = routineIn(state.programs, routineId)?.title;
    if (!title) return [];
    const companions = state.programs
      .flatMap((p) => p.routines)
      .filter((r) => r.enabled && r.follows?.includes(routineId) && !present.has(r.id))
      .map((r) => r.title);
    return [{ program, routineId, title, companions }];
  });
}

/**
 * Turns a program's rotation on, changes it, or turns it off. Rotation workouts become checklist
 * objectives without weekdays (the rotation decides their days). Planned, unrecorded occurrences of
 * them from today on are removed so the rotation can place the right one; recorded, logged or moved
 * occurrences and past days are never touched.
 */
export type LeavingWorkout = { routineId: string; title: string; suggested: number[] | null };

/**
 * Workouts that a rotation change would take out of the rotation (all of them when it is turned
 * off), with the schedule each had before it joined. They need days again: the remembered ones are
 * suggested; one with none remembered (for example from a setup file) must be given days.
 */
export function leavingWorkouts(
  state: State,
  programId: string,
  rotation: ProgramRotation | null,
): LeavingWorkout[] {
  const program = state.programs.find((p) => p.id === programId);
  if (!program?.rotation) return [];
  const staying = new Set(rotation?.order ?? []);
  return program.rotation.order
    .filter((id) => !staying.has(id))
    .map((id) => {
      const routine = program.routines.find((r) => r.id === id);
      const before = program.rotation!.previous?.find((p) => p.routineId === id);
      return {
        routineId: id,
        title: routine?.title ?? id,
        suggested: before?.weekdays?.length ? [...before.weekdays] : null,
      };
    });
}

export function setRotation(
  state: State,
  programId: string,
  rotation: ProgramRotation | null,
  now: string,
  /** Days for workouts leaving the rotation; defaults to the schedule each had before. */
  schedules: Record<string, number[]> = {},
): State {
  const program = state.programs.find((p) => p.id === programId);
  if (!program) throw new Error('This program no longer exists.');
  if (rotation) {
    try {
      validateRotation(rotation, new Set(program.routines.map((r) => r.id)));
    } catch {
      throw new Error('Choose at least one workout and leave at least one training day.');
    }
    const companion = program.routines.find(
      (r) => rotation.order.includes(r.id) && r.follows?.length,
    );
    if (companion)
      throw new Error(
        `${companion.title} follows other workouts, so it cannot also be in the rotation.`,
      );
  }
  const members = new Set(rotation?.order ?? []);
  const remembered = (id: string) => program.rotation?.previous?.find((p) => p.routineId === id);
  // A workout leaving gets its own schedule back (or the days chosen now); it never goes dayless.
  const leaving = new Map<string, { weekdays: number[]; checklist: boolean }>();
  for (const w of leavingWorkouts(state, programId, rotation)) {
    const routine = program.routines.find((r) => r.id === w.routineId);
    const weekdays = schedules[w.routineId] ?? w.suggested ?? [];
    if (routine?.enabled && !weekdays.length)
      throw new Error(`Choose days for ${w.title} before it leaves the rotation.`);
    leaving.set(w.routineId, {
      weekdays: [...weekdays].sort(),
      checklist: remembered(w.routineId)?.checklist ?? true,
    });
  }
  const nextProgram: Program = {
    ...program,
    routines: program.routines.map((r) => {
      if (members.has(r.id)) return { ...r, checklist: true, weekdays: [] };
      const back = leaving.get(r.id);
      return back ? { ...r, ...back } : r;
    }),
  };
  if (rotation) {
    // Remember each member's schedule from before it joined (kept from earlier saves).
    const previous = rotation.order.map(
      (id) =>
        remembered(id) ?? {
          routineId: id,
          weekdays: program.routines.find((r) => r.id === id)?.weekdays ?? null,
          checklist: !!program.routines.find((r) => r.id === id)?.checklist,
        },
    );
    nextProgram.rotation = { ...rotation, order: [...rotation.order], previous };
  } else delete nextProgram.rotation;
  const days = { ...state.days };
  for (const [date, blocks] of Object.entries(replacedDays(state, members, now)))
    days[date] = revision(state.days[date], blocks.map(copyBlock), 'Set workout rotation', now);
  return {
    ...state,
    programs: state.programs.map((p) => (p.id === programId ? nextProgram : p)),
    days,
  };
}

/**
 * The days from today on that a rotation of `members` changes, with what each keeps: a planned,
 * unrecorded occurrence of a member is removed so the rotation can place the right one, while a
 * recorded, logged or moved one and past days are never touched.
 */
function replacedDays(
  state: State,
  members: ReadonlySet<string>,
  now: string,
): Record<string, Block[]> {
  const today = localDate(new Date(now));
  const keep = loggedBlockIds(state);
  const changed: Record<string, Block[]> = {};
  for (const [date, day] of Object.entries(state.days)) {
    if (date < today) continue;
    const blocks = day.blocks.filter(
      (b) =>
        !(
          b.routineId &&
          members.has(b.routineId) &&
          b.status === 'planned' &&
          !b.movedFrom &&
          !keep.has(b.id) &&
          !b.bundledSteps?.some((step) => step.status !== 'planned') &&
          b.id === `${date}:routine:${b.routineId}`
        ),
    );
    if (blocks.length !== day.blocks.length) changed[date] = blocks;
  }
  return changed;
}

/**
 * The coming days of a rotation as it would be saved (`setRotation`): projected from the days it
 * would leave, so a draft that rests today, starts with another workout or reorders them shows what
 * Save then places, not the workout it is about to replace.
 */
export function projectDraftRotation(
  state: State,
  program: Program,
  rotation: ProgramRotation,
  now: string,
): ProjectedDay[] {
  const days = { ...state.days };
  for (const [date, blocks] of Object.entries(replacedDays(state, new Set(rotation.order), now)))
    days[date] = { ...state.days[date], blocks };
  return projectRotation({ ...state, days }, { ...program, rotation }, localDate(new Date(now)));
}

export type CompanionMovePlan = {
  routineId: string;
  title: string;
  from: string;
  to: string;
  original: string;
  /** Parent workouts that stay on the source day. */
  staying: string[];
  conflict: string | null;
};

function companionRoutine(state: State, routineId: string): Routine | undefined {
  const routine = routineIn(state.programs, routineId);
  return routine?.follows?.length && !rotationProgram(state.programs, routineId)
    ? routine
    : undefined;
}

function companionBlock(state: State, date: string, routineId: string): Block | undefined {
  return state.days[date]?.blocks.find((b) => b.routineId === routineId);
}

function companionMoveConflict(
  state: State,
  block: Block,
  from: string,
  to: string,
  today: string,
): string | null {
  if (from === to) return 'Choose a different day.';
  if (to < today) return 'Only today and later days can receive a moved companion.';
  if (from < today) return 'A past companion stays where it was recorded.';
  if (block.status !== 'planned')
    return block.status === 'done'
      ? 'This companion is already done. Undo it first to move it.'
      : 'A skipped companion stays on its day. Undo the skip first to move it.';
  if (block.bundledSteps?.some((step) => step.status !== 'planned'))
    return 'Part of this companion is already recorded. Undo it first to move it.';
  const session = sessionFor(state, block.id);
  if (session?.status === 'active' && doneSets(session) > 0)
    return `${block.title} has logged sets. Finish it, or keep it for later, instead of moving.`;
  if (circuitSessionFor(state, block.id))
    return 'This circuit already has a recorded session. It stays on this day.';
  const dest = state.days[to];
  if (dest?.blocks.some((b) => b.routineId === block.routineId && b.id !== block.id))
    return `${block.title} is already on ${to}.`;
  dateObject(to);
  return null;
}

/**
 * Preview of moving one companion occurrence to another day. The parent workout stays. Nothing is
 * saved until `applyCompanionMove`.
 */
export function planCompanionMove(
  state: State,
  from: string,
  routineId: string,
  to: string,
  today: string,
): CompanionMovePlan {
  const routine = companionRoutine(state, routineId);
  const block = companionBlock(state, from, routineId);
  const original = block?.movedFrom ?? from;
  const staying = (state.days[from]?.blocks ?? [])
    .filter((b) => b.routineId && routine?.follows?.includes(b.routineId))
    .map((b) => b.title);
  const conflict = !routine
    ? 'Only a companion objective can move on its own.'
    : !block
      ? 'This companion is not on that day.'
      : companionMoveConflict(state, block, from, to, today);
  return {
    routineId,
    title: block?.title ?? routine?.title ?? 'Companion',
    from,
    to,
    original,
    staying,
    conflict,
  };
}

/**
 * Moves one planned companion, keeping its occurrence ID and history. The original day records a
 * `moved` marker so daily generation never recreates it there. Parent workouts are untouched.
 */
export function applyCompanionMove(
  state: State,
  plan: CompanionMovePlan,
  now: string,
  today: string,
): State {
  const fresh = planCompanionMove(state, plan.from, plan.routineId, plan.to, today);
  if (fresh.conflict) throw new Error(fresh.conflict);
  if (
    fresh.from !== plan.from ||
    fresh.to !== plan.to ||
    fresh.original !== plan.original ||
    fresh.title !== plan.title
  )
    throw new Error('The plan changed since this preview. Check it again before moving.');
  const source = companionBlock(state, plan.from, plan.routineId)!;
  const original = source.movedFrom ?? plan.from;
  const days: Record<string, Day> = { ...state.days };
  const touched = new Set<string>();
  const dayAt = (date: string): Day => days[date] ?? { date, blocks: [], revisions: [] };
  const edit = (date: string, change: (day: Day) => Day, reason: string) => {
    const before = dayAt(date);
    const after = change(before);
    days[date] =
      state.days[date] && !touched.has(date)
        ? { ...after, revisions: revision(before, after.blocks, reason, now).revisions }
        : after;
    touched.add(date);
  };
  edit(
    plan.from,
    (day) => ({ ...day, blocks: day.blocks.filter((b) => b.id !== source.id) }),
    'Move companion',
  );
  const block: Block = { ...copyBlock(source) };
  delete block.bundledSteps;
  if (plan.to === original) delete block.movedFrom;
  else block.movedFrom = original;
  edit(plan.to, (day) => ({ ...day, blocks: [...day.blocks, block] }), 'Move companion');
  if (original >= today)
    edit(
      original,
      (day) => {
        const others = (day.moved ?? []).filter((m) => m.routineId !== plan.routineId);
        const moved =
          plan.to === original
            ? others
            : [...others, { routineId: plan.routineId, to: plan.to, at: now }];
        const next: Day = { ...day, moved };
        if (!moved.length) delete next.moved;
        return next;
      },
      'Move companion',
    );
  for (const date of touched)
    if (date >= today) days[date] = recordDueTimed(days[date], state.programs);
  return { ...state, days };
}
