import { validateWeeklyReviews } from './direction-records';
import { Focus, State, WeeklyReview, localDate, shiftDate, weekStartOf } from './model';

// The weekly course correction: what got in the way, and one change for next week (or explicitly
// none). One per Monday-to-Sunday week, optional, never part of Day Cleared. It records the user's
// decision only: nothing on the plan changes because of it.

export type WeeklyInput = {
  weekStart: string;
  obstacle: string;
  adjustment: string;
  noChange: boolean;
};

export function reviewFor(state: State, weekStart: string): WeeklyReview | undefined {
  return state.weeklyReviews.find((r) => r.weekStart === weekStart);
}

/** Saved reviews, the latest week first. */
export function pastReviews(state: State): WeeklyReview[] {
  return [...state.weeklyReviews].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/** The focus that was active during a week (the active one, else the latest started), if any. */
function focusDuring(state: State, weekStart: string): Focus | undefined {
  const end = shiftDate(weekStart, 6);
  return state.focuses
    .filter(
      (f) =>
        f.startDate <= end &&
        (f.status === 'active' || (!!f.endedAt && localDate(new Date(f.endedAt)) >= weekStart)),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        b.startDate.localeCompare(a.startDate) ||
        b.createdAt.localeCompare(a.createdAt),
    )[0];
}

/** The most recent adjustment chosen before a week, to keep in view while it applies. */
export function lastAdjustment(state: State, weekStart: string): WeeklyReview | undefined {
  return pastReviews(state).find((r) => r.weekStart < weekStart && r.adjustment.trim());
}

/**
 * Saves the week's review, or corrects it: one per week. A new review links the focus that was
 * active during that week; a correction keeps that link and the first save time.
 */
export function saveWeeklyReview(
  state: State,
  input: WeeklyInput,
  newId: string,
  now: string,
): State {
  if (weekStartOf(input.weekStart) !== input.weekStart)
    throw new Error('A weekly review starts on a Monday.');
  if (input.weekStart > weekStartOf(localDate(new Date(now))))
    throw new Error('A week can be reviewed once it has started.');
  const obstacle = input.obstacle.trim();
  const adjustment = input.noChange ? '' : input.adjustment.trim();
  if (!obstacle && !adjustment && !input.noChange)
    throw new Error('Write the obstacle or the adjustment, or choose "No adjustment needed".');
  const existing = reviewFor(state, input.weekStart);
  const review: WeeklyReview = {
    id: existing?.id ?? newId,
    weekStart: input.weekStart,
    focusId: existing ? existing.focusId : (focusDuring(state, input.weekStart)?.id ?? null),
    obstacle,
    adjustment,
    noChange: input.noChange,
    at: existing?.at ?? now,
    updatedAt: now,
  };
  const weeklyReviews = existing
    ? state.weeklyReviews.map((r) => (r.id === existing.id ? review : r))
    : [...state.weeklyReviews, review];
  validateWeeklyReviews(weeklyReviews);
  return { ...state, weeklyReviews };
}

/** Removes a week's review (the user's explicit choice); nothing else changes. */
export function deleteWeeklyReview(state: State, weekStart: string): State {
  return { ...state, weeklyReviews: state.weeklyReviews.filter((r) => r.weekStart !== weekStart) };
}
