import { describe, expect, it } from '@jest/globals';
import { weeklyMinutes } from '../activity';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, parseSetup, withDay } from '../data';
import { buildExport } from '../export';
import { evidenceNote, linkedRecord } from '../linked';
import { State } from '../model';
import { dayProgress } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import {
  DSA_STUDY,
  StudyRun,
  advanceStudy,
  backToLastStage,
  decodeStudyRun,
  discardStudySession,
  fullStudy,
  markStudyDone,
  minutesLine,
  pauseStudy,
  phaseAt,
  recordStudy,
  restoreStudyRun,
  resumeStudy,
  runTotals,
  saveStudyPlan,
  spentAt,
  stageEndsAt,
  startStudy,
  studyResources,
  studySessionFor,
  toRecord,
} from '../study';
import { studyState } from '../../test-support/fixtures';

// Clocks are built from local dates, so every time zone agrees on the day.
const MON = '2026-11-09';
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
};
const MIN = 60_000;
const T0 = at(MON, 19);
const blockId = `${MON}:routine:study`;
const target = { routineId: 'study', date: MON, blockId };

function opened(state: State = studyState(), date = MON): State {
  return withDay(
    state,
    ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      state.days[date],
      new Date(at(date, 8)).toISOString(),
    ),
  );
}
const statusOf = (state: State) => state.days[MON].blocks.find((b) => b.id === blockId)!.status;

/** Runs every stage to its planned end, confirming each one. */
function fullRun(): { run: StudyRun; end: number } {
  let run = startStudy(DSA_STUDY, target, T0);
  run = advanceStudy(run, T0 + 25 * MIN);
  run = advanceStudy(run, T0 + 55 * MIN);
  run = advanceStudy(run, T0 + 60 * MIN);
  return { run, end: T0 + 60 * MIN };
}

describe('the study stage clock', () => {
  it('runs on wall-clock time, also while the app is in the background', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    expect(phaseAt(run, T0)).toBe('running');
    expect(run.stages.map((s) => s.plannedSeconds)).toEqual([1500, 1800, 300]);
    // Twelve minutes later, with no tick in between, the stage shows twelve minutes.
    expect(spentAt(run, T0 + 12 * MIN)[0]).toBe(12 * MIN);
    expect(stageEndsAt(run, T0 + 12 * MIN)).toBe(T0 + 25 * MIN);
  });

  it('stops each stage at its plan and waits, so time away never grows a stage', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    // Away for three hours: the first stage reads 25 minutes, never more, and waits for the user.
    expect(spentAt(run, T0 + 180 * MIN)).toEqual([25 * MIN, 0, 0]);
    expect(phaseAt(run, T0 + 180 * MIN)).toBe('timeUp');
    expect(stageEndsAt(run, T0 + 180 * MIN)).toBeNull();
    expect(runTotals(run, T0 + 180 * MIN)).toEqual({ spent: 1500, planned: 3600 });
    // The next stage starts from the moment the user moves on, not from when the first one ended.
    const next = advanceStudy(run, T0 + 180 * MIN);
    expect(next.index).toBe(1);
    expect(spentAt(next, T0 + 185 * MIN)).toEqual([25 * MIN, 5 * MIN, 0]);
  });

  it('pauses and resumes without losing or inventing time', () => {
    let run = startStudy(DSA_STUDY, target, T0);
    run = pauseStudy(run, T0 + 10 * MIN);
    expect(phaseAt(run, T0 + 60 * MIN)).toBe('paused');
    // A pause of any length adds nothing.
    expect(spentAt(run, T0 + 600 * MIN)[0]).toBe(10 * MIN);
    run = resumeStudy(run, T0 + 600 * MIN);
    expect(spentAt(run, T0 + 605 * MIN)[0]).toBe(15 * MIN);
    // Pausing twice or resuming a running stage changes nothing.
    expect(resumeStudy(run, T0 + 606 * MIN)).toBe(run);
    const paused = pauseStudy(run, T0 + 606 * MIN);
    expect(pauseStudy(paused, T0 + 700 * MIN)).toBe(paused);
  });

  it('never counts a clock that moved backwards', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    expect(spentAt(run, T0 - 30 * MIN)[0]).toBe(0);
  });

  it('records a stage finished early as shorter than planned', () => {
    let run = startStudy(DSA_STUDY, target, T0);
    run = advanceStudy(run, T0 + 18 * MIN);
    run = advanceStudy(run, T0 + 48 * MIN);
    run = advanceStudy(run, T0 + 53 * MIN);
    expect(phaseAt(run, T0 + 53 * MIN)).toBe('review');
    const record = toRecord(run, T0 + 60 * MIN);
    expect(record.stages.map((s) => [s.seconds, s.done])).toEqual([
      [1080, true],
      [1800, true],
      [300, true],
    ]);
    expect(fullStudy(record)).toBe(false);
    expect(minutesLine(record)).toBe('53 of 60 min');
  });

  it('can reopen the last stage from review, keeping its time', () => {
    let run = startStudy(DSA_STUDY, target, T0);
    run = advanceStudy(run, T0 + 25 * MIN);
    run = advanceStudy(run, T0 + 55 * MIN);
    run = advanceStudy(run, T0 + 57 * MIN);
    run = backToLastStage(run, T0 + 70 * MIN);
    expect(phaseAt(run, T0 + 70 * MIN)).toBe('running');
    expect(spentAt(run, T0 + 73 * MIN)[2]).toBe(5 * MIN);
    expect(phaseAt(run, T0 + 73 * MIN)).toBe('timeUp');
  });

  it('keeps the plan it started with when the plan is edited later', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    const edited = saveStudyPlan(opened(), 'study', {
      ...DSA_STUDY,
      stages: DSA_STUDY.stages.map((s) => ({ ...s, minutes: 1 })),
    });
    expect(
      edited.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!.study!.stages[0]
        .minutes,
    ).toBe(1);
    expect(run.stages[0].plannedSeconds).toBe(1500);
  });
});

describe('recording a study session', () => {
  it('completes the objective only with a full, confirmed session', () => {
    const state = opened();
    const { run, end } = fullRun();
    const next = recordStudy(
      state,
      run,
      { countAsDone: false },
      'study-1',
      new Date(end).toISOString(),
    );
    const session = studySessionFor(next, blockId)!;
    expect(session.minutes).toBe(60);
    expect(fullStudy(session.study!)).toBe(true);
    expect(statusOf(next)).toBe('done');
    expect(
      linkedRecord(
        next,
        next.days[MON].blocks.find((b) => b.id === blockId)!,
      ),
    ).toBe('recorded');
    // Day Cleared reads the objective like any other.
    expect(dayProgress(next.days[MON], next.programs, MON).done).toBeGreaterThan(
      dayProgress(state.days[MON], state.programs, MON).done,
    );
  });

  it('keeps a shorter session as what was done and leaves the objective open', () => {
    const state = opened();
    let run = startStudy(DSA_STUDY, target, T0);
    run = advanceStudy(run, T0 + 25 * MIN);
    run = pauseStudy(run, T0 + 40 * MIN);
    const now = new Date(T0 + 90 * MIN).toISOString();
    const next = recordStudy(state, run, { countAsDone: false }, 'study-1', now);
    const session = studySessionFor(next, blockId)!;
    expect(session.minutes).toBe(40);
    expect(session.study!.stages.map((s) => s.done)).toEqual([true, false, false]);
    expect(fullStudy(session.study!)).toBe(false);
    expect(statusOf(next)).toBe('planned');
    // Counting it as done is a separate, explicit choice, and Today says what really happened.
    const counted = markStudyDone(next, MON, blockId, now);
    expect(statusOf(counted)).toBe('done');
    const block = counted.days[MON].blocks.find((b) => b.id === blockId)!;
    expect(evidenceNote(counted, block, MON)).toBe('Done · 40 of 60 min timed');
  });

  it('can record and count a shorter session as done in one confirmed change', () => {
    const state = opened();
    let run = startStudy(DSA_STUDY, target, T0);
    run = pauseStudy(run, T0 + 20 * MIN);
    const next = recordStudy(
      state,
      run,
      { countAsDone: true },
      'study-1',
      new Date(T0 + 30 * MIN).toISOString(),
    );
    expect(statusOf(next)).toBe('done');
    expect(fullStudy(studySessionFor(next, blockId)!.study!)).toBe(false);
  });

  it('refuses a second session, less than a minute, a future day or another objective', () => {
    const state = opened();
    const { run, end } = fullRun();
    const now = new Date(end).toISOString();
    const once = recordStudy(state, run, { countAsDone: false }, 'study-1', now);
    expect(() => recordStudy(once, run, { countAsDone: false }, 'study-2', now)).toThrow(
      'already recorded',
    );
    const short = pauseStudy(startStudy(DSA_STUDY, target, T0), T0 + 30_000);
    expect(() => recordStudy(state, short, { countAsDone: true }, 's', now)).toThrow(
      'Less than a minute',
    );
    expect(() =>
      recordStudy(
        state,
        run,
        { countAsDone: false },
        's',
        new Date(at(MON, 0) - MIN).toISOString(),
      ),
    ).toThrow('today or an earlier day');
    expect(() =>
      recordStudy(state, { ...run, routineId: 'job-search' }, { countAsDone: false }, 's', now),
    ).toThrow('no longer belongs');
  });

  it('removes a session recorded by mistake and reopens its objective', () => {
    const { run, end } = fullRun();
    const recorded = recordStudy(
      opened(),
      run,
      { countAsDone: false },
      'study-1',
      new Date(end).toISOString(),
    );
    const removed = discardStudySession(recorded, MON, blockId);
    expect(studySessionFor(removed, blockId)).toBeUndefined();
    expect(statusOf(removed)).toBe('planned');
  });

  it('treats a one-tap Done as ordinary completion, with no timed record expected', () => {
    const state = opened();
    const done = withDay(
      state,
      setStatus(state.days[MON], blockId, 'done', new Date(T0).toISOString()),
    );
    const block = done.days[MON].blocks.find((b) => b.id === blockId)!;
    expect(linkedRecord(done, block)).toBeNull();
    expect(evidenceNote(done, block, MON)).toBeNull();
    // No minutes are invented for it.
    expect(done.activitySessions).toEqual([]);
  });

  it('survives the backup round trip and stays out of cardio minutes', () => {
    const { run, end } = fullRun();
    let state = recordStudy(
      opened(),
      run,
      { countAsDone: false },
      'study-1',
      new Date(end).toISOString(),
    );
    state = {
      ...state,
      activitySessions: [
        ...state.activitySessions,
        {
          id: 'bike-1',
          date: MON,
          at: new Date(T0).toISOString(),
          routineId: null,
          occurrenceId: null,
          activity: 'Bike',
          minutes: 30,
          note: '',
        },
      ],
    };
    const restored = parseBackup(encodeBackup(state)).state;
    expect(studySessionFor(restored, blockId)!.study).toEqual(
      studySessionFor(state, blockId)!.study,
    );
    // Cardio totals and graphs count the bike only; the study routine counts its own minutes.
    expect(weeklyMinutes(state, MON, 1)[0].minutes).toBe(30);
    expect(weeklyMinutes(state, MON, 1, 'study')[0].minutes).toBe(60);
  });

  it('exports study minutes and each stage against its plan', () => {
    let run = startStudy(DSA_STUDY, target, T0);
    run = advanceStudy(run, T0 + 25 * MIN);
    run = pauseStudy(run, T0 + 35 * MIN);
    const state = recordStudy(
      opened(),
      run,
      { countAsDone: false },
      'study-1',
      new Date(T0 + 40 * MIN).toISOString(),
    );
    const rows = buildExport(state, {
      categories: ['activities'],
      from: MON,
      to: MON,
      includePrivate: false,
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'study minutes',
          value: 35,
          note: 'shorter than planned',
        }),
        expect.objectContaining({
          item: 'Daily study · Algorithm-recognition practice',
          field: 'stage time',
          value: 600,
          note: 'planned 1800 s · not finished',
        }),
      ]),
    );
  });
});

describe('study data validation', () => {
  it('refuses records whose minutes do not match their stages or exceed the plan', () => {
    const { run, end } = fullRun();
    const state = recordStudy(
      opened(),
      run,
      { countAsDone: false },
      'study-1',
      new Date(end).toISOString(),
    );
    const session = studySessionFor(state, blockId)!;
    const tamper = (change: object) =>
      decodeState({
        ...state,
        activitySessions: [{ ...session, ...change }],
      });
    expect(() => tamper({ minutes: 61 })).toThrow('do not match');
    expect(() =>
      tamper({
        study: {
          ...session.study,
          stages: session.study!.stages.map((s) => ({ ...s, seconds: s.plannedSeconds + 1 })),
        },
      }),
    ).toThrow('study stage time');
  });

  it('refuses a study plan that also records something else, or has no stages', () => {
    const state = studyState();
    const withRoutine = (change: object) => ({
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === 'study' ? { ...r, ...change } : r)),
      })),
    });
    expect(() => decodeState(withRoutine({ capture: 'money' }))).toThrow('study objective');
    expect(() => decodeState(withRoutine({ study: { ...DSA_STUDY, stages: [] } }))).toThrow(
      'without stages',
    );
    expect(() => saveStudyPlan(state, 'weigh-in', DSA_STUDY)).toThrow('records something else');
    expect(() => saveStudyPlan(state, 'upper', DSA_STUDY)).toThrow('workout plan');
  });

  it('a setup import keeps the study plan the file does not mention', () => {
    const state = studyState();
    const career = state.programs.find((p) => p.id === 'career')!;
    const file = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [
        {
          ...career,
          routines: career.routines.map((r) => {
            const plain = { ...r };
            delete plain.study;
            return plain;
          }),
        },
      ],
    });
    const imported = parseSetup(file, state);
    const study = imported.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!;
    expect(study.study).toEqual(
      state.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!.study,
    );
  });

  it('reads back only well-formed saved runs', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    expect(decodeStudyRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(decodeStudyRun({ ...run, spentMs: [0, 0] })).toBeNull();
    expect(decodeStudyRun({ ...run, spentMs: [99 * MIN, 0, 0] })).toBeNull();
    expect(decodeStudyRun({ ...run, index: 4 })).toBeNull();
    expect(decodeStudyRun({ ...run, index: 3, anchor: T0 })).toBeNull();
    expect(decodeStudyRun('nonsense')).toBeNull();
  });

  it('refuses corrupted saved runs and restarts a clock anchored in the future', () => {
    const run = startStudy(DSA_STUDY, target, T0);
    const twoStages = { ...run, stages: [run.stages[0], { ...run.stages[0] }], spentMs: [0, 0] };
    expect(decodeStudyRun(twoStages)).toBeNull();
    const badLink = {
      ...run,
      stages: run.stages.map((s, i) =>
        i === 0 ? { ...s, links: [{ label: 'x', url: 'javascript:alert(1)' }] } : s,
      ),
    };
    expect(decodeStudyRun(badLink)).toBeNull();
    expect(decodeStudyRun({ ...run, spentMs: [0, MIN, 0] })).toBeNull();
    expect(decodeStudyRun({ ...run, date: '2026-13-40' })).toBeNull();
    const ahead = { ...run, anchor: T0 + 120 * MIN };
    expect(spentAt(ahead, T0 + 10 * MIN)[0]).toBe(0);
    const restored = restoreStudyRun(ahead, T0 + 10 * MIN);
    expect(spentAt(restored, T0 + 15 * MIN)[0]).toBe(5 * MIN);
    expect(restoreStudyRun(run, T0 + MIN)).toBe(run);
  });

  it('refuses a stage confirmed after an unfinished one, and a study plan beside a workout or circuit', () => {
    const { run, end } = fullRun();
    const state = recordStudy(
      opened(),
      run,
      { countAsDone: false },
      'study-1',
      new Date(end).toISOString(),
    );
    const session = studySessionFor(state, blockId)!;
    const stages = session.study!.stages.map((s, i) => (i === 0 ? { ...s, done: false } : s));
    expect(() =>
      decodeState({
        ...state,
        activitySessions: [{ ...session, study: { ...session.study, stages } }],
      }),
    ).toThrow('done after an unfinished one');
    const template = { ...state.workoutTemplates[0], id: 'template-study', routineId: 'study' };
    expect(() =>
      decodeState({ ...state, workoutTemplates: [...state.workoutTemplates, template] }),
    ).toThrow('study objective');
  });

  it('a setup file that gives the routine a record type replaces its study plan', () => {
    const state = studyState();
    const career = state.programs.find((p) => p.id === 'career')!;
    const file = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [
        {
          ...career,
          routines: career.routines.map((r) => {
            const plain = { ...r };
            delete plain.study;
            return r.id === 'study' ? { ...plain, capture: 'activity' } : plain;
          }),
        },
      ],
    });
    const study = parseSetup(file, state)
      .programs.flatMap((p) => p.routines)
      .find((r) => r.id === 'study')!;
    expect(study.capture).toBe('activity');
    expect(study.study).toBeUndefined();
  });

  it('gathers configured study resources once each, and keeps an optional cue through a backup', () => {
    const state = studyState();
    const routine = state.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!;
    expect(studyResources(routine)).toEqual([
      { label: 'Course notes', url: 'https://example.com/course' },
    ]);
    const linked = {
      ...routine,
      links: [
        { label: 'Course notes', url: 'https://example.com/course' },
        { label: 'Recognition practice', url: 'https://example.com/practice' },
      ],
    };
    expect(studyResources(linked).map((l) => l.label)).toEqual([
      'Course notes',
      'Recognition practice',
    ]);
    expect(studyResources({ ...routine, study: { ...routine.study!, stages: [] } })).toEqual([]);
    const cued = saveStudyPlan(state, 'study', { ...routine.study!, cue: 'After dinner' });
    const restored = parseBackup(encodeBackup(cued)).state;
    expect(
      restored.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!.study!.cue,
    ).toBe('After dinner');
    expect(() => saveStudyPlan(state, 'study', { ...routine.study!, cue: 'x'.repeat(81) })).toThrow(
      'study cue',
    );
  });
});
