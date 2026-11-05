import { dateObject } from './model';
import { date, fail, id, int, list, rec, ref, stamp, str, unique } from './records';

// Validation for the records added in state version 4: the focus, the weekly course correction and
// skill checkpoints. Like every record list, each is checked before it is saved, restored or loaded.

export const DIRECTION_LIMITS = {
  focuses: 200,
  weeklyReviews: 2_000,
  skillCheckpoints: 2_000,
  title: 120,
  text: 300,
  outcome: 500,
  routines: 30,
  problems: 100,
};

const EVIDENCE = ['career', 'money', 'training', 'trading'];
const STATUS = ['active', 'completed', 'archived'];
const DIFFICULTY = ['easy', 'medium', 'hard', 'mixed'];

function bool(v: unknown, what: string) {
  if (typeof v !== 'boolean') fail(`an invalid ${what}`);
}

export function validateFocuses(v: unknown): void {
  list(v, DIRECTION_LIMITS.focuses, 'focus');
  const ids = new Set<string>();
  let active = 0;
  for (const f of v) {
    rec(f, 'focus');
    id(f.id, 'focus');
    unique(ids, f.id, 'focus ID');
    str(f.title, DIRECTION_LIMITS.title, 'focus title', true);
    ref(f.goalId, 'goal');
    str(f.outcome, DIRECTION_LIMITS.outcome, 'focus outcome');
    if (f.evidence !== null && !EVIDENCE.includes(f.evidence as string))
      fail('an invalid focus evidence');
    list(f.routineIds, DIRECTION_LIMITS.routines, 'focus routine');
    const routines = new Set<string>();
    for (const r of f.routineIds) {
      id(r, 'routine');
      unique(routines, r, 'routine in one focus');
    }
    ref(f.leadRoutineId, 'routine');
    if (f.leadRoutineId !== null && !routines.has(f.leadRoutineId as string))
      fail('a focus lead that is not one of its routines');
    for (const key of ['cue', 'baseline', 'target'])
      str(f[key], DIRECTION_LIMITS.text, `focus ${key}`);
    date(f.startDate, 'focus start');
    date(f.reviewDate, 'focus review');
    if ((f.reviewDate as string) < (f.startDate as string))
      fail('a focus reviewed before it starts');
    if (!STATUS.includes(f.status as string)) fail('an invalid focus status');
    if (f.status === 'active') {
      active++;
      if (f.endedAt !== null) fail('an active focus with an end');
    } else stamp(f.endedAt, 'focus end');
    stamp(f.createdAt, 'focus');
    stamp(f.updatedAt, 'focus');
  }
  if (active > 1) fail('more than one active focus');
}

export function validateWeeklyReviews(v: unknown): void {
  list(v, DIRECTION_LIMITS.weeklyReviews, 'weekly review');
  const ids = new Set<string>();
  const weeks = new Set<string>();
  for (const r of v) {
    rec(r, 'weekly review');
    id(r.id, 'weekly review');
    unique(ids, r.id, 'weekly review ID');
    date(r.weekStart, 'weekly review');
    if (dateObject(r.weekStart as string).getDay() !== 1) fail('a weekly review not on a Monday');
    unique(weeks, r.weekStart as string, 'review for one week');
    ref(r.focusId, 'focus');
    str(r.obstacle, DIRECTION_LIMITS.text, 'obstacle');
    str(r.adjustment, DIRECTION_LIMITS.text, 'adjustment');
    bool(r.noChange, 'weekly choice');
    if (r.noChange && (r.adjustment as string).trim()) fail('an adjustment marked as no change');
    stamp(r.at, 'weekly review');
    stamp(r.updatedAt, 'weekly review');
  }
}

export function validateSkillCheckpoints(v: unknown): void {
  list(v, DIRECTION_LIMITS.skillCheckpoints, 'skill checkpoint');
  const ids = new Set<string>();
  for (const c of v) {
    rec(c, 'skill checkpoint');
    id(c.id, 'skill checkpoint');
    unique(ids, c.id, 'skill checkpoint ID');
    date(c.date, 'skill checkpoint');
    stamp(c.at, 'skill checkpoint');
    str(c.method, DIRECTION_LIMITS.title, 'checkpoint method', true);
    if (!DIFFICULTY.includes(c.difficulty as string)) fail('an invalid checkpoint difficulty');
    int(c.attempted, 1, DIRECTION_LIMITS.problems, 'number of problems attempted');
    int(c.solved, 0, c.attempted as number, 'number of problems solved');
    int(c.minutes, 1, 1440, 'checkpoint time limit', true);
    bool(c.fresh, 'checkpoint problems');
    str(c.topics, DIRECTION_LIMITS.text, 'checkpoint topics');
    str(c.next, DIRECTION_LIMITS.text, 'next practice area');
  }
}
