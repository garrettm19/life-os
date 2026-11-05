import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { withDay } from '../data';
import { dayProgress } from '../objectives';
import { ensureChecklistDay } from '../planner';
import { applyShift, planShift } from '../sequence';
import { State, WorkoutSession } from '../model';
import {
  doneSets,
  finishSession,
  previousPerformance,
  saveSession,
  saveTemplate,
  sessionFor,
  setsText,
  startSession,
  undoWorkout,
} from '../workouts';
import { AT, trainingState } from '../../test-support/fixtures';

const MON = '2026-11-09';
const FRI = '2026-11-13';
const later = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();

function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], AT),
  );
}
const upperOn = (state: State, date: string) =>
  state.days[date].blocks.find((b) => b.routineId === 'upper')!;

/** Logs every planned set of the first exercise with the given reps at 135 lb. */
function logFirst(session: WorkoutSession, reps: number[]): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((e, i) =>
      i === 0 ? { ...e, sets: reps.map((r) => ({ reps: r, load: 135, done: true })) } : e,
    ),
  };
}

function performed(state: State, date: string, reps: number[], start: number): State {
  let s = open(state, date);
  const block = upperOn(s, date);
  s = startSession(s, date, block, later(start));
  const session = logFirst(sessionFor(s, block.id)!, reps);
  s = saveSession(s, session);
  return finishSession(s, date, block.id, session, later(start + 60));
}

describe('workout sessions', () => {
  it('starts from the plan, saves partial progress and resumes it', () => {
    let state = open(trainingState(), MON);
    const block = upperOn(state, MON);
    state = startSession(state, MON, block, AT);
    const session = sessionFor(state, block.id)!;
    expect(session.exercises.map((e) => [e.name, e.sets.length])).toEqual([
      ['Bench press', 3],
      ['Lat pulldown', 3],
    ]);
    const partial = {
      ...session,
      exercises: session.exercises.map((e, i) =>
        i === 0 ? { ...e, sets: [{ reps: 8, load: 135, done: true }, ...e.sets.slice(1)] } : e,
      ),
    };
    state = saveSession(state, partial);
    // Reopening resumes the same session instead of starting a second one.
    expect(startSession(state, MON, block, later(30))).toBe(state);
    expect(doneSets(sessionFor(state, block.id)!)).toBe(1);
    // Partial progress is not a completed workout.
    expect(upperOn(state, MON).status).toBe('planned');
    expect(sessionFor(state, block.id)!.status).toBe('active');
  });

  it('Finish Workout completes the session and the objective in one change', () => {
    const state = performed(trainingState(), MON, [8, 8, 7], 0);
    const block = upperOn(state, MON);
    const session = sessionFor(state, block.id)!;
    expect(session.status).toBe('completed');
    expect(block.status).toBe('done');
    expect(block.actualAt).toBe(session.finishedAt);
    expect(dayProgress(state.days[MON], state.programs, MON).done).toBe(1);
  });

  it('refuses to finish with nothing logged, and a refused finish changes nothing', () => {
    let state = open(trainingState(), MON);
    const block = upperOn(state, MON);
    state = startSession(state, MON, block, AT);
    const snapshot = JSON.stringify(state);
    expect(() => finishSession(state, MON, block.id, sessionFor(state, block.id)!, AT)).toThrow(
      /at least one set/,
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('shows the previous performance of the same exercise', () => {
    let state = performed(trainingState(), MON, [8, 8, 7], 0);
    state = open(state, FRI);
    const friday = upperOn(state, FRI);
    state = startSession(state, FRI, friday, later(4 * 24 * 60));
    const current = sessionFor(state, friday.id)!;
    const previous = previousPerformance(state, current.exercises[0], current)!;
    expect(previous.date).toBe(MON);
    expect(setsText(previous.sets, previous.unit)).toBe('135 lb × 8, 8, 7');
    // The next session improves; progress is plain evidence, not a score.
    const improved = logFirst(current, [8, 8, 8]);
    state = finishSession(
      saveSession(state, improved),
      FRI,
      friday.id,
      improved,
      later(4 * 24 * 60 + 60),
    );
    expect(setsText(sessionFor(state, friday.id)!.exercises[0].sets, 'lb')).toBe(
      '135 lb × 8, 8, 8',
    );
  });

  it('editing the plan never rewrites a recorded session', () => {
    const state = performed(trainingState(), MON, [8, 8, 7], 0);
    const recorded = sessionFor(state, upperOn(state, MON).id)!;
    const template = state.workoutTemplates[0];
    const edited = saveTemplate(state, {
      ...template,
      exercises: [{ ...template.exercises[0], name: 'Incline press', sets: 5 }],
      updatedAt: later(10),
    });
    expect(sessionFor(edited, recorded.occurrenceId)).toEqual(recorded);
  });

  it('Undo reopens the session with its sets, so finishing again is still one completion', () => {
    const done = performed(trainingState(), MON, [8, 8, 7], 0);
    const block = upperOn(done, MON);
    const undone = undoWorkout(done, MON, block.id);
    expect(upperOn(undone, MON).status).toBe('planned');
    const reopened = sessionFor(undone, block.id)!;
    expect(reopened).toMatchObject({ status: 'active', finishedAt: null });
    expect(doneSets(reopened)).toBe(3);
    const again = finishSession(undone, MON, block.id, reopened, later(90));
    expect(again.workoutSessions).toHaveLength(1);
    expect(upperOn(again, MON).status).toBe('done');
  });

  it('a finished session can only change through Undo', () => {
    const done = performed(trainingState(), MON, [8, 8, 7], 0);
    const session = sessionFor(done, upperOn(done, MON).id)!;
    expect(() => saveSession(done, { ...session, status: 'active', finishedAt: null })).toThrow(
      /already finished/,
    );
  });

  it('keeps its identity when its workout is moved, and records both dates', () => {
    let state = open(trainingState(), MON);
    const block = upperOn(state, MON);
    state = startSession(state, MON, block, AT);
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    state = applyShift(state, plan, false, AT, MON);
    const tuesday = '2026-11-10';
    const moved = state.days[tuesday].blocks.find((b) => b.routineId === 'upper')!;
    expect(moved.id).toBe(block.id);
    const session = logFirst(sessionFor(state, block.id)!, [8, 8, 8]);
    state = finishSession(saveSession(state, session), tuesday, moved.id, session, later(24 * 60));
    expect(sessionFor(state, block.id)).toMatchObject({
      scheduledDate: MON,
      date: tuesday,
      status: 'completed',
    });
    expect(parseBackup(encodeBackup(state, AT)).state).toEqual(state);
  });
});

describe('previous performance identity', () => {
  it('never compares a same-named exercise logged in another unit', () => {
    let state = performed(trainingState(), MON, [8, 8, 7], 0);
    state = open(state, FRI);
    const friday = upperOn(state, FRI);
    state = startSession(state, FRI, friday, later(4 * 24 * 60));
    const current = sessionFor(state, friday.id)!;
    const renamed = { ...current.exercises[0], exerciseId: 'other-plan-bench' };
    expect(previousPerformance(state, renamed, current)).not.toBeNull();
    expect(previousPerformance(state, { ...renamed, unit: 'kg' }, current)).toBeNull();
  });
});
