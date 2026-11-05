import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { basicState } from '../../test-support/basic-state';
import { Program, Routine, State, WorkoutTemplate, shiftDate } from '../model';
import { setStatus } from '../planner';
import { ensureDay, leavingWorkouts, nextWorkout, restDay, setRotation } from '../rotation';
import { upsertRoutine } from '../routines';
import {
  finishSession,
  loggedBlockIds,
  previousPerformance,
  saveSession,
  sessionFor,
  startSession,
} from '../workouts';

// A synthetic six-workout rotation (W1 → W6) resting on Sundays, with a home routine after W1 and
// W4 and a second one after W2 and W5. Nothing here is a real training plan.
const IDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
const MON = '2026-11-09';
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function routine(id: string, extra: Partial<Routine> = {}): Routine {
  return {
    id,
    title: id.toUpperCase(),
    duration: 60,
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  };
}
const template = (routineId: string): WorkoutTemplate => ({
  id: `plan-${routineId}`,
  routineId,
  title: routineId.toUpperCase(),
  note: '',
  updatedAt: noon(MON),
  exercises: [
    {
      id: `press-${routineId}`,
      name: 'Press',
      sets: 2,
      repsMin: 8,
      repsMax: null,
      load: null,
      unit: 'lb',
      restSeconds: null,
      note: '',
    },
  ],
});

function base(): State {
  const state = basicState();
  state.source = 'personal';
  state.settings = { ...state.settings, workStart: null, workEnd: null, scrumStart: null };
  const gym: Program = {
    id: 'gym',
    title: 'Gym',
    group: 'Training',
    goalIds: [],
    routines: [
      ...IDS.map((id, i) => routine(id, { weekdays: [(i % 6) + 1] })),
      routine('home-a', { weekdays: [], follows: ['w1', 'w4'] }),
      routine('home-b', { weekdays: [], follows: ['w2', 'w5'] }),
    ],
  };
  return { ...state, programs: [gym], workoutTemplates: IDS.map(template) };
}
const rotating = (s = base()) =>
  setRotation(s, 'gym', { order: IDS, restDays: [0], startWith: null }, noon(MON));
const gym = (s: State) => s.programs.find((p) => p.id === 'gym')!;
const open = (s: State, date: string) => ensureDay(s, date, noon(date));
const workoutOn = (s: State, date: string) =>
  s.days[date]?.blocks.find((b) => IDS.includes(b.routineId ?? ''))?.routineId ?? null;
const done = (s: State, date: string, id: string) =>
  withDay(s, setStatus(s.days[date], `${date}:routine:${id}`, 'done', noon(date)));

/** Opens each day from `from` and completes whatever workout it shows. */
function walk(
  s: State,
  from: string,
  days: number,
  skip: (date: string) => 'skip' | 'miss' | null = () => null,
) {
  const seen: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDate(from, i);
    s = open(s, date);
    const id = workoutOn(s, date);
    if (!id) {
      seen.push('rest');
      continue;
    }
    const what = skip(date);
    seen.push(what ? `${id}(${what})` : id);
    if (what === 'skip')
      s = withDay(s, setStatus(s.days[date], `${date}:routine:${id}`, 'skipped', noon(date)));
    else if (!what) s = done(s, date, id);
  }
  return { s, seen: seen.join(' ') };
}

describe('six-workout rotation', () => {
  it('runs in order with one rest day, across weeks, a month end and both clock changes', () => {
    // 2026-10-22 to 2026-11-06: the EU (Oct 25) and US (Nov 1) clock changes and a month end.
    const { seen } = walk(rotating(), '2026-10-22', 16);
    expect(seen).toBe('w1 w2 w3 rest w4 w5 w6 w1 w2 w3 rest w4 w5 w6 w1 w2');
  });

  it('a missed day and an explicit skip both leave the same workout next', () => {
    const { seen } = walk(rotating(), MON, 4, (date) =>
      date === MON ? 'miss' : date === shiftDate(MON, 1) ? 'skip' : null,
    );
    expect(seen).toBe('w1(miss) w1(skip) w1 w2');
  });

  it('undoing the most recent completion puts it back as next', () => {
    let s = open(rotating(), MON);
    s = done(s, MON, 'w1');
    expect(nextWorkout(s, gym(s), shiftDate(MON, 1))).toBe('w2');
    s = withDay(s, setStatus(s.days[MON], `${MON}:routine:w1`, 'planned'));
    expect(nextWorkout(s, gym(s), shiftDate(MON, 1))).toBe('w1');
  });

  it('a partial workout keeps its sets, does not advance, and cannot be rested away', () => {
    let s = open(rotating(), MON);
    const block = s.days[MON].blocks.find((b) => b.routineId === 'w1')!;
    s = startSession(s, MON, block, noon(MON));
    const session = sessionFor(s, block.id)!;
    s = saveSession(s, {
      ...session,
      exercises: [
        {
          ...session.exercises[0],
          sets: [{ reps: 8, load: 95, done: true }, ...session.exercises[0].sets.slice(1)],
        },
      ],
    });
    expect(() => restDay(s, 'gym', MON, noon(MON))).toThrow(/logged sets/);
    const tue = shiftDate(MON, 1);
    s = open(s, tue);
    expect(workoutOn(s, tue)).toBe('w1');
    // Monday's sets are still there and still reachable.
    expect(loggedBlockIds(s).has(block.id)).toBe(true);
    expect(s.days[MON].blocks.some((b) => b.id === block.id)).toBe(true);
  });

  it('companions appear only on the days of the workouts they follow', () => {
    const { s } = walk(rotating(), MON, 6);
    const homes = (date: string) =>
      s.days[date].blocks.filter((b) => b.routineId?.startsWith('home')).map((b) => b.routineId);
    expect([0, 1, 2, 3, 4, 5].map((i) => homes(shiftDate(MON, i)).join(','))).toEqual([
      'home-a',
      'home-b',
      '',
      'home-a',
      'home-b',
      '',
    ]);
  });

  it('turning the rotation off gives every workout its earlier days back; on again works too', () => {
    const before = base();
    let s = rotating(before);
    expect(
      gym(s)
        .routines.slice(0, 6)
        .every((r) => r.weekdays?.length === 0),
    ).toBe(true);
    expect(leavingWorkouts(s, 'gym', null).map((w) => w.suggested)).toEqual(
      IDS.map((_, i) => [(i % 6) + 1]),
    );
    s = setRotation(s, 'gym', null, noon(MON));
    expect(gym(s).rotation).toBeUndefined();
    expect(
      gym(s)
        .routines.slice(0, 6)
        .map((r) => r.weekdays),
    ).toEqual(
      gym(before)
        .routines.slice(0, 6)
        .map((r) => r.weekdays),
    );
    // Back on: the same derived sequence, and it remembers the days again.
    s = rotating(s);
    expect(nextWorkout(s, gym(s), MON)).toBe('w1');
    expect(gym(s).rotation!.previous).toHaveLength(6);
  });

  it('a workout leaving with no remembered days must be given days; it never goes dayless', () => {
    let s = rotating();
    // A rotation that arrived without remembered days (for example from a setup file).
    s = {
      ...s,
      programs: s.programs.map((p) =>
        p.id === 'gym' ? { ...p, rotation: { ...p.rotation!, previous: undefined } } : p,
      ),
    };
    const fewer = { order: IDS.slice(0, 5), restDays: [0], startWith: null };
    expect(() => setRotation(s, 'gym', fewer, noon(MON))).toThrow(/Choose days for W6/);
    s = setRotation(s, 'gym', fewer, noon(MON), { w6: [6] });
    expect(gym(s).routines.find((r) => r.id === 'w6')!.weekdays).toEqual([6]);
  });

  it('a paused workout is passed over, and resuming it puts it back in turn', () => {
    let s = rotating();
    const w2 = gym(s).routines.find((r) => r.id === 'w2')!;
    s = upsertRoutine(s, gym(s), { ...w2, enabled: false }, noon(MON));
    s = done(open(s, MON), MON, 'w1');
    expect(nextWorkout(s, gym(s), shiftDate(MON, 1))).toBe('w3');
    s = upsertRoutine(s, gym(s), { ...w2, enabled: true }, noon(MON));
    expect(nextWorkout(s, gym(s), shiftDate(MON, 1))).toBe('w2');
  });

  it('one-tap logging still suggests the last performance after the rotation is turned on', () => {
    let s = base();
    // W1 done by weekday before the rotation existed.
    const lastMon = shiftDate(MON, -7);
    s = withDay(s, { date: lastMon, revisions: [], blocks: [] });
    s = ensureDay(s, lastMon, noon(lastMon));
    const earlier = s.days[lastMon].blocks.find((b) => b.routineId === 'w1')!;
    s = startSession(s, lastMon, earlier, noon(lastMon));
    const first = sessionFor(s, earlier.id)!;
    const logged = {
      ...first,
      exercises: [
        {
          ...first.exercises[0],
          sets: [
            { reps: 8, load: 100, done: true },
            { reps: 7, load: 100, done: true },
          ],
        },
      ],
    };
    s = finishSession(saveSession(s, logged), lastMon, earlier.id, logged, noon(lastMon));
    s = open(rotating(s), MON);
    const today = s.days[MON].blocks.find((b) => b.routineId === 'w2')!;
    expect(today).toBeDefined();
    // W1 was done last week, so the rotation continues with W2; W1's history is intact.
    s = startSession(s, MON, { ...today, routineId: 'w1', id: `${MON}:routine:w1` }, noon(MON));
    const prev = previousPerformance(
      s,
      sessionFor(s, `${MON}:routine:w1`)!.exercises[0],
      sessionFor(s, `${MON}:routine:w1`)!,
    );
    expect(prev?.sets.map((x) => x.load)).toEqual([100, 100]);
  });
});
