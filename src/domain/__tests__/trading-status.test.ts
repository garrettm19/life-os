import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { State } from '../model';
import { setBias, newSession, saveTradingReview, tradingBook } from '../trading';
import {
  answerReset,
  assess,
  confirmPlan,
  endSession,
  feelRushed,
  markLine,
  recordExit,
  reportLoss,
  retireThesis,
  savePlan,
  setLiveTrading,
  setRegime,
} from '../trading-live';
import { StatusCode } from '../trading-live-model';
import { putTradingSession } from '../trading-sessions';
import { saveStrategy, defaultStrategy } from '../trading-strategy';
import {
  STATUS_TABLE,
  enterAttempt,
  liveDiscipline,
  logTakenAttempt,
  tradeStatus,
} from '../trading-status';
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
  after,
  ctxAt,
  liveState,
  ready,
  sessionOf,
  started,
  statusAt,
  z,
} from '../../test-support/trading-live';

// Every row of the status table, each when it holds, when it does not, and how missing data
// reads. Synthetic data only: an example instrument and invented round prices.

const code = (state: State, at: string): StatusCode => statusAt(state, at).code;
const entered = (state = started(), at = after(OPEN, 2)) =>
  enterAttempt(ready(state, after(OPEN, 1)), ROUTINE, at);
/** A first attempt stopped out at 10:00 AM, its loss cooldown (25 minutes) over by 10:30 AM. */
const stoppedOnce = () => recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
const LATER = after(MID, 30);

describe('the status table', () => {
  it('lists every status once, in the order the selector checks them', () => {
    const codes = STATUS_TABLE.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([
      'LOAD_FAILED',
      'RECONCILE_POSITION',
      'IN_POSITION',
      'SESSION_STOPPED',
      'UNKNOWN_EXPOSURE',
      'COOLDOWN',
      'PRACTICE_ONLY',
      'REVIEW_FIRST',
      'NO_BIAS',
      'NO_PLAN',
      'NOT_STARTED',
      'OUTSIDE_WINDOW',
      'REGIME_RANGE',
      'THESIS_EXHAUSTED',
      'THESIS_COMPLETED',
      'THESIS_INVALIDATED',
      'NO_THESIS',
      'LINE_BLOCKED',
      'RESET_ANSWER',
      'SECOND_ATTEMPT_WAIT',
      'PLAN_RECONFIRM',
      'MISSED',
      'WAITING_ZONE',
      'WAITING_SETUP',
      'SETUP_FORMING',
      'CONFIRMATION_INCOMPLETE',
      'RISK_NEEDED',
      'RISK_BLOCKED',
      'CHECKS_COMPLETE',
    ]);
    // Only practice is a banner; nothing says a trade is approved.
    expect(STATUS_TABLE.filter((r) => r.banner).map((r) => r.code)).toEqual(['PRACTICE_ONLY']);
    expect(STATUS_TABLE.some((r) => /approved|go\b/i.test(r.title))).toBe(false);
    // The regime not assessed is no row: it never blocks.
    expect(codes).not.toContain('REGIME_UNKNOWN');
    // Each row says what it rests on: the app's own records and clock, or the trader's report.
    const basis = (b: string) =>
      STATUS_TABLE.filter((r) => r.basis === b).map((r) => r.code as string);
    expect(basis('report')).toEqual([
      'NO_BIAS',
      'REGIME_RANGE',
      'LINE_BLOCKED',
      'MISSED',
      'WAITING_ZONE',
      'WAITING_SETUP',
      'SETUP_FORMING',
      'CONFIRMATION_INCOMPLETE',
      'RISK_NEEDED',
      'CHECKS_COMPLETE',
    ]);
    expect(basis('app')).toHaveLength(STATUS_TABLE.length - 10);
  });

  it('takes the first row that holds', () => {
    // A cooldown, a range and a baiting line at once: the cooldown is said.
    let s = setRegime(started(), ROUTINE, 'range', after(OPEN, 1));
    s = markLine(s, ROUTINE, 'Put wall', 'baiting', null, after(OPEN, 2));
    s = feelRushed(s, ROUTINE, after(OPEN, 3));
    expect(code(s, after(OPEN, 4))).toBe('COOLDOWN');
    // The session stopped on top of them: the stop is said.
    s = endSession(s, ROUTINE, 'hard-stop', after(OPEN, 5));
    expect(code(s, after(OPEN, 6))).toBe('SESSION_STOPPED');
    // After the cooldown, before the stop: the range, then the line.
    const r = setRegime(
      markLine(started(), ROUTINE, 'Put wall', 'baiting', null, after(OPEN, 1)),
      ROUTINE,
      'range',
      after(OPEN, 2),
    );
    expect(code(r, after(OPEN, 3))).toBe('REGIME_RANGE');
    expect(code(setRegime(r, ROUTINE, 'directional', after(OPEN, 4)), after(OPEN, 5))).toBe(
      'LINE_BLOCKED',
    );
  });
});

describe('each row', () => {
  it('LOAD_FAILED: either record unreadable; never read as an empty day', () => {
    const s = started();
    expect(code(s, after(OPEN, 1))).not.toBe('LOAD_FAILED');
    expect(code({ ...s, tradingSessionsUnreadable: { [TUE]: '{' } }, after(OPEN, 1))).toBe(
      'LOAD_FAILED',
    );
    // The previous candle's record unknown: its stop could hold this one, so nothing opens.
    expect(code({ ...liveState(), tradingSessionsUnreadable: { [MON]: 'x' } }, OPEN)).toBe(
      'LOAD_FAILED',
    );
  });

  it('RECONCILE_POSITION: a trade left open on the previous candle', () => {
    const mon = z('2026-11-09T14:40');
    let s = started(liveState(), mon);
    s = enterAttempt(ready(s, after(mon, 1)), ROUTINE, after(mon, 2));
    const st = statusAt(s, OPEN);
    expect(st.code).toBe('RECONCILE_POSITION');
    expect(st.tone).toBe('position');
    // "Closed in broker earlier" reconciles it; the loss is unknown until reported.
    s = recordExit(s, ROUTINE, 'a1', { kind: 'reconciled' }, OPEN);
    expect(sessionOf(s, MON).attempts![0].exit).toMatchObject({ kind: 'reconciled' });
    expect(code(s, after(OPEN, 1))).not.toBe('RECONCILE_POSITION');
  });

  it("IN_POSITION: a trade open now, whatever else holds; a missing stop reads 'not set'", () => {
    const s = entered();
    expect(statusAt(s, after(OPEN, 3))).toMatchObject({ code: 'IN_POSITION', tone: 'position' });
    // A trade logged after the fact without a stop is still a position to manage.
    const taken = logTakenAttempt(
      liveState(),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: null, contracts: 1 },
      after(OPEN, 1),
    );
    expect(statusAt(taken, after(OPEN, 2)).reason).toMatch(/stop not set/);
  });

  it('SESSION_STOPPED: a hard stop holds the next candle until its 9:30 AM window', () => {
    const s = endSession(started(), ROUTINE, 'hard-stop', MID);
    expect(statusAt(s, after(MID, 1))).toMatchObject({ code: 'SESSION_STOPPED', tone: 'stop' });
    // Wednesday's 6 PM window (Tuesday evening) stays stopped; 9:30 AM Wednesday opens.
    expect(code(s, z('2026-11-10T23:30'))).toBe('SESSION_STOPPED');
    expect(code(s, z('2026-11-11T14:29'))).toBe('SESSION_STOPPED');
    expect(code(s, z('2026-11-11T14:31'))).not.toBe('SESSION_STOPPED');
    // Finished ends only its candle.
    const done = endSession(started(), ROUTINE, 'finished', MID);
    expect(code(done, after(MID, 1))).toBe('SESSION_STOPPED');
    expect(code(done, z('2026-11-10T23:30'))).not.toBe('SESSION_STOPPED');
    // A record ended by an earlier build counts as its stop.
    const legacy = putTradingSession(liveState(), {
      ...newSession(TUE),
      startedAt: OPEN,
      doneAt: MID,
      doneReason: 'hard-stop',
    });
    expect(code(legacy, after(MID, 1))).toBe('SESSION_STOPPED');
    expect(code(legacy, z('2026-11-10T23:30'))).toBe('SESSION_STOPPED');
  });

  it('SESSION_STOPPED: the candle reviewed', () => {
    const s = started();
    const reviewed = saveTradingReview(
      s,
      {
        date: TUE,
        routineId: ROUTINE,
        session: 'no-trade',
        answers: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
        ),
        violations: [],
        entries: null,
        failedTheses: null,
        note: '',
      },
      'r1',
      after(OPEN, 2),
    );
    expect(code(reviewed, after(OPEN, 3))).toBe('SESSION_STOPPED');
  });

  it('UNKNOWN_EXPOSURE: a closed trade with no known loss, until it is reported', () => {
    let s = logTakenAttempt(
      started(),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: null, contracts: 1 },
      after(OPEN, 1),
    );
    s = recordExit(s, ROUTINE, 'a1', { kind: 'flat' }, after(OPEN, 5));
    // Logged with no stop, it ended the session at once; past that stop the exposure holds.
    expect(statusAt(s, after(OPEN, 40)).code).toBe('SESSION_STOPPED');
    expect(statusAt(s, after(OPEN, 40)).facts.dailyLeft?.amount).toBeNull();
    const nextOpen = z('2026-11-11T14:31');
    expect(code(s, nextOpen)).toBe('UNKNOWN_EXPOSURE');
    s = reportLoss(s, ROUTINE, 'a1', 60, after(OPEN, 41));
    expect(code(s, nextOpen)).not.toBe('UNKNOWN_EXPOSURE');
    expect(statusAt(s, after(OPEN, 42)).facts.dailyLeft).toEqual({ amount: 240, planned: false });
  });

  it('COOLDOWN: I FEEL RUSHED, also carried over the 6 PM roll', () => {
    const s = feelRushed(started(), ROUTINE, OPEN);
    const st = statusAt(s, after(OPEN, 10));
    expect(st.code).toBe('COOLDOWN');
    expect(st.reason).toBe('Step away. Back after 10:05 AM New York.');
    expect(code(s, after(OPEN, 26))).not.toBe('COOLDOWN');
    // Pressed at 5:50 PM on Monday's candle, it holds Tuesday's candle until 6:15 PM.
    const late = feelRushed(liveState(), ROUTINE, z('2026-11-09T22:50'));
    expect(ctxAt(late, z('2026-11-09T23:05')).candle).toBe(TUE);
    expect(code(late, z('2026-11-09T23:05'))).toBe('COOLDOWN');
    expect(code(late, z('2026-11-09T23:16'))).not.toBe('COOLDOWN');
  });

  it('PRACTICE_ONLY: a banner while live trading is off, paused, study only or on an event day', () => {
    const off = statusAt(started(), after(OPEN, 1));
    expect(off.banner).toBe('PAUSED — PRACTICE ONLY');
    expect(off.practice).toBe(true);
    expect(off.notes[0]).toMatch(/Live trading is off/);
    // Absent reads as off.
    expect(tradingBook(liveState())!.trading!.liveTrading).toBeUndefined();
    const live = statusAt(started(liveState(LIVE)), after(OPEN, 1));
    expect(live.banner).toBeNull();
    expect(live.facts.mode).toBe('live');
    const event = statusAt(
      started(liveState(LIVE), OPEN, { event: { name: 'FOMC', time: '14:00' } }),
      after(OPEN, 1),
    );
    expect(event.banner).toBe('PAUSED — PRACTICE ONLY');
    expect(event.notes.join(' ')).toMatch(/FOMC at 2:00 PM New York/);
  });

  it('REVIEW_FIRST: before the start, an earlier session that ran has no review', () => {
    const mon = z('2026-11-09T14:40');
    const s = savePlan(started(liveState(), mon), ROUTINE, PLAN, OPEN);
    expect(statusAt(s, after(OPEN, 1))).toMatchObject({ code: 'REVIEW_FIRST' });
    expect(statusAt(s, after(OPEN, 1)).reason).toBe('The session of Mon, Nov 9 has no review yet.');
  });

  it('NO_BIAS: Unclear; no bias at all reads as preparation incomplete', () => {
    const unclear = putTradingSession(liveState(), setBias(newSession(TUE), 'unclear', PRE));
    expect(code(unclear, OPEN)).toBe('NO_BIAS');
    expect(code(liveState(), OPEN)).toBe('NO_PLAN');
  });

  it('NO_PLAN: lists what is missing, a limit not set included', () => {
    const none = statusAt(liveState(), OPEN);
    expect(none.code).toBe('NO_PLAN');
    expect(none.reason).toMatch(/Set the HTF plan/);
    const noRisk = statusAt(
      savePlan(
        liveState({ risk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300 } }),
        ROUTINE,
        PLAN,
        PRE,
      ),
      OPEN,
    );
    expect(noRisk.code).toBe('NO_PLAN');
    expect(noRisk.reason).toBe('Set your risk per trade in Your limits.');
  });

  it('NOT_STARTED: the plan is ready and nothing started', () => {
    expect(code(savePlan(liveState(), ROUTINE, PLAN, PRE), OPEN)).toBe('NOT_STARTED');
  });

  it('OUTSIDE_WINDOW: a live session between the windows; practice skips it', () => {
    const live = started(liveState(LIVE), EVENING, {}, EVENING);
    expect(code(live, PRE)).toBe('OUTSIDE_WINDOW');
    expect(code(started(liveState(), EVENING, {}, EVENING), PRE)).not.toBe('OUTSIDE_WINDOW');
  });

  it('a session started live stays live to the end of its candle: off or a restore applies next', () => {
    const live = started(liveState(LIVE), EVENING, {}, EVENING);
    // Turned off during the session, or a restore of a backup taken during it (which leaves the
    // switch off): the trades are still real at the broker, so the live rules hold.
    const off = setLiveTrading(live, ROUTINE, false, after(EVENING, 5));
    const restored = restoredState(parseBackup(encodeBackup(live, after(EVENING, 10))));
    for (const s of [off, restored]) {
      expect(tradingBook(s)!.trading!.liveTrading).not.toBe(true);
      expect(sessionOf(s).lock!.mode).toBe('live');
      const between = statusAt(s, PRE);
      expect(between.code).toBe('OUTSIDE_WINDOW');
      expect(between).toMatchObject({ practice: false, banner: null });
      expect(between.notes).toContain('Live trading is off from the next session.');
      const confirmed = confirmPlan(s, ROUTINE, OPEN);
      const entered = enterAttempt(ready(confirmed, after(OPEN, 1)), ROUTINE, after(OPEN, 2));
      expect(sessionOf(entered).attempts![0].practice).toBe(false);
    }
    // A session that never started live reads as practice at once.
    const unstarted = setLiveTrading(liveState(LIVE), ROUTINE, false, EVENING);
    expect(statusAt(started(unstarted, EVENING, {}, EVENING), PRE).practice).toBe(true);
  });

  it('REGIME_RANGE: only Range / chop blocks; no chip never does', () => {
    const s = started();
    expect(statusAt(s, after(OPEN, 1)).facts.regime).toBeNull();
    expect(code(s, after(OPEN, 1))).toBe('WAITING_ZONE');
    expect(code(setRegime(s, ROUTINE, 'range', after(OPEN, 1)), after(OPEN, 2))).toBe(
      'REGIME_RANGE',
    );
    for (const kind of ['directional', 'candidate', 'confirmed'] as const)
      expect(code(setRegime(s, ROUTINE, kind, after(OPEN, 1)), after(OPEN, 2))).toBe(
        'WAITING_ZONE',
      );
  });

  it('THESIS_EXHAUSTED, THESIS_COMPLETED, THESIS_INVALIDATED and NO_THESIS', () => {
    // Three losses in a row end this session (two by default), so the thesis's own status shows.
    const once = recordExit(
      entered(started(liveState({ maxLossRun: 3 }))),
      ROUTINE,
      'a1',
      { kind: 'stopped' },
      MID,
    );
    let s = answerReset(once, ROUTINE, 't1', true, LATER);
    s = enterAttempt(ready(s, after(LATER, 1)), ROUTINE, after(LATER, 2));
    s = recordExit(s, ROUTINE, 'a2', { kind: 'stopped' }, after(LATER, 3));
    const exhausted = statusAt(s, after(LATER, 60));
    expect(exhausted.code).toBe('THESIS_EXHAUSTED');
    expect(exhausted.reason).toBe(
      'Two failed attempts. This idea is retired. Do not re-enter the same setup.',
    );
    expect(exhausted.notes).toContain(
      'Two failed attempts near the same area. Possible range conditions. Thesis exhausted.',
    );
    expect(exhausted.next).not.toMatch(/day/i);
    const won = recordExit(entered(), ROUTINE, 'a1', { kind: 'objective' }, MID);
    expect(code(won, after(MID, 1))).toBe('THESIS_COMPLETED');
    const broken = recordExit(entered(), ROUTINE, 'a1', { kind: 'invalidated' }, MID);
    expect(code(broken, after(MID, 40))).toBe('THESIS_INVALIDATED');
    expect(code(retireThesis(started(), ROUTINE, 't1', after(OPEN, 1)), after(OPEN, 2))).toBe(
      'NO_THESIS',
    );
  });

  it('LINE_BLOCKED: baiting by two failures or one tap, or invalidated', () => {
    const marked = markLine(started(), ROUTINE, ' put  WALL ', 'baiting', null, after(OPEN, 1));
    expect(statusAt(marked, after(OPEN, 2))).toMatchObject({
      code: 'LINE_BLOCKED',
      title: 'NO ENTRY — LINE IS BAITING',
    });
    const invalid = markLine(
      started(),
      ROUTINE,
      'Put wall',
      'invalidated',
      'Broke and held below',
      after(OPEN, 1),
    );
    expect(statusAt(invalid, after(OPEN, 2)).title).toBe('NO ENTRY — LINE INVALIDATED');
    expect(code(started(), after(OPEN, 2))).not.toBe('LINE_BLOCKED');
  });

  it('RESET_ANSWER: after a failed attempt, once the cooldown is over', () => {
    const s = stoppedOnce();
    expect(code(s, after(MID, 10))).toBe('COOLDOWN');
    expect(statusAt(s, LATER)).toMatchObject({
      code: 'RESET_ANSWER',
      reason: 'A stop-out does not authorize another entry.',
    });
    expect(statusAt(s, LATER).notes).toContain('Mark it on your chart too.');
  });

  it('SECOND_ATTEMPT_WAIT: a reading from before the failure never counts', () => {
    const s = answerReset(stoppedOnce(), ROUTINE, 't1', true, LATER);
    expect(code(s, after(LATER, 1))).toBe('SECOND_ATTEMPT_WAIT');
    expect(code(ready(s, after(LATER, 1)), after(LATER, 2))).toBe('CHECKS_COMPLETE');
    expect(statusAt(ready(s, after(LATER, 1)), after(LATER, 2)).basis).toBe('report');
  });

  it('a reading never qualifies during a cooldown or before the reset is answered', () => {
    // Before the answer and during the loss cooldown, no reading can be saved.
    expect(() => ready(stoppedOnce(), after(MID, 5))).toThrow(/Step away/);
    expect(() => ready(stoppedOnce(), LATER)).toThrow(/Answer the reset first/);
    // A complete reading, then I FEEL RUSHED: after the cooldown it no longer counts.
    const rushed = feelRushed(ready(started(), after(OPEN, 1)), ROUTINE, after(OPEN, 2));
    expect(() => ready(rushed, after(OPEN, 3))).toThrow(/Step away/);
    expect(statusAt(rushed, after(OPEN, 3)).basis).toBe('app');
    expect(code(rushed, after(OPEN, 28))).toBe('WAITING_ZONE');
    expect(code(ready(rushed, after(OPEN, 28)), after(OPEN, 29))).toBe('CHECKS_COMPLETE');
  });

  it('PLAN_RECONFIRM: a plan from the 6 PM lock needs one tap at 9:30 AM', () => {
    const s = started(liveState(), EVENING, {}, EVENING);
    expect(code(s, after(EVENING, 5))).toBe('WAITING_ZONE');
    const st = statusAt(s, OPEN);
    expect(st.code).toBe('PLAN_RECONFIRM');
    expect(st.reason).toBe('Plan from the 6 PM GEX — still valid now?');
    const confirmed = confirmPlan(s, ROUTINE, OPEN);
    expect(code(confirmed, after(OPEN, 1))).toBe('WAITING_ZONE');
    // I'm ready never confirms it: a plan saved on Saturday for Monday's candle, before its first
    // lock opened, asks for the one tap after the start on Sunday evening (rewritten: the start
    // used to confirm it silently).
    const sunday = z('2026-11-08T23:30');
    const early = started(liveState(), sunday, {}, z('2026-11-07T15:00'));
    expect(sessionOf(early, MON).plan!.lock).toBeNull();
    expect(sessionOf(early, MON).plan!.confirmed).toBeUndefined();
    expect(code(early, after(sunday, 1))).toBe('PLAN_RECONFIRM');
    const tapped = confirmPlan(early, ROUTINE, after(sunday, 1));
    expect(sessionOf(tapped, MON).plan!.confirmed).toEqual([
      { lock: 'evening', at: after(sunday, 1) },
    ]);
    expect(code(tapped, after(sunday, 2))).toBe('WAITING_ZONE');
    // A plan from 6 PM started at 9:40 AM: the start leaves it unconfirmed too.
    const morning = started(liveState(), OPEN, {}, EVENING);
    expect(code(morning, after(OPEN, 1))).toBe('PLAN_RECONFIRM');
  });

  it('MISSED: price left the area without an entry', () => {
    const s = assess(started(), ROUTINE, { zone: 'left' }, after(OPEN, 1));
    expect(statusAt(s, after(OPEN, 2))).toMatchObject({
      code: 'MISSED',
      title: 'MISSED ENTRY — DO NOT CHASE',
    });
  });

  it('WAITING_ZONE: away or not reported; a conditional plan says so', () => {
    expect(code(started(), after(OPEN, 1))).toBe('WAITING_ZONE');
    expect(code(assess(started(), ROUTINE, { zone: 'away' }, after(OPEN, 1)), after(OPEN, 2))).toBe(
      'WAITING_ZONE',
    );
    const conditional = started(liveState(), OPEN, { conditional: true });
    expect(statusAt(conditional, after(OPEN, 1)).reason).toBe(
      'Conditional plan: wait for the move into Put wall.',
    );
  });

  it('WAITING_SETUP, SETUP_FORMING and CONFIRMATION_INCOMPLETE', () => {
    const at = assess(started(), ROUTINE, { zone: 'at' }, after(OPEN, 1));
    expect(code(at, after(OPEN, 2))).toBe('WAITING_SETUP');
    expect(
      code(assess(at, ROUTINE, { setup: 'pierce-push' }, after(OPEN, 2)), after(OPEN, 3)),
    ).toBe('WAITING_SETUP');
    const forming = ready(started(), after(OPEN, 1), { confirmed: false });
    expect(code(forming, after(OPEN, 2))).toBe('SETUP_FORMING');
    const wick = ready(started(), after(OPEN, 1), { cisd: 'single-wick' });
    expect(statusAt(wick, after(OPEN, 2))).toMatchObject({ code: 'CONFIRMATION_INCOMPLETE' });
    const b = ready(started(), after(OPEN, 1), { setup: 'sweep-retake' });
    expect(statusAt(b, after(OPEN, 2)).reason).toBe(
      "Write Setup B's retake rule in My Trading Strategy first.",
    );
  });

  it('RISK_NEEDED: no entry or no structural stop', () => {
    expect(code(ready(started(), after(OPEN, 1), { stop: null }), after(OPEN, 2))).toBe(
      'RISK_NEEDED',
    );
    expect(code(ready(started(), after(OPEN, 1), { entry: null }), after(OPEN, 2))).toBe(
      'RISK_NEEDED',
    );
  });

  it('RISK_BLOCKED: the size check names the first problem', () => {
    const title = (more: Parameters<typeof ready>[2]) =>
      statusAt(ready(started(), after(OPEN, 1), more), after(OPEN, 2)).title;
    expect(title({ stop: 25_050 })).toBe('NO ENTRY — STOP ON THE WRONG SIDE');
    expect(title({ entry: 25_120, stop: 25_110 })).toBe('NO ENTRY — ENTRY PAST THE TARGET');
    expect(title({ entry: 25_100, stop: 25_000 })).toBe('NO ENTRY — STOP TOO WIDE');
  });

  it('CHECKS_COMPLETE: never approval, always self-reported, app-level', () => {
    const st = statusAt(ready(started(), after(OPEN, 1)), after(OPEN, 2));
    expect(st).toMatchObject({
      code: 'CHECKS_COMPLETE',
      title: 'SETUP CHECKS COMPLETE — SELF-REPORTED',
      reason: 'Your own read. Life OS cannot see the market or your broker.',
      tone: 'ready',
    });
    expect(st.notes).toContain(
      'An app-level restriction, not a broker lockout: Life OS cannot see or stop your orders.',
    );
    // Setup B completes once its retake rule is written.
    const rule = saveStrategy(
      started(),
      ROUTINE,
      { ...defaultStrategy(), retakeRule: 'A 5m body back above the level' },
      PRE,
    );
    expect(code(ready(rule, after(OPEN, 1), { setup: 'sweep-retake' }), after(OPEN, 2))).toBe(
      'CHECKS_COMPLETE',
    );
  });

  it('reads the same status from the same records, whatever screen asks', () => {
    const s = ready(started(), after(OPEN, 1));
    expect(tradeStatus(ctxAt(s, after(OPEN, 2)))).toEqual(tradeStatus(ctxAt(s, after(OPEN, 2))));
  });
});

describe('the review pre-fill', () => {
  it('gives the bias-side and named-setup answers from the attempts, and nothing else', () => {
    expect(liveDiscipline(sessionOf(started()))).toBeNull();
    expect(liveDiscipline(sessionOf(entered()))).toEqual({
      labeled: null,
      distinguished: null,
      withBias: true,
      namedSetups: true,
      noPrediction: null,
      followedPlan: null,
    });
    // A short taken outside the cockpit on a bullish day: against the bias, no setup named first.
    const taken = logTakenAttempt(
      stoppedOnce(),
      ROUTINE,
      { side: 'short', entry: 25_040, stop: 25_060, contracts: 1 },
      LATER,
    );
    expect(liveDiscipline(sessionOf(taken))).toMatchObject({
      withBias: false,
      namedSetups: false,
    });
  });
});
