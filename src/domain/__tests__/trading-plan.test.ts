import { describe, expect, it } from '@jest/globals';
import { validateEntryLog, validateThesisCard, validateTradingProfile } from '../records';
import {
  TradingSession,
  VIOLATION_IDS,
  decodeTradingSession,
  defaultTradingProfile,
  endForAccountSet,
  newSession,
  planRisk,
  sessionRisk,
  stoppedRisk,
  violationsFromLog,
} from '../trading';
import {
  dollarText,
  onTick,
  parseContracts,
  parsePrice,
  priceProblem,
  priceText,
  thesisPriceProblem,
} from '../trading-prices';
import { SETUPS } from '../trading-rules';
import { EntrySnapshot, TradingProfile } from '../model';
import {
  legacyEntry,
  legacyFailed,
  legacyFinished,
  legacyLocked,
  legacyPlan,
  legacySession,
} from '../../test-support/legacy-trading';

// Prices typed on the cockpit, and the records the earlier step-by-step cockpit saved: its
// writers are retired, and what remains reads those records for decoding, the review and the
// history. Synthetic data only: example prices on an example instrument labelled as such,
// invented wording, no account. Instants are written in UTC so each test means the same New York
// time in every zone the suite runs in. Tuesday, October 20, 2026 is daylight time (New York =
// UTC-4).
const utc = (s: string) => Date.parse(`${s}Z`);
const stamp = (s: string) => new Date(utc(s)).toISOString();

const DAY = '2026-10-20';
const EVENING = '2026-10-19T22:30:00'; // 6:30 PM New York the evening before: the 6 PM lock
const PRE = '2026-10-20T11:00:00'; // 7:00 AM
const OPEN = '2026-10-20T13:30:00'; // 9:30 AM
const MID = '2026-10-20T14:15:00'; // 10:15 AM
const CLOSE = '2026-10-20T20:30:00'; // 4:30 PM: both locks have ended

const profile: TradingProfile = {
  ...defaultTradingProfile(DAY),
  instrument: { name: 'MNQ (example)', pointValue: 2, tick: 0.25 },
  risk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300 },
};
const TIMES = { evening: stamp(EVENING), open: stamp(OPEN) };
const PLAN = { entry: 25_040, stop: 25_030, contracts: 3 };

/** Bias, preflight, classification, objective and GEX area, saved before the lock. */
const planned = () => legacyPlan(DAY, TIMES);
/** Locked with WAIT FOR SETUP at 9:30 AM on the candle's own record. */
const locked = () => legacySession(DAY, TIMES);
/** I ENTERED IN MY BROKER at 10:15 AM, every confirmation given and the risk check passed. */
const entered = (session = locked()): TradingSession => ({
  ...session,
  entries: [
    ...(session.entries ?? []),
    legacyEntry(stamp(MID), { plan: { ...PLAN, normalTarget: 25_120 } }),
  ],
});
/** An entry logged with "Log an entry I took", on the bias side, with no plan. */
const taken = (at = stamp(MID)): EntrySnapshot => ({
  at,
  kind: 'entry',
  side: 'long',
  permission: 'cisd',
  zone: true,
  gexSupports: true,
  invalidation: true,
});

describe('prices', () => {
  it('writes prices and dollars without Intl, the same on every device', () => {
    expect(priceText(25_040)).toBe('25,040');
    expect(priceText(25_040.25)).toBe('25,040.25');
    expect(priceText(25_040.5)).toBe('25,040.5');
    expect(priceText(0.25)).toBe('0.25');
    expect(priceText(1_234_567.75)).toBe('1,234,567.75');
    expect(priceText(-12.5)).toBe('-12.5');
    // Float noise from arithmetic is never shown.
    expect(priceText(25_040.1 + 0.2)).toBe('25,040.3');
    expect(dollarText(60)).toBe('$60');
    expect(dollarText(37.5)).toBe('$37.50');
    expect(dollarText(1_500)).toBe('$1,500');
    expect(dollarText(0.004)).toBe('$0');
  });

  it('reads prices and contracts as typed, and nothing else', () => {
    expect(parsePrice('25,040.25')).toBe(25_040.25);
    expect(parsePrice(' 25040 ')).toBe(25_040);
    expect(parsePrice('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '25.040.1', '-5', '1e5', '$25'])
      expect(parsePrice(bad)).toBeNull();
    expect(parseContracts('3')).toBe(3);
    expect(parseContracts('99')).toBe(99);
    for (const bad of ['0', '100', '2.5', '', 'two']) expect(parseContracts(bad)).toBeNull();
  });

  it('checks the tick', () => {
    expect(onTick(25_040.25, 0.25)).toBe(true);
    expect(onTick(25_040.1, 0.25)).toBe(false);
    expect(onTick(4_512.3, 0.1)).toBe(true);
    expect(priceProblem(25_040.1, 'the entry', 0.25)).toBe(
      'The entry 25,040.1 is not on the 0.25 tick.',
    );
    expect(priceProblem(25_040.1, 'the entry', null)).toBeNull();
    expect(priceProblem(null, 'the entry', 0.25)).toBe('Enter the entry as a price above zero.');
    expect(priceProblem(0, 'the entry', 0.25)).toMatch(/above zero/);
  });
});

describe('the objective and invalidation', () => {
  it('needs the objective beyond the invalidation in the direction of the bias', () => {
    expect(thesisPriceProblem('long', 25_120, 25_000, 0.25)).toBeNull();
    expect(thesisPriceProblem('long', 25_000, 25_120, 0.25)).toBe(
      'For a long, the normal target must be above the invalidation.',
    );
    expect(thesisPriceProblem('short', 24_900, 25_000, 0.25)).toBeNull();
    expect(thesisPriceProblem('short', 25_100, 25_000, 0.25)).toBe(
      'For a short, the normal target must be below the invalidation.',
    );
    expect(thesisPriceProblem('long', 25_000, 25_000, 0.25)).toMatch(/cannot be the same/);
    expect(thesisPriceProblem('long', 25_120.1, 25_000, 0.25)).toMatch(/not on the 0.25 tick/);
    expect(thesisPriceProblem('long', 25_120, null, 0.25)).toMatch(/invalidation as a price/);
    // Without an instrument the tick is not known, so it is not checked.
    expect(thesisPriceProblem('long', 25_120.1, 25_000, null)).toBeNull();
  });
});

describe('the named setups', () => {
  it('are three, worded for each side, with no close rule invented', () => {
    expect(SETUPS.map((s) => [s.letter, s.name])).toEqual([
      ['A', 'Pierce & Push-Away'],
      ['B', 'Delivery, Sweep & Retake'],
      ['C', 'Double Pierce / Reclaim'],
    ]);
    for (const s of SETUPS) expect(s.long).not.toBe(s.short);
    const setup = (id: string) => SETUPS.find((s) => s.id === id)!;
    expect(setup('sweep-retake').note!.long).toMatch(/my own read: no candle-close rule/);
    expect(setup('double-pierce').note!.long).toMatch(/^Fast variation: .*break.*reclaim/);
  });
});

describe('saved records', () => {
  const card = () => locked().thesis!;
  const entry = (): EntrySnapshot => entered().entries![0];

  it('reads every session saved before the cockpit, and every cockpit session it wrote', () => {
    const older = {
      ...newSession(DAY),
      bias: 'bullish',
      biasAt: stamp(PRE),
      preparedAt: stamp(PRE),
      startedAt: stamp(OPEN),
      thesis: {
        ...card(),
        objectivePrice: undefined,
        invalidationPrice: undefined,
        gex: undefined,
        regime: undefined,
      },
      gates: { acceptLoss: true, calm: true, noPressure: true, at: stamp(OPEN) },
      lockedLimits: { maxEntries: 2, maxFailedTheses: null },
    };
    const json = JSON.parse(JSON.stringify(older));
    expect(decodeTradingSession(json)).toEqual(json);
    const ended = (s: TradingSession) => legacyFinished(s, stamp(CLOSE));
    const done = (kind: 'objective' | 'stopped') => ({
      ...locked(),
      entries: [{ ...entry(), exit: { kind, at: stamp(CLOSE) } }],
    });
    for (const s of [
      planned(),
      locked(),
      entered(),
      ended(done('objective')),
      legacyFailed(done('stopped'), stamp(CLOSE)),
      { ...locked(), entries: [taken()] },
      // East of New York: a candle's session kept on the next date's record.
      legacyLocked(newSession('2026-10-21'), planned(), stamp(OPEN)),
    ]) {
      const saved = JSON.parse(JSON.stringify(s));
      expect(decodeTradingSession(saved)).toEqual(saved);
    }
  });

  it('refuses a malformed preflight, plan or locked risk', () => {
    const bad = (over: Record<string, unknown>, base: TradingSession = planned()) =>
      decodeTradingSession(JSON.parse(JSON.stringify({ ...base, ...over })));
    expect(bad({ preflight: { at: 'today' } })).toBeNull();
    expect(bad({ preflight: { at: stamp(PRE), extra: 1 } })).toBeNull();
    const prep = planned().prep!;
    expect(bad({ prep: { ...prep, why: '' } })).toBeNull();
    expect(bad({ prep: { ...prep, why: ' padded ' } })).toBeNull();
    expect(bad({ prep: { ...prep, objectivePrice: -1 } })).toBeNull();
    expect(bad({ prep: { ...prep, objectivePrice: '25120' } })).toBeNull();
    expect(bad({ prep: { ...prep, invalidationPrice: prep.objectivePrice } })).toBeNull();
    expect(bad({ prep: { ...prep, updatedAt: undefined } })).toBeNull();
    expect(bad({ prep: { ...prep, plans: [] } })).toBeNull();
    const gex = prep.gex!;
    expect(bad({ prep: { ...prep, gex: { ...gex, kind: 'wall' } } })).toBeNull();
    expect(bad({ prep: { ...prep, gex: { ...gex, zone: 0 } } })).toBeNull();
    expect(bad({ prep: { ...prep, gex: { ...gex, lock: 'noon' } } })).toBeNull();
    // A GEX area for another candle is not this record's.
    expect(bad({ prep: { ...prep, gex: { ...gex, candle: '2026-10-21' } } })).toBeNull();
    const risk = locked().lockedRisk!;
    expect(bad({ lockedRisk: risk })).toBeNull();
    expect(bad({ lockedRisk: { ...risk, maxContracts: 0 } }, locked())).toBeNull();
    expect(bad({ lockedRisk: { ...risk, tick: 0 } }, locked())).toBeNull();
    expect(bad({ lockedRisk: { ...risk, extra: 1 } }, locked())).toBeNull();
    expect(bad({ lockedRisk: { ...risk, dailyLoss: undefined } }, locked())).toBeNull();
    expect(bad({ lockedRisk: { ...risk, dailyLoss: null } }, locked())).not.toBeNull();
  });

  it('refuses a malformed price on the thesis card', () => {
    const fails = (over: Record<string, unknown>) => () =>
      validateThesisCard({ ...card(), ...over });
    expect(fails({})).not.toThrow();
    expect(fails({ invalidationPrice: undefined })).toThrow(/only one of its prices/);
    expect(fails({ objectivePrice: 0 })).toThrow();
    expect(fails({ objectivePrice: Number.NaN })).toThrow();
    expect(fails({ objectivePrice: 24_900 })).toThrow(/wrong side/);
    expect(fails({ objectivePrice: 25_000 })).toThrow(/at its invalidation/);
    expect(fails({ gex: { ...card().gex!, price: -1 } })).toThrow();
  });

  it('refuses a malformed cockpit entry or exit', () => {
    const fails =
      (over: Partial<Record<keyof EntrySnapshot, unknown>>, rest: unknown[] = []) =>
      () =>
        validateEntryLog([{ ...entry(), ...over }, ...rest]);
    expect(fails({})).not.toThrow();
    // The setup, chart, not chasing and plan go together, on a confirmed entry only.
    expect(fails({ plan: undefined })).toThrow(/cockpit entry/);
    expect(fails({ setup: 'other' })).toThrow(/setup/);
    expect(fails({ timeframe: '1h' })).toThrow(/timeframe/);
    expect(fails({ notChasing: false })).toThrow(/cockpit entry/);
    expect(fails({ outsideRules: ['window'] })).toThrow(/cockpit entry/);
    expect(fails({ plan: { ...entry().plan!, stop: 25_050 } })).toThrow(/wrong side/);
    expect(fails({ plan: { ...entry().plan!, stop: PLAN.entry } })).toThrow(/wrong side/);
    expect(fails({ plan: { ...entry().plan!, contracts: 0 } })).toThrow(/contracts/);
    expect(fails({ plan: { ...entry().plan!, contracts: 100 } })).toThrow(/contracts/);
    expect(fails({ plan: { ...entry().plan!, entry: Number.POSITIVE_INFINITY } })).toThrow();
    // An exit belongs to a planned entry, never before it.
    expect(fails({ exit: { kind: 'objective', at: stamp(OPEN) } })).toThrow(/before its entry/);
    expect(fails({ exit: { kind: 'win', at: stamp(CLOSE) } })).toThrow(/exit/);
    expect(() =>
      validateEntryLog([{ ...taken(), exit: { kind: 'flat', at: stamp(CLOSE) } }]),
    ).toThrow(/without a plan/);
    // Only the latest planned entry can still be open.
    const later = { ...entry(), at: stamp(CLOSE), kind: 'add' as const };
    expect(fails({}, [later])).toThrow(/still open/);
    expect(fails({ exit: { kind: 'flat', at: stamp(MID) } }, [later])).not.toThrow();
  });

  it('refuses a malformed instrument or risk limit on the profile', () => {
    const fails = (over: Partial<TradingProfile>) => () =>
      validateTradingProfile({ ...profile, ...over });
    expect(fails({})).not.toThrow();
    expect(fails({ instrument: undefined, risk: undefined })).not.toThrow();
    expect(fails({ instrument: { name: '', pointValue: 2, tick: 0.25 } })).toThrow(/instrument/);
    expect(fails({ instrument: { name: ' MNQ', pointValue: 2, tick: 0.25 } })).toThrow(
      /instrument/,
    );
    expect(fails({ instrument: { name: 'x'.repeat(41), pointValue: 2, tick: 0.25 } })).toThrow();
    expect(fails({ instrument: { name: 'MNQ (example)', pointValue: 0, tick: 0.25 } })).toThrow(
      /point value/,
    );
    expect(fails({ instrument: { name: 'MNQ (example)', pointValue: 2, tick: -1 } })).toThrow(
      /tick/,
    );
    expect(fails({ risk: { maxContracts: 0, thesisRisk: null, dailyLoss: null } })).toThrow();
    expect(fails({ risk: { maxContracts: 1.5, thesisRisk: null, dailyLoss: null } })).toThrow();
    expect(fails({ risk: { maxContracts: null, thesisRisk: 0, dailyLoss: null } })).toThrow();
    expect(fails({ risk: { maxContracts: null, thesisRisk: null, dailyLoss: -5 } })).toThrow();
    expect(
      fails({ risk: { maxContracts: null, thesisRisk: null, dailyLoss: null } }),
    ).not.toThrow();
  });

  it('keeps the shape an older build reads', () => {
    // An earlier build checks the card's text fields and an entry's conditions only, and ignores
    // the keys it does not know: the cockpit's card and entry pass that check unchanged.
    const olderCardCheck = (c: Record<string, unknown>) =>
      ['expectation', 'gexReason', 'objective', 'zone', 'invalidation'].every(
        (k) =>
          typeof c[k] === 'string' &&
          (c[k] as string).length >= 1 &&
          (c[k] as string).length <= 160,
      ) &&
      (c.addPlan === null || typeof c.addPlan === 'string');
    expect(olderCardCheck(card() as unknown as Record<string, unknown>)).toBe(true);
    const e = entry();
    expect(
      e.permission !== null && e.zone && e.gexSupports && e.invalidation && e.kind === 'entry',
    ).toBe(true);
    // The session keeps the closed gates and locked limits as before; the new keys sit beside them.
    expect(Object.keys(locked().gates!)).toHaveLength(4);
    expect(Object.keys(locked().lockedLimits!)).toEqual(['maxEntries', 'maxFailedTheses']);
  });
});

describe("the earlier cockpit's records in the review", () => {
  it('takes the stricter of the locked and current risk limits, and the locked instrument', () => {
    const s = locked();
    expect(sessionRisk(s, profile)).toEqual(s.lockedRisk);
    const changed: TradingProfile = {
      ...profile,
      instrument: { name: 'MNQ (example)', pointValue: 5, tick: 1 },
      risk: { maxContracts: 10, thesisRisk: 100, dailyLoss: null },
    };
    expect(sessionRisk(s, changed)).toEqual({
      maxContracts: 5,
      thesisRisk: 100,
      dailyLoss: 300,
      pointValue: 2,
      tick: 0.25,
    });
    // Before the start, the profile's own; none set is null, never a default.
    expect(sessionRisk(newSession(DAY), defaultTradingProfile(DAY))).toEqual({
      maxContracts: null,
      thesisRisk: null,
      dailyLoss: null,
      pointValue: null,
      tick: null,
    });
  });

  it('counts the stops reported in whole ticks and cents, and nothing for other exits', () => {
    // An example instrument on a 0.1 tick: 3 ticks × 0.1 × $50 × 10 contracts is $150 exactly,
    // wherever the two prices sit (plain float arithmetic puts one pair a fraction above).
    expect(planRisk({ entry: 20_000.4, stop: 20_000.1, contracts: 10 }, 50, 0.1)).toBe(150);
    expect(planRisk({ entry: 20_000.3, stop: 20_000, contracts: 10 }, 50, 0.1)).toBe(150);
    expect(planRisk({ entry: 25_040, stop: 25_002.5, contracts: 2 }, 2, 0.25)).toBe(150);
    const decimal: TradingProfile = {
      ...profile,
      instrument: { name: 'Example index (example)', pointValue: 50, tick: 0.1 },
      risk: { maxContracts: 10, thesisRisk: 150, dailyLoss: 300 },
    };
    const plan = { entry: 25_000.4, stop: 25_000.1, contracts: 10, normalTarget: 25_120 };
    const at = stamp('2026-10-20T14:30:00');
    const session = {
      ...locked(),
      lockedRisk: { ...decimal.risk!, pointValue: 50, tick: 0.1 },
    };
    const stopped = legacyFailed(
      { ...session, entries: [legacyEntry(stamp(MID), { plan, exit: { kind: 'stopped', at } })] },
      at,
    );
    expect(stoppedRisk(stopped, 50, 0.1)).toBe(150);
    // At the thesis-risk limit, and half the daily loss limit: neither is over.
    expect(violationsFromLog(decimal, stopped)).not.toContain(VIOLATION_IDS.overThesisRisk);
    expect(violationsFromLog(decimal, stopped)).not.toContain(VIOLATION_IDS.overDailyLoss);
    const over = { ...plan, entry: 25_000.5 };
    expect(
      violationsFromLog(decimal, {
        ...stopped,
        entries: [{ ...stopped.entries![0], plan: over }],
      }),
    ).toContain(VIOLATION_IDS.overThesisRisk);
    // A trade closed at the objective or flat is not counted as a loss.
    const flat = {
      ...session,
      entries: [legacyEntry(stamp(MID), { plan, exit: { kind: 'flat', at } })],
    };
    expect(stoppedRisk(flat, 50, 0.1)).toBe(0);
  });

  it('keeps an entry logged beside an open trade, and an account set lost mid-trade ends trading', () => {
    // A trade logged while one is open is an add to it.
    const both = {
      ...entered(),
      entries: [...entered().entries!, { ...taken(stamp(CLOSE)), kind: 'add' as const }],
    };
    expect(() => validateEntryLog(both.entries)).not.toThrow();
    const ended = endForAccountSet(entered(), stamp('2026-10-20T14:30:00'));
    expect(ended).toMatchObject({ doneReason: 'hard-stop' });
  });

  it('pre-selects the violations its entries point to', () => {
    const cockpitOnly = entered();
    expect(violationsFromLog(profile, cockpitOnly)).toEqual([]);
    const outside = { ...locked(), entries: [taken()] };
    expect(violationsFromLog(profile, outside)).toEqual([VIOLATION_IDS.noNamedSetup]);
    // A profile without that violation pre-selects nothing for it.
    const older = { ...profile, violations: profile.violations.slice(0, 19) };
    expect(violationsFromLog(older, outside)).toEqual([]);
    // An add the card did not plan.
    const add = {
      ...entered(),
      entries: [
        { ...entered().entries![0], exit: { kind: 'flat' as const, at: stamp(MID) } },
        { ...legacyEntry(stamp(CLOSE)), kind: 'add' as const, unplanned: true as const },
      ],
    };
    expect(violationsFromLog(profile, add)).toContain(VIOLATION_IDS.unplannedAdd);
  });
});
