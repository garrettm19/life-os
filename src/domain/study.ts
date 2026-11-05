import { withDay } from './data';
import {
  ActivitySession,
  Routine,
  State,
  StudyLink,
  StudyPlan,
  StudyRecord,
  dateObject,
  localDate,
} from './model';
import { setStatus } from './planner';
import { validateActivitySessions, validateStudyPlan } from './records';
import { routineOf } from './workouts';

// Guided study sessions. A study objective holds a plan of timed stages; the run in progress lives on
// this device only and becomes a record (an activity session with a `study` detail) only when the
// user confirms it. Unlike the circuit timer, a study stage keeps running while Life OS is in the
// background, because the work happens in other apps (a course site, a chat assistant). Each stage
// clock stops at its planned length and waits for the user, so time away can never grow a stage past
// its plan, and nothing is completed without an explicit confirmation. Everything here is pure.

/** The default daily study plan: 25 + 30 + 5 minutes, with no links until the user adds them. */
export const DSA_STUDY: StudyPlan = {
  stages: [
    {
      id: 'learn',
      title: 'Learn and implement',
      minutes: 25,
      links: [],
    },
    {
      id: 'recognize',
      title: 'Algorithm-recognition practice',
      minutes: 30,
      links: [],
    },
    { id: 'review', title: 'Review mistakes', minutes: 5, links: [] },
  ],
  at: null,
  reminders: { start: false, evening: null, stageEnd: false },
};

export function copyStudyPlan(plan: StudyPlan): StudyPlan {
  return {
    stages: plan.stages.map((s) => ({ ...s, links: s.links.map((l) => ({ ...l })) })),
    at: plan.at,
    reminders: { ...plan.reminders },
    ...(plan.trackFrom !== undefined && { trackFrom: plan.trackFrom }),
    ...(plan.cue !== undefined && { cue: plan.cue }),
    ...(plan.schedule !== undefined && {
      schedule: plan.schedule.map((e) => ({ ...e, weekdays: [...e.weekdays] })),
    }),
  };
}

/**
 * The study objective's resources: the routine's own links, then each stage's, each address once.
 * Only links the user configured (validated https addresses); nothing is invented.
 */
export function studyResources(routine: Routine): StudyLink[] {
  const all = [...(routine.links ?? []), ...(routine.study?.stages.flatMap((s) => s.links) ?? [])];
  return all.filter((link, i) => all.findIndex((l) => l.url === link.url) === i);
}

export function planMinutes(plan: StudyPlan): number {
  return plan.stages.reduce((sum, s) => sum + s.minutes, 0);
}

export function studyPlanFor(state: State, routineId: string | null): StudyPlan | undefined {
  return routineOf(state, routineId)?.study;
}

/**
 * Saves a routine's study plan (or removes it with `null`). Recorded sessions keep their own copy of
 * the stages, so editing the plan never changes history; a run in progress keeps the plan it started
 * with.
 */
export function saveStudyPlan(state: State, routineId: string, plan: StudyPlan | null): State {
  const routine = routineOf(state, routineId);
  if (!routine) throw new Error('This objective no longer exists.');
  if (plan) {
    if (routine.capture) throw new Error('This objective already records something else.');
    if (state.workoutTemplates.some((t) => t.routineId === routineId))
      throw new Error('This objective already has a workout plan.');
    if (state.intervalRoutines.some((c) => c.routineId === routineId))
      throw new Error('This objective already has a timed circuit.');
    validateStudyPlan(plan);
  }
  return {
    ...state,
    programs: state.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => {
        if (r.id !== routineId) return r;
        const next: Routine = { ...r };
        // The streak's starting date belongs to the objective, so editing the plan keeps it.
        const trackFrom = plan?.trackFrom ?? r.study?.trackFrom;
        const schedule = plan?.schedule ?? r.study?.schedule;
        if (plan)
          next.study = copyStudyPlan({
            ...plan,
            ...(trackFrom && { trackFrom }),
            ...(schedule && { schedule }),
          });
        else delete next.study;
        return next;
      }),
    })),
  };
}

// The run in progress.

export type StudyRunStage = {
  id: string;
  title: string;
  plannedSeconds: number;
  links: StudyLink[];
};

/** A study session in progress, saved on this device so an interruption never loses work. */
export type StudyRun = {
  routineId: string;
  date: string;
  blockId: string;
  startedAt: string;
  /** The plan as it was when the session started; a later edit never changes a running session. */
  stages: StudyRunStage[];
  /** The current stage; equal to the number of stages once every stage is behind. */
  index: number;
  /** Stage clock per stage in milliseconds, folded in at each pause or change of stage. */
  spentMs: number[];
  /** Wall clock (ms) when the current stage clock last started; null while paused. */
  anchor: number | null;
};

export type StudyPhase = 'running' | 'paused' | 'timeUp' | 'review';

export function startStudy(
  plan: StudyPlan,
  target: { routineId: string; date: string; blockId: string },
  now: number,
): StudyRun {
  return {
    ...target,
    startedAt: new Date(now).toISOString(),
    stages: plan.stages.map((s) => ({
      id: s.id,
      title: s.title,
      plannedSeconds: s.minutes * 60,
      links: s.links.map((l) => ({ ...l })),
    })),
    index: 0,
    spentMs: plan.stages.map(() => 0),
    anchor: now,
  };
}

const plannedMs = (run: StudyRun, i: number) => run.stages[i].plannedSeconds * 1000;

/** The current stage's clock: never more than its plan, and a clock moved back never counts. */
export function stageSpentMs(run: StudyRun, now: number): number {
  if (run.index >= run.stages.length) return 0;
  const running = run.anchor === null ? 0 : Math.max(0, now - run.anchor);
  return Math.min(plannedMs(run, run.index), run.spentMs[run.index] + running);
}

export function spentAt(run: StudyRun, now: number): number[] {
  return run.spentMs.map((ms, i) => (i === run.index ? stageSpentMs(run, now) : ms));
}

export function phaseAt(run: StudyRun, now: number): StudyPhase {
  if (run.index >= run.stages.length) return 'review';
  if (stageSpentMs(run, now) >= plannedMs(run, run.index)) return 'timeUp';
  return run.anchor === null ? 'paused' : 'running';
}

/** Folds the running clock into the current stage and stops it. */
function fold(run: StudyRun, now: number): StudyRun {
  if (run.index >= run.stages.length) return run;
  return { ...run, spentMs: spentAt(run, now), anchor: null };
}

export function pauseStudy(run: StudyRun, now: number): StudyRun {
  return run.anchor === null ? run : fold(run, now);
}

export function resumeStudy(run: StudyRun, now: number): StudyRun {
  const phase = phaseAt(run, now);
  return phase === 'paused' ? { ...run, anchor: now } : run;
}

/**
 * Moves past the current stage (when its time is up, or early by the user's choice) and starts the
 * next one. After the last stage the session waits for review and confirmation.
 */
export function advanceStudy(run: StudyRun, now: number): StudyRun {
  if (run.index >= run.stages.length) return run;
  const folded = fold(run, now);
  const index = run.index + 1;
  return { ...folded, index, anchor: index < run.stages.length ? now : null };
}

/** From review, reopens the last stage (for example after finishing it early by mistake). */
export function backToLastStage(run: StudyRun, now: number): StudyRun {
  if (run.index < run.stages.length || !run.stages.length) return run;
  const index = run.stages.length - 1;
  const full = run.spentMs[index] >= plannedMs(run, index);
  return { ...run, index, anchor: full ? null : now };
}

/** Wall-clock time (ms) the running stage reaches its plan; null unless running. */
export function stageEndsAt(run: StudyRun, now: number): number | null {
  if (phaseAt(run, now) !== 'running') return null;
  return now + (plannedMs(run, run.index) - stageSpentMs(run, now));
}

export function runTotals(run: StudyRun, now: number): { spent: number; planned: number } {
  return {
    spent: Math.floor(spentAt(run, now).reduce((sum, ms) => sum + ms, 0) / 1000),
    planned: run.stages.reduce((sum, s) => sum + s.plannedSeconds, 0),
  };
}

/** What the run actually did, as it would be recorded now. */
export function toRecord(run: StudyRun, now: number): StudyRecord {
  const spent = spentAt(run, now);
  return {
    startedAt: run.startedAt,
    stages: run.stages.map((s, i) => ({
      id: s.id,
      title: s.title,
      plannedSeconds: s.plannedSeconds,
      seconds: Math.min(s.plannedSeconds, Math.floor(spent[i] / 1000)),
      done: i < run.index,
    })),
  };
}

function recordSeconds(record: StudyRecord): { spent: number; planned: number } {
  return {
    spent: record.stages.reduce((sum, s) => sum + s.seconds, 0),
    planned: record.stages.reduce((sum, s) => sum + s.plannedSeconds, 0),
  };
}

/** A full session: every stage confirmed and run for its whole planned length. */
export function fullStudy(record: StudyRecord): boolean {
  return record.stages.every((s) => s.done && s.seconds >= s.plannedSeconds);
}

export function studySessionFor(state: State, blockId: string): ActivitySession | undefined {
  return state.activitySessions.find((a) => a.occurrenceId === blockId && a.study);
}

/** "52 of 60 min". Whole minutes, rounded down, so nothing is rounded up into a full session. */
export function minutesLine(record: StudyRecord): string {
  const { spent, planned } = recordSeconds(record);
  return `${Math.floor(spent / 60)} of ${Math.floor(planned / 60)} min`;
}

/**
 * Records a study session for its objective, explicitly confirmed by the user. A full session
 * completes the objective in the same change. A shorter one is kept as what was done and leaves the
 * objective open unless the user also chose to count it as done; it never reads as a full session.
 */
export function recordStudy(
  state: State,
  run: StudyRun,
  options: { countAsDone: boolean },
  newId: string,
  at: string,
): State {
  const day = state.days[run.date];
  const block = day?.blocks.find((b) => b.id === run.blockId);
  if (!day || !block) throw new Error('This objective is no longer on the plan.');
  if (block.routineId !== run.routineId)
    throw new Error('This session no longer belongs to this objective.');
  if (run.date > localDate(new Date(at)))
    throw new Error('A study session can be recorded for today or an earlier day.');
  if (state.activitySessions.some((a) => a.occurrenceId === block.id))
    throw new Error('A session is already recorded for this objective.');
  const record = toRecord(run, Date.parse(at));
  const minutes = Math.floor(recordSeconds(record).spent / 60);
  if (minutes < 1) throw new Error('Less than a minute was timed, so there is nothing to record.');
  const session: ActivitySession = {
    id: newId,
    date: run.date,
    at,
    routineId: run.routineId,
    occurrenceId: block.id,
    activity: routineOf(state, run.routineId)?.title ?? block.title,
    minutes,
    note: '',
    study: record,
  };
  const activitySessions = [...state.activitySessions, session];
  validateActivitySessions(activitySessions);
  const next: State = { ...state, activitySessions };
  if (block.status === 'done' || (!fullStudy(record) && !options.countAsDone)) return next;
  return withDay(next, setStatus(day, block.id, 'done', at));
}

/** Counts an already recorded session as done (after an Undo, or for a shorter session). */
export function markStudyDone(state: State, date: string, blockId: string, now: string): State {
  const day = state.days[date];
  if (!day?.blocks.some((b) => b.id === blockId))
    throw new Error('This objective is no longer on the plan.');
  if (!studySessionFor(state, blockId)) throw new Error('No study session is recorded here.');
  return withDay(state, setStatus(day, blockId, 'done', now));
}

/**
 * Removes a session recorded by mistake and returns its objective to planned in the same change. The
 * user chooses this explicitly; nothing removes a session on its own.
 */
export function discardStudySession(state: State, date: string, blockId: string): State {
  if (!studySessionFor(state, blockId)) throw new Error('No study session is recorded here.');
  const next = {
    ...state,
    activitySessions: state.activitySessions.filter(
      (a) => !(a.occurrenceId === blockId && a.study),
    ),
  };
  const day = state.days[date];
  return day?.blocks.some((b) => b.id === blockId && b.status === 'done')
    ? withDay(next, setStatus(day, blockId, 'planned'))
    : next;
}

/** Reads a saved run; anything malformed is ignored rather than trusted. */
export function decodeStudyRun(v: unknown): StudyRun | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const stages = r.stages as Record<string, unknown>[] | undefined;
  const spent = r.spentMs as unknown[] | undefined;
  try {
    if (typeof r.date !== 'string') return null;
    dateObject(r.date);
  } catch {
    return null;
  }
  if (
    typeof r.routineId !== 'string' ||
    typeof r.blockId !== 'string' ||
    typeof r.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(r.startedAt)) ||
    !Array.isArray(stages) ||
    !stages.length ||
    stages.length > 8 ||
    !Array.isArray(spent) ||
    spent.length !== stages.length ||
    typeof r.index !== 'number' ||
    !Number.isInteger(r.index) ||
    r.index < 0 ||
    r.index > stages.length ||
    (r.anchor !== null && (typeof r.anchor !== 'number' || !Number.isFinite(r.anchor)))
  )
    return null;
  const ids = new Set<string>();
  for (const s of stages) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      ids.has(s.id) ||
      typeof s.title !== 'string' ||
      !s.title.trim() ||
      s.title.length > 120 ||
      typeof s.plannedSeconds !== 'number' ||
      !Number.isInteger(s.plannedSeconds) ||
      s.plannedSeconds < 60 ||
      s.plannedSeconds > 240 * 60 ||
      !Array.isArray(s.links) ||
      s.links.length > 5 ||
      s.links.some(
        (l: unknown) =>
          !l ||
          typeof (l as StudyLink).label !== 'string' ||
          typeof (l as StudyLink).url !== 'string' ||
          !/^https:\/\/[^\s]+$/i.test((l as StudyLink).url),
      )
    )
      return null;
    ids.add(s.id);
  }
  const index = r.index;
  if (
    spent.some(
      (ms, i) =>
        typeof ms !== 'number' ||
        !Number.isFinite(ms) ||
        ms < 0 ||
        ms > (stages[i].plannedSeconds as number) * 1000 ||
        // A stage not reached yet has no time.
        (i > index && ms !== 0),
    )
  )
    return null;
  // A run waiting for review has no running clock.
  if (index === stages.length && r.anchor !== null) return null;
  return v as StudyRun;
}

/**
 * A run read back from the device. A clock anchor in the future (the device clock was moved back
 * while it ran) restarts from now instead of freezing the stage until that time.
 */
export function restoreStudyRun(run: StudyRun, now: number): StudyRun {
  return run.anchor !== null && run.anchor > now ? { ...run, anchor: now } : run;
}
