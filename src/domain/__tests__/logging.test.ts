import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { Block, State, WorkoutSession, WorkoutTemplate } from '../model';
import { strengthSeries } from '../series';
import {
  exerciseLibrary,
  finishSession,
  previousPerformance,
  saveSession,
  saveTemplate,
  sessionFor,
  setsText,
  startSession,
  substituteExercise,
} from '../workouts';
import { AT, trainingState } from '../../test-support/fixtures';

// Synthetic plans only: a timed carry, an exercise shared by two workouts, and substitutions.
const MON = '2026-11-09';
const WED = '2026-11-11';
const FRI = '2026-11-13';
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function block(date: string, routineId: string): Block {
  return {
    id: `${date}:routine:${routineId}`,
    routineId,
    programId: 'training',
    title: routineId,
    start: null,
    duration: 60,
    fixed: false,
    status: 'planned',
    actualAt: null,
    steps: [],
    reason: null,
    checklist: true,
  };
}

function withBlock(state: State, date: string, routineId: string): State {
  const day = state.days[date] ?? { date, blocks: [], revisions: [] };
  return withDay(state, { ...day, blocks: [...day.blocks, block(date, routineId)] });
}

/** Starts, logs every set with `fill`, and finishes a workout on a date. */
function perform(
  state: State,
  date: string,
  routineId: string,
  fill: (exerciseId: string, i: number) => Partial<WorkoutSession['exercises'][0]['sets'][0]>,
): State {
  state = withBlock(state, date, routineId);
  const b = block(date, routineId);
  state = startSession(state, date, b, noon(date));
  const session = sessionFor(state, b.id)!;
  const logged: WorkoutSession = {
    ...session,
    exercises: session.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((set, i) => ({ ...set, ...fill(e.exerciseId, i), done: true })),
    })),
  };
  state = saveSession(state, logged);
  return finishSession(state, date, b.id, logged, noon(date).replace('12:00', '13:00'));
}

function withTimedLower(state: State): State {
  const lower = state.workoutTemplates.find((t) => t.routineId === 'lower')!;
  const timed: WorkoutTemplate = {
    ...lower,
    exercises: [
      {
        id: 'sled',
        name: 'Backward sled',
        sets: 1,
        repsMin: 1,
        repsMax: null,
        load: null,
        unit: 'lb',
        restSeconds: null,
        note: '',
        kind: 'time',
        seconds: 300,
      },
      ...lower.exercises,
    ],
  };
  return saveTemplate(state, timed);
}

describe('timed exercises', () => {
  it('record seconds instead of weight and reps, and read back as durations', () => {
    let state = withTimedLower(trainingState());
    state = withBlock(state, WED, 'lower');
    state = startSession(state, WED, block(WED, 'lower'), noon(WED));
    const session = sessionFor(state, `${WED}:routine:lower`)!;
    expect(session.exercises[0]).toMatchObject({ kind: 'time', plan: { seconds: 300 } });
    // A timed set needs its time; reps alone are not a timed set.
    const missing = {
      ...session,
      exercises: session.exercises.map((e, i) =>
        i === 0 ? { ...e, sets: [{ reps: 5, load: null, done: true, seconds: null }] } : e,
      ),
    };
    expect(() => saveSession(state, missing)).toThrow(/without its time/);
    state = perform(withTimedLower(trainingState()), WED, 'lower', (id) =>
      id === 'sled' ? { seconds: 290 } : { reps: 8, load: 100 },
    );
    const later = sessionFor(
      startSession(withBlock(state, FRI, 'lower'), FRI, block(FRI, 'lower'), noon(FRI)),
      `${FRI}:routine:lower`,
    )!;
    const previous = previousPerformance(state, later.exercises[0], later)!;
    expect(previous.sets.map((s) => s.seconds)).toEqual([290]);
    expect(setsText(previous.sets, 'lb')).toBe('4:50');
    // Strength graphs never treat a timed set as a lift.
    expect(strengthSeries(state, 'sled|lb', 'all', FRI)).toEqual([]);
  });
});

describe('shared exercise identity', () => {
  it('the same exercise ID in two workouts shares one history and one library entry', () => {
    let state = trainingState();
    const upper = state.workoutTemplates.find((t) => t.routineId === 'upper')!;
    const lower = state.workoutTemplates.find((t) => t.routineId === 'lower')!;
    // Lower body also does the upper workout's lat pulldown, by the same exercise ID.
    state = saveTemplate(state, { ...lower, exercises: [...lower.exercises, upper.exercises[1]] });
    expect(exerciseLibrary(state).find((e) => e.id === 'upper-b')!.workouts).toEqual([
      'Upper body',
      'Lower body',
    ]);
    state = perform(state, MON, 'upper', () => ({ reps: 10, load: 120 }));
    state = withBlock(state, WED, 'lower');
    state = startSession(state, WED, block(WED, 'lower'), noon(WED));
    const session = sessionFor(state, `${WED}:routine:lower`)!;
    const pulldown = session.exercises.find((e) => e.exerciseId === 'upper-b')!;
    expect(previousPerformance(state, pulldown, session)!.date).toBe(MON);
    expect(strengthSeries(state, 'upper-b|lb', 'all', WED).map((p) => p.load)).toEqual([120]);
  });
});

describe('same-day substitution', () => {
  function started(): State {
    let state = trainingState();
    state = withBlock(state, MON, 'upper');
    return startSession(state, MON, block(MON, 'upper'), noon(MON));
  }
  const id = `session:${MON}:routine:upper`;

  it('swaps an exercise for this session only, with its own history', () => {
    let state = started();
    state = substituteExercise(
      state,
      id,
      0,
      { exerciseId: 'db-press', name: 'Dumbbell press', unit: 'lb' },
      false,
      AT,
    );
    const session = sessionFor(state, `${MON}:routine:upper`)!;
    expect(session.exercises[0]).toMatchObject({
      exerciseId: 'db-press',
      name: 'Dumbbell press',
      substitutedFor: { exerciseId: 'upper-a', name: 'Bench press' },
      plan: { sets: 3, repsMin: 8, load: null },
    });
    // The plan is unchanged; the next session plans the original again.
    expect(state.workoutTemplates.find((t) => t.routineId === 'upper')!.exercises[0].id).toBe(
      'upper-a',
    );
    // Swapping back clears the substitution.
    state = substituteExercise(
      state,
      id,
      0,
      { exerciseId: 'upper-a', name: 'Bench press', unit: 'lb' },
      false,
      AT,
    );
    expect(sessionFor(state, `${MON}:routine:upper`)!.exercises[0].substitutedFor).toBeUndefined();
  });

  it('can also change the plan, and is refused once sets are logged or for a duplicate', () => {
    let state = substituteExercise(
      started(),
      id,
      0,
      { exerciseId: 'db-press', name: 'Dumbbell press', unit: 'lb' },
      true,
      AT,
    );
    const plan = state.workoutTemplates.find((t) => t.routineId === 'upper')!;
    expect(plan.exercises[0]).toMatchObject({ id: 'db-press', name: 'Dumbbell press', sets: 3 });
    expect(plan.exercises[0].load).toBeNull();
    expect(() =>
      substituteExercise(
        state,
        id,
        1,
        { exerciseId: 'db-press', name: 'Dumbbell press', unit: 'lb' },
        false,
        AT,
      ),
    ).toThrow(/already in this workout/);
    const session = sessionFor(state, `${MON}:routine:upper`)!;
    state = saveSession(state, {
      ...session,
      exercises: session.exercises.map((e, i) =>
        i === 1 ? { ...e, sets: [{ reps: 10, load: 90, done: true }, ...e.sets.slice(1)] } : e,
      ),
    });
    expect(() =>
      substituteExercise(state, id, 1, { exerciseId: 'row', name: 'Row', unit: 'lb' }, false, AT),
    ).toThrow(/already logged/);
  });
});
