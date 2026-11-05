import { copyBlock } from './bundles';
import { occurrenceText } from './alternation';
import { Block, Day, Program, Routine, State, dateObject, shiftDate } from './model';
import {
  commitments,
  makeBlock,
  movedRoutines,
  occupied,
  overlaps,
  recordDueTimed,
  revision,
} from './planner';
import { onItsDays } from './repeat';

// Workout sequence shifting. A workout routine is a routine with a workout plan; its sequence is
// the planned workouts of that program. A shift is explicit, previewed, bounded to one week, and
// either applies whole or not at all.

export const SHIFT_WINDOW_DAYS = 7;
const MOVE_REASON = 'Moved by a sequence shift. Replan or choose a time.';

export type Occurrence = {
  routineId: string;
  title: string;
  /** The date it sits on now. */
  date: string;
  /** The saved occurrence, or null when it is still only due by its weekly recurrence. */
  block: Block | null;
  status: Block['status'];
  /** Original scheduled date when an earlier shift moved it. */
  movedFrom: string | null;
};

export type ShiftMove = {
  occurrence: Occurrence;
  to: string;
  start: number | null;
  note: string | null;
};

export type ShiftPlan = {
  mode: 'forward' | 'restore';
  moves: ShiftMove[];
  /** Workouts of this program in the window that stay where they are. */
  unchanged: Occurrence[];
  /** Reasons the shift cannot be applied. Nothing is saved while any exist. */
  conflicts: string[];
  /** Fixed sessions whose time is taken on the new day: they need an explicit choice. */
  slotConflicts: string[];
};

function programOf(state: State, routineId: string): Program | undefined {
  return state.programs.find((p) => p.routines.some((r) => r.id === routineId));
}

export function isWorkout(state: State, routineId: string | null): boolean {
  return !!routineId && state.workoutTemplates.some((t) => t.routineId === routineId);
}

/**
 * A workout as the plan reads it (Week, the weekly review, the restart note): one with a workout
 * plan, or a rotation member, which may be a plain checklist workout with no plan. What an
 * objective records still goes by `isWorkout`, so a plain workout is ticked, not logged.
 */
export function isPlanWorkout(state: State, routineId: string | null): boolean {
  return (
    isWorkout(state, routineId) ||
    (!!routineId && state.programs.some((p) => p.rotation?.order.includes(routineId)))
  );
}

function workoutRoutines(state: State, program: Program): Routine[] {
  return program.routines.filter((r) => isPlanWorkout(state, r.id) && !r.bundledInto);
}

function recorded(block: Block): boolean {
  return block.status !== 'planned' || !!block.bundledSteps?.some((s) => s.status !== 'planned');
}

/**
 * Workout occurrences of one program between two dates (inclusive): saved ones as they are, and,
 * from today on, ones still only due by recurrence. A date before today with nothing saved has
 * nothing to show; it is never filled in.
 */
export function workoutOccurrences(
  state: State,
  programId: string,
  from: string,
  to: string,
  today: string,
): Occurrence[] {
  const program = state.programs.find((p) => p.id === programId);
  if (!program) return [];
  const routines = workoutRoutines(state, program);
  const result: Occurrence[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const day = state.days[date];
    const moved = movedRoutines(day);
    for (const routine of routines) {
      const blocks = day?.blocks.filter((b) => b.routineId === routine.id) ?? [];
      for (const block of blocks)
        result.push({
          routineId: routine.id,
          title: block.title,
          date,
          block,
          status: block.status,
          movedFrom: block.movedFrom ?? null,
        });
      if (
        !blocks.length &&
        date >= today &&
        routine.enabled &&
        onItsDays(routine, date) &&
        !moved.has(routine.id)
      )
        result.push({
          routineId: routine.id,
          title: routine.title,
          date,
          block: null,
          status: 'planned',
          movedFrom: null,
        });
    }
  }
  return result;
}

/**
 * The start a moved session wants on its new day: its saved time, or the routine's for that day. A
 * checklist workout holds no time, so it never brings a stored start along.
 */
function wantedStart(state: State, o: Occurrence, to: string): number | null {
  if (o.block) return o.block.checklist ? null : o.block.start;
  const routine = programOf(state, o.routineId)?.routines.find((r) => r.id === o.routineId);
  if (!routine || routine.checklist) return null;
  return dateObject(to).getDay() === 4 && routine.thursdayStart != null
    ? routine.thursdayStart
    : routine.preferredStart;
}

function durationOf(state: State, o: Occurrence): number | null {
  if (o.block) return o.block.duration;
  const program = programOf(state, o.routineId)!;
  const routine = program.routines.find((r) => r.id === o.routineId)!;
  if (routine.duration === null) return null;
  return program.id === 'gym'
    ? routine.duration + (state.settings.gymTravel ?? 0)
    : routine.duration;
}

function fixedOf(state: State, o: Occurrence): boolean {
  if (o.block) return o.block.fixed;
  return !!programOf(state, o.routineId)?.routines.find((r) => r.id === o.routineId)?.fixed;
}

/**
 * What already holds time on a day: its saved blocks and, until the day has been generated, the
 * commitments and fixed routines generation will place there (a day opened on Today holds only its
 * checklist). Blocks leaving that day in this shift are not obstacles.
 */
function obstacles(state: State, date: string, leaving: Set<string>): Block[] {
  const day = state.days[date];
  const saved = day?.blocks.filter((b) => occupied(b) && !leaving.has(b.id)) ?? [];
  if (day?.commitmentsKey !== undefined) return saved;
  const present = new Set(day?.blocks.map((b) => b.id) ?? []);
  return [...saved, ...expected(state, date, leaving).filter((b) => !present.has(b.id))];
}

function expected(state: State, date: string, leaving: Set<string>): Block[] {
  const fixed = state.programs.flatMap((p) =>
    p.routines
      .filter(
        (r) =>
          r.enabled &&
          r.fixed &&
          !r.checklist &&
          !r.bundledInto &&
          onItsDays(r, date) &&
          r.preferredStart !== null &&
          r.duration !== null &&
          !leaving.has(`${date}:routine:${r.id}`),
      )
      .map((r) =>
        makeBlock(`${date}:routine:${r.id}`, r.title, r.preferredStart, r.duration, true),
      ),
  );
  return [...commitments(date, state.settings), ...fixed].filter(occupied);
}

/**
 * Previews a shift. `forward` moves the selected workout and every later planned workout of its
 * program in the next seven days by one day. `restore` returns moved workouts in that window to
 * their original days. Nothing is changed here.
 */
export function planShift(
  state: State,
  anchor: { date: string; routineId: string },
  mode: 'forward' | 'restore',
  today: string,
): ShiftPlan {
  const program = programOf(state, anchor.routineId);
  const plan: ShiftPlan = { mode, moves: [], unchanged: [], conflicts: [], slotConflicts: [] };
  if (!program || !isWorkout(state, anchor.routineId)) {
    plan.conflicts.push('Only workouts with a plan can shift their sequence.');
    return plan;
  }
  if (anchor.date < today) {
    plan.conflicts.push('Only today and later workouts can move.');
    return plan;
  }
  if (program.rotation?.order.includes(anchor.routineId)) {
    plan.conflicts.push('A rotation workout moves by resting: use Rest today instead.');
    return plan;
  }
  const last = shiftDate(anchor.date, SHIFT_WINDOW_DAYS);
  const inWindow = workoutOccurrences(
    state,
    program.id,
    anchor.date,
    mode === 'forward' ? shiftDate(anchor.date, SHIFT_WINDOW_DAYS - 1) : last,
    today,
  );
  const selected = inWindow.find((o) => o.date === anchor.date && o.routineId === anchor.routineId);
  if (!selected) {
    plan.conflicts.push('This workout is no longer on the plan.');
    return plan;
  }
  if (selected.status !== 'planned' || (selected.block && recorded(selected.block)))
    plan.conflicts.push(`${selected.title} is already recorded, so it stays where it is.`);
  const movable = (o: Occurrence) =>
    o.status === 'planned' && o.date >= today && !(o.block && recorded(o.block));
  const moving =
    mode === 'forward'
      ? inWindow.filter((o) => (o === selected || o.date > anchor.date) && movable(o))
      : inWindow.filter((o) => o.movedFrom !== null && movable(o));
  plan.unchanged = inWindow.filter((o) => !moving.includes(o));
  const movingKeys = new Set(moving.map((o) => `${o.date}|${o.routineId}`));
  const leaving = new Set(moving.map((o) => o.block?.id ?? `${o.date}:routine:${o.routineId}`));
  for (const o of moving) {
    const to = mode === 'forward' ? shiftDate(o.date, 1) : o.movedFrom!;
    if (to < today) {
      plan.conflicts.push(`${o.title} would return to a past day, so it cannot move back.`);
      continue;
    }
    // A workout of this program that is not moving already sits on the new day. Looked up per
    // target: a restore can return to a day before the selected workout.
    const blocker = workoutOccurrences(state, program.id, to, to, today).find(
      (x) => !movingKeys.has(`${x.date}|${x.routineId}`),
    );
    if (blocker)
      plan.conflicts.push(
        `${o.title} would land on ${to} with ${blocker.title}, which ${blocker.status === 'planned' ? 'is not moving' : 'is already recorded'}.`,
      );
    let start = wantedStart(state, o, to);
    let note: string | null = null;
    const duration = durationOf(state, o);
    if (start !== null && duration !== null) {
      const candidate = {
        ...makeBlock('candidate', o.title, start, duration),
        status: 'planned' as const,
      };
      const outOfDay = start < state.settings.wake || start + duration > state.settings.bedtime;
      const taken = obstacles(state, to, leaving).find((b) => overlaps(b, candidate));
      if (outOfDay || taken) {
        const why = taken ? `overlaps ${taken.title}` : 'falls outside your day';
        if (fixedOf(state, o))
          plan.slotConflicts.push(`${o.title} on ${to} ${why} at its fixed time.`);
        else note = `Its usual time ${why}, so it moves without a time.`;
        start = null;
      }
    }
    plan.moves.push({ occurrence: o, to, start, note });
  }
  if (!plan.moves.length && !plan.conflicts.length)
    plan.conflicts.push('Nothing in this sequence can move.');
  return plan;
}

function projectedBlock(state: State, o: Occurrence): Block {
  const program = programOf(state, o.routineId)!;
  const routine = program.routines.find((r) => r.id === o.routineId)!;
  const text = occurrenceText(routine, o.date);
  const block = makeBlock(
    `${o.date}:routine:${routine.id}`,
    text.title,
    null,
    durationOf(state, o),
    routine.fixed,
  );
  block.routineId = routine.id;
  block.programId = program.id;
  block.windowStart = routine.windowStart ?? null;
  block.windowEnd = routine.windowEnd ?? null;
  block.steps = text.steps;
  if (routine.checklist) block.checklist = true;
  if (routine.private) block.private = true;
  if (routine.optional) block.optional = true;
  return block;
}

/**
 * Applies a previewed shift as one state change, so it saves whole or not at all. Refuses while
 * there are conflicts; fixed sessions whose time is taken move only with `withoutTime`.
 */
export function applyShift(
  state: State,
  plan: ShiftPlan,
  withoutTime: boolean,
  now: string,
  today: string,
): State {
  if (plan.conflicts.length) throw new Error(plan.conflicts[0]);
  if (plan.slotConflicts.length && !withoutTime) throw new Error(plan.slotConflicts[0]);
  const days: Record<string, Day> = { ...state.days };
  const touched = new Set<string>();
  const dayAt = (date: string): Day => days[date] ?? { date, blocks: [], revisions: [] };
  const edit = (date: string, change: (day: Day) => Day) => {
    const before = dayAt(date);
    const after = change(before);
    // Plan changes keep a revision of the earlier blocks, like every other plan operation.
    days[date] =
      state.days[date] && !touched.has(date)
        ? {
            ...after,
            revisions: revision(before, after.blocks, 'Move workout sequence', now).revisions,
          }
        : after;
    touched.add(date);
  };
  // Move the latest first going forward (earliest first going back), so a day never briefly holds
  // two occurrences of one routine.
  const ordered = [...plan.moves].sort((a, b) =>
    plan.mode === 'forward'
      ? b.occurrence.date.localeCompare(a.occurrence.date)
      : a.occurrence.date.localeCompare(b.occurrence.date),
  );
  for (const move of ordered) {
    const o = move.occurrence;
    const source = o.block ? copyBlock(o.block) : projectedBlock(state, o);
    const original = source.movedFrom ?? o.date;
    if (o.block)
      edit(o.date, (day) => ({ ...day, blocks: day.blocks.filter((b) => b.id !== source.id) }));
    const block: Block = { ...source, start: move.start };
    // Planned bundled steps belong to their own day's configuration; they are reattached there.
    delete block.bundledSteps;
    block.reason = move.start === null && !block.checklist ? MOVE_REASON : null;
    if (move.to === original) delete block.movedFrom;
    else block.movedFrom = original;
    edit(move.to, (day) => ({ ...day, blocks: [...day.blocks, block] }));
    // The original day records that its occurrence moved away, so it is never generated there
    // again. A day that has passed already says so and is left exactly as recorded.
    if (original < today) continue;
    edit(original, (day) => {
      const others = (day.moved ?? []).filter((m) => m.routineId !== o.routineId);
      const moved =
        move.to === original
          ? others
          : [...others, { routineId: o.routineId, to: move.to, at: now }];
      const next: Day = { ...day, moved };
      if (!moved.length) delete next.moved;
      return next;
    });
  }
  // Until a date arrives, its recorded timed obligations follow what is now planned there.
  for (const date of touched)
    if (date >= today) days[date] = recordDueTimed(days[date], state.programs);
  // A workout already started moves with its session, so Progress never calls it unfinished.
  const movedTo = new Map(
    plan.moves.filter((m) => m.occurrence.block).map((m) => [m.occurrence.block!.id, m.to]),
  );
  const workoutSessions = state.workoutSessions.map((s) =>
    s.status === 'active' && movedTo.has(s.occurrenceId)
      ? { ...s, date: movedTo.get(s.occurrenceId)! }
      : s,
  );
  return { ...state, days, workoutSessions };
}
