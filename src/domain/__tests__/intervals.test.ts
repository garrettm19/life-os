import { describe, expect, it } from '@jest/globals';
import { setStatus } from '../planner';
import { parseSetup, withDay } from '../data';
import { defaultSettings } from '../model';
import {
  CORE_CIRCUIT,
  activeCircuitLine,
  addStep,
  circuitFor,
  completeCircuit,
  cuesBetween,
  elapsedAt,
  jumpNext,
  jumpPrevious,
  moveStep,
  pauseRun,
  positionAt,
  readyRun,
  removeStep,
  restoreRun,
  restoreOriginal,
  resumeRun,
  saveCircuit,
  segmentsOf,
  startRun,
  tick,
  totalSeconds,
  updateStep,
  newCircuit,
  checkpoint,
  decodeActiveCircuit,
  discardCircuitSession,
  markCircuitDone,
  interrupted,
  nextFinishes,
  pauseAt,
} from '../intervals';
import { evidenceNote, linkedRecord } from '../linked';
import { AT, trainingState as baseState } from '../../test-support/fixtures';

/** The synthetic training setup plus a plain checklist routine for the circuit to complete. */
function trainingState() {
  const state = baseState();
  return {
    ...state,
    programs: state.programs.map((p) =>
      p.id === 'training'
        ? {
            ...p,
            routines: [
              ...p.routines,
              {
                id: 'abs',
                title: 'Core circuit',
                duration: null,
                weekdays: [2, 4],
                preferredStart: null,
                enabled: true,
                fixed: false,
                steps: [],
                bundledInto: null,
                checklist: true,
              },
            ],
          }
        : p,
    ),
  };
}

const T0 = 1_000_000;
const s = (seconds: number) => T0 + seconds * 1000;
const mmss = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

describe('the preset ab circuit', () => {
  it('runs exactly 14 minutes with the original timeline', () => {
    expect(totalSeconds(CORE_CIRCUIT)).toBe(14 * 60);
    expect(
      segmentsOf(CORE_CIRCUIT).map((x) => `${mmss(x.startMs)}–${mmss(x.endMs)} ${x.label}`),
    ).toEqual([
      '0:00–0:30 Get ready',
      '0:30–1:40 Crunches',
      '1:40–1:50 Rest',
      '1:50–3:00 Bicycle Kicks',
      '3:00–3:10 Rest',
      '3:10–3:45 Jack Knives — Left',
      '3:45–4:20 Jack Knives — Right',
      '4:20–4:30 Rest',
      '4:30–5:40 Russian Twists',
      '5:40–5:50 Rest',
      '5:50–7:00 Toe Taps',
      '7:00–7:10 Rest',
      '7:10–7:45 Bicycle Crunches — Left',
      '7:45–8:20 Bicycle Crunches — Right',
      '8:20–8:30 Rest',
      '8:30–9:40 Scissor Kicks',
      '9:40–9:50 Rest',
      '9:50–11:00 Reverse Crunches',
      '11:00–11:10 Rest',
      '11:10–12:20 Butterfly Kicks',
      '12:20–12:30 Rest',
      '12:30–13:15 Side Plank — Left',
      '13:15–14:00 Side Plank — Right',
    ]);
  });

  it('never adds a rest after the last interval, whatever it is set to', () => {
    const plan = {
      ...CORE_CIRCUIT,
      steps: CORE_CIRCUIT.steps.map((x) => ({ ...x, restAfter: 10 })),
    };
    const segments = segmentsOf(plan);
    expect(segments.at(-1)!.kind).toBe('work');
  });

  it('omits the preparation when it is zero', () => {
    expect(segmentsOf({ ...CORE_CIRCUIT, prepSeconds: 0 })[0].label).toBe('Crunches');
  });
});

describe('timer run (deadline model)', () => {
  const plan = CORE_CIRCUIT;

  it('derives the position from the clock, not from counted ticks', () => {
    const run = startRun(readyRun(), s(0));
    // A render 65 s later lands in Crunches with 35 s left, however few ticks happened.
    const at = positionAt(plan, elapsedAt(run, s(65)));
    expect(at.segment.label).toBe('Crunches');
    expect(Math.ceil(at.remainingMs / 1000)).toBe(35);
    expect(at.next?.label).toBe('Rest');
  });

  it('freezes while paused and continues from the same point', () => {
    let run = startRun(readyRun(), s(0));
    run = pauseRun(run, s(40));
    expect(elapsedAt(run, s(500))).toBe(40_000);
    run = resumeRun(run, s(500));
    expect(elapsedAt(run, s(510))).toBe(50_000);
    // Repeated taps are harmless.
    expect(pauseRun(pauseRun(run, s(520)), s(530))).toEqual(pauseRun(run, s(520)));
    expect(resumeRun(run, s(600))).toBe(run);
  });

  it('never counts backwards when the device clock moves back', () => {
    const run = startRun(readyRun(), s(100));
    expect(elapsedAt(run, s(90))).toBe(0);
  });

  it('finishes at the end and never shows a negative countdown', () => {
    let run = startRun(readyRun(), s(0));
    run = tick(run, plan, s(14 * 60 + 30));
    expect(run.status).toBe('finished');
    expect(elapsedAt(run, s(5000))).toBe(14 * 60 * 1000);
    expect(positionAt(plan, elapsedAt(run, s(5000))).remainingMs).toBe(0);
  });

  it('Next jumps to the next interval and records a skipped exercise', () => {
    let run = startRun(readyRun(), s(0));
    run = jumpNext(run, plan, s(10)); // skip the rest of preparation
    expect(positionAt(plan, elapsedAt(run, s(10))).segment.label).toBe('Crunches');
    expect(run.skipped).toEqual([]);
    run = jumpNext(run, plan, s(20)); // Crunches 10 s in
    expect(positionAt(plan, elapsedAt(run, s(20))).segment.label).toBe('Rest');
    expect(run.skipped).toEqual(['Crunches']);
    // A skipped exercise is listed once, even if skipped again after going back.
    run = jumpPrevious(run, plan, s(21));
    run = jumpPrevious(run, plan, s(21));
    run = jumpNext(run, plan, s(22));
    expect(run.skipped).toEqual(['Crunches']);
  });

  it('Previous restarts the interval, or goes back one when pressed at its start', () => {
    let run = startRun(readyRun(), s(0));
    run = pauseRun(run, s(50)); // Crunches, 20 s in
    run = jumpPrevious(run, plan, s(60));
    expect(elapsedAt(run, s(60))).toBe(30_000);
    expect(run.status).toBe('paused');
    run = jumpPrevious(run, plan, s(61));
    expect(elapsedAt(run, s(61))).toBe(0);
    expect(jumpPrevious(run, plan, s(62))).toEqual(run);
  });

  it('Next on the last interval reaches the end', () => {
    let run = startRun(readyRun(), s(0));
    run = jumpNext({ ...run, elapsedMs: 13 * 60_000 + 20_000, anchor: s(0) }, plan, s(0));
    expect(run.status).toBe('finished');
    expect(run.skipped).toEqual(['Side Plank — Right']);
  });

  it('restores an interrupted run as paused at its last saved point, never as still running', () => {
    const run = startRun(readyRun(), s(0));
    const restored = restoreRun({ ...run, elapsedMs: 200_000 }, s(9999));
    expect(restored.status).toBe('paused');
    expect(elapsedAt(restored, s(99_999))).toBe(200_000);
    expect(restoreRun(readyRun(), s(1))).toEqual(readyRun());
  });
});

describe('cues', () => {
  const plan = CORE_CIRCUIT;
  it('counts down the last three seconds and announces the next interval once', () => {
    expect(cuesBetween(plan, 26_500, 30_200)).toEqual([
      { kind: 'count', second: 3 },
      { kind: 'count', second: 2 },
      { kind: 'count', second: 1 },
      { kind: 'start', label: 'Crunches', segment: 'work', next: 'Rest' },
    ]);
    // Nothing is repeated on the following tick.
    expect(cuesBetween(plan, 30_200, 30_400)).toEqual([]);
  });

  it('a jump announces only where it lands, not every interval skipped over', () => {
    expect(cuesBetween(plan, 10_000, 190_000, true)).toEqual([
      { kind: 'start', label: 'Jack Knives — Left', segment: 'work', next: 'Jack Knives — Right' },
    ]);
  });

  it('announces the end once', () => {
    expect(cuesBetween(plan, 839_500, 840_000).at(-1)).toEqual({ kind: 'done' });
    expect(cuesBetween(plan, 840_000, 840_000)).toEqual([]);
  });

  it('starting announces the first interval', () => {
    expect(cuesBetween(plan, -1, 0)).toEqual([
      { kind: 'start', label: 'Get ready', segment: 'prep', next: 'Crunches' },
    ]);
  });
});

describe('editing a circuit', () => {
  it('edits names, lengths and rests, allows zero rest, and recomputes the total', () => {
    let plan = updateStep(CORE_CIRCUIT, CORE_CIRCUIT.steps[0].id, { name: 'Sit-ups', seconds: 60 });
    plan = updateStep(plan, plan.steps[0].id, { restAfter: 0 });
    expect(plan.steps[0]).toMatchObject({ name: 'Sit-ups', seconds: 60, restAfter: 0 });
    expect(totalSeconds(plan)).toBe(14 * 60 - 20);
    expect(CORE_CIRCUIT.steps[0].name).toBe('Crunches');
  });

  it('adds, removes and reorders intervals without changing the others', () => {
    let plan = addStep(CORE_CIRCUIT, 'new-1');
    expect(plan.steps.at(-1)).toMatchObject({ id: 'new-1', seconds: 30, restAfter: 10 });
    plan = moveStep(plan, 'new-1', -1);
    expect(plan.steps.at(-2)!.id).toBe('new-1');
    plan = removeStep(plan, 'new-1');
    expect(plan).toEqual(CORE_CIRCUIT);
    expect(moveStep(CORE_CIRCUIT, CORE_CIRCUIT.steps[0].id, -1)).toEqual(CORE_CIRCUIT);
  });

  it('saves a circuit for a routine, refuses invalid plans, and restores the original', () => {
    const state = trainingState();
    const circuit = newCircuit('abs', 'Ab circuit', CORE_CIRCUIT, 'c1', AT);
    let next = saveCircuit(state, circuit);
    expect(circuitFor(next, 'abs')).toEqual(circuit);
    const edited = { ...circuit, ...updateStep(circuit, circuit.steps[0].id, { seconds: 90 }) };
    next = saveCircuit(next, edited);
    expect(circuitFor(next, 'abs')!.steps[0].seconds).toBe(90);
    expect(circuitFor(next, 'abs')!.original.steps[0].seconds).toBe(70);
    next = saveCircuit(next, restoreOriginal(circuitFor(next, 'abs')!, AT));
    expect(segmentsOf(circuitFor(next, 'abs')!)).toEqual(segmentsOf(CORE_CIRCUIT));
    expect(() => saveCircuit(state, { ...circuit, steps: [] })).toThrow();
    expect(() =>
      saveCircuit(state, {
        ...circuit,
        ...updateStep(circuit, circuit.steps[0].id, { seconds: 0 }),
      }),
    ).toThrow();
    expect(() => saveCircuit(state, { ...circuit, routineId: 'missing' })).toThrow();
  });
});

describe('recording a completed circuit', () => {
  function setup() {
    let state = trainingState();
    state = saveCircuit(state, newCircuit('abs', 'Ab circuit', CORE_CIRCUIT, 'c1', AT));
    state = withDay(state, {
      date: '2026-11-09',
      revisions: [],
      blocks: [
        {
          id: '2026-11-09:routine:abs',
          routineId: 'abs',
          programId: 'training',
          title: 'Core circuit',
          start: null,
          duration: 60,
          fixed: false,
          status: 'planned',
          actualAt: null,
          steps: [],
          reason: null,
          checklist: true,
        },
      ],
    });
    return state;
  }
  const done = {
    intervalId: 'c1',
    date: '2026-11-09',
    blockId: '2026-11-09:routine:abs',
    startedAt: '2026-11-09T17:00:00.000Z',
    finishedAt: '2026-11-09T17:14:00.000Z',
    skipped: [],
  };

  it('records one session and marks the objective done in one change', () => {
    const state = completeCircuit(setup(), done);
    expect(state.intervalSessions).toEqual([
      {
        id: 'interval:2026-11-09:routine:abs',
        intervalId: 'c1',
        routineId: 'abs',
        occurrenceId: '2026-11-09:routine:abs',
        date: '2026-11-09',
        startedAt: done.startedAt,
        finishedAt: done.finishedAt,
        plannedSeconds: 840,
        skipped: [],
      },
    ]);
    const block = state.days['2026-11-09'].blocks[0];
    expect(block.status).toBe('done');
    expect(block.actualAt).toBe(done.finishedAt);
    expect(linkedRecord(state, block)).toBe('recorded');
  });

  it('never records a second session for the same objective', () => {
    const once = completeCircuit(setup(), done);
    expect(() =>
      completeCircuit(once, { ...done, finishedAt: '2026-11-09T18:00:00.000Z' }),
    ).toThrow(/already recorded/);
  });

  it('a skipped objective is still completed by a finished circuit, and an undone one keeps its session', () => {
    let state = setup();
    state = withDay(state, setStatus(state.days['2026-11-09'], done.blockId, 'skipped', AT));
    state = completeCircuit(state, done);
    expect(state.days['2026-11-09'].blocks[0].status).toBe('done');
    state = withDay(state, setStatus(state.days['2026-11-09'], done.blockId, 'planned'));
    expect(state.intervalSessions).toHaveLength(1);
    expect(linkedRecord(state, state.days['2026-11-09'].blocks[0])).toBe('recorded');
  });

  it('a run with every interval skipped is not a completed circuit', () => {
    expect(() =>
      completeCircuit(setup(), { ...done, skipped: CORE_CIRCUIT.steps.map((x) => x.name) }),
    ).toThrow(/Every interval was skipped/);
  });

  it('a mistaken completion can be discarded, returning the objective to planned', () => {
    const state = discardCircuitSession(completeCircuit(setup(), done), done.date, done.blockId);
    expect(state.intervalSessions).toEqual([]);
    expect(state.days[done.date].blocks[0].status).toBe('planned');
    expect(() => discardCircuitSession(state, done.date, done.blockId)).toThrow();
  });

  it('refuses an objective that is no longer on the plan', () => {
    expect(() => completeCircuit(setup(), { ...done, blockId: 'missing' })).toThrow(
      /no longer on the plan/,
    );
  });
});

describe('recovering a circuit in progress', () => {
  it('reads back a saved run and ignores anything malformed', () => {
    const run = startRun(readyRun(), s(0));
    const saved = {
      intervalId: 'c1',
      planVersion: AT,
      date: '2026-11-09',
      blockId: 'b',
      run: checkpoint(run, s(42)),
    };
    expect(decodeActiveCircuit(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(saved.run.elapsedMs).toBe(42_000);
    expect(decodeActiveCircuit({ ...saved, run: { ...saved.run, elapsedMs: -1 } })).toBeNull();
    expect(decodeActiveCircuit({ ...saved, run: { ...saved.run, status: 'done' } })).toBeNull();
    expect(decodeActiveCircuit('nonsense')).toBeNull();
    // Restored after the app closed, it is paused where it was last saved.
    const back = restoreRun(decodeActiveCircuit(saved)!.run, s(5000));
    expect(back.status).toBe('paused');
    expect(elapsedAt(back, s(6000))).toBe(42_000);
  });
});

describe("Today's row for a circuit in progress", () => {
  it('says a run kept on the device is paused where it was, or finished and waiting to be saved', () => {
    const circuit = newCircuit('core', 'Core circuit', CORE_CIRCUIT, 'c1', AT);
    const kept = (run: ReturnType<typeof readyRun>) => ({
      intervalId: 'c1',
      planVersion: circuit.updatedAt,
      date: '2026-11-10',
      blockId: 'b',
      run,
    });
    const running = checkpoint(startRun(readyRun(), s(0)), s(201));
    // Closed while running: it comes back paused, as the timer resumes it.
    expect(activeCircuitLine(kept(running), circuit)).toBe('Paused at 3:21 · tap to resume');
    expect(activeCircuitLine(kept(pauseRun(running, s(201))), circuit)).toBe(
      'Paused at 3:21 · tap to resume',
    );
    const done = tick(running, circuit, s(totalSeconds(circuit) + 10));
    expect(activeCircuitLine(kept(done), circuit)).toBe('Circuit finished · tap to save');
    // Nothing kept, a run not started, or one on an edited circuit: nothing to say.
    expect(activeCircuitLine(null, circuit)).toBeNull();
    expect(activeCircuitLine(kept(readyRun()), circuit)).toBeNull();
    expect(
      activeCircuitLine({ ...kept(running), planVersion: '2026-01-01T00:00:00.000Z' }, circuit),
    ).toBeNull();
  });
});

describe('clock gaps and the end of a circuit', () => {
  const plan = CORE_CIRCUIT;

  it('a long gap between clock readings is an interruption, not elapsed workout time', () => {
    expect(interrupted(s(10), s(10.2))).toBe(false);
    expect(interrupted(s(10), s(60))).toBe(true);
    const run = startRun(readyRun(), s(0));
    // Paused where it was last seen, not where the jumped clock would put it.
    const paused = pauseAt(run, 50_000);
    expect(paused.status).toBe('paused');
    expect(elapsedAt(paused, s(10_000))).toBe(50_000);
    expect(pauseAt(paused, 1)).toBe(paused);
  });

  it('records the moment the end was reached, not when the tick ran', () => {
    const run = tick(startRun(readyRun(), s(0)), plan, s(900));
    expect(run.endedAt).toBe(new Date(s(840)).toISOString());
  });

  it('knows when Next would end the circuit', () => {
    const run = startRun(readyRun(), s(0));
    expect(nextFinishes(run, plan, s(10))).toBe(false);
    expect(nextFinishes(run, plan, s(800))).toBe(true);
  });
});

describe('timer sound setting', () => {
  it('is a device choice: a setup import neither sets nor clears it', () => {
    const existing = {
      ...trainingState(),
      settings: { ...trainingState().settings, timerCue: 'beep' as const },
    };
    const setup = (cue?: string) =>
      JSON.stringify({
        format: 'life-os-setup-v1',
        goals: [],
        programs: [],
        settings: { ...defaultSettings, ...(cue && { timerCue: cue }) },
      });
    expect(parseSetup(setup(), existing, AT).settings.timerCue).toBe('beep');
    expect(parseSetup(setup('mute'), existing, AT).settings.timerCue).toBe('beep');
    expect(parseSetup(setup('mute'), trainingState(), AT).settings.timerCue).toBeUndefined();
  });
});

describe('honest circuit completion', () => {
  // A day holding the circuit objective; the run is driven through the real timer functions.
  function setup() {
    let state = trainingState();
    state = saveCircuit(state, newCircuit('abs', 'Core circuit', CORE_CIRCUIT, 'c1', AT));
    return withDay(state, {
      date: '2026-11-09',
      revisions: [],
      blocks: [
        {
          id: '2026-11-09:routine:abs',
          routineId: 'abs',
          programId: 'training',
          title: 'Core circuit',
          start: null,
          duration: null,
          fixed: false,
          status: 'planned',
          actualAt: null,
          steps: [],
          reason: null,
          checklist: true,
        },
      ],
    });
  }
  /** Runs the preset, pressing Next on the given intervals mid-way, until it ends (or not). */
  function run(skipAt: number[], stopAt?: number) {
    let r = startRun(readyRun(), s(0));
    let t = 0;
    for (const at of skipAt) {
      t = at;
      r = jumpNext(r, CORE_CIRCUIT, s(t));
    }
    if (stopAt !== undefined) return pauseRun(r, s(stopAt));
    return tick(r, CORE_CIRCUIT, s(t + 900));
  }
  const record = (r: ReturnType<typeof run>) =>
    completeCircuit(setup(), {
      intervalId: 'c1',
      date: '2026-11-09',
      blockId: '2026-11-09:routine:abs',
      startedAt: r.startedAt!,
      finishedAt: r.endedAt!,
      skipped: r.skipped,
    });
  const block = (state: ReturnType<typeof setup>) => state.days['2026-11-09'].blocks[0];

  it('every interval run: one full session and the objective done', () => {
    const r = run([]);
    expect(r.status).toBe('finished');
    const state = record(r);
    expect(state.intervalSessions[0].skipped).toEqual([]);
    expect(block(state).status).toBe('done');
    expect(evidenceNote(state, block(state))).toBeNull();
  });

  it('one or several intervals skipped: the session says so and the objective stays open', () => {
    // Crunches at 0:40 of the clock; each Next moves the timeline on, so Russian Twists and Scissor
    // Kicks are cut at 5:00 and 9:00 of the circuit (clock 240 s and 440 s).
    for (const skipAt of [[40], [40, 240, 440]]) {
      const r = run(skipAt);
      expect(r.status).toBe('finished');
      const state = record(r);
      expect(state.intervalSessions[0].skipped).toHaveLength(skipAt.length);
      expect(block(state).status).toBe('planned');
      // Counting it as done is a deliberate choice, and Today then says what was skipped.
      const counted = markCircuitDone(state, '2026-11-09', '2026-11-09:routine:abs', AT);
      expect(evidenceNote(counted, block(counted))).toBe(
        `Done · circuit with ${skipAt.length} interval${skipAt.length === 1 ? '' : 's'} skipped`,
      );
    }
  });

  it('reaching the end after several skips is still a partial circuit, never the full routine', () => {
    let r = startRun(readyRun(), s(0));
    for (let i = 0; i < 6; i++) r = jumpNext(r, CORE_CIRCUIT, s(31 + i));
    r = tick(r, CORE_CIRCUIT, s(2000));
    expect(r.status).toBe('finished');
    const state = record(r);
    expect(state.intervalSessions[0].skipped.length).toBeGreaterThan(0);
    expect(block(state).status).toBe('planned');
  });

  it('every interval skipped, stopped half way, or closed during a rest: nothing is recorded', () => {
    let all = startRun(readyRun(), s(0));
    while (all.status !== 'finished') all = jumpNext(all, CORE_CIRCUIT, s(1));
    expect(() => record(all)).toThrow(/Every interval was skipped/);
    // Stopped half way: the run is not finished, so there is nothing to record.
    expect(run([], 420).status).toBe('paused');
    // Closed during the first rest (1:40-1:50): it comes back paused there, never finished.
    const closed = restoreRun({ ...startRun(readyRun(), s(0)), elapsedMs: 105_000 }, s(5000));
    expect(closed.status).toBe('paused');
    expect(positionAt(CORE_CIRCUIT, elapsedAt(closed, s(9000))).segment.kind).toBe('rest');
    expect(tick(closed, CORE_CIRCUIT, s(99_999)).status).toBe('paused');
  });

  it('a recorded circuit is never recorded twice, whatever its outcome', () => {
    const once = record(run([]));
    expect(() =>
      completeCircuit(once, {
        intervalId: 'c1',
        date: '2026-11-09',
        blockId: '2026-11-09:routine:abs',
        startedAt: AT,
        finishedAt: AT,
        skipped: [],
      }),
    ).toThrow(/already recorded/);
  });
});
