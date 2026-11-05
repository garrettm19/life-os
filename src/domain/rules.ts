import { withDay } from './data';
import { RuleAnswer, RuleBook, RuleReview, State, dateObject, localDate } from './model';
import { setStatus } from './planner';
import { validateRuleBooks, validateRuleReviews } from './records';
import { routineOf } from './workouts';

// Rule-adherence reviews. The habit is following one's own rules, never doing the activity more:
// a day without the activity is its own outcome (never a perfect score), Not applicable is never a
// failure, and a reviewed day with any No or broken rule is never fully compliant. Nothing here
// involves money, results or any external account.

export function ruleBookFor(state: State, routineId: string | null): RuleBook | undefined {
  return routineId ? state.ruleBooks.find((b) => b.routineId === routineId) : undefined;
}

/** One checkpoint per non-empty line. Existing IDs are kept by position so history lines up. */
export function parseCheckpoints(text: string, previous: RuleBook['checkpoints'] = []) {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean)
    .map((line, i) => ({ id: previous[i]?.id ?? `checkpoint-${i + 1}`, text: line }));
}

/**
 * Rules pasted as a numbered list: a line starting "N." (or "N)") begins a rule and its title;
 * the lines after it, up to the next rule, are its details. IDs follow the rule number, so the
 * same numbered rule keeps its identity when the text is edited.
 */
export function parseRules(text: string): RuleBook['rules'] {
  const rules: RuleBook['rules'] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const start = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (start) {
      rules.push({
        id: `rule-${start[1]}`,
        title: start[2].replace(/\*\*/g, '').trim(),
        details: '',
      });
      continue;
    }
    if (!line.trim() || !rules.length) continue;
    const last = rules[rules.length - 1];
    last.details = last.details ? `${last.details}\n${line.trim()}` : line.trim();
  }
  return rules;
}

/** The rules as editable text again ("1. Title" then its detail lines). */
export function rulesText(rules: RuleBook['rules']): string {
  return rules
    .map((r) => `${r.id.replace('rule-', '')}. ${r.title}${r.details ? `\n${r.details}` : ''}`)
    .join('\n\n');
}

export function saveRuleBook(state: State, book: RuleBook): State {
  if (!routineOf(state, book.routineId)) throw new Error('Choose an existing routine.');
  if (new Set(book.rules.map((r) => r.id)).size !== book.rules.length)
    throw new Error('Two rules share a number. Number each rule once.');
  const exists = state.ruleBooks.some((b) => b.id === book.id);
  const ruleBooks = exists
    ? state.ruleBooks.map((b) => (b.id === book.id ? book : b))
    : [...state.ruleBooks, book];
  validateRuleBooks(ruleBooks);
  return { ...state, ruleBooks };
}

export type RuleReviewInput = {
  id?: string;
  date: string;
  routineId: string;
  outcome: RuleReview['outcome'];
  answers: { checkpointId: string; answer: RuleAnswer }[];
  violations: string[];
  note: string;
  occurrence?: { date: string; blockId: string };
};

/**
 * Saves a review (or a day without the activity) and completes its objective in the same change.
 * A reviewed day must answer every checkpoint; a day without the activity carries no answers.
 */
export function saveRuleReview(
  state: State,
  input: RuleReviewInput,
  newId: string,
  at: string,
): State {
  dateObject(input.date);
  if (input.date > localDate(new Date(at)))
    throw new Error('A review can be recorded for today or an earlier day.');
  const book = ruleBookFor(state, input.routineId);
  if (!book) throw new Error('Add your rules first.');
  if (input.outcome === 'reviewed') {
    const answered = new Set(input.answers.map((a) => a.checkpointId));
    if (book.checkpoints.some((c) => !answered.has(c.id)))
      throw new Error('Answer every checkpoint: Yes, No or Not applicable.');
    if (input.violations.some((v) => !book.rules.some((r) => r.id === v)))
      throw new Error('A broken rule is no longer in your rulebook.');
  }
  const existing = input.id ? state.ruleReviews.find((r) => r.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('This review no longer exists.');
  const occurrenceId = input.occurrence?.blockId ?? existing?.occurrenceId ?? null;
  if (
    occurrenceId &&
    state.ruleReviews.some((r) => r.occurrenceId === occurrenceId && r.id !== existing?.id)
  )
    throw new Error('This objective already has a review. Edit that one instead.');
  const review: RuleReview = {
    id: existing?.id ?? newId,
    date: input.date,
    at: existing?.at ?? at,
    routineId: input.routineId,
    occurrenceId,
    outcome: input.outcome,
    answers: input.outcome === 'reviewed' ? input.answers.map((a) => ({ ...a })) : [],
    violations: input.outcome === 'reviewed' ? [...input.violations] : [],
    note: input.note.trim(),
  };
  const ruleReviews = existing
    ? state.ruleReviews.map((r) => (r.id === existing.id ? review : r))
    : [...state.ruleReviews, review];
  validateRuleReviews(ruleReviews);
  let next: State = { ...state, ruleReviews };
  if (input.occurrence) {
    const day = next.days[input.occurrence.date];
    const block = day?.blocks.find((b) => b.id === input.occurrence!.blockId);
    if (!day || !block) throw new Error('This objective is no longer on the plan.');
    if (block.status !== 'done') next = withDay(next, setStatus(day, block.id, 'done', at));
  }
  return next;
}

/** Whether a reviewed day kept every applicable checkpoint and broke no rule. */
export function fullyCompliant(review: RuleReview): boolean {
  return (
    review.outcome === 'reviewed' &&
    review.violations.length === 0 &&
    review.answers.every((a) => a.answer !== 'no')
  );
}

export type Adherence = {
  reviewed: number;
  daysWithout: number;
  compliantDays: number;
  /** Yes answers over applicable answers (Yes + No); null with nothing applicable. */
  percent: number | null;
  /** Checkpoints answered No and rules recorded as broken, most frequent first. */
  missed: { label: string; count: number }[];
};

/** Honest adherence over a date range from actual reviews only. */
export function adherence(state: State, routineId: string, from: string, to: string): Adherence {
  const book = ruleBookFor(state, routineId);
  const reviews = state.ruleReviews.filter(
    (r) => r.routineId === routineId && r.date >= from && r.date <= to,
  );
  const reviewed = reviews.filter((r) => r.outcome === 'reviewed');
  const answers = reviewed.flatMap((r) => r.answers);
  const yes = answers.filter((a) => a.answer === 'yes').length;
  const no = answers.filter((a) => a.answer === 'no').length;
  const counts = new Map<string, number>();
  const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const r of reviewed) {
    for (const a of r.answers)
      if (a.answer === 'no')
        bump(
          book?.checkpoints.find((c) => c.id === a.checkpointId)?.text ?? 'A removed checkpoint',
        );
    for (const v of r.violations)
      bump(book?.rules.find((x) => x.id === v)?.title ?? 'A removed rule');
  }
  return {
    reviewed: reviewed.length,
    daysWithout: reviews.length - reviewed.length,
    compliantDays: reviewed.filter(fullyCompliant).length,
    percent: yes + no ? Math.round((yes / (yes + no)) * 100) : null,
    missed: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
