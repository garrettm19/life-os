import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { decodeState } from '../data';
import { State, localDate } from '../model';
import { decodeTradingSession, saveTradingProfile, tradingBook } from '../trading';
import {
  DEFAULT_COOLDOWN_MINUTES,
  LiveContext,
  answerReset,
  assess,
  carriedPlan,
  confirmPlan,
  endSession,
  eventInstant,
  eventText,
  feelRushed,
  invalidateHtf,
  latestLock,
  lineStatus,
  liveLimits,
  lockSession,
  markLine,
  moveThesis,
  newThesis,
  newThesisProblem,
  planDraftProblem,
  profileLimits,
  recordExit,
  recordPartial,
  retireThesis,
  savePlan,
  setLiveTrading,
  setRegime,
  setUnclear,
  sizeTrade,
  stopUntil,
} from '../trading-live';
import { MONEY_NO_LINE } from '../trading-safeguards';
import {
  FINAL_STATUSES,
  LiveLimits,
  TRANSITIONS,
  Thesis,
  ThesisStatus,
  lineKey,
  liveViolations,
} from '../trading-live-model';
import { enterAttempt, logTakenAttempt } from '../trading-status';
import {
  EVENING,
  LIVE,
  MID,
  MON,
  OPEN,
  PLAN,
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
  z,
} from '../../test-support/trading-live';

// The live cockpit's records and rules: the plan, the start and its locked limits, theses and
// attempts, sizing, lines, stops and cooldowns, read back strictly.

const LIMITS: LiveLimits = {
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
  maxEntries: 3,
  maxLossRun: 2,
  dailyLossTotal: null,
};
const plenty = { amount: 1_000, planned: false };
const size = (over: Partial<Parameters<typeof sizeTrade>[0]> = {}) =>
  sizeTrade({
    side: 'long',
    entry: 25_040,
    stop: 25_030,
    target: 25_120,
    contracts: null,
    limits: LIMITS,
    thesisLeft: plenty,
    dailyLeft: plenty,
    ...over,
  });
const entered = (state = started(), at = after(OPEN, 2)) =>
  enterAttempt(ready(state, after(OPEN, 1)), ROUTINE, at);

describe('the plan', () => {
  it('checks the typed plan for its side, the tick and the second target', () => {
    expect(planDraftProblem(PLAN, 0.25)).toBeNull();
    expect(planDraftProblem({ ...PLAN, why: ' ' }, 0.25)).toBe('Say why in one line.');
    expect(planDraftProblem({ ...PLAN, target: null }, 0.25)).toBe(
      'Enter the target as a price above zero.',
    );
    expect(planDraftProblem({ ...PLAN, bias: 'bearish' }, 0.25)).toBe(
      'For a short, the target must be below the invalidation.',
    );
    expect(planDraftProblem({ ...PLAN, target: 25_120.1 }, 0.25)).toMatch(/not on the 0.25 tick/);
    expect(planDraftProblem({ ...PLAN, target2: 25_100 }, 0.25)).toBe(
      'The second target lies beyond the first.',
    );
    expect(planDraftProblem({ ...PLAN, target2: 25_200 }, 0.25)).toBeNull();
    expect(planDraftProblem({ ...PLAN, where: 'x'.repeat(41) }, 0.25)).toMatch(/40 characters/);
    expect(planDraftProblem({ ...PLAN, event: { name: 'FOMC', time: '25:00' } }, 0.25)).toMatch(
      /HH:MM/,
    );
  });

  it('saves the bias with the plan, stamped with the GEX lock open then; no GEX prices', () => {
    const s = savePlan(liveState(), ROUTINE, { ...PLAN, where: '  Put   wall ' }, EVENING);
    const session = sessionOf(s);
    expect(session.bias).toBe('bullish');
    expect(session.plan).toEqual({
      why: PLAN.why,
      target: 25_120,
      invalidation: 25_000,
      where: 'Put wall',
      conditional: false,
      at: EVENING,
      lock: 'evening',
    });
    // Locked once the session starts.
    expect(() => savePlan(lockSession(s, ROUTINE, OPEN), ROUTINE, PLAN, MID)).toThrow(
      'The session has started: the plan is locked for this candle.',
    );
  });

  it("carries the previous candle's plan to confirm with one tap, never its event", () => {
    const mon = z('2026-11-09T14:40');
    const s = savePlan(
      liveState(),
      ROUTINE,
      { ...PLAN, event: { name: 'CPI', time: '08:30' } },
      mon,
    );
    const carried = carriedPlan(ctxAt(s, EVENING))!;
    expect(carried).toEqual({ ...PLAN, carriedFrom: MON });
    const confirmed = savePlan(s, ROUTINE, carried, EVENING);
    expect(sessionOf(confirmed).plan).toMatchObject({ carriedFrom: MON, target: 25_120 });
    expect(sessionOf(confirmed).plan!.event).toBeUndefined();
    // Nothing is offered once this candle has its own plan.
    expect(carriedPlan(ctxAt(confirmed, after(EVENING, 1)))).toBeNull();
  });

  it('confirms a plan for the next GEX lock with one tap, and only when needed', () => {
    const s = started(liveState(), EVENING, {}, EVENING);
    expect(latestLock(Date.parse(OPEN))).toBe('morning');
    expect(latestLock(Date.parse(PRE))).toBe('evening');
    expect(confirmPlan(s, ROUTINE, PRE)).toBe(s);
    const confirmed = confirmPlan(s, ROUTINE, OPEN);
    expect(sessionOf(confirmed).plan!.confirmed).toEqual([{ lock: 'morning', at: OPEN }]);
    expect(confirmPlan(confirmed, ROUTINE, MID)).toBe(confirmed);
  });

  it('labels the candle Unclear without losing the plan, until the session starts', () => {
    const s = savePlan(liveState(), ROUTINE, PLAN, EVENING);
    const unclear = setUnclear(s, ROUTINE, PRE);
    expect(sessionOf(unclear).bias).toBe('unclear');
    expect(sessionOf(unclear).plan).toEqual(sessionOf(s).plan);
    expect(statusAt(unclear, OPEN).code).toBe('NO_BIAS');
    expect(() => lockSession(unclear, ROUTINE, OPEN)).toThrow('HTF unclear: no trade.');
    // Choosing the side again needs no retyping, and Unclear again changes nothing.
    expect(sessionOf(savePlan(unclear, ROUTINE, PLAN, OPEN)).bias).toBe('bullish');
    expect(setUnclear(unclear, ROUTINE, OPEN)).toBe(unclear);
    expect(() => setUnclear(lockSession(s, ROUTINE, OPEN), ROUTINE, MID)).toThrow(
      'The session has started',
    );
  });

  it('says the major event in New York time across the DST change', () => {
    // FOMC at 2:00 PM New York: 18:00 UTC in daylight time, 19:00 UTC in standard time.
    expect(new Date(eventInstant('2026-10-28', '14:00')).toISOString()).toBe(
      '2026-10-28T18:00:00.000Z',
    );
    expect(new Date(eventInstant('2026-11-02', '14:00')).toISOString()).toBe(
      '2026-11-02T19:00:00.000Z',
    );
    expect(new Date(eventInstant('2027-03-15', '14:00')).toISOString()).toBe(
      '2027-03-15T18:00:00.000Z',
    );
    expect(new Date(eventInstant('2027-03-12', '08:30')).toISOString()).toBe(
      '2027-03-12T13:30:00.000Z',
    );
    expect(eventText({ name: 'CPI', time: '08:30' }, '2026-11-02')).toBe('CPI at 8:30 AM New York');
  });
});

describe('starting the session', () => {
  it('locks the limits as they stand and opens the plan thesis', () => {
    const s = started();
    const session = sessionOf(s);
    expect(session.startedAt).toBe(OPEN);
    const { maxEntries, maxLossRun, dailyLossTotal, ...locked } = LIMITS;
    expect(session.lock).toEqual({ at: OPEN, mode: 'practice', limits: locked });
    expect(session.lockedCaps).toEqual({ maxEntries, maxLossRun, dailyLossTotal });
    expect(session.theses).toEqual([
      {
        id: 't1',
        createdAt: OPEN,
        origin: 'plan',
        direction: 'long',
        where: 'Put wall',
        target: 25_120,
        invalidation: 25_000,
        statusLog: [
          { status: 'planned', at: OPEN },
          { status: 'waiting', at: OPEN },
        ],
      },
    ]);
    expect(() => lockSession(s, ROUTINE, MID)).toThrow('The session has started.');
  });

  it('starts live only when live trading is on and nothing pauses it', () => {
    expect(sessionOf(started(liveState(LIVE))).lock!.mode).toBe('live');
    const event = started(liveState(LIVE), OPEN, {
      event: { name: 'FOMC', time: '14:00' },
    });
    expect(sessionOf(event).lock!.mode).toBe('practice');
  });

  it('refuses while the plan or a limit is missing', () => {
    expect(() => lockSession(liveState(), ROUTINE, OPEN)).toThrow(
      'Set the HTF plan: bullish or bearish.',
    );
    const noCap = liveState({
      risk: { tradeRisk: 100, thesisRisk: 150, dailyLoss: null, maxContracts: 5 },
    });
    expect(() => started(noCap)).toThrow('Set your daily loss limit in Your limits.');
    const noInstrument = liveState({ instrument: undefined });
    expect(profileLimits(tradingBook(noInstrument)!.trading!, TUE).missing).toEqual(['instrument']);
  });

  it('counts against the stricter of the locked and current limits', () => {
    const s = started();
    const book = tradingBook(s)!;
    const raised = saveTradingProfile(
      s,
      ROUTINE,
      {
        ...book.trading!,
        risk: { tradeRisk: 500, thesisRisk: 900, dailyLoss: 2_000, maxContracts: 20 },
        cooldownMinutes: 20,
      },
      MID,
    );
    expect(liveLimits(sessionOf(raised), tradingBook(raised)!.trading!)).toEqual(LIMITS);
    const lowered = saveTradingProfile(
      s,
      ROUTINE,
      {
        ...book.trading!,
        risk: { tradeRisk: 50, thesisRisk: 100, dailyLoss: 200, maxContracts: 2 },
        cooldownMinutes: 40,
      },
      MID,
    );
    expect(liveLimits(sessionOf(lowered), tradingBook(lowered)!.trading!)).toMatchObject({
      tradeRisk: 50,
      thesisRisk: 100,
      dailyLoss: 200,
      maxContracts: 2,
      cooldownMinutes: 40,
    });
  });
});

describe('sizing: fixed dollars, the stop sets the contracts', () => {
  it('computes contracts from the entry, the stop, the point value and the tick', () => {
    // 10 points × $2 = $20 a contract: $100 buys 5.
    expect(size().size).toEqual({
      contracts: 5,
      accounts: 1,
      perContract: 20,
      riskPerAccount: 100,
      riskTotal: 100,
      allowance: 100,
      bound: 'trade',
      costsIncluded: false,
    });
    // 15 points: $30 a contract, 3 contracts for $90.
    expect(size({ stop: 25_025 }).size).toMatchObject({ contracts: 3, riskPerAccount: 90 });
  });

  it('adds the estimated costs and caps at the contract limit', () => {
    // $20 + $1.20 commission + 2 ticks of slippage ($1) = $22.20: 4 contracts for $88.80.
    const costs = { ...LIMITS, commission: 1.2, slippageTicks: 2 };
    expect(size({ limits: costs }).size).toMatchObject({
      contracts: 4,
      perContract: 22.2,
      riskPerAccount: 88.8,
      costsIncluded: true,
    });
    // 2 points: $4 a contract would buy 25; the limit is 5.
    expect(size({ stop: 25_038 }).size).toMatchObject({ contracts: 5, riskPerAccount: 20 });
  });

  it('counts every copied account and lets a lower count apply, never a higher one', () => {
    const three = { ...LIMITS, accounts: 3 };
    expect(size({ limits: three }).size).toMatchObject({
      contracts: 5,
      accounts: 3,
      riskPerAccount: 100,
      riskTotal: 300,
    });
    expect(size({ contracts: 2 }).size!.contracts).toBe(2);
    expect(size({ contracts: 9 }).size!.contracts).toBe(5);
  });

  it('sizes from what the thesis budget or the daily loss limit leaves', () => {
    // $150 thesis budget, $100 lost: $50 left buys 2 contracts at $20.
    expect(size({ thesisLeft: { amount: 50, planned: true } }).size).toMatchObject({
      contracts: 2,
      allowance: 50,
      bound: 'thesis',
    });
    expect(size({ dailyLeft: { amount: 30, planned: false } }).size).toMatchObject({
      contracts: 1,
      bound: 'daily',
    });
  });

  it('never sizes without a stop, on a bad price, past the target, or to zero', () => {
    const kind = (over: Parameters<typeof size>[0]) => size(over).problem?.kind;
    expect(kind({ stop: null })).toBe('no-stop');
    expect(size({ stop: null }).problem!.title).toBe('NO STRUCTURAL STOP');
    expect(kind({ entry: null })).toBe('no-entry');
    expect(kind({ stop: 25_030.1 })).toBe('price');
    expect(kind({ stop: 25_050 })).toBe('stop-side');
    expect(kind({ side: 'short', stop: 25_030 })).toBe('stop-side');
    expect(kind({ entry: 25_120, stop: 25_100 })).toBe('past-target');
    expect(kind({ thesisLeft: { amount: null, planned: false } })).toBe('unknown-loss');
    expect(kind({ thesisLeft: { amount: 0, planned: false } })).toBe('thesis-budget');
    expect(kind({ dailyLeft: { amount: -5, planned: false } })).toBe('daily-budget');
    // 60 points × $2 = $120 a contract, above $100.
    expect(size({ stop: 24_980 }).problem).toEqual({
      kind: 'too-wide',
      title: 'STOP TOO WIDE',
      text: 'Stop too wide for your fixed risk of $100.',
    });
    expect(size({ stop: 25_010, thesisLeft: { amount: 50, planned: true } }).problem!.text).toBe(
      'Stop too wide for the $50 left of the thesis budget.',
    );
  });
});

describe('thesis transitions', () => {
  const all = Object.keys(TRANSITIONS) as ThesisStatus[];
  const thesis = (status: ThesisStatus): Thesis => ({
    id: 't1',
    createdAt: OPEN,
    origin: 'plan',
    direction: 'long',
    where: '',
    target: 25_120,
    invalidation: 25_000,
    statusLog: [{ status, at: OPEN }],
  });

  it('allows exactly the table, and nothing out of a final state', () => {
    for (const from of all)
      for (const to of all) {
        const move = () => moveThesis(thesis(from), to, MID);
        if (TRANSITIONS[from].includes(to)) expect(move()).toBeTruthy();
        else expect(move).toThrow(`A thesis cannot move from ${from} to ${to}.`);
      }
    for (const done of FINAL_STATUSES) expect(TRANSITIONS[done]).toEqual([]);
  });

  it('never moves a stopped attempt straight back to qualified', () => {
    expect(TRANSITIONS.active).not.toContain('qualified');
    expect(TRANSITIONS.reset).not.toContain('qualified');
    expect(TRANSITIONS.reset).not.toContain('active');
  });

  it('logs qualified and active when an attempt opens, then resets after a failure', () => {
    const s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(sessionOf(s).theses![0].statusLog.map((x) => x.status)).toEqual([
      'planned',
      'waiting',
      'qualified',
      'active',
      'reset',
    ]);
  });

  it('retires a thesis by hand, never one in a position', () => {
    expect(() => retireThesis(entered(), ROUTINE, 't1', MID)).toThrow(
      'Record how the trade ended first.',
    );
    const s = retireThesis(started(), ROUTINE, 't1', MID);
    expect(sessionOf(s).theses![0].statusLog.at(-1)).toMatchObject({ status: 'abandoned' });
    expect(retireThesis(s, ROUTINE, 't1', MID)).toBe(s);
  });
});

describe('lines (where)', () => {
  it('normalizes the label: trimmed, spaces collapsed, case ignored, empty is My area', () => {
    expect(lineKey('  Put   WALL ')).toBe('put wall');
    expect(lineKey('')).toBe('my area');
    expect(lineStatus(sessionOf(started(liveState(), OPEN, { where: '' })), ' ').label).toBe(
      'My area',
    );
  });

  it('goes NORMAL, WARNING, BAITING with failures, and stays marked for the session', () => {
    let s = entered();
    expect(lineStatus(sessionOf(s), 'Put wall').status).toBe('normal');
    s = recordExit(s, ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(lineStatus(sessionOf(s), 'put wall')).toMatchObject({ status: 'warning', failures: 1 });
    // An entry crossing back through the line fails the attempt, never the line by itself.
    expect(lineStatus(sessionOf(s), 'Put wall').status).not.toBe('invalidated');
    s = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    s = enterAttempt(ready(s, after(MID, 31)), ROUTINE, after(MID, 32));
    s = recordExit(s, ROUTINE, 'a2', { kind: 'flat' }, after(MID, 33));
    expect(lineStatus(sessionOf(s), 'Put wall')).toMatchObject({
      status: 'baiting',
      failures: 2,
      marked: false,
    });
  });

  it('marks baiting with one tap, invalidated with a reason, and never undoes either', () => {
    const s = markLine(started(), ROUTINE, 'Put wall', 'baiting', null, after(OPEN, 1));
    expect(lineStatus(sessionOf(s), 'PUT WALL')).toMatchObject({ status: 'baiting', marked: true });
    expect(markLine(s, ROUTINE, 'put wall', 'baiting', null, MID)).toBe(s);
    expect(() => markLine(s, ROUTINE, 'Put wall', 'invalidated', ' ', MID)).toThrow(
      'Say in a few words what invalidated it.',
    );
    const gone = markLine(s, ROUTINE, 'Put wall', 'invalidated', 'Held below on the 15m', MID);
    expect(lineStatus(sessionOf(gone), 'Put wall')).toMatchObject({
      status: 'invalidated',
      reason: 'Held below on the 15m',
    });
  });
});

describe('a new thesis', () => {
  // Two losses in a row end the session by default: here three do, so a new thesis can follow.
  const exhausted = () => {
    let s = recordExit(
      entered(started(liveState({ maxLossRun: 3 }))),
      ROUTINE,
      'a1',
      { kind: 'stopped' },
      MID,
    );
    s = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    s = enterAttempt(ready(s, after(MID, 31)), ROUTINE, after(MID, 32));
    return recordExit(s, ROUTINE, 'a2', { kind: 'stopped' }, after(MID, 33));
  };
  const AT = after(MID, 90);
  const draft = {
    where: 'Call wall',
    changed: 'Price broke the range and retested from above',
    target: 25_200,
    invalidation: 25_100,
  };

  it('needs a different area and one line on what changed', () => {
    const s = exhausted();
    const ctx = ctxAt(s, AT);
    expect(newThesisProblem(ctx, { ...draft, where: ' put WALL' })).toBe(
      'Same area as an earlier thesis (Put wall) — not a new idea. A new thesis needs a different area.',
    );
    expect(newThesisProblem(ctx, { ...draft, changed: '' })).toBe('Say in one line what changed.');
    expect(newThesisProblem(ctx, draft)).toBeNull();
    const next = newThesis(s, ROUTINE, draft, AT);
    expect(sessionOf(next).theses![1]).toMatchObject({
      id: 't2',
      origin: 'new',
      where: 'Call wall',
      changed: draft.changed,
      direction: 'long',
    });
  });

  it('allows one thesis at a time', () => {
    const s = newThesis(exhausted(), ROUTINE, draft, AT);
    expect(newThesisProblem(ctxAt(s, after(AT, 1)), { ...draft, where: 'Gamma flip' })).toBe(
      'Retire the current thesis first: one thesis at a time.',
    );
  });

  it('takes a side against the bias only with a written justification, marked EXCEPTION', () => {
    const counter = { ...draft, direction: 'short' as const, target: 25_000, invalidation: 25_150 };
    const ctx = ctxAt(exhausted(), AT);
    expect(newThesisProblem(ctx, counter)).toBe(
      'A thesis against the bias needs your written structural justification.',
    );
    const s = newThesis(
      exhausted(),
      ROUTINE,
      { ...counter, exception: 'FVG tap at the call wall' },
      AT,
    );
    expect(sessionOf(s).theses![1].exception).toBe('FVG tap at the call wall');
    const st = statusAt(ready(s, after(AT, 1), { entry: 25_120, stop: 25_130 }), after(AT, 2));
    expect(st.code).toBe('CHECKS_COMPLETE');
    expect(st.notes).toContain('EXCEPTION — against the bias, with your written justification.');
  });

  it('may reuse the label of a thesis retired before any attempt', () => {
    let s = retireThesis(started(), ROUTINE, 't1', after(OPEN, 1));
    s = newThesis(
      s,
      ROUTINE,
      { ...draft, where: 'Put wall', target: 25_120, invalidation: 25_000 },
      after(OPEN, 2),
    );
    expect(sessionOf(s).theses!.map((t) => t.where)).toEqual(['Put wall', 'Put wall']);
  });
});

describe('attempts', () => {
  it('records one attempt per execution, with its reading and the size', () => {
    const s = entered(started(liveState({ accounts: 3 })));
    expect(sessionOf(s).attempts).toEqual([
      {
        id: 'a1',
        thesisId: 't1',
        assessmentId: 's1',
        openedAt: after(OPEN, 2),
        side: 'long',
        entry: 25_040,
        stop: 25_030,
        contracts: 5,
        accounts: 3,
        plannedRisk: 300,
        costsIncluded: false,
        practice: true,
      },
    ]);
  });

  it('keeps partial exits on the attempt, never as new attempts', () => {
    let s = recordPartial(entered(), ROUTINE, 'a1', after(OPEN, 5));
    s = recordPartial(s, ROUTINE, 'a1', after(OPEN, 6));
    expect(sessionOf(s).attempts).toHaveLength(1);
    expect(sessionOf(s).attempts![0].partials).toEqual([after(OPEN, 5), after(OPEN, 6)]);
    s = recordExit(s, ROUTINE, 'a1', { kind: 'objective' }, after(OPEN, 9));
    expect(sessionOf(s).attempts).toHaveLength(1);
  });

  it('counts a reported loss, else the planned risk; a gain or breakeven is none', () => {
    const loss = (report: Parameters<typeof recordExit>[3]) =>
      statusAt(recordExit(entered(), ROUTINE, 'a1', report, MID), after(MID, 1)).facts.sessionLoss;
    expect(loss({ kind: 'stopped' })).toEqual({ amount: 100, planned: true, unknown: false });
    expect(loss({ kind: 'stopped', loss: 112.5 })).toEqual({
      amount: 112.5,
      planned: false,
      unknown: false,
    });
    expect(loss({ kind: 'flat' })).toEqual({ amount: 100, planned: true, unknown: false });
    expect(loss({ kind: 'flat', result: 'breakeven' }).amount).toBe(0);
    expect(loss({ kind: 'objective' }).amount).toBe(0);
  });

  it('completes the thesis on a gain, retires it on a structural invalidation', () => {
    const status = (report: Parameters<typeof recordExit>[3]) =>
      sessionOf(recordExit(entered(), ROUTINE, 'a1', report, MID)).theses![0].statusLog.at(-1)!
        .status;
    expect(status({ kind: 'objective' })).toBe('completed');
    expect(status({ kind: 'flat', result: 'gain' })).toBe('completed');
    expect(status({ kind: 'invalidated' })).toBe('invalidated');
    expect(status({ kind: 'stopped' })).toBe('reset');
  });

  it('starts the loss cooldown from the longer of the reset and the cooldown locked', () => {
    const s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(sessionOf(s).cooldowns).toEqual([
      { kind: 'loss', at: MID, until: after(MID, DEFAULT_COOLDOWN_MINUTES) },
    ]);
    const long = started(liveState({ reset: { minutes: 40, steps: [] } }));
    const t = recordExit(entered(long), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(sessionOf(t).cooldowns![0].until).toBe(after(MID, 40));
  });

  it('answers the reset once; a No retires the thesis for good', () => {
    const s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(() => answerReset(s, ROUTINE, 't1', true, after(MID, 10))).toThrow(
      'Finish the cooldown first.',
    );
    const no = answerReset(s, ROUTINE, 't1', false, after(MID, 10));
    expect(sessionOf(no).theses![0].statusLog.at(-1)).toMatchObject({
      status: 'abandoned',
      reason: 'No longer valid',
    });
    expect(() => answerReset(no, ROUTINE, 't1', true, after(MID, 30))).toThrow(
      'There is no reset to answer.',
    );
    expect(sessionOf(no).attempts![0].exit).toMatchObject({ stillValid: false });
  });

  it('stops the session once the losses reach the daily loss limit', () => {
    let s = started(
      liveState({ risk: { tradeRisk: 100, thesisRisk: 150, dailyLoss: 120, maxContracts: 5 } }),
    );
    s = recordExit(entered(s), ROUTINE, 'a1', { kind: 'stopped', loss: 125 }, MID);
    expect(sessionOf(s).sessionStop).toEqual({
      at: MID,
      reason: 'daily-loss',
      until: new Date(stopUntil(TUE, true)).toISOString(),
    });
    expect(sessionOf(s).doneReason).toBe('hard-stop');
    expect(stopUntil(TUE, true)).toBe(Date.parse(z('2026-11-11T14:30')));
  });

  it('logs an entry taken outside the cockpit now, on the thesis being worked, with its status', () => {
    // Rewritten for the rule that a taken trade counts on the thesis worked (it used to belong to
    // no thesis and could take an earlier time).
    let s = feelRushed(started(), ROUTINE, after(OPEN, 1));
    s = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 2 },
      after(OPEN, 4),
    );
    expect(sessionOf(s).attempts![0]).toMatchObject({
      thesisId: 't1',
      assessmentId: null,
      openedAt: after(OPEN, 4),
      plannedRisk: 40,
      taken: { status: 'COOLDOWN' },
    });
    expect(sessionOf(s).theses![0].statusLog.at(-1)).toMatchObject({
      status: 'active',
      reason: 'Taken outside the cockpit',
    });
    // Under an I FEEL RUSHED cooldown with no failed attempt it is no revenge re-entry (rewritten:
    // it used to count as one).
    expect(liveViolations(sessionOf(s))).toEqual(['noNamedSetup']);
    // With no thesis worked (no session started) it belongs to none.
    const none = logTakenAttempt(
      liveState(),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
      PRE,
    );
    expect(sessionOf(none).attempts![0].thesisId).toBeNull();
  });
});

describe('ending the session', () => {
  it('records the end of trading earlier builds keep, and retires the open theses', () => {
    const s = endSession(started(), ROUTINE, 'finished', MID);
    expect(sessionOf(s)).toMatchObject({
      doneAt: MID,
      doneReason: 'finished',
      sessionStop: {
        at: MID,
        reason: 'finished',
        until: new Date(stopUntil(TUE, false)).toISOString(),
      },
    });
    expect(sessionOf(s).theses![0].statusLog.at(-1)).toMatchObject({ status: 'abandoned' });
    expect(() => endSession(entered(), ROUTINE, 'finished', MID)).toThrow(
      'Record how the open trade ended first.',
    );
  });

  it('keeps an HTF invalidation apart from a failed attempt', () => {
    const s = invalidateHtf(started(), ROUTINE, MID);
    expect(sessionOf(s).sessionStop!.reason).toBe('invalidated');
    expect(sessionOf(s).doneReason).toBe('invalidated');
    expect(statusAt(s, z('2026-11-10T23:30')).code).toBe('SESSION_STOPPED');
  });
});

describe('live trading', () => {
  it('stays off unless turned on deliberately, and never during a session, pause or stop', () => {
    const s = started();
    expect(() => setLiveTrading(s, ROUTINE, true, MID)).toThrow(
      'A session is running: change this between sessions.',
    );
    expect(() =>
      setLiveTrading(feelRushed(liveState(), ROUTINE, PRE), ROUTINE, true, after(PRE, 1)),
    ).toThrow('Not during a cooldown.');
    // Thirty clean practice sessions first, then the money question answered Yes.
    expect(() => setLiveTrading(liveState(), ROUTINE, true, PRE, true)).toThrow(
      'Live trading waits for 30 clean practice sessions: 0 of 30 so far.',
    );
    const practised = reviewedSessions(liveState(), 30);
    expect(() => setLiveTrading(practised, ROUTINE, true, PRE)).toThrow(MONEY_NO_LINE);
    const on = setLiveTrading(practised, ROUTINE, true, PRE, true);
    expect(tradingBook(on)!.trading!.liveTrading).toBe(true);
    expect(tradingBook(on)!.trading!.moneySetAsideOn).toBe(localDate(new Date(PRE)));
    expect(tradingBook(setLiveTrading(on, ROUTINE, false, PRE))!.trading!.liveTrading).toBe(false);
    expect(setLiveTrading(liveState(), ROUTINE, false, PRE)).toEqual(liveState());
  });
});

describe('reading the records back', () => {
  const full = (): State => {
    let s = started(
      liveState({ accounts: 2 }),
      EVENING,
      { event: { name: 'CPI', time: '08:30' } },
      EVENING,
    );
    s = confirmPlan(s, ROUTINE, OPEN);
    s = setRegime(s, ROUTINE, 'directional', after(OPEN, 1));
    s = markLine(s, ROUTINE, 'Call wall', 'baiting', null, after(OPEN, 1));
    s = entered(s, after(OPEN, 3));
    s = recordPartial(s, ROUTINE, 'a1', after(OPEN, 4));
    s = recordExit(
      s,
      ROUTINE,
      'a1',
      { kind: 'stopped', result: 'loss', loss: 150 },
      after(OPEN, 5),
    );
    return feelRushed(s, ROUTINE, after(OPEN, 6));
  };

  it('round-trips every live field through the saved data and a backup', () => {
    const s = full();
    expect(decodeState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const restored = restoredState(parseBackup(encodeBackup(s)));
    expect(restored.tradingSessions).toEqual(s.tradingSessions);
    expect(statusAt(restored, after(OPEN, 10)).code).toBe(statusAt(s, after(OPEN, 10)).code);
  });

  it('refuses a session whose live fields do not read back', () => {
    const session = JSON.parse(JSON.stringify(sessionOf(full())));
    expect(decodeTradingSession(session)).toEqual(session);
    const bad = (change: (x: typeof session) => void) => {
      const copy = JSON.parse(JSON.stringify(session));
      change(copy);
      return decodeTradingSession(copy);
    };
    expect(bad((x) => (x.lock.mode = 'turbo'))).toBeNull();
    expect(bad((x) => (x.lock.at = MID))).toBeNull();
    expect(bad((x) => x.theses[0].statusLog.push({ status: 'qualified', at: MID }))).toBeNull();
    expect(bad((x) => (x.attempts[0].stop = 25_050))).toBeNull();
    expect(bad((x) => (x.attempts[0].thesisId = 't9'))).toBeNull();
    expect(bad((x) => (x.assessments[0].fast = true))).toBeNull();
    expect(bad((x) => (x.lines[0].label = 'Call Wall'))).toBeNull();
    expect(bad((x) => (x.plan.event.time = '8:30'))).toBeNull();
    expect(bad((x) => (x.cooldowns[0].until = x.cooldowns[0].at))).toBeNull();
    expect(bad((x) => (x.unknown = 1))).toEqual(expect.objectContaining({ unknown: 1 }));
    expect(bad((x) => (x.lock.limits.extra = 1))).toBeNull();
    expect(bad((x) => (x.startedAt = null))).toBeNull();
    // Two positions open at once never read back.
    expect(
      bad((x) => {
        delete x.attempts[0].exit;
        x.attempts.push({ ...x.attempts[0], id: 'a2' });
      }),
    ).toBeNull();
  });

  it('keeps every restriction across a restart, navigation and a restore of the same backup', () => {
    const s = endSession(full(), ROUTINE, 'hard-stop', after(OPEN, 40));
    const restarted = decodeState(JSON.parse(JSON.stringify(s)));
    const restored = restoredState(parseBackup(encodeBackup(s)));
    for (const state of [s, restarted, restored]) {
      expect(statusAt(state, after(OPEN, 41)).code).toBe('SESSION_STOPPED');
      expect(statusAt(state, z('2026-11-10T23:30')).code).toBe('SESSION_STOPPED');
    }
  });
});

describe('the context', () => {
  it('reads the candle by New York time and the previous candle beside it', () => {
    const ctx: LiveContext = ctxAt(started(), EVENING);
    expect(ctx.candle).toBe(TUE);
    expect(ctx.previous).toBeNull();
    expect(ctxAt(started(), z('2026-11-10T23:30')).candle).toBe(WED);
    expect(ctxAt(started(), z('2026-11-10T23:30')).previous?.date).toBe(TUE);
  });

  it('keeps a setup reading change within ten seconds as one record', () => {
    let s = assess(started(), ROUTINE, { zone: 'at' }, after(OPEN, 1));
    s = assess(
      s,
      ROUTINE,
      { setup: 'pierce-push' },
      new Date(Date.parse(after(OPEN, 1)) + 5_000).toISOString(),
    );
    expect(sessionOf(s).assessments).toHaveLength(1);
    s = assess(s, ROUTINE, { timeframe: '15m' }, after(OPEN, 2));
    expect(sessionOf(s).assessments).toHaveLength(2);
    expect(sessionOf(s).assessments![1]).toMatchObject({
      zone: 'at',
      setup: 'pierce-push',
      timeframe: '15m',
    });
    expect(() => assess(s, ROUTINE, { entry: 25_040.1 }, after(OPEN, 3))).toThrow(
      /not on the 0.25 tick/,
    );
  });
});
