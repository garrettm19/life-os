import { validateSkillCheckpoints } from './direction-records';
import {
  CheckpointDifficulty,
  SkillCheckpoint,
  State,
  dateObject,
  displayDate,
  localDate,
} from './model';

// Skill checkpoints: an assessment done outside the app (for example interview-style problems on a
// course site under a time limit), recorded as it happened. A result is not a skill score. Two
// checkpoints are compared only when the conditions match (difficulty and time limit) and both used
// new problems; repeated problems test memory, not transfer, so they never make a trend.

export type CheckpointInput = Omit<SkillCheckpoint, 'id' | 'at'> & { id?: string };

export const DIFFICULTIES: readonly (readonly [CheckpointDifficulty, string])[] = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
  ['mixed', 'Mixed'],
];

export function sortedCheckpoints(state: State): SkillCheckpoint[] {
  return [...state.skillCheckpoints].sort(
    (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at),
  );
}

/** Records or corrects a checkpoint; the first save time is kept on a correction. */
export function saveCheckpoint(
  state: State,
  input: CheckpointInput,
  newId: string,
  now: string,
): State {
  try {
    dateObject(input.date);
  } catch {
    throw new Error('Choose the date as YYYY-MM-DD.');
  }
  if (input.date > localDate(new Date(now)))
    throw new Error('A checkpoint can be recorded for today or an earlier day.');
  if (!input.method.trim())
    throw new Error('Say where and how, for example "Course site, new problems".');
  if (!Number.isInteger(input.attempted) || input.attempted < 1)
    throw new Error('Enter how many problems you attempted.');
  if (!Number.isInteger(input.solved) || input.solved < 0 || input.solved > input.attempted)
    throw new Error('Solved on your own can be from 0 to the number attempted.');
  if (
    input.minutes !== null &&
    (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440)
  )
    throw new Error('Enter a time limit from 1 to 1440 minutes, or leave it blank.');
  const existing = input.id ? state.skillCheckpoints.find((c) => c.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('This checkpoint no longer exists.');
  const checkpoint: SkillCheckpoint = {
    id: existing?.id ?? newId,
    date: input.date,
    at: existing?.at ?? now,
    method: input.method.trim(),
    difficulty: input.difficulty,
    attempted: input.attempted,
    solved: input.solved,
    minutes: input.minutes,
    fresh: input.fresh,
    topics: input.topics.trim(),
    next: input.next.trim(),
  };
  const skillCheckpoints = existing
    ? state.skillCheckpoints.map((c) => (c.id === existing.id ? checkpoint : c))
    : [...state.skillCheckpoints, checkpoint];
  validateSkillCheckpoints(skillCheckpoints);
  return { ...state, skillCheckpoints };
}

export function deleteCheckpoint(state: State, id: string): State {
  return { ...state, skillCheckpoints: state.skillCheckpoints.filter((c) => c.id !== id) };
}

export function conditions(c: SkillCheckpoint): string {
  const label = DIFFICULTIES.find(([d]) => d === c.difficulty)?.[1] ?? c.difficulty;
  return [
    label,
    c.minutes ? `${c.minutes} min` : 'untimed',
    c.fresh ? 'new problems' : 'repeated problems',
  ].join(' · ');
}

export function resultText(c: SkillCheckpoint): string {
  return `${c.solved} of ${c.attempted} solved on your own`;
}

const comparable = (a: SkillCheckpoint, b: SkillCheckpoint) =>
  a.fresh && b.fresh && a.difficulty === b.difficulty && a.minutes === b.minutes;

export type CheckpointComparison =
  | { kind: 'none' }
  /** The latest checkpoint has no earlier one under the same conditions (or used seen problems). */
  | { kind: 'single'; latest: SkillCheckpoint; reason: string }
  | { kind: 'pair'; baseline: SkillCheckpoint; latest: SkillCheckpoint };

/** The latest checkpoint against the earliest one taken under the same conditions. */
export function compareCheckpoints(state: State): CheckpointComparison {
  const all = sortedCheckpoints(state);
  const latest = all.at(-1);
  if (!latest) return { kind: 'none' };
  if (!latest.fresh)
    return {
      kind: 'single',
      latest,
      reason: 'Repeated problems test memory, so this result is not compared.',
    };
  const baseline = all.find((c) => c !== latest && comparable(c, latest));
  if (!baseline)
    return {
      kind: 'single',
      latest,
      reason: 'No earlier checkpoint under the same conditions yet, so there is no trend to show.',
    };
  return { kind: 'pair', baseline, latest };
}

/** One line for the comparison, in plain words; no grade, no percentage of "readiness". */
export function comparisonLine(comparison: CheckpointComparison): string {
  if (comparison.kind === 'none') return 'No skill checkpoint recorded yet.';
  const { latest } = comparison;
  const now = `${resultText(latest)} (${displayDate(latest.date)})`;
  if (comparison.kind === 'single') return `${now}. ${comparison.reason}`;
  const { baseline } = comparison;
  return `${baseline.solved} of ${baseline.attempted} on ${displayDate(baseline.date)} → ${latest.solved} of ${latest.attempted} on ${displayDate(latest.date)}, same conditions (${conditions(latest)}).`;
}
