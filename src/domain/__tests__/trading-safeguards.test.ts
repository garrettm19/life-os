import { describe, expect, it } from '@jest/globals';
import { decodeState } from '../data';
import { State, TradingProfile, localDate } from '../model';
import { decodeTradingSession, gateSessions, saveTradingProfile, tradingBook } from '../trading';
import {
  LIVE_ASK_LINE,
  answerReset,
  endSession,
  liveLimits,
  liveTradingOn,
  newThesis,
  practiceReasons,
  profileLimits,
  recordExit,
  recordPartial,
  reportLoss,
  saveLimits,
  setLiveTrading,
  stopUntil,
} from '../trading-live';
import {
  Attempt,
  STATUS_CODES,
  capReached,
  dailyLossCap,
  dailyLossTotalOf,
  liveViolations,
  lossInRun,
  lossRunOf,
  takenOutsideChecks,
} from '../trading-live-model';
import {
  GateSession,
  MONEY_INFO_LINE,
  MONEY_NO_LINE,
  MONEY_QUESTION,
  accountsRaiseProblem,
  cleanLiveSessions,
  cleanPracticeSessions,
  effectiveSettings,
  gateLines,
  practiceGateProblem,
  stricterCaps,
  waitingRaiseLine,
  withRaises,
} from '../trading-safeguards';
import {
  STATUS_TABLE,
  enterAttempt,
  logTakenAttempt,
  refuseEntry,
  reviewFacts,
} from '../trading-status';
import {
  EVENING,
  LIMITS,
  MID,
  OPEN,
  PRE,
  ROUTINE,
  TUE,
  WED,
  after,
  ctxAt,
  liveState,
  ready,
  reviewedSessions,
  sessionOf,
  started,
  statusAt,
  withProfile,
  z,
} from '../../test-support/trading-live';

// The safeguards that hold across a session and between sessions: the entry cap and the losses in
// a row, a raise that waits for the next candle's session, the total across accounts, a trade
// logged outside the checks, refused I ENTERED taps, the money question before live trading, and
// the clean sessions counted before live trading and more accounts. Synthetic data only: example
// limits ($100 a trade, $150 a thesis, $300 a day, 5 contracts) and invented prices. Instants are
// UTC; every rule reads New York time, so the suite holds in any zone.

const enter = (s: State, at: string) => enterAttempt(ready(s, at), ROUTINE, after(at, 1));
const exit = (s: State, id: string, kind: 'objective' | 'stopped', at: string) =>
  recordExit(s, ROUTINE, id, { kind }, at);
const profileOf = (s: State) => tradingBook(s)!.trading!;
const save = (s: State, over: Partial<TradingProfile>, at: string) =>
  saveTradingProfile(s, ROUTINE, { ...profileOf(s), ...over }, at);
const thesis = (where: string) => ({
  where,
  changed: 'Price left the first area and built a new base',
  target: 25_200,
  invalidation: 25_000,
});
/** 6:30 PM New York Tuesday: Wednesday's candle, its 6 PM window. */
const TUE_EVENING = z('2026-11-10T23:30');
/** 9:31 AM New York Wednesday: just past the next candle's 9:30 AM window opening. */
const WED_931 = z('2026-11-11T14:31');

const attempt = (exit?: Attempt['exit']): Attempt => ({
  id: 'a1',
  thesisId: 't1',
  assessmentId: 's1',
  openedAt: OPEN,
  side: 'long',
  entry: 25_040,
  stop: 25_030,
  contracts: 1,
  accounts: 1,
  plannedRisk: 20,
  costsIncluded: false,
  practice: true,
  ...(exit && { exit }),
});

describe('the entry cap', () => {
  /** Two entries at two areas, each reaching its objective, then a third thesis open. */
  const twoWins = () => {
    let s = exit(enter(started(), after(OPEN, 1)), 'a1', 'objective', after(OPEN, 5));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(OPEN, 6));
    s = exit(enter(s, after(OPEN, 7)), 'a2', 'objective', after(OPEN, 10));
    return newThesis(s, ROUTINE, thesis('Gamma flip'), after(OPEN, 11));
  };

  it('ends the session at the third entry, until the next 9:30 AM window', () => {
    let s = enter(twoWins(), after(OPEN, 12));
    expect(sessionOf(s).sessionStop).toMatchObject({ reason: 'hard-stop' });
    expect(sessionOf(s).stopCause).toBe('entry-cap');
    // The trade itself is managed; nothing new after it.
    const open = statusAt(s, after(OPEN, 14));
    expect(open.code).toBe('IN_POSITION');
    expect(open.notes).toContain('The session has ended: no new entry after this trade.');
    s = exit(s, 'a3', 'objective', after(OPEN, 20));
    const st = statusAt(s, after(OPEN, 21));
    expect(st.code).toBe('SESSION_STOPPED');
    expect(st.reason).toBe(
      'The entry cap for this session is reached. No new trading until 9:30 AM New York, Wed, Nov 11.',
    );
    expect(statusAt(s, TUE_EVENING).code).toBe('SESSION_STOPPED');
    expect(statusAt(s, WED_931).code).not.toBe('SESSION_STOPPED');
  });

  it('counts a trade logged after the fact; never a partial exit or a copied account', () => {
    // A partial exit is not an entry.
    let s = enter(started(liveState({ accounts: 3 })), after(OPEN, 1));
    s = recordPartial(s, ROUTINE, 'a1', after(OPEN, 3));
    s = recordPartial(s, ROUTINE, 'a1', after(OPEN, 4));
    expect(sessionOf(s).attempts).toHaveLength(1);
    expect(sessionOf(s).sessionStop).toBeUndefined();
    // Two entries and one logged while the checks were complete: the third ends the session.
    let t = exit(enter(started(), after(OPEN, 1)), 'a1', 'objective', after(OPEN, 5));
    t = newThesis(t, ROUTINE, thesis('Call wall'), after(OPEN, 6));
    t = exit(enter(t, after(OPEN, 7)), 'a2', 'objective', after(OPEN, 10));
    t = newThesis(t, ROUTINE, thesis('Gamma flip'), after(OPEN, 11));
    t = logTakenAttempt(
      ready(t, after(OPEN, 12)),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
      after(OPEN, 12),
    );
    expect(sessionOf(t).stopCause).toBe('entry-cap');
  });

  it('a new thesis never resets the entries or the losses counted', () => {
    let s = exit(enter(started(), after(OPEN, 1)), 'a1', 'stopped', after(OPEN, 5));
    s = answerReset(s, ROUTINE, 't1', false, after(OPEN, 6));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(OPEN, 40));
    const attempts = sessionOf(s).attempts!;
    expect(attempts).toHaveLength(1);
    expect(lossRunOf(attempts)).toBe(1);
    // The second loss in a row, on the new thesis, ends the session.
    s = exit(enter(s, after(OPEN, 41)), 'a2', 'stopped', after(OPEN, 45));
    expect(sessionOf(s).stopCause).toBe('loss-run');
    expect(statusAt(s, after(OPEN, 90)).reason).toMatch(
      /^The losses in a row that end the session are reached\. No new trading until 9:30 AM New York, Wed, Nov 11\.$/,
    );
    expect(() => newThesis(s, ROUTINE, thesis('Gamma flip'), after(OPEN, 90))).toThrow(
      /losses in a row/,
    );
  });
});

describe('the losses in a row', () => {
  it('the status counts the entries and the losses in a row, for the cockpit to show', () => {
    let s = started();
    expect(statusAt(s, after(OPEN, 1)).facts).toMatchObject({ entries: 0, lossRun: 0 });
    s = exit(enter(s, after(OPEN, 1)), 'a1', 'stopped', after(OPEN, 5));
    const one = statusAt(s, after(OPEN, 6)).facts;
    expect(one).toMatchObject({ entries: 1, lossRun: 1 });
    expect(one.limits).toMatchObject({ maxEntries: 3, maxLossRun: 2 });
  });

  it('reads a failed attempt or a reported loss as a loss; the objective or no loss breaks it', () => {
    expect(lossInRun(attempt({ kind: 'stopped', at: MID }))).toBe(true);
    expect(lossInRun(attempt({ kind: 'invalidated', at: MID }))).toBe(true);
    expect(lossInRun(attempt({ kind: 'stopped', at: MID, loss: 0 }))).toBe(true);
    expect(lossInRun(attempt({ kind: 'objective', at: MID }))).toBe(false);
    expect(lossInRun(attempt({ kind: 'flat', at: MID, result: 'breakeven' }))).toBe(false);
    expect(lossInRun(attempt({ kind: 'flat', at: MID, loss: 0 }))).toBe(false);
    expect(lossInRun(attempt({ kind: 'flat', at: MID, loss: 12.5 }))).toBe(true);
    expect(lossInRun(attempt({ kind: 'flat', at: MID, result: 'gain' }))).toBe(false);
    // Flat with nothing reported counts its planned risk; an unknown loss is never zero.
    expect(lossInRun(attempt({ kind: 'flat', at: MID }))).toBe(true);
    expect(lossInRun({ ...attempt({ kind: 'reconciled', at: MID }), plannedRisk: null })).toBe(
      true,
    );
    // An open attempt is not counted yet.
    expect(lossInRun(attempt())).toBe(false);
  });

  it('counts only the run the session ends on', () => {
    const loss = attempt({ kind: 'stopped', at: MID });
    const win = attempt({ kind: 'objective', at: MID });
    expect(lossRunOf([loss, win, loss])).toBe(1);
    expect(lossRunOf([win, loss, loss])).toBe(2);
    expect(lossRunOf([loss, loss, attempt()])).toBe(2);
    expect(capReached([loss, win, loss], { maxEntries: 3, maxLossRun: 2 })).toBe('entry-cap');
    expect(capReached([win, loss, loss], { maxEntries: 5, maxLossRun: 2 })).toBe('loss-run');
    expect(capReached([loss, win, loss], { maxEntries: 5, maxLossRun: 2 })).toBeNull();
  });

  it('the objective between two losses keeps the session open', () => {
    let s = exit(enter(started(), after(OPEN, 1)), 'a1', 'stopped', after(OPEN, 5));
    s = answerReset(s, ROUTINE, 't1', false, after(OPEN, 6));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(OPEN, 40));
    s = exit(enter(s, after(OPEN, 41)), 'a2', 'objective', after(OPEN, 45));
    s = newThesis(s, ROUTINE, thesis('Gamma flip'), after(OPEN, 46));
    s = recordExit(
      enterAttempt(ready(s, after(OPEN, 47)), ROUTINE, after(OPEN, 48)),
      ROUTINE,
      'a3',
      { kind: 'flat', result: 'breakeven' },
      after(OPEN, 50),
    );
    // Three entries end it, never the losses: one loss, a win, then flat with no loss.
    expect(sessionOf(s).stopCause).toBe('entry-cap');
    expect(lossRunOf(sessionOf(s).attempts!)).toBe(0);
  });

  it('a loss reported after a flat exit can end the run', () => {
    let s = exit(
      enter(started(liveState({ maxEntries: 5 })), after(OPEN, 1)),
      'a1',
      'stopped',
      MID,
    );
    s = answerReset(s, ROUTINE, 't1', false, after(MID, 1));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(MID, 30));
    s = enter(s, after(MID, 31));
    s = recordExit(s, ROUTINE, 'a2', { kind: 'flat', result: 'breakeven' }, after(MID, 35));
    expect(sessionOf(s).sessionStop).toBeUndefined();
    // Reported as a loss after all: the run is two, and the session ends.
    s = reportLoss(s, ROUTINE, 'a2', 30, after(MID, 36));
    expect(sessionOf(s).stopCause).toBe('loss-run');
  });
});

describe('caps locked at the start, the stricter of locked and current', () => {
  it('locks the caps; a raise during the session waits, a cut applies at once', () => {
    const s = started(liveState({ maxEntries: 4, maxLossRun: 3 }));
    expect(sessionOf(s).lockedCaps).toEqual({ maxEntries: 4, maxLossRun: 3, dailyLossTotal: null });
    const raised = save(s, { maxEntries: 10, maxLossRun: 5 }, MID);
    expect(liveLimits(sessionOf(raised), profileOf(raised))).toMatchObject({
      maxEntries: 4,
      maxLossRun: 3,
    });
    // A cut to one entry with one taken: the session holds as stopped at once.
    let one = enter(s, after(OPEN, 1));
    one = exit(one, 'a1', 'objective', after(OPEN, 5));
    const cut = save(one, { maxEntries: 1 }, after(OPEN, 6));
    expect(liveLimits(sessionOf(cut), profileOf(cut))!.maxEntries).toBe(1);
    expect(statusAt(cut, after(OPEN, 7))).toMatchObject({ code: 'SESSION_STOPPED' });
    expect(statusAt(cut, after(OPEN, 7)).reason).toMatch(/^The entry cap for this session/);
    expect(() => newThesis(cut, ROUTINE, thesis('Call wall'), after(OPEN, 8))).toThrow(/entry cap/);
  });

  it('a cap cut during the session is saved as its stop, which no later save lifts', () => {
    let s = exit(enter(started(), after(OPEN, 1)), 'a1', 'objective', after(OPEN, 5));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(OPEN, 6));
    s = exit(enter(s, after(OPEN, 7)), 'a2', 'objective', after(OPEN, 10));
    // A cut to one more entry than none left: nothing is reached, nothing is written.
    const four = saveLimits(s, ROUTINE, { ...profileOf(s), maxEntries: 4 }, after(OPEN, 11));
    expect(four.tradingSessions).toEqual(s.tradingSessions);
    const cut = saveLimits(s, ROUTINE, { ...profileOf(s), maxEntries: 2 }, after(OPEN, 11));
    expect(sessionOf(cut).sessionStop).toMatchObject({ reason: 'hard-stop' });
    expect(sessionOf(cut).stopCause).toBe('entry-cap');
    const back = saveLimits(cut, ROUTINE, { ...profileOf(cut), maxEntries: 3 }, after(OPEN, 12));
    expect(statusAt(back, after(OPEN, 13)).code).toBe('SESSION_STOPPED');
    // On Wednesday's candle a save with nothing changed drops the raise; the stop still holds.
    const later = saveLimits(back, ROUTINE, profileOf(back), TUE_EVENING);
    expect(profileOf(later).raisedOn).toBeUndefined();
    expect(statusAt(later, after(TUE_EVENING, 1)).code).toBe('SESSION_STOPPED');
    expect(statusAt(later, after(TUE_EVENING, 1)).reason).toMatch(
      /^The entry cap for this session/,
    );
    expect(statusAt(later, WED_931).code).not.toBe('SESSION_STOPPED');
  });

  it('reads the stricter of two sets of caps the one way', () => {
    expect(
      stricterCaps(
        { maxEntries: 3, maxLossRun: 4, dailyLossTotal: null },
        { maxEntries: 5, maxLossRun: 2, dailyLossTotal: 400 },
      ),
    ).toEqual({ maxEntries: 3, maxLossRun: 2, dailyLossTotal: 400 });
  });

  it('a session started before the caps were locked counts against the profile', () => {
    const s = started();
    const old = { ...sessionOf(s) };
    delete old.lockedCaps;
    expect(decodeTradingSession(JSON.parse(JSON.stringify(old)))).not.toBeNull();
    expect(liveLimits(old, profileOf(s))).toMatchObject({ maxEntries: 3, maxLossRun: 2 });
  });
});

describe('a raise waits for the next candle', () => {
  it("a raise saved before today's session starts applies from the next candle's", () => {
    const raised = save(liveState(), { risk: { ...LIMITS, tradeRisk: 200 } }, PRE);
    expect(profileOf(raised).raisedOn).toEqual({
      candle: TUE,
      before: expect.objectContaining({ tradeRisk: 100 }),
    });
    const s = started(raised);
    expect(sessionOf(s).lock!.limits.tradeRisk).toBe(100);
    expect(profileLimits(profileOf(raised), WED).limits!.tradeRisk).toBe(200);
    expect(waitingRaiseLine(profileOf(raised), TUE)).toBe(
      'Raised on this candle: risk per trade. The new values apply from the session of Wed, Nov 11; until then the earlier ones hold.',
    );
    expect(waitingRaiseLine(profileOf(raised), WED)).toBeNull();
  });

  it('a cut applies at once, and raising it back the same candle waits again', () => {
    const cut = save(liveState(), { risk: { ...LIMITS, tradeRisk: 50 } }, PRE);
    expect(profileOf(cut).raisedOn).toBeUndefined();
    expect(sessionOf(started(cut)).lock!.limits.tradeRisk).toBe(50);
    const back = save(cut, { risk: { ...LIMITS, tradeRisk: 100 } }, after(PRE, 5));
    expect(effectiveSettings(profileOf(back), TUE).tradeRisk).toBe(50);
    expect(effectiveSettings(profileOf(back), WED).tradeRisk).toBe(100);
  });

  it('waits for every setting: a shorter cooldown, more entries, losses, accounts, no total', () => {
    const start = withProfile(liveState(), { ...profileOf(liveState()), dailyLossTotal: 200 });
    const practised = reviewedSessions(start, 20, { mode: 'live' });
    const loose = save(
      practised,
      {
        cooldownMinutes: 20,
        maxEntries: 6,
        maxLossRun: 4,
        accounts: 2,
        dailyLossTotal: undefined,
        risk: { tradeRisk: 120, thesisRisk: 200, dailyLoss: 400, maxContracts: 8 },
      },
      PRE,
    );
    expect(effectiveSettings(profileOf(loose), TUE)).toEqual({
      tradeRisk: 100,
      thesisRisk: 150,
      dailyLoss: 300,
      dailyLossTotal: 200,
      maxContracts: 5,
      accounts: 1,
      maxEntries: 3,
      maxLossRun: 2,
      cooldownMinutes: 25,
    });
    expect(effectiveSettings(profileOf(loose), WED)).toMatchObject({
      dailyLossTotal: null,
      accounts: 2,
      maxEntries: 6,
      cooldownMinutes: 20,
    });
  });

  it('a limit cleared and set higher on the same candle still waits', () => {
    // Cleared before the session starts, then set above where it stood: read against $100.
    const cleared = save(liveState(), { risk: { ...LIMITS, tradeRisk: null } }, PRE);
    expect(profileLimits(profileOf(cleared), TUE).missing).toEqual(['risk per trade']);
    const raised = save(cleared, { risk: { ...LIMITS, tradeRisk: 500 } }, after(PRE, 1));
    expect(effectiveSettings(profileOf(raised), TUE).tradeRisk).toBe(100);
    expect(sessionOf(started(raised)).lock!.limits.tradeRisk).toBe(100);
    expect(effectiveSettings(profileOf(raised), WED).tradeRisk).toBe(500);
    expect(waitingRaiseLine(profileOf(raised), TUE)).toMatch(
      /^Raised on this candle: risk per trade\./,
    );
    // Every required limit, in the 6 PM window before the candle's session too.
    const higher = { tradeRisk: 500, thesisRisk: 600, dailyLoss: 900, maxContracts: 9 };
    for (const key of ['tradeRisk', 'thesisRisk', 'dailyLoss', 'maxContracts'] as const) {
      const blank = save(liveState(), { risk: { ...LIMITS, [key]: null } }, EVENING);
      const set = save(blank, { risk: { ...LIMITS, [key]: higher[key] } }, after(EVENING, 1));
      expect(effectiveSettings(profileOf(set), TUE)[key]).toBe(LIMITS[key]);
      expect(sessionOf(started(set)).lock!.limits[key]).toBe(LIMITS[key]);
    }
    // Set lower than it stood, it applies at once and nothing waits.
    const lower = save(cleared, { risk: { ...LIMITS, tradeRisk: 50 } }, after(PRE, 1));
    expect(profileOf(lower).raisedOn).toBeUndefined();
    expect(effectiveSettings(profileOf(lower), TUE).tradeRisk).toBe(50);
    // The next candle, a limit set where it was blank is set for the first time.
    const next = save(cleared, { risk: { ...LIMITS, tradeRisk: 500 } }, TUE_EVENING);
    expect(effectiveSettings(profileOf(next), WED).tradeRisk).toBe(500);
  });

  it('a profile saved again with a raise waiting reads back byte for byte', () => {
    const p = profileOf(save(liveState(), { maxEntries: 5, dailyLossTotal: 400 }, PRE));
    expect(p.raisedOn).toBeDefined();
    expect(JSON.stringify(withRaises(p, p, TUE))).toBe(JSON.stringify(p));
  });

  it('a limit set for the first time never waits', () => {
    const blank = liveState({ risk: undefined });
    expect(profileLimits(profileOf(blank), TUE).limits).toBeNull();
    const set = save(blank, { risk: { ...LIMITS } }, PRE);
    expect(profileOf(set).raisedOn).toBeUndefined();
    expect(profileLimits(profileOf(set), TUE).limits!.tradeRisk).toBe(100);
  });

  it('reads back strictly', () => {
    const raised = save(liveState(), { maxEntries: 5 }, PRE);
    expect(decodeState(JSON.parse(JSON.stringify(raised)))).toEqual(raised);
    const bad = { ...profileOf(raised), raisedOn: { candle: TUE, before: { tradeRisk: 100 } } };
    expect(() => withProfile(raised, bad as TradingProfile)).toThrow(/waiting raise/);
    const extra = { ...profileOf(raised), raisedOn: { ...profileOf(raised).raisedOn!, note: 'x' } };
    expect(() => withProfile(raised, extra as TradingProfile)).toThrow(/waiting raise/);
  });
});

describe('the total across accounts', () => {
  it('is the stricter of the daily loss times the accounts and the total', () => {
    const at = (accounts: number) =>
      dailyLossTotalOf({
        ...profileLimits(profileOf(liveState()), TUE).limits!,
        dailyLoss: 100,
        accounts,
        dailyLossTotal: 400,
      });
    expect(at(1)).toBe(100);
    expect(at(3)).toBe(300);
    expect(at(5)).toBe(400);
    // Which one sets it, for the screen to say, counted the same way to the cent.
    const cap = (accounts: number, dailyLossTotal: number | null) =>
      dailyLossCap({
        ...profileLimits(profileOf(liveState()), TUE).limits!,
        dailyLoss: 100.1,
        accounts,
        dailyLossTotal,
      });
    expect(cap(3, 300.3)).toEqual({ amount: 300.3, total: false });
    expect(cap(5, 400)).toEqual({ amount: 400, total: true });
    expect(cap(5, null)).toEqual({ amount: 500.5, total: false });
  });

  it('holds the session at five accounts: $400, not $500', () => {
    const five = liveState({
      accounts: 5,
      dailyLossTotal: 400,
      risk: { ...LIMITS, dailyLoss: 100 },
    });
    let s = started(five);
    expect(sessionOf(s).lockedCaps!.dailyLossTotal).toBe(400);
    expect(statusAt(s, after(OPEN, 1)).facts.dailyLeft).toEqual({ amount: 400, planned: false });
    s = recordExit(enter(s, after(OPEN, 1)), ROUTINE, 'a1', { kind: 'stopped', loss: 400 }, MID);
    expect(sessionOf(s).sessionStop).toMatchObject({ reason: 'daily-loss' });
    expect(liveViolations(sessionOf(s))).not.toContain('overDailyLoss');
    // A $450 loss is over it, though under $100 × 5.
    const over = recordExit(
      enter(started(five), after(OPEN, 1)),
      ROUTINE,
      'a1',
      { kind: 'stopped', loss: 450 },
      MID,
    );
    expect(liveViolations(sessionOf(over))).toContain('overDailyLoss');
  });
});

describe('a trade logged outside the checks ends the session', () => {
  const take = (s: State, at: string, contracts = 1) =>
    logTakenAttempt(s, ROUTINE, { side: 'long', entry: 25_040, stop: 25_030, contracts }, at);

  it('logged while entries were held: during a cooldown, waiting, or before the start', () => {
    const cooled = take(
      exit(enter(started(), after(OPEN, 1)), 'a1', 'stopped', MID),
      after(MID, 2),
    );
    expect(sessionOf(cooled).stopCause).toBe('logged-trade');
    expect(liveViolations(sessionOf(cooled))).toContain('revenge');
    const closed = exit(cooled, 'a2', 'objective', after(MID, 10));
    expect(statusAt(closed, after(MID, 60)).reason).toBe(
      'A trade was logged during a cooldown. No new trading until 9:30 AM New York, Wed, Nov 11.',
    );
    const waiting = exit(take(started(), after(OPEN, 1)), 'a1', 'objective', after(OPEN, 5));
    expect(statusAt(waiting, after(OPEN, 6)).reason).toMatch(
      /^A trade was logged while entries were held\. No new trading/,
    );
    expect(sessionOf(take(started(), after(OPEN, 1))).stopCause).toBe('logged-trade');
    expect(sessionOf(take(liveState(), PRE)).sessionStop).toMatchObject({ reason: 'hard-stop' });
  });

  it('logged with the checks complete: only above the risk per trade', () => {
    const within = take(ready(started(), after(OPEN, 1)), after(OPEN, 1));
    expect(sessionOf(within).sessionStop).toBeUndefined();
    // 10 contracts × $20 = $200 against $100 per trade.
    const over = take(ready(started(), after(OPEN, 1)), after(OPEN, 1), 10);
    expect(sessionOf(over).stopCause).toBe('logged-trade');
    expect(statusAt(exit(over, 'a1', 'objective', after(OPEN, 5)), after(OPEN, 6)).reason).toMatch(
      /^A trade was logged above the risk per trade\. No new trading/,
    );
    // With no stop its risk is unknown, never zero, and the reason says so.
    const blind = logTakenAttempt(
      ready(started(), after(OPEN, 1)),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: null, contracts: 1 },
      after(OPEN, 1),
    );
    expect(sessionOf(blind).stopCause).toBe('logged-trade');
    const blindClosed = recordExit(
      blind,
      ROUTINE,
      'a1',
      { kind: 'objective', loss: 0 },
      after(OPEN, 5),
    );
    expect(statusAt(blindClosed, after(OPEN, 6)).reason).toMatch(
      /^A trade was logged with no stop, so its risk is unknown\. No new trading/,
    );
    const limits = profileLimits(profileOf(liveState()), TUE).limits;
    expect(takenOutsideChecks('CHECKS_COMPLETE', 100, 1, limits)).toBe(false);
    expect(takenOutsideChecks('CHECKS_COMPLETE', 100.01, 1, limits)).toBe(true);
    expect(takenOutsideChecks('CHECKS_COMPLETE', 300, 3, limits)).toBe(false);
    expect(takenOutsideChecks('CHECKS_COMPLETE', null, 1, limits)).toBe(true);
    expect(takenOutsideChecks('COOLDOWN', 20, 1, limits)).toBe(true);
  });

  it('gives the reason of the trade that ended the session, not of one judged by a later cut', () => {
    // a1 at $20 with the checks complete, within $100: no stop. Stopped out, a loss cooldown runs.
    let s = take(ready(started(), after(OPEN, 1)), after(OPEN, 1));
    expect(sessionOf(s).sessionStop).toBeUndefined();
    s = exit(s, 'a1', 'stopped', MID);
    // The risk per trade cut to $15 applies at once; a2 at $10 is logged during the cooldown.
    s = saveLimits(s, ROUTINE, { ...profileOf(s), risk: { ...LIMITS, tradeRisk: 15 } }, MID);
    s = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_035, contracts: 1 },
      after(MID, 2),
    );
    expect(sessionOf(s).stopCause).toBe('logged-trade');
    s = exit(s, 'a2', 'objective', after(MID, 10));
    expect(statusAt(s, after(MID, 60)).reason).toBe(
      'A trade was logged during a cooldown. No new trading until 9:30 AM New York, Wed, Nov 11.',
    );
  });

  it('never lowers a stop already holding', () => {
    const hard = endSession(started(), ROUTINE, 'hard-stop', MID);
    const s = take(hard, after(MID, 5));
    expect(sessionOf(s).sessionStop).toEqual(sessionOf(hard).sessionStop);
    expect(sessionOf(s).stopCause).toBeUndefined();
    expect(liveViolations(sessionOf(s))).toContain('afterHardStop');
  });
});

describe('a refused I ENTERED tap', () => {
  it('is kept with the status that held, and nothing else changes', () => {
    const s = started();
    const refused = refuseEntry(s, ROUTINE, after(OPEN, 1));
    expect(sessionOf(refused).refusals).toEqual([{ at: after(OPEN, 1), status: 'WAITING_ZONE' }]);
    expect({ ...sessionOf(refused), refusals: undefined }).toEqual({
      ...sessionOf(s),
      refusals: undefined,
    });
    expect(reviewFacts(sessionOf(refused)).counts.refused).toBe(1);
    expect(decodeState(JSON.parse(JSON.stringify(refused)))).toEqual(refused);
    // Allowed, nothing is recorded.
    const readyState = ready(s, after(OPEN, 1));
    expect(refuseEntry(readyState, ROUTINE, after(OPEN, 2))).toBe(readyState);
    // The strict check refuses a malformed one.
    const bad = { ...sessionOf(refused), refusals: [{ at: 'soon', status: 'WAITING_ZONE' }] };
    expect(decodeTradingSession(JSON.parse(JSON.stringify(bad)))).toBeNull();
    const unknown = { ...sessionOf(refused), refusals: [{ at: after(OPEN, 1), status: 'SOON' }] };
    expect(decodeTradingSession(JSON.parse(JSON.stringify(unknown)))).toBeNull();
    // The closed list is the status table's own codes.
    expect([...STATUS_CODES].sort()).toEqual(STATUS_TABLE.map((r) => r.code).sort());
  });
});

describe('the money question before live trading', () => {
  const practised = () => reviewedSessions(liveState(), 30);

  it('is asked each time live trading is turned on; only a Yes turns it on, kept as a date', () => {
    expect(MONEY_QUESTION).toMatch(/set aside/);
    expect(MONEY_QUESTION).not.toMatch(/\$|\d/);
    expect(MONEY_INFO_LINE).toMatch(/^General information, not advice/);
    const no = practised();
    expect(() => setLiveTrading(no, ROUTINE, true, PRE)).toThrow(MONEY_NO_LINE);
    expect(profileOf(no).liveTrading).toBeUndefined();
    const on = setLiveTrading(no, ROUTINE, true, PRE, true);
    expect(profileOf(on)).toMatchObject({
      liveTrading: true,
      moneySetAsideOn: localDate(new Date(PRE)),
    });
    // Off, then on again: asked again.
    const off = setLiveTrading(on, ROUTINE, false, after(PRE, 1));
    expect(() => setLiveTrading(off, ROUTINE, true, after(PRE, 2))).toThrow(MONEY_NO_LINE);
  });
});

describe('live trading turned on by an earlier build', () => {
  it('starts practice until turned on here, with its practice and the money question', () => {
    const early = liveState({ liveTrading: true });
    expect(liveTradingOn(profileOf(early))).toBe(false);
    const s = started(early);
    expect(sessionOf(s).lock!.mode).toBe('practice');
    expect(practiceReasons(ctxAt(s, after(OPEN, 1)))).toEqual([LIVE_ASK_LINE]);
    // Turning it on again is the same switch: the clean practice sessions, then the question.
    expect(() => setLiveTrading(early, ROUTINE, true, PRE, true)).toThrow(
      'Live trading waits for 30 clean practice sessions: 0 of 30 so far.',
    );
    const practised = reviewedSessions(early, 30);
    expect(() => setLiveTrading(practised, ROUTINE, true, PRE)).toThrow(MONEY_NO_LINE);
    const on = setLiveTrading(practised, ROUTINE, true, PRE, true);
    expect(liveTradingOn(profileOf(on))).toBe(true);
    expect(sessionOf(started(on)).lock!.mode).toBe('live');
  });
});

describe('clean sessions before live trading and before more accounts', () => {
  const g = (over: Partial<GateSession>, candle = '2026-10-01'): GateSession => ({
    candle,
    mode: 'practice',
    accounts: 1,
    reviewed: true,
    violated: false,
    ...over,
  });

  it('counts clean practice sessions: reviewed, practice, no hard violation', () => {
    const sessions = [
      g({}),
      g({ violated: true }),
      g({ reviewed: false }),
      g({ mode: 'live' }),
      g({}, '2026-10-02'),
    ];
    expect(cleanPracticeSessions(sessions)).toBe(2);
    expect(practiceGateProblem(sessions)).toBe(
      'Live trading waits for 30 clean practice sessions: 2 of 30 so far.',
    );
  });

  it('reads the sessions from the records: started on the cockpit, with a review that is not a day away', () => {
    let s = reviewedSessions(liveState(), 12);
    s = reviewedSessions(s, 3, { violated: true, before: '2026-10-01' });
    expect(cleanPracticeSessions(gateSessions(s, ROUTINE))).toBe(12);
    // A day away is not a review; a session without one is not counted.
    const away = {
      ...s,
      ruleReviews: s.ruleReviews.map((r, i) =>
        i === 0 ? { ...r, trading: { ...r.trading!, session: 'away' as const } } : r,
      ),
    };
    expect(cleanPracticeSessions(gateSessions(away, ROUTINE))).toBe(11);
    expect(gateLines(gateSessions(s, ROUTINE), 1)).toEqual([
      'Clean practice sessions: 12 of 30, before live trading.',
      'Clean live sessions at 1 account: 0 of 20, before 2 accounts.',
    ]);
    expect(
      practiceGateProblem(gateSessions(reviewedSessions(liveState(), 30), ROUTINE)),
    ).toBeNull();
  });

  it('goes up one step at a time: 1 → 2 → 3 → 5, with the clean live sessions at each', () => {
    const live = (n: number, accounts: number) =>
      Array.from({ length: n }, (_, i) =>
        g({ mode: 'live', accounts }, `2026-09-${String(i + 1).padStart(2, '0')}`),
      );
    expect(accountsRaiseProblem(live(19, 1), 1, 2)).toBe(
      '2 accounts need 20 clean live sessions at 1: 19 of 20 so far.',
    );
    expect(accountsRaiseProblem(live(20, 1), 1, 2)).toBeNull();
    expect(accountsRaiseProblem(live(20, 1), 1, 3)).toBe(
      'Accounts go up one step at a time: 1 to 2 next.',
    );
    expect(accountsRaiseProblem(live(20, 2), 2, 3)).toBeNull();
    expect(accountsRaiseProblem(live(29, 3), 3, 5)).toMatch(/30 clean live sessions at 3/);
    expect(accountsRaiseProblem(live(30, 3), 3, 4)).toBe(
      'Accounts go up one step at a time: 3 to 5 next.',
    );
    expect(accountsRaiseProblem(live(30, 3), 3, 5)).toBeNull();
    expect(accountsRaiseProblem(live(30, 5), 5, 6)).toBe('More than 5 accounts is not offered.');
    // Practice sessions and sessions at another count never count; lowering is always allowed.
    expect(cleanLiveSessions([...live(5, 2), g({})], 1)).toBe(0);
    expect(accountsRaiseProblem([], 5, 1)).toBeNull();
  });

  it('a live session with a hard violation restarts the count', () => {
    const live = (day: number, over: Partial<GateSession> = {}) =>
      g({ mode: 'live', ...over }, `2026-09-${String(day).padStart(2, '0')}`);
    const sessions = [live(1), live(2), live(3, { violated: true }), live(4), live(5)];
    expect(cleanLiveSessions(sessions, 1)).toBe(2);
    // A practice session with one does not.
    expect(cleanLiveSessions([live(1), g({ violated: true }, '2026-09-02'), live(3)], 1)).toBe(2);
  });

  it('a live session with a hard violation restarts the count before its review is saved', () => {
    const earned = reviewedSessions(
      liveState({ liveTrading: true, moneySetAsideOn: '2026-11-01' }),
      20,
      { mode: 'live' },
    );
    const today = started(earned);
    expect(sessionOf(today).lock!.mode).toBe('live');
    // A clean session not yet reviewed neither counts nor restarts the count.
    expect(profileOf(save(today, { accounts: 2 }, after(OPEN, 20))).accounts).toBe(2);
    const logged = logTakenAttempt(
      today,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
      after(OPEN, 10),
    );
    expect(sessionOf(logged).stopCause).toBe('logged-trade');
    expect(gateSessions(logged, ROUTINE).at(-1)).toMatchObject({
      candle: TUE,
      reviewed: false,
      violated: true,
    });
    expect(() => save(logged, { accounts: 2 }, after(OPEN, 20))).toThrow(
      '2 accounts need 20 clean live sessions at 1: 0 of 20 so far.',
    );
  });

  it('a profile save refuses more accounts until the step is earned', () => {
    expect(() => save(liveState(), { accounts: 2 }, PRE)).toThrow(
      '2 accounts need 20 clean live sessions at 1: 0 of 20 so far.',
    );
    const earned = reviewedSessions(liveState(), 20, { mode: 'live' });
    const two = save(earned, { accounts: 2 }, PRE);
    expect(profileOf(two).accounts).toBe(2);
    // It waits like any raise.
    expect(effectiveSettings(profileOf(two), TUE).accounts).toBe(1);
    const fewer = save(
      withProfile(liveState(), { ...profileOf(liveState()), accounts: 3 }),
      { accounts: 1 },
      PRE,
    );
    expect(profileOf(fewer).accounts).toBe(1);
  });
});

describe('across the end of daylight saving time, November 1, 2026', () => {
  /** Friday, October 30, 9:40 AM New York (EDT, UTC-4). */
  const FRI_OPEN = z('2026-10-30T13:40');
  /** Friday 4:30 PM New York: still Friday's candle. */
  const FRI_LATE = z('2026-10-30T20:30');
  /** Sunday 6:30 PM New York (EST, UTC-5): Monday's 6 PM window. */
  const SUN_EVENING = z('2026-11-01T23:30');
  /** Monday, November 2, 9:31 AM New York (EST). */
  const MON_931 = z('2026-11-02T14:31');

  it('a raise saved late Friday applies from Monday, November 2', () => {
    const state = liveState({ since: '2026-10-01' });
    const raised = save(state, { risk: { ...LIMITS, dailyLoss: 400 } }, FRI_LATE);
    expect(profileOf(raised).raisedOn!.candle).toBe('2026-10-30');
    expect(profileLimits(profileOf(raised), '2026-10-30').limits!.dailyLoss).toBe(300);
    expect(profileLimits(profileOf(raised), '2026-11-02').limits!.dailyLoss).toBe(400);
    expect(waitingRaiseLine(profileOf(raised), '2026-10-30')).toMatch(/session of Mon, Nov 2;/);
  });

  it("Friday's losses in a row hold through Sunday's 6 PM window to Monday's 9:30 AM", () => {
    let s = started(liveState({ since: '2026-10-01' }), FRI_OPEN);
    s = exit(enter(s, after(FRI_OPEN, 1)), 'a1', 'stopped', after(FRI_OPEN, 5));
    s = answerReset(s, ROUTINE, 't1', false, after(FRI_OPEN, 6));
    s = newThesis(s, ROUTINE, thesis('Call wall'), after(FRI_OPEN, 40));
    s = exit(enter(s, after(FRI_OPEN, 41)), 'a2', 'stopped', after(FRI_OPEN, 45));
    const stop = sessionOf(s, '2026-10-30').sessionStop!;
    expect(stop.until).toBe(new Date(stopUntil('2026-10-30', true)).toISOString());
    expect(stop.until).toBe('2026-11-02T14:30:00.000Z');
    expect(statusAt(s, SUN_EVENING).code).toBe('SESSION_STOPPED');
    expect(statusAt(s, SUN_EVENING).reason).toBe(
      'The losses in a row that end the session are reached. No new trading until 9:30 AM New York, Mon, Nov 2.',
    );
    expect(statusAt(s, MON_931).code).not.toBe('SESSION_STOPPED');
  });
});
