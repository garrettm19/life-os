import type { State, WorkoutSession } from '../../src/domain/model';
import { shiftDate } from '../../src/domain/model';
import { trainingState } from '../../src/test-support/fixtures';
import { recordActivity } from '../../src/domain/activity';
import { recordWeight } from '../../src/domain/measurements';
import { saveMoneyReview } from '../../src/domain/money';

// Synthetic records only, dated in the weeks before a pinned "today": Monday, November 9, 2026,
// 9:00. Three bench sessions, six weigh-ins, three money check-ins and two cardio sessions.
export const GRAPH_TODAY = '2026-11-09';
export const GRAPH_CLOCK = new Date(2026, 10, 9, 9);
export const daysAgo = (n: number) => shiftDate(GRAPH_TODAY, -n);
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function session(id: string, date: string, sets: [number, number][]): WorkoutSession {
  return {
    id: `session:${id}`,
    templateId: 'upper-plan',
    routineId: 'upper',
    occurrenceId: id,
    scheduledDate: date,
    date,
    startedAt: noon(date),
    finishedAt: noon(date).replace('12:00', '12:45'),
    status: 'completed',
    note: '',
    exercises: [
      {
        exerciseId: 'bench',
        name: 'Bench press',
        unit: 'lb',
        plan: { sets: sets.length, repsMin: 5, repsMax: null, load: null },
        sets: sets.map(([load, reps]) => ({ load, reps, done: true })),
      },
    ],
  };
}

export function graphState(): State {
  let state: State = {
    ...trainingState(),
    workoutSessions: [
      // Sep 30, Oct 14 and Oct 28: heaviest sets 145 × 6, 150 × 5 and 155 × 5.
      session('s1', daysAgo(40), [
        [135, 8],
        [145, 6],
      ]),
      session('s2', daysAgo(26), [
        [145, 8],
        [150, 5],
      ]),
      session('s3', daysAgo(12), [
        [150, 6],
        [155, 4],
        [155, 5],
      ]),
    ],
  };
  // Oct 30 to Nov 4.
  [181.2, 180.8, 180.6, 180.9, 180.1, 179.8].forEach((value, i) => {
    const date = daysAgo(10 - i);
    state = recordWeight(
      state,
      { value, unit: 'lb', date, fasted: true, note: '' },
      `w${i}`,
      noon(date),
    );
  });
  // Oct 10, Oct 24 and Nov 7; cash left blank on Oct 24, savings never reported.
  [
    [30, 1200_00, 5400_00],
    [16, null, 5100_00],
    [2, 1650_00, 4800_00],
  ].forEach(([ago, cash, debt], i) => {
    const date = daysAgo(ago as number);
    state = saveMoneyReview(
      state,
      {
        date,
        currency: 'USD',
        cash: cash as number | null,
        savings: null,
        debt: debt as number,
        upcoming: null,
        contributed: null,
        savingsTarget: null,
        nextAction: '',
        note: '',
        goalId: null,
      },
      `m${i}`,
      noon(date),
    );
  });
  // Oct 30 (week of Oct 26) and Nov 6 (week of Nov 2).
  state = recordActivity(
    state,
    { date: daysAgo(10), activity: 'Bike', minutes: 40, note: '', routineId: null },
    'c1',
    noon(daysAgo(10)),
  );
  state = recordActivity(
    state,
    { date: daysAgo(3), activity: 'Walk', minutes: 25, note: '', routineId: null },
    'c2',
    noon(daysAgo(3)),
  );
  return state;
}
