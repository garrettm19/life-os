import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { decodeState } from '../data';
import { candleDate } from '../market-clock';
import { State } from '../model';
import { upsertRoutine } from '../routines';
import {
  VIOLATION_IDS,
  loseAccountSet,
  saveTradingProfile,
  saveTradingReview,
  setBias,
  tradingBook,
} from '../trading';
import {
  answerReset,
  assess,
  confirmPlan,
  endSession,
  feelRushed,
  lockSession,
  markLine,
  newThesis,
  recordExit,
  recordPartial,
  reportLoss,
  retireThesis,
  savePlan,
  setRegime,
  stopUntil,
} from '../trading-live';
import { defaultStrategy, saveStrategy, strategyOf } from '../trading-strategy';
import { enterAttempt, logTakenAttempt, reviewFacts } from '../trading-status';
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

// Trading scenarios, the attempt rules, the strategy integration and the known ways around a
// restriction, each as a regression test on the domain. Synthetic data only: an example
// instrument, example limits ($100 a trade, $150 a thesis, $300 a day, 5 contracts) and invented
// prices. Instants are UTC; every rule reads New York time, so the suite holds in any zone.

const code = (s: State, at: string) => statusAt(s, at).code;
const enter = (s: State, at: string) => enterAttempt(ready(s, at), ROUTINE, after(at, 1));
const stop = (s: State, id: string, at: string, loss?: number) =>
  recordExit(s, ROUTINE, id, { kind: 'stopped', ...(loss !== undefined && { loss }) }, at);
/**
 * Attempt 1 stopped at 10:00 AM, the reset answered Yes at 10:30 AM. Three losses in a row end
 * this session (two by default), so what holds after two failed attempts on a thesis stays in view.
 */
const afterFirstLoss = () =>
  answerReset(
    stop(enter(started(liveState({ maxLossRun: 3 })), after(OPEN, 1)), 'a1', MID),
    ROUTINE,
    't1',
    true,
    after(MID, 30),
  );
/** Both attempts on the plan thesis stopped by 10:35 AM. */
const exhausted = () => stop(enter(afterFirstLoss(), after(MID, 31)), 'a2', after(MID, 35));
const NEW = {
  where: 'Call wall',
  changed: 'Range broke; price retested the call wall from above',
  target: 25_200,
  invalidation: 25_100,
};
const LATE = after(MID, 120);
const answers = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
);

describe('the brief: bias is not permission', () => {
  it('1. a strong HTF bias in a ranging market: no entry, and no new thesis while it ranges', () => {
    const s = setRegime(ready(started(), after(OPEN, 1)), ROUTINE, 'range', after(OPEN, 2));
    expect(code(s, after(OPEN, 3))).toBe('REGIME_RANGE');
    expect(() => enterAttempt(s, ROUTINE, after(OPEN, 3))).toThrow(/RANGE \/ CHOP/);
    const done = setRegime(exhausted(), ROUTINE, 'range', LATE);
    expect(() => newThesis(done, ROUTINE, NEW, after(LATE, 1))).toThrow(
      'Range / chop: no new thesis while it ranges.',
    );
  });

  it('2. a plan and a bias without a setup: waiting, never an entry', () => {
    const s = started();
    expect(code(s, after(OPEN, 1))).toBe('WAITING_ZONE');
    expect(() => enterAttempt(s, ROUTINE, after(OPEN, 1))).toThrow(/WAITING FOR ZONE/);
  });

  it('3. a major event day: no live trading, practice allowed and labelled', () => {
    const s = started(liveState(LIVE), OPEN, {
      event: { name: 'FOMC', time: '14:00' },
    });
    expect(sessionOf(s).lock!.mode).toBe('practice');
    const st = statusAt(ready(s, after(OPEN, 1)), after(OPEN, 2));
    expect(st).toMatchObject({
      code: 'CHECKS_COMPLETE',
      practice: true,
      banner: 'PAUSED — PRACTICE ONLY',
    });
    expect(st.notes[0]).toBe('Major event today: FOMC at 2:00 PM New York. No live trading.');
  });

  it('4. I FEEL RUSHED: a cooldown at once, kept on the record, never ended early', () => {
    let s = feelRushed(started(), ROUTINE, after(OPEN, 5));
    expect(statusAt(s, after(OPEN, 6)).reason).toBe('Step away. Back after 10:10 AM New York.');
    // Pressing it again only adds one; nothing shortens the first.
    s = feelRushed(s, ROUTINE, after(OPEN, 10));
    expect(sessionOf(s).cooldowns!.map((c) => c.until)).toEqual([after(OPEN, 30), after(OPEN, 35)]);
    const restored = restoredState(parseBackup(encodeBackup(s)));
    expect(code(restored, after(OPEN, 33))).toBe('COOLDOWN');
    expect(code(restored, after(OPEN, 36))).not.toBe('COOLDOWN');
  });

  it('5. after a loss: a cooldown, then a new setup, never the same reading again', () => {
    const s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    expect(code(s, after(MID, 5))).toBe('COOLDOWN');
    const yes = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    expect(code(yes, after(MID, 31))).toBe('SECOND_ATTEMPT_WAIT');
  });

  it('6. an ended session never revives: not by a new record, a bias change, a reload or a restore', () => {
    const s = endSession(started(), ROUTINE, 'hard-stop', MID);
    expect(() => setBias(sessionOf(s), 'bearish', after(MID, 1))).toThrow();
    expect(() => lockSession(s, ROUTINE, after(MID, 1))).toThrow(/A hard stop ended the session/);
    // 6 PM opens a new candle record: still stopped, and its plan cannot start a session.
    const evening = savePlan(s, ROUTINE, PLAN, z('2026-11-10T23:30'));
    expect(code(evening, z('2026-11-10T23:31'))).toBe('SESSION_STOPPED');
    expect(() => lockSession(evening, ROUTINE, z('2026-11-10T23:31'))).toThrow(
      /No new trading until 9:30 AM New York, Wed, Nov 11/,
    );
    for (const again of [
      decodeState(JSON.parse(JSON.stringify(evening))),
      restoredState(parseBackup(encodeBackup(evening))),
    ])
      expect(code(again, z('2026-11-10T23:31'))).toBe('SESSION_STOPPED');
  });

  it('7. unknown exposure never reads as zero or within limits', () => {
    let s = logTakenAttempt(
      started(),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: null, contracts: 1 },
      after(OPEN, 1),
    );
    s = recordExit(s, ROUTINE, 'a1', { kind: 'reconciled' }, after(OPEN, 3));
    // Logged with no stop, it ended the session at once; the exposure holds past that stop.
    const st = statusAt(s, after(OPEN, 40));
    expect(st.code).toBe('SESSION_STOPPED');
    expect(code(s, z('2026-11-11T14:31'))).toBe('UNKNOWN_EXPOSURE');
    expect(st.facts.sessionLoss.unknown).toBe(true);
    expect(st.facts.dailyLeft!.amount).toBeNull();
    expect(reviewFacts(sessionOf(s)).facts.find((f) => f.key === 'within-limits')!.value).toBe(
      false,
    );
  });

  it('8. a plan from an earlier GEX lock never reads as current', () => {
    const s = ready(started(liveState(), EVENING, {}, EVENING), OPEN);
    expect(code(s, after(OPEN, 1))).toBe('PLAN_RECONFIRM');
  });

  it('9. Setup B cannot complete until its retake rule is written', () => {
    const s = ready(started(), after(OPEN, 1), { setup: 'sweep-retake' });
    expect(code(s, after(OPEN, 2))).toBe('CONFIRMATION_INCOMPLETE');
    const written = saveStrategy(
      s,
      ROUTINE,
      { ...defaultStrategy(), retakeRule: 'A 5m close back above the level' },
      after(OPEN, 2),
    );
    expect(code(written, after(OPEN, 3))).toBe('CHECKS_COMPLETE');
  });

  it('10. a setup named before the entry is on record, apart from a trade logged after the fact', () => {
    let s = enter(started(), after(OPEN, 1));
    s = recordExit(s, ROUTINE, 'a1', { kind: 'objective' }, MID);
    const reading = sessionOf(s).assessments![0];
    expect(reading.at < sessionOf(s).attempts![0].openedAt).toBe(true);
    expect(reviewFacts(sessionOf(s)).facts.find((f) => f.key === 'named-first')!.value).toBe(true);
    const taken = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_050, stop: 25_040, contracts: 1 },
      after(MID, 6),
    );
    expect(reviewFacts(sessionOf(taken)).facts.find((f) => f.key === 'named-first')!.value).toBe(
      false,
    );
  });

  it('11. limits are set outside the session and locked; a raise after a loss changes nothing', () => {
    let s = stop(enter(started(), after(OPEN, 1)), 'a1', MID, 100);
    const book = tradingBook(s)!;
    s = saveTradingProfile(
      s,
      ROUTINE,
      {
        ...book.trading!,
        risk: { tradeRisk: 1_000, thesisRisk: 5_000, dailyLoss: 9_000, maxContracts: 50 },
      },
      after(MID, 1),
    );
    const st = statusAt(answerReset(s, ROUTINE, 't1', true, after(MID, 30)), after(MID, 31));
    expect(st.facts.limits).toMatchObject({
      tradeRisk: 100,
      thesisRisk: 150,
      dailyLoss: 300,
      maxContracts: 5,
    });
    expect(st.facts.thesisLeft).toEqual({ amount: 50, planned: false });
  });

  it('12. a pause keeps the session practice only; live trading is never turned on by anything else', () => {
    // A lost account set pauses the routine; resuming Programs later does not turn live trading on.
    const lost = loseAccountSet(liveState(LIVE), ROUTINE, PRE);
    expect(statusAt(savePlan(lost, ROUTINE, PLAN, PRE), OPEN).facts.practiceWhy[0]).toMatch(
      /Live trading paused until/,
    );
    const paused = pausedRoutine(liveState(), false);
    expect(sessionOf(started(paused)).lock!.mode).toBe('practice');
    const resumed = pausedRoutine(paused, true);
    expect(sessionOf(started(resumed)).lock!.mode).toBe('practice');
    expect(tradingBook(resumed)!.trading!.liveTrading).toBeUndefined();
  });

  it('13. the daily loss limit, flat exits and taken trades included, stops the session to the next 9:30 AM', () => {
    let s = started();
    s = recordExit(enter(s, after(OPEN, 1)), ROUTINE, 'a1', { kind: 'flat' }, MID);
    s = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    // Logged while the checks were complete, within the risk per trade: it counts, nothing more.
    s = logTakenAttempt(
      ready(s, after(MID, 31)),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_000, contracts: 1 },
      after(MID, 32),
    );
    expect(sessionOf(s).sessionStop).toBeUndefined();
    expect(statusAt(s, after(MID, 33)).facts.sessionLoss.amount).toBe(100);
    s = recordExit(s, ROUTINE, 'a2', { kind: 'stopped', loss: 200 }, after(MID, 35));
    expect(sessionOf(s).sessionStop).toMatchObject({ reason: 'daily-loss' });
    expect(code(s, z('2026-11-10T23:30'))).toBe('SESSION_STOPPED');
    expect(code(s, z('2026-11-11T14:31'))).not.toBe('SESSION_STOPPED');
  });

  it('14. several accounts: one execution, risk counted on each, against limits on each', () => {
    const s = enter(
      started(liveState({ accounts: 3, costs: { commission: 1.2, slippageTicks: 2 } })),
      after(OPEN, 1),
    );
    const st = statusAt(s, after(OPEN, 3));
    expect(sessionOf(s).attempts).toHaveLength(1);
    // $22.20 a contract with costs: 4 contracts on each account, $88.80 each, $266.40 in all.
    expect(sessionOf(s).attempts![0]).toMatchObject({
      contracts: 4,
      accounts: 3,
      plannedRisk: 266.4,
      costsIncluded: true,
    });
    expect(st.code).toBe('IN_POSITION');
    const lost = stop(s, 'a1', MID);
    expect(statusAt(lost, after(MID, 1)).facts.dailyLeft).toEqual({ amount: 633.6, planned: true });
  });

  it('15. a no-trade session is complete as it is: nothing to judge, nothing counted', () => {
    const s = endSession(started(), ROUTINE, 'finished', MID);
    const { facts, counts } = reviewFacts(sessionOf(s));
    expect(facts.filter((f) => f.key !== 'ended').every((f) => f.value === null)).toBe(true);
    expect(counts).toMatchObject({ attempts: 0, failed: 0 });
  });
});

describe('the addendum: attempts per thesis', () => {
  it('1. two failed attempts exhaust one thesis', () => {
    const t = sessionOf(exhausted()).theses![0];
    expect(t.statusLog.at(-1)).toMatchObject({
      status: 'exhausted',
      reason: 'Two failed attempts',
    });
  });

  it('2. a third attempt is rejected', () => {
    expect(() => enterAttempt(exhausted(), ROUTINE, after(MID, 71))).toThrow(/THESIS EXHAUSTED/);
    // No new reading can even be taken on it.
    expect(() => assess(exhausted(), ROUTINE, { zone: 'at' }, after(MID, 70))).toThrow(
      'There is no active thesis.',
    );
  });

  it('3. a first-attempt structural invalidation retires the thesis at once', () => {
    const s = recordExit(
      enter(started(), after(OPEN, 1)),
      ROUTINE,
      'a1',
      { kind: 'invalidated' },
      MID,
    );
    expect(sessionOf(s).theses![0].statusLog.at(-1)!.status).toBe('invalidated');
    expect(code(s, after(MID, 40))).toBe('THESIS_INVALIDATED');
  });

  it('4. a second attempt needs a new qualification after the reset', () => {
    const s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    // The reading before the stop is never reused, during or after the cooldown.
    expect(() => enterAttempt(s, ROUTINE, after(MID, 40))).toThrow(/RESET/);
    const yes = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    expect(() => enterAttempt(yes, ROUTINE, after(MID, 31))).toThrow(
      /NEW SETUP NEEDED FOR ATTEMPT 2/,
    );
    const second = enter(yes, after(MID, 32));
    expect(sessionOf(second).attempts).toHaveLength(2);
    // Sized from what the thesis budget leaves: $50 → 2 contracts.
    expect(sessionOf(second).attempts![1]).toMatchObject({ contracts: 2, plannedRisk: 40 });
  });

  it('5. a genuinely independent thesis can start the same day while the session allows', () => {
    const s = newThesis(exhausted(), ROUTINE, NEW, LATE);
    expect(code(s, after(LATE, 1))).toBe('WAITING_ZONE');
    const go = ready(s, after(LATE, 1), { entry: 25_150, stop: 25_140 });
    expect(code(go, after(LATE, 2))).toBe('CHECKS_COMPLETE');
  });

  it('6. a renamed or slightly changed exhausted thesis cannot pass as new', () => {
    const s = exhausted();
    for (const where of ['Put wall', ' PUT  wall', 'put wall'])
      expect(() =>
        newThesis(s, ROUTINE, { ...NEW, where, target: 25_125, invalidation: 25_005 }, LATE),
      ).toThrow(/Same area/);
    // Another setup, chart or a nudged price at the same line is the same line.
    expect(() =>
      newThesis(
        s,
        ROUTINE,
        {
          ...NEW,
          where: 'Put wall',
          changed: 'Setup C on the 15m now',
          target: 25_121,
          invalidation: 25_001,
        },
        LATE,
      ),
    ).toThrow(/Same area/);
  });

  it('7. a new thesis never resets the session loss', () => {
    const before = statusAt(exhausted(), LATE).facts;
    const after_ = statusAt(newThesis(exhausted(), ROUTINE, NEW, LATE), after(LATE, 1)).facts;
    expect(after_.sessionLoss).toEqual(before.sessionLoss);
    expect(after_.dailyLeft).toEqual(before.dailyLeft);
    expect(after_.dailyLeft!.amount).toBe(160);
  });

  it('8. a new thesis never resets a cooldown', () => {
    const rushed = feelRushed(exhausted(), ROUTINE, LATE);
    expect(() => newThesis(rushed, ROUTINE, NEW, after(LATE, 1))).toThrow(
      /Cooldown: no new thesis/,
    );
    expect(sessionOf(rushed).cooldowns).toHaveLength(3);
  });

  it('9. session-wide restrictions override new-thesis eligibility', () => {
    const stopped = endSession(exhausted(), ROUTINE, 'hard-stop', LATE);
    expect(() => newThesis(stopped, ROUTINE, NEW, after(LATE, 1))).toThrow(
      /A hard stop ended the session/,
    );
    const spent = started(
      liveState({ risk: { tradeRisk: 100, thesisRisk: 150, dailyLoss: 100, maxContracts: 5 } }),
    );
    const lost = stop(enter(spent, after(OPEN, 1)), 'a1', MID);
    expect(() => newThesis(lost, ROUTINE, NEW, LATE)).toThrow(/daily loss limit is reached/);
  });

  it('10. copied-account fills are one attempt, their exposure counted on every account', () => {
    const s = enter(started(liveState({ accounts: 2 })), after(OPEN, 1));
    expect(sessionOf(s).attempts).toEqual([
      expect.objectContaining({ id: 'a1', accounts: 2, plannedRisk: 200 }),
    ]);
    expect(statusAt(s, after(OPEN, 3)).facts.attemptsUsed).toBe(1);
  });

  it('11. a missed or skipped setup uses no attempt', () => {
    let s = assess(ready(started(), after(OPEN, 1)), ROUTINE, { zone: 'left' }, after(OPEN, 2));
    expect(statusAt(s, after(OPEN, 3))).toMatchObject({ code: 'MISSED' });
    expect(statusAt(s, after(OPEN, 3)).facts.attemptsUsed).toBe(0);
    s = retireThesis(s, ROUTINE, 't1', after(OPEN, 4));
    expect(sessionOf(s).attempts).toBeUndefined();
  });

  it('12. partial exits never make a new attempt', () => {
    let s = enter(started(), after(OPEN, 1));
    s = recordPartial(s, ROUTINE, 'a1', after(OPEN, 5));
    s = recordExit(s, ROUTINE, 'a1', { kind: 'objective' }, after(OPEN, 9));
    expect(sessionOf(s).attempts).toHaveLength(1);
    expect(statusAt(s, after(OPEN, 10)).facts.attemptsUsed).toBe(1);
  });

  it('13. thesis states persist across a restart and navigation', () => {
    const s = afterFirstLoss();
    const restarted = decodeState(JSON.parse(JSON.stringify(s)));
    expect(sessionOf(restarted).theses).toEqual(sessionOf(s).theses);
    expect(statusAt(restarted, after(MID, 31))).toEqual(statusAt(s, after(MID, 31)));
  });

  it('14. ending the session ends simulated entries', () => {
    const s = endSession(ready(started(), after(OPEN, 1)), ROUTINE, 'finished', after(OPEN, 2));
    expect(() => enterAttempt(s, ROUTINE, after(OPEN, 3))).toThrow(/SESSION ENDED/);
    expect(() => assess(s, ROUTINE, { zone: 'at' }, after(OPEN, 3))).toThrow(
      /The session is finished/,
    );
  });

  it('15. three writes take an empty day to SETUP CHECKS COMPLETE: no wizard, no checklist', () => {
    // The plan made in the window it is traded in; one made before the 9:30 AM lock opened adds
    // one Confirm tap (PLAN_RECONFIRM).
    let s = savePlan(liveState(), ROUTINE, PLAN, OPEN);
    s = lockSession(s, ROUTINE, after(OPEN, 1));
    s = ready(s, after(OPEN, 2));
    expect(code(s, after(OPEN, 3))).toBe('CHECKS_COMPLETE');
    let early = lockSession(savePlan(liveState(), ROUTINE, PLAN, PRE), ROUTINE, OPEN);
    expect(code(early, after(OPEN, 1))).toBe('PLAN_RECONFIRM');
    early = ready(confirmPlan(early, ROUTINE, after(OPEN, 1)), after(OPEN, 2));
    expect(code(early, after(OPEN, 3))).toBe('CHECKS_COMPLETE');
  });
});

describe('the strategy: lines, CISD, conditional plans, exceptions, the reference', () => {
  it('a failed setup fails the attempt and warns the line; it does not invalidate the line', () => {
    const s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    expect(statusAt(s, after(MID, 1)).facts.line).toMatchObject({ status: 'warning', failures: 1 });
  });

  it('two attempts at one line: BAITING and the thesis exhausted', () => {
    const st = statusAt(exhausted(), LATE);
    expect(st.facts.line).toMatchObject({ status: 'baiting', failures: 2 });
    expect(st.code).toBe('THESIS_EXHAUSTED');
  });

  it('one tap marks a line baiting and blocks entries there for the session', () => {
    const s = markLine(
      ready(started(), after(OPEN, 1)),
      ROUTINE,
      'Put wall',
      'baiting',
      null,
      after(OPEN, 2),
    );
    expect(code(s, after(OPEN, 3))).toBe('LINE_BLOCKED');
    expect(() => enterAttempt(s, ROUTINE, after(OPEN, 3))).toThrow(/LINE IS BAITING/);
  });

  it('renaming the setup, nudging a price, changing the chart or a new thesis never resets a line', () => {
    let s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    s = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    s = assess(
      s,
      ROUTINE,
      {
        zone: 'at',
        setup: 'double-pierce',
        fast: true,
        timeframe: '15m',
        confirmed: true,
        entry: 25_041,
        stop: 25_031,
      },
      after(MID, 31),
    );
    expect(statusAt(s, after(MID, 32)).facts.line).toMatchObject({
      status: 'warning',
      failures: 1,
    });
    s = markLine(s, ROUTINE, 'Put wall', 'baiting', null, after(MID, 33));
    s = retireThesis(s, ROUTINE, 't1', after(MID, 34));
    // The line stays baiting for the session; a thesis there is refused.
    expect(() =>
      newThesis(
        s,
        ROUTINE,
        { ...NEW, where: 'put wall', target: 25_120, invalidation: 25_000 },
        after(MID, 35),
      ),
    ).toThrow(/Same area/);
    expect(statusAt(s, after(MID, 36)).facts.line!.status).toBe('baiting');
  });

  it('session-wide limits are not reset by changing lines', () => {
    const s = newThesis(exhausted(), ROUTINE, NEW, LATE);
    const lost = stop(enter(s, after(LATE, 1)), 'a3', after(LATE, 5), 150);
    expect(statusAt(lost, after(LATE, 6)).facts.sessionLoss.amount).toBe(290);
  });

  it('a single wick never completes a CISD; a range, a body or a double tap does', () => {
    for (const cisd of ['range', 'body', 'double-tap'] as const)
      expect(code(ready(started(), after(OPEN, 1), { cisd }), after(OPEN, 2))).toBe(
        'CHECKS_COMPLETE',
      );
    expect(code(ready(started(), after(OPEN, 1), { cisd: 'single-wick' }), after(OPEN, 2))).toBe(
      'CONFIRMATION_INCOMPLETE',
    );
  });

  it('a conditional plan blocks entries until price is into its area', () => {
    const s = started(liveState(), OPEN, { conditional: true, where: 'Prior high' });
    const away = ready(s, after(OPEN, 1), { zone: 'away' });
    expect(statusAt(away, after(OPEN, 2)).reason).toBe(
      'Conditional plan: wait for the move into Prior high.',
    );
    expect(() => enterAttempt(away, ROUTINE, after(OPEN, 2))).toThrow(/WAITING FOR ZONE/);
    expect(code(assess(away, ROUTINE, { zone: 'at' }, after(OPEN, 3)), after(OPEN, 4))).toBe(
      'CHECKS_COMPLETE',
    );
  });

  it('a counter-bias idea only through the exception, with its justification, counted in the review', () => {
    const counter = { ...NEW, direction: 'short' as const, target: 25_000, invalidation: 25_150 };
    expect(() => newThesis(exhausted(), ROUTINE, counter, LATE)).toThrow(
      /written structural justification/,
    );
    let s = newThesis(
      exhausted(),
      ROUTINE,
      { ...counter, exception: 'FVG tap aligned with the call wall' },
      LATE,
    );
    s = enterAttempt(
      ready(s, after(LATE, 1), { entry: 25_120, stop: 25_130 }),
      ROUTINE,
      after(LATE, 2),
    );
    expect(sessionOf(s).attempts!.at(-1)).toMatchObject({ side: 'short', thesisId: 't2' });
    const review = reviewFacts(sessionOf(s));
    expect(review.counts.exceptions).toBe(1);
    expect(review.facts.find((f) => f.key === 'with-plan')!.value).toBe(true);
  });

  it('keeps the reference, My Key, the plan, lines and attempts across a restart and a backup', () => {
    let s = saveStrategy(
      liveState(),
      ROUTINE,
      {
        ...defaultStrategy(),
        key: 'My own notes on the Key',
        retakeRule: 'Two 5m closes back above',
      },
      PRE,
    );
    s = markLine(
      stop(enter(started(s), after(OPEN, 1)), 'a1', MID),
      ROUTINE,
      'Gamma flip',
      'baiting',
      null,
      after(MID, 1),
    );
    for (const again of [
      decodeState(JSON.parse(JSON.stringify(s))),
      restoredState(parseBackup(encodeBackup(s))),
    ]) {
      expect(strategyOf(tradingBook(again)!.trading!)).toEqual(
        strategyOf(tradingBook(s)!.trading!),
      );
      expect(again.tradingSessions).toEqual(s.tradingSessions);
    }
  });

  it('editing the reference wording changes no status and no permission', () => {
    const s = ready(started(), after(OPEN, 1));
    const reworded = saveStrategy(
      s,
      ROUTINE,
      {
        steps: defaultStrategy().steps.map((step) => ({
          ...step,
          title: `${step.title} (edited)`,
          detail: 'Anything at all',
        })),
        key: 'Never trade, always trade',
        retakeRule: null,
      },
      after(OPEN, 1),
    );
    for (const at of [after(OPEN, 2), MID, after(MID, 60)])
      expect(statusAt(reworded, at)).toEqual(statusAt(s, at));
  });
});

describe('known ways around a restriction stay closed', () => {
  it('1. a fresh record at 6 PM after a hard stop opens nothing until the next 9:30 AM', () => {
    const s = endSession(started(), ROUTINE, 'hard-stop', MID);
    const next = savePlan(s, ROUTINE, PLAN, z('2026-11-10T23:30'));
    expect(() => lockSession(next, ROUTINE, z('2026-11-10T23:31'))).toThrow(/No new trading/);
    expect(statusAt(next, z('2026-11-10T23:31')).facts.stop).toMatchObject({
      candle: TUE,
      reason: 'hard-stop',
    });
  });

  it('2. flat exits and trades logged after the fact count toward the daily loss', () => {
    let s = recordExit(enter(started(), after(OPEN, 1)), ROUTINE, 'a1', { kind: 'flat' }, MID);
    expect(statusAt(s, after(MID, 1)).facts.sessionLoss).toEqual({
      amount: 100,
      planned: true,
      unknown: false,
    });
    s = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 3 },
      after(MID, 2),
    );
    s = recordExit(s, ROUTINE, 'a2', { kind: 'flat' }, after(MID, 3));
    expect(statusAt(s, after(MID, 4)).facts.sessionLoss.amount).toBe(160);
  });

  it('3. a limit unset at the start keeps the session from starting; a raise after a loss never helps', () => {
    const unset = liveState({
      risk: { tradeRisk: 100, thesisRisk: 150, dailyLoss: null, maxContracts: 5 },
    });
    expect(() => started(unset)).toThrow(/daily loss limit/);
  });

  it('4. the reset answer is written once: a No cannot be overwritten', () => {
    const s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    const no = answerReset(s, ROUTINE, 't1', false, after(MID, 30));
    expect(() => answerReset(no, ROUTINE, 't1', true, after(MID, 31))).toThrow();
  });

  it('5. violations the records point to cannot be unticked from the review', () => {
    // Rewritten: the trade is logged during a loss cooldown (an I FEEL RUSHED cooldown alone no
    // longer makes it a revenge re-entry).
    let s = stop(enter(started(), after(OPEN, 1)), 'a1', MID);
    s = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'short', entry: 25_040, stop: null, contracts: 1 },
      after(MID, 2),
    );
    s = recordExit(s, ROUTINE, 'a2', { kind: 'flat' }, after(MID, 3));
    s = reportLoss(s, ROUTINE, 'a2', 20, after(MID, 4));
    const reviewed = saveTradingReview(
      s,
      {
        date: TUE,
        routineId: ROUTINE,
        session: 'traded',
        answers,
        violations: [],
        entries: null,
        failedTheses: null,
        note: '',
        daySession: sessionOf(s),
      },
      'r1',
      MID,
    );
    expect(reviewed.ruleReviews.at(-1)!.violations).toEqual([
      VIOLATION_IDS.noInvalidation,
      VIOLATION_IDS.revenge,
      VIOLATION_IDS.againstBias,
      VIOLATION_IDS.noNamedSetup,
    ]);
  });

  it('6. a restore of the same backup brings the sessions back', () => {
    const s = endSession(started(), ROUTINE, 'hard-stop', MID);
    expect(restoredState(parseBackup(encodeBackup(s))).tradingSessions).toEqual(s.tradingSessions);
  });

  it('7, 8, 12, 13. sessions, stops and cooldowns are keyed by candle, never by the phone date', () => {
    // 12:20 AM New York is already Tuesday's calendar day east of UTC and Monday's west of it: the
    // record is Tuesday's candle either way, and the cooldown an instant.
    const night = z('2026-11-10T05:20');
    const s = feelRushed(started(liveState(), EVENING, {}, EVENING), ROUTINE, night);
    expect(Object.keys(s.tradingSessions)).toEqual([TUE]);
    expect(code(s, after(night, 24))).toBe('COOLDOWN');
    expect(code(s, after(night, 26))).not.toBe('COOLDOWN');
    // 9:50 PM New York belongs to the next candle on every phone.
    const late = feelRushed(s, ROUTINE, z('2026-11-11T02:50'));
    expect(candleDate(Date.parse(z('2026-11-11T02:50')))).toBe('2026-11-11');
    expect(Object.keys(late.tradingSessions).sort()).toEqual([TUE, '2026-11-11']);
  });

  it('9. resuming the routine in Programs never makes a session live', () => {
    const resumed = pausedRoutine(pausedRoutine(liveState(), false), true);
    expect(statusAt(started(resumed), after(OPEN, 1)).facts.mode).toBe('practice');
  });

  it('10 and 14. the start refuses an unreviewed session, a stop; a pause or study-only day starts practice', () => {
    const mon = z('2026-11-09T14:40');
    const ran = savePlan(started(liveState(), mon), ROUTINE, PLAN, OPEN);
    expect(() => lockSession(ran, ROUTINE, after(OPEN, 1))).toThrow(
      'Review Mon, Nov 9 first: a new session starts once it has its review.',
    );
    const study = saveTradingReview(
      ran,
      {
        date: MON,
        routineId: ROUTINE,
        session: 'traded',
        answers,
        violations: ['hard-2'],
        entries: 0,
        failedTheses: 0,
        note: '',
      },
      'r1',
      after(OPEN, 1),
    );
    const s = lockSession(study, ROUTINE, after(OPEN, 2));
    expect(sessionOf(s).lock!.mode).toBe('practice');
    expect(statusAt(s, after(OPEN, 3)).facts.practiceWhy).toContain(
      'Study-only day after a hard violation on Mon, Nov 9.',
    );
  });

  it('15. a clock moved back never reorders the records (tamper-evident, not tamper-proof)', () => {
    let s = feelRushed(started(), ROUTINE, MID);
    s = feelRushed(s, ROUTINE, after(MID, -10));
    expect(sessionOf(s).cooldowns!.map((c) => c.at)).toEqual([MID, MID]);
  });
});

describe('New York time, wherever the phone is', () => {
  it('keeps one candle across New York midnight, and rolls it at 6 PM', () => {
    const s = started(liveState(), EVENING, {}, EVENING);
    expect(ctxAt(s, z('2026-11-10T04:55')).candle).toBe(TUE); // 11:55 PM
    expect(ctxAt(s, z('2026-11-10T05:05')).candle).toBe(TUE); // 12:05 AM
    expect(ctxAt(s, z('2026-11-10T22:59')).candle).toBe(TUE); // 5:59 PM
    expect(ctxAt(s, z('2026-11-10T23:00')).candle).toBe('2026-11-11'); // 6:00 PM
  });

  it('carries a Friday hard stop over the weekend to Monday 9:30 AM', () => {
    const fri = z('2026-11-13T15:00');
    const s = endSession(started(liveState(), fri, {}, fri), ROUTINE, 'hard-stop', after(fri, 30));
    expect(ctxAt(s, z('2026-11-14T15:00')).candle).toBe('2026-11-16'); // Saturday
    expect(code(s, z('2026-11-15T23:30'))).toBe('SESSION_STOPPED'); // Sunday 6:30 PM
    expect(code(s, z('2026-11-16T14:31'))).not.toBe('SESSION_STOPPED'); // Monday 9:31 AM
  });

  it('crosses the November 1, 2026 DST change', () => {
    // Friday, October 30 (UTC-4): the stop holds until Monday 9:30 AM EST (UTC-5).
    expect(new Date(stopUntil('2026-10-30', true)).toISOString()).toBe('2026-11-02T14:30:00.000Z');
    expect(new Date(stopUntil('2026-10-30', false)).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });

  it('crosses the March 14, 2027 DST change', () => {
    expect(new Date(stopUntil('2027-03-12', true)).toISOString()).toBe('2027-03-15T13:30:00.000Z');
    expect(new Date(stopUntil('2027-03-12', false)).toISOString()).toBe('2027-03-14T22:00:00.000Z');
  });

  it('reads the same status in New York, Los Angeles and Kiritimati (the suite runs in each)', () => {
    // Nothing here reads the phone's zone: the same instants give the same codes everywhere.
    const s = endSession(ready(started(), after(OPEN, 1)), ROUTINE, 'hard-stop', MID);
    const t = ready(started(), after(OPEN, 1));
    expect([after(OPEN, 2), z('2026-11-10T23:30')].map((at) => code(t, at))).toEqual([
      'CHECKS_COMPLETE',
      'REVIEW_FIRST',
    ]);
    expect(
      [after(MID, 1), z('2026-11-10T23:30'), z('2026-11-11T14:31')].map((at) => code(s, at)),
    ).toEqual(['SESSION_STOPPED', 'SESSION_STOPPED', 'REVIEW_FIRST']);
  });
});

/** The trading routine paused (`enabled` false) or resumed in Programs. */
function pausedRoutine(state: State, enabled: boolean): State {
  const program = state.programs.find((p) => p.routines.some((r) => r.id === ROUTINE))!;
  const routine = program.routines.find((r) => r.id === ROUTINE)!;
  return upsertRoutine(state, program, { ...routine, enabled }, PRE);
}
