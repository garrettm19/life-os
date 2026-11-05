import { withDay } from './data';
import {
  Block,
  LoggedSet,
  PlannedExercise,
  Routine,
  SessionExercise,
  State,
  WorkoutSession,
  WorkoutTemplate,
} from './model';
import { setStatus } from './planner';
import { validateWorkoutSessions, validateWorkoutTemplates } from './records';

export function templateFor(state: State, routineId: string | null): WorkoutTemplate | undefined {
  return routineId ? state.workoutTemplates.find((t) => t.routineId === routineId) : undefined;
}

export function routineOf(state: State, routineId: string | null): Routine | undefined {
  return state.programs.flatMap((p) => p.routines).find((r) => r.id === routineId);
}

export function sessionFor(state: State, occurrenceId: string): WorkoutSession | undefined {
  return state.workoutSessions.find((s) => s.occurrenceId === occurrenceId);
}

/** Creates or replaces the plan for one routine. Recorded sessions keep their own snapshot. */
export function saveTemplate(state: State, template: WorkoutTemplate): State {
  if (!routineOf(state, template.routineId)) throw new Error('Choose an existing routine.');
  const clash = state.workoutTemplates.find(
    (t) => t.routineId === template.routineId && t.id !== template.id,
  );
  if (clash) throw new Error('This routine already has a workout plan.');
  const exists = state.workoutTemplates.some((t) => t.id === template.id);
  const workoutTemplates = exists
    ? state.workoutTemplates.map((t) => (t.id === template.id ? template : t))
    : [...state.workoutTemplates, template];
  validateWorkoutTemplates(workoutTemplates);
  return { ...state, workoutTemplates };
}

/** Turns a workout routine back into a plain objective. Logged sessions keep their own copy. */
export function removeTemplate(state: State, routineId: string): State {
  return {
    ...state,
    workoutTemplates: state.workoutTemplates.filter((t) => t.routineId !== routineId),
  };
}

/** "45 s", "5 min" or "2:30". */
function secondsText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "8 reps" or "8–10 reps". */
export function repsText(e: { repsMin: number; repsMax: number | null }): string {
  return e.repsMax && e.repsMax !== e.repsMin
    ? `${e.repsMin}–${e.repsMax} reps`
    : `${e.repsMin} reps`;
}

/** "3 × 8–10 · 135 lb". */
export function planText(e: PlannedExercise | SessionExercise): string {
  const plan = 'plan' in e ? e.plan : e;
  if (e.kind === 'time')
    return `${plan.sets} × ${plan.seconds ? secondsText(plan.seconds) : 'timed'}`;
  const reps = repsText(plan).replace(' reps', '');
  return `${plan.sets} × ${reps}${plan.load !== null ? ` · ${plan.load} ${e.unit}` : ''}`;
}

function snapshot(e: PlannedExercise): SessionExercise {
  const timed = e.kind === 'time';
  return {
    exerciseId: e.id,
    name: e.name,
    unit: e.unit,
    plan: {
      sets: e.sets,
      repsMin: e.repsMin,
      repsMax: e.repsMax,
      load: e.load,
      ...(timed && { seconds: e.seconds ?? null }),
    },
    sets: Array.from({ length: e.sets }, () =>
      timed
        ? { reps: null, load: null, done: false, seconds: null }
        : { reps: null, load: null, done: false },
    ),
    ...(timed && { kind: 'time' as const }),
  };
}

/**
 * Starts the session for a workout occurrence, or returns the state unchanged when one exists, so
 * reopening a workout resumes it. The plan is copied in: later template edits leave it alone.
 */
export function startSession(state: State, date: string, block: Block, now: string): State {
  if (sessionFor(state, block.id)) return state;
  const template = templateFor(state, block.routineId);
  if (!template) throw new Error('This workout has no plan yet. Add one in Programs.');
  const session: WorkoutSession = {
    id: `session:${block.id}`,
    templateId: template.id,
    routineId: template.routineId,
    occurrenceId: block.id,
    scheduledDate: block.movedFrom ?? date,
    date,
    startedAt: now,
    finishedAt: null,
    status: 'active',
    exercises: template.exercises.map(snapshot),
    note: '',
  };
  const workoutSessions = [...state.workoutSessions, session];
  validateWorkoutSessions(workoutSessions);
  return { ...state, workoutSessions };
}

/** Saves partial progress on an active session; a finished one changes only through Undo. */
export function saveSession(state: State, session: WorkoutSession): State {
  const current = state.workoutSessions.find((s) => s.id === session.id);
  if (!current) throw new Error('This workout session no longer exists.');
  if (current.status !== 'active' || session.status !== 'active')
    throw new Error('This workout is already finished. Undo it on Today to change it.');
  const workoutSessions = state.workoutSessions.map((s) => (s.id === session.id ? session : s));
  validateWorkoutSessions(workoutSessions);
  return { ...state, workoutSessions };
}

/** Sets that were actually performed. */
export function doneSets(session: WorkoutSession): number {
  return session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
}

/**
 * Finish Workout: the session becomes completed and the linked objective Done in one state
 * change, so one save commits both or neither. A session with no performed set is not a workout.
 */
export function finishSession(
  state: State,
  date: string,
  blockId: string,
  session: WorkoutSession,
  now: string,
): State {
  const day = state.days[date];
  const block = day?.blocks.find((b) => b.id === blockId);
  if (!day || !block || block.id !== session.occurrenceId)
    throw new Error('This workout is no longer on the plan.');
  if (doneSets(session) === 0) throw new Error('Log at least one set, or use Done without a log.');
  const finished: WorkoutSession = { ...session, status: 'completed', finishedAt: now, date };
  const workoutSessions = state.workoutSessions.map((s) => (s.id === session.id ? finished : s));
  if (!state.workoutSessions.some((s) => s.id === session.id))
    throw new Error('This workout session no longer exists.');
  validateWorkoutSessions(workoutSessions);
  const next = { ...state, workoutSessions };
  return block.status === 'done' ? next : withDay(next, setStatus(day, blockId, 'done', now));
}

/**
 * Undo on a workout objective: the objective returns to planned and a finished session reopens,
 * keeping every logged set, so finishing again never creates a second completion.
 */
export function undoWorkout(state: State, date: string, blockId: string): State {
  const day = state.days[date];
  if (!day) throw new Error('This workout is no longer on the plan.');
  const next = withDay(state, setStatus(day, blockId, 'planned'));
  return {
    ...next,
    workoutSessions: next.workoutSessions.map((s) =>
      s.occurrenceId === blockId && s.status === 'completed'
        ? { ...s, status: 'active', finishedAt: null }
        : s,
    ),
  };
}

/**
 * Completes the workout objective without a performance record. Allowed only while no set is
 * logged: once sets exist, Finish Workout keeps them with the objective, so recorded sets are
 * never left behind under a Done that claims no log.
 */
export function markDoneWithoutLog(
  state: State,
  date: string,
  blockId: string,
  now: string,
): State {
  const day = state.days[date];
  if (!day?.blocks.some((b) => b.id === blockId))
    throw new Error('This workout is no longer on the plan.');
  const session = sessionFor(state, blockId);
  const logged = session && session.status === 'active' ? doneSets(session) : 0;
  if (logged > 0)
    throw new Error(
      `You logged ${logged} set${logged === 1 ? '' : 's'}. Finish the workout to keep ${logged === 1 ? 'it' : 'them'} with this objective.`,
    );
  return withDay(state, setStatus(day, blockId, 'done', now));
}

/**
 * Sessions with logged sets that were never finished and are no longer in progress: their day has
 * passed, or their objective was recorded another way. Their sets are kept and never counted as a
 * completed workout.
 */
export function unfinishedSessions(state: State, today: string): WorkoutSession[] {
  return state.workoutSessions.filter((s) => {
    if (s.status !== 'active' || doneSets(s) === 0) return false;
    // Found by occurrence, wherever a shift has placed it.
    const day = Object.values(state.days).find((d) =>
      d.blocks.some((b) => b.id === s.occurrenceId),
    );
    const block = day?.blocks.find((b) => b.id === s.occurrenceId);
    return !day || day.date < today || !block || block.status !== 'planned';
  });
}

/**
 * Occurrences whose workout session has logged sets but is not finished. Generation, the Today
 * ensure and routine edits keep these blocks, so logged sets always stay reachable.
 */
export function loggedBlockIds(state: State): Set<string> {
  return new Set(
    state.workoutSessions
      .filter((s) => s.status === 'active' && doneSets(s) > 0)
      .map((s) => s.occurrenceId),
  );
}

/** The most recent completed performance of an exercise before this session. */
export function previousPerformance(
  state: State,
  exercise: { exerciseId: string; name: string; unit: SessionExercise['unit'] },
  before: WorkoutSession,
): { date: string; sets: LoggedSet[]; unit: SessionExercise['unit'] } | null {
  const name = exercise.name.trim().toLowerCase();
  const earlier = state.workoutSessions
    .filter(
      (s) =>
        s.status === 'completed' &&
        s.id !== before.id &&
        (s.date < before.date || (s.date === before.date && s.finishedAt! < before.startedAt)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.finishedAt!.localeCompare(a.finishedAt!));
  for (const s of earlier) {
    // The same exercise (by plan ID, or by name from another plan) counts only in the same unit, so
    // pounds are never compared with, or suggested as, kilograms.
    const match =
      s.exercises.find((e) => e.exerciseId === exercise.exerciseId && e.unit === exercise.unit) ??
      s.exercises.find((e) => e.name.trim().toLowerCase() === name && e.unit === exercise.unit);
    const sets = match?.sets.filter((set) => set.done) ?? [];
    if (match && sets.length) return { date: s.date, sets, unit: match.unit };
  }
  return null;
}

/**
 * What a set shows and logs when nothing is typed: the same set last session, else the set above
 * in this session (what was typed or logged there, or its own suggestion), else the plan. A load
 * typed on set 1 therefore carries down, so each later set is one tap.
 */
export function setSuggestion(
  exercise: SessionExercise,
  previous: LoggedSet[] | undefined,
  index: number,
): { reps: number; load: number | null; seconds: number | null } {
  const before = previous?.[index] ?? previous?.at(-1);
  const set = index > 0 ? exercise.sets[index - 1] : undefined;
  const hint = set && setSuggestion(exercise, previous, index - 1);
  const above = set &&
    hint && {
      reps: set.reps ?? hint.reps,
      load: set.load ?? hint.load,
      seconds: set.seconds ?? hint.seconds,
    };
  return {
    reps: before?.reps ?? above?.reps ?? exercise.plan.repsMin,
    load: before?.load ?? above?.load ?? exercise.plan.load,
    seconds: before?.seconds ?? above?.seconds ?? exercise.plan.seconds ?? null,
  };
}

/** "135 lb × 8, 8, 7" when the load is constant, else "135 × 8, 140 × 6 lb". */
export function setsText(sets: LoggedSet[], unit: string): string {
  if (!sets.length) return '';
  // Timed sets read as their durations.
  if (sets.every((s) => s.reps === null && s.seconds != null))
    return sets.map((s) => secondsText(s.seconds!)).join(', ');
  const loads = new Set(sets.map((s) => s.load));
  if (loads.size === 1) {
    const load = sets[0].load;
    const reps = sets.map((s) => s.reps ?? 0).join(', ');
    return load === null ? `${reps} reps` : `${load} ${unit} × ${reps}`;
  }
  return `${sets.map((s) => `${s.load ?? 0} × ${s.reps ?? 0}`).join(', ')} ${unit}`;
}

/** Sessions completed in a date range (inclusive), by date. */
export function completedSessions(state: State, from: string, to: string): WorkoutSession[] {
  return state.workoutSessions
    .filter((s) => s.status === 'completed' && s.date >= from && s.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type LibraryExercise = {
  id: string;
  name: string;
  unit: SessionExercise['unit'];
  kind?: 'time';
  /** Workouts whose plan uses this exercise. */
  workouts: string[];
};

/**
 * Every exercise in the user's plans, once per exercise ID. The same ID in two plans is one
 * exercise with one history (for example a movement done in two different workouts).
 */
export function exerciseLibrary(state: State): LibraryExercise[] {
  const found = new Map<string, LibraryExercise>();
  for (const t of state.workoutTemplates)
    for (const e of t.exercises) {
      const prior = found.get(e.id);
      found.set(e.id, {
        id: e.id,
        name: prior?.name ?? e.name,
        unit: e.unit,
        ...(e.kind && { kind: e.kind }),
        workouts: [...(prior?.workouts ?? []), t.title],
      });
    }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Replaces one exercise for this session only (a same-day substitution). The replacement uses its
 * own history; the original keeps its own. Allowed only before any set of it is logged. With
 * `alsoPlan`, the workout plan swaps the exercise too, for future sessions.
 */
export function substituteExercise(
  state: State,
  sessionId: string,
  index: number,
  replacement: { exerciseId: string; name: string; unit: SessionExercise['unit']; kind?: 'time' },
  alsoPlan: boolean,
  now: string,
): State {
  const session = state.workoutSessions.find((s) => s.id === sessionId);
  if (!session || session.status !== 'active')
    throw new Error('Only a workout in progress can swap an exercise.');
  const current = session.exercises[index];
  if (!current) throw new Error('This exercise is no longer in the workout.');
  if (current.sets.some((set) => set.done))
    throw new Error('Sets are already logged for this exercise. Undo them before swapping it.');
  const name = replacement.name.trim();
  if (!name) throw new Error('Name the exercise to do instead.');
  if (session.exercises.some((e, i) => i !== index && e.exerciseId === replacement.exerciseId))
    throw new Error('That exercise is already in this workout.');
  const timed = replacement.kind === 'time';
  const swapped: SessionExercise = {
    exerciseId: replacement.exerciseId,
    name,
    unit: replacement.unit,
    plan: {
      sets: current.plan.sets,
      repsMin: current.plan.repsMin,
      repsMax: current.plan.repsMax,
      // A target load belongs to the original exercise.
      load: null,
      ...(timed && { seconds: null }),
    },
    sets: current.sets.map(() =>
      timed
        ? { reps: null, load: null, done: false, seconds: null }
        : { reps: null, load: null, done: false },
    ),
    ...(timed && { kind: 'time' as const }),
  };
  // Swapping back to the planned exercise clears the substitution.
  const original = current.substitutedFor ?? { exerciseId: current.exerciseId, name: current.name };
  if (original.exerciseId !== replacement.exerciseId) swapped.substitutedFor = original;
  let next = saveSession(state, {
    ...session,
    exercises: session.exercises.map((e, i) => (i === index ? swapped : e)),
  });
  if (alsoPlan) {
    const template = next.workoutTemplates.find((t) => t.id === session.templateId);
    if (!template) throw new Error('This workout no longer has a plan.');
    if (
      template.exercises.some(
        (e) => e.id === replacement.exerciseId && e.id !== original.exerciseId,
      )
    )
      throw new Error('The plan already has that exercise.');
    next = saveTemplate(next, {
      ...template,
      updatedAt: now,
      exercises: template.exercises.map((e) => {
        if (e.id !== original.exerciseId) return e;
        // Same sets, rep target, rest and note; a new identity, and no target load of the old one.
        const planned: PlannedExercise = {
          id: replacement.exerciseId,
          name,
          sets: e.sets,
          repsMin: e.repsMin,
          repsMax: e.repsMax,
          load: null,
          unit: replacement.unit,
          restSeconds: e.restSeconds,
          note: e.note,
        };
        return timed ? { ...planned, kind: 'time', seconds: e.seconds ?? null } : planned;
      }),
    });
  }
  return next;
}
