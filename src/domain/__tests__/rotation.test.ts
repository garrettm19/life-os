import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, withDay } from '../data';
import { basicState } from '../../test-support/basic-state';
import { CORE_CIRCUIT, newCircuit, saveCircuit } from '../intervals';
import { Program, Routine, State, WorkoutTemplate, shiftDate } from '../model';
import { dayOutcome, dayProgress } from '../objectives';
import { generateDay, setStatus } from '../planner';
import {
  applyCompanionMove,
  ensureDay,
  extraDue,
  needsEnsure,
  nextWorkout,
  offersRotation,
  planCompanionMove,
  planKeep,
  projectDraftRotation,
  projectRotation,
  projectedWorkouts,
  restDay,
  restedByChoice,
  rotationWorkouts,
  setRotation,
  skipObjective,
  trainDay,
} from '../rotation';
import { upsertRoutine } from '../routines';
import { saveSession, startSession } from '../workouts';

// Synthetic three-workout rotation (A → B → C) resting on Sundays, plus a home routine that
// follows workout A. Nothing here is a real training plan.

/** Local noon on a date, so every time zone agrees on the day. */
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};
const MON = '2026-11-09';

function routine(id: string, extra: Partial<Routine> = {}): Routine {
  return {
    id,
    title: `Workout ${id.toUpperCase()}`,
    duration: 60,
    weekdays: [1, 3, 5],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  };
}

function template(routineId: string): WorkoutTemplate {
  return {
    id: `plan-${routineId}`,
    routineId,
    title: `Workout ${routineId.toUpperCase()}`,
    note: '',
    updatedAt: noon(MON),
    exercises: [
      {
        id: `ex-${routineId}`,
        name: 'Press',
        sets: 3,
        repsMin: 8,
        repsMax: null,
        load: null,
        unit: 'lb',
        restSeconds: null,
        note: '',
      },
    ],
  };
}

function base(): State {
  const state = basicState();
  state.source = 'personal';
  const gym: Program = {
    id: 'gym-rotation',
    title: 'Gym',
    group: 'Training',
    goalIds: [],
    routines: [
      routine('a'),
      routine('b'),
      routine('c'),
      routine('home', { title: 'Home routine', weekdays: [], follows: ['a'] }),
    ],
  };
  return {
    ...state,
    programs: [gym],
    workoutTemplates: ['a', 'b', 'c'].map(template),
  };
}

function rotating(): State {
  return setRotation(
    base(),
    'gym-rotation',
    { order: ['a', 'b', 'c'], restDays: [0], startWith: null },
    noon(MON),
  );
}

const program = (state: State) => state.programs.find((p) => p.id === 'gym-rotation')!;
const titles = (state: State, date: string) =>
  (state.days[date]?.blocks ?? []).map((b) => `${b.title}:${b.status}`).sort();
/** Opens Today on a date at noon, as the app does. */
const open = (state: State, date: string) => ensureDay(state, date, noon(date));
const complete = (state: State, date: string, routineId: string) =>
  withDay(state, setStatus(state.days[date], `${date}:routine:${routineId}`, 'done', noon(date)));

describe('workout rotation', () => {
  it('places only the next workout, with its companion, on a training day', () => {
    const state = open(rotating(), MON);
    expect(titles(state, MON)).toEqual(['Home routine:planned', 'Workout A:planned']);
    expect(nextWorkout(state, program(state), MON)).toBe('a');
  });

  it('advances only when a workout is completed, once per completion', () => {
    let state = open(rotating(), MON);
    // Opening Today again, or viewing it, changes nothing.
    expect(needsEnsure(state, MON, MON)).toBe(false);
    state = complete(state, MON, 'a');
    // Still one workout today: completing A never adds B to the same day.
    state = open(state, MON);
    expect(titles(state, MON)).toEqual(['Home routine:planned', 'Workout A:done']);
    const tue = shiftDate(MON, 1);
    state = open(state, tue);
    expect(titles(state, tue)).toEqual(['Workout B:planned']);
  });

  it('a missed day, a skip or a rest day does not advance it', () => {
    let state = open(rotating(), MON);
    const tue = shiftDate(MON, 1);
    // Monday's A was never done: Tuesday is A again, and Monday stays as recorded.
    state = open(state, tue);
    expect(titles(state, tue)).toEqual(['Home routine:planned', 'Workout A:planned']);
    expect(titles(state, MON)).toEqual(['Home routine:planned', 'Workout A:planned']);
    // Skipping is explicit and does not count as done.
    state = withDay(state, setStatus(state.days[tue], `${tue}:routine:a`, 'skipped', noon(tue)));
    const wed = shiftDate(MON, 2);
    state = open(state, wed);
    expect(titles(state, wed)).toEqual(['Home routine:planned', 'Workout A:planned']);
    // A rest day removes the planned workout and its companion; Thursday is still A.
    state = restDay(state, 'gym-rotation', wed, noon(wed));
    expect(titles(state, wed)).toEqual([]);
    expect(open(state, wed).days[wed].blocks).toEqual([]);
    const thu = shiftDate(MON, 3);
    expect(titles(open(state, thu), thu)).toEqual(['Home routine:planned', 'Workout A:planned']);
  });

  it('rests on default rest days unless the user trains, and Undo moves it back', () => {
    let state = rotating();
    const sun = '2026-11-15';
    state = open(state, sun);
    expect(titles(state, sun)).toEqual([]);
    state = trainDay(state, 'gym-rotation', sun, noon(sun));
    state = open(state, sun);
    expect(titles(state, sun)).toEqual(['Home routine:planned', 'Workout A:planned']);
    state = complete(state, sun, 'a');
    expect(nextWorkout(state, program(state), shiftDate(sun, 1))).toBe('b');
    // Undo returns the rotation to A.
    state = withDay(state, setStatus(state.days[sun], `${sun}:routine:a`, 'planned'));
    expect(nextWorkout(state, program(state), shiftDate(sun, 1))).toBe('a');
    // Resting again restores the default.
    state = restDay(state, 'gym-rotation', sun, noon(sun));
    expect(state.days[sun].rotation).toBeUndefined();
    expect(titles(state, sun)).toEqual([]);
  });

  it('keeps its order across week, month and daylight-saving boundaries', () => {
    let state = rotating();
    const seen: string[] = [];
    // 2026-10-26 to 2026-11-10 crosses a month end and the US and EU clock changes.
    for (let i = 0; i < 16; i++) {
      const date = shiftDate('2026-10-26', i);
      state = open(state, date);
      const workout = state.days[date].blocks.find((b) => ['a', 'b', 'c'].includes(b.routineId!));
      if (!workout) {
        seen.push('rest');
        continue;
      }
      seen.push(workout.routineId!);
      state = complete(state, date, workout.routineId!);
    }
    expect(seen.join(' ')).toBe('a b c a b c rest a b c a b c rest a b');
  });

  it('never rests a workout that is done or has logged sets', () => {
    let state = open(rotating(), MON);
    const block = state.days[MON].blocks.find((b) => b.routineId === 'a')!;
    state = startSession(state, MON, block, noon(MON));
    const session = state.workoutSessions[0];
    state = saveSession(state, {
      ...session,
      exercises: [{ ...session.exercises[0], sets: [{ reps: 8, load: 100, done: true }] }],
    });
    expect(() => restDay(state, 'gym-rotation', MON, noon(MON))).toThrow(/logged sets/);
    expect(() =>
      restDay(complete(open(rotating(), MON), MON, 'a'), 'gym-rotation', MON, noon(MON)),
    ).toThrow(/already done/);
  });

  it('Generate day and routine edits keep the rotation workout and companion', () => {
    let state = open(rotating(), MON);
    const day = generateDay(
      MON,
      state.settings,
      state.programs,
      state.days[MON],
      noon(MON),
      planKeep(state, MON),
    );
    expect(
      day.blocks
        .map((b) => b.routineId)
        .filter(Boolean)
        .sort(),
    ).toEqual(['a', 'home']);
    const gym = program(state);
    state = upsertRoutine(
      state,
      gym,
      { ...gym.routines[0], title: 'Workout A (heavy)' },
      noon(MON),
    );
    // The occurrence stays, and today's planned one takes the new name.
    expect(titles(state, MON)).toEqual(['Home routine:planned', 'Workout A (heavy):planned']);
    // Pausing it removes its planned occurrence from today on; the rotation moves past it.
    state = upsertRoutine(
      state,
      program(state),
      { ...program(state).routines[0], enabled: false },
      noon(MON),
    );
    expect(state.days[MON].blocks.some((b) => b.routineId === 'a')).toBe(false);
    expect(nextWorkout(state, program(state), MON)).toBe('b');
  });

  it('projects the coming week without saving it', () => {
    const state = open(rotating(), MON);
    expect(
      projectRotation(state, program(state), MON, 8).map((d) => `${d.kind}:${d.routineId ?? '-'}`),
    ).toEqual([
      'planned:a',
      'projected:b',
      'projected:c',
      'projected:a',
      'projected:b',
      'projected:c',
      'rest:-',
      'projected:a',
    ]);
    expect(Object.keys(state.days)).toEqual([MON]);
  });

  it('names the projected workout of a later training day, with its companion, never of a rest day', () => {
    let state = open(rotating(), MON);
    // A later day opened ahead holds no rotation workout, yet Today says what is projected.
    const wed = shiftDate(MON, 2);
    state = ensureDay(state, wed, noon(MON));
    expect(state.days[wed].blocks.some((b) => ['a', 'b', 'c'].includes(b.routineId!))).toBe(false);
    const line = (date: string) =>
      projectedWorkouts(state, date, MON).map((w) => [w.title, w.companions]);
    expect(line(wed)).toEqual([['Workout C', []]]);
    expect(line(shiftDate(MON, 3))).toEqual([['Workout A', ['Home routine']]]);
    // Sunday rests, and today holds its own workout: neither gets a projection line.
    expect(line(shiftDate(MON, 6))).toEqual([]);
    expect(line(MON)).toEqual([]);
    // The line describes the projection only: the day's count is left as saved.
    expect(dayProgress(state.days[wed], state.programs, wed).total).toBe(
      state.days[wed].blocks.filter((b) => !b.optional).length,
    );
  });

  it('previews a draft as Save places it: today turned rest, or another workout to start with', () => {
    const state = open(rotating(), MON);
    const kinds = (days: ReturnType<typeof projectRotation>) =>
      days.map((d) => `${d.date.slice(8)}:${d.routineId ?? 'rest'}`);
    const saved = (rotation: { order: string[]; restDays: number[]; startWith: string | null }) => {
      const next = open(setRotation(state, 'gym-rotation', rotation, noon(MON)), MON);
      return projectRotation(next, program(next), MON);
    };
    // Monday becomes a default rest day: today's planned workout A is the one Save replaces.
    const resting = { order: ['a', 'b', 'c'], restDays: [0, 1], startWith: null };
    const draft = projectDraftRotation(state, program(state), resting, noon(MON));
    expect(kinds(draft)[0]).toBe('09:rest');
    expect(kinds(draft)).toEqual(kinds(saved(resting)));
    // Starting with C instead, with nothing done yet.
    const fromC = { order: ['a', 'b', 'c'], restDays: [0], startWith: 'c' };
    expect(kinds(projectDraftRotation(state, program(state), fromC, noon(MON)))).toEqual(
      kinds(saved(fromC)),
    );
    expect(kinds(saved(fromC))[0]).toBe('09:c');
    // The preview saves nothing.
    expect(state.days[MON].blocks.some((b) => b.routineId === 'a')).toBe(true);
  });

  it('setting a rotation clears planned weekday occurrences from today on, never recorded or past ones', () => {
    let state = base();
    // A Wednesday, when A was due by weekday before the rotation existed.
    const past = shiftDate(MON, -5);
    state = withDay(state, {
      date: past,
      revisions: [],
      blocks: generateDay(past, state.settings, state.programs).blocks,
    });
    state = ensureDay(state, MON, noon(MON));
    state = complete(state, MON, 'a');
    const wed = shiftDate(MON, 2);
    state = ensureDay(state, wed, noon(MON));
    expect(titles(state, wed)).toContain('Workout A:planned');
    state = setRotation(
      state,
      'gym-rotation',
      { order: ['a', 'b', 'c'], restDays: [0], startWith: null },
      noon(MON),
    );
    expect(titles(state, MON)).toContain('Workout A:done');
    expect(titles(state, wed)).not.toContain('Workout A:planned');
    expect(state.days[past].blocks.some((b) => b.routineId === 'a')).toBe(true);
    expect(
      program(state)
        .routines.filter((r) => r.id !== 'home')
        .every((r) => r.weekdays?.length === 0),
    ).toBe(true);
    // Monday's A is done, so the next training day takes B.
    expect(nextWorkout(state, program(state), shiftDate(MON, 1))).toBe('b');
  });

  it('round-trips through a backup and refuses an invalid rotation', () => {
    let state = open(rotating(), MON);
    state = restDay(state, 'gym-rotation', shiftDate(MON, 1), noon(MON));
    const restored = parseBackup(encodeBackup(state, noon(MON))).state;
    expect(restored.programs).toEqual(state.programs);
    expect(restored.days).toEqual(state.days);
    const bad = (rotation: unknown) => () =>
      decodeState({
        ...state,
        programs: [{ ...program(state), rotation }],
      });
    expect(bad({ order: ['missing'], restDays: [0], startWith: null })).toThrow();
    expect(bad({ order: ['a', 'a'], restDays: [0], startWith: null })).toThrow();
    expect(bad({ order: ['a'], restDays: [0, 1, 2, 3, 4, 5, 6], startWith: null })).toThrow();
    expect(bad({ order: ['a'], restDays: [0], startWith: 'b' })).toThrow();
    expect(() =>
      setRotation(state, 'gym-rotation', { order: [], restDays: [], startWith: null }, noon(MON)),
    ).toThrow();
  });

  it('a companion follows its parent on any day and is never completed by it', () => {
    let state = open(rotating(), MON);
    expect(extraDue(state, MON, MON).has('home')).toBe(true);
    state = complete(state, MON, 'a');
    expect(state.days[MON].blocks.find((b) => b.routineId === 'home')!.status).toBe('planned');
    // B days have no companion.
    const tue = shiftDate(MON, 1);
    expect(titles(open(state, tue), tue)).toEqual(['Workout B:planned']);
  });
});

describe('rest days, companions and bundled steps', () => {
  it('Rest today keeps a companion that has logged sets', () => {
    let state = rotating();
    // The companion is a workout of its own here, with a plan.
    state = { ...state, workoutTemplates: [...state.workoutTemplates, template('home')] };
    state = open(state, MON);
    const companion = state.days[MON].blocks.find((b) => b.routineId === 'home')!;
    state = startSession(state, MON, companion, noon(MON));
    const session = state.workoutSessions.find((x) => x.occurrenceId === companion.id)!;
    state = saveSession(state, {
      ...session,
      exercises: [{ ...session.exercises[0], sets: [{ reps: 5, load: 50, done: true }] }],
    });
    state = restDay(state, 'gym-rotation', MON, noon(MON));
    expect(titles(state, MON)).toEqual(['Home routine:planned']);
  });

  it('refuses a rotation workout that is also a companion', () => {
    const state = base();
    const gym = program(state);
    const companionA = {
      ...state,
      programs: [
        {
          ...gym,
          routines: gym.routines.map((r) => (r.id === 'a' ? { ...r, follows: ['home'] } : r)),
        },
      ],
    };
    expect(() =>
      setRotation(
        companionA,
        'gym-rotation',
        { order: ['a', 'b'], restDays: [0], startWith: null },
        noon(MON),
      ),
    ).toThrow(/cannot also be in the rotation/);
  });

  it('a bundled routine attaches to the rotation workout, and a recorded step blocks Rest today', () => {
    let state = rotating();
    const stretches: Program = {
      id: 'stretch',
      title: 'Stretching',
      group: 'Training',
      goalIds: [],
      routines: [
        routine('stretch-1', {
          title: 'Stretches',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          bundledInto: 'gym-rotation',
        }),
      ],
    };
    state = { ...state, programs: [...state.programs, stretches] };
    state = open(state, MON);
    const a = state.days[MON].blocks.find((b) => b.routineId === 'a')!;
    expect(a.bundledSteps?.map((x) => x.title)).toEqual(['Stretches']);
    state = withDay(state, {
      ...state.days[MON],
      blocks: state.days[MON].blocks.map((b) =>
        b.id === a.id
          ? {
              ...b,
              bundledSteps: b.bundledSteps!.map((x) => ({
                ...x,
                status: 'done' as const,
                actualAt: noon(MON),
              })),
            }
          : b,
      ),
    });
    expect(() => restDay(state, 'gym-rotation', MON, noon(MON))).toThrow(/already recorded/);
  });
});

const TUE = shiftDate(MON, 1);
const WED = shiftDate(MON, 2);
const ids = (state: State, date: string) =>
  (state.days[date]?.blocks ?? []).map((b) => b.routineId).sort();
const move = (state: State, from: string, to: string, now = noon(from)) => {
  const plan = planCompanionMove(state, from, 'home', to, from);
  return applyCompanionMove(state, plan, now, from);
};

describe('independent companion move', () => {
  it('moves the companion alone and leaves the parent workout', () => {
    let state = open(rotating(), MON);
    const home = state.days[MON].blocks.find((b) => b.routineId === 'home')!;
    state = move(state, MON, TUE);
    expect(ids(state, MON)).toEqual(['a']);
    expect(ids(state, TUE)).toEqual(['home']);
    expect(state.days[TUE].blocks.find((b) => b.routineId === 'home')!.id).toBe(home.id);
    expect(state.days[TUE].blocks.find((b) => b.routineId === 'home')!.movedFrom).toBe(MON);
    expect(state.days[MON].moved).toEqual([
      expect.objectContaining({ routineId: 'home', to: TUE }),
    ]);
    expect(state.days[MON].blocks.find((b) => b.routineId === 'a')!.status).toBe('planned');
  });

  it('does not recreate the companion on the original day after repeated generation', () => {
    let state = move(open(rotating(), MON), MON, TUE);
    state = open(state, MON);
    state = open(state, TUE);
    state = open(state, MON);
    expect(ids(state, MON)).toEqual(['a']);
    // Tuesday as today still gets the pending workout; the companion is not duplicated.
    expect(ids(state, TUE).sort()).toEqual(['a', 'home']);
    expect(state.days[TUE].blocks.filter((b) => b.routineId === 'home')).toHaveLength(1);
    expect(state.days[MON].blocks.filter((b) => b.routineId === 'home')).toHaveLength(0);
  });

  it('moving the parent before an override still takes the companion', () => {
    let state = open(rotating(), MON);
    state = restDay(state, 'gym-rotation', MON, noon(MON));
    expect(ids(state, MON)).toEqual([]);
    state = trainDay(state, 'gym-rotation', TUE, noon(MON));
    state = open(state, TUE);
    expect(ids(state, TUE).sort()).toEqual(['a', 'home']);
  });

  it('moving the parent after an override leaves the companion where it was', () => {
    let state = move(open(rotating(), MON), MON, TUE);
    state = restDay(state, 'gym-rotation', MON, noon(MON));
    expect(ids(state, MON)).toEqual([]);
    expect(ids(state, TUE)).toEqual(['home']);
    state = trainDay(state, 'gym-rotation', WED, noon(MON));
    state = open(state, WED);
    expect(ids(state, WED)).toEqual(['a']);
    expect(ids(state, TUE)).toEqual(['home']);
    expect(state.days[WED].blocks.filter((b) => b.routineId === 'home')).toHaveLength(0);
  });

  it('undo returns the companion to its original day', () => {
    let state = move(open(rotating(), MON), MON, TUE);
    const plan = planCompanionMove(state, TUE, 'home', MON, MON);
    state = applyCompanionMove(state, plan, noon(MON), MON);
    expect(ids(state, MON).sort()).toEqual(['a', 'home']);
    expect(state.days[MON].blocks.find((b) => b.routineId === 'home')!.movedFrom).toBeUndefined();
    expect(state.days[MON].moved ?? []).toEqual([]);
    state = complete(state, MON, 'a');
    state = open(state, TUE);
    expect(ids(state, TUE)).toEqual(['b']);
  });

  it('refuses a completed companion and a partially recorded circuit', () => {
    const done = complete(open(rotating(), MON), MON, 'home');
    expect(planCompanionMove(done, MON, 'home', TUE, MON).conflict).toMatch(/already done/);
    let circuit = saveCircuit(
      rotating(),
      newCircuit('home', 'Home routine', CORE_CIRCUIT, 'circuit-home', noon(MON)),
    );
    circuit = open(circuit, MON);
    const home = circuit.days[MON].blocks.find((b) => b.routineId === 'home')!;
    circuit = {
      ...circuit,
      intervalSessions: [
        {
          id: `interval:${home.id}`,
          intervalId: 'circuit-home',
          routineId: 'home',
          occurrenceId: home.id,
          date: MON,
          startedAt: noon(MON),
          finishedAt: noon(MON),
          plannedSeconds: 840,
          skipped: ['Crunches'],
        },
      ],
    };
    expect(planCompanionMove(circuit, MON, 'home', TUE, MON).conflict).toMatch(/recorded session/);
  });

  it('Rest today and Train today still work around an independent move', () => {
    let state = move(open(rotating(), MON), MON, TUE);
    state = restDay(state, 'gym-rotation', MON, noon(MON));
    const sun = '2026-11-15';
    state = trainDay(state, 'gym-rotation', sun, noon(sun));
    state = open(state, sun);
    expect(ids(state, sun)).toEqual(['a']);
    expect(ids(state, TUE)).toEqual(['home']);
  });

  it('keeps identity across a week boundary and a daylight-saving change', () => {
    const fri = '2026-03-06';
    let state = open(rotating(), fri);
    const home = state.days[fri].blocks.find((b) => b.routineId === 'home')!;
    const dst = '2026-03-09';
    state = move(state, fri, dst, noon(fri));
    expect(state.days[dst].blocks.find((b) => b.routineId === 'home')!.id).toBe(home.id);
    state = open(state, fri);
    state = open(state, dst);
    expect(ids(state, fri)).toEqual(['a']);
    expect(state.days[dst].blocks.filter((b) => b.routineId === 'home')).toHaveLength(1);
    expect(state.days[dst].blocks.find((b) => b.routineId === 'home')!.id).toBe(home.id);
  });

  it('does not duplicate Day Cleared objectives after a move', () => {
    let state = move(open(rotating(), MON), MON, TUE);
    expect(dayOutcome(state, MON)).not.toBe('cleared');
    state = complete(state, MON, 'a');
    // The companion is no longer due Monday, so finishing the workout can clear the day.
    expect(dayOutcome(state, MON)).toBe('cleared');
    state = open(state, TUE);
    const home = state.days[TUE].blocks.find((b) => b.routineId === 'home')!;
    state = withDay(state, setStatus(state.days[TUE], home.id, 'done', noon(TUE)));
    expect(state.days[MON].blocks.filter((b) => b.routineId === 'home')).toHaveLength(0);
    expect(state.days[TUE].blocks.filter((b) => b.routineId === 'home')).toHaveLength(1);
  });

  it('round-trips a moved companion through backup and restore', () => {
    const state = move(open(rotating(), MON), MON, TUE);
    const restored = parseBackup(encodeBackup(state, noon(MON))).state;
    expect(restored.days[MON].moved).toEqual(state.days[MON].moved);
    expect(restored.days[TUE].blocks.find((b) => b.routineId === 'home')).toEqual(
      state.days[TUE].blocks.find((b) => b.routineId === 'home'),
    );
    expect(ids(open(restored, MON), MON)).toEqual(['a']);
    expect(open(restored, TUE).days[TUE].blocks.filter((b) => b.routineId === 'home')).toHaveLength(
      1,
    );
  });

  it('refuses a collision and an invalid destination', () => {
    let state = open(rotating(), MON);
    const home: Routine = {
      ...state.programs[0].routines.find((r) => r.id === 'home')!,
      weekdays: [2],
    };
    state = upsertRoutine(state, state.programs[0], home, noon(MON));
    state = open(state, TUE);
    expect(ids(state, TUE)).toContain('home');
    expect(planCompanionMove(open(rotating(), MON), MON, 'home', TUE, MON).conflict).toBeNull();
    const clash = open(state, MON);
    expect(planCompanionMove(clash, MON, 'home', TUE, MON).conflict).toMatch(/already on/);
    expect(planCompanionMove(open(rotating(), MON), MON, 'home', MON, MON).conflict).toMatch(
      /different day/,
    );
  });
});

describe('Skip on a rotation workout', () => {
  // The rotation above plus one plain daily habit, so the day has something left to clear.
  const withHabit = (): State => {
    const state = rotating();
    const habits: Program = {
      id: 'habits',
      title: 'Habits',
      group: 'Daily',
      goalIds: [],
      routines: [
        routine('walk', { title: 'Walk', duration: null, weekdays: [0, 1, 2, 3, 4, 5, 6] }),
      ],
    };
    return { ...state, programs: [...state.programs, habits] };
  };
  const skip = (state: State, date: string, routineId: string, now = noon(date)) =>
    skipObjective(state, date, `${date}:routine:${routineId}`, now);

  it('rests the program today: the workout and its companion leave, and the workout stays next', () => {
    let state = open(withHabit(), MON);
    expect(titles(state, MON)).toEqual([
      'Home routine:planned',
      'Walk:planned',
      'Workout A:planned',
    ]);
    state = skip(state, MON, 'a');
    // Out of the day's obligations, not marked skipped; opening Today again does not bring it back.
    expect(titles(state, MON)).toEqual(['Walk:planned']);
    expect(state.days[MON].rotation).toEqual([
      { programId: 'gym-rotation', mode: 'rest', at: noon(MON) },
    ]);
    expect(needsEnsure(state, MON, MON)).toBe(false);
    expect(titles(open(state, MON), MON)).toEqual(['Walk:planned']);
    expect(restedByChoice(state, MON).map((p) => p.id)).toEqual(['gym-rotation']);
    // The day can still be cleared: the rest done clears it.
    expect(dayProgress(state.days[MON], state.programs, MON)).toMatchObject({
      total: 1,
      skipped: 0,
    });
    state = complete(state, MON, 'walk');
    expect(dayOutcome(state, MON)).toBe('cleared');
    // The next training day gets the same workout, with its companion.
    expect(nextWorkout(state, program(state), TUE)).toBe('a');
    expect(titles(open(state, TUE), TUE)).toEqual([
      'Home routine:planned',
      'Walk:planned',
      'Workout A:planned',
    ]);
  });

  it('Undo trains today again and restores the workout and its companion', () => {
    let state = skip(open(withHabit(), MON), MON, 'a');
    state = trainDay(state, 'gym-rotation', MON, noon(MON));
    expect(state.days[MON].rotation).toBeUndefined();
    expect(restedByChoice(state, MON)).toEqual([]);
    expect(needsEnsure(state, MON, MON)).toBe(true);
    state = open(state, MON);
    expect(titles(state, MON)).toEqual([
      'Home routine:planned',
      'Walk:planned',
      'Workout A:planned',
    ]);
    expect(dayOutcome(complete(state, MON, 'walk'), MON)).toBe('open');
  });

  it('never removes a companion that is done or already recorded', () => {
    const done = skip(complete(open(withHabit(), MON), MON, 'home'), MON, 'a');
    expect(titles(done, MON)).toEqual(['Home routine:done', 'Walk:planned']);
    let circuit = saveCircuit(
      withHabit(),
      newCircuit('home', 'Home routine', CORE_CIRCUIT, 'circuit-home', noon(MON)),
    );
    circuit = open(circuit, MON);
    const home = circuit.days[MON].blocks.find((b) => b.routineId === 'home')!;
    circuit = {
      ...circuit,
      intervalSessions: [
        {
          id: `interval:${home.id}`,
          intervalId: 'circuit-home',
          routineId: 'home',
          occurrenceId: home.id,
          date: MON,
          startedAt: noon(MON),
          finishedAt: noon(MON),
          plannedSeconds: 840,
          skipped: ['Crunches'],
        },
      ],
    };
    expect(titles(skip(circuit, MON, 'a'), MON)).toEqual(['Home routine:planned', 'Walk:planned']);
  });

  it('keeps the Rest today refusals: logged sets', () => {
    let state = open(withHabit(), MON);
    const block = state.days[MON].blocks.find((b) => b.routineId === 'a')!;
    state = startSession(state, MON, block, noon(MON));
    const session = state.workoutSessions[0];
    state = saveSession(state, {
      ...session,
      exercises: [{ ...session.exercises[0], sets: [{ reps: 8, load: 100, done: true }] }],
    });
    expect(() => skip(state, MON, 'a')).toThrow(/logged sets/);
  });

  it('on a past day, a workout is marked skipped as recorded, and it stays next', () => {
    let state = open(withHabit(), MON);
    // Viewed on Tuesday, Monday is the past: nothing there is rested or removed.
    state = skip(state, MON, 'a', noon(TUE));
    expect(titles(state, MON)).toEqual([
      'Home routine:planned',
      'Walk:planned',
      'Workout A:skipped',
    ]);
    expect(state.days[MON].rotation).toBeUndefined();
    expect(nextWorkout(state, program(state), TUE)).toBe('a');
  });

  it('a plain objective is excused: marked skipped and out of the count', () => {
    let state = open(withHabit(), MON);
    state = skip(state, MON, 'walk');
    expect(titles(state, MON)).toEqual([
      'Home routine:planned',
      'Walk:skipped',
      'Workout A:planned',
    ]);
    expect(dayProgress(state.days[MON], state.programs, MON)).toMatchObject({
      total: 2,
      skipped: 1,
    });
    state = complete(complete(state, MON, 'a'), MON, 'home');
    expect(dayOutcome(state, MON)).toBe('cleared');
  });

  it('on a day trained by choice instead of a default rest day, Skip returns it to rest', () => {
    const sun = '2026-11-15';
    let state = open(trainDay(withHabit(), 'gym-rotation', sun, noon(sun)), sun);
    expect(titles(state, sun)).toEqual([
      'Home routine:planned',
      'Walk:planned',
      'Workout A:planned',
    ]);
    state = skip(state, sun, 'a');
    expect(titles(state, sun)).toEqual(['Walk:planned']);
    expect(state.days[sun].rotation).toBeUndefined();
    // A default rest day is not a choice: Today shows it as a rest day, not a moved workout.
    expect(restedByChoice(state, sun)).toEqual([]);
  });
});

describe('a rotation without workout plans', () => {
  // The same three workouts as plain checklist objectives: no exercises, no workout plan. A plain
  // stretch and a weigh-in sit in the same program, on Saturdays.
  function plain(): State {
    const state = base();
    return {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: [
          ...p.routines,
          routine('stretch', { title: 'Stretch', weekdays: [6] }),
          routine('weigh', { title: 'Weigh-in', weekdays: [6], capture: 'weight' }),
        ],
      })),
      workoutTemplates: [],
    };
  }
  const ids = (routines: Routine[]) => routines.map((r) => r.id);
  const turnedOn = () =>
    setRotation(
      plain(),
      'gym-rotation',
      { order: ['a', 'b', 'c'], restDays: [0], startWith: null },
      noon(MON),
    );

  it('offers the editor only once there is a rotation, and lists the plain workouts', () => {
    expect(offersRotation(plain(), program(plain()))).toBe(false);
    const state = turnedOn();
    expect(offersRotation(state, program(state))).toBe(true);
    // Not the companion and not the weigh-in.
    expect(ids(rotationWorkouts(state, program(state)))).toEqual(['a', 'b', 'c', 'stretch']);
  });

  it('keeps the plan-based list for a program with workout plans', () => {
    const state = base();
    expect(offersRotation(state, program(state))).toBe(true);
    expect(ids(rotationWorkouts(state, program(state)))).toEqual(['a', 'b', 'c']);
    // A member without a plan (from a setup file) is still listed, so it can be removed and added.
    const mixed = setRotation(
      {
        ...state,
        programs: state.programs.map((p) => ({
          ...p,
          routines: [...p.routines, routine('stretch', { title: 'Stretch' })],
        })),
      },
      'gym-rotation',
      { order: ['a', 'stretch'], restDays: [0], startWith: null },
      noon(MON),
    );
    expect(ids(rotationWorkouts(mixed, program(mixed)))).toEqual(['a', 'b', 'c', 'stretch']);
  });

  it('turns on, places, advances and rests the same way as with plans', () => {
    let state = turnedOn();
    const gym = program(state);
    expect(gym.routines.filter((r) => gym.rotation!.order.includes(r.id))).toEqual(
      ['a', 'b', 'c'].map((id) => expect.objectContaining({ id, checklist: true, weekdays: [] })),
    );
    expect(gym.rotation!.previous).toEqual(
      ['a', 'b', 'c'].map((routineId) => ({ routineId, weekdays: [1, 3, 5], checklist: true })),
    );
    state = open(state, MON);
    expect(titles(state, MON)).toEqual(['Home routine:planned', 'Workout A:planned']);
    // A plain tick completes the workout, and the day clears with its companion.
    state = complete(complete(state, MON, 'a'), MON, 'home');
    expect(dayOutcome(state, MON)).toBe('cleared');
    const tue = shiftDate(MON, 1);
    state = open(state, tue);
    expect(titles(state, tue)).toEqual(['Workout B:planned']);
    // Skip rests the program today: B leaves the day and stays next.
    state = skipObjective(state, tue, `${tue}:routine:b`, noon(tue));
    expect(titles(state, tue)).toEqual([]);
    expect(restedByChoice(state, tue).map((p) => p.id)).toEqual(['gym-rotation']);
    expect(nextWorkout(state, program(state), shiftDate(tue, 1))).toBe('b');
  });
});
