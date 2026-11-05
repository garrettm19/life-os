import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, withDay } from '../data';
import { dayClearStreak } from '../objectives';
import { checklistNeedsEnsure, ensureChecklistDay, generateDay, setStatus } from '../planner';
import { applyShift, planShift } from '../sequence';
import { deleteMeasurement, recordWeight, weightHistory } from '../measurements';
import { evidenceNote, linkedRecord } from '../linked';
import { restorePreview } from '../restore-preview';
import { upsertRoutine } from '../routines';
import { State, WorkoutSession } from '../model';
import {
  doneSets,
  finishSession,
  loggedBlockIds,
  previousPerformance,
  markDoneWithoutLog,
  saveSession,
  sessionFor,
  startSession,
  undoWorkout,
  unfinishedSessions,
} from '../workouts';
import { AT, trainingState } from '../../test-support/fixtures';

const MON = '2026-11-09';
const SUN = '2026-11-15';
const LATER = new Date(2026, 10, 30, 12).toISOString();

function open(state: State, date: string, at = AT): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], at),
  );
}
const upper = (s: State) => s.days[MON].blocks.find((b) => b.routineId === 'upper')!;
const weighIn = (s: State) => s.days[SUN].blocks.find((b) => b.routineId === 'weigh-in')!;

function withSets(state: State, count: number): State {
  let s = startSession(state, MON, upper(state), AT);
  const session = sessionFor(s, upper(s).id)!;
  const logged: WorkoutSession = {
    ...session,
    exercises: session.exercises.map((e, i) =>
      i === 0
        ? {
            ...e,
            sets: e.sets.map((set, j) => (j < count ? { reps: 8, load: 135, done: true } : set)),
          }
        : e,
    ),
  };
  s = saveSession(s, logged);
  return s;
}

describe('workout objective versus workout session', () => {
  it('Done without a log is allowed while nothing is logged and creates no performance record', () => {
    const state = open(trainingState(), MON);
    const done = markDoneWithoutLog(state, MON, upper(state).id, AT);
    expect(upper(done).status).toBe('done');
    expect(done.workoutSessions).toEqual([]);
    expect(linkedRecord(done, upper(done))).toBe('missing');
  });

  it('Done without a log is refused once sets are logged, so they are never silently orphaned', () => {
    const state = withSets(open(trainingState(), MON), 2);
    const snapshot = JSON.stringify(state);
    expect(() => markDoneWithoutLog(state, MON, upper(state).id, AT)).toThrow(/2 sets/);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('an interrupted session stays unfinished, is reported as such, and resumes', () => {
    const state = withSets(open(trainingState(), MON), 1);
    expect(sessionFor(state, upper(state).id)!.status).toBe('active');
    expect(unfinishedSessions(state, '2026-11-10')).toHaveLength(1);
    // Reopening resumes the same session with its set.
    expect(startSession(state, MON, upper(state), LATER)).toBe(state);
    expect(doneSets(sessionFor(state, upper(state).id)!)).toBe(1);
    expect(linkedRecord(state, upper(state))).toBe('unfinished');
  });

  it('a session left open by an earlier Done can still be finished later without a second completion', () => {
    // A state from an earlier build: objective Done while the session with sets stayed active.
    let state = withSets(open(trainingState(), MON), 2);
    state = withDay(state, setStatus(state.days[MON], upper(state).id, 'done', AT));
    expect(linkedRecord(state, upper(state))).toBe('unfinished');
    const finished = finishSession(
      state,
      MON,
      upper(state).id,
      sessionFor(state, upper(state).id)!,
      LATER,
    );
    expect(sessionFor(finished, upper(finished).id)!.status).toBe('completed');
    expect(upper(finished).actualAt).toBe(AT);
    expect(linkedRecord(finished, upper(finished))).toBe('recorded');
  });

  it('skipping keeps the logged sets as an unfinished session; Undo then finishing completes it', () => {
    let state = withSets(open(trainingState(), MON), 3);
    state = withDay(state, setStatus(state.days[MON], upper(state).id, 'skipped', AT));
    expect(doneSets(sessionFor(state, upper(state).id)!)).toBe(3);
    state = undoWorkout(state, MON, upper(state).id);
    const done = finishSession(
      state,
      MON,
      upper(state).id,
      sessionFor(state, upper(state).id)!,
      LATER,
    );
    expect(upper(done).status).toBe('done');
    expect(done.workoutSessions).toHaveLength(1);
  });
});

describe('a weight linked to a completed objective', () => {
  function weighed(): State {
    const state = open(trainingState(), SUN);
    return recordWeight(
      state,
      {
        value: 180.4,
        unit: 'lb',
        date: SUN,
        fasted: true,
        note: '',
        occurrence: { date: SUN, blockId: weighIn(state).id },
      },
      'w1',
      LATER,
    );
  }

  it('deleting the weight keeps the weigh-in as done by default, shows the measurement is gone, and drops it from history', () => {
    const saved = weighed();
    const streak = dayClearStreak(saved, SUN, SUN);
    const deleted = deleteMeasurement(saved, 'w1');
    expect(weighIn(deleted).status).toBe('done');
    expect(linkedRecord(deleted, weighIn(deleted))).toBe('missing');
    expect(weightHistory(deleted, 'lb')).toEqual([]);
    expect(dayClearStreak(deleted, SUN, SUN)).toEqual(streak);
  });

  it('deleting can also undo the linked completion when the user chooses it', () => {
    const deleted = deleteMeasurement(weighed(), 'w1', { undoObjective: true });
    expect(weighIn(deleted).status).toBe('planned');
    expect(deleted.measurements).toEqual([]);
  });

  it('repeated corrections edit one record and never touch the objective', () => {
    let state = weighed();
    const block = weighIn(state);
    for (const value of [180.2, 179.8, 180])
      state = recordWeight(
        state,
        { id: 'w1', value, unit: 'lb', date: SUN, fasted: true, note: '' },
        'x',
        LATER,
      );
    expect(state.measurements).toHaveLength(1);
    expect(state.measurements[0].entered.value).toBe(180);
    expect(weighIn(state)).toEqual(block);
    expect(linkedRecord(state, weighIn(state))).toBe('recorded');
  });

  it('a backup round trip keeps the distinction between done and measured', () => {
    const deleted = deleteMeasurement(weighed(), 'w1');
    const restored = parseBackup(encodeBackup(deleted, LATER)).state;
    expect(linkedRecord(restored, weighIn(restored))).toBe('missing');
  });
});

describe('weight recurrence', () => {
  it('changing a weekly weigh-in to daily never adds occurrences to past days', () => {
    let state = open(open(trainingState(), MON), SUN);
    const pastBefore = JSON.stringify(state.days[MON]);
    const program = state.programs[1];
    const routine = { ...program.routines[0], weekdays: [0, 1, 2, 3, 4, 5, 6] };
    // Edited on Tuesday: Monday is history, Sunday is still ahead.
    state = upsertRoutine(state, program, routine, new Date(2026, 10, 10, 9).toISOString());
    expect(JSON.stringify(state.days[MON])).toBe(pastBefore);
    expect(state.days[SUN].blocks.filter((b) => b.routineId === 'weigh-in')).toHaveLength(1);
  });

  it('a measurement may exist on a date with no scheduled weigh-in', () => {
    const state = recordWeight(
      trainingState(),
      { value: 180, unit: 'lb', date: '2026-11-11', fasted: null, note: '' },
      'w',
      LATER,
    );
    expect(weightHistory(state, 'lb').map((p) => p.date)).toEqual(['2026-11-11']);
  });
});

describe('restore preview and backup formats', () => {
  it('lists the records a restore would remove, and only additions when it removes none', () => {
    const current = recordWeight(
      trainingState(),
      { value: 180, unit: 'lb', date: SUN, fasted: null, note: '' },
      'w',
      LATER,
    );
    const older = trainingState();
    expect(restorePreview(current, older).changes).toEqual([
      { label: 'weights', current: 1, added: 0, removed: 1, replaced: 0 },
    ]);
    expect(restorePreview(older, current).changes).toEqual([
      { label: 'weights', current: 0, added: 1, removed: 0, replaced: 0 },
    ]);
  });

  it('reports which format a backup was written in', () => {
    const raw = JSON.parse(encodeBackup(trainingState(), LATER));
    expect(parseBackup(JSON.stringify(raw)).sourceVersion).toBe(5);
    raw.version = 1;
    raw.state.version = 1;
    for (const key of [
      'measurements',
      'lifeLog',
      'workoutTemplates',
      'workoutSessions',
      'moneyReviews',
      'intervalRoutines',
      'intervalSessions',
      'activitySessions',
      'ruleBooks',
      'ruleReviews',
      'focuses',
      'weeklyReviews',
      'skillCheckpoints',
      'tradingSessions',
      'tradingSessionsImported',
    ])
      delete raw.state[key];
    for (const p of raw.state.programs) for (const r of p.routines) delete r.capture;
    expect(parseBackup(JSON.stringify(raw)).sourceVersion).toBe(1);
  });
});

describe('units, pauses, shifts and restored records', () => {
  it('never prefills or compares across units even for the same exercise ID', () => {
    let state = withSets(open(trainingState(), MON), 2);
    state = finishSession(state, MON, upper(state).id, sessionFor(state, upper(state).id)!, LATER);
    const fri = '2026-11-13';
    state = withDay(
      state,
      ensureChecklistDay(fri, state.settings, state.programs, state.days[fri], AT),
    );
    const block = state.days[fri].blocks.find((b) => b.routineId === 'upper')!;
    state = startSession(state, fri, block, LATER);
    const current = sessionFor(state, block.id)!;
    expect(previousPerformance(state, current.exercises[0], current)).not.toBeNull();
    expect(previousPerformance(state, { ...current.exercises[0], unit: 'kg' }, current)).toBeNull();
  });

  it('pausing a routine keeps a planned workout that has logged sets', () => {
    const state = withSets(open(trainingState(), MON), 1);
    const program = state.programs[0];
    const paused = { ...program.routines[0], enabled: false };
    const next = upsertRoutine(state, program, paused, AT);
    expect(next.days[MON].blocks.some((b) => b.id === upper(state).id)).toBe(true);
    // Opening the day again or generating it does not drop it either.
    const reopened = withDay(
      next,
      ensureChecklistDay(
        MON,
        next.settings,
        next.programs,
        next.days[MON],
        AT,
        loggedBlockIds(next),
      ),
    );
    expect(reopened.days[MON].blocks.some((b) => b.id === upper(state).id)).toBe(true);
    expect(
      checklistNeedsEnsure(MON, next.programs, reopened.days[MON], MON, loggedBlockIds(reopened)),
    ).toBe(false);
    const generated = withDay(
      next,
      generateDay(MON, next.settings, next.programs, next.days[MON], AT, loggedBlockIds(next)),
    );
    expect(generated.days[MON].blocks.some((b) => b.id === upper(state).id)).toBe(true);
  });

  it('a shifted workout in progress moves its session date and is not called unfinished', () => {
    const state = withSets(open(trainingState(), MON), 1);
    const moved = applyShift(
      state,
      planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON),
      false,
      AT,
      MON,
    );
    expect(sessionFor(moved, upper(state).id)!.date).toBe('2026-11-10');
    expect(unfinishedSessions(moved, MON)).toEqual([]);
  });

  it('the restore preview counts records that would disappear by ID, not just totals', () => {
    const a = recordWeight(
      trainingState(),
      { value: 180, unit: 'lb', date: SUN, fasted: null, note: '' },
      'mine',
      LATER,
    );
    const b = recordWeight(
      trainingState(),
      { value: 181, unit: 'lb', date: SUN, fasted: null, note: '' },
      'theirs',
      LATER,
    );
    expect(restorePreview(a, b).changes).toEqual([
      { label: 'weights', current: 1, added: 1, removed: 1, replaced: 0 },
    ]);
    expect(restorePreview(a, a).unchanged).toBe(true);
  });

  it('a weight recorded separately for the same date counts as the weigh-in measurement', () => {
    let state = open(trainingState(), SUN);
    state = withDay(state, setStatus(state.days[SUN], weighIn(state).id, 'done', AT));
    expect(linkedRecord(state, weighIn(state), SUN)).toBe('missing');
    state = recordWeight(
      state,
      { value: 180, unit: 'lb', date: SUN, fasted: true, note: '' },
      'w',
      LATER,
    );
    expect(linkedRecord(state, weighIn(state), SUN)).toBe('recorded');
  });

  it('a skipped workout says its logged sets were kept', () => {
    let state = withSets(open(trainingState(), MON), 2);
    state = withDay(state, setStatus(state.days[MON], upper(state).id, 'skipped', AT));
    expect(evidenceNote(state, upper(state), MON)).toBe('Skipped · 2 logged sets kept');
  });

  it('a restored file cannot hold two weights for one date or a finished workout with no set', () => {
    const state = recordWeight(
      trainingState(),
      { value: 180, unit: 'lb', date: SUN, fasted: null, note: '' },
      'w',
      LATER,
    );
    const twice = {
      ...state,
      measurements: [...state.measurements, { ...state.measurements[0], id: 'w2' }],
    };
    expect(() => decodeState(JSON.parse(JSON.stringify(twice)))).toThrow();
    const empty = startSession(
      open(trainingState(), MON),
      MON,
      upper(open(trainingState(), MON)),
      AT,
    );
    const finishedEmpty = {
      ...empty,
      workoutSessions: empty.workoutSessions.map((s) => ({
        ...s,
        status: 'completed' as const,
        finishedAt: LATER,
      })),
    };
    expect(() => decodeState(JSON.parse(JSON.stringify(finishedEmpty)))).toThrow();
  });

  it('each weight change says how many days it spans', () => {
    let state = recordWeight(
      trainingState(),
      { value: 180, unit: 'lb', date: '2026-11-01', fasted: null, note: '' },
      'a',
      LATER,
    );
    state = recordWeight(
      state,
      { value: 181, unit: 'lb', date: SUN, fasted: null, note: '' },
      'b',
      LATER,
    );
    expect(weightHistory(state, 'lb').map((p) => p.days)).toEqual([null, 14]);
  });
});
