import { withDay } from './data';
import {
  GexLockId,
  addDays,
  candleDate,
  gexLocks,
  gexWindow,
  nyTime,
  previousCandle,
} from './market-clock';
import {
  Discipline,
  DisciplineKey,
  EntryPlan,
  EntrySnapshot,
  GexArea,
  OutsideRule,
  Regime,
  RuleBook,
  RuleReview,
  State,
  ThesisCard,
  TradingItem,
  TradingProfile,
  dateObject,
  displayDate,
  displayTime,
  accountSetPause,
  localDate,
  shiftDate,
} from './model';
import { setStatus } from './planner';
import {
  DISCIPLINE_KEYS,
  MAX_CONTRACTS,
  MAX_ENTRIES,
  inOrder,
  isTimestamp,
  positive,
  thesisLine,
  validateEntryLog,
  validateGexArea,
  validateRegime,
  validateRuleBooks,
  validateRuleReviews,
  validateThesisCard,
} from './records';
import { onItsDays } from './repeat';
import { GateSession, accountsRaiseProblem, withRaises } from './trading-safeguards';
import { upsertRoutine } from './routines';
import { COUNTER_BIAS_VIOLATION, ACCOUNT_SET_PAUSE_DAYS } from './trading-rules';
import { confirmedExpansion } from './trading-regime';
import { LiveFields, liveViolations, validLiveFields } from './trading-live-model';
import { routineOf } from './workouts';

// Trading discipline: PROCESS > P&L. The daily measure is the eight-item process checklist,
// each item PASS or FAIL, and a session is clean only with all eight passed and no hard violation.
// Everything is self-reported: nothing here sees, checks or blocks a broker account, and there is
// no profit, balance or trade-count reward anywhere. A deliberate session without trades can be
// clean; a planned day away is neither a success nor a failure; a trading day left without a
// review is never counted as clean.

// The generic process. Personal wording and limits arrive through an imported setup file; these
// defaults name no account, instrument or amount.
const DEFAULT_FRAMEWORK: TradingItem[] = [
  {
    id: 'location',
    title: 'Location',
    details:
      'Middle of the range = no trade.\nOnly meaningful areas identified in advance: a key level, a higher-timeframe level, a range high or low, a previous high or low.',
  },
  {
    id: 'permission',
    title: 'Permission',
    details:
      'Touching a level is not permission.\nWait for real confirmation: a sweep and reclaim, displacement, CISD, a clear rejection, a structure shift, a break and retest, a strong reaction from the zone.',
  },
  {
    id: 'invalidation',
    title: 'Invalidation',
    details: 'No clear invalidation = no trade.\nKnow where the idea is wrong before entering.',
  },
  {
    id: 'execution',
    title: 'Execution',
    details:
      'Size from the invalidation and the risk limit.\nNever choose size first and force the stop to fit.',
  },
];

const DEFAULT_CHECKLIST: TradingItem[] = [
  {
    id: 'process-1',
    title: 'Prepared the thesis',
    details:
      'Levels marked, and the HTF expectation, GEX reason, objective, zone and invalidation set before the session.',
  },
  {
    id: 'process-2',
    title: 'Waited for location',
    details: 'No chasing and no intentional entry from the middle of a range.',
  },
  {
    id: 'process-3',
    title: 'Required permission',
    details: 'Every entry had genuine price-action confirmation.',
  },
  {
    id: 'process-4',
    title: 'Stayed anchored to HTF',
    details:
      'Traded only with the daily bias, and LTF candles never changed my direction, objective or management.',
  },
  {
    id: 'process-5',
    title: 'Sized from risk',
    details: 'Size came from the invalidation distance, inside the thesis risk limit.',
  },
  {
    id: 'process-6',
    title: 'Handled losses correctly',
    details:
      'After a failed thesis: flat, orders canceled, the reset taken, context rebuilt, no revenge trade.',
  },
  {
    id: 'process-7',
    title: 'Respected daily limits',
    details:
      'Entry, failed-thesis, risk and daily-loss limits respected. No widened stop, no averaging into a loser.',
  },
  {
    id: 'process-8',
    title: 'Stopped appropriately',
    details:
      'Stopped when conditions no longer justified trading or a hard limit was reached. Never took an extra trade to reach a profit target.',
  },
];

const DEFAULT_VIOLATIONS: TradingItem[] = [
  'No clear invalidation',
  'Widened a stop',
  'Averaged into a losing trade',
  'Revenge re-entry',
  'Exceeded the thesis risk',
  'Exceeded the daily loss limit',
  'Traded after the hard stop',
  'Took an extra trade to reach a profit target',
  'More entries than the daily limit',
  'More failed theses than the daily limit',
  'Intentionally traded from the middle of a range',
  'Increased size from frustration or a loss',
  'Came back for nighttime recovery trading',
  COUNTER_BIAS_VIOLATION.title,
  'Chased after the planned entry was missed',
  'Moved or created the entry zone after price arrived to justify an entry',
  'Changed HTF direction or objective because of LTF noise',
  'Added at a location not planned before the first entry',
  'Traded on a study-only day',
  'Entered without a named setup',
].map((title, i) => ({ id: `hard-${i + 1}`, title, details: '' }));

/** Hard violations the session log can point to, by their default IDs (`hard-N`, never reused). */
export const VIOLATION_IDS = {
  noInvalidation: 'hard-1',
  revenge: 'hard-4',
  overThesisRisk: 'hard-5',
  overDailyLoss: 'hard-6',
  afterHardStop: 'hard-7',
  overEntryLimit: 'hard-9',
  nightRecovery: 'hard-13',
  againstBias: COUNTER_BIAS_VIOLATION.id,
  unplannedAdd: 'hard-18',
  studyOnlyDay: 'hard-19',
  noNamedSetup: 'hard-20',
} as const;

const DEFAULT_RESET: TradingProfile['reset'] = {
  minutes: 15,
  steps: [
    'Positions are flat',
    'Working orders are canceled',
    'Zoom out to the 15-minute chart',
    'Reassess the 5-minute structure',
    'Identify the current range',
    'Name what is genuinely new',
  ],
};

/** A trading profile with the generic process and no limits yet (the user adds their own). */
export function defaultTradingProfile(since: string): TradingProfile {
  return {
    since,
    framework: DEFAULT_FRAMEWORK.map((f) => ({ ...f })),
    checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    violations: DEFAULT_VIOLATIONS.map((v) => ({ ...v })),
    limits: [],
    maxFailedTheses: null,
    reset: { minutes: DEFAULT_RESET.minutes, steps: [...DEFAULT_RESET.steps] },
  };
}

/** The rulebook that carries the trading process, if any (one per user in practice). */
export function tradingBook(state: State): RuleBook | undefined {
  return state.ruleBooks.find((b) => b.trading && routineOf(state, b.routineId));
}

/** Whether the trading objective is paused in Programs: planning and no-trade only, no sessions. */
export function tradingPaused(state: State, book: RuleBook): boolean {
  return routineOf(state, book.routineId)?.enabled === false;
}

/** "Live trading paused until Wed, Nov 18." */
export function accountSetPauseLine(until: string): string {
  return `Live trading paused until ${displayDate(until)}.`;
}

/**
 * The account set is lost: live trading is paused for 30 days.
 * It records when, pauses the trading objective in Programs (which removes its planned,
 * unrecorded occurrences from today on, as any pause does) and cannot be taken back from the app
 * before the date; the routine resumes only from then (`upsertRoutine`). Reported again during
 * the pause, it changes nothing.
 */
export function loseAccountSet(state: State, routineId: string, at: string): State {
  const book = state.ruleBooks.find((b) => b.routineId === routineId && b.trading);
  const program = state.programs.find((p) => p.routines.some((r) => r.id === routineId));
  const routine = program?.routines.find((r) => r.id === routineId);
  if (!book?.trading || !program || !routine) throw new Error('Set up Trading discipline first.');
  const today = localDate(new Date(at));
  if (accountSetPause(book.trading, today)) return state;
  const until = shiftDate(today, ACCOUNT_SET_PAUSE_DAYS);
  let next = saveTradingProfile(
    state,
    routineId,
    { ...book.trading, fundedSetLost: { at, until } },
    at,
  );
  if (routine.enabled) next = upsertRoutine(next, program, { ...routine, enabled: false }, at);
  return next;
}

/**
 * The day's session once the account set is reported lost: a session already running ends at once
 * as a hard stop, so nothing more is live today (an entry already taken can still be logged with
 * Log an entry I took). A session not started, or already ended, stays as it is.
 */
export function endForAccountSet(session: TradingSession, at: string): TradingSession {
  return session.startedAt ? endTrading(session, 'hard-stop', at) : session;
}

/**
 * Whether a written limit is about profit (a ceiling, target, quota or payout, or a +$ amount).
 * The live screens never show one: the only profit rule there is "Never take an extra trade to
 * reach a profit target."
 */
export function profitLimit(limit: TradingProfile['limits'][number]): boolean {
  return /\b(profits?|payouts?|ceilings?|targets?|quotas?)\b|\+\s*\$/i.test(
    `${limit.label} ${limit.value}`,
  );
}

/**
 * Adds the trading process to an existing rulebook, keeping its checkpoints, rules and every
 * review exactly as they are. Doing it again changes nothing.
 */
export function enableTrading(state: State, routineId: string, at: string): State {
  const book = state.ruleBooks.find((b) => b.routineId === routineId);
  if (!book) throw new Error('Add your rules to this objective in Programs first.');
  if (book.trading) return state;
  return saveTradingProfile(state, routineId, defaultTradingProfile(localDate(new Date(at))), at);
}

/**
 * Replaces the trading profile of one rulebook (its checklist, limits, reset or framework). More
 * accounts are refused until the clean live sessions for that step are recorded
 * (`accountsRaiseProblem`), and any raise waits for the next candle's session (`withRaises`).
 */
export function saveTradingProfile(
  state: State,
  routineId: string,
  profile: TradingProfile,
  at: string,
): State {
  const book = state.ruleBooks.find((b) => b.routineId === routineId);
  if (!book) throw new Error('Add your rules to this objective in Programs first.');
  const previous = book.trading;
  if (
    previous &&
    previous.checklist.map((c) => c.id).join() !== profile.checklist.map((c) => c.id).join()
  )
    throw new Error('The eight checklist items keep their places; edit their wording instead.');
  if (previous) {
    const problem = accountsRaiseProblem(
      gateSessions(state, routineId),
      previous.accounts ?? 1,
      profile.accounts ?? 1,
    );
    if (problem) throw new Error(problem);
  }
  const trading = withRaises(previous, profile, candleDate(Date.parse(at)));
  const ruleBooks = state.ruleBooks.map((b) =>
    b.id === book.id ? { ...b, trading, updatedAt: at } : b,
  );
  validateRuleBooks(ruleBooks);
  return { ...state, ruleBooks };
}

/** Whether a review was recorded with the trading process (older rule reviews were not). */
export function isTradingReview(review: RuleReview): boolean {
  return review.trading !== undefined;
}

/** Each date an earlier build kept a moved session on (`movedFrom`), with that session's candle. */
function movedDates(state: State): Map<string, string> {
  const moved = new Map<string, string>();
  for (const s of Object.values(state.tradingSessions))
    if (s.movedFrom) moved.set(s.movedFrom, s.date);
  return moved;
}

/**
 * The candle whose session date (`sessionDateOf`) a date is, or null when it is none: on a US
 * phone a weekday's own candle, east of New York the candle before it (Friday's for Saturday).
 */
function sessionCandle(date: string): string | null {
  const latest = previousCandle(addDays(date, 1));
  if (sessionDateOf(latest) === date) return latest;
  const before = previousCandle(latest);
  return sessionDateOf(before) === date ? before : null;
}

/**
 * The candle a trading review is for, and how surely. This build saves every review on its
 * candle's date and marks it (`ownCandle`). Earlier builds dated a review by the record its session
 * was kept on: their review on a date a session moved in from (`movedFrom`) is that session's
 * candle's, and one on the record of a session that started there before the review was saved is
 * that candle's, surely. Any other is read as the candle whose session date (`sessionDateOf`) its
 * date is, which on a US phone is its own date, and one on a date that is no candle's session date
 * (east of New York, a Monday) by its date.
 */
function reviewedCandle(
  state: State,
  r: RuleReview,
  moved: Map<string, string>,
): { candle: string; rank: 0 | 1 | 2 } {
  if (r.trading?.ownCandle) return { candle: r.date, rank: 0 };
  const from = moved.get(r.date);
  if (from) return { candle: from, rank: 0 };
  const kept = state.tradingSessions[r.date];
  if (kept?.startedAt && !kept.movedFrom && kept.startedAt <= r.at)
    return { candle: r.date, rank: 0 };
  const candle = sessionCandle(r.date);
  return candle ? { candle, rank: 1 } : { candle: r.date, rank: 2 };
}

/**
 * Each candle's trading review for one routine, at most one per candle, each read as the candle it
 * is for (`reviewedCandle`): the surest first, then in record order. Two reviews on one date read
 * the first, as they always did. A review that meets another date's review on its candle was saved
 * by an earlier build that dated a candle two ways: it is read as the latest earlier candle no
 * other review holds, so none is lost.
 */
function reviewsByCandle(state: State, routineId: string): Map<string, RuleReview> {
  const moved = movedDates(state);
  const seen = new Set<string>();
  const reviews: { r: RuleReview; candle: string; rank: number }[] = [];
  for (const r of state.ruleReviews) {
    if (r.routineId !== routineId || !isTradingReview(r)) continue;
    // A second review on one date (and from the same build) was never read: the first is.
    const key = `${r.date}${r.trading?.ownCandle ? '+' : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reviews.push({ r, ...reviewedCandle(state, r, moved) });
  }
  const byCandle = new Map<string, RuleReview>();
  const displaced: { r: RuleReview; candle: string }[] = [];
  for (const rank of [0, 1, 2])
    for (const read of reviews)
      if (read.rank === rank) {
        if (byCandle.has(read.candle)) displaced.push(read);
        else byCandle.set(read.candle, read.r);
      }
  // The latest first, so each takes the candle just before its own when it is free.
  displaced.sort((a, b) => (a.candle < b.candle ? 1 : a.candle > b.candle ? -1 : 0));
  for (const { r, candle: own } of displaced) {
    let candle = previousCandle(own);
    while (byCandle.has(candle)) candle = previousCandle(candle);
    byCandle.set(candle, r);
  }
  return byCandle;
}

/**
 * Every session started on the live cockpit with its candle's review, oldest first, for the clean
 * sessions counted before live trading and before more accounts (`GateSession`): read from the
 * records each time, never stored. A day away is not a review; sessions from before the live
 * cockpit (no mode) are none. A session not reviewed yet counts as violated when its records
 * already point to a hard violation (`violationsFromLog`, which its review will record), so a
 * count restarts at once rather than at the review.
 */
export function gateSessions(state: State, routineId: string): GateSession[] {
  const reviews = reviewsByCandle(state, routineId);
  const profile = state.ruleBooks.find((b) => b.routineId === routineId)?.trading;
  return Object.entries(state.tradingSessions)
    .filter(([, s]) => s.lock)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([candle, s]) => {
      const review = reviews.get(candle);
      const reviewed =
        !!review && review.outcome === 'reviewed' && review.trading?.session !== 'away';
      return {
        candle,
        mode: s.lock!.mode,
        accounts: s.lock!.limits.accounts,
        reviewed,
        violated: reviewed
          ? review!.violations.length > 0
          : !!profile && violationsFromLog(profile, s).length > 0,
      };
    });
}

/**
 * A candle's trading review, if any: the one this build saved on its date, or the one an earlier
 * build saved on the record it kept the candle's session on, east of New York the next date
 * (`reviewsByCandle`). Every reading of a candle's review goes through this or that index, so a
 * candle an earlier build reviewed is never asked for again, and its review is never taken for
 * the next candle's.
 */
export function candleReview(
  state: State,
  routineId: string,
  candle: string,
): RuleReview | undefined {
  return reviewsByCandle(state, routineId).get(candle);
}

/**
 * Whether a session's review waits for a trade's outcome: an attempt on the cockpit is still open.
 * An entry an earlier build left without an outcome never holds it, since nothing records one any
 * more; the review already reads that entry as not followed to plan (`disciplineFromRecords`).
 */
export function reviewWaitsForOutcome(session: TradingSession | null | undefined): boolean {
  return !!session?.attempts?.some((a) => !a.exit);
}

export type ProcessScore = { passed: number; answered: number; total: number };

/** PASS answers out of eight. Unanswered items are not passed. */
export function processScore(review: RuleReview, profile: TradingProfile): ProcessScore {
  const answers = new Map(review.answers.map((a) => [a.checkpointId, a.answer]));
  const items = profile.checklist;
  return {
    passed: items.filter((c) => answers.get(c.id) === 'yes').length,
    answered: items.filter((c) => answers.has(c.id)).length,
    total: items.length,
  };
}

export type SessionResult = 'clean' | 'broken' | 'away';

/**
 * Clean only with all eight items explicitly PASS, no hard violation and, on a review with the
 * discipline answers, all six Yes. Any FAIL, any hard violation, any discipline No, or anything
 * unanswered is a rule-broken session; a planned day away is unscored. A review saved before the
 * discipline answers keeps the result it was recorded with. Profit never enters it.
 */
export function sessionResult(review: RuleReview, profile: TradingProfile): SessionResult {
  if (review.trading?.session === 'away' || review.outcome === 'none') return 'away';
  const score = processScore(review, profile);
  const discipline = review.trading?.discipline;
  const disciplined = !discipline || DISCIPLINE_KEYS.every((k) => discipline[k]);
  return score.passed === score.total && review.violations.length === 0 && disciplined
    ? 'clean'
    : 'broken';
}

/** The review's discipline answers as pre-filled or answered: null where not answered yet. */
export type DisciplineDraft = Record<DisciplineKey, boolean | null>;

/**
 * The discipline answers the records can give, for the review to pre-fill (each still editable
 * before saving); null where only the user can answer. From the candle's saved session:
 * - labeled: Yes when no entry was taken, or the card was classified at the lock (before any
 *   entry); No when an entry was taken on a session without a classification.
 * - distinguished: No when a runner was planned without a confirmed expansion standing at its
 *   entry; Yes otherwise.
 * - withBias: No when an entry was logged against the bias; Yes otherwise.
 * - namedSetups: No when an entry was logged without a named setup; Yes otherwise.
 * - noPrediction: never derived.
 * - followedPlan: No when an entry has no plan or a planned one has no recorded outcome; Yes
 *   otherwise (no entry, or every planned entry ended as reported).
 * Without a session (none, or one this device cannot read) only the bias-side and setup answers
 * of a day without entries can be told, so nothing is derived.
 */
export function disciplineFromRecords(
  daySession: TradingSession | null | undefined,
): DisciplineDraft {
  if (!daySession)
    return {
      labeled: null,
      distinguished: null,
      withBias: null,
      namedSetups: null,
      noPrediction: null,
      followedPlan: null,
    };
  const log = daySession.entries ?? [];
  return {
    labeled: !log.length || !!daySession.thesis?.regime,
    distinguished: !log.some(
      (e) => e.plan?.runner && !confirmedExpansion(regimeAt(daySession, e.at)),
    ),
    withBias: !log.some((e) => e.withBias === false),
    namedSetups: !log.some((e) => !e.setup),
    noPrediction: null,
    followedPlan: !log.some((e) => !e.plan || !e.exit),
  };
}

/** Whether every discipline question is answered. */
export function disciplineAnswered(draft: DisciplineDraft): draft is Discipline {
  return DISCIPLINE_KEYS.every((k) => typeof draft[k] === 'boolean');
}

/**
 * The hard violations a discipline answer points to, in the profile's order: Traded against my
 * daily bias for a No to "Avoided all trades against my HTF bias". A serious violation, pre-selected
 * like those from the log; only when the profile lists it.
 */
export function disciplineViolations(
  profile: TradingProfile,
  discipline: Partial<DisciplineDraft>,
): string[] {
  const found = new Set<string>();
  if (discipline.withBias === false) found.add(VIOLATION_IDS.againstBias);
  return profile.violations.map((v) => v.id).filter((id) => found.has(id));
}

export type TradingReviewInput = {
  /** The candle reviewed; a correction keeps the date its review was saved on (`candleReview`). */
  date: string;
  routineId: string;
  session: 'traded' | 'no-trade' | 'away';
  /** Checklist item ID → PASS (`yes`) or FAIL (`no`). */
  answers: Record<string, 'yes' | 'no'>;
  violations: string[];
  entries: number | null;
  failedTheses: number | null;
  note: string;
  /**
   * The six discipline answers, for a session (traded or not); never for a day away. Absent, a
   * correction keeps the answers the review has, and a new review is saved without them.
   */
  discipline?: Discipline;
  /**
   * The candle's saved session, if any. Its thesis card is copied onto a reviewed session
   * and its logged entries onto a traded one; once it started, the day cannot be a day away.
   */
  daySession?: DaySession;
};

/**
 * The day's session as this device found it: the session, null when there is none, or `'unread'`
 * when it could not be read, which is never taken for a day without one.
 */
export type DaySession = TradingSession | null | 'unread';

/** The six answers alone, in order. */
function pickDiscipline(d: Discipline): Discipline {
  return Object.fromEntries(DISCIPLINE_KEYS.map((k) => [k, d[k]])) as Discipline;
}

function count(value: number | null, what: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 99)
    throw new Error(`Enter ${what} as a whole number from 0 to 99, or leave it blank.`);
  return value;
}

/**
 * Records (or corrects) a candle's trading review: one per candle. A session needs all eight items
 * answered PASS or FAIL; a planned day away needs none. Saving completes the day's trading
 * objective, which means only that the review is done, never that the rules were followed.
 * An older rule review on the same day is kept as it is.
 *
 * A correction keeps the record honest: every hard violation recorded earlier stays (new ones
 * can be added), the thesis card and entry log first copied stay as copied, and the review gets
 * `editedAt`.
 */
export function saveTradingReview(
  state: State,
  input: TradingReviewInput,
  newId: string,
  at: string,
): State {
  dateObject(input.date);
  if (input.date > localDate(new Date(at)))
    throw new Error('A review can be recorded for today or an earlier day.');
  const book = state.ruleBooks.find((b) => b.routineId === input.routineId);
  const profile = book?.trading;
  if (!book || !profile) throw new Error('Set up Trading discipline first.');
  const away = input.session === 'away';
  // The candle's review, wherever it was saved (`candleReview`): a correction edits it on its
  // date; a new one is saved on the candle's date and marked so (`ownCandle`), never over another
  // candle's review there. A correction of an earlier build's review leaves it unmarked.
  const existing = candleReview(state, input.routineId, input.date);
  const date = existing?.date ?? input.date;
  const ownCandle = existing ? existing.trading?.ownCandle : true;
  const unread = input.daySession === 'unread';
  const device =
    input.daySession && input.daySession !== 'unread' && input.daySession.date === input.date
      ? input.daySession
      : null;
  if (away && !dayAwayOffered(existing, unread ? 'unread' : device))
    throw new Error(
      existing?.outcome === 'reviewed'
        ? 'This day already has a reviewed session. Correct its answers instead; a day away cannot replace it.'
        : unread
          ? "This device could not read the day's session. A day away is only for a day without one."
          : 'A session ran on this day. Review it; a day away is only for a day without one.',
    );
  // Hard violations recorded earlier are never taken back by a correction, and on the first save
  // those the session's records point to are recorded whatever was ticked (`forcedViolations`).
  const earlier = [
    ...(existing?.outcome === 'reviewed' ? existing.violations : []),
    ...(away ? [] : forcedViolations(profile, existing, device)),
  ].filter((v, i, all) => all.indexOf(v) === i);
  if (!away) {
    const missing = profile.checklist.filter((c) => !input.answers[c.id]);
    if (missing.length)
      throw new Error(
        `Answer every item PASS or FAIL (${missing.length} left). Nothing is assumed passed.`,
      );
    if (
      input.violations.some(
        (v) => !earlier.includes(v) && !profile.violations.some((x) => x.id === v),
      )
    )
      throw new Error('A recorded violation is no longer in your list.');
    if (new Set(input.violations).size !== input.violations.length)
      throw new Error('A violation is recorded twice.');
    if (input.discipline && !disciplineAnswered(input.discipline))
      throw new Error('Answer every discipline question Yes or No.');
  }
  // The session log is copied once, from the device, and stays as first copied.
  const thesis = existing?.trading?.thesis ?? device?.thesis;
  const loggedEntries = device?.entries?.length ? device.entries : undefined;
  const entryLog = existing?.trading?.entryLog ?? loggedEntries;
  if (entryLog && input.session !== 'traded')
    throw new Error('Entries were logged in this session. Review it as Traded.');
  // Every logged entry counts: the number reported is never below the log.
  if (entryLog && input.entries !== null && input.entries < entryLog.length)
    throw new Error(
      `Entries taken cannot be below the ${entryLog.length} logged in this session. Every logged entry counts.`,
    );
  const kept = existing?.trading?.discipline;
  const discipline = away ? undefined : input.discipline ? pickDiscipline(input.discipline) : kept;
  // The candle's own objective, also when its review was saved on another date.
  const block = state.days[input.date]?.blocks.find((b) => b.routineId === input.routineId);
  // The objective links to one review; an older review that already holds it keeps it.
  const blockTaken =
    block && state.ruleReviews.some((r) => r.occurrenceId === block.id && r.id !== existing?.id);
  const review: RuleReview = {
    id: existing?.id ?? newId,
    date,
    at: existing?.at ?? at,
    routineId: input.routineId,
    occurrenceId: existing?.occurrenceId ?? (block && !blockTaken ? block.id : null),
    outcome: away ? 'none' : 'reviewed',
    answers: away
      ? []
      : profile.checklist.map((c) => ({ checkpointId: c.id, answer: input.answers[c.id] })),
    violations: away ? [] : [...earlier, ...input.violations.filter((v) => !earlier.includes(v))],
    note: input.note.trim(),
    trading: {
      session: input.session,
      // A session without trades has no entries or failed theses to report.
      entries: input.session === 'traded' ? count(input.entries, 'entries') : null,
      failedTheses: input.session === 'traded' ? count(input.failedTheses, 'failed theses') : null,
      ...(thesis && !away && { thesis }),
      ...(entryLog && { entryLog }),
      ...(discipline && { discipline }),
      ...(ownCandle && { ownCandle }),
    },
    // Never before the first save, even when the phone clock moved back since.
    ...(existing && { editedAt: at > existing.at ? at : existing.at }),
  };
  const ruleReviews = existing
    ? state.ruleReviews.map((r) => (r.id === existing.id ? review : r))
    : [...state.ruleReviews, review];
  validateRuleReviews(ruleReviews);
  let next: State = { ...state, ruleReviews };
  const day = next.days[input.date];
  if (day && block && block.status !== 'done')
    next = withDay(next, setStatus(day, block.id, 'done', at));
  return next;
}

export type DayStatus =
  | 'clean'
  | 'broken'
  | 'away'
  /** A trading day on the plan, past, with no review: never clean. */
  | 'missed'
  /** A protected day: the streak is held. */
  | 'held'
  /** Today, still to be reviewed. */
  | 'open'
  /** Reviewed with the earlier rule review, before the eight-item process. Not scored. */
  | 'older'
  /** Before the process started, with nothing recorded: nothing to score or miss. */
  | 'before'
  /** Not a trading day on the plan, or a day never opened. */
  | 'none';

export type TradingDay = { date: string; status: DayStatus; review?: RuleReview; score?: number };

/**
 * What each date was for one rulebook's trading process, from recorded data only. The reviews are
 * indexed by date and the process start found once, so a streak or a summary over months stays
 * linear. A reader reflects the `state` it was built from: build a new one after any change, never
 * keep one across changes.
 */
export function tradingDayReader(
  state: State,
  book: RuleBook,
): (date: string, today: string) => TradingDay {
  const profile = book.trading!;
  // Each candle's trading review (`reviewsByCandle`); the first older rule review per date, in
  // record order, as `find` would return it.
  const trading = reviewsByCandle(state, book.routineId);
  const older = new Map<string, RuleReview>();
  for (const r of state.ruleReviews)
    if (r.routineId === book.routineId && !isTradingReview(r) && !older.has(r.date))
      older.set(r.date, r);
  const start = processStart(state, book, trading);
  return (date, today) => {
    const review = trading.get(date);
    if (review) {
      const result = sessionResult(review, profile);
      return {
        date,
        status: result,
        review,
        score: result === 'away' ? undefined : processScore(review, profile).passed,
      };
    }
    const earlier = older.get(date);
    if (earlier) return { date, status: 'older', review: earlier };
    // Before the process started there is nothing to miss: no history is invented either way.
    if (date < start) return { date, status: 'before' };
    const day = state.days[date];
    const block = day?.blocks.find((b) => b.routineId === book.routineId && !b.optional);
    if (!block) return { date, status: 'none' };
    if (day!.protection) return { date, status: 'held' };
    if (date >= today) return { date, status: date === today ? 'open' : 'none' };
    return { date, status: 'missed' };
  };
}

export type CleanStreak = { current: number; best: number };

/** The first date the eight-item process applies: its start, or an earlier backdated review. */
function processStart(
  state: State,
  book: RuleBook,
  reviews = reviewsByCandle(state, book.routineId),
): string {
  const first = [...reviews.keys()].sort()[0];
  return first && first < book.trading!.since ? first : book.trading!.since;
}

/**
 * Consecutive clean sessions. A clean session adds one; a rule-broken session or a trading day
 * left without a review ends the run; a planned day away, a protected day, today still open and
 * days that were not trading days change nothing. Nothing before the process started counts.
 */
export function cleanStreak(state: State, book: RuleBook, today: string): CleanStreak {
  let run = 0;
  let best = 0;
  const start = processStart(state, book);
  const read = tradingDayReader(state, book);
  for (let date = start; date <= today; date = shiftDate(date, 1)) {
    const { status } = read(date, today);
    if (status === 'clean') best = Math.max(best, ++run);
    else if (status === 'broken' || status === 'missed') run = 0;
  }
  return { current: run, best };
}

export type TradingSummary = {
  days: TradingDay[];
  clean: number;
  broken: number;
  missed: number;
  away: number;
  /** Reviewed sessions (clean or rule-broken): "Rule-clean days · 6 of 8 reviewed". */
  reviewed: number;
  /** Every hard violation recorded in these days, counted one by one. */
  violationsRecorded: number;
  /** Checklist items answered FAIL, most often first (only those failed at least once). */
  failed: { item: TradingItem; count: number }[];
  /** Hard violations recorded, most often first. */
  violations: { item: TradingItem; count: number }[];
  latest: TradingDay | undefined;
};

/** The last `count` days, oldest first, with what was failed and broken most often. */
export function tradingSummary(
  state: State,
  book: RuleBook,
  today: string,
  count = 28,
): TradingSummary {
  const profile = book.trading!;
  const read = tradingDayReader(state, book);
  const days = Array.from({ length: count }, (_, i) =>
    read(shiftDate(today, i - count + 1), today),
  );
  const fails = new Map<string, number>();
  const broken = new Map<string, number>();
  for (const d of days) {
    if (!d.review || d.status === 'older' || d.status === 'away') continue;
    for (const a of d.review.answers)
      if (a.answer === 'no') fails.set(a.checkpointId, (fails.get(a.checkpointId) ?? 0) + 1);
    for (const v of d.review.violations) broken.set(v, (broken.get(v) ?? 0) + 1);
  }
  const ranked = (counts: Map<string, number>, items: TradingItem[]) =>
    [...counts.entries()]
      .map(([id, n]) => ({
        item: items.find((x) => x.id === id) ?? { id, title: 'A removed item', details: '' },
        count: n,
      }))
      .sort((a, b) => b.count - a.count || a.item.title.localeCompare(b.item.title));
  const scored = [...days].reverse().find((d) => d.status === 'clean' || d.status === 'broken');
  const clean = days.filter((d) => d.status === 'clean').length;
  const brokenDays = days.filter((d) => d.status === 'broken').length;
  return {
    days,
    clean,
    broken: brokenDays,
    reviewed: clean + brokenDays,
    violationsRecorded: [...broken.values()].reduce((sum, n) => sum + n, 0),
    missed: days.filter((d) => d.status === 'missed').length,
    away: days.filter((d) => d.status === 'away').length,
    failed: ranked(fails, profile.checklist),
    violations: ranked(broken, profile.violations),
    latest: scored,
  };
}

// A daily candle's trading session: the daily bias, the thesis card and gate answers committed at
// Start session, the entries logged, failed theses with their resets, and the end of trading. Kept
// in the saved data by candle date (`State.tradingSessions`, in backups too); the day's review
// copies what it needs from it.
// The principle: the important decisions are made before the session and locked, and every
// decision after entry is made harder, not easier.

/** The three gate answers, all Yes, as kept when the session started. */
export type GateAnswers = { acceptLoss: true; calm: true; noPressure: true; at: string };

/** What a failed thesis's reset found genuinely new: without one, there is no re-entry. */
export type WhatIsNew = 'location' | 'htf-structure' | 'gex';

/**
 * One failed thesis's reset, and the answer to "Is this genuinely a new thesis?". `answeredAt` is
 * set once it is answered (absent on resets saved before it was kept), so a No (nothing new) is
 * told apart from no answer yet.
 */
export type ThesisReset = { at: string; whatIsNew: WhatIsNew[]; answeredAt?: string };

export type TradingSession = LiveFields & {
  date: string;
  preparedAt: string | null;
  startedAt: string | null;
  failedTheses: number;
  /** When the latest reset started (wall clock), or null. */
  resetStartedAt: string | null;
  doneAt: string | null;
  doneReason: 'failed-theses' | 'hard-stop' | 'finished' | 'no-trade' | 'invalidated' | null;
  /**
   * The daily candle bias for this trading date (the candle that opens at 6 PM New York time the
   * evening before). Absent on days saved before the bias board.
   */
  bias?: DailyBias | null;
  biasAt?: string | null;
  /** The thesis card committed at Start session, locked for the candle. Absent before it. */
  thesis?: ThesisCard;
  /** The gate answers given at Start session. Absent before it. */
  gates?: GateAnswers;
  /** Entries logged on the bias board, oldest first. Absent before the first. */
  entries?: EntrySnapshot[];
  /** One per failed thesis since the reset question was kept. Absent before the first. */
  resets?: ThesisReset[];
  /** The entry and failed-thesis limits as they stood at Start session. Absent before it. */
  lockedLimits?: SessionLimits;
  /**
   * The cockpit's preflight, acknowledged with all three gate questions answered Yes, on the
   * candle's record beside the bias. Absent until then.
   */
  preflight?: Preflight;
  /** The plan typed before the lock, on the candle's record. Absent until saved. */
  prep?: SessionPrep;
  /** The risk limits and instrument as they stood at Start session. Absent before it. */
  lockedRisk?: SessionRisk;
  /**
   * The HTF candle reassessed after the lock, oldest first: each a new classification, appended
   * and never rewritten. The current one is the latest, or the card's own before the first.
   * Absent until the first reassessment.
   */
  regimeLog?: Regime[];
  /**
   * The two support checks answered Yes when the plan was locked in the 6 PM window: the 6 PM GEX
   * and the completed HTF candles support the bias. Absent on a session locked at 9:30 AM.
   */
  eveningSupport?: EveningSupport;
  /**
   * The GEX area mapped again under the 9:30 AM lock, for a session locked at 6 PM: the card keeps
   * the area it was locked with. Absent until then.
   */
  remappedGex?: GexArea;
  /**
   * The date of the device record an earlier build kept this candle's session on, east of New
   * York, when moving the sessions in placed it on its candle (`importDeviceSessions`). That
   * build saved the session's review on that date, so the review is found there
   * (`candleReview`). Only on a started session, never its own date.
   */
  movedFrom?: string;
};

/** The 6 PM window's two support checks, both Yes, as kept at an evening lock. */
export type EveningSupport = { gex: true; htf: true; at: string };

/** When the preflight was acknowledged. */
export type Preflight = { at: string };

/**
 * The cockpit's plan before the lock, saved step by step: the HTF candle's classification, then
 * why (the HTF expectation in one line) with the normal objective, the invalidation and the
 * expansion objective as prices (why, objective and invalidation together; the expansion only with
 * them), then the GEX area. Editable until the session starts; the thesis card is written from it
 * then.
 */
export type SessionPrep = {
  regime?: Regime;
  why?: string;
  objectivePrice?: number;
  invalidationPrice?: number;
  expansionPrice?: number;
  gex?: GexArea;
  updatedAt: string;
};

/**
 * The numeric risk limits per account and the instrument's point value and tick; null where not
 * set. Fixed for the candle at Start session, like the entry limits.
 */
export type SessionRisk = {
  maxContracts: number | null;
  thesisRisk: number | null;
  dailyLoss: number | null;
  pointValue: number | null;
  tick: number | null;
};

/** The limits a started session counts against, fixed for its candle at Start session. */
export type SessionLimits = { maxEntries: number; maxFailedTheses: number | null };

/** The profile's own risk limits and instrument, null where not set. */
function profileRisk(profile: TradingProfile): SessionRisk {
  return {
    maxContracts: profile.risk?.maxContracts ?? null,
    thesisRisk: profile.risk?.thesisRisk ?? null,
    dailyLoss: profile.risk?.dailyLoss ?? null,
    pointValue: profile.instrument?.pointValue ?? null,
    tick: profile.instrument?.tick ?? null,
  };
}

/**
 * The risk limits and instrument a session counts against: once it started, the stricter of each
 * limit as locked and as it stands now (a limit set is stricter than none), and the point value and
 * tick it started with. Before the start, or for a session started before risk was locked, the
 * profile's own.
 */
export function sessionRisk(session: TradingSession, profile: TradingProfile): SessionRisk {
  const current = profileRisk(profile);
  const locked = session.lockedRisk;
  if (!locked) return current;
  const lower = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.min(a, b);
  return {
    maxContracts: lower(locked.maxContracts, current.maxContracts),
    thesisRisk: lower(locked.thesisRisk, current.thesisRisk),
    dailyLoss: lower(locked.dailyLoss, current.dailyLoss),
    pointValue: locked.pointValue ?? current.pointValue,
    tick: locked.tick ?? current.tick,
  };
}

export type DailyBias = 'bullish' | 'bearish' | 'unclear';

/** A bullish or bearish bias: the only kind a session can start from. */
export function directional(bias: DailyBias | null | undefined): bias is 'bullish' | 'bearish' {
  return bias === 'bullish' || bias === 'bearish';
}

/** The side a directional bias allows: longs only when bullish, shorts only when bearish. */
export function sideOf(bias: 'bullish' | 'bearish'): 'long' | 'short' {
  return bias === 'bullish' ? 'long' : 'short';
}

/**
 * Labels the daily candle. Bullish or bearish prepares the day (a session can start); unclear
 * means no trade. The bias can change until the session starts, trading ends or the candle's day
 * is reviewed (`reviewed`), then it stays as set.
 */
export function setBias(
  session: TradingSession,
  bias: DailyBias,
  at: string,
  reviewed = false,
): TradingSession {
  if (session.bias === bias) return session;
  if (session.startedAt)
    throw new Error('The session has started: the bias stays as set until the review.');
  if (session.doneAt) throw new Error('Trading is done for today.');
  // A saved review ends trading for the candle, as End trading does.
  if (reviewed) throw new Error('The day is reviewed: the bias stays as set.');
  return {
    ...session,
    bias,
    biasAt: at,
    preparedAt: directional(bias) ? (session.preparedAt ?? at) : null,
  };
}

export function newSession(date: string): TradingSession {
  return {
    date,
    preparedAt: null,
    startedAt: null,
    failedTheses: 0,
    resetStartedAt: null,
    doneAt: null,
    doneReason: null,
  };
}

const iso = (v: unknown) => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

const WHAT_IS_NEW_IDS: WhatIsNew[] = ['location', 'htf-structure', 'gex'];

/** Whether a saved value passes a record check, for a session that is read, never thrown on. */
function valid(check: () => void): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

function validGates(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const g = v as Record<string, unknown>;
  return (
    Object.keys(g).length === 4 &&
    g.acceptLoss === true &&
    g.calm === true &&
    g.noPressure === true &&
    isTimestamp(g.at)
  );
}

function validLimits(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const { maxEntries, maxFailedTheses, ...rest } = v as Record<string, unknown>;
  const whole = (n: unknown, max: number) =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  return (
    !Object.keys(rest).length &&
    whole(maxEntries, MAX_ENTRIES) &&
    (maxFailedTheses === null || whole(maxFailedTheses, 20))
  );
}

/** The keys of a saved record are exactly these (optional ones may be absent). */
function keysWithin(v: Record<string, unknown>, keys: string[], required: string[]): boolean {
  return Object.keys(v).every((k) => keys.includes(k)) && required.every((k) => v[k] !== undefined);
}

function validPreflight(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return keysWithin(p, ['at'], ['at']) && isTimestamp(p.at);
}

function validPrep(v: unknown, date: string): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  const keys = [
    'regime',
    'why',
    'objectivePrice',
    'invalidationPrice',
    'expansionPrice',
    'gex',
    'updatedAt',
  ];
  if (!keysWithin(p, keys, ['updatedAt']) || !isTimestamp(p.updatedAt)) return false;
  if (p.regime !== undefined && !valid(() => validateRegime(p.regime))) return false;
  // The why, objective and invalidation are saved together; the expansion and the GEX area after.
  const objectives = [p.why, p.objectivePrice, p.invalidationPrice].filter((x) => x !== undefined);
  if (objectives.length === 0) return p.expansionPrice === undefined && p.gex === undefined;
  return (
    objectives.length === 3 &&
    valid(() => thesisLine(p.why, 'why')) &&
    valid(() => positive(p.objectivePrice, 'objective')) &&
    valid(() => positive(p.invalidationPrice, 'invalidation')) &&
    p.objectivePrice !== p.invalidationPrice &&
    // The expansion lies beyond the normal objective, on the side away from the invalidation.
    (p.expansionPrice === undefined ||
      (valid(() => positive(p.expansionPrice, 'expansion')) &&
        inOrder((p.objectivePrice as number) > (p.invalidationPrice as number) ? 'long' : 'short', [
          p.invalidationPrice as number,
          p.objectivePrice as number,
          p.expansionPrice as number,
        ]))) &&
    // A GEX area is mapped for the candle whose record keeps it.
    (p.gex === undefined ||
      (valid(() => validateGexArea(p.gex)) && (p.gex as GexArea).candle === date))
  );
}

/** The most reassessments kept for one session. */
export const MAX_REGIME_LOG = 50;

function validRegimeLog(v: unknown): boolean {
  if (!Array.isArray(v) || !v.length || v.length > MAX_REGIME_LOG) return false;
  return v.every(
    (r: unknown, i) =>
      valid(() => validateRegime(r)) && (i === 0 || (r as Regime).at >= (v[i - 1] as Regime).at),
  );
}

function validSupport(v: unknown, startedAt: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof startedAt !== 'string')
    return false;
  const p = v as Record<string, unknown>;
  return (
    keysWithin(p, ['gex', 'htf', 'at'], ['gex', 'htf', 'at']) &&
    p.gex === true &&
    p.htf === true &&
    isTimestamp(p.at) &&
    // Kept only by a lock in the 6 PM window.
    liveWindow(Date.parse(startedAt)) === 'evening'
  );
}

/** A re-mapped area is the 9:30 AM lock's, for the candle of a card locked under the 6 PM lock. */
function validRemap(v: unknown, card: ThesisCard | undefined): boolean {
  const locked = card?.gex;
  return (
    !!locked &&
    locked.lock === 'evening' &&
    valid(() => validateGexArea(v)) &&
    (v as GexArea).lock === 'morning' &&
    (v as GexArea).candle === locked.candle
  );
}

function validRisk(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const keys = ['maxContracts', 'thesisRisk', 'dailyLoss', 'pointValue', 'tick'];
  return (
    keysWithin(r, keys, keys) &&
    (r.maxContracts === null ||
      (Number.isInteger(r.maxContracts) &&
        (r.maxContracts as number) >= 1 &&
        (r.maxContracts as number) <= MAX_CONTRACTS)) &&
    ['thesisRisk', 'dailyLoss', 'pointValue', 'tick'].every((k) =>
      valid(() => positive(r[k], k, true)),
    )
  );
}

function validResets(v: unknown, failedTheses: number): boolean {
  if (!Array.isArray(v) || v.length > failedTheses) return false;
  return v.every((r: unknown) => {
    if (!r || typeof r !== 'object') return false;
    const { at, whatIsNew, answeredAt } = r as Record<string, unknown>;
    return (
      isTimestamp(at) &&
      (answeredAt === undefined || isTimestamp(answeredAt)) &&
      Array.isArray(whatIsNew) &&
      new Set(whatIsNew).size === whatIsNew.length &&
      whatIsNew.every((w) => WHAT_IS_NEW_IDS.includes(w as WhatIsNew))
    );
  });
}

/**
 * A saved session read back, or null when it is not one (never trusted blindly). Days saved by
 * earlier builds, without the bias, thesis card, gates, entries, resets, locked limits, preflight,
 * plan, locked risk, evening support or re-mapped GEX area, stay valid. An earlier build reads a day saved with those as it always did:
 * it ignores the session keys, card keys and entry keys it does not know and keeps them.
 */
export function decodeTradingSession(raw: unknown): TradingSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  try {
    dateObject(s.date as string);
  } catch {
    return null;
  }
  if (!iso(s.preparedAt) || !iso(s.startedAt) || !iso(s.resetStartedAt) || !iso(s.doneAt))
    return null;
  if (!Number.isInteger(s.failedTheses) || (s.failedTheses as number) < 0) return null;
  if (
    ![null, 'failed-theses', 'hard-stop', 'finished', 'no-trade', 'invalidated'].includes(
      s.doneReason as string | null,
    )
  )
    return null;
  if (![undefined, null, 'bullish', 'bearish', 'unclear'].includes(s.bias as string)) return null;
  if (s.biasAt !== undefined && !iso(s.biasAt)) return null;
  // The thesis card and the gates are kept together, and only once the session started.
  if ((s.thesis === undefined) !== (s.gates === undefined)) return null;
  if (
    s.thesis !== undefined &&
    (!s.startedAt || !valid(() => validateThesisCard(s.thesis)) || !validGates(s.gates))
  )
    return null;
  if (s.entries !== undefined && (!s.startedAt || !valid(() => validateEntryLog(s.entries))))
    return null;
  if (s.resets !== undefined && !validResets(s.resets, s.failedTheses as number)) return null;
  if (s.lockedLimits !== undefined && (!s.startedAt || !validLimits(s.lockedLimits))) return null;
  // The preflight and the plan are kept from before the start; the locked risk only once started.
  if (s.preflight !== undefined && !validPreflight(s.preflight)) return null;
  if (s.prep !== undefined && !validPrep(s.prep, s.date as string)) return null;
  if (s.lockedRisk !== undefined && (!s.startedAt || !validRisk(s.lockedRisk))) return null;
  // Reassessments come only after the lock, onto the card that was classified at it.
  if (
    s.regimeLog !== undefined &&
    (!s.startedAt || !(s.thesis as ThesisCard | undefined)?.regime || !validRegimeLog(s.regimeLog))
  )
    return null;
  // The evening's support checks and a re-mapped GEX area come only with a started session.
  if (s.eveningSupport !== undefined && !validSupport(s.eveningSupport, s.startedAt)) return null;
  if (
    s.remappedGex !== undefined &&
    (!s.startedAt || !validRemap(s.remappedGex, s.thesis as ThesisCard | undefined))
  )
    return null;
  if (
    s.movedFrom !== undefined &&
    (!s.startedAt || s.movedFrom === s.date || !valid(() => dateObject(s.movedFrom as string)))
  )
    return null;
  // The live cockpit's fields: the plan, the lock, theses, attempts and what holds entries.
  if (!validLiveFields(s, s.startedAt)) return null;
  // A `plans` list saved by earlier builds is dropped; the rest of the day is kept.
  const rest = { ...s };
  delete rest.plans;
  return rest as TradingSession;
}

/** Trading is over for the day: a hard stop (a hard limit reached) or simply finished. */
export function endTrading(
  session: TradingSession,
  reason: 'hard-stop' | 'finished',
  at: string,
): TradingSession {
  return session.doneAt ? session : { ...session, doneAt: at, doneReason: reason };
}

/** The live window valid now, the current candle's 6 PM or 9:30 AM lock, or null between them. */
export function liveWindow(now: number): GexLockId | null {
  return gexWindow(now).valid?.id ?? null;
}

// Cool-down: after a hard violation the next candle is study only. Derived from the reviews and
// the saved sessions each time, by candle date, never from the schedule, and never stored.

export type StudyOnlyDay = {
  /** The latest date since the previous candle whose review recorded a hard violation. */
  after: string;
};

/** Said after a rule-broken review with a hard violation that makes the next trading day study only. */
export const NEXT_DAY_STUDY_LINE = 'The next trading day is study only.';

/** Whether a date is on the trading routine's schedule: a trading day. */
export function onTradingSchedule(state: State, book: RuleBook, date: string): boolean {
  const routine = routineOf(state, book.routineId);
  return !!routine && onItsDays(routine, date);
}

/** Whether a date's trading review is a reviewed session with at least one hard violation. */
function violatedOn(state: State, book: RuleBook, date: string): boolean {
  const review = candleReview(state, book.routineId, date);
  return review?.outcome === 'reviewed' && review.violations.length > 0;
}

/**
 * Whether a candle is study only: a review with at least one hard violation for the previous
 * candle (the weekday before, Friday's for Monday) or for any date after it and before this candle
 * (a weekend review included), each review read as the candle it is for (`reviewsByCandle`). The
 * schedule plays no part, so adding or removing a day from it never drops the cool-down; a
 * protected day does not either. `after` is the latest such candle.
 */
export function studyOnlyDay(state: State, book: RuleBook, candle: string): StudyOnlyDay | null {
  const from = previousCandle(candle);
  let after: string | null = null;
  for (const [of, r] of reviewsByCandle(state, book.routineId)) {
    if (r.outcome !== 'reviewed' || !r.violations.length) continue;
    if (of >= from && of < candle && (!after || of > after)) after = of;
  }
  return after ? { after } : null;
}

/** Whether `date`'s review makes the next candle study only: it recorded a hard violation. */
export function nextDayStudyOnly(state: State, book: RuleBook, date: string): boolean {
  return violatedOn(state, book, date);
}

/** Whether a saved session ran: it started, or a trade was logged on it. */
export function sessionRan(session: TradingSession): boolean {
  return !!session.startedAt || !!session.entries?.length || !!session.attempts?.length;
}

/**
 * The latest earlier candle whose session ran (`sessionRan`) when it still has no review, or null.
 * A new session waits for that review, so leaving a session unreviewed never keeps the next one
 * open. Read from the saved sessions by candle date, never the schedule: protecting a day or
 * changing the schedule does not skip it.
 */
export function unreviewedTradingDay(state: State, book: RuleBook, candle: string): string | null {
  let latest: string | null = null;
  // Nothing before the process started is ever asked for.
  const since = book.trading?.since ?? '';
  for (const [date, session] of Object.entries(state.tradingSessions))
    if (date < candle && date >= since && (!latest || date > latest) && sessionRan(session))
      latest = date;
  return latest && !candleReview(state, book.routineId, latest) ? latest : null;
}

/** Shown on the thesis card when no add location was planned. */
export const NO_ADD_LINE = 'No add planned: no adds today';

/**
 * The phone's calendar date a candle's 9:30 AM window opens on, never before the candle's own: on
 * a US phone the candle's date, east of New York (where the window opens after midnight) the next
 * date. Earlier builds kept a candle's session on that date's device record; moving those records
 * in reads them by it (`importDeviceSessions`). Sessions are now kept by candle date only.
 */
export function sessionDateOf(candle: string): string {
  const opens = localDate(new Date(gexLocks(candle)[1].start));
  return opens > candle ? opens : candle;
}

/** The classification that stood at `at` on a started session (the card's before any later one). */
export function regimeAt(session: TradingSession, at: string): Regime | null {
  const later = (session.regimeLog ?? []).filter((r) => r.at <= at);
  return later.at(-1) ?? session.thesis?.regime ?? null;
}

/** A dollar amount to the cent, so amounts compare as written ($150 is never $150.0000001). */
function cents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}

/**
 * Dollars a planned entry risks per account: the stop distance in whole ticks (when the tick is
 * known) times the tick, the point value and the contracts, to the cent. Counted this way a plan
 * at a limit is at it wherever the price sits, never a fraction of a cent above it.
 */
export function planRisk(
  plan: Pick<EntryPlan, 'entry' | 'stop' | 'contracts'>,
  pointValue: number,
  tick: number | null,
): number {
  const points = Math.abs(plan.entry - plan.stop);
  const distance = tick ? Math.round(points / tick) * tick : points;
  return cents(distance * pointValue * plan.contracts);
}

/**
 * The planned risk of today's entries reported stopped out, per account: the whole entry for a
 * stop-out, and the runner's contracts for a runner stopped at the original stop (one moved to
 * breakeven risks none). An estimate from the user's reports only.
 */
export function stoppedRisk(
  session: TradingSession,
  pointValue: number,
  tick: number | null,
): number {
  const total = (session.entries ?? []).reduce((sum, e) => {
    if (!e.plan) return sum;
    if (e.exit?.kind === 'stopped') return sum + planRisk(e.plan, pointValue, tick);
    if (e.exit?.kind === 'runner-stopped' && e.plan.runner?.stopPlan === 'original')
      return sum + planRisk({ ...e.plan, contracts: e.plan.runner.contracts }, pointValue, tick);
    return sum;
  }, 0);
  return cents(total);
}

// The review against the session log.

/**
 * Planned day away is offered only while no reviewed session exists and no session started: never
 * while the day's session cannot be read, since one may have started.
 */
export function dayAwayOffered(
  existing: RuleReview | undefined,
  daySession: DaySession | undefined,
): boolean {
  if (daySession === 'unread') return false;
  return existing?.outcome !== 'reviewed' && !daySession?.startedAt;
}

/**
 * Whether an entry was taken at night, New York time (6 PM to 6 AM). Outside its session's live
 * windows (never an entry in the 6 PM window of a session locked there with its support checks),
 * the review reads it as nighttime recovery trading.
 */
function atNight(at: string): boolean {
  const { minutes } = nyTime(Date.parse(at));
  return minutes >= 18 * 60 || minutes < 6 * 60;
}

/** The ways trading ends that are a hard stop: a hard limit, or the failed-thesis limit, reached. */
const HARD_STOPS: TradingSession['doneReason'][] = ['hard-stop', 'failed-theses'];

/**
 * Hard violations the review pre-selects "from today's session log", in the profile's order:
 * Added at a location not planned for an unplanned add; Revenge re-entry for an entry during a reset or after
 * one with nothing genuinely new; Traded after the hard stop for an entry after trading ended on a
 * hard stop (never after Finished or an invalidated thesis, which are none); Came back for
 * nighttime recovery trading for an entry outside its session's live windows between 6 PM and
 * 6 AM New York (another hour outside them points to none, and an entry in the 6 PM window of a
 * session locked there is inside one); Traded against my daily bias for an entry said
 * to be against it; No clear invalidation for one without it; Entered without a named setup for
 * one logged without a setup (every entry not taken on the cockpit); and Exceeded the thesis risk
 * or the daily loss limit for planned risk above the session's limits (`sessionRisk`), the daily
 * one counted from the stops reported. The live cockpit's attempts point to theirs too
 * (`liveViolations`). There is no day-wide entry limit. Only violations the profile lists under
 * those IDs; on a review's first save none of them can be unticked (`forcedViolations`).
 */
export function violationsFromLog(
  profile: TradingProfile,
  daySession: TradingSession | null | undefined,
): string[] {
  const log = daySession?.entries ?? [];
  const outside = (e: EntrySnapshot, ...rules: OutsideRule[]) =>
    !!e.outsideRules?.some((r) => rules.includes(r));
  const found = new Set<string>();
  if (log.some((e) => e.unplanned)) found.add(VIOLATION_IDS.unplannedAdd);
  if (log.some((e) => outside(e, 'reset', 'nothing-new'))) found.add(VIOLATION_IDS.revenge);
  if (HARD_STOPS.includes(daySession?.doneReason ?? null) && log.some((e) => outside(e, 'done')))
    found.add(VIOLATION_IDS.afterHardStop);
  if (log.some((e) => outside(e, 'window') && atNight(e.at)))
    found.add(VIOLATION_IDS.nightRecovery);
  if (log.some((e) => e.withBias === false)) found.add(VIOLATION_IDS.againstBias);
  if (log.some((e) => !e.invalidation)) found.add(VIOLATION_IDS.noInvalidation);
  if (log.some((e) => !e.setup)) found.add(VIOLATION_IDS.noNamedSetup);
  // A planned risk above the session's limits: no entry the risk check passed has one.
  const risk = daySession ? sessionRisk(daySession, profile) : null;
  if (risk?.pointValue) {
    const over = (limit: number | null, dollars: number) => limit !== null && dollars > limit;
    if (
      log.some(
        (e) => e.plan && over(risk.thesisRisk, planRisk(e.plan, risk.pointValue!, risk.tick)),
      )
    )
      found.add(VIOLATION_IDS.overThesisRisk);
    if (over(risk.dailyLoss, stoppedRisk(daySession!, risk.pointValue, risk.tick)))
      found.add(VIOLATION_IDS.overDailyLoss);
  }
  // The live cockpit's attempts point to theirs the same way.
  if (daySession) for (const key of liveViolations(daySession)) found.add(VIOLATION_IDS[key]);
  return profile.violations.map((v) => v.id).filter((id) => found.has(id));
}

/**
 * The hard violations a review records whatever is ticked: those the session's records point to
 * (`violationsFromLog`), on the review's first save only. A correction keeps the violations saved
 * with it, so a review saved earlier, by an earlier build too, never turns rule-broken from records
 * it was not judged on: history is never rewritten automatically.
 */
export function forcedViolations(
  profile: TradingProfile,
  existing: RuleReview | undefined,
  daySession: TradingSession | null | undefined,
): string[] {
  return existing?.outcome === 'reviewed' ? [] : violationsFromLog(profile, daySession);
}

/** "Review edited Fri, Oct 16, 9:40 PM" in the phone's time, or null for a review never edited. */
export function reviewEditedText(review: RuleReview): string | null {
  if (!review.editedAt) return null;
  const d = new Date(review.editedAt);
  return `Review edited ${displayDate(localDate(d))}, ${displayTime(d.getHours() * 60 + d.getMinutes())}`;
}
