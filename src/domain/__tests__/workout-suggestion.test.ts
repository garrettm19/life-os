import { describe, expect, it } from '@jest/globals';
import type { LoggedSet, SessionExercise } from '../model';
import { setSuggestion } from '../workouts';

// Synthetic exercise: a plan with no load, as a first session from an imported setup has.
function bench(sets: LoggedSet[], load: number | null = null): SessionExercise {
  return {
    exerciseId: 'bench',
    name: 'Bench press',
    unit: 'lb',
    plan: { sets: sets.length, repsMin: 8, repsMax: 10, load },
    sets,
  };
}
const open: LoggedSet = { reps: null, load: null, done: false };

describe('setSuggestion', () => {
  it('carries the load and reps logged on the set above down a first session', () => {
    const exercise = bench([{ reps: 6, load: 135, done: true }, open, open]);
    expect(setSuggestion(exercise, undefined, 0)).toEqual({ reps: 8, load: null, seconds: null });
    expect(setSuggestion(exercise, undefined, 1)).toEqual({ reps: 6, load: 135, seconds: null });
    // Set 3 follows set 2's suggestion, so one typed load serves every later set.
    expect(setSuggestion(exercise, undefined, 2)).toEqual({ reps: 6, load: 135, seconds: null });
  });

  it('uses a load typed on the set above before it is logged', () => {
    const exercise = bench([{ reps: null, load: 95, done: false }, open]);
    expect(setSuggestion(exercise, undefined, 1).load).toBe(95);
  });

  it('keeps the same set from last session first, then the plan', () => {
    const exercise = bench([{ reps: 8, load: 140, done: true }, open, open], 100);
    const previous: LoggedSet[] = [
      { reps: 8, load: 135, done: true },
      { reps: 7, load: 130, done: true },
    ];
    expect(setSuggestion(exercise, previous, 1)).toEqual({ reps: 7, load: 130, seconds: null });
    // Past the end of last session, its last set still counts.
    expect(setSuggestion(exercise, previous, 2).load).toBe(130);
    expect(setSuggestion(bench([open]), undefined, 0).load).toBeNull();
    expect(setSuggestion(bench([open], 100), undefined, 0).load).toBe(100);
  });

  it('carries seconds down a timed exercise', () => {
    const plank: SessionExercise = {
      ...bench([]),
      kind: 'time',
      plan: { sets: 2, repsMin: 1, repsMax: null, load: null, seconds: 30 },
      sets: [
        { reps: null, load: null, done: true, seconds: 45 },
        { reps: null, load: null, done: false, seconds: null },
      ],
    };
    expect(setSuggestion(plank, undefined, 0).seconds).toBe(30);
    expect(setSuggestion(plank, undefined, 1).seconds).toBe(45);
  });
});
