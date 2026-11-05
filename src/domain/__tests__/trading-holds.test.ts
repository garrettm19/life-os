import { describe, expect, it } from '@jest/globals';
import { RuleReview, State } from '../model';
import {
  VIOLATION_IDS,
  candleReview,
  cleanStreak,
  newSession,
  nextDayStudyOnly,
  reviewWaitsForOutcome,
  saveTradingProfile,
  saveTradingReview,
  sessionDateOf,
  sessionResult,
  studyOnlyDay,
  tradingBook,
  tradingDayReader,
  tradingSummary,
  unreviewedTradingDay,
  violationsFromLog,
} from '../trading';
import {
  answerReset,
  endSession,
  feelRushed,
  lockSession,
  newThesisProblem,
  recordExit,
  reportLoss,
  savePlan,
  sizeTrade,
  stopForAccountSet,
  stopUntil,
} from '../trading-live';
import { MAX_LIVE_RECORDS, lineKey, liveViolations } from '../trading-live-model';
import { validateRuleReviews } from '../records';
import { importDeviceSessions, putTradingSession } from '../trading-sessions';
import { enterAttempt, logTakenAttempt, reviewFacts } from '../trading-status';
import {
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
  sessionOf,
  started,
  statusAt,
  z,
} from '../../test-support/trading-live';
import { legacyEntry, legacyFinished, legacySession } from '../../test-support/legacy-trading';

// Restrictions that must hold however the trades are recorded: a finish never lowers a daily loss
// stop, a trade logged outside the cockpit counts on its thesis and line, a trade left open or a
// loss left unknown carries to later candles, and the plan's GEX lock is always confirmed by hand.
/** 6:30 PM New York Tuesday: Wednesday's candle, in its 6 PM window. */
const TUE_EVENING = z('2026-11-10T23:30');
/** 9:40 AM New York Monday and Wednesday. */
const MON_OPEN = z('2026-11-09T14:40');
const WED_OPEN = z('2026-11-11T14:40');

const answers = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
);

/** The candle's review saved with every item PASS. */
function reviewed(state: State, date: string, at: string): State {
  return saveTradingReview(
    state,
    {
      date,
      routineId: ROUTINE,
      session: 'traded',
      answers,
      violations: [],
      entries: null,
      failedTheses: null,
      note: '',
      daySession: state.tradingSessions[date],
    },
    `r-${date}`,
    at,
  );
}

/**
 * The data as an earlier build saved it: its reviews carry no mark that they are their date's own
 * candle's (`ownCandle`), which this build adds to every review it saves.
 */
function earlierBuild(state: State): State {
  return {
    ...state,
    ruleReviews: state.ruleReviews.map((r) => {
      if (!r.trading) return r;
      const { ownCandle: _mark, ...trading } = r.trading;
      return { ...r, trading };
    }),
  };
}

const entered = (state = started(), at = after(OPEN, 2)) =>
  enterAttempt(ready(state, after(OPEN, 1)), ROUTINE, at);

describe('a finish never lowers the daily loss stop', () => {
  const hardUntil = new Date(stopUntil(TUE, true)).toISOString();

  it('raises a finish to a hard stop when a trade is logged after it', () => {
    let s = endSession(started(), ROUTINE, 'finished', MID);
    // 40 points × $2 × 5 contracts: $400 against a $300 daily limit, logged after the finish.
    s = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_000, contracts: 5 },
      after(MID, 5),
    );
    expect(sessionOf(s).sessionStop).toEqual({ at: MID, reason: 'hard-stop', until: hardUntil });
    expect(sessionOf(s).stopCause).toBe('logged-trade');
    s = recordExit(s, ROUTINE, 'a1', { kind: 'stopped', result: 'loss' }, after(MID, 10));
    // The loss past the limit never lowers or replaces it.
    expect(sessionOf(s).sessionStop).toEqual({ at: MID, reason: 'hard-stop', until: hardUntil });
    expect(sessionOf(s).doneReason).toBe('hard-stop');
    // The next candle's 6 PM window stays stopped, whatever is saved for it.
    expect(statusAt(s, TUE_EVENING)).toMatchObject({ code: 'SESSION_STOPPED' });
    const evening = reviewed(s, TUE, TUE_EVENING);
    const planned = savePlan(evening, ROUTINE, PLAN, after(TUE_EVENING, 1));
    expect(() => lockSession(planned, ROUTINE, after(TUE_EVENING, 2))).toThrow(
      /A trade was logged after the session ended/,
    );
    expect(statusAt(planned, after(TUE_EVENING, 2)).code).toBe('SESSION_STOPPED');
    // A finish alone ends only this candle.
    const finished = reviewed(endSession(started(), ROUTINE, 'finished', MID), TUE, TUE_EVENING);
    expect(statusAt(finished, after(TUE_EVENING, 1)).code).toBe('NO_PLAN');
  });

  it('raises a finish to the daily loss stop when a loss reported after it passes the limit', () => {
    let s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, after(OPEN, 5));
    s = endSession(s, ROUTINE, 'finished', MID);
    expect(sessionOf(s).sessionStop!.reason).toBe('finished');
    s = reportLoss(s, ROUTINE, 'a1', 350, after(MID, 15));
    expect(sessionOf(s).sessionStop).toEqual({ at: MID, reason: 'daily-loss', until: hardUntil });
    expect(statusAt(s, TUE_EVENING).code).toBe('SESSION_STOPPED');
  });

  it('counts a trade logged after a finish as no hard-stop violation, and after a hard stop as one', () => {
    const take = (s: State) =>
      logTakenAttempt(
        s,
        ROUTINE,
        { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
        after(MID, 5),
      );
    const finished = sessionOf(take(endSession(started(), ROUTINE, 'finished', MID)));
    expect(finished.attempts![0].taken).toEqual({ status: 'SESSION_STOPPED', stop: 'finished' });
    expect(liveViolations(finished)).not.toContain('afterHardStop');
    const profile = tradingBook(liveState())!.trading!;
    expect(violationsFromLog(profile, finished)).not.toContain(VIOLATION_IDS.afterHardStop);
    const hard = sessionOf(take(endSession(started(), ROUTINE, 'hard-stop', MID)));
    expect(hard.attempts![0].taken).toEqual({ status: 'SESSION_STOPPED', stop: 'hard-stop' });
    expect(liveViolations(hard)).toContain('afterHardStop');
    expect(violationsFromLog(profile, hard)).toContain(VIOLATION_IDS.afterHardStop);
  });
});

describe('a trade logged outside the cockpit counts on its thesis and line', () => {
  const take = (s: State, at: string) =>
    logTakenAttempt(s, ROUTINE, { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 }, at);

  it('a cockpit attempt and a logged one exhaust the thesis and make the line baiting', () => {
    let s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    s = answerReset(s, ROUTINE, 't1', true, after(MID, 30));
    // Logged with no new setup reading: the session ends at once, the trade still counted.
    s = take(s, after(MID, 31));
    expect(sessionOf(s).attempts![1].thesisId).toBe('t1');
    expect(sessionOf(s).stopCause).toBe('logged-trade');
    expect(statusAt(s, after(MID, 32)).code).toBe('IN_POSITION');
    s = recordExit(s, ROUTINE, 'a2', { kind: 'stopped' }, after(MID, 35));
    expect(sessionOf(s).theses![0].statusLog.at(-1)).toMatchObject({
      status: 'exhausted',
      reason: 'Two failed attempts',
    });
    const st = statusAt(s, after(MID, 70));
    expect(st.code).toBe('SESSION_STOPPED');
    expect(st.facts.attemptsUsed).toBe(2);
    expect(st.facts.line).toMatchObject({ status: 'baiting', failures: 2 });
    // No third attempt.
    expect(() => enterAttempt(s, ROUTINE, after(MID, 71))).toThrow(/SESSION ENDED/);
  });

  it('a logged trade first, then a cockpit attempt: the same two attempts, never a third', () => {
    // Logged while the checks were complete, within the risk per trade: the session goes on.
    let s = take(ready(started(), after(OPEN, 1)), after(OPEN, 1));
    expect(sessionOf(s).sessionStop).toBeUndefined();
    expect(sessionOf(s).theses![0].statusLog.map((x) => x.status)).toEqual([
      'planned',
      'waiting',
      'active',
    ]);
    s = recordExit(s, ROUTINE, 'a1', { kind: 'stopped' }, after(OPEN, 5));
    expect(statusAt(s, after(OPEN, 40)).code).toBe('RESET_ANSWER');
    s = answerReset(s, ROUTINE, 't1', true, after(OPEN, 40));
    s = enterAttempt(ready(s, after(OPEN, 41)), ROUTINE, after(OPEN, 42));
    s = recordExit(s, ROUTINE, 'a2', { kind: 'stopped' }, after(OPEN, 45));
    expect(sessionOf(s).theses![0].statusLog.at(-1)!.status).toBe('exhausted');
    expect(statusAt(s, after(OPEN, 90)).facts.line).toMatchObject({ status: 'baiting' });
  });

  it('a trade logged during the reset counts on the thesis and ends the session', () => {
    let s = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    s = take(s, after(MID, 5));
    expect(sessionOf(s).attempts![1]).toMatchObject({
      thesisId: 't1',
      taken: { status: 'COOLDOWN' },
    });
    // The session ends at once, which retires the thesis in its reset.
    expect(sessionOf(s).stopCause).toBe('logged-trade');
    expect(sessionOf(s).theses![0].statusLog.at(-1)).toMatchObject({
      status: 'abandoned',
      reason: 'The session ended',
    });
    s = recordExit(s, ROUTINE, 'a2', { kind: 'stopped' }, after(MID, 6));
    expect(sessionOf(s).theses![0].statusLog.at(-1)!.status).toBe('abandoned');
    expect(liveViolations(sessionOf(s))).toContain('revenge');
  });

  it('a trade logged during an I FEEL RUSHED cooldown is judged by the status beneath it', () => {
    // No failed attempt: not a revenge re-entry.
    const calm = take(feelRushed(started(), ROUTINE, after(OPEN, 1)), after(OPEN, 2));
    const a = sessionOf(calm).attempts![0];
    expect(a.taken!.status).toBe('COOLDOWN');
    expect(a.taken!.under).toBeDefined();
    expect(a.taken!.under).not.toBe('COOLDOWN');
    expect(liveViolations(sessionOf(calm))).toEqual(['noNamedSetup']);
    // It reads back as saved.
    expect(() => putTradingSession(calm, sessionOf(calm))).not.toThrow();
    // After a failed attempt, the reset still unanswered beneath the cooldown: revenge.
    let reset = recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID);
    expect(statusAt(reset, after(MID, 40)).code).toBe('RESET_ANSWER');
    reset = take(feelRushed(reset, ROUTINE, after(MID, 40)), after(MID, 41));
    expect(sessionOf(reset).attempts![1].taken).toMatchObject({
      status: 'COOLDOWN',
      under: 'RESET_ANSWER',
    });
    expect(liveViolations(sessionOf(reset))).toContain('revenge');
    // During the loss cooldown itself: revenge, with nothing beneath recorded.
    const loss = take(
      recordExit(entered(), ROUTINE, 'a1', { kind: 'stopped' }, MID),
      after(MID, 5),
    );
    expect(sessionOf(loss).attempts![1].taken).toEqual({ status: 'COOLDOWN' });
    expect(liveViolations(sessionOf(loss))).toContain('revenge');
  });

  it('keeps the stop of a logged trade when no instrument is set to count its risk', () => {
    let s = logTakenAttempt(
      liveState({ instrument: undefined }),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
      PRE,
    );
    expect(sessionOf(s).attempts![0]).toMatchObject({ stop: 25_030, plannedRisk: null });
    expect(statusAt(s, after(PRE, 1)).reason).toContain('stop 25,030');
    // The stop was given: no missing invalidation; the risk is unknown, never zero.
    expect(liveViolations(sessionOf(s))).not.toContain('noInvalidation');
    s = recordExit(s, ROUTINE, 'a1', { kind: 'stopped' }, after(PRE, 5));
    // Its risk not known, it ended the session; once the stop ends, the exposure still holds.
    expect(sessionOf(s).stopCause).toBe('logged-trade');
    expect(statusAt(s, after(PRE, 6)).code).toBe('SESSION_STOPPED');
    expect(statusAt(s, WED_OPEN).code).toBe('UNKNOWN_EXPOSURE');
  });

  it('a trade on the other side of the thesis is not one of its attempts', () => {
    let s = logTakenAttempt(
      ready(started(), after(OPEN, 1)),
      ROUTINE,
      { side: 'short', entry: 25_040, stop: 25_050, contracts: 1 },
      after(OPEN, 1),
    );
    expect(sessionOf(s).attempts![0].thesisId).toBeNull();
    expect(sessionOf(s).theses![0].statusLog.at(-1)!.status).toBe('waiting');
    // A gain on it does not complete the long thesis.
    s = recordExit(s, ROUTINE, 'a1', { kind: 'flat', result: 'gain' }, after(OPEN, 5));
    expect(sessionOf(s).theses![0].statusLog.at(-1)!.status).toBe('waiting');
    expect(statusAt(s, after(OPEN, 6)).code).not.toBe('THESIS_COMPLETED');
    expect(liveViolations(sessionOf(s))).toEqual(['noNamedSetup', 'againstBias']);
  });
});

describe('a trade left open or a loss left unknown carries to later candles', () => {
  it('finds a position left open across a candle with no session, and records it', () => {
    let s = enterAttempt(
      ready(started(liveState(), MON_OPEN), after(MON_OPEN, 1)),
      ROUTINE,
      after(MON_OPEN, 2),
    );
    // Nothing on Tuesday's candle; Wednesday opens with Monday's trade still open.
    expect(statusAt(s, WED_OPEN)).toMatchObject({
      code: 'RECONCILE_POSITION',
      reason: 'A long from the Mon, Nov 9 candle has no outcome.',
    });
    expect(statusAt(s, WED_OPEN).facts.open!.id).toBe('a1');
    expect(() => lockSession(s, ROUTINE, WED_OPEN)).toThrow(/open trade/);
    s = recordExit(s, ROUTINE, 'a1', { kind: 'reconciled' }, WED_OPEN);
    expect(sessionOf(s, MON).attempts![0].exit).toMatchObject({ kind: 'reconciled' });
    // Its loss cooldown holds now, on Wednesday's record; then Monday's review comes first.
    expect(statusAt(s, after(WED_OPEN, 1)).code).toBe('COOLDOWN');
    expect(statusAt(s, after(WED_OPEN, 30))).toMatchObject({ code: 'REVIEW_FIRST' });
    expect(ctxAt(s, after(WED_OPEN, 30)).unreviewed).toBe(MON);
  });

  it('holds an unknown loss past the review and into the next candle until it is reported', () => {
    let s = logTakenAttempt(
      started(),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: null, contracts: 1 },
      after(OPEN, 1),
    );
    s = recordExit(s, ROUTINE, 'a1', { kind: 'stopped' }, after(OPEN, 5));
    s = reviewed(s, TUE, TUE_EVENING);
    s = savePlan(s, ROUTINE, PLAN, after(TUE_EVENING, 1));
    // Logged with no stop, it ended the session to the next 9:30 AM window.
    expect(statusAt(s, after(TUE_EVENING, 2)).code).toBe('SESSION_STOPPED');
    // Past it, the unknown loss still holds the next candle.
    expect(statusAt(s, WED_OPEN).code).toBe('UNKNOWN_EXPOSURE');
    expect(() => lockSession(s, ROUTINE, WED_OPEN)).toThrow(
      'Report the loss of your last trade first.',
    );
    s = reportLoss(s, ROUTINE, 'a1', 40, after(TUE_EVENING, 3));
    expect(statusAt(s, after(WED_OPEN, 1)).code).toBe('NOT_STARTED');
  });
});

describe('labels and lines', () => {
  it('a label that only looks the same is the same line', () => {
    expect(lineKey('Put wall​')).toBe(lineKey('Put wall'));
    expect(lineKey('﻿Put⁠ wall')).toBe('put wall');
    let s = recordExit(entered(), ROUTINE, 'a1', { kind: 'invalidated' }, MID);
    s = feelRushed(s, ROUTINE, after(MID, 1));
    const draft = { changed: 'New structure', target: 25_120, invalidation: 25_000 };
    const at = after(MID, 60);
    expect(newThesisProblem(ctxAt(s, at), { ...draft, where: 'Put wall​' })).toMatch(
      /Same area as an earlier thesis/,
    );
    expect(newThesisProblem(ctxAt(s, at), { ...draft, where: 'Call wall' })).toBeNull();
  });

  it('says why a thesis was exhausted: one failure can use the budget or the one attempt', () => {
    const one = (over: Parameters<typeof liveState>[0]) =>
      statusAt(
        recordExit(entered(started(liveState(over))), ROUTINE, 'a1', { kind: 'stopped' }, MID),
        after(MID, 60),
      );
    // The planned $100 loss uses a $100 thesis budget.
    const budget = one({
      risk: { tradeRisk: 100, thesisRisk: 100, dailyLoss: 300, maxContracts: 5 },
    });
    expect(budget.code).toBe('THESIS_EXHAUSTED');
    expect(budget.reason).toBe(
      'One failed attempt used the thesis budget. This idea is retired. Do not re-enter the same setup.',
    );
    const single = one({ attemptsPerThesis: 1 });
    expect(single.reason).toBe(
      'The attempt allowed is used. This idea is retired. Do not re-enter the same setup.',
    );
  });

  it('titles a missing entry or stop by what is missing', () => {
    const s = (more: Parameters<typeof ready>[2]) =>
      statusAt(ready(started(), after(OPEN, 1), more), after(OPEN, 2));
    expect(s({ entry: null, stop: null })).toMatchObject({
      code: 'RISK_NEEDED',
      title: 'NO ENTRY — NO STRUCTURAL STOP',
      reason: 'No entry or structural stop yet.',
    });
    expect(s({ stop: null })).toMatchObject({
      title: 'NO ENTRY — NO STRUCTURAL STOP',
      reason: 'No structural stop, no trade: enter the stop.',
    });
    expect(s({ entry: null })).toMatchObject({
      title: 'NO ENTRY — NO ENTRY PRICE',
      reason: 'Enter the entry price.',
    });
  });

  it('tells a restriction from a wait: its own tone', () => {
    expect(statusAt(feelRushed(started(), ROUTINE, after(OPEN, 1)), after(OPEN, 2)).tone).toBe(
      'block',
    );
    expect(statusAt(started(), after(OPEN, 1)).tone).toBe('wait');
  });

  it('names the major event with the status', () => {
    const s = started(liveState(), OPEN, { event: { name: 'FOMC', time: '14:00' } });
    expect(statusAt(s, after(OPEN, 1)).event).toBe('FOMC 2:00 PM');
    expect(statusAt(started(), after(OPEN, 1)).event).toBeNull();
  });
});

describe('the records keep working at their limits', () => {
  it('a taken trade risks what the sizing counts per contract, to the cent', () => {
    // A tick worth less than a cent: the sizing rounds each contract's risk to the cent.
    const state = saveTradingProfile(
      liveState(),
      ROUTINE,
      {
        ...tradingBook(liveState())!.trading!,
        instrument: { name: 'Example', pointValue: 0.05, tick: 0.25 },
      },
      z('2026-11-01T12:00'),
    );
    const s = logTakenAttempt(
      started(state),
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_039.75, contracts: 3 },
      after(OPEN, 1),
    );
    const session = ctxAt(s, after(OPEN, 2)).session;
    const limits = { ...session.lock!.limits, ...session.lockedCaps! };
    const sized = sizeTrade({
      side: 'long',
      entry: 25_040,
      stop: 25_039.75,
      target: 25_120,
      contracts: 3,
      limits,
      thesisLeft: { amount: 150, planned: false },
      dailyLeft: { amount: 300, planned: false },
    });
    expect(sessionOf(s).attempts![0].plannedRisk).toBe(sized.size!.riskTotal);
    expect(sized.size!.riskTotal).toBe(0.03);
  });

  it('a full log or cooldown list never refuses I FEEL RUSHED or an outcome', () => {
    const s = entered();
    const full = putTradingSession(s, {
      ...sessionOf(s),
      log: Array.from({ length: MAX_LIVE_RECORDS }, () => ({ at: OPEN, kind: 'regime' as const })),
      cooldowns: Array.from({ length: MAX_LIVE_RECORDS }, () => ({
        kind: 'rushed' as const,
        at: z('2026-11-10T14:00'),
        until: z('2026-11-10T14:01'),
      })),
    });
    const rushed = feelRushed(full, ROUTINE, MID);
    expect(sessionOf(rushed).cooldowns).toHaveLength(MAX_LIVE_RECORDS);
    expect(sessionOf(rushed).cooldowns!.at(-1)!.at).toBe(MID);
    const out = recordExit(rushed, ROUTINE, 'a1', { kind: 'stopped' }, after(MID, 1));
    expect(sessionOf(out).log).toHaveLength(MAX_LIVE_RECORDS);
    expect(sessionOf(out).attempts![0].exit!.kind).toBe('stopped');
  });

  it('a lost account set stops the session the way the cockpit does', () => {
    const s = sessionOf(started());
    const ended = stopForAccountSet(s, MID);
    expect(ended.sessionStop).toMatchObject({ reason: 'hard-stop', at: MID });
    expect(ended.theses![0].statusLog.at(-1)).toMatchObject({ status: 'abandoned' });
    expect(reviewFacts(ended).facts.find((f) => f.key === 'ended')!.value).toBe(true);
    // A finish is raised to it; a session not started stays as it is.
    const finished = sessionOf(endSession(started(), ROUTINE, 'finished', MID));
    expect(stopForAccountSet(finished, after(MID, 1)).sessionStop).toMatchObject({
      reason: 'hard-stop',
      at: MID,
    });
    const fresh = newSession(TUE);
    expect(stopForAccountSet(fresh, MID)).toBe(fresh);
  });
});

describe('a session an earlier build kept on the next date keeps its review', () => {
  it('finds the review where that build saved it, and reads it as the candle it is for', () => {
    // East of New York the earlier build kept Tuesday's session on Wednesday's record, beside
    // Wednesday's own bias, and saved its review (with a hard violation) on Wednesday's date.
    const base = liveState();
    const tuesday = {
      ...newSession(WED),
      bias: 'bearish' as const,
      biasAt: z('2026-11-10T23:30'),
      startedAt: OPEN,
      doneAt: z('2026-11-10T21:30'),
      doneReason: 'finished' as const,
    };
    const review = earlierBuild(
      saveTradingReview(
        base,
        {
          date: WED,
          routineId: ROUTINE,
          session: 'traded',
          answers,
          violations: [VIOLATION_IDS.revenge],
          entries: null,
          failedTheses: null,
          note: '',
        },
        'r-old',
        z('2026-11-12T12:00'),
      ),
    );
    const { tradingSessionsImported: _flag, ...rest } = review;
    const state = importDeviceSessions({ ...rest, tradingSessions: {} }, [
      [WED, JSON.stringify(tuesday)],
    ]);
    const book = tradingBook(state)!;
    const THU = '2026-11-12';
    expect(state.tradingSessions[TUE]).toMatchObject({ startedAt: OPEN, movedFrom: WED });
    expect(state.tradingSessions[WED]).toMatchObject({ bias: 'bearish', startedAt: null });
    expect(candleReview(state, ROUTINE, TUE)?.id).toBe('r-old');
    expect(candleReview(state, ROUTINE, WED)).toBeUndefined();
    // Tuesday is reviewed: no review is asked for again, so none is saved twice.
    expect(unreviewedTradingDay(state, book, THU)).toBeNull();
    expect(ctxAt(state, z('2026-11-12T14:40')).unreviewed).toBeNull();
    // Wednesday's own candle is not taken for reviewed.
    expect(ctxAt(state, WED_OPEN).reviewed).toBe(false);
    // The violation makes the candle after Tuesday study only, not the one after Wednesday.
    expect(studyOnlyDay(state, book, WED)).toEqual({ after: TUE });
    expect(studyOnlyDay(state, book, THU)).toBeNull();
    // Correcting it edits that review, on its date (rewritten: the candle is passed, not the date
    // the review was saved on).
    const corrected = saveTradingReview(
      state,
      {
        date: TUE,
        routineId: ROUTINE,
        session: 'traded',
        answers,
        violations: [VIOLATION_IDS.revenge],
        entries: null,
        failedTheses: null,
        note: 'Corrected',
        daySession: state.tradingSessions[TUE],
      },
      'r-new',
      z('2026-11-12T13:00'),
    );
    expect(corrected.ruleReviews.filter((r) => r.trading)).toHaveLength(1);
    expect(candleReview(corrected, ROUTINE, TUE)).toMatchObject({
      id: 'r-old',
      date: WED,
      note: 'Corrected',
    });
  });

  it("reviews the date's own candle beside it, never over it", () => {
    // Tuesday's session, kept on Wednesday's record by the earlier build and reviewed there with
    // a hard violation; then Wednesday's own candle trades in this build and is reviewed.
    const tuesday = {
      ...newSession(WED),
      startedAt: OPEN,
      doneAt: z('2026-11-10T21:30'),
      doneReason: 'finished' as const,
    };
    const old = earlierBuild(
      saveTradingReview(
        liveState(),
        {
          date: WED,
          routineId: ROUTINE,
          session: 'traded',
          answers,
          violations: [VIOLATION_IDS.revenge],
          entries: null,
          failedTheses: null,
          note: 'Tuesday review',
        },
        'r-old',
        z('2026-11-11T12:00'),
      ),
    );
    const { tradingSessionsImported: _flag, ...rest } = old;
    const moved = importDeviceSessions({ ...rest, tradingSessions: {} }, [
      [WED, JSON.stringify(tuesday)],
    ]);
    let s = endSession(started(moved, WED_OPEN), ROUTINE, 'finished', after(WED_OPEN, 30));
    s = saveTradingReview(
      s,
      {
        date: WED,
        routineId: ROUTINE,
        session: 'no-trade',
        answers,
        violations: [],
        entries: null,
        failedTheses: null,
        note: 'Wednesday review',
        daySession: sessionOf(s, WED),
      },
      'r-wed',
      after(WED_OPEN, 60),
    );
    expect(s.ruleReviews.filter((r) => r.trading)).toHaveLength(2);
    expect(candleReview(s, ROUTINE, TUE)).toMatchObject({
      id: 'r-old',
      note: 'Tuesday review',
      violations: [VIOLATION_IDS.revenge],
    });
    const wed = candleReview(s, ROUTINE, WED)!;
    expect(wed).toMatchObject({
      id: 'r-wed',
      date: WED,
      note: 'Wednesday review',
      violations: [],
      trading: { ownCandle: true },
    });
    expect(() =>
      validateRuleReviews([{ ...wed, trading: { ...wed.trading!, ownCandle: false as never } }]),
    ).toThrow();
    // Tuesday's violation stays Tuesday's: Wednesday is study only, Thursday is not.
    const book = tradingBook(s)!;
    expect(studyOnlyDay(s, book, WED)).toEqual({ after: TUE });
    expect(studyOnlyDay(s, book, '2026-11-12')).toBeNull();
    // A correction of either edits that one.
    const again = saveTradingReview(
      s,
      {
        date: WED,
        routineId: ROUTINE,
        session: 'no-trade',
        answers,
        violations: [],
        entries: null,
        failedTheses: null,
        note: 'Wednesday corrected',
        daySession: sessionOf(s, WED),
      },
      'r-x',
      after(WED_OPEN, 90),
    );
    expect(again.ruleReviews.filter((r) => r.trading)).toHaveLength(2);
    expect(candleReview(again, ROUTINE, WED)!.note).toBe('Wednesday corrected');
    expect(candleReview(again, ROUTINE, TUE)!.note).toBe('Tuesday review');
  });
});

describe('each review is read as the candle it is for, everywhere', () => {
  const THU = '2026-11-12';
  const FRI = '2026-11-06';
  const input = (date: string, session: 'traded' | 'no-trade', note: string) => ({
    date,
    routineId: ROUTINE,
    session,
    answers,
    violations: [],
    entries: null,
    failedTheses: null,
    note,
  });
  /** Tuesday's session as the earlier build kept it east of New York, on Wednesday's record. */
  const tuesday = {
    ...newSession(WED),
    startedAt: OPEN,
    doneAt: z('2026-11-10T21:30'),
    doneReason: 'finished' as const,
  };
  /** The data saved before version 5, with this device's records moved in. */
  const movedIn = (state: State) => {
    const { tradingSessionsImported: _flag, ...rest } = state;
    return importDeviceSessions({ ...rest, tradingSessions: {} }, [[WED, JSON.stringify(tuesday)]]);
  };

  it("reads the moved review as Tuesday's and Wednesday's own as Wednesday's in history", () => {
    // Tuesday reviewed rule-broken on Wednesday's date by the earlier build; Wednesday's own
    // candle traded in this build and reviewed clean.
    const old = earlierBuild(
      saveTradingReview(
        liveState(),
        { ...input(WED, 'traded', 'Tuesday review'), violations: [VIOLATION_IDS.revenge] },
        'r-old',
        z('2026-11-11T12:00'),
      ),
    );
    let s = endSession(started(movedIn(old), WED_OPEN), ROUTINE, 'finished', after(WED_OPEN, 30));
    s = saveTradingReview(
      s,
      { ...input(WED, 'no-trade', 'Wednesday review'), daySession: sessionOf(s, WED) },
      'r-wed',
      after(WED_OPEN, 60),
    );
    const book = tradingBook(s)!;
    const read = tradingDayReader(s, book);
    expect(read(TUE, THU)).toMatchObject({ date: TUE, status: 'broken', review: { id: 'r-old' } });
    expect(read(WED, THU)).toMatchObject({ date: WED, status: 'clean', review: { id: 'r-wed' } });
    const summary = tradingSummary(s, book, THU, 7);
    expect(summary).toMatchObject({ clean: 1, broken: 1, reviewed: 2 });
    expect(summary.latest).toMatchObject({ date: WED, review: { id: 'r-wed' } });
    // Tuesday broken, then Wednesday clean.
    expect(cleanStreak(s, book, THU)).toEqual({ current: 1, best: 1 });
    // Each candle's own review: the one a correction opens and the one the next day reads.
    expect(nextDayStudyOnly(s, book, TUE)).toBe(true);
    expect(nextDayStudyOnly(s, book, WED)).toBe(false);
  });

  it('reads a review of a session that never started as the candle before, never over the moved one', () => {
    // The earlier build east of New York kept Monday's candle (which never started, so it was not
    // moved) on Tuesday's record and reviewed it there as No trade; Tuesday's candle, kept on
    // Wednesday's record, traded and was reviewed on Wednesday's date.
    let old = saveTradingReview(liveState(), input(TUE, 'no-trade', 'Monday'), 'r-tue', MID);
    old = earlierBuild(saveTradingReview(old, input(WED, 'traded', 'Tuesday'), 'r-wed', WED_OPEN));
    const s = movedIn(old);
    expect(candleReview(s, ROUTINE, TUE)?.id).toBe('r-wed');
    expect(candleReview(s, ROUTINE, MON)?.id).toBe('r-tue');
    expect(candleReview(s, ROUTINE, WED)).toBeUndefined();
    const book = tradingBook(s)!;
    const read = tradingDayReader(s, book);
    expect(read(MON, THU).review?.id).toBe('r-tue');
    expect(read(TUE, THU).review?.id).toBe('r-wed');
    expect(read(WED, THU).review).toBeUndefined();
    // A correction of either candle edits that one's review only, on the date it was saved.
    const tue = saveTradingReview(
      s,
      { ...input(TUE, 'traded', 'Tuesday corrected'), daySession: s.tradingSessions[TUE] },
      'x',
      z('2026-11-12T10:00'),
    );
    const mon = saveTradingReview(
      tue,
      input(MON, 'no-trade', 'Monday corrected'),
      'y',
      z('2026-11-12T11:00'),
    );
    const notes = (state: State) =>
      state.ruleReviews
        .filter((r) => r.trading)
        .map((r: RuleReview) => [r.id, r.date, r.trading!.session, r.note]);
    expect(notes(mon)).toEqual([
      ['r-tue', TUE, 'no-trade', 'Monday corrected'],
      ['r-wed', WED, 'traded', 'Tuesday corrected'],
    ]);
    // With a review on Monday's own date as well, the one that meets another is read as the latest
    // earlier candle free: on a US phone Tuesday's (Tuesday's candle is the moved session's), east
    // of New York Monday's, the date no candle's session date is (Tuesday's is Monday's).
    const tueReview = old.ruleReviews.find((r) => r.id === 'r-tue')!;
    const both = movedIn({
      ...old,
      ruleReviews: [...old.ruleReviews, { ...tueReview, id: 'r-mon', date: MON, at: MID }],
    });
    const east = sessionDateOf(MON) === TUE;
    expect(candleReview(both, ROUTINE, MON)?.id).toBe(east ? 'r-tue' : 'r-mon');
    expect(candleReview(both, ROUTINE, FRI)?.id).toBe(east ? 'r-mon' : 'r-tue');
    expect(candleReview(both, ROUTINE, TUE)?.id).toBe('r-wed');
  });

  // The earlier build dated a review by the record its session was kept on, the candle's session
  // date: east of New York the next date, whether or not the session started. The suite runs in
  // New York, Los Angeles and Kiritimati (east of it), so both are read here.
  const FRI_CANDLE = '2026-11-13';
  const WEEK = [MON, TUE, WED, THU];
  /** Each candle's own record as the earlier build kept it: a No trade decision, never started. */
  const noTrade = (date: string) =>
    JSON.stringify({
      ...newSession(date),
      doneAt: z(`${date}T15:00`),
      doneReason: 'no-trade' as const,
    });
  /** The earlier build's reviews, each saved on its candle's session date. */
  const reviewedOnSessionDates = (
    state: State,
    candles: [string, 'traded' | 'no-trade'][],
  ): State => {
    let s = state;
    for (const [candle, session] of candles)
      s = saveTradingReview(
        s,
        input(sessionDateOf(candle), session, `candle ${candle}`),
        `r-${candle}`,
        z('2026-11-14T12:00'),
      );
    return earlierBuild(s);
  };
  const importRecords = (state: State, records: [string, string][]) => {
    const { tradingSessionsImported: _flag, ...rest } = state;
    return importDeviceSessions({ ...rest, tradingSessions: {} }, records);
  };

  it('leaves the live candle unreviewed after candles without a session, and reviews it apart', () => {
    const old = reviewedOnSessionDates(
      liveState(),
      WEEK.map((c) => [c, 'no-trade']),
    );
    const s = importRecords(
      old,
      WEEK.map((c) => [c, noTrade(c)]),
    );
    for (const candle of WEEK) expect(candleReview(s, ROUTINE, candle)?.id).toBe(`r-${candle}`);
    expect(candleReview(s, ROUTINE, FRI_CANDLE)).toBeUndefined();
    // 7:30 PM New York Thursday: Friday's candle, in its 6 PM window, still to be traded.
    const evening = z('2026-11-13T00:30');
    expect(ctxAt(s, evening).reviewed).toBe(false);
    expect(statusAt(s, evening).code).not.toBe('SESSION_STOPPED');
    // Friday's first review is a review of its own, beside Thursday's.
    const fri = saveTradingReview(
      s,
      input(FRI_CANDLE, 'no-trade', 'Friday'),
      'r-fri',
      z('2026-11-14T13:00'),
    );
    expect(candleReview(fri, ROUTINE, FRI_CANDLE)).toMatchObject({
      id: 'r-fri',
      date: FRI_CANDLE,
      note: 'Friday',
      trading: { ownCandle: true },
    });
    expect(candleReview(fri, ROUTINE, THU)).toMatchObject({
      id: `r-${THU}`,
      date: sessionDateOf(THU),
      note: `candle ${THU}`,
    });
    expect(fri.ruleReviews.filter((r) => r.trading)).toHaveLength(5);
  });

  it('keeps every reviewed candle reviewed, and the streak, when a traded session moves in', () => {
    // Tuesday traded, kept on its session date's record; the other candles never started.
    const old = reviewedOnSessionDates(liveState(), [
      [MON, 'no-trade'],
      [TUE, 'traded'],
      [WED, 'no-trade'],
      [THU, 'no-trade'],
    ]);
    const tuesday = {
      ...newSession(sessionDateOf(TUE)),
      startedAt: OPEN,
      doneAt: z('2026-11-10T21:30'),
      doneReason: 'finished' as const,
    };
    const records: [string, string][] = [
      [MON, noTrade(MON)],
      [sessionDateOf(TUE), JSON.stringify(tuesday)],
      [THU, noTrade(THU)],
    ];
    const read = (state: State) => {
      const book = tradingBook(state)!;
      const day = tradingDayReader(state, book);
      return {
        days: WEEK.map((c) => [c, day(c, FRI_CANDLE).status, day(c, FRI_CANDLE).review?.id]),
        streak: cleanStreak(state, book, FRI_CANDLE),
      };
    };
    const before = read(old);
    expect(before.days).toEqual(WEEK.map((c) => [c, 'clean', `r-${c}`]));
    expect(before.streak).toEqual({ current: 4, best: 4 });
    const s = importRecords(old, records);
    expect(s.tradingSessions[TUE]).toMatchObject({ startedAt: OPEN });
    expect(read(s)).toEqual(before);
    expect(unreviewedTradingDay(s, tradingBook(s)!, FRI_CANDLE)).toBeNull();
  });

  it('keeps a review saved on its own candle read by date, as before', () => {
    // No session moved in: two reviews on one date read the first, as they always did.
    const s = saveTradingReview(liveState(), input(TUE, 'traded', 'one'), 'r-1', MID);
    const twice = {
      ...s,
      ruleReviews: [...s.ruleReviews, { ...s.ruleReviews.at(-1)!, id: 'r-2' }],
    };
    expect(candleReview(twice, ROUTINE, TUE)?.id).toBe('r-1');
    expect(candleReview(twice, ROUTINE, MON)).toBeUndefined();
    expect(tradingDayReader(twice, tradingBook(twice)!)(TUE, THU).review?.id).toBe('r-1');
  });
});

describe('a session an earlier build saved', () => {
  const THU = '2026-11-12';
  const open = z('2026-11-10T14:40');
  /** Tuesday locked by the earlier cockpit, one entry logged without a named setup, finished. */
  const logged = legacyFinished(
    {
      ...legacySession(TUE, { evening: z('2026-11-09T23:30'), open }),
      entries: [
        legacyEntry(z('2026-11-10T14:50'), {
          setup: undefined,
          timeframe: undefined,
          notChasing: undefined,
          plan: undefined,
        }),
      ],
    },
    z('2026-11-10T16:00'),
  );
  const input = (note: string) => ({
    date: TUE,
    routineId: ROUTINE,
    session: 'traded' as const,
    answers,
    violations: [],
    entries: 1,
    failedTheses: null,
    note,
    daySession: logged,
  });

  it('keeps a clean review clean when it is corrected', () => {
    // Reviewed clean by the earlier build (it let Entered without a named setup be unticked).
    const base = liveState();
    const old: RuleReview = {
      id: 'r-old',
      date: TUE,
      at: z('2026-11-10T21:00'),
      routineId: ROUTINE,
      occurrenceId: null,
      outcome: 'reviewed',
      answers: Object.entries(answers).map(([checkpointId, answer]) => ({ checkpointId, answer })),
      violations: [],
      note: 'clean',
      trading: { session: 'traded', entries: 1, failedTheses: null, entryLog: logged.entries },
    };
    const s = { ...base, tradingSessions: { [TUE]: logged }, ruleReviews: [old] };
    const book = tradingBook(s)!;
    expect(violationsFromLog(book.trading!, logged)).toContain(VIOLATION_IDS.noNamedSetup);
    expect(cleanStreak(s, book, THU)).toEqual({ current: 1, best: 1 });
    const corrected = saveTradingReview(s, input('Typo fixed'), 'x', z('2026-11-12T12:00'));
    const review = candleReview(corrected, ROUTINE, TUE)!;
    expect(review).toMatchObject({ id: 'r-old', violations: [], note: 'Typo fixed' });
    expect(sessionResult(review, book.trading!)).toBe('clean');
    expect(cleanStreak(corrected, book, THU)).toEqual({ current: 1, best: 1 });
    // A first save still records what the records point to, whatever was ticked.
    const first = saveTradingReview(
      { ...s, ruleReviews: [] },
      input('First'),
      'r-new',
      z('2026-11-12T12:00'),
    );
    expect(candleReview(first, ROUTINE, TUE)!.violations).toContain(VIOLATION_IDS.noNamedSetup);
  });

  it('is reviewed with an entry it left open, and the next session is not held', () => {
    // An entry from the earlier cockpit without an outcome: nothing records one any more.
    const session = {
      ...legacySession(TUE, { evening: z('2026-11-09T23:30'), open }),
      entries: [legacyEntry(z('2026-11-10T14:50'))],
    };
    const s = { ...liveState(), tradingSessions: { [TUE]: session } };
    expect(reviewWaitsForOutcome(session)).toBe(false);
    expect(statusAt(s, WED_OPEN).code).toBe('REVIEW_FIRST');
    const done = saveTradingReview(
      s,
      { ...input('Reviewed'), entries: null, daySession: session },
      'r-tue',
      z('2026-11-10T22:00'),
    );
    expect(candleReview(done, ROUTINE, TUE)).toBeTruthy();
    expect(ctxAt(done, WED_OPEN).unreviewed).toBeNull();
    expect(statusAt(done, WED_OPEN).code).not.toBe('REVIEW_FIRST');
    // A trade on the cockpit still waits for its outcome before the review.
    expect(reviewWaitsForOutcome(sessionOf(entered(), TUE))).toBe(true);
  });
});
