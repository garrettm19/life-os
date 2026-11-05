import {
  GexLockId,
  candleDate,
  gexLocks,
  nextCandle,
  nyClockText,
  nyInstant,
  nyTime,
  previousCandle,
} from './market-clock';
import { RuleBook, State, TradingProfile, displayDate, accountSetPause, localDate } from './model';
import { MAX_CONTRACTS } from './records';
import {
  StudyOnlyDay,
  TradingSession,
  candleReview,
  directional,
  endForAccountSet,
  accountSetPauseLine,
  gateSessions,
  newSession,
  saveTradingProfile,
  setBias,
  sideOf,
  studyOnlyDay,
  tradingPaused,
  unreviewedTradingDay,
} from './trading';
import {
  Assessment,
  Attempt,
  AttemptExit,
  AttemptExitKind,
  Cooldown,
  FINAL_STATUSES,
  LiveEvent,
  LiveEventKind,
  LiveLimits,
  LockedLimits,
  LossTotal,
  MAX_LIVE_RECORDS,
  ObservedKind,
  ObservedRegime,
  PlanEvent,
  SessionCaps,
  SessionStop,
  StopCause,
  StopReason,
  TRANSITIONS,
  Thesis,
  ThesisStatus,
  TradingPlan,
  WHERE_MAX,
  EXCEPTION_MAX,
  attemptLoss,
  capReached,
  dailyLossTotalOf,
  failedAttempt,
  lineKey,
  loggedOutside,
  lossOf,
  normalWhere,
  thesisStatus,
  unknownExposure,
  validTime,
  whereText,
} from './trading-live-model';
import { dollarText, priceProblem, priceText, thesisPriceProblem } from './trading-prices';
import {
  DEFAULT_COOLDOWN_MINUTES,
  MONEY_NO_LINE,
  effectiveSettings,
  practiceGateProblem,
  stricterCaps,
} from './trading-safeguards';
import { UNREADABLE_LINE, putTradingSession, sessionUnreadable } from './trading-sessions';

// The live cockpit's rules: the plan, the session's start and the limits it locks, cooldowns,
// session stops, theses and their attempts, the line (area) status and the size a stop allows.
// Every function here reads only stored records and the clock; every write goes through
// `putTradingSession`, so a restriction lives in the saved data, never in a screen. They are
// app-level restrictions on what the cockpit records, not a broker lockout: Life OS sees no
// market, account or order, and every price, fill and loss is the user's own report.

/** Attempts on one thesis when the profile sets none. */
export const DEFAULT_ATTEMPTS = 2;
/** The I FEEL RUSHED cooldown when the profile sets none, and its range. */
export { DEFAULT_COOLDOWN_MINUTES };
export const COOLDOWN_MINUTES = { min: 20, max: 60 };
/** Changes to the setup reading within this long replace the last one instead of adding one. */
const MERGE_MS = 10_000;
const MINUTE = 60_000;

/** Said wherever a limit holds entries: what the app restricts and what it cannot. */
export const APP_LEVEL_LINE =
  'An app-level restriction, not a broker lockout: Life OS cannot see or stop your orders.';
/** Said with every live total. */
export const NOT_VERIFIED_LINE = 'Planned · self-reported · not broker-verified';
/** Said after a failed attempt, once. */
export const CHART_LINE = 'Mark it on your chart too.';
/** Said while live trading is off. */
export const LIVE_OFF_LINE = 'Live trading is off.';
/** Said in a session started live once live trading is off: it applies from the next session. */
export const LIVE_OFF_NEXT_LINE = 'Live trading is off from the next session.';
/** Said on a thesis exhausted at one area. */
export const RANGE_NOTE =
  'Two failed attempts near the same area. Possible range conditions. Thesis exhausted.';

// The profile's settings.

/**
 * Whether live trading is on: only once turned on deliberately, with the money question answered
 * Yes (`moneySetAsideOn`) after its clean practice sessions. A profile an earlier build turned on
 * without them reads as off until it is turned on again here.
 */
export function liveTradingOn(profile: TradingProfile): boolean {
  return profile.liveTrading === true && profile.moneySetAsideOn !== undefined;
}

/**
 * Whether live trading is on through the live-account path: its confirmation was given with the
 * money answer that turned it on (`setLiveTrading` keeps both dates together).
 */
export function liveByExistingAccount(profile: TradingProfile): boolean {
  return liveTradingOn(profile) && profile.existingAccountOn === profile.moneySetAsideOn;
}

/** The checklist line in Your limits before live trading: the broker's own brake comes first. */
export const BEFORE_LIVE_LINE =
  "Before you trade live: set the broker's own daily loss limit, and its lock where offered, no looser than these limits. They can stop an order; Life OS cannot.";

/** Said while a profile an earlier build turned live has no money answer (`liveTradingOn`). */
export const LIVE_ASK_LINE =
  'Live trading was turned on before its practice and money checks: turn it on again in Your limits.';

/** Accounts each execution is copied to (1 when not set). */
export function accountsOf(profile: TradingProfile): number {
  return profile.accounts ?? 1;
}

/** Minutes of the I FEEL RUSHED cooldown (25 when not set). */
export function cooldownMinutesOf(profile: TradingProfile): number {
  return profile.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
}

/** Attempts allowed on one thesis (2 when not set). */
export function attemptsOf(profile: TradingProfile): number {
  return Math.min(profile.attemptsPerThesis ?? DEFAULT_ATTEMPTS, DEFAULT_ATTEMPTS);
}

/**
 * The limits a session on `candle` would lock now, from the profile as it holds on that candle (a
 * raise saved on it waits for the next candle, `effectiveSettings`), with what is missing: risk
 * per trade, thesis risk, the daily loss limit, the contract limit and the instrument are
 * required; costs are optional (risk is then shown without them). The session caps (entries,
 * losses in a row, the total across accounts) always have a value.
 */
export function profileLimits(
  profile: TradingProfile,
  candle: string,
): {
  limits: LiveLimits | null;
  missing: string[];
} {
  const r = effectiveSettings(profile, candle);
  const missing = [
    r.tradeRisk === null && 'risk per trade',
    r.thesisRisk === null && 'thesis risk',
    r.dailyLoss === null && 'daily loss limit',
    r.maxContracts === null && 'contract limit',
    !profile.instrument && 'instrument',
  ].filter((m): m is string => !!m);
  if (missing.length) return { limits: null, missing };
  return {
    missing,
    limits: {
      tradeRisk: r.tradeRisk!,
      thesisRisk: r.thesisRisk!,
      dailyLoss: r.dailyLoss!,
      maxContracts: r.maxContracts!,
      pointValue: profile.instrument!.pointValue,
      tick: profile.instrument!.tick,
      accounts: r.accounts,
      commission: profile.costs?.commission ?? null,
      slippageTicks: profile.costs?.slippageTicks ?? null,
      attemptsPerThesis: attemptsOf(profile),
      cooldownMinutes: r.cooldownMinutes,
      resetMinutes: profile.reset.minutes,
      maxEntries: r.maxEntries,
      maxLossRun: r.maxLossRun,
      dailyLossTotal: r.dailyLossTotal,
    },
  };
}

/** The limits as stored on the lock: everything but the session caps. */
function lockedPart(limits: LiveLimits): LockedLimits {
  const { maxEntries: _e, maxLossRun: _r, dailyLossTotal: _t, ...locked } = limits;
  return locked;
}

/**
 * The session caps a session counts against: the stricter of each as locked at its start
 * (`lockedCaps`) and as it holds now on its candle; the profile's own before the start, or for a
 * session started before the caps were locked. They never depend on the other limits being set.
 */
export function sessionCaps(session: TradingSession, profile: TradingProfile): SessionCaps {
  const { maxEntries, maxLossRun, dailyLossTotal } = effectiveSettings(profile, session.date);
  const own = { maxEntries, maxLossRun, dailyLossTotal };
  return session.lockedCaps ? stricterCaps(session.lockedCaps, own) : own;
}

/**
 * The limits a session counts against: once it started, the stricter of each as locked and as set
 * now (a limit raised mid-session applies from the next session, one lowered applies at once; a
 * longer cooldown applies at once), with the session caps (`sessionCaps`). Before the start, the
 * profile's own, or null while any is missing.
 */
export function liveLimits(session: TradingSession, profile: TradingProfile): LiveLimits | null {
  const own = profileLimits(profile, session.date).limits;
  const locked = session.lock?.limits;
  if (!locked) return own;
  const caps = sessionCaps(session, profile);
  if (!own) return { ...locked, ...caps };
  return {
    ...locked,
    tradeRisk: Math.min(locked.tradeRisk, own.tradeRisk),
    thesisRisk: Math.min(locked.thesisRisk, own.thesisRisk),
    dailyLoss: Math.min(locked.dailyLoss, own.dailyLoss),
    maxContracts: Math.min(locked.maxContracts, own.maxContracts),
    attemptsPerThesis: Math.min(locked.attemptsPerThesis, own.attemptsPerThesis),
    cooldownMinutes: Math.max(locked.cooldownMinutes, own.cooldownMinutes),
    resetMinutes: Math.max(locked.resetMinutes, own.resetMinutes),
    ...caps,
  };
}

// What a status is read from.

/**
 * Everything the cockpit's status is read from at an instant: the current candle's session (a new
 * one when none is saved), the previous candle's (its stop, cooldown or open position carries
 * over), an older one still holding a trade (open, or closed with its loss unknown), the profile,
 * the pauses, a study-only day, a candle still to be reviewed, whether this candle is reviewed,
 * and whether either record could not be read.
 */
export type LiveContext = {
  now: number;
  candle: string;
  session: TradingSession;
  previous: TradingSession | null;
  /** The latest session before the previous candle with a trade open or a loss unknown. */
  older: TradingSession | null;
  profile: TradingProfile;
  routineId: string;
  /** The trading objective is paused in Programs. */
  paused: boolean;
  /** The date live trading resumes after a lost account set, or null. */
  pausedUntil: string | null;
  studyOnly: StudyOnlyDay | null;
  /** The latest earlier candle whose session ran and has no review yet, or null. */
  unreviewed: string | null;
  reviewed: boolean;
  unreadable: boolean;
};

/** Whether a session still holds a trade: one open, or one closed with its loss unknown. */
function holdsTrade(s: TradingSession): boolean {
  return !!s.attempts?.some((a) => !a.exit || attemptLoss(a).amount === null);
}

/** The latest session before `before` that still holds a trade (`holdsTrade`), or null. */
function olderHolding(state: State, before: string): TradingSession | null {
  let latest: string | null = null;
  for (const [date, s] of Object.entries(state.tradingSessions))
    if (date < before && (!latest || date > latest) && holdsTrade(s)) latest = date;
  return latest ? state.tradingSessions[latest] : null;
}

/** The live context of a trading rulebook at an instant (`now`, ms). */
export function liveContext(state: State, book: RuleBook, now: number): LiveContext {
  const candle = candleDate(now);
  const prior = previousCandle(candle);
  const profile = book.trading!;
  return {
    now,
    candle,
    session: state.tradingSessions[candle] ?? newSession(candle),
    previous: state.tradingSessions[prior] ?? null,
    older: olderHolding(state, prior),
    profile,
    routineId: book.routineId,
    paused: tradingPaused(state, book),
    pausedUntil: accountSetPause(profile, localDate(new Date(now))),
    studyOnly: studyOnlyDay(state, book, candle),
    unreviewed: unreviewedTradingDay(state, book, candle),
    reviewed: !!candleReview(state, book.routineId, candle),
    unreadable: sessionUnreadable(state, candle) || sessionUnreadable(state, prior),
  };
}

/** A plan's major event as an instant: its New York time on the candle's date, DST included. */
export function eventInstant(candle: string, time: string): number {
  const [h, m] = time.split(':').map(Number);
  return nyInstant(candle, h * 60 + m);
}

/** "FOMC at 2:00 PM New York". */
export function eventText(event: PlanEvent, candle: string): string {
  return `${event.name} at ${nyClockText(eventInstant(candle, event.time))} New York`;
}

/**
 * Why the session is practice only, or none: live trading off, a lost account set, a pause in
 * Programs, a study-only day, a major event on the candle, or a session started as practice.
 * Practice ignores the live windows; every other rule applies. The switch applies from the next
 * session, off as on: a session started live stays live to the end of its candle when live trading
 * is turned off or a restore leaves it off, since its trades are real at the broker.
 */
export function practiceReasons(ctx: LiveContext): string[] {
  const why: string[] = [];
  if (!liveTradingOn(ctx.profile) && ctx.session.lock?.mode !== 'live')
    why.push(ctx.profile.liveTrading === true ? LIVE_ASK_LINE : LIVE_OFF_LINE);
  if (ctx.pausedUntil) why.push(accountSetPauseLine(ctx.pausedUntil));
  if (ctx.paused) why.push('Trading is paused in Programs.');
  if (ctx.studyOnly)
    why.push(`Study-only day after a hard violation on ${displayDate(ctx.studyOnly.after)}.`);
  const event = ctx.session.plan?.event;
  if (event) why.push(`Major event today: ${eventText(event, ctx.candle)}. No live trading.`);
  if (!why.length && ctx.session.lock?.mode === 'practice')
    why.push('This session started as practice.');
  return why;
}

// Session stops and cooldowns, carried across the candle boundary.

/** When a stop on `candle` ends: the next candle's 9:30 AM window when hard, else its 6 PM open. */
export function stopUntil(candle: string, hard: boolean): number {
  return gexLocks(nextCandle(candle))[hard ? 1 : 0].start;
}

/**
 * A stop holding now: its candle, reason and end, what caused a hard stop when recorded, and for a
 * trade logged outside the checks, how it was outside them (`loggedStopWords`).
 */
export type ActiveStop = {
  candle: string;
  reason: StopReason;
  until: number;
  cause?: StopCause;
  words?: string;
};

/** A record's stop, its own or the end of trading an earlier build saved. */
function stopOf(s: TradingSession): Omit<ActiveStop, 'candle'> | null {
  if (s.sessionStop)
    return {
      reason: s.sessionStop.reason,
      until: Date.parse(s.sessionStop.until),
      ...(s.stopCause && { cause: s.stopCause }),
    };
  if (!s.doneAt) return null;
  const hard = s.doneReason === 'hard-stop' || s.doneReason === 'failed-theses';
  const invalidated = s.doneReason === 'invalidated';
  return {
    reason: invalidated
      ? 'invalidated'
      : hard
        ? 'hard-stop'
        : s.doneReason === 'no-trade'
          ? 'no-trade'
          : 'finished',
    until: stopUntil(s.date, hard || invalidated),
  };
}

/**
 * A record's stop with its session caps read too: a cap reached (`capReached`) holds as a hard
 * stop even before one is saved (a cap cut during the session, for one), and a finish is raised
 * to it.
 */
function heldStop(s: TradingSession, profile: TradingProfile): Omit<ActiveStop, 'candle'> | null {
  const own = stopOf(s);
  if (own?.cause === 'logged-trade') return { ...own, words: loggedStopWords(s, profile) };
  if (own && own.reason !== 'finished') return own;
  const cause = capReached(s.attempts ?? [], sessionCaps(s, profile));
  return cause ? { reason: 'hard-stop', until: stopUntil(s.date, true), cause } : own;
}

/**
 * The stop holding the session now, or null: this candle's, the previous candle's while it lasts
 * (a hard stop holds the next candle's 6 PM window too), a session cap reached on either, or this
 * candle's saved review. Nothing on a new record, a changed bias, a new thesis or a restore of the
 * same data lifts it.
 */
export function activeStop(ctx: LiveContext): ActiveStop | null {
  for (const s of [ctx.session, ctx.previous]) {
    const stop = s && heldStop(s, ctx.profile);
    if (stop && ctx.now < stop.until) return { ...stop, candle: s!.date };
  }
  if (ctx.reviewed)
    return { candle: ctx.candle, reason: 'reviewed', until: stopUntil(ctx.candle, false) };
  return null;
}

const STOP_WORDS: Record<ActiveStop['reason'], string> = {
  'daily-loss': 'The daily loss limit is reached.',
  'hard-stop': 'A hard stop ended the session.',
  invalidated: 'The HTF thesis is invalidated.',
  finished: 'The session is finished.',
  'no-trade': 'No trade today.',
  reviewed: 'The day is reviewed.',
};

const CAUSE_WORDS: Record<StopCause, string> = {
  'entry-cap': 'The entry cap for this session is reached.',
  'loss-run': 'The losses in a row that end the session are reached.',
  'logged-trade': 'A trade was logged outside the checks.',
};

/** A stop's entry in the session's log: "hard-stop: logged-trade", or the reason alone. */
function stopDetail(reason: SessionStop['reason'], cause?: StopCause): string {
  return cause ? `${reason}: ${cause}` : reason;
}

/**
 * The trade logged outside the checks that ended the session: the taken one whose log entry comes
 * just before the stop's own (`logTakenAttempt` logs the trade, then the stop), counted back from
 * the newest, since the log drops its oldest entries first. Undefined once the log no longer holds
 * that stop.
 */
function stoppingTrade(s: TradingSession): Attempt | undefined {
  const log = s.log ?? [];
  const detail = stopDetail('hard-stop', 'logged-trade');
  const i = log.findIndex((e) => e.kind === 'stop' && e.detail === detail);
  if (i < 0) return undefined;
  const later = log.slice(i + 1).filter((e) => e.kind === 'taken').length;
  const taken = (s.attempts ?? []).filter((a) => a.taken);
  return taken[taken.length - 1 - later];
}

/**
 * What the trade that ended the session did (`stoppingTrade`, never an earlier one judged by a
 * limit cut since): logged during a cooldown, after the session ended or while entries were
 * otherwise held, with its risk unknown, or above the risk per trade (`loggedOutside`). Without
 * that trade in the records, or when its risk is within the limits as they stand now (they were
 * raised back since), the plain cause. Plain, without blame.
 */
export function loggedStopWords(s: TradingSession, profile: TradingProfile): string {
  const a = stoppingTrade(s);
  if (!a?.taken) return CAUSE_WORDS['logged-trade'];
  const how = loggedOutside(a.taken.status, a.plannedRisk, a.accounts, liveLimits(s, profile));
  if (how === 'held')
    return a.taken.status === 'COOLDOWN'
      ? 'A trade was logged during a cooldown.'
      : a.taken.status === 'SESSION_STOPPED'
        ? 'A trade was logged after the session ended.'
        : 'A trade was logged while entries were held.';
  if (how === 'unknown-risk')
    return a.stop === null
      ? 'A trade was logged with no stop, so its risk is unknown.'
      : 'A trade was logged with its risk unknown.';
  if (how === 'over-risk') return 'A trade was logged above the risk per trade.';
  return CAUSE_WORDS['logged-trade'];
}

/** "The daily loss limit is reached. No new trading until 9:30 AM New York, Wed, Oct 21." */
export function stopLine(stop: ActiveStop): string {
  const { date } = nyTime(stop.until);
  const words = stop.words ?? (stop.cause ? CAUSE_WORDS[stop.cause] : STOP_WORDS[stop.reason]);
  return `${words} No new trading until ${nyClockText(stop.until)} New York, ${displayDate(date)}.`;
}

/** The cooldowns running now, this candle's and the previous one's, the latest-ending last. */
export function runningCooldowns(ctx: LiveContext): Cooldown[] {
  return [ctx.session, ctx.previous]
    .flatMap((s) => s?.cooldowns ?? [])
    .filter((c) => Date.parse(c.until) > ctx.now)
    .sort((a, b) => (a.until < b.until ? -1 : 1));
}

/** The cooldown running now, the latest-ending of this candle's and the previous one's. */
export function activeCooldown(ctx: LiveContext): Cooldown | null {
  return runningCooldowns(ctx).at(-1) ?? null;
}

/** "Step away. Back after 10:45 AM." An end time, never a countdown. */
export function cooldownLine(c: Cooldown): string {
  return `Step away. Back after ${nyClockText(Date.parse(c.until))} New York.`;
}

// The plan.

/** The latest of the candle's GEX locks open at `now` (expired included), or null before both. */
export function latestLock(now: number): GexLockId | null {
  const locks = gexLocks(candleDate(now)).filter((l) => l.start <= now);
  return locks.at(-1)?.id ?? null;
}

/**
 * Whether the plan stands for the GEX lock open now: made under it, or confirmed for it with one
 * tap. A plan from the 6 PM lock needs that confirm before new entries in the 9:30 AM window.
 */
export function planCurrent(plan: TradingPlan, now: number): boolean {
  const lock = latestLock(now);
  return !lock || plan.lock === lock || !!plan.confirmed?.some((c) => c.lock === lock);
}

/** The plan as typed on Preparation. Prices are null until typed. */
export type PlanDraft = {
  bias: 'bullish' | 'bearish';
  why: string;
  target: number | null;
  target2: number | null;
  invalidation: number | null;
  where: string;
  conditional: boolean;
  event: PlanEvent | null;
  /** The candle a carried plan came from. */
  carriedFrom?: string;
};

/** The first thing wrong with a typed plan, or null. Prices are checked on the instrument's tick. */
export function planDraftProblem(draft: PlanDraft, tick: number | null): string | null {
  const why = draft.why.trim();
  if (!why || why.length > 160 || /[\r\n]/.test(why)) return 'Say why in one line.';
  const side = sideOf(draft.bias);
  const prices = thesisPriceProblem(side, draft.target, draft.invalidation, tick, 'the target');
  if (prices) return prices;
  if (draft.target2 !== null) {
    const problem = priceProblem(draft.target2, 'the second target', tick);
    if (problem) return problem;
    if (side === 'long' ? draft.target2 <= draft.target! : draft.target2 >= draft.target!)
      return 'The second target lies beyond the first.';
  }
  const where = whereText(draft.where);
  if (where.length > WHERE_MAX || /[\r\n]/.test(draft.where))
    return `Keep where to ${WHERE_MAX} characters.`;
  if (draft.event) {
    const name = draft.event.name.trim();
    if (!name || name.length > WHERE_MAX) return 'Name the event in a few words.';
    if (!validTime(draft.event.time)) return 'Enter the event time as HH:MM New York.';
  }
  return null;
}

/**
 * The plan carried from the previous candle, to confirm with one tap, while this candle has none:
 * its bias, why, targets, invalidation and where. A major event is never carried.
 */
export function carriedPlan(ctx: LiveContext): PlanDraft | null {
  const from = ctx.previous;
  if (ctx.session.plan || !from?.plan || !directional(from.bias)) return null;
  const p = from.plan;
  return {
    bias: from.bias,
    why: p.why,
    target: p.target,
    target2: p.target2 ?? null,
    invalidation: p.invalidation,
    where: p.where,
    conditional: p.conditional,
    event: null,
    carriedFrom: from.date,
  };
}

/** What still keeps the session from starting, in order; empty when it can start. */
export function planProblems(ctx: LiveContext): string[] {
  const s = ctx.session;
  const found: string[] = [];
  if (s.bias === 'unclear') found.push('HTF unclear: no trade.');
  else if (!directional(s.bias)) found.push('Set the HTF plan: bullish or bearish.');
  if (!s.plan) found.push('Save the plan: why, target and invalidation.');
  else if (directional(s.bias)) {
    const wrong = thesisPriceProblem(
      sideOf(s.bias),
      s.plan.target,
      s.plan.invalidation,
      ctx.profile.instrument?.tick ?? null,
    );
    if (wrong) found.push('The plan no longer fits the bias: save it again.');
  }
  const { missing } = profileLimits(ctx.profile, ctx.candle);
  if (missing.length) found.push(`Set your ${missing.join(', ')} in Your limits.`);
  return found;
}

// Writes. Each reads the live context at its own time and saves the one record it changes.

function bookOf(state: State, routineId: string): RuleBook {
  const book = state.ruleBooks.find((b) => b.routineId === routineId && b.trading);
  if (!book) throw new Error('Set up Trading discipline first.');
  return book;
}

/**
 * Applies one write to the trading record it returns (this candle's or the previous one's), read
 * at `at`; throws, changing nothing, when either record could not be read or the write fails.
 */
export function changeSession(
  state: State,
  routineId: string,
  at: string,
  fn: (ctx: LiveContext) => TradingSession,
): State {
  const ctx = liveContext(state, bookOf(state, routineId), Date.parse(at));
  if (ctx.unreadable) throw new Error(UNREADABLE_LINE);
  const next = fn(ctx);
  return next === ctx.session || next === ctx.previous ? state : putTradingSession(state, next);
}

/** `at`, never before `after` (a phone clock moved back never reorders a record). */
export function notBefore(at: string, after: string | undefined): string {
  return after && at < after ? after : at;
}

function plus(at: string, minutes: number): string {
  return new Date(Date.parse(at) + minutes * MINUTE).toISOString();
}

export function append<T>(items: T[] | undefined, item: T): T[] {
  const all = items ?? [];
  if (all.length >= MAX_LIVE_RECORDS) throw new Error('No more records for this session.');
  return [...all, item];
}

/**
 * `item` added, the oldest dropped once the list is full: for the log and the cooldowns, so a
 * full list never refuses I FEEL RUSHED, an outcome or a stop.
 */
function capped<T>(items: T[] | undefined, item: T): T[] {
  return [...(items ?? []).slice(-(MAX_LIVE_RECORDS - 1)), item];
}

export function logged(
  s: TradingSession,
  at: string,
  kind: LiveEventKind,
  detail?: string,
): TradingSession {
  const event: LiveEvent = { at, kind, ...(detail && { detail: detail.slice(0, 200) }) };
  return { ...s, log: capped(s.log, event) };
}

export function notReviewed(ctx: LiveContext): void {
  if (ctx.reviewed) throw new Error('The day is reviewed.');
}

function notStopped(ctx: LiveContext): void {
  const stop = activeStop(ctx);
  if (stop) throw new Error(stopLine(stop));
}

/**
 * Saves the plan for the current candle: the bias with why, the target (and an optional second
 * one), the invalidation, where, all-day or conditional, and an optional major event. Stamped with
 * the GEX lock open now. Editable until the session starts; carried from the previous candle it is
 * saved with one tap (`carriedPlan`).
 */
export function savePlan(state: State, routineId: string, draft: PlanDraft, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    if (s.startedAt)
      throw new Error('The session has started: the plan is locked for this candle.');
    if (s.doneAt) throw new Error('Trading is done for this candle.');
    const problem = planDraftProblem(draft, ctx.profile.instrument?.tick ?? null);
    if (problem) throw new Error(problem);
    const withBias = setBias(s, draft.bias, at);
    const plan: TradingPlan = {
      why: draft.why.trim(),
      target: draft.target!,
      ...(draft.target2 !== null && { target2: draft.target2 }),
      invalidation: draft.invalidation!,
      where: normalWhere(draft.where),
      conditional: draft.conditional,
      ...(draft.event && { event: { name: draft.event.name.trim(), time: draft.event.time } }),
      at,
      lock: latestLock(ctx.now),
      ...(draft.carriedFrom && { carriedFrom: draft.carriedFrom }),
    };
    return logged(
      { ...withBias, plan, preparedAt: withBias.preparedAt ?? at },
      at,
      'plan',
      draft.carriedFrom ? `Carried from ${draft.carriedFrom}` : undefined,
    );
  });
}

/**
 * HTF unclear: the candle is labeled Unclear, which means no trade. The plan stays as typed, so
 * choosing a side again before the start needs no retyping. Refused once the session starts.
 */
export function setUnclear(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = setBias(ctx.session, 'unclear', at);
    return s === ctx.session ? s : logged(s, at, 'plan', 'unclear');
  });
}

function confirmed(plan: TradingPlan, now: number, at: string): TradingPlan {
  const lock = latestLock(now);
  if (!lock || planCurrent(plan, now)) return plan;
  return { ...plan, confirmed: [...(plan.confirmed ?? []), { lock, at }] };
}

/**
 * "Plan from the 6 PM GEX — still valid at 9:30?": one tap confirms the plan for the GEX lock open
 * now. Nothing is retyped; a plan already current is left as it is.
 */
export function confirmPlan(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    notStopped(ctx);
    const plan = ctx.session.plan;
    if (!plan) throw new Error('Save the plan first.');
    const next = confirmed(plan, ctx.now, at);
    if (next === plan) return ctx.session;
    return logged({ ...ctx.session, plan: next }, at, 'confirm', latestLock(ctx.now) ?? undefined);
  });
}

/**
 * Starts the session with one tap (I'm ready: calm, the loss accepted, no pressure): it locks the
 * plan and the limits as they stand and opens the plan's thesis. Refused while a stop holds, a
 * trade is open or its loss unknown, the day is reviewed, an earlier session still needs its
 * review or anything in `planProblems` is open. A plan made under an earlier GEX lock is not
 * confirmed here: PLAN_RECONFIRM asks for its one tap before any entry. It runs as practice when
 * anything in `practiceReasons` applies; live trading is never turned on here.
 */
export function lockSession(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    notStopped(ctx);
    const s = ctx.session;
    if (s.startedAt) throw new Error('The session has started.');
    if (openAttempt(ctx)) throw new Error('Record how the open trade ended first.');
    if (exposureUnknown(ctx)) throw new Error('Report the loss of your last trade first.');
    if (ctx.unreviewed)
      throw new Error(
        `Review ${displayDate(ctx.unreviewed)} first: a new session starts once it has its review.`,
      );
    const problems = planProblems(ctx);
    if (problems.length) throw new Error(problems[0]);
    const plan = s.plan!;
    const limits = profileLimits(ctx.profile, ctx.candle).limits!;
    const thesis: Thesis = {
      id: 't1',
      createdAt: at,
      origin: 'plan',
      direction: sideOf(s.bias as 'bullish' | 'bearish'),
      where: plan.where,
      target: plan.target,
      invalidation: plan.invalidation,
      statusLog: [
        { status: 'planned', at: plan.at < at ? plan.at : at },
        { status: 'waiting', at },
      ],
    };
    const mode = practiceReasons(ctx).length ? 'practice' : 'live';
    return logged(
      {
        ...s,
        plan,
        preparedAt: s.preparedAt ?? at,
        startedAt: at,
        lock: { at, mode, limits: lockedPart(limits) },
        lockedCaps: {
          maxEntries: limits.maxEntries,
          maxLossRun: limits.maxLossRun,
          dailyLossTotal: limits.dailyLossTotal,
        },
        theses: [thesis],
      },
      at,
      'lock',
      mode,
    );
  });
}

/**
 * I FEEL RUSHED: a cooldown starts at once, as long as the cooldown set (locked at the start of a
 * session). It is saved on the candle's record and never ends early; another tap only adds one.
 */
export function feelRushed(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    const s = ctx.session;
    const minutes = liveLimits(s, ctx.profile)?.cooldownMinutes ?? cooldownMinutesOf(ctx.profile);
    const start = notBefore(at, s.cooldowns?.at(-1)?.at);
    const cooldown: Cooldown = { kind: 'rushed', at: start, until: plus(start, minutes) };
    return logged({ ...s, cooldowns: capped(s.cooldowns, cooldown) }, start, 'rushed');
  });
}

/** The observed regime now: the latest chip set, or null (unassessed, which never blocks). */
export function observedRegime(s: TradingSession): ObservedRegime | null {
  return s.observed?.at(-1) ?? null;
}

/** The regime chip: appended with the time, never rewritten. The same kind again changes nothing. */
export function setRegime(state: State, routineId: string, kind: ObservedKind, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    if (observedRegime(s)?.kind === kind) return s;
    const regime = { kind, at: notBefore(at, s.observed?.at(-1)?.at) };
    return logged({ ...s, observed: append(s.observed, regime) }, regime.at, 'regime', kind);
  });
}

// Theses.

/** The thesis being worked: the latest not final, else the latest; null before the start. */
export function currentThesis(s: TradingSession): Thesis | null {
  const theses = s.theses ?? [];
  for (let i = theses.length - 1; i >= 0; i--)
    if (!FINAL_STATUSES.includes(thesisStatus(theses[i]))) return theses[i];
  return theses.at(-1) ?? null;
}

/** A thesis's attempts, oldest first. */
export function thesisAttempts(s: TradingSession, thesisId: string): Attempt[] {
  return (s.attempts ?? []).filter((a) => a.thesisId === thesisId);
}

/** The thesis moved to `to`, when the transition table allows it; throws otherwise. */
export function moveThesis(t: Thesis, to: ThesisStatus, at: string, reason?: string): Thesis {
  const from = thesisStatus(t);
  if (!TRANSITIONS[from].includes(to))
    throw new Error(`A thesis cannot move from ${from} to ${to}.`);
  const when = notBefore(at, t.statusLog.at(-1)!.at);
  return { ...t, statusLog: [...t.statusLog, { status: to, at: when, ...(reason && { reason }) }] };
}

export function withThesis(s: TradingSession, t: Thesis): TradingSession {
  return { ...s, theses: (s.theses ?? []).map((x) => (x.id === t.id ? t : x)) };
}

/** Dollars left, across every account, or null when a loss is unknown (never counted as zero). */
export type Left = { amount: number | null; planned: boolean };

function left(limit: number, loss: LossTotal): Left {
  return {
    amount: loss.unknown ? null : Math.round(limit * 100 - loss.amount * 100) / 100,
    planned: loss.planned,
  };
}

/** What the thesis's combined risk budget leaves after its attempts' losses, across accounts. */
export function thesisLeft(s: TradingSession, t: Thesis, limits: LiveLimits): Left {
  return left(limits.thesisRisk * limits.accounts, lossOf(thesisAttempts(s, t.id)));
}

/**
 * What the daily loss limit leaves after every attempt's loss this session, across accounts: the
 * limit times the accounts, or the total across accounts when that is stricter
 * (`dailyLossTotalOf`).
 */
export function dailyLeft(s: TradingSession, limits: LiveLimits): Left {
  return left(dailyLossTotalOf(limits), lossOf(s.attempts ?? []));
}

/** The session's losses so far (reported, else planned), across accounts. */
export function sessionLoss(s: TradingSession): LossTotal {
  return lossOf(s.attempts ?? []);
}

/** The line status of an area this session. */
export type LineStatus = 'normal' | 'warning' | 'baiting' | 'invalidated';

export const LINE_WORDS: Record<LineStatus, { word: string; line: string }> = {
  normal: { word: 'NORMAL', line: 'No failed attempt here.' },
  warning: { word: 'WARNING', line: '1 fail — caution.' },
  baiting: { word: 'BAITING', line: 'Stand down — this line is baiting.' },
  invalidated: { word: 'INVALIDATED', line: 'This line is invalidated for the session.' },
};

export type LineInfo = {
  /** The label as shown ("My area" when empty). */
  label: string;
  status: LineStatus;
  /** Failed attempts at this line this session, across theses. */
  failures: number;
  /** Whether the status was marked by hand (baiting or invalidated). */
  marked: boolean;
  reason?: string;
};

/**
 * An area's status this session, from every thesis at the same line (`lineKey`): no failed
 * attempt NORMAL, one WARNING, two BAITING; marked baiting or invalidated by hand, it stays so for
 * the session. Renaming the setup, nudging a price, changing the chart or starting another thesis
 * with the same label never resets it. Self-reported, never market data.
 */
export function lineStatus(s: TradingSession, where: string): LineInfo {
  const key = lineKey(where);
  const theses = new Set((s.theses ?? []).filter((t) => lineKey(t.where) === key).map((t) => t.id));
  const failures = (s.attempts ?? []).filter(
    (a) => a.thesisId && theses.has(a.thesisId) && failedAttempt(a),
  ).length;
  const marks = (s.lines ?? []).filter((l) => l.label === key);
  const invalid = marks.find((m) => m.kind === 'invalidated');
  const baiting = marks.find((m) => m.kind === 'baiting');
  const status: LineStatus = invalid
    ? 'invalidated'
    : baiting || failures >= 2
      ? 'baiting'
      : failures === 1
        ? 'warning'
        : 'normal';
  return {
    label: whereText(where),
    status,
    failures,
    marked: !!(invalid ?? baiting),
    ...(invalid?.reason && { reason: invalid.reason }),
  };
}

/**
 * Mark baiting (one tap) or Invalidated (one tap with a short reason): the line stays so for the
 * rest of the session and holds every entry there. There is no undo.
 */
export function markLine(
  state: State,
  routineId: string,
  where: string,
  kind: 'baiting' | 'invalidated',
  reason: string | null,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    const label = lineKey(where);
    if (label.length > WHERE_MAX) throw new Error(`Keep where to ${WHERE_MAX} characters.`);
    if ((s.lines ?? []).some((l) => l.label === label && l.kind === kind)) return s;
    const why = reason?.trim() ?? '';
    if (kind === 'invalidated' && (!why || why.length > 160 || /[\r\n]/.test(why)))
      throw new Error('Say in a few words what invalidated it.');
    const mark = { label, kind, at, ...(why && { reason: why }) };
    return logged({ ...s, lines: append(s.lines, mark) }, at, 'line', `${kind}: ${label}`);
  });
}

/** A new thesis as typed: a different area, what changed, its prices and side. */
export type ThesisDraft = {
  where: string;
  changed: string;
  target: number | null;
  invalidation: number | null;
  /** The side; absent is the bias's. Against the bias it needs `exception`. */
  direction?: 'long' | 'short';
  /** The written structural justification of a counter-bias thesis. */
  exception?: string;
};

/**
 * Why a new thesis cannot start now, or null. Session-wide restrictions come first and always
 * override: a stop, a cooldown, an unknown exposure, an open position, no daily loss left, a
 * range. Then: one thesis at a time; a different area from every earlier thesis this session (a
 * thesis retired with no attempt aside), never a baiting or invalidated line; one line on what
 * changed; prices that fit its side; and a side against the bias only with a written exception.
 * It is a self-reported assessment: Life OS has no market data.
 */
export function newThesisProblem(ctx: LiveContext, draft: ThesisDraft): string | null {
  const s = ctx.session;
  if (ctx.reviewed) return 'The day is reviewed.';
  if (!s.lock) return 'Start the session first.';
  const stop = activeStop(ctx);
  if (stop) return stopLine(stop);
  const cooldown = activeCooldown(ctx);
  if (cooldown) return `Cooldown: no new thesis. ${cooldownLine(cooldown)}`;
  if (exposureUnknown(ctx)) return 'Report the loss of your last trade first.';
  if (openAttempt(ctx)) return 'Record how the open trade ended first.';
  const limits = liveLimits(s, ctx.profile)!;
  const daily = dailyLeft(s, limits);
  if (daily.amount === null || daily.amount <= 0) return 'No daily loss left: no new thesis.';
  if (observedRegime(s)?.kind === 'range') return 'Range / chop: no new thesis while it ranges.';
  const active = (s.theses ?? []).find((t) => !FINAL_STATUSES.includes(thesisStatus(t)));
  if (active) return 'Retire the current thesis first: one thesis at a time.';
  if (!directional(s.bias)) return 'HTF unclear: no trade.';
  const key = lineKey(draft.where);
  if (whereText(draft.where).length > WHERE_MAX) return `Keep where to ${WHERE_MAX} characters.`;
  const same = (s.theses ?? []).find(
    (t) =>
      lineKey(t.where) === key &&
      !(thesisStatus(t) === 'abandoned' && !thesisAttempts(s, t.id).length),
  );
  if (same)
    return `Same area as an earlier thesis (${whereText(same.where)}) — not a new idea. A new thesis needs a different area.`;
  const line = lineStatus(s, draft.where);
  if (line.status === 'baiting' || line.status === 'invalidated')
    return `${whereText(draft.where)} is ${LINE_WORDS[line.status].word.toLowerCase()} for this session.`;
  const changed = draft.changed.trim();
  if (!changed || changed.length > 160 || /[\r\n]/.test(changed))
    return 'Say in one line what changed.';
  const side = draft.direction ?? sideOf(s.bias);
  const exception = draft.exception?.trim() ?? '';
  if (side !== sideOf(s.bias)) {
    if (!exception) return 'A thesis against the bias needs your written structural justification.';
    if (exception.length > EXCEPTION_MAX || /[\r\n]/.test(exception))
      return `Keep the justification to one line of ${EXCEPTION_MAX} characters.`;
  }
  return thesisPriceProblem(side, draft.target, draft.invalidation, limits.tick, 'the target');
}

/**
 * Starts a new thesis later in the session (`newThesisProblem` must find nothing). It never resets
 * the session's losses, exposure, cooldowns or stops; its budget is the thesis risk locked at the
 * start.
 */
export function newThesis(state: State, routineId: string, draft: ThesisDraft, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    const problem = newThesisProblem(ctx, draft);
    if (problem) throw new Error(problem);
    const s = ctx.session;
    const side = draft.direction ?? sideOf(s.bias as 'bullish' | 'bearish');
    const counter = side !== sideOf(s.bias as 'bullish' | 'bearish');
    const thesis: Thesis = {
      id: `t${(s.theses?.length ?? 0) + 1}`,
      createdAt: at,
      origin: 'new',
      direction: side,
      where: normalWhere(draft.where),
      target: draft.target!,
      invalidation: draft.invalidation!,
      changed: draft.changed.trim(),
      ...(counter && { exception: draft.exception!.trim() }),
      statusLog: [
        { status: 'planned', at },
        { status: 'waiting', at },
      ],
    };
    return logged(
      { ...s, theses: append(s.theses, thesis) },
      at,
      'thesis',
      `${whereText(thesis.where)}${counter ? ' (exception)' : ''}`,
    );
  });
}

/** Retires a thesis by hand (abandoned). A thesis in a position records the outcome instead. */
export function retireThesis(state: State, routineId: string, thesisId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    const t = (s.theses ?? []).find((x) => x.id === thesisId);
    if (!t) throw new Error('There is no such thesis.');
    if (thesisStatus(t) === 'active') throw new Error('Record how the trade ended first.');
    if (FINAL_STATUSES.includes(thesisStatus(t))) return s;
    return logged(withThesis(s, moveThesis(t, 'abandoned', at, 'Retired')), at, 'retire', t.id);
  });
}

// The setup reading.

/** A change to the setup reading: any of its fields. */
export type AssessmentChange = Partial<
  Pick<
    Assessment,
    'zone' | 'setup' | 'fast' | 'timeframe' | 'cisd' | 'confirmed' | 'entry' | 'stop' | 'contracts'
  >
>;

/**
 * The thesis's current setup reading: the latest saved after its last closed attempt, its reset
 * answer and the session's latest cooldown, so an attempt after a failed one, or after stepping
 * away, always starts from a fresh reading. Null when there is none.
 */
export function currentAssessment(s: TradingSession, t: Thesis): Assessment | null {
  const marks = [
    ...thesisAttempts(s, t.id).flatMap((a) => [a.exit?.at, a.exit?.answeredAt]),
    s.cooldowns?.at(-1)?.at,
  ].filter((x): x is string => !!x);
  const after = marks.sort().at(-1);
  const readings = (s.assessments ?? []).filter(
    (a) => a.thesisId === t.id && (!after || a.at > after),
  );
  return readings.at(-1) ?? null;
}

/**
 * Saves a change to the current thesis's setup reading (a chip, a price): the reading is copied
 * with the change and appended with its time, so naming the setup before the entry is on record.
 * Changes within ten seconds of the last, not yet used by an attempt, replace it. Refused during a
 * cooldown and before a reset is answered: nothing qualifies then.
 */
export function assess(
  state: State,
  routineId: string,
  changes: AssessmentChange,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    notStopped(ctx);
    const s = ctx.session;
    if (!s.lock) throw new Error('Start the session first.');
    if ((s.attempts ?? []).some((a) => !a.exit))
      throw new Error('Record how the open trade ended first.');
    const t = currentThesis(s);
    if (!t || FINAL_STATUSES.includes(thesisStatus(t)))
      throw new Error('There is no active thesis.');
    // Nothing qualifies while stepping away or before the reset is answered.
    const cooldown = activeCooldown(ctx);
    if (cooldown) throw new Error(cooldownLine(cooldown));
    if (thesisStatus(t) === 'reset') throw new Error('Answer the reset first.');
    const tick = liveLimits(s, ctx.profile)?.tick ?? null;
    const last = currentAssessment(s, t);
    const base: Assessment = last ?? {
      id: '',
      at,
      thesisId: t.id,
      zone: null,
      setup: null,
      timeframe: null,
      cisd: null,
      confirmed: false,
      entry: null,
      stop: null,
      contracts: null,
    };
    const merged: Assessment = { ...base, ...changes };
    if (merged.setup !== 'double-pierce' || !merged.fast) delete merged.fast;
    for (const [key, what] of [
      ['entry', 'the entry'],
      ['stop', 'the stop'],
    ] as const) {
      const value = merged[key];
      if (value !== null) {
        const problem = priceProblem(value, what, tick);
        if (problem) throw new Error(problem);
      }
    }
    if (
      merged.contracts !== null &&
      (!Number.isInteger(merged.contracts) ||
        merged.contracts < 1 ||
        merged.contracts > MAX_CONTRACTS)
    )
      throw new Error(`Enter contracts as a whole number from 1 to ${MAX_CONTRACTS}.`);
    const previous = s.assessments?.at(-1);
    const when = notBefore(at, previous?.at);
    const used = (s.attempts ?? []).some((a) => a.assessmentId === last?.id);
    const replace =
      !!last && last === previous && !used && Date.parse(when) - Date.parse(last.at) < MERGE_MS;
    const reading: Assessment = {
      ...merged,
      id: replace ? last!.id : `s${(s.assessments?.length ?? 0) + 1}`,
      at: when,
    };
    const assessments = replace
      ? [...s.assessments!.slice(0, -1), reading]
      : append(s.assessments, reading);
    return { ...s, assessments };
  });
}

// Sizing: fixed dollars per trade, the structural stop sets the contracts.

export type TradeSize = {
  /** Contracts per account. */
  contracts: number;
  accounts: number;
  /** Dollars one contract risks to the stop, with the estimated costs when set. */
  perContract: number;
  riskPerAccount: number;
  /** Across every account. */
  riskTotal: number;
  /** The dollars per account the size was taken from, and which limit set it. */
  allowance: number;
  bound: 'trade' | 'thesis' | 'daily';
  costsIncluded: boolean;
};

export type SizeProblemKind =
  | 'no-entry'
  | 'no-stop'
  | 'price'
  | 'stop-side'
  | 'past-target'
  | 'unknown-loss'
  | 'thesis-budget'
  | 'daily-budget'
  | 'too-wide';

export type SizeProblem = { kind: SizeProblemKind; title: string; text: string };

export type SizeInput = {
  side: 'long' | 'short';
  entry: number | null;
  stop: number | null;
  target: number;
  /** A lower contract count chosen (never a higher one). */
  contracts: number | null;
  limits: LiveLimits;
  thesisLeft: Left;
  dailyLeft: Left;
};

const toCents = (n: number) => Math.round(n * 100);

/** The instrument and costs one contract's risk is read from. */
export type ContractCosts = Pick<
  LiveLimits,
  'tick' | 'pointValue' | 'commission' | 'slippageTicks'
>;

/**
 * What one contract risks from the entry to the stop, in cents: the distance in whole ticks × the
 * point value, plus the estimated commission and slippage when set, each to the cent.
 */
export function contractRiskCents(costs: ContractCosts, entry: number, stop: number): number {
  const ticks = Math.round(Math.abs(entry - stop) / costs.tick);
  return (
    toCents(ticks * costs.tick * costs.pointValue) +
    (costs.commission !== null ? toCents(costs.commission) : 0) +
    (costs.slippageTicks !== null
      ? toCents(costs.slippageTicks * costs.tick * costs.pointValue)
      : 0)
  );
}

/**
 * The size a structural stop allows: contracts per account = the dollars allowed per account
 * (the fixed risk per trade, or less when the thesis budget or the daily loss limit leaves less)
 * divided by what one contract risks (the stop distance in whole ticks × the point value, plus the
 * estimated commission and slippage when set), rounded down and capped by the contract limit; a
 * lower count chosen applies. No entry or no stop, a price off the tick, a stop on the wrong side,
 * an entry at or past the target (chasing), a loss not reported, no budget left or a size of zero
 * (the stop too wide) is a problem instead, never a size.
 */
export function sizeTrade(
  input: SizeInput,
): { size: TradeSize; problem: null } | { size: null; problem: SizeProblem } {
  const { side, entry, stop, target, limits } = input;
  const fail = (kind: SizeProblemKind, title: string, text: string) => ({
    size: null,
    problem: { kind, title, text },
  });
  if (entry === null) return fail('no-entry', 'NO ENTRY PRICE', 'Enter the entry price.');
  if (stop === null)
    return fail('no-stop', 'NO STRUCTURAL STOP', 'No structural stop, no trade: enter the stop.');
  const price =
    priceProblem(entry, 'the entry', limits.tick) ?? priceProblem(stop, 'the stop', limits.tick);
  if (price) return fail('price', 'PRICE NOT VALID', price);
  if (side === 'long' ? stop >= entry : stop <= entry)
    return fail(
      'stop-side',
      'STOP ON THE WRONG SIDE',
      side === 'long'
        ? 'For a long, the stop is below the entry.'
        : 'For a short, the stop is above the entry.',
    );
  if (side === 'long' ? entry >= target : entry <= target)
    return fail(
      'past-target',
      'ENTRY PAST THE TARGET',
      `The entry is at or past the target ${priceText(target)}: do not chase.`,
    );
  if (input.thesisLeft.amount === null || input.dailyLeft.amount === null)
    return fail(
      'unknown-loss',
      'LOSS NOT REPORTED',
      'A loss is not reported: unknown is never counted as zero.',
    );
  if (input.thesisLeft.amount <= 0)
    return fail('thesis-budget', 'THESIS BUDGET USED', 'This thesis has no risk budget left.');
  if (input.dailyLeft.amount <= 0)
    return fail('daily-budget', 'DAILY LOSS REACHED', 'No daily loss left for another trade.');
  const perContract = contractRiskCents(limits, entry, stop);
  const per = (total: number) => Math.floor((total * 100) / limits.accounts);
  const bounds: [TradeSize['bound'], number][] = [
    ['trade', toCents(limits.tradeRisk)],
    ['thesis', per(input.thesisLeft.amount)],
    ['daily', per(input.dailyLeft.amount)],
  ];
  const [bound, allowance] = bounds.reduce((a, b) => (b[1] < a[1] ? b : a));
  const fit = Math.min(Math.floor(allowance / perContract), limits.maxContracts);
  const contracts = input.contracts !== null ? Math.min(input.contracts, fit) : fit;
  if (contracts < 1)
    return fail(
      'too-wide',
      'STOP TOO WIDE',
      bound === 'trade'
        ? `Stop too wide for your fixed risk of ${dollarText(allowance / 100)}.`
        : `Stop too wide for the ${dollarText(allowance / 100)} left of the ${bound === 'thesis' ? 'thesis budget' : 'daily loss limit'}.`,
    );
  const riskPerAccount = (contracts * perContract) / 100;
  return {
    problem: null,
    size: {
      contracts,
      accounts: limits.accounts,
      perContract: perContract / 100,
      riskPerAccount,
      riskTotal: Math.round(riskPerAccount * limits.accounts * 100) / 100,
      allowance: allowance / 100,
      bound,
      costsIncluded: limits.commission !== null && limits.slippageTicks !== null,
    },
  };
}

// Attempts. One intentional execution is one attempt, however many accounts or fills; a partial
// exit is never another. The checks before one are the status selector's own.

/** The records whose trades count now: this candle's, the previous one's and `older`. */
function tradeRecords(ctx: LiveContext): TradingSession[] {
  return [ctx.session, ctx.previous, ctx.older].filter((s): s is TradingSession => !!s);
}

/**
 * The attempt still open in this candle's record, the previous one's or an older one left open
 * (`older`), with its record: a trade never recorded stays to be recorded, however many candles
 * passed.
 */
export function openAttempt(
  ctx: LiveContext,
): { attempt: Attempt; session: TradingSession } | null {
  for (const s of tradeRecords(ctx)) {
    const open = s.attempts?.find((a) => !a.exit);
    if (open) return { attempt: open, session: s };
  }
  return null;
}

/**
 * The closed trade whose loss is not known, in this candle's record, the previous one's or an
 * older one, with its record, or null. Until it is reported nothing new starts or qualifies.
 */
export function unknownLossAttempt(
  ctx: LiveContext,
): { attempt: Attempt; session: TradingSession } | null {
  for (const s of tradeRecords(ctx)) {
    const attempt = s.attempts?.find((a) => a.exit && attemptLoss(a).amount === null);
    if (attempt) return { attempt, session: s };
  }
  return null;
}

/** Whether any trade that counts now has an unknown exposure (`unknownExposure`). */
export function exposureUnknown(ctx: LiveContext): boolean {
  return tradeRecords(ctx).some((s) => unknownExposure(s.attempts ?? []));
}

function findAttempt(ctx: LiveContext, id: string): { attempt: Attempt; session: TradingSession } {
  for (const s of tradeRecords(ctx)) {
    const attempt = s.attempts?.find((a) => a.id === id);
    if (attempt) return { attempt, session: s };
  }
  throw new Error('There is no such trade.');
}

export function withAttempt(s: TradingSession, a: Attempt): TradingSession {
  return { ...s, attempts: (s.attempts ?? []).map((x) => (x.id === a.id ? a : x)) };
}

/**
 * Ends the session on a stop: the daily loss reached, a hard stop or an invalidated HTF thesis
 * hold until the next candle's 9:30 AM window, a finish until the candle ends. The end of trading
 * earlier builds keep is written too; any thesis not final is retired. A stop is never lowered: a
 * session already stopped stays as it is, except that a finish is raised to a hard stop (the
 * daily loss reached after it, or a lost account set), keeping when it first stopped.
 */
function stopped(
  s: TradingSession,
  reason: SessionStop['reason'],
  at: string,
  cause?: StopCause,
): TradingSession {
  const hard = reason !== 'finished';
  const was = s.sessionStop;
  if (was && (was.reason !== 'finished' || !hard)) return s;
  const until = new Date(stopUntil(s.date, hard)).toISOString();
  const since = was?.at ?? at;
  const theses = (s.theses ?? []).map((t) =>
    FINAL_STATUSES.includes(thesisStatus(t)) || thesisStatus(t) === 'active'
      ? t
      : moveThesis(t, 'abandoned', at, 'The session ended'),
  );
  const doneReason = reason === 'invalidated' ? 'invalidated' : hard ? 'hard-stop' : 'finished';
  return logged(
    {
      ...s,
      ...(s.theses && { theses }),
      sessionStop: { at: since, reason, until: until > since ? until : plus(since, 1) },
      ...(cause && reason === 'hard-stop' && { stopCause: cause }),
      doneAt: s.doneAt ?? at,
      doneReason: was ? doneReason : (s.doneReason ?? doneReason),
    },
    at,
    'stop',
    stopDetail(reason, cause),
  );
}

/**
 * The session ended at once as a hard stop for `cause` (until the next candle's 9:30 AM window),
 * recorded with it: a cap reached, or a trade logged while entries were held. A stop already
 * holding stays as it is; a finish is raised to it.
 */
export function hardStop(s: TradingSession, cause: StopCause, at: string): TradingSession {
  return stopped(s, 'hard-stop', at, cause);
}

/**
 * A lost account set: a session started on this build ends as a hard stop, the same stop the
 * cockpit writes (`stopped`), so the status, the review and its theses all read it; a finish is
 * raised to it. A session an earlier build started ends as it always did (`endForAccountSet`); one
 * not started stays as it is.
 */
export function stopForAccountSet(s: TradingSession, at: string): TradingSession {
  return s.lock ? stopped(s, 'hard-stop', at) : endForAccountSet(s, at);
}

/**
 * The session stopped when its losses reach the daily loss limit across accounts (or the total
 * across accounts, when stricter), also after a finish (until the next 9:30 AM window, as any
 * daily loss); otherwise when a session cap is reached (`capReached`: the entry cap, then the
 * losses in a row), as a hard stop recorded with its cause.
 */
export function checkStops(s: TradingSession, profile: TradingProfile, at: string): TradingSession {
  if (s.sessionStop && s.sessionStop.reason !== 'finished') return s;
  const limits = liveLimits(s, profile);
  const daily = limits && dailyLeft(s, limits);
  if (daily && daily.amount !== null && daily.amount <= 0) return stopped(s, 'daily-loss', at);
  const cause = capReached(s.attempts ?? [], sessionCaps(s, profile));
  return cause ? hardStop(s, cause, at) : s;
}

/**
 * A session cap a profile save reached, saved as the session's hard stop at once: this candle's
 * session (unless the day is reviewed) and the previous one's while its hard stop would still
 * hold, each when started, not already stopped and at or past a cap as it holds after the save
 * (`capReached`). So a cap cut during a session is a recorded stop with its cause, which a later
 * save, the raise it waited on dropped, never lifts. Nothing else on the record changes.
 */
export function recordCapStops(state: State, routineId: string, at: string): State {
  const book = bookOf(state, routineId);
  const ctx = liveContext(state, book, Date.parse(at));
  if (ctx.unreadable) return state;
  let next = state;
  for (const s of [ctx.session, ctx.previous]) {
    if (!s?.lock || (s.sessionStop && s.sessionStop.reason !== 'finished')) continue;
    if (s === ctx.session ? ctx.reviewed : ctx.now >= stopUntil(s.date, true)) continue;
    if (s !== ctx.session && candleReview(state, routineId, s.date)) continue;
    const cause = capReached(s.attempts ?? [], sessionCaps(s, ctx.profile));
    if (cause) next = putTradingSession(next, hardStop(s, cause, notBefore(at, s.sessionStop?.at)));
  }
  return next;
}

/**
 * Saves the trading profile from Your limits (`saveTradingProfile`: more accounts only through
 * their clean sessions, a raise waiting for the next candle's session), then records any session
 * cap the save reached as a hard stop (`recordCapStops`).
 */
export function saveLimits(
  state: State,
  routineId: string,
  profile: TradingProfile,
  at: string,
): State {
  return recordCapStops(saveTradingProfile(state, routineId, profile, at), routineId, at);
}

/** A partial exit: kept on the attempt, never a new attempt. */
export function recordPartial(
  state: State,
  routineId: string,
  attemptId: string,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    const { attempt, session } = findAttempt(ctx, attemptId);
    if (attempt.exit) throw new Error('This trade is closed.');
    const when = notBefore(at, attempt.partials?.at(-1) ?? attempt.openedAt);
    const next = { ...attempt, partials: [...(attempt.partials ?? []), when] };
    return logged(withAttempt(session, next), when, 'partial', attempt.id);
  });
}

/** How a trade ended, as reported. */
export type ExitReport = {
  kind: AttemptExitKind;
  result?: AttemptExit['result'];
  /** The loss across every account, when known. */
  loss?: number;
};

function lossProblem(loss: number | undefined): string | null {
  if (loss === undefined) return null;
  return Number.isFinite(loss) && loss >= 0 && Math.abs(loss * 100 - Math.round(loss * 100)) < 1e-6
    ? null
    : 'Enter the loss in dollars, to the cent.';
}

/** Why a failed attempt exhausted its thesis, in words that match what happened. */
export function exhaustedReason(
  failures: number,
  attemptsMax: number,
  budgetUsed: boolean,
): string {
  if (failures >= 2) return 'Two failed attempts';
  if (failures >= attemptsMax) return 'The attempt allowed is used';
  return budgetUsed ? 'One failed attempt used the thesis budget' : 'No attempt or budget left';
}

/**
 * Records how an attempt ended (this candle's, or a position left open on an earlier one). The
 * objective, or a gain, completes the thesis (a later trade needs a new thesis). A structural
 * invalidation retires it at once. Any other end is a failed attempt: a loss cooldown starts (the
 * longer of the reset and the cooldown locked), and the thesis resets, or is exhausted once its
 * attempts or its budget are used; a trade logged during the reset exhausts it once the attempts
 * are used. The losses reach the daily loss limit → the session stops. A trade left open from two
 * or more candles back has its cooldown saved on this candle's record, where it holds now.
 */
export function recordExit(
  state: State,
  routineId: string,
  attemptId: string,
  report: ExitReport,
  at: string,
): State {
  const here: { cooldown: Cooldown | null } = { cooldown: null };
  const next = changeSession(state, routineId, at, (ctx) => {
    const { attempt, session } = findAttempt(ctx, attemptId);
    if (attempt.exit) throw new Error('This trade is already recorded.');
    const problem = lossProblem(report.loss);
    if (problem) throw new Error(problem);
    const when = notBefore(at, attempt.partials?.at(-1) ?? attempt.openedAt);
    const exit: AttemptExit = {
      kind: report.kind,
      at: when,
      ...(report.result && { result: report.result }),
      ...(report.loss !== undefined && { loss: report.loss }),
    };
    const closed = { ...attempt, exit };
    let s = logged(withAttempt(session, closed), when, 'exit', `${attempt.id} ${report.kind}`);
    const limits = liveLimits(s, ctx.profile);
    const t = s.theses?.find((x) => x.id === attempt.thesisId);
    const failed = failedAttempt(closed);
    if (t && !FINAL_STATUSES.includes(thesisStatus(t))) {
      const max = limits?.attemptsPerThesis ?? DEFAULT_ATTEMPTS;
      const used = thesisAttempts(s, t.id).length;
      const failures = thesisAttempts(s, t.id).filter(failedAttempt).length;
      let next: Thesis = t;
      if (thesisStatus(t) !== 'active') {
        // A trade logged outside the cockpit during the reset: it uses the thesis's last attempt.
        if (failed && used >= max)
          next = moveThesis(t, 'exhausted', when, exhaustedReason(failures, max, false));
      } else if (!failed) next = moveThesis(t, 'completed', when, 'Objective reached');
      else if (report.kind === 'invalidated')
        next = moveThesis(t, 'invalidated', when, 'Structural invalidation');
      else {
        const budget = limits ? thesisLeft(s, t, limits) : { amount: null };
        const budgetUsed = budget.amount !== null && budget.amount <= 0;
        next =
          used >= max || budgetUsed
            ? moveThesis(t, 'exhausted', when, exhaustedReason(failures, max, budgetUsed))
            : moveThesis(t, 'reset', when, 'Failed attempt');
      }
      if (next !== t) s = withThesis(s, next);
    }
    if (failed) {
      const minutes = limits
        ? Math.max(limits.resetMinutes, limits.cooldownMinutes)
        : Math.max(ctx.profile.reset.minutes, cooldownMinutesOf(ctx.profile));
      if (session === ctx.session || session === ctx.previous) {
        const start = notBefore(when, s.cooldowns?.at(-1)?.at);
        s = {
          ...s,
          cooldowns: capped(s.cooldowns, { kind: 'loss', at: start, until: plus(start, minutes) }),
        };
      } else {
        const start = notBefore(at, ctx.session.cooldowns?.at(-1)?.at);
        here.cooldown = { kind: 'loss', at: start, until: plus(start, minutes) };
      }
    }
    return checkStops(s, ctx.profile, when);
  });
  const cooldown = here.cooldown;
  if (!cooldown) return next;
  return changeSession(next, routineId, at, (ctx) =>
    logged(
      { ...ctx.session, cooldowns: capped(ctx.session.cooldowns, cooldown) },
      cooldown.at,
      'exit',
    ),
  );
}

/** Reports the loss of a closed trade whose loss was not known: once, then it stays. */
export function reportLoss(
  state: State,
  routineId: string,
  attemptId: string,
  loss: number,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    const { attempt, session } = findAttempt(ctx, attemptId);
    if (!attempt.exit) throw new Error('Record how the trade ended first.');
    if (attempt.exit.loss !== undefined) throw new Error('The loss is already reported.');
    const problem = lossProblem(loss);
    if (problem) throw new Error(problem);
    const next = withAttempt(session, { ...attempt, exit: { ...attempt.exit, loss } });
    return checkStops(logged(next, at, 'loss', attempt.id), ctx.profile, at);
  });
}

/**
 * The reset after a failed attempt: "Is the thesis still valid, its structure still relevant?",
 * answered once (a No is final and retires the thesis). Yes, after the cooldown, with an attempt
 * and budget left, makes it eligible for a second attempt, which still needs a new qualified
 * setup; otherwise it is exhausted.
 */
export function answerReset(
  state: State,
  routineId: string,
  thesisId: string,
  stillValid: boolean,
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    const t = (s.theses ?? []).find((x) => x.id === thesisId);
    if (!t || thesisStatus(t) !== 'reset') throw new Error('There is no reset to answer.');
    const last = thesisAttempts(s, t.id).at(-1)!;
    if (last.exit!.stillValid !== undefined) throw new Error('The reset is answered.');
    const answered = withAttempt(s, {
      ...last,
      exit: { ...last.exit!, stillValid, answeredAt: notBefore(at, last.exit!.at) },
    });
    if (!stillValid)
      return logged(
        withThesis(answered, moveThesis(t, 'abandoned', at, 'No longer valid')),
        at,
        'reset',
        'no',
      );
    if (activeCooldown(ctx)) throw new Error('Finish the cooldown first.');
    const limits = liveLimits(s, ctx.profile)!;
    const budget = thesisLeft(s, t, limits);
    if (budget.amount === null)
      throw new Error('Report the loss of the last trade first: unknown is never counted as zero.');
    const next =
      thesisAttempts(s, t.id).length >= limits.attemptsPerThesis || budget.amount <= 0
        ? moveThesis(t, 'exhausted', at, 'No attempt or budget left')
        : moveThesis(t, 'second-eligible', at);
    return logged(withThesis(answered, next), at, 'reset', 'yes');
  });
}

/**
 * Ends the session by hand: FINISH (until the candle ends) or a hard stop (until the next candle's
 * 9:30 AM window). An open trade is recorded first.
 */
export function endSession(
  state: State,
  routineId: string,
  reason: 'finished' | 'hard-stop',
  at: string,
): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    if (!s.lock) throw new Error('Start the session first.');
    if ((s.attempts ?? []).some((a) => !a.exit))
      throw new Error('Record how the open trade ended first.');
    return stopped(s, reason, at);
  });
}

/**
 * The HTF thesis is invalidated: the session ends until the next candle's 9:30 AM window. Kept
 * apart from a failed attempt (a protective stop), which retires at most one thesis.
 */
export function invalidateHtf(state: State, routineId: string, at: string): State {
  return changeSession(state, routineId, at, (ctx) => {
    notReviewed(ctx);
    const s = ctx.session;
    if (!s.lock) throw new Error('Start the session first.');
    if ((s.attempts ?? []).some((a) => !a.exit))
      throw new Error('Record how the open trade ended first.');
    return stopped(s, 'invalidated', at);
  });
}

/**
 * Why live trading cannot be turned on now, or null: during a lost account set's pause, a pause in
 * Programs, a session running on the current candle, a cooldown or a stop, and until the clean
 * practice sessions it needs are recorded (`practiceGateProblem`). For one live account the
 * trader already trades (`existing`), the confirmation stands in for the practice sessions, with
 * one account only (`existingAccountProblem`). The money question comes after either way.
 */
export function liveSwitchProblem(
  state: State,
  routineId: string,
  at: string,
  existing = false,
): string | null {
  const book = bookOf(state, routineId);
  const ctx = liveContext(state, book, Date.parse(at));
  if (ctx.pausedUntil) return accountSetPauseLine(ctx.pausedUntil);
  if (ctx.paused) return 'Resume trading in Programs first.';
  const stop = activeStop(ctx);
  if (ctx.session.lock && !stop) return 'A session is running: change this between sessions.';
  if (activeCooldown(ctx)) return 'Not during a cooldown.';
  if (stop) return 'Not while the session is stopped.';
  if (existing) return existingAccountProblem(book.trading!);
  return practiceGateProblem(gateSessions(state, routineId));
}

/** The plain confirmation for live trading on one account the trader already trades. */
export const EXISTING_ACCOUNT_LINE =
  'This is one live account I already trade. Life OS cannot see it and cannot stop orders at the broker.';
/** Said when the live-account path is asked for while Accounts is above 1. */
export const EXISTING_ACCOUNTS_LINE =
  'One live account only: set Accounts to 1 and save first. More accounts follow their clean live sessions.';

/**
 * Why live trading cannot be turned on for one live account already traded, or null: the
 * accounts saved must be 1 (what holds on a candle is never more than what is saved), so the path
 * never allows more than one. Going above 1 later waits for the clean live sessions as always.
 */
export function existingAccountProblem(profile: TradingProfile): string | null {
  return accountsOf(profile) === 1 ? null : EXISTING_ACCOUNTS_LINE;
}

/**
 * Turns live trading on or off in Your limits. Off is always allowed. On is refused for anything
 * in `liveSwitchProblem`, and unless the money question was just answered Yes (`setAside`): the
 * money for these accounts is set aside, not credit or money needed for bills or debt payments. A
 * Yes is kept only as the date it was given; it is asked every time. With `existing`, live trading
 * is turned on for one live account the trader already trades, confirmed just now
 * (`EXISTING_ACCOUNT_LINE`) in place of the clean practice sessions, and that date is kept too
 * (`existingAccountOn`); it is confirmed again each time. Live applies from the next session.
 */
export function setLiveTrading(
  state: State,
  routineId: string,
  on: boolean,
  at: string,
  setAside = false,
  existing = false,
): State {
  const book = bookOf(state, routineId);
  const profile = book.trading!;
  if (on) {
    const problem = liveSwitchProblem(state, routineId, at, existing);
    if (problem) throw new Error(problem);
  }
  if (liveTradingOn(profile) === on) return state;
  if (on && !setAside) throw new Error(MONEY_NO_LINE);
  const today = localDate(new Date(at));
  // The live-account date stays only with the switch it turned on, so the path is read honestly.
  const rest = { ...profile };
  if (on) delete rest.existingAccountOn;
  return saveTradingProfile(
    state,
    routineId,
    {
      ...rest,
      liveTrading: on,
      ...(on && { moneySetAsideOn: today }),
      ...(on && existing && { existingAccountOn: today }),
    },
    at,
  );
}
