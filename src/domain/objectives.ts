import {
  Block,
  Day,
  DayProtection,
  Program,
  ProtectionReason,
  Routine,
  State,
  shiftDate,
} from './model';

// Day Cleared and the Day Clear streak: the one rule that Today, Week, Progress, the streak and the
// widgets all read. `dayProgress` counts a stored day's required objectives: an optional one never
// counts, a skipped one is excused, and a timed routine recorded as due but missing from the day
// still counts. `dayOutcome` turns that into absent, empty, protected, cleared or open.
// `dayClearRuns` walks only the stored days: a cleared day extends the run, an open day that can no
// longer be finished breaks it, and every other outcome leaves it as it is.
// Tests: __tests__/objectives.test.ts, and __tests__/scale.test.ts, which checks the streak against
// a walk of every calendar day over two years.

export const PROTECTION_REASONS: ProtectionReason[] = [
  'illness',
  'travel',
  'recovery',
  'technical',
  'other',
];

export type ObjectiveLeaf = {
  id: string;
  title: string;
  status: 'planned' | 'done' | 'skipped';
  private: boolean;
  routineId: string | null;
  /** Shown and recordable, but never part of Day Cleared. */
  optional: boolean;
};

export type DayProgress = {
  done: number;
  /** Required objectives the day counts: everything due except what was skipped. */
  total: number;
  /** Required objectives skipped: excused for the day, never done, and not in `total`. */
  skipped: number;
  remaining: number;
  missingTimed: number;
  missingTimedTitles: string[];
  cleared: boolean;
  protected: boolean;
};

export type DayOutcome = 'absent' | 'empty' | 'protected' | 'cleared' | 'open';

export type StreakDay = {
  date: string;
  outcome: DayOutcome;
  protection?: DayProtection;
  /** An open day that can still be finished: it holds the streak instead of breaking it. */
  held?: 'today' | 'upcoming';
};

/**
 * IDs of the routines marked private, built once per call instead of searched per block. Their
 * objectives never reach a widget and are left out of every public count.
 */
export function privateRoutineIds(programs: Program[]): Set<string> {
  const ids = new Set<string>();
  for (const program of programs)
    for (const routine of program.routines) if (routine.private) ids.add(routine.id);
  return ids;
}

/**
 * A block with bundled steps is a container: Day Cleared counts its steps, never its own
 * check.
 */
export function isContainer(block: Block): boolean {
  return !!block.bundledSteps?.length;
}

/**
 * A block's objectives as Day Cleared counts them: its bundled steps when it is a container,
 * otherwise the block itself.
 */
function blockLeaves(
  block: Block,
  routinePrivate: (routineId: string | null) => boolean,
): ObjectiveLeaf[] {
  if (block.bundledSteps && isContainer(block))
    return block.bundledSteps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      private: routinePrivate(step.routineId),
      routineId: step.routineId,
      // An optional parent makes its bundled steps optional too; the flags are stored.
      optional: !!step.optional || !!block.optional,
    }));
  return [
    {
      id: block.id,
      title: block.title,
      status: block.status,
      private: !!block.private || routinePrivate(block.routineId),
      routineId: block.routineId,
      optional: !!block.optional,
    },
  ];
}

export function objectiveLeaves(day: Day, programs: Program[] = []): ObjectiveLeaf[] {
  const privateIds = privateRoutineIds(programs);
  const routinePrivate = (routineId: string | null) => !!routineId && privateIds.has(routineId);
  return day.blocks.flatMap((block) => blockLeaves(block, routinePrivate));
}

/**
 * The first of a block's objectives that still holds back Day Cleared: planned and required, among
 * the same leaves `dayProgress` counts. None once everything the block counts is recorded, even
 * while a container's own check is still open.
 */
export function openObjective(block: Block): ObjectiveLeaf | undefined {
  return blockLeaves(block, () => false).find(
    (leaf) => leaf.status === 'planned' && !leaf.optional,
  );
}

const UNKNOWN_TIMED_TITLE = 'A timed session';

function findRoutine(programs: Program[], routineId: string): Routine | undefined {
  for (const program of programs) {
    const routine = program.routines.find((item) => item.id === routineId);
    if (routine) return routine;
  }
  return undefined;
}

/** Timed sessions the day recorded as due that have no occurrence on its board. */
export function missingTimedIds(day: Day | undefined): string[] {
  if (!day?.dueTimed?.length) return [];
  const present = new Set(
    day.blocks.map((block) => block.routineId).filter((id): id is string => id !== null),
  );
  // A session moved to another day by a sequence shift is not missing from this one.
  const moved = new Set(day.moved?.map((move) => move.routineId) ?? []);
  return day.dueTimed.filter((id) => !present.has(id) && !moved.has(id));
}

// The only Day Cleared rule: it reads the stored day, never the current catalog projected onto it.
export function dayProgress(
  day: Day | undefined,
  programs: Program[],
  date: string,
  options: { publicOnly?: boolean } = {},
): DayProgress {
  // Optional objectives (an encouraged weigh-in) are never part of Day Cleared: not in the total,
  // not as completions. The flag lives on the stored occurrence, so earlier days keep their meaning.
  // A skipped objective is excused for the day: it leaves the total and never counts as done,
  // so the day clears once every other required objective is done. A day with nothing required
  // done is never cleared, however much was skipped.
  const leaves = objectiveLeaves(day ?? { date, blocks: [], revisions: [] }, programs).filter(
    (leaf) => !leaf.optional && (!options.publicOnly || !leaf.private),
  );
  // A deleted routine has no known privacy setting, so public counts leave it out.
  const missing = missingTimedIds(day)
    .map((id) => findRoutine(programs, id))
    .filter((routine) => !options.publicOnly || (routine && !routine.private))
    .map((routine) => ({ title: routine?.title ?? UNKNOWN_TIMED_TITLE }));
  const done = leaves.filter((leaf) => leaf.status === 'done').length;
  const skipped = leaves.filter((leaf) => leaf.status === 'skipped').length;
  const planned = leaves.filter((leaf) => leaf.status === 'planned').length;
  const total = done + planned + missing.length;
  return {
    done,
    total,
    skipped,
    remaining: planned + missing.length,
    missingTimed: missing.length,
    missingTimedTitles: missing.map((routine) => routine.title),
    cleared: total > 0 && done === total && missing.length === 0,
    protected: !!day?.protection,
  };
}

export function protectDay(
  day: Day,
  reason: ProtectionReason,
  now = new Date().toISOString(),
): Day {
  if (!PROTECTION_REASONS.includes(reason)) throw new Error('Choose a valid protection reason.');
  return { ...day, protection: { reason, at: now } };
}

export function clearDayProtection(day: Day): Day {
  const next = { ...day };
  delete next.protection;
  return next;
}

export function dayOutcome(state: State, date: string): DayOutcome {
  const day = state.days[date];
  if (!day) return 'absent';
  const progress = dayProgress(day, state.programs, date);
  if (progress.cleared) return 'cleared';
  if (day.protection) return 'protected';
  // A day whose every required objective was skipped is not cleared: it had something due.
  if (progress.total === 0 && progress.skipped === 0) return 'empty';
  return 'open';
}

export function outcomeLabel(entry: StreakDay): string {
  if (entry.outcome === 'cleared') return 'Cleared';
  if (entry.outcome === 'protected')
    return entry.protection ? `Protected · ${protectionLabel(entry.protection)}` : 'Protected';
  if (entry.outcome === 'absent') return 'Not recorded';
  if (entry.outcome === 'empty') return 'Nothing due';
  if (entry.held === 'today') return 'In progress';
  if (entry.held === 'upcoming') return 'Upcoming';
  return 'Not cleared';
}

// Only the actual local day (or a later one) can still be finished; viewing a past day cannot.
function stillOpen(state: State, date: string, today: string): boolean {
  return date >= today && dayProgress(state.days[date], state.programs, date).remaining > 0;
}

export function streakHistory(
  state: State,
  through: string,
  today?: string,
  limit = 14,
): StreakDay[] {
  const dates = Object.keys(state.days).sort();
  if (!dates.length) return [];
  // Each day's entry depends on that day alone, so only the last `limit` days are walked.
  const first = dates[0] < through ? dates[0] : through;
  const window = shiftDate(through, -(Math.max(limit, 1) - 1));
  const start = first > window ? first : window;
  const entries: StreakDay[] = [];
  let date = start;
  while (date <= through) {
    const day = state.days[date];
    const outcome = dayOutcome(state, date);
    const held =
      today && outcome === 'open' && stillOpen(state, date, today)
        ? date === today
          ? 'today'
          : 'upcoming'
        : undefined;
    entries.push({ date, outcome, protection: day?.protection, ...(held && { held }) });
    date = shiftDate(date, 1);
  }
  return entries.slice(-limit);
}

export function streakCaption(current: number, best: number): string {
  if (current > 0) return current === 1 ? '1-day streak' : `${current}-day streak`;
  if (best > 0) return 'New run started';
  return 'No streak yet';
}

export type StreakRun = {
  date: string;
  outcome: DayOutcome;
  /** An open day that can still be finished (today or later): it holds the run. */
  held: boolean;
  current: number;
  best: number;
};

/**
 * The Day Clear streak as it stood after each recorded date through `through`, oldest first, with
 * each date's outcome: the one walk the streak makes, so a chart of the streak or of cleared days
 * reads them exactly as the streak does.
 */
export function dayClearRuns(state: State, through: string, today: string): StreakRun[] {
  // Only recorded days can change the run: a date with no day is Not recorded, which neither adds
  // nor breaks it. Walking the stored dates in order gives the same result as every calendar day.
  const dates = Object.keys(state.days).sort();
  const runs: StreakRun[] = [];
  let current = 0,
    best = 0;
  for (const date of dates) {
    if (date > through) break;
    const outcome = dayOutcome(state, date);
    const held = outcome === 'open' && stillOpen(state, date, today);
    if (outcome === 'cleared') {
      current += 1;
      if (current > best) best = current;
    } else if (outcome === 'open' && !held) current = 0;
    runs.push({ date, outcome, held, current, best });
  }
  return runs;
}

export function dayClearStreak(
  state: State,
  through: string,
  today: string,
): { current: number; best: number } {
  const last = dayClearRuns(state, through, today).at(-1);
  return { current: last?.current ?? 0, best: last?.best ?? 0 };
}

export function protectionLabel(protection: DayProtection): string {
  const labels: Record<ProtectionReason, string> = {
    illness: 'Illness',
    travel: 'Travel',
    recovery: 'Recovery',
    technical: 'Technical issue',
    other: 'Other',
  };
  return labels[protection.reason];
}
