import { withDay } from './data';
import { IntervalPlan, IntervalRoutine, IntervalSession, IntervalStep, State } from './model';
import { setStatus } from './planner';
import { validateIntervalRoutines, validateIntervalSessions } from './records';
import { routineOf } from './workouts';

// Timed circuits. The run is a deadline model: what is on screen is always derived from the clock
// (elapsed = saved elapsed + time since the anchor), never from counting ticks, so a late render, a
// pause or a short interruption cannot drift the countdown. Everything here is pure.

/**
 * The preloaded 14-minute ab circuit: 30 s to get ready, 70 s intervals (35 s per side for
 * one-sided moves, 45 s per side plank), 10 s rests, and no rest between the two sides.
 */
export const CORE_CIRCUIT: IntervalPlan = {
  prepSeconds: 30,
  steps: [
    { id: 'crunches', name: 'Crunches', seconds: 70, restAfter: 10 },
    { id: 'bicycle-kicks', name: 'Bicycle Kicks', seconds: 70, restAfter: 10 },
    { id: 'jack-knives-left', name: 'Jack Knives — Left', seconds: 35, restAfter: 0 },
    { id: 'jack-knives-right', name: 'Jack Knives — Right', seconds: 35, restAfter: 10 },
    { id: 'russian-twists', name: 'Russian Twists', seconds: 70, restAfter: 10 },
    { id: 'toe-taps', name: 'Toe Taps', seconds: 70, restAfter: 10 },
    { id: 'bicycle-crunches-left', name: 'Bicycle Crunches — Left', seconds: 35, restAfter: 0 },
    { id: 'bicycle-crunches-right', name: 'Bicycle Crunches — Right', seconds: 35, restAfter: 10 },
    { id: 'scissor-kicks', name: 'Scissor Kicks', seconds: 70, restAfter: 10 },
    { id: 'reverse-crunches', name: 'Reverse Crunches', seconds: 70, restAfter: 10 },
    { id: 'butterfly-kicks', name: 'Butterfly Kicks', seconds: 70, restAfter: 10 },
    { id: 'side-plank-left', name: 'Side Plank — Left', seconds: 45, restAfter: 0 },
    { id: 'side-plank-right', name: 'Side Plank — Right', seconds: 45, restAfter: 0 },
  ],
};

export type SegmentKind = 'prep' | 'work' | 'rest';
export type Segment = {
  kind: SegmentKind;
  label: string;
  startMs: number;
  endMs: number;
};

/** The circuit as a timeline. A rest after the last interval is never part of the run. */
export function segmentsOf(plan: IntervalPlan): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  const push = (kind: SegmentKind, label: string, seconds: number) => {
    if (seconds <= 0) return;
    segments.push({ kind, label, startMs: at, endMs: at + seconds * 1000 });
    at += seconds * 1000;
  };
  push('prep', 'Get ready', plan.prepSeconds);
  plan.steps.forEach((step, i) => {
    push('work', step.name, step.seconds);
    if (i < plan.steps.length - 1) push('rest', 'Rest', step.restAfter);
  });
  return segments;
}

export function totalSeconds(plan: IntervalPlan): number {
  const segments = segmentsOf(plan);
  return segments.length ? segments[segments.length - 1].endMs / 1000 : 0;
}

/** "14:00", "1:05". */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export type Position = {
  index: number;
  segment: Segment;
  next: Segment | null;
  remainingMs: number;
  segmentElapsedMs: number;
};

export function positionAt(plan: IntervalPlan, elapsedMs: number): Position {
  const segments = segmentsOf(plan);
  const total = segments[segments.length - 1].endMs;
  const t = Math.min(Math.max(0, elapsedMs), total);
  let index = segments.findIndex((x) => t < x.endMs);
  if (index === -1) index = segments.length - 1;
  const segment = segments[index];
  return {
    index,
    segment,
    next: segments[index + 1] ?? null,
    remainingMs: Math.max(0, segment.endMs - t),
    segmentElapsedMs: t - segment.startMs,
  };
}

export type TimerRun = {
  status: 'ready' | 'running' | 'paused' | 'finished';
  /** Elapsed time at the anchor (or frozen, when not running). */
  elapsedMs: number;
  /** Wall-clock milliseconds when `elapsedMs` was true, while running. */
  anchor: number | null;
  startedAt: string | null;
  /** Work intervals skipped before their end. */
  skipped: string[];
  /** When the run reached its end (ISO), so a late save still records the true finish time. */
  endedAt: string | null;
};

export function readyRun(): TimerRun {
  return {
    status: 'ready',
    elapsedMs: 0,
    anchor: null,
    startedAt: null,
    skipped: [],
    endedAt: null,
  };
}

/**
 * The longest gap between two clock readings that is still one continuous run. A longer gap means
 * the app was suspended or the device clock jumped: the run is paused where it was last seen
 * rather than fast-forwarded, so a circuit can never complete itself while nobody was timing it.
 */
const GAP_LIMIT_MS = 2500;

export function interrupted(lastWall: number, now: number): boolean {
  return now - lastWall > GAP_LIMIT_MS;
}

/** Pauses at a known elapsed time (the last one actually seen). */
export function pauseAt(run: TimerRun, elapsedMs: number): TimerRun {
  if (run.status !== 'running') return run;
  return { ...run, status: 'paused', elapsedMs: Math.max(0, elapsedMs), anchor: null };
}

export function elapsedAt(run: TimerRun, now: number): number {
  if (run.status !== 'running' || run.anchor === null) return run.elapsedMs;
  // A clock moved backwards never counts down past the saved point.
  return run.elapsedMs + Math.max(0, now - run.anchor);
}

export function startRun(run: TimerRun, now: number): TimerRun {
  if (run.status !== 'ready') return run;
  return {
    ...run,
    status: 'running',
    elapsedMs: 0,
    anchor: now,
    startedAt: new Date(now).toISOString(),
  };
}

export function pauseRun(run: TimerRun, now: number): TimerRun {
  if (run.status !== 'running') return run;
  return { ...run, status: 'paused', elapsedMs: elapsedAt(run, now), anchor: null };
}

export function resumeRun(run: TimerRun, now: number): TimerRun {
  if (run.status !== 'paused') return run;
  return { ...run, status: 'running', anchor: now };
}

/** Finishes a running timer that has reached its end. */
export function tick(run: TimerRun, plan: IntervalPlan, now: number): TimerRun {
  const total = totalSeconds(plan) * 1000;
  if (run.status !== 'running' || elapsedAt(run, now) < total) return run;
  // The moment the end was reached, not the (possibly later) moment this tick ran.
  const endedAt = new Date(run.anchor! + (total - run.elapsedMs)).toISOString();
  return { ...run, status: 'finished', elapsedMs: total, anchor: null, endedAt };
}

function seek(run: TimerRun, plan: IntervalPlan, now: number, to: number): TimerRun {
  const total = totalSeconds(plan) * 1000;
  if (to >= total)
    return {
      ...run,
      status: 'finished',
      elapsedMs: total,
      anchor: null,
      endedAt: new Date(now).toISOString(),
    };
  return { ...run, elapsedMs: to, anchor: run.status === 'running' ? now : null };
}

export function jumpNext(run: TimerRun, plan: IntervalPlan, now: number): TimerRun {
  if (run.status !== 'running' && run.status !== 'paused') return run;
  const at = positionAt(plan, elapsedAt(run, now));
  const skipped =
    at.segment.kind === 'work' && at.remainingMs > 0 && !run.skipped.includes(at.segment.label)
      ? [...run.skipped, at.segment.label]
      : run.skipped;
  return seek({ ...run, skipped }, plan, now, at.segment.endMs);
}

/** Whether Next would end the circuit (it is on the last interval), so it can ask first. */
export function nextFinishes(run: TimerRun, plan: IntervalPlan, now: number): boolean {
  return positionAt(plan, elapsedAt(run, now)).next === null;
}

/** True when every work interval was skipped: such a run is not a completed circuit. */
export function allSkipped(plan: IntervalPlan, skipped: string[]): boolean {
  return plan.steps.every((step) => skipped.includes(step.name));
}

/** Restarts the current interval, or goes back one when pressed within its first two seconds. */
export function jumpPrevious(run: TimerRun, plan: IntervalPlan, now: number): TimerRun {
  if (run.status !== 'running' && run.status !== 'paused') return run;
  const at = positionAt(plan, elapsedAt(run, now));
  if (at.segmentElapsedMs > 2000) return seek(run, plan, now, at.segment.startMs);
  if (at.index === 0) return run;
  return seek(run, plan, now, segmentsOf(plan)[at.index - 1].startMs);
}

/**
 * A run read back after the app was closed or suspended. It never claims the timer kept running:
 * a running run comes back paused at its last saved point.
 */
export function restoreRun(run: TimerRun, _now: number): TimerRun {
  if (run.status !== 'running') return run;
  return { ...run, status: 'paused', anchor: null };
}

export type Cue =
  | { kind: 'count'; second: number }
  | { kind: 'start'; label: string; segment: SegmentKind; next: string | null }
  | { kind: 'done' };

/**
 * Cues crossed between two elapsed times, in order: a 3-2-1 count before each interval ends, the
 * start of each interval, and the end. After a jump only the landing point is announced.
 */
export function cuesBetween(plan: IntervalPlan, from: number, to: number, jumped = false): Cue[] {
  const segments = segmentsOf(plan);
  const total = segments[segments.length - 1].endMs;
  const startCue = (i: number): Cue => ({
    kind: 'start',
    label: segments[i].label,
    segment: segments[i].kind,
    next: segments[i + 1]?.label ?? null,
  });
  if (jumped) {
    if (to >= total) return [{ kind: 'done' }];
    return [startCue(positionAt(plan, to).index)];
  }
  const crossed = (t: number) => from < t && t <= to;
  const cues: { at: number; order: number; cue: Cue }[] = [];
  segments.forEach((segment, i) => {
    if (crossed(segment.startMs)) cues.push({ at: segment.startMs, order: 1, cue: startCue(i) });
    for (const second of [3, 2, 1]) {
      const t = segment.endMs - second * 1000;
      if (t > segment.startMs && crossed(t))
        cues.push({ at: t, order: 0, cue: { kind: 'count', second } });
    }
  });
  if (crossed(total)) cues.push({ at: total, order: 2, cue: { kind: 'done' } });
  return cues.sort((a, b) => a.at - b.at || a.order - b.order).map((c) => c.cue);
}

// Editing. Each returns a new plan of the same shape; nothing is mutated.

export function updateStep<T extends IntervalPlan>(
  plan: T,
  stepId: string,
  patch: Partial<Omit<IntervalStep, 'id'>>,
): T {
  return { ...plan, steps: plan.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) };
}

export function addStep<T extends IntervalPlan>(plan: T, id: string): T {
  return {
    ...plan,
    steps: [...plan.steps, { id, name: 'New exercise', seconds: 30, restAfter: 10 }],
  };
}

export function removeStep<T extends IntervalPlan>(plan: T, stepId: string): T {
  return { ...plan, steps: plan.steps.filter((s) => s.id !== stepId) };
}

export function moveStep<T extends IntervalPlan>(plan: T, stepId: string, delta: -1 | 1): T {
  const from = plan.steps.findIndex((s) => s.id === stepId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= plan.steps.length) return plan;
  const steps = [...plan.steps];
  [steps[from], steps[to]] = [steps[to], steps[from]];
  return { ...plan, steps };
}

function copyPlan(plan: IntervalPlan): IntervalPlan {
  return { prepSeconds: plan.prepSeconds, steps: plan.steps.map((s) => ({ ...s })) };
}

export function newCircuit(
  routineId: string,
  title: string,
  plan: IntervalPlan,
  id: string,
  now: string,
): IntervalRoutine {
  return { id, routineId, title, ...copyPlan(plan), original: copyPlan(plan), updatedAt: now };
}

export function restoreOriginal(circuit: IntervalRoutine, now: string): IntervalRoutine {
  return { ...circuit, ...copyPlan(circuit.original), updatedAt: now };
}

export function circuitFor(state: State, routineId: string | null): IntervalRoutine | undefined {
  return routineId ? state.intervalRoutines.find((c) => c.routineId === routineId) : undefined;
}

export function circuitSessionFor(state: State, occurrenceId: string): IntervalSession | undefined {
  return state.intervalSessions.find((s) => s.occurrenceId === occurrenceId);
}

/** Creates or replaces the circuit of one routine. Recorded sessions are never changed. */
export function saveCircuit(state: State, circuit: IntervalRoutine): State {
  if (!routineOf(state, circuit.routineId)) throw new Error('Choose an existing routine.');
  if (state.workoutTemplates.some((t) => t.routineId === circuit.routineId))
    throw new Error('This routine already has a workout plan.');
  const clash = state.intervalRoutines.find(
    (c) => c.routineId === circuit.routineId && c.id !== circuit.id,
  );
  if (clash) throw new Error('This routine already has a timed circuit.');
  const exists = state.intervalRoutines.some((c) => c.id === circuit.id);
  const intervalRoutines = exists
    ? state.intervalRoutines.map((c) => (c.id === circuit.id ? circuit : c))
    : [...state.intervalRoutines, circuit];
  try {
    validateIntervalRoutines(intervalRoutines);
  } catch {
    throw new Error(
      'Each interval needs a name and 1–3600 seconds; rests can be 0–3600 seconds, and preparation up to 600.',
    );
  }
  return { ...state, intervalRoutines };
}

/** Turns a circuit routine back into a plain objective. Recorded sessions stay. */
export function removeCircuit(state: State, routineId: string): State {
  return {
    ...state,
    intervalRoutines: state.intervalRoutines.filter((c) => c.routineId !== routineId),
  };
}

/**
 * A circuit run to its end: one session, and the objective Done when every interval was run, in
 * one state change, so one save commits both or neither. A second session for the same objective
 * is refused; a run with every interval skipped is not a circuit at all.
 */
export function completeCircuit(
  state: State,
  run: {
    intervalId: string;
    date: string;
    blockId: string;
    startedAt: string;
    finishedAt: string;
    skipped: string[];
  },
): State {
  const day = state.days[run.date];
  const block = day?.blocks.find((b) => b.id === run.blockId);
  if (!day || !block) throw new Error('This objective is no longer on the plan.');
  const circuit = state.intervalRoutines.find((c) => c.id === run.intervalId);
  if (!circuit || circuit.routineId !== block.routineId)
    throw new Error('This circuit no longer belongs to this objective.');
  if (circuitSessionFor(state, block.id))
    throw new Error('This circuit is already recorded for this objective.');
  if (allSkipped(circuit, run.skipped))
    throw new Error('Every interval was skipped, so this circuit is not recorded.');
  const session: IntervalSession = {
    id: `interval:${block.id}`,
    intervalId: circuit.id,
    routineId: circuit.routineId,
    occurrenceId: block.id,
    date: run.date,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    plannedSeconds: totalSeconds(circuit),
    skipped: [...run.skipped],
  };
  const intervalSessions = [...state.intervalSessions, session];
  validateIntervalSessions(intervalSessions);
  const next = { ...state, intervalSessions };
  // Only a circuit run in full completes the objective by itself. With any interval skipped the
  // session is kept as what was actually done, and counting it as Done is the user's own choice.
  if (session.skipped.length || block.status === 'done') return next;
  return withDay(next, setStatus(day, block.id, 'done', run.finishedAt));
}

/**
 * Removes the circuit recorded for an objective (an explicit choice, for a mistaken completion)
 * and returns the objective to planned in the same change.
 */
export function discardCircuitSession(state: State, date: string, blockId: string): State {
  if (!circuitSessionFor(state, blockId))
    throw new Error('No circuit is recorded for this objective.');
  const next = {
    ...state,
    intervalSessions: state.intervalSessions.filter((s) => s.occurrenceId !== blockId),
  };
  const day = state.days[date];
  return day?.blocks.some((b) => b.id === blockId && b.status === 'done')
    ? withDay(next, setStatus(day, blockId, 'planned'))
    : next;
}

/** Marks the objective done from a session already recorded for it (after an Undo). */
export function markCircuitDone(state: State, date: string, blockId: string, now: string): State {
  const day = state.days[date];
  if (!day?.blocks.some((b) => b.id === blockId))
    throw new Error('This objective is no longer on the plan.');
  return withDay(state, setStatus(day, blockId, 'done', now));
}

/** The circuit in progress, saved on this device so an interruption can be recovered. */
export type ActiveCircuit = {
  intervalId: string;
  /** The circuit's `updatedAt` when the run started: a run is never applied to an edited plan. */
  planVersion: string;
  date: string;
  blockId: string;
  run: TimerRun;
};

/** Reads a saved in-progress circuit; anything malformed is ignored rather than trusted. */
export function decodeActiveCircuit(v: unknown): ActiveCircuit | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  const run = a.run as Record<string, unknown> | undefined;
  if (
    typeof a.intervalId !== 'string' ||
    typeof a.planVersion !== 'string' ||
    typeof a.date !== 'string' ||
    typeof a.blockId !== 'string' ||
    !run ||
    !['ready', 'running', 'paused', 'finished'].includes(String(run.status)) ||
    typeof run.elapsedMs !== 'number' ||
    !Number.isFinite(run.elapsedMs) ||
    run.elapsedMs < 0 ||
    (run.anchor !== null && typeof run.anchor !== 'number') ||
    (run.startedAt !== null && typeof run.startedAt !== 'string') ||
    (run.endedAt !== undefined && run.endedAt !== null && typeof run.endedAt !== 'string') ||
    !Array.isArray(run.skipped) ||
    run.skipped.some((x) => typeof x !== 'string')
  )
    return null;
  return {
    intervalId: a.intervalId,
    planVersion: a.planVersion,
    date: a.date,
    blockId: a.blockId,
    run: { ...(run as unknown as TimerRun), endedAt: (run.endedAt as string | null) ?? null },
  };
}

/** What to save for a run now: a running run is saved with its elapsed time brought up to date. */
/**
 * What Today's circuit row says of a run kept on this device, or null: paused where it was (a run
 * left running comes back paused), or finished and waiting to be saved. A run on another circuit
 * or an edited one is never resumed, so it says nothing.
 */
export function activeCircuitLine(
  active: ActiveCircuit | null | undefined,
  circuit: IntervalRoutine,
): string | null {
  if (!active || active.intervalId !== circuit.id || active.planVersion !== circuit.updatedAt)
    return null;
  const run = restoreRun(active.run, 0);
  if (run.status === 'finished') return 'Circuit finished · tap to save';
  if (run.status === 'paused')
    return `Paused at ${clockText(run.elapsedMs / 1000)} · tap to resume`;
  return null;
}

export function checkpoint(run: TimerRun, now: number): TimerRun {
  return run.status === 'running' ? { ...run, elapsedMs: elapsedAt(run, now), anchor: now } : run;
}
