import { Program, State, TradingProfile } from '../domain/model';
import { validateRuleBooks } from '../domain/records';
import { previousCandle } from '../domain/market-clock';
import { enableTrading, newSession, tradingBook } from '../domain/trading';
import {
  AssessmentChange,
  LiveContext,
  PlanDraft,
  assess,
  liveContext,
  lockSession,
  savePlan,
} from '../domain/trading-live';
import { TradeStatus, tradeStatus } from '../domain/trading-status';
import { trainingState } from './fixtures';

// A synthetic trading setup for the live cockpit's tests: a generic routine, an example
// instrument (a point value of 2 on a 0.25 tick) and example limits. The prices are invented
// round numbers on no real chart. Instants are written in UTC; the candle dates they fall in are
// New York's whatever zone the suite runs in.

export const ROUTINE = 'trade-rules';

/** Tuesday, November 10, 2026 (New York on standard time, UTC-5). */
export const TUE = '2026-11-10';
export const MON = '2026-11-09';
export const WED = '2026-11-11';
/** An instant in UTC: `z('2026-11-10T14:40')`. */
export const z = (s: string) => new Date(`${s}:00.000Z`).toISOString();
/** 6:30 PM New York Monday: Tuesday's candle, in its 6 PM window. */
export const EVENING = z('2026-11-09T23:30');
/** 9:00 AM New York Tuesday: between the windows. */
export const PRE = z('2026-11-10T14:00');
/** 9:40 AM New York Tuesday: the 9:30 AM window. */
export const OPEN = z('2026-11-10T14:40');
/** 10:00 AM New York Tuesday. */
export const MID = z('2026-11-10T15:00');

/** Live trading turned on with the money question answered (`liveTradingOn`). */
export const LIVE: Partial<TradingProfile> = { liveTrading: true, moneySetAsideOn: '2026-11-01' };

export const LIMITS: NonNullable<TradingProfile['risk']> = {
  tradeRisk: 100,
  thesisRisk: 150,
  dailyLoss: 300,
  maxContracts: 5,
};

/**
 * The data with `profile` as the trading profile, as it stands: placed directly (checked by the
 * strict profile check), so a fixture can hold settings a save would wait on or refuse (more
 * accounts before their clean sessions, a raise on the same candle).
 */
export function withProfile(state: State, profile: TradingProfile): State {
  const ruleBooks = state.ruleBooks.map((b) =>
    b.routineId === ROUTINE ? { ...b, trading: profile } : b,
  );
  validateRuleBooks(ruleBooks);
  return { ...state, ruleBooks };
}

/** The data with the trading routine (Monday to Friday) and its profile, limits set. */
export function liveState(over: Partial<TradingProfile> = {}): State {
  const state = trainingState();
  const trading: Program = {
    id: 'trading',
    title: 'Trading discipline',
    group: 'Private',
    goalIds: [],
    routines: [
      {
        id: ROUTINE,
        title: 'Follow my trading rules',
        duration: null,
        weekdays: [1, 2, 3, 4, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        private: true,
        capture: 'rules',
      },
    ],
  };
  const at = z('2026-11-01T12:00');
  const base: State = {
    ...state,
    programs: [...state.programs, trading],
    ruleBooks: [
      {
        id: 'book',
        routineId: ROUTINE,
        title: 'Trading rules',
        checkpoints: [],
        rules: [{ id: 'rule-1', title: 'An example rule', details: '' }],
        updatedAt: at,
      },
    ],
  };
  const enabled = enableTrading(base, ROUTINE, at);
  const profile: TradingProfile = {
    ...tradingBook(enabled)!.trading!,
    since: '2026-11-01',
    instrument: { name: 'MNQ (example)', pointValue: 2, tick: 0.25 },
    risk: { ...LIMITS },
    ...over,
  };
  return withProfile(enabled, profile);
}

/** A bullish plan into the example area: target 25,120, invalidation 25,000. */
export const PLAN: PlanDraft = {
  bias: 'bullish',
  why: 'Example: price delivers up into the prior high',
  target: 25_120,
  target2: null,
  invalidation: 25_000,
  where: 'Put wall',
  conditional: false,
  event: null,
};

export function ctxAt(state: State, at: string): LiveContext {
  return liveContext(state, tradingBook(state)!, Date.parse(at));
}

export function statusAt(state: State, at: string): TradeStatus {
  return tradeStatus(ctxAt(state, at));
}

/** The plan saved and the session started. */
export function started(
  state = liveState(),
  at = OPEN,
  plan: Partial<PlanDraft> = {},
  planAt = at,
): State {
  return lockSession(savePlan(state, ROUTINE, { ...PLAN, ...plan }, planAt), ROUTINE, at);
}

/** A complete setup reading at the area: Setup A on the 5m, confirmed, entry 25,040, stop 25,030. */
export const READY: AssessmentChange = {
  zone: 'at',
  setup: 'pierce-push',
  timeframe: '5m',
  confirmed: true,
  entry: 25_040,
  stop: 25_030,
};

export function ready(state: State, at: string, more: AssessmentChange = {}): State {
  return assess(state, ROUTINE, { ...READY, ...more }, at);
}

/** The current candle's saved session. */
export function sessionOf(state: State, candle = TUE) {
  return state.tradingSessions[candle];
}

/** Minutes after an instant, as a timestamp. */
export function after(at: string, minutes: number): string {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}

/** The example limits as a session locks them (`lock.limits`). */
export const LOCKED = {
  tradeRisk: 100,
  thesisRisk: 150,
  dailyLoss: 300,
  maxContracts: 5,
  pointValue: 2,
  tick: 0.25,
  accounts: 1,
  commission: null,
  slippageTicks: null,
  attemptsPerThesis: 2,
  cooldownMinutes: 25,
  resetMinutes: 15,
};

/**
 * `count` sessions started on the live cockpit and reviewed, one per candle on the candles before
 * `before` (latest first, going back), each in `mode` at `accounts`; its review records a hard
 * violation when `violated`. A synthetic history for the clean-session counts.
 */
export function reviewedSessions(
  state: State,
  count: number,
  {
    mode = 'practice',
    accounts = 1,
    violated = false,
    before = MON,
  }: {
    mode?: 'practice' | 'live';
    accounts?: number;
    violated?: boolean;
    before?: string;
  } = {},
): State {
  const sessions = { ...state.tradingSessions };
  const reviews = [...state.ruleReviews];
  let candle = before;
  for (let i = 0; i < count; i++) {
    candle = previousCandle(candle);
    const at = `${candle}T15:00:00.000Z`;
    sessions[candle] = {
      ...newSession(candle),
      preparedAt: at,
      startedAt: at,
      lock: { at, mode, limits: { ...LOCKED, accounts } },
    };
    reviews.push({
      id: `review-${candle}`,
      date: candle,
      at: `${candle}T21:00:00.000Z`,
      routineId: ROUTINE,
      occurrenceId: null,
      outcome: 'reviewed',
      answers: [],
      violations: violated ? ['hard-4'] : [],
      note: '',
      trading: { session: 'no-trade', entries: null, failedTheses: null, ownCandle: true },
    });
  }
  return { ...state, tradingSessions: sessions, ruleReviews: reviews };
}
