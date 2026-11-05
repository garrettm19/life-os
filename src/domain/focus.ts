import { validateFocuses } from './direction-records';
import {
  Block,
  Focus,
  FocusEvidence,
  Routine,
  State,
  dateObject,
  daysBetween,
  localDate,
  shiftDate,
} from './model';
import { isPlanWorkout } from './sequence';
import { routineOf } from './workouts';
import { studyPlanFor } from './study';
import { candleReview, sessionResult, tradingBook } from './trading';

// The 90-day focus: the one priority the user chose. It links to existing goals and routines and
// creates nothing; Today offers the next linked objective that is due, Progress reads its evidence.
// There is at most one active focus. Passing the review date changes nothing on its own: only the
// user completes, archives or replaces a focus, and finished ones stay readable.

const FOCUS_DAYS = 90;

export type FocusInput = {
  title: string;
  goalId: string | null;
  outcome: string;
  evidence: FocusEvidence | null;
  routineIds: string[];
  leadRoutineId: string | null;
  cue: string;
  baseline: string;
  target: string;
  reviewDate: string;
};

export function activeFocus(state: State): Focus | undefined {
  return state.focuses.find((f) => f.status === 'active');
}

/** Finished focus periods, most recent first. */
export function pastFocuses(state: State): Focus[] {
  return state.focuses
    .filter((f) => f.status !== 'active')
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
}

export function defaultReviewDate(start: string): string {
  return shiftDate(start, FOCUS_DAYS);
}

/** The input cleaned and checked, with messages in the user's terms. */
function checked(state: State, input: FocusInput, start: string): FocusInput {
  const title = input.title.trim();
  if (!title) throw new Error('Name the priority.');
  try {
    dateObject(input.reviewDate);
  } catch {
    throw new Error('Choose a review date as YYYY-MM-DD.');
  }
  if (input.reviewDate < start) throw new Error('Choose a review date on or after the start.');
  const known = new Set(state.programs.flatMap((p) => p.routines.map((r) => r.id)));
  const routineIds = [...new Set(input.routineIds)].filter((id) => known.has(id));
  const leadRoutineId =
    input.leadRoutineId && routineIds.includes(input.leadRoutineId) ? input.leadRoutineId : null;
  const goalId =
    input.goalId && state.goals.some((g) => g.id === input.goalId) ? input.goalId : null;
  // Only the editable fields: a form seeded from a stored focus can never write back its start,
  // status or history.
  return {
    title,
    goalId,
    outcome: input.outcome.trim(),
    evidence: input.evidence,
    routineIds,
    leadRoutineId,
    cue: input.cue.trim(),
    baseline: input.baseline.trim(),
    target: input.target.trim(),
    reviewDate: input.reviewDate,
  };
}

function withFocuses(state: State, focuses: Focus[]): State {
  validateFocuses(focuses);
  return { ...state, focuses };
}

/**
 * Starts a focus today. With one already active it is refused, unless `replace` archives that one
 * first (kept with its reviews).
 */
export function startFocus(
  state: State,
  input: FocusInput,
  newId: string,
  now: string,
  options: { replace: boolean } = { replace: false },
): State {
  const start = localDate(new Date(now));
  const current = activeFocus(state);
  if (current && !options.replace)
    throw new Error('Complete or archive the current focus first, or replace it.');
  const clean = checked(state, input, start);
  const focus: Focus = {
    id: newId,
    ...clean,
    startDate: start,
    status: 'active',
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const others = state.focuses.map((f) =>
    f.id === current?.id ? { ...f, status: 'archived' as const, endedAt: now, updatedAt: now } : f,
  );
  return withFocuses(state, [...others, focus]);
}

/** Edits a focus; its start, status and history stay as they are. */
export function editFocus(state: State, id: string, input: FocusInput, now: string): State {
  const existing = state.focuses.find((f) => f.id === id);
  if (!existing) throw new Error('This focus no longer exists.');
  if (existing.status !== 'active') throw new Error('Only the active focus can be edited.');
  const clean = checked(state, input, existing.startDate);
  return withFocuses(
    state,
    state.focuses.map((f) => (f.id === id ? { ...f, ...clean, updatedAt: now } : f)),
  );
}

/** Completes or archives the active focus. Its record and weekly reviews stay. */
export function endFocus(
  state: State,
  id: string,
  status: 'completed' | 'archived',
  now: string,
): State {
  const existing = state.focuses.find((f) => f.id === id);
  if (!existing || existing.status !== 'active') throw new Error('This focus is not active.');
  return withFocuses(
    state,
    state.focuses.map((f) => (f.id === id ? { ...f, status, endedAt: now, updatedAt: now } : f)),
  );
}

/** Day N of the planned period; the review date can pass without anything changing. */
export function focusDay(focus: Focus, today: string): { day: number; of: number; due: boolean } {
  return {
    day: daysBetween(focus.startDate, today) + 1,
    of: daysBetween(focus.startDate, focus.reviewDate),
    due: today >= focus.reviewDate,
  };
}

/** The focus's routines that still exist, in the user's order, the lead first. */
export function focusRoutines(state: State, focus: Focus): Routine[] {
  const ids = focus.leadRoutineId
    ? [focus.leadRoutineId, ...focus.routineIds.filter((id) => id !== focus.leadRoutineId)]
    : focus.routineIds;
  return ids.map((id) => routineOf(state, id)).filter((r): r is Routine => !!r);
}

export type NextAction =
  | { kind: 'due'; block: Block; routine: Routine }
  /** Every linked objective on the day is done or skipped. */
  | { kind: 'done' }
  /** Nothing linked is on the day: nothing is invented. */
  | { kind: 'none' };

/** The first linked objective still open on the day, the lead first; never a new objective. */
export function nextAction(state: State, focus: Focus, date: string): NextAction {
  const blocks = state.days[date]?.blocks ?? [];
  const linked = focusRoutines(state, focus).filter((r) => r.enabled);
  for (const routine of linked) {
    const block = blocks.find((b) => b.routineId === routine.id && b.status === 'planned');
    if (block) return { kind: 'due', block, routine };
  }
  return blocks.some((b) => linked.some((r) => r.id === b.routineId))
    ? { kind: 'done' }
    : { kind: 'none' };
}

const weekday = (date: string) => dateObject(date).toLocaleDateString('en-US', { weekday: 'long' });

/**
 * A short, honest restart line when the last occurrence of the next objective before today did not
 * happen (skipped or left open, on a day that was not protected). It names the day plainly and
 * points at today, never at a miss: it changes nothing, owes nothing and gives no credit. For
 * trading, a rule-broken last session is the one to name.
 */
export function restartNote(state: State, routine: Routine, today: string): string | null {
  const book = tradingBook(state);
  if (book?.routineId === routine.id && book.trading) {
    // Only a recent session: a rule broken weeks ago is history, not today's next step.
    for (let i = 1; i <= 4; i++) {
      const review = candleReview(state, routine.id, shiftDate(today, -i));
      if (!review) continue;
      return sessionResult(review, book.trading) === 'broken'
        ? 'The last session broke a rule. Process first today; no recovery trades.'
        : null;
    }
    return null;
  }
  for (let i = 1; i <= 14; i++) {
    const date = shiftDate(today, -i);
    const day = state.days[date];
    const block = day?.blocks.find((b) => b.routineId === routine.id && !b.optional);
    if (!block) continue;
    if (block.status === 'done' || day?.protection) return null;
    if (isPlanWorkout(state, routine.id))
      return `${weekday(date)}'s workout didn't happen. It stays next; nothing is owed.`;
    if (studyPlanFor(state, routine.id))
      return `${weekday(date)} didn't happen. Start fresh today; five minutes is a fine start.`;
    return `${weekday(date)} didn't happen. Today counts on its own.`;
  }
  return null;
}
