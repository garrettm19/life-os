import type { Program, State, WorkoutSession } from '../../src/domain/model';
import { dateObject, shiftDate } from '../../src/domain/model';
import { studyState } from '../../src/test-support/fixtures';
import { recordActivity } from '../../src/domain/activity';
import { recordWeight } from '../../src/domain/measurements';
import { saveMoneyReview } from '../../src/domain/money';
import { withDay } from '../../src/domain/data';
import { ensureChecklistDay, generateDay, setStatus } from '../../src/domain/planner';
import { saveTradingReview } from '../../src/domain/trading';
import { TRADING_ROUTINE, withTradingBook } from './trading-state';

// Synthetic data only: a realistic, crowded month for layout checks. Nothing here is a real plan,
// balance or measurement. The browser clock for these screens is Monday, November 9, 2026, 9:00.
export const DENSE_TODAY = '2026-11-09';
const daysAgo = (n: number) => shiftDate(DENSE_TODAY, -n);
const at = (date: string, hour = 12) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};

function session(date: string, sets: [number, number][]): WorkoutSession {
  return {
    id: `session:${date}:routine:upper`,
    templateId: 'template-upper',
    routineId: 'upper',
    occurrenceId: `${date}:routine:upper`,
    scheduledDate: date,
    date,
    startedAt: at(date),
    finishedAt: at(date, 13),
    status: 'completed',
    note: '',
    exercises: [
      {
        exerciseId: 'upper-a',
        name: 'Bench press',
        unit: 'lb',
        plan: { sets: sets.length, repsMin: 8, repsMax: null, load: 135 },
        sets: sets.map(([load, reps]) => ({ load, reps, done: true })),
      },
    ],
  };
}

const habits: Program = {
  id: 'essentials',
  title: 'Daily essentials',
  group: 'Daily essentials',
  goalIds: [],
  routines: [
    ['water', 'Drink two liters of water before the afternoon slump'],
    ['stretch', 'Morning mobility and stretching routine'],
    ['read', 'Read twenty pages of a non-fiction book'],
    ['plan', 'Plan tomorrow'],
  ].map(([id, title]) => ({
    id,
    title,
    duration: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
  })),
};

const timed: Program = {
  id: 'commitments',
  title: 'Commitments',
  group: 'Commitments',
  goalIds: [],
  routines: [
    {
      id: 'deep-work',
      title: 'Deep work block for the portfolio project',
      duration: 90,
      weekdays: [1, 2, 3, 4, 5],
      preferredStart: 7 * 60,
      enabled: true,
      fixed: true,
      steps: [],
      bundledInto: null,
    },
    {
      id: 'call',
      title: 'Weekly call with mentor',
      duration: 30,
      weekdays: [1],
      preferredStart: 18 * 60 + 30,
      enabled: true,
      fixed: true,
      steps: [],
      bundledInto: null,
    },
  ],
};

/** A crowded Monday: study due, timed commitments, long titles and a month of records. */
export function denseState(): State {
  let state: State = studyState();
  state.programs = [...state.programs, habits, timed];
  state.workoutSessions = [
    session(daysAgo(35), [
      [135, 8],
      [145, 6],
    ]),
    session(daysAgo(28), [
      [140, 8],
      [145, 7],
    ]),
    session(daysAgo(21), [
      [145, 8],
      [150, 5],
    ]),
    session(daysAgo(14), [
      [150, 6],
      [155, 4],
    ]),
    session(daysAgo(7), [
      [150, 8],
      [155, 6],
    ]),
  ];
  [184.6, 184.1, 183.9, 183.2, 183.4, 182.8, 182.5, 182.9, 182.1, 181.7].forEach((value, i) => {
    const date = daysAgo(30 - i * 3);
    state = recordWeight(
      state,
      { value, unit: 'lb', date, fasted: true, note: '' },
      `w${i}`,
      at(date),
    );
  });
  [
    [56, 1240_00, 300_00, 18_420_00],
    [49, 1105_00, 300_00, 18_110_00],
    [42, null, 450_00, 17_860_00],
    [35, 980_00, 450_00, 17_905_00],
    [28, 1320_00, 600_00, 17_340_00],
    [21, 1410_00, 600_00, 16_980_00],
    [14, 1190_00, 750_00, 16_725_00],
    [1, 1505_00, 900_00, 16_310_00],
  ].forEach(([ago, cash, savings, debt], i) => {
    const date = daysAgo(ago as number);
    state = saveMoneyReview(
      state,
      {
        date,
        currency: 'USD',
        cash: cash as number | null,
        savings: savings as number,
        debt: debt as number,
        upcoming: null,
        contributed: null,
        savingsTarget: null,
        nextAction: i === 7 ? 'Pay an extra $200 toward the credit card with the highest rate' : '',
        note: '',
        goalId: null,
      },
      `m${i}`,
      at(date),
    );
  });
  [
    [33, 'Bike', 40],
    [29, 'Walk', 25],
    [24, 'Bike', 35],
    [19, 'Run', 22],
    [12, 'Walk', 45],
    [8, 'Bike', 30],
    [3, 'Walk', 25],
  ].forEach(([ago, activity, minutes], i) => {
    const date = daysAgo(ago as number);
    state = recordActivity(
      state,
      { date, activity: activity as string, minutes: minutes as number, note: '', routineId: null },
      `c${i}`,
      at(date),
    );
  });
  // Study history: three weeks with two misses, then done every day up to yesterday.
  for (let ago = 24; ago >= 1; ago--) {
    const date = daysAgo(ago);
    const day = ensureChecklistDay(date, state.settings, state.programs, undefined, at(date, 8));
    const missed = ago === 17 || ago === 11;
    let next = missed ? day : setStatus(day, `${date}:routine:study`, 'done', at(date, 20));
    if (ago % 2 === 0) next = setStatus(next, `${date}:routine:water`, 'done', at(date, 15));
    state = withDay(state, next);
  }
  // Trading: the process from three weeks ago, with clean, rule-broken and no-trade sessions.
  state = withTradingBook(state, daysAgo(21));
  for (let ago = 18; ago >= 1; ago--) {
    const date = daysAgo(ago);
    const weekday = dateObject(date).getDay();
    if (weekday === 0 || weekday === 6) continue;
    const answers: Record<string, 'yes' | 'no'> = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes']),
    );
    if (ago % 5 === 0) answers['process-2'] = 'no';
    state = saveTradingReview(
      state,
      {
        date,
        routineId: TRADING_ROUTINE,
        session: ago % 4 === 0 ? 'no-trade' : 'traded',
        answers,
        violations: ago === 9 ? ['hard-2'] : [],
        entries: ago % 4 === 0 ? 0 : 2,
        failedTheses: ago % 5 === 0 ? 1 : 0,
        note: '',
      },
      `t-${date}`,
      at(date, 17),
    );
  }
  // Today: timed work placed, two essentials already done.
  let today = generateDay(
    DENSE_TODAY,
    state.settings,
    state.programs,
    undefined,
    at(DENSE_TODAY, 7),
  );
  today = ensureChecklistDay(
    DENSE_TODAY,
    state.settings,
    state.programs,
    today,
    at(DENSE_TODAY, 7),
  );
  today = setStatus(today, `${DENSE_TODAY}:routine:water`, 'done', at(DENSE_TODAY, 8));
  today = setStatus(today, `${DENSE_TODAY}:routine:stretch`, 'done', at(DENSE_TODAY, 8));
  return withDay(state, today);
}
