import { circuitFor, circuitSessionFor } from './intervals';
import { Block, Routine, State } from './model';
import { isWorkout } from './sequence';
import { fullStudy, minutesLine, studyPlanFor, studySessionFor } from './study';
import { candleReview, isTradingReview, sessionRan, tradingBook } from './trading';
import { doneSets, routineOf, sessionFor } from './workouts';

/**
 * What an objective records: a trading session, a workout log, a timed circuit, a study session
 * or the routine's own form (a weight, a money review, an activity, a rule review).
 */
export type RecordKind =
  'trading' | 'workout' | 'circuit' | 'study' | NonNullable<Routine['capture']>;

/**
 * The one classification of what an objective records; `null` for a plain objective. Today opens
 * the matching form instead of ticking the objective off, except for study, which completes with
 * one tap. The Large widget ticks only a plain or study objective.
 */
export function recordKind(state: State, block: Block): RecordKind | null {
  if (block.routineId === null) return null;
  if (tradingBook(state)?.routineId === block.routineId) return 'trading';
  if (isWorkout(state, block.routineId)) return 'workout';
  if (circuitFor(state, block.routineId)) return 'circuit';
  if (studyPlanFor(state, block.routineId)) return 'study';
  return routineOf(state, block.routineId)?.capture ?? null;
}

/**
 * Whether an objective that records something has its evidence. Completing the objective (the
 * action) and having the record (a weight, a review, a finished workout) are separate facts; the
 * app shows both rather than letting one stand in for the other.
 *
 * - `recorded`: the measurement, review or finished session exists.
 * - `unfinished`: a workout has logged sets in a session that was never finished.
 * - `missing`: no record (never taken, marked done without one, or deleted later).
 * - `null`: a plain objective that records nothing.
 *
 * `date` is the day the objective sits on: a weight recorded separately for that date also counts,
 * since there is one weight per date.
 */
export type LinkedRecord = 'recorded' | 'unfinished' | 'missing' | null;

export function linkedRecord(state: State, block: Block, date?: string): LinkedRecord {
  switch (recordKind(state, block)) {
    case 'workout': {
      const session = sessionFor(state, block.id);
      if (session?.status === 'completed') return 'recorded';
      return session && doneSets(session) > 0 ? 'unfinished' : 'missing';
    }
    case 'circuit':
      return circuitSessionFor(state, block.id) ? 'recorded' : 'missing';
    // Study completes with one tap; a timed session is an optional extra, never missing.
    case 'study':
      return studySessionFor(state, block.id) ? 'recorded' : null;
    case 'weight':
      return state.measurements.some(
        (m) => m.occurrenceId === block.id || (date !== undefined && m.date === date),
      )
        ? 'recorded'
        : 'missing';
    case 'money':
      return state.moneyReviews.some((r) => r.occurrenceId === block.id) ? 'recorded' : 'missing';
    case 'activity':
      return state.activitySessions.some((a) => a.occurrenceId === block.id)
        ? 'recorded'
        : 'missing';
    case 'rules':
      return state.ruleReviews.some((r) => r.occurrenceId === block.id) ? 'recorded' : 'missing';
    // A trading session is recorded as its candle's review (`candleReview`), wherever it was
    // saved; an older rule review, or any review when the date is not known, by its occurrence.
    case 'trading': {
      const reviewed =
        (date !== undefined && !!candleReview(state, block.routineId!, date)) ||
        state.ruleReviews.some(
          (r) => r.occurrenceId === block.id && (date === undefined || !isTradingReview(r)),
        );
      return reviewed ? 'recorded' : 'missing';
    }
    case null:
      return null;
  }
}

/** The status line for a recorded objective whose evidence is missing; null when nothing to say. */
export function evidenceNote(state: State, block: Block, date?: string): string | null {
  if (block.status === 'skipped' && isWorkout(state, block.routineId)) {
    const session = sessionFor(state, block.id);
    const sets = session?.status === 'active' ? doneSets(session) : 0;
    return sets ? `Skipped · ${sets} logged set${sets === 1 ? '' : 's'} kept` : null;
  }
  // A skipped trading day is excused for Day Cleared, but when a session ran on it the next
  // session still waits for its candle's review, so the skip says so
  // until the review is saved, wherever it was saved (`candleReview`).
  const ran = date ? state.tradingSessions[date] : undefined;
  if (
    block.status === 'skipped' &&
    recordKind(state, block) === 'trading' &&
    !!ran &&
    sessionRan(ran) &&
    linkedRecord(state, block, date) === 'missing'
  )
    return 'Skipped · review it before the next session';
  if (block.status !== 'done') return null;
  // A circuit counted as done by choice, with intervals skipped, says so.
  const circuit = circuitSessionFor(state, block.id);
  if (circuit?.skipped.length)
    return `Done · circuit with ${circuit.skipped.length} interval${circuit.skipped.length === 1 ? '' : 's'} skipped`;
  // A shorter study session counted as done by choice says how long it actually ran.
  const study = studySessionFor(state, block.id)?.study;
  if (study && !fullStudy(study)) return `Done · ${minutesLine(study)} timed`;
  const linked = linkedRecord(state, block, date);
  if (linked === 'unfinished') return 'Done · workout log not finished';
  if (linked !== 'missing') return null;
  const kind = recordKind(state, block);
  if (kind === 'workout') return 'Done · no workout log';
  if (kind === 'circuit') return 'Done · no timed circuit';
  if (kind === 'weight') return 'Done · no measurement';
  if (kind === 'activity') return 'Done · no activity recorded';
  return 'Done · no review';
}
