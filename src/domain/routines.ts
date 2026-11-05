import { onItsDays, repeatText } from './repeat';
import { recordStudySchedule } from './study-schedule';
import { attachBundles, copyBlock } from './bundles';
import {
  Block,
  Day,
  Program,
  Routine,
  State,
  displayDate,
  accountSetPause,
  localDate,
  parseTime,
  validateRoutine,
} from './model';
import { makeBlock, recordDueTimed } from './planner';
import { loggedBlockIds } from './workouts';
import { isManaged } from './rotation';
import { occurrenceText } from './alternation';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const TIMED_PLACE_REASON = 'Generate day to place this timed session.';
export const LOCKED_OCCURRENCE_REASON = 'Kept because this time is locked or was edited by you.';

/** A new, empty program with the given fresh id. */
export function blankProgram(id: string): Program {
  return {
    id,
    title: '',
    group: 'Personal',
    goalIds: [],
    routines: [],
  };
}

/** A new, empty routine with the given fresh id. */
export function blankHabit(id: string): Routine {
  return {
    id,
    title: '',
    duration: null,
    weekdays: null,
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    private: false,
  };
}

export function composeRoutine(
  base: Routine,
  input: {
    title: string;
    duration: string;
    start: string;
    thursday: string;
    earliest: string;
    latest: string;
    weekdays: number[] | null;
    enabled: boolean;
    fixed: boolean;
    steps: string;
    checklist: boolean;
    private: boolean;
    /** What completing it records; null for a plain objective, omitted to keep the stored value. */
    capture?: 'weight' | 'money' | 'activity' | 'rules' | null;
  },
): Routine {
  const capture = input.capture === undefined ? base.capture : (input.capture ?? undefined);
  const next: Routine = {
    ...base,
    title: input.title.trim(),
    duration: input.duration.trim() ? Number(input.duration) : null,
    preferredStart: input.start.trim() ? parseTime(input.start) : null,
    thursdayStart: input.thursday.trim() ? parseTime(input.thursday) : null,
    windowStart: input.earliest.trim() ? parseTime(input.earliest) : null,
    windowEnd: input.latest.trim() ? parseTime(input.latest, true) : null,
    weekdays: input.weekdays,
    enabled: input.enabled,
    fixed: input.fixed,
    steps: input.steps
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean),
    checklist: base.bundledInto ? !!base.checklist : !!input.checklist,
    private: !!input.private,
  };
  if (capture) next.capture = capture;
  else delete next.capture;
  return next;
}

export function upsertProgram(state: State, program: Program): State {
  const title = program.title.trim();
  if (!title || title.length > 200) throw new Error('Give the program a name.');
  const existing = state.programs.find((item) => item.id === program.id);
  const nextProgram: Program = {
    ...program,
    title,
    group: program.group.trim() || 'Personal',
    routines: existing?.routines ?? program.routines,
  };
  return {
    ...state,
    source: 'personal',
    days: state.days,
    programs: existing
      ? state.programs.map((item) => (item.id === nextProgram.id ? nextProgram : item))
      : [...state.programs, nextProgram],
  };
}

export const NO_DUE_DAYS = 'Choose at least one day for this habit, or pause it.';

/** An enabled checklist habit with no weekdays would never appear on Today. */
export function needsDueDays(routine: Routine): boolean {
  return (
    routine.enabled &&
    !!routine.checklist &&
    !routine.bundledInto &&
    !routine.weekdays?.length &&
    // A companion is due with the routines it follows.
    !routine.follows?.length
  );
}

export function upsertRoutine(
  state: State,
  program: Program,
  routine: Routine,
  now = new Date().toISOString(),
): State {
  const title = program.title.trim();
  if (!title || title.length > 200) throw new Error('Give the program a name.');
  validateRoutine(routine);
  const previous = state.programs
    .flatMap((item) => item.routines)
    .find((item) => item.id === routine.id);
  // Existing and imported routines keep their recurrence as stored; only a new habit is checked.
  if (!previous && needsDueDays(routine)) throw new Error(NO_DUE_DAYS);
  // One morning anchor at a time: the decoder refuses a second, so say which to change.
  const otherAnchor = state.programs
    .flatMap((item) => item.routines)
    .find((item) => item.id !== routine.id && item.enabled && item.anchor);
  if (routine.anchor && routine.enabled && otherAnchor)
    throw new Error(
      `${otherAnchor.title} is already your morning anchor. Clear its Up by time first.`,
    );
  // After a lost account set, live trading stays paused until its date: no early resume.
  const until = accountSetPause(
    state.ruleBooks.find((b) => b.routineId === routine.id)?.trading,
    localDate(new Date(now)),
  );
  if (routine.enabled && previous?.enabled === false && until)
    throw new Error(`Live trading is paused until ${displayDate(until)}.`);
  // A study objective records when its days or pausing changed, so its streak reads each past day
  // by the schedule that applied then.
  routine = recordStudySchedule(previous, routine, localDate(new Date(now)));
  const nextProgram: Program = {
    ...program,
    title,
    group: program.group.trim() || 'Personal',
    routines: program.routines.some((item) => item.id === routine.id)
      ? program.routines.map((item) => (item.id === routine.id ? routine : item))
      : [...program.routines, routine],
  };
  const programs = state.programs.map((item) => {
    if (item.id === nextProgram.id) return nextProgram;
    if (item.routines.some((entry) => entry.id === routine.id))
      return { ...item, routines: item.routines.filter((entry) => entry.id !== routine.id) };
    return item;
  });
  const nextPrograms = state.programs.some((item) => item.id === nextProgram.id)
    ? programs
    : [...programs, nextProgram];
  return {
    ...state,
    source: 'personal',
    programs: nextPrograms,
    // A workout with logged sets keeps its occurrence, so the sets always stay reachable.
    days: reconcileEditedRoutine(
      state.days,
      nextPrograms,
      routine,
      previous,
      now,
      loggedBlockIds(state),
    ),
  };
}

/**
 * Today's and later planned, unrecorded occurrences of a changed routine follow it, as an edit in
 * Programs does (a setup import uses the same rule). Rotation workouts and companions get their
 * days from the rotation or the routines they follow, not from weekdays, so a change to one keeps
 * its occurrences for Today's ensure and only refreshes their text. Pausing still removes its
 * planned, unrecorded occurrences from today on. Recorded, locked, hand-edited and past ones stay.
 */
export function reconcileEditedRoutine(
  days: State['days'],
  programs: Program[],
  routine: Routine,
  previous: Routine | undefined,
  now: string,
  keep: ReadonlySet<string>,
): State['days'] {
  if (routine.enabled && isManaged(programs, routine))
    return refreshManaged(days, routine, previous, now, keep);
  return reconcileRoutineDays(days, programs, routine, previous, now, keep);
}

/**
 * A rotation workout or companion keeps its occurrences, but today's and later planned, unrecorded
 * ones take the edited name, steps and optional flag (unless the user edited them on the day).
 */
function refreshManaged(
  days: State['days'],
  routine: Routine,
  previous: Routine | undefined,
  now: string,
  keep: ReadonlySet<string>,
): State['days'] {
  const today = localDate(new Date(now));
  let changed = false;
  const next = { ...days };
  for (const [date, day] of Object.entries(days)) {
    if (date < today) continue;
    let dayChanged = false;
    const blocks = day.blocks.map((block) => {
      if (
        block.routineId !== routine.id ||
        block.status !== 'planned' ||
        block.movedFrom !== undefined ||
        keep.has(block.id) ||
        block.id !== generatedId(date, routine.id) ||
        recordedChildren(block)
      )
        return block;
      const updated: Block = {
        ...block,
        ...keepUserEdits(block, previous, routine, date),
        optional: routine.optional || undefined,
      };
      if (!updated.optional) delete updated.optional;
      if (JSON.stringify(updated) === JSON.stringify(block)) return block;
      dayChanged = true;
      return updated;
    });
    if (!dayChanged) continue;
    next[date] = snapshotDay(day, blocks, now);
    changed = true;
  }
  return changed ? next : days;
}

function dueOn(date: string, routine: Routine): boolean {
  return routine.enabled && !routine.bundledInto && onItsDays(routine, date);
}

function recordedChildren(block: Block): boolean {
  return !!block.bundledSteps?.some((step) => step.status !== 'planned');
}

function generatedId(date: string, routineId: string): string {
  return `${date}:routine:${routineId}`;
}

function startAfterRevision(day: Day, index: number, id: string): number | null | undefined {
  return (day.revisions[index + 1]?.blocks ?? day.blocks).find((block) => block.id === id)?.start;
}

function manuallyScheduled(day: Day, block: Block): boolean {
  return day.revisions.some((revision, index) => {
    if (revision.reason !== 'Edit block' && revision.reason !== 'Add block') return false;
    const before = revision.blocks.find((item) => item.id === block.id);
    const after = startAfterRevision(day, index, block.id);
    return after !== undefined && (before?.start ?? null) !== after;
  });
}

function lockedOrManual(day: Day, block: Block, date: string, routineId: string): boolean {
  return (
    block.id !== generatedId(date, routineId) ||
    block.fixed ||
    recordedChildren(block) ||
    manuallyScheduled(day, block)
  );
}

function keepUserEdits(
  block: Block,
  previous: Routine | undefined,
  routine: Routine,
  date: string,
) {
  // Compared with what the previous routine would have given this date (its variant, if any).
  const before = previous && occurrenceText(previous, date);
  const next = occurrenceText(routine, date);
  return {
    title: before && block.title !== before.title ? block.title : next.title,
    steps:
      before && JSON.stringify(block.steps) !== JSON.stringify(before.steps)
        ? [...block.steps]
        : next.steps,
  };
}

function snapshotDay(day: Day, blocks: Block[], now: string): Day {
  return {
    ...day,
    blocks,
    revisions: [
      ...day.revisions,
      { at: now, reason: 'Update routine occurrences', blocks: day.blocks.map(copyBlock) },
    ],
  };
}

export function reconcileRoutineDays(
  days: State['days'],
  programs: Program[],
  routine: Routine,
  previous: Routine | undefined,
  now: string,
  /** Occurrences that must stay, such as workouts with logged sets. */
  keep: ReadonlySet<string> = new Set(),
): State['days'] {
  let changed = false;
  const next = { ...days };
  const today = localDate(new Date(now));
  /** Original dates of moved occurrences released above. */
  const released: string[] = [];
  for (const [date, day] of Object.entries(days)) {
    // Catalog edits reconcile today and later only; a past day stays as it was recorded.
    if (date < today) continue;
    const due = dueOn(date, routine);
    const id = generatedId(date, routine.id);
    let blocks = day.blocks.map(copyBlock);
    let dayChanged = false;
    const kept: Block[] = [];
    for (const block of blocks) {
      if (block.routineId === routine.id && block.movedFrom !== undefined) {
        // A moved-in occurrence was placed deliberately by a sequence shift and otherwise stays,
        // but pausing its routine releases it while nothing on it is recorded.
        if (
          block.status === 'planned' &&
          !keep.has(block.id) &&
          (!routine.enabled || routine.bundledInto)
        ) {
          released.push(block.movedFrom);
          dayChanged = true;
          continue;
        }
        kept.push(block);
        continue;
      }
      if (block.routineId !== routine.id) {
        kept.push(block);
        continue;
      }
      if (block.status !== 'planned') {
        kept.push(block);
        continue;
      }
      if (lockedOrManual(day, block, date, routine.id) || keep.has(block.id)) {
        if (
          (!due || (routine.checklist && block.start !== null)) &&
          block.reason !== LOCKED_OCCURRENCE_REASON
        ) {
          kept.push({ ...block, reason: LOCKED_OCCURRENCE_REASON });
          dayChanged = true;
          continue;
        }
        kept.push(block);
        continue;
      }
      if (!due) {
        dayChanged = true;
        continue;
      }
      const edits = keepUserEdits(block, previous, routine, date);
      const updated: Block = {
        ...block,
        ...edits,
        duration: routine.duration,
        programId:
          programs.find((item) => item.routines.some((entry) => entry.id === routine.id))?.id ??
          block.programId,
        private: routine.private || undefined,
        // Today and later follow the routine; recorded and past occurrences keep their flag.
        optional: routine.optional || undefined,
      };
      if (routine.checklist) {
        updated.checklist = true;
        updated.start = null;
        updated.reason = null;
      } else {
        // A checklist item never held a calendar slot, so a stored start is not a placement.
        if (block.checklist) updated.start = null;
        delete updated.checklist;
        if (updated.start === null) updated.reason = TIMED_PLACE_REASON;
      }
      if (JSON.stringify(updated) !== JSON.stringify(block)) dayChanged = true;
      kept.push(updated);
    }
    if (
      due &&
      routine.checklist &&
      !day.moved?.some((move) => move.routineId === routine.id) &&
      !kept.some((block) => block.routineId === routine.id)
    ) {
      const text = occurrenceText(routine, date);
      const block = makeBlock(id, text.title, null, routine.duration, routine.fixed);
      block.routineId = routine.id;
      block.programId =
        programs.find((item) => item.routines.some((entry) => entry.id === routine.id))?.id ?? null;
      block.steps = text.steps;
      block.checklist = true;
      if (routine.private) block.private = true;
      if (routine.optional) block.optional = true;
      kept.push(block);
      dayChanged = true;
    }
    if (dayChanged) attachBundles(date, kept, programs);
    // Until the date arrives, its recorded timed obligations follow the edited catalog.
    const recorded = recordDueTimed(dayChanged ? snapshotDay(day, kept, now) : day, programs);
    if (recorded === day) continue;
    next[date] = recorded;
    changed = true;
  }
  // A released occurrence's original day forgets the move (past days stay as recorded).
  for (const origin of released) {
    const day = next[origin];
    if (origin < today || !day?.moved) continue;
    const moved = day.moved.filter((move) => move.routineId !== routine.id);
    const updated: Day = { ...day, moved };
    if (!moved.length) delete updated.moved;
    next[origin] = recordDueTimed(updated, programs);
    changed = true;
  }
  return changed ? next : days;
}

/** A routine's days in week order, Monday first as on Week: "Every day", "Weekdays" or "Mo, Th". */
export function weekdaysText(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  return days.map((day) => WEEKDAYS[day]).join(', ');
}

/**
 * One line on when a routine is due; `inRotation` when its program's rotation schedules it, and
 * `typed` when a kind label (Weigh-in, Study…) already says what it records, so "Checklist" is left
 * out.
 */
export function routineSummary(routine: Routine, inRotation = false, typed = false): string {
  if (inRotation && !routine.weekdays?.length) return 'In the rotation · one per training day';
  const days =
    routine.weekdays === null
      ? 'weekdays needed'
      : (weekdaysText(routine.weekdays) || 'no days selected') +
        (repeatText(routine) ? `, ${repeatText(routine)!.toLowerCase()}` : '');
  if (routine.bundledInto) return `Shares parent session time · ${days}`;
  if (routine.follows?.length && !routine.weekdays?.length)
    return 'Companion · follows its workouts';
  if (routine.checklist) return typed ? days : `Checklist · ${days}`;
  return `${routine.duration === null ? 'Duration needed' : `${routine.duration} min`} · ${days}`;
}
