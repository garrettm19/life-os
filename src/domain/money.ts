import { withDay } from './data';
import { MoneyReview, State, dateObject, localDate, shiftDate } from './model';
import { setStatus } from './planner';
import { LIMITS, validateMoneyReviews } from './records';

const MONEY_FIELDS = ['cash', 'savings', 'debt', 'upcoming', 'contributed'] as const;
export type MoneyField = (typeof MONEY_FIELDS)[number];

/** The three measurements a weekly review records. The other fields exist only in older reviews. */
export const MEASURED = ['cash', 'savings', 'debt'] as const;
export type MoneyTotal = (typeof MEASURED)[number];

export const MONEY_LABELS: Record<MoneyField, string> = {
  cash: 'Cash',
  savings: 'Total savings',
  debt: 'Total debt',
  upcoming: 'Upcoming expenses',
  contributed: 'Saved since last review',
};

/**
 * Parses a typed amount into integer cents. Blank means not reported (null), which is different
 * from an entered zero. Balances are entered as positive numbers; debt is a positive balance owed.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(/^\$\s*/, '');
  if (!trimmed) return null;
  // Commas only as thousands separators ("2,500"); "2,5" is ambiguous and refused, not read as 25.
  if (trimmed.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(trimmed))
    throw new Error('Use commas only between thousands, like 2,500.50.');
  const cleaned = trimmed.replace(/,/g, '');
  // Size is the limit's to say: any number of whole digits is an amount, so a huge one is too large.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error('Use an amount like 2500 or 2,500.50, without a minus sign.');
  // Whole dollars and cents are combined as integers, so no binary fraction is ever involved.
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (cents > LIMITS.money) throw new Error('That amount is too large.');
  return cents;
}

/** "$2,500.00" for whole and fractional amounts alike; integer arithmetic only. */
export function formatMoney(cents: number, currency = 'USD'): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${sign}${symbol}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** Text for an input field: "2500.5" style, blank when not reported. */
export function amountText(cents: number | null): string {
  if (cents === null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export type MoneyInput = Omit<MoneyReview, 'id' | 'at' | 'occurrenceId'> & {
  id?: string;
  occurrence?: { date: string; blockId: string };
};

/**
 * Saves a weekly snapshot or corrects one by ID. One review per objective occurrence; completing
 * that objective happens in the same state change. Other weeks are never touched.
 */
export function saveMoneyReview(state: State, input: MoneyInput, newId: string, at: string): State {
  dateObject(input.date);
  if (input.date > localDate(new Date(at)))
    throw new Error('A review can be recorded for today or an earlier day.');
  const existing = input.id ? state.moneyReviews.find((r) => r.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('This review no longer exists.');
  if (MONEY_FIELDS.every((field) => input[field] === null) && !input.nextAction.trim())
    throw new Error('Enter at least one figure or a next action.');
  const occurrenceId = input.occurrence?.blockId ?? existing?.occurrenceId ?? null;
  if (
    occurrenceId &&
    state.moneyReviews.some((r) => r.occurrenceId === occurrenceId && r.id !== existing?.id)
  )
    throw new Error('This objective already has a review. Edit that review instead.');
  const nextAction = input.nextAction.trim();
  const review: MoneyReview = {
    id: existing?.id ?? newId,
    date: input.date,
    at: existing?.at ?? at,
    currency: input.currency,
    cash: input.cash,
    savings: input.savings,
    debt: input.debt,
    upcoming: input.upcoming,
    contributed: input.contributed,
    savingsTarget: input.savingsTarget,
    nextAction,
    note: input.note.trim(),
    goalId: input.goalId,
    occurrenceId,
  };
  // A priority marked done stays done while its words stay the same; a new priority starts open.
  if (existing?.priorityDoneAt && existing.nextAction === nextAction && nextAction)
    review.priorityDoneAt = existing.priorityDoneAt;
  const moneyReviews = existing
    ? state.moneyReviews.map((r) => (r.id === existing.id ? review : r))
    : [...state.moneyReviews, review];
  validateMoneyReviews(moneyReviews);
  let next: State = { ...state, moneyReviews };
  if (input.occurrence) {
    const day = next.days[input.occurrence.date];
    const block = day?.blocks.find((b) => b.id === input.occurrence!.blockId);
    if (!day || !block) throw new Error('This objective no longer exists.');
    if (block.status !== 'done') next = withDay(next, setStatus(day, block.id, 'done', at));
  }
  return next;
}

export function deleteMoneyReview(state: State, id: string): State {
  if (!state.moneyReviews.some((r) => r.id === id))
    throw new Error('This review no longer exists.');
  return { ...state, moneyReviews: state.moneyReviews.filter((r) => r.id !== id) };
}

export function sortedReviews(state: State): MoneyReview[] {
  return [...state.moneyReviews].sort(
    (a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at),
  );
}

/** The review before `review` (or the latest one when `review` is new), same currency only. */
export function previousReview(state: State, date: string, excludeId?: string): MoneyReview | null {
  const earlier = sortedReviews(state).filter(
    (r) => r.id !== excludeId && (r.date < date || (r.date === date && !excludeId)),
  );
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/** Reviews in the order they happened: by date, then by when they were saved. */
function before(a: MoneyReview, b: { date: string; at: string }): boolean {
  return a.date < b.date || (a.date === b.date && a.at < b.at);
}

export type Reported = { value: number; date: string };

/**
 * The latest figure for `field` reported before a point in time, in one currency. A review that
 * left the field blank is skipped, so "since" always names the review that actually reported it.
 */
export function lastReported(
  state: State,
  field: MoneyTotal,
  currency: string,
  point: { date: string; at: string },
  excludeId?: string,
): Reported | null {
  const earlier = sortedReviews(state).filter(
    (r) => r.id !== excludeId && r.currency === currency && r[field] !== null && before(r, point),
  );
  const last = earlier.at(-1);
  return last ? { value: last[field]!, date: last.date } : null;
}

/** The first figure ever reported for `field` in one currency, up to and including a point. */
function firstReported(
  state: State,
  field: MoneyTotal,
  currency: string,
  point: { date: string; at: string },
): Reported | null {
  const first = sortedReviews(state).find(
    (r) =>
      r.currency === currency && r[field] !== null && (before(r, point) || r.date === point.date),
  );
  return first ? { value: first[field]!, date: first.date } : null;
}

export type FieldChange = {
  field: MoneyTotal;
  value: number | null;
  /** The last earlier review that reported this figure, if any. */
  previous: Reported | null;
  /** Change since `previous`; only when both figures were reported. */
  delta: number | null;
  first: Reported | null;
  /** Change since the first report, when that came before `previous`. */
  sinceFirst: number | null;
};

/** Cash, savings and debt in one review against what was last reported for each. */
export function fieldChanges(state: State, review: MoneyReview): FieldChange[] {
  return MEASURED.map((field) => {
    const value = review[field];
    const previous = lastReported(state, field, review.currency, review, review.id);
    const first = firstReported(state, field, review.currency, review);
    return {
      field,
      value,
      previous,
      delta: value !== null && previous ? value - previous.value : null,
      first,
      sinceFirst:
        value !== null && first && previous && first.date < previous.date
          ? value - first.value
          : null,
    };
  });
}

/** Whether a change moves toward the user's stated aim: savings up, debt down. Cash is neutral. */
export function changeTone(field: MoneyTotal, delta: number | null): 'good' | 'watch' | 'neutral' {
  if (!delta || field === 'cash') return 'neutral';
  return (field === 'savings') === delta > 0 ? 'good' : 'watch';
}

/**
 * This week's money priority: from the latest review in the last seven days, if that review named
 * one. A review this week without a priority means none; an older priority is not carried over.
 */
export function currentPriority(state: State, today: string): MoneyReview | null {
  const latest = sortedReviews(state)
    .filter((r) => r.date <= today && r.date >= shiftDate(today, -6))
    .at(-1);
  return latest?.nextAction ? latest : null;
}

/** Marks the review's priority done (with a time) or open again (null). */
export function setPriorityDone(state: State, id: string, at: string | null): State {
  const review = state.moneyReviews.find((r) => r.id === id);
  if (!review?.nextAction) throw new Error('This priority no longer exists.');
  const moneyReviews = state.moneyReviews.map((r) =>
    r.id === id ? { ...r, priorityDoneAt: at } : r,
  );
  validateMoneyReviews(moneyReviews);
  return { ...state, moneyReviews };
}
