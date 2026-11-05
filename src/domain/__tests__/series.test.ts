import { describe, expect, it } from '@jest/globals';
import { recordWeight } from '../measurements';
import { saveMoneyReview } from '../money';
import { State, WorkoutSession, shiftDate } from '../model';
import { recordActivity, weeklyMinutes } from '../activity';
import {
  cardioTarget,
  exerciseOptions,
  moneySince,
  rangeStart,
  representativeSet,
  strengthSeries,
  weightSince,
} from '../series';
import { trainingState } from '../../test-support/fixtures';

const TODAY = '2026-11-30';
/** A local time on a local date, so every time zone agrees on the day. */
const at = (date: string, hour = 12) =>
  new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour,
  ).toISOString();

type SetSpec = [number | null, number];
function session(
  id: string,
  date: string,
  exercises: { id: string; name?: string; unit?: 'lb' | 'kg'; sets: SetSpec[] }[],
  status: WorkoutSession['status'] = 'completed',
): WorkoutSession {
  return {
    id: `session:${id}`,
    templateId: 't',
    routineId: 'upper',
    occurrenceId: id,
    scheduledDate: date,
    date,
    startedAt: at(date, 10),
    finishedAt: status === 'completed' ? at(date, 11) : null,
    status,
    note: '',
    exercises: exercises.map((e) => ({
      exerciseId: e.id,
      name: e.name ?? e.id,
      unit: e.unit ?? 'lb',
      plan: { sets: e.sets.length, repsMin: 5, repsMax: null, load: null },
      sets: e.sets.map(([load, reps]) => ({ load, reps, done: true })),
    })),
  };
}

describe('ranges', () => {
  it('counts back calendar months and clamps to shorter months', () => {
    expect(rangeStart('1m', '2026-11-30')).toBe('2026-10-30');
    expect(rangeStart('3m', '2026-05-31')).toBe('2026-02-28');
    expect(rangeStart('6m', '2026-03-15')).toBe('2025-09-15');
    expect(rangeStart('all', '2026-03-15')).toBeNull();
  });
});

describe('strength', () => {
  it('picks the heaviest completed set, then the most reps at that load', () => {
    expect(
      representativeSet([
        { load: 135, reps: 8, done: true },
        { load: 155, reps: 3, done: true },
        { load: 155, reps: 5, done: true },
        { load: 185, reps: 1, done: false },
      ]),
    ).toEqual({ load: 155, reps: 5 });
    // Sets without a load (body weight) rank by reps alone.
    expect(
      representativeSet([
        { load: null, reps: 12, done: true },
        { load: null, reps: 15, done: true },
      ]),
    ).toEqual({ load: null, reps: 15 });
    expect(representativeSet([{ load: 100, reps: 5, done: false }])).toBeNull();
  });

  it('gives one point per completed session; unfinished sessions, other units and exercises stay out', () => {
    const state: State = {
      ...trainingState(),
      workoutSessions: [
        session('a', '2026-11-02', [
          {
            id: 'bench',
            sets: [
              [135, 8],
              [145, 6],
              [145, 7],
            ],
          },
          { id: 'row', sets: [[100, 10]] },
        ]),
        session('b', '2026-11-09', [{ id: 'bench', sets: [[150, 5]] }]),
        session('c', '2026-11-16', [{ id: 'bench', sets: [[200, 1]] }], 'active'),
        session('d', '2026-11-23', [{ id: 'bench', unit: 'kg', sets: [[70, 5]] }]),
      ],
    };
    const points = strengthSeries(state, 'bench|lb', 'all', TODAY);
    expect(points.map((p) => [p.date, p.load, p.reps])).toEqual([
      ['2026-11-02', 145, 7],
      ['2026-11-09', 150, 5],
    ]);
    // Tapping a point shows that session's actual sets.
    expect(points[0].sets.map((s) => [s.load, s.reps])).toEqual([
      [135, 8],
      [145, 6],
      [145, 7],
    ]);
    expect(strengthSeries(state, 'bench|kg', 'all', TODAY).map((p) => p.load)).toEqual([70]);
    expect(strengthSeries(state, 'bench|lb', '1m', '2026-12-05').map((p) => p.date)).toEqual([
      '2026-11-09',
    ]);
    expect(exerciseOptions(state).map((o) => [o.key, o.sessions])).toEqual([
      ['bench|kg', 1],
      ['bench|lb', 2],
      ['row|lb', 1],
    ]);
  });

  it('combines the same exercise from two workouts only when they share an exercise ID', () => {
    const state: State = {
      ...trainingState(),
      workoutSessions: [
        session('a', '2026-11-02', [{ id: 'lateral', name: 'Lateral raise', sets: [[15, 12]] }]),
        session('b', '2026-11-05', [{ id: 'lateral', name: 'Lateral raise', sets: [[17.5, 10]] }]),
        session('c', '2026-11-06', [{ id: 'lateral-2', name: 'Lateral raise', sets: [[50, 10]] }]),
      ],
    };
    expect(strengthSeries(state, 'lateral|lb', 'all', TODAY).map((p) => p.load)).toEqual([
      15, 17.5,
    ]);
  });
});

describe('body weight', () => {
  function weights(entries: [string, number, ('lb' | 'kg')?][]): State {
    let state = trainingState();
    entries.forEach(([date, value, unit], i) => {
      state = recordWeight(
        state,
        { value, unit: unit ?? 'lb', date, fasted: true, note: '' },
        `w${i}`,
        at(date, 8 + (i % 3)),
      );
    });
    return state;
  }

  it('plots only measured days and leaves missing days missing', () => {
    const series = weightSince(
      weights([
        ['2026-11-01', 180],
        ['2026-11-05', 179.4],
      ]),
      null,
      TODAY,
    )!;
    expect(series.points).toEqual([
      { date: '2026-11-01', y: 180 },
      { date: '2026-11-05', y: 179.4 },
    ]);
    expect(series.average).toEqual([]);
  });

  it('shows a seven-day average only where the week has at least four measurements', () => {
    const days = Array.from({ length: 6 }, (_, i) => shiftDate('2026-11-20', i));
    const series = weightSince(
      weights(days.map((d, i) => [d, 180 + i] as [string, number])),
      null,
      TODAY,
    )!;
    expect(series.average.map((p) => p.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
    // The 23rd averages 180, 181, 182 and 183 only.
    expect(series.average[0].y).toBe(181.5);
  });

  it('uses the most recent unit and converts older entries from the stored grams', () => {
    const series = weightSince(
      weights([
        ['2026-11-01', 180, 'lb'],
        ['2026-11-02', 81.5, 'kg'],
      ]),
      null,
      TODAY,
    )!;
    expect(series.unit).toBe('kg');
    expect(series.points).toEqual([
      { date: '2026-11-01', y: 81.6 },
      { date: '2026-11-02', y: 81.5 },
    ]);
  });

  it('has nothing to show without a measurement', () => {
    expect(weightSince(trainingState(), null, TODAY)).toBeNull();
  });
});

describe('money', () => {
  it('plots reported totals only; a blank field is a gap, not zero', () => {
    let state = trainingState();
    const review = (date: string, cash: number | null, debt: number | null, id: string) => {
      state = saveMoneyReview(
        state,
        {
          date,
          currency: 'USD',
          cash,
          savings: null,
          debt,
          upcoming: null,
          contributed: null,
          savingsTarget: null,
          nextAction: '',
          note: '',
          goalId: null,
        },
        id,
        at(date),
      );
    };
    review('2026-11-01', 100_00, 5000_00, 'm1');
    review('2026-11-08', null, 4800_00, 'm2');
    review('2026-11-15', 250_00, 4700_00, 'm3');
    expect(moneySince(state, 'cash', null, TODAY)!.points).toEqual([
      { date: '2026-11-01', y: 100_00 },
      { date: '2026-11-15', y: 250_00 },
    ]);
    expect(moneySince(state, 'debt', null, TODAY)!.points).toHaveLength(3);
    expect(moneySince(state, 'savings', null, TODAY)!.points).toEqual([]);
  });
});

describe('cardio', () => {
  it('sums recorded minutes by week, never scheduled minutes, and never double-counts', () => {
    const base = trainingState();
    const cardio = {
      ...base.programs[0].routines[0],
      id: 'cardio',
      title: 'Cardio',
      duration: 30,
      weekdays: [1, 3, 5],
      capture: 'activity' as const,
    };
    let state: State = {
      ...base,
      programs: [
        {
          ...base.programs[0],
          routines: [...base.programs[0].routines, cardio],
        },
      ],
    };
    expect(cardioTarget(state, '2026-11-09')).toBe(90);
    const log = (
      date: string,
      minutes: number,
      id: string,
      routineId: string | null = 'cardio',
    ) => {
      state = recordActivity(
        state,
        { date, activity: 'Bike', minutes, note: '', routineId },
        id,
        at(date),
      );
    };
    log('2026-11-09', 40, 'a1');
    log('2026-11-11', 25, 'a2');
    log('2026-11-16', 30, 'a3');
    // The same session is one record; linking another program does not add a second count.
    expect(state.activitySessions).toHaveLength(3);
    const weeks = weeklyMinutes(state, '2026-11-18', 2);
    expect(weeks.map((w) => [w.weekStart, w.minutes, w.sessions])).toEqual([
      ['2026-11-09', 65, 2],
      ['2026-11-16', 30, 1],
    ]);
    expect(weeks.reduce((n, w) => n + w.minutes, 0)).toBe(95);
    expect(weeklyMinutes(trainingState(), TODAY).every((w) => w.minutes === 0)).toBe(true);
  });

  it('sets a target only for the weeks a repeating routine is due', () => {
    const base = trainingState();
    const cardio = {
      ...base.programs[0].routines[0],
      id: 'cardio',
      title: 'Long ride',
      duration: 120,
      weekdays: [6],
      capture: 'activity' as const,
      repeat: { everyWeeks: 2, anchor: '2026-11-16' },
    };
    let state: State = {
      ...base,
      programs: [{ ...base.programs[0], routines: [...base.programs[0].routines, cardio] }],
    };
    expect(cardioTarget(state, '2026-11-09')).toBeNull();
    expect(cardioTarget(state, '2026-11-16')).toBe(120);
    expect(cardioTarget(state, '2026-11-23')).toBeNull();
    for (const [date, id] of [
      ['2026-11-14', 'r1'],
      ['2026-11-21', 'r2'],
    ])
      state = recordActivity(
        state,
        { date, activity: 'Bike', minutes: 90, note: '', routineId: 'cardio' },
        id,
        at(date),
      );
    expect(
      weeklyMinutes(state, '2026-11-22', 2).map((w) => [
        w.weekStart,
        w.minutes,
        cardioTarget(state, w.weekStart),
      ]),
    ).toEqual([
      ['2026-11-09', 90, null],
      ['2026-11-16', 90, 120],
    ]);
  });

  it('counts each session in the week of its local date', () => {
    let state = trainingState();
    state = recordActivity(
      state,
      { date: '2026-10-05', activity: 'Walk', minutes: 20, note: '', routineId: null },
      'old',
      at('2026-10-05'),
    );
    state = recordActivity(
      state,
      { date: '2026-11-10', activity: 'Walk', minutes: 15, note: '', routineId: null },
      'new',
      at('2026-11-10'),
    );
    expect(weeklyMinutes(state, '2026-11-30').map((w) => [w.weekStart, w.minutes])).toEqual([
      ['2026-11-09', 15],
      ['2026-11-16', 0],
      ['2026-11-23', 0],
      ['2026-11-30', 0],
    ]);
    expect(weeklyMinutes(state, '2026-10-05', 1)).toEqual([
      { weekStart: '2026-10-05', minutes: 20, sessions: 1 },
    ]);
  });
});
