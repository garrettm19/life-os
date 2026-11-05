import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, withDay } from '../data';
import { Program, Routine, State } from '../model';
import { dayClearStreak, dayOutcome, dayProgress, streakHistory } from '../objectives';
import { ensureChecklistDay, generateDay, setStatus } from '../planner';
import { upsertRoutine } from '../routines';
import { trainingState } from '../../test-support/fixtures';

// Synthetic weekly setup: a Sunday weigh-in and a Sunday money review, both checklist objectives.
const PAST_SUN = '2026-11-08';
const SUN = '2026-11-15';
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};
const id = (date: string, routine: string) => `${date}:routine:${routine}`;

function open(state: State, date: string, now = noon(date)): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], now),
  );
}
function mark(state: State, date: string, routine: string, status: 'done' | 'skipped') {
  return withDay(state, setStatus(state.days[date], id(date, routine), status, noon(date)));
}
function makeWeighInOptional(state: State, now: string): State {
  const tracking = state.programs.find((p) => p.id === 'tracking')!;
  const weighIn = tracking.routines.find((r) => r.id === 'weigh-in')!;
  return upsertRoutine(state, tracking, { ...weighIn, optional: true }, now);
}

describe('optional objectives', () => {
  it('never hold back Day Cleared, and never earn credit on their own', () => {
    let state = makeWeighInOptional(trainingState(), noon(SUN));
    state = open(state, SUN);
    expect(state.days[SUN].blocks.find((b) => b.routineId === 'weigh-in')!.optional).toBe(true);
    // Only the money review is required.
    expect(dayProgress(state.days[SUN], state.programs, SUN).total).toBe(1);
    state = mark(state, SUN, 'money-check', 'done');
    expect(dayOutcome(state, SUN)).toBe('cleared');
    // Doing the weigh-in changes nothing about Day Cleared.
    const weighed = mark(state, SUN, 'weigh-in', 'done');
    expect(dayProgress(weighed.days[SUN], weighed.programs, SUN)).toMatchObject({
      done: 1,
      total: 1,
      cleared: true,
    });
    // A day holding only an optional objective is not a cleared day.
    const onlyOptional = withDay(weighed, {
      ...weighed.days[SUN],
      blocks: weighed.days[SUN].blocks.filter((b) => b.routineId === 'weigh-in'),
    });
    expect(dayOutcome(onlyOptional, SUN)).toBe('empty');
  });

  it('making a routine optional leaves days already recorded exactly as they were', () => {
    let state = trainingState();
    // Last Sunday the weigh-in was required and missed; only the review was done.
    state = open(state, PAST_SUN);
    state = mark(state, PAST_SUN, 'money-check', 'done');
    expect(dayOutcome(state, PAST_SUN)).toBe('open');
    const history = streakHistory(state, PAST_SUN, SUN);
    const streak = dayClearStreak(state, PAST_SUN, SUN);
    state = makeWeighInOptional(state, noon(SUN));
    expect(state.days[PAST_SUN].blocks.find((b) => b.routineId === 'weigh-in')!.optional).toBe(
      undefined,
    );
    expect(dayOutcome(state, PAST_SUN)).toBe('open');
    expect(streakHistory(state, PAST_SUN, SUN)).toEqual(history);
    expect(dayClearStreak(state, PAST_SUN, SUN)).toEqual(streak);
  });

  it("today's planned occurrence follows the routine; a recorded one keeps its meaning", () => {
    let state = open(trainingState(), SUN);
    state = mark(state, SUN, 'weigh-in', 'done');
    state = makeWeighInOptional(state, noon(SUN));
    // Already recorded as a required objective before the change: it stays that way.
    expect(state.days[SUN].blocks.find((b) => b.routineId === 'weigh-in')!.optional).toBe(
      undefined,
    );
    let fresh = open(trainingState(), SUN);
    fresh = makeWeighInOptional(fresh, noon(SUN));
    expect(fresh.days[SUN].blocks.find((b) => b.routineId === 'weigh-in')!.optional).toBe(true);
    // Back to required: today's planned occurrence counts again.
    const tracking = fresh.programs.find((p) => p.id === 'tracking')!;
    const weighIn = tracking.routines.find((r) => r.id === 'weigh-in')!;
    fresh = upsertRoutine(fresh, tracking, { ...weighIn, optional: false }, noon(SUN));
    expect(fresh.days[SUN].blocks.find((b) => b.routineId === 'weigh-in')!.optional).toBe(
      undefined,
    );
  });

  it('round-trips through a backup and rejects a malformed flag', () => {
    let state = makeWeighInOptional(trainingState(), noon(SUN));
    state = open(state, SUN);
    expect(parseBackup(encodeBackup(state, noon(SUN))).state).toEqual(state);
    const bad = JSON.parse(JSON.stringify(state));
    bad.days[SUN].blocks[0].optional = 'yes';
    expect(() => decodeState(bad)).toThrow();
  });
});

describe('optional bundled and timed objectives', () => {
  const base = (extra: Partial<Routine>, child: Partial<Routine>): State => {
    const s = trainingState();
    const parent: Program = {
      id: 'host',
      title: 'Host',
      group: 'Daily',
      goalIds: [],
      routines: [
        {
          id: 'parent',
          title: 'Parent routine',
          duration: null,
          weekdays: [0],
          preferredStart: null,
          enabled: true,
          fixed: false,
          steps: [],
          bundledInto: null,
          checklist: true,
          ...extra,
        },
      ],
    };
    const childProgram: Program = {
      id: 'child-program',
      title: 'Child',
      group: 'Daily',
      goalIds: [],
      routines: [
        {
          id: 'child',
          title: 'Bundled child',
          duration: null,
          weekdays: [0],
          preferredStart: null,
          enabled: true,
          fixed: false,
          steps: [],
          bundledInto: 'host',
          checklist: true,
          ...child,
        },
      ],
    };
    return { ...s, programs: [parent, childProgram] };
  };

  it('bundled steps of an optional parent never count toward Day Cleared', () => {
    const s = open(base({ optional: true }, {}), SUN);
    const progress = dayProgress(s.days[SUN], s.programs, SUN);
    expect(progress.total).toBe(0);
  });

  it('an optional bundled routine stays optional inside a required parent', () => {
    const s = open(base({}, { optional: true }), SUN);
    const parent = s.days[SUN].blocks.find((b) => b.routineId === 'parent')!;
    expect(parent.bundledSteps?.[0].optional).toBe(true);
    expect(dayProgress(s.days[SUN], s.programs, SUN).total).toBe(0);
  });

  it('an optional timed session never blocks a day before it is placed', () => {
    const timed = base({ checklist: false, duration: 30, optional: true }, { weekdays: [] });
    const s = open(timed, SUN);
    expect(s.days[SUN].dueTimed).toBeUndefined();
    expect(dayProgress(s.days[SUN], s.programs, SUN).missingTimed).toBe(0);
    const placed = withDay(s, generateDay(SUN, s.settings, s.programs, s.days[SUN], noon(SUN)));
    expect(dayProgress(placed.days[SUN], placed.programs, SUN).total).toBe(0);
  });
});
