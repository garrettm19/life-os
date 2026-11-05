import { describe, expect, it } from '@jest/globals';
import { decodeState } from '../data';
import { Discipline, Program, Regime, State, TradingProfile } from '../model';
import { validateRuleReviews } from '../records';
import {
  TradingSession,
  VIOLATION_IDS,
  cleanStreak,
  disciplineAnswered,
  disciplineFromRecords,
  disciplineViolations,
  enableTrading,
  newSession,
  saveTradingProfile,
  saveTradingReview,
  sessionResult,
  tradingBook,
  candleReview,
  violationsFromLog,
} from '../trading';
import { DISCIPLINE_QUESTIONS, withCounterBiasViolation } from '../trading-rules';
import { trainingState } from '../../test-support/fixtures';
import {
  legacyEntry,
  legacyFailed,
  legacyFinished,
  legacySession,
} from '../../test-support/legacy-trading';

// The review's discipline answers: pre-filled from the day's records where they can be told,
// saved with the review, and part of a clean session. Synthetic data only: example prices on an
// example instrument labelled as such. Monday, November 9, 2026 is standard time (New York =
// UTC-5); instants are UTC so they mean the same New York time in every zone the suite runs in.
const MON = '2026-11-09';
const AT = new Date(2026, 10, 13, 17).toISOString();
const EVENING = '2026-11-08T23:30:00.000Z';
const OPEN = '2026-11-09T14:30:00.000Z';
const MID = '2026-11-09T15:15:00.000Z';
const DONE = '2026-11-09T16:00:00.000Z';
const TODAY = '2026-11-13';

const RANGE: Omit<Regime, 'at'> = { kind: 'range', context: 'daily' };
const CONFIRMED: Omit<Regime, 'at'> = {
  kind: 'confirmed',
  context: 'daily',
  evidence: { displacement: true, structure: true, room: true },
};
const ALL_YES: Discipline = {
  labeled: true,
  distinguished: true,
  withBias: true,
  namedSetups: true,
  noPrediction: true,
  followedPlan: true,
};

function base(): State {
  const state = trainingState();
  const trading: Program = {
    id: 'trading',
    title: 'Trading discipline',
    group: 'Private',
    goalIds: [],
    routines: [
      {
        id: 'trade-rules',
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
  return {
    ...state,
    programs: [...state.programs, trading],
    ruleBooks: [
      {
        id: 'book',
        routineId: 'trade-rules',
        title: 'Trading rules',
        checkpoints: [],
        rules: [{ id: 'rule-1', title: 'An example rule', details: '' }],
        updatedAt: AT,
      },
    ],
  };
}

/** The process from Monday with the example instrument and limits. */
function withLimits(): State {
  const state = enableTrading(base(), 'trade-rules', new Date(2026, 10, 2, 8).toISOString());
  const profile = tradingBook(state)!.trading!;
  return saveTradingProfile(
    state,
    'trade-rules',
    {
      ...profile,
      instrument: { name: 'MNQ (example)', pointValue: 2, tick: 0.25 },
      risk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300 },
    },
    AT,
  );
}
const profileOf = (state: State): TradingProfile => tradingBook(state)!.trading!;

const TIMES = { evening: EVENING, open: OPEN, expansionPrice: 25_250 };

/** Monday's session as the earlier cockpit locked it, under `regime`. */
function lockedDay(regime: Omit<Regime, 'at'> = RANGE): TradingSession {
  return legacySession(MON, { ...TIMES, regime });
}
/** One cockpit entry, then `outcome`. */
function tradedDay(
  outcome: 'objective' | 'stopped' | null = 'objective',
  regime: Omit<Regime, 'at'> = RANGE,
): TradingSession {
  const s = lockedDay(regime);
  if (!outcome) return { ...s, entries: [legacyEntry(MID)] };
  const entries = [legacyEntry(MID, { exit: { kind: outcome, at: DONE } })];
  return outcome === 'objective'
    ? legacyFinished({ ...s, entries }, DONE)
    : legacyFailed({ ...s, entries }, DONE);
}
/** An entry taken against the bias, logged with "Log an entry I took". */
function againstBias(): TradingSession {
  const entry = legacyEntry(MID, { withBias: false, outsideRules: ['conditions'] });
  for (const key of ['setup', 'timeframe', 'notChasing', 'plan'] as const) delete entry[key];
  return { ...lockedDay(), entries: [entry] };
}

function review(
  state: State,
  over: Partial<Parameters<typeof saveTradingReview>[1]> = {},
  date = MON,
): State {
  return saveTradingReview(
    state,
    {
      date,
      routineId: 'trade-rules',
      session: 'traded',
      answers: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
      ),
      violations: [],
      entries: 1,
      failedTheses: 0,
      note: '',
      ...over,
    },
    `r-${date}`,
    AT,
  );
}

describe('the discipline questions', () => {
  it('are six, Yes or No, in order', () => {
    expect(DISCIPLINE_QUESTIONS.map((q) => q.text)).toEqual([
      'Labeled the HTF candle environment before trading',
      'Distinguished expected expansion from confirmed expansion',
      'Avoided all trades against my HTF bias',
      'Every trade had a recognizable 5m/15m GEX setup',
      'Avoided predicting and reacting emotionally to individual candles',
      'Followed my planned normal/runner management',
    ]);
  });

  it('are pre-filled from the records where they can be told, and left to the user otherwise', () => {
    expect(disciplineFromRecords(tradedDay())).toEqual({
      labeled: true,
      distinguished: true,
      withBias: true,
      namedSetups: true,
      noPrediction: null,
      followedPlan: true,
    });
    // No entry: nothing was traded against the rules.
    expect(
      disciplineFromRecords({ ...newSession(MON), doneAt: EVENING, doneReason: 'no-trade' }),
    ).toMatchObject({
      labeled: true,
      withBias: true,
      namedSetups: true,
      followedPlan: true,
      noPrediction: null,
    });
    // Against the bias, outside the cockpit: no named setup and no plan to follow.
    expect(disciplineFromRecords(againstBias())).toMatchObject({
      withBias: false,
      namedSetups: false,
      followedPlan: false,
    });
    // An open trade with no outcome recorded was not managed to its plan.
    expect(disciplineFromRecords(tradedDay(null)).followedPlan).toBe(false);
    // A session started without a classification, then traded.
    const older = tradedDay();
    const unlabeled = { ...older, thesis: { ...older.thesis!, regime: undefined } };
    expect(disciplineFromRecords(unlabeled).labeled).toBe(false);
    // A runner planned under a confirmed expansion; one recorded without it is not.
    const runner = tradedDay('objective', CONFIRMED);
    expect(disciplineFromRecords(runner).distinguished).toBe(true);
    const planned = {
      ...runner,
      entries: [
        {
          ...runner.entries![0],
          plan: {
            ...runner.entries![0].plan!,
            runner: { contracts: 1, stopPlan: 'original' as const },
          },
        },
      ],
    };
    expect(disciplineFromRecords(planned).distinguished).toBe(true);
    const downgraded = { ...lockedDay(CONFIRMED), regimeLog: [{ ...RANGE, at: OPEN }] };
    const late = { ...planned, regimeLog: downgraded.regimeLog };
    expect(disciplineFromRecords(late).distinguished).toBe(false);
    // Without a session nothing is derived.
    expect(Object.values(disciplineFromRecords(null))).toEqual(Array(6).fill(null));
    expect(disciplineAnswered(disciplineFromRecords(tradedDay()))).toBe(false);
    expect(disciplineAnswered(ALL_YES)).toBe(true);
  });
});

describe('serious violations', () => {
  it('pre-selects Traded against my daily bias, from the log or a discipline No', () => {
    const profile = profileOf(withLimits());
    expect(violationsFromLog(profile, againstBias())).toContain(VIOLATION_IDS.againstBias);
    expect(disciplineViolations(profile, { withBias: false })).toEqual(['hard-14']);
    expect(disciplineViolations(profile, { withBias: true })).toEqual([]);
    expect(disciplineViolations(profile, {})).toEqual([]);
  });

  it('pre-selects the thesis-risk and daily-loss violations for risk above the limits', () => {
    const profile = profileOf(withLimits());
    const day = tradedDay('stopped');
    expect(violationsFromLog(profile, day)).not.toContain('hard-5');
    // Risk above the session's locked limits (never possible through the risk check).
    const over = { ...day, lockedRisk: { ...day.lockedRisk!, thesisRisk: 50, dailyLoss: 40 } };
    expect(violationsFromLog(profile, over)).toEqual(expect.arrayContaining(['hard-5', 'hard-6']));
  });

  it('appends the counter-bias violation to a process without it, within the cap', () => {
    const profile = profileOf(withLimits());
    expect(withCounterBiasViolation(profile)).toBe(profile);
    const without = {
      ...profile,
      violations: profile.violations.filter((v) => v.id !== 'hard-14'),
    };
    expect(withCounterBiasViolation(without).violations.at(-1)).toEqual({
      id: 'hard-14',
      title: 'Traded against my daily bias',
      details: '',
    });
    const full = {
      ...without,
      violations: Array.from({ length: 30 }, (_, i) => ({
        id: `own-${i}`,
        title: 'Own',
        details: '',
      })),
    };
    expect(withCounterBiasViolation(full)).toBe(full);
  });
});

describe('the review with its discipline answers', () => {
  it('saves them with the review, and a correction without them keeps them', () => {
    const state = withLimits();
    const day = tradedDay();
    const saved = review(state, { discipline: ALL_YES, daySession: day });
    const r = candleReview(saved, 'trade-rules', MON)!;
    expect(r.trading!.discipline).toEqual(ALL_YES);
    expect(decodeState(JSON.parse(JSON.stringify(saved))).ruleReviews).toEqual(saved.ruleReviews);
    const corrected = review(saved, { note: 'Example note' });
    expect(candleReview(corrected, 'trade-rules', MON)!.trading!.discipline).toEqual(ALL_YES);
    const changed = review(saved, { discipline: { ...ALL_YES, noPrediction: false } });
    expect(candleReview(changed, 'trade-rules', MON)!.trading!.discipline!.noPrediction).toBe(
      false,
    );
  });

  it('needs every answer, and never keeps them on a day away', () => {
    const state = withLimits();
    expect(() =>
      review(state, { discipline: { ...ALL_YES, labeled: null } as unknown as Discipline }),
    ).toThrow(/every discipline question/);
    const away = review(state, {
      session: 'away',
      answers: {},
      entries: null,
      failedTheses: null,
      discipline: ALL_YES,
    });
    expect(candleReview(away, 'trade-rules', MON)!.trading).not.toHaveProperty('discipline');
    const r = candleReview(review(state, { discipline: ALL_YES }), 'trade-rules', MON)!;
    expect(() =>
      validateRuleReviews([
        { ...r, trading: { ...r.trading!, discipline: { ...ALL_YES, room: 1 } } },
      ]),
    ).not.toThrow();
    expect(() =>
      validateRuleReviews([
        { ...r, trading: { ...r.trading!, discipline: { ...ALL_YES, labeled: 'yes' } } },
      ]),
    ).toThrow(/discipline answer/);
    expect(() =>
      validateRuleReviews([
        {
          ...r,
          outcome: 'none',
          answers: [],
          trading: { session: 'away', entries: null, failedTheses: null, discipline: ALL_YES },
        },
      ]),
    ).toThrow(/day away/);
  });

  it('is clean only with every answer Yes, and old reviews keep their result', () => {
    const state = withLimits();
    const profile = profileOf(state);
    const result = (s: State) => sessionResult(candleReview(s, 'trade-rules', MON)!, profile);
    expect(result(review(state, { discipline: ALL_YES }))).toBe('clean');
    expect(result(review(state, { discipline: { ...ALL_YES, followedPlan: false } }))).toBe(
      'broken',
    );
    // A review saved before the discipline answers keeps the result it was recorded with.
    expect(result(review(state))).toBe('clean');
    // A planned stop-out can be clean: profit never enters the result.
    const stopped = tradedDay('stopped');
    expect(
      result(review(state, { discipline: ALL_YES, daySession: stopped, failedTheses: 1 })),
    ).toBe('clean');
    // A trade against the bias is a violation however it went.
    const against = againstBias();
    const violations = [
      ...new Set([
        ...violationsFromLog(profile, against),
        ...disciplineViolations(profile, disciplineFromRecords(against)),
      ]),
    ];
    expect(violations).toContain('hard-14');
    expect(
      result(
        review(state, {
          discipline: { ...ALL_YES, withBias: false, namedSetups: false, followedPlan: false },
          violations,
          daySession: against,
        }),
      ),
    ).toBe('broken');
    // A day without a valid setup and no trade can be clean.
    expect(
      result(
        review(state, {
          session: 'no-trade',
          entries: null,
          failedTheses: null,
          discipline: ALL_YES,
        }),
      ),
    ).toBe('clean');
  });

  it('counts toward the clean-session streak as the result says', () => {
    const state = withLimits();
    const clean = review(state, { discipline: ALL_YES });
    expect(cleanStreak(clean, tradingBook(clean)!, TODAY).best).toBe(1);
    const broken = review(state, { discipline: { ...ALL_YES, labeled: false } });
    expect(cleanStreak(broken, tradingBook(broken)!, TODAY).best).toBe(0);
  });
});
