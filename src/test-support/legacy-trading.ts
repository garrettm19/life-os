import { gexLocks } from '../domain/market-clock';
import { EntrySnapshot, Regime } from '../domain/model';
import { TradingSession, newSession } from '../domain/trading';

// Trading sessions as the earlier cockpit saved them: the plan, the lock and the entries
// it wrote, on records that devices still hold. Their writers are retired, so the readers that
// remain (decoding, the moves into the saved data, the review and the history) are tested on
// records of this shape. Synthetic data only: example prices on an example instrument (a point
// value of 2 on a 0.25 tick), a bullish plan into an example focus area at 25,040.

export type LegacyTimes = {
  /** When the bias, the preflight and the classification were saved. */
  evening: string;
  /** When the GEX area was mapped and the plan locked. */
  open: string;
};

export type LegacyPlan = LegacyTimes & {
  /** The HTF candle classification: a daily range unless given. */
  regime?: Omit<Regime, 'at'>;
  /** The expansion target, when the plan has one. */
  expansionPrice?: number;
};

const WHY = 'Example: price delivers up';

/** A candle's plan before the lock: bias, preflight, classification, prices and the GEX area. */
export function legacyPlan(date: string, plan: LegacyPlan): TradingSession {
  const { evening, open, expansionPrice } = plan;
  return {
    ...newSession(date),
    preparedAt: evening,
    preflight: { at: evening },
    bias: 'bullish',
    biasAt: evening,
    prep: {
      regime: { ...(plan.regime ?? { kind: 'range', context: 'daily' }), at: evening },
      why: WHY,
      objectivePrice: 25_120,
      invalidationPrice: 25_000,
      ...(expansionPrice !== undefined && { expansionPrice }),
      updatedAt: open,
      // Stamped as that build did: the first of the candle's locks not ended at `open` (the 6 PM
      // one from 6 PM to 12:30 AM, else the 9:30 AM one).
      gex: {
        kind: 'focus',
        price: 25_040,
        zone: 10,
        lock: gexLocks(date).find((lock) => Date.parse(open) < lock.end)?.id ?? 'morning',
        candle: date,
        at: open,
      },
    },
  };
}

/**
 * The plan locked at `open` on the record `on` (the plan's own, or east of New York the next
 * date's): the thesis card, the three gates and the limits locked with it.
 */
export function legacyLocked(on: TradingSession, plan: TradingSession, open: string) {
  const prep = plan.prep!;
  const session: TradingSession = {
    ...on,
    preparedAt: on.preparedAt ?? open,
    startedAt: open,
    thesis: {
      direction: 'long',
      expectation: WHY,
      gexReason: 'GEX FOCUS — 25,040 ±10',
      objective: '25,120',
      zone: '25,030–25,050',
      invalidation: '25,000',
      addPlan: null,
      committedAt: open,
      objectivePrice: prep.objectivePrice,
      invalidationPrice: prep.invalidationPrice,
      ...(prep.expansionPrice !== undefined && { expansionPrice: prep.expansionPrice }),
      gex: prep.gex,
      regime: prep.regime,
    },
    gates: { acceptLoss: true, calm: true, noPressure: true, at: open },
    lockedLimits: { maxEntries: 2, maxFailedTheses: 2 },
    lockedRisk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300, pointValue: 2, tick: 0.25 },
  };
  return session;
}

/** A candle planned and locked on its own record. */
export function legacySession(date: string, plan: LegacyPlan): TradingSession {
  const planned = legacyPlan(date, plan);
  return legacyLocked(planned, planned, plan.open);
}

/** An entry logged with I ENTERED IN MY BROKER: Setup B on the 5m, every condition confirmed. */
export function legacyEntry(at: string, over: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return {
    at,
    kind: 'entry',
    side: 'long',
    permission: 'cisd',
    zone: true,
    gexSupports: true,
    invalidation: true,
    setup: 'sweep-retake',
    timeframe: '5m',
    notChasing: true,
    plan: {
      entry: 25_040,
      stop: 25_030,
      contracts: 3,
      normalTarget: 25_120,
      expansionTarget: 25_250,
    },
    ...over,
  };
}

/** Trading finished at `at`. */
export function legacyFinished(session: TradingSession, at: string): TradingSession {
  return { ...session, doneAt: at, doneReason: 'finished' };
}

/** A thesis failed at `at`: its reset starts, not yet answered. */
export function legacyFailed(session: TradingSession, at: string): TradingSession {
  return {
    ...session,
    failedTheses: session.failedTheses + 1,
    resetStartedAt: at,
    resets: [...(session.resets ?? []), { at, whatIsNew: [] }],
  };
}
