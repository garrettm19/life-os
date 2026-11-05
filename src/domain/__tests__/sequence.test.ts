import { describe, expect, it } from '@jest/globals';
import { decodeState, withDay } from '../data';
import { dayProgress, missingTimedIds } from '../objectives';
import { ensureChecklistDay, generateDay, setStatus } from '../planner';
import { applyShift, planShift, workoutOccurrences } from '../sequence';
import { encodeBackup, parseBackup } from '../backup';
import { reconcileRoutineDays } from '../routines';
import { State, shiftDate } from '../model';
import { AT, trainingState } from '../../test-support/fixtures';

// Monday 2026-11-09 is "today" throughout; dates are local calendar keys.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const WED = '2026-11-11';
const THU = '2026-11-12';
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const NOW = AT;

function opened(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], NOW),
  );
}
function placements(state: State, from: string, to: string, today = MON) {
  return workoutOccurrences(state, 'training', from, to, today).map(
    (o) => `${o.date} ${o.routineId}${o.movedFrom ? ` (from ${o.movedFrom})` : ''} ${o.status}`,
  );
}
function shift(
  state: State,
  date: string,
  routineId = 'upper',
  today = MON,
  mode: 'forward' | 'restore' = 'forward',
) {
  const plan = planShift(state, { date, routineId }, mode, today);
  return { plan, next: () => applyShift(state, plan, false, NOW, today) };
}

describe('moving a workout and the rest of its sequence', () => {
  it('moves Monday, Wednesday and Friday to Tuesday, Thursday and Saturday, keeping order and gaps', () => {
    const state = opened(trainingState(), MON);
    const { plan, next } = shift(state, MON);
    expect(plan.conflicts).toEqual([]);
    expect(plan.moves.map((m) => `${m.occurrence.date}→${m.to}`)).toEqual([
      `${MON}→${TUE}`,
      `${WED}→${THU}`,
      `${FRI}→${SAT}`,
    ]);
    const after = next();
    expect(placements(after, MON, SAT)).toEqual([
      `${TUE} upper (from ${MON}) planned`,
      `${THU} lower (from ${WED}) planned`,
      `${SAT} upper (from ${FRI}) planned`,
    ]);
    // The same occurrence moved: it keeps Monday's ID, so its history stays one workout.
    expect(after.days[TUE].blocks.find((b) => b.routineId === 'upper')!.id).toBe(
      `${MON}:routine:upper`,
    );
  });

  it('never regenerates the moved workout on its old day or doubles it on the new one', () => {
    let state = shift(opened(trainingState(), MON), MON).next();
    for (const date of [MON, TUE, WED, THU, FRI, SAT]) {
      state = opened(state, date);
      state = withDay(
        state,
        generateDay(date, state.settings, state.programs, state.days[date], NOW),
      );
    }
    expect(placements(state, MON, SAT)).toEqual([
      `${TUE} upper (from ${MON}) planned`,
      `${THU} lower (from ${WED}) planned`,
      `${SAT} upper (from ${FRI}) planned`,
    ]);
    expect(state.days[MON].blocks.some((b) => b.routineId === 'upper')).toBe(false);
  });

  it('does not count the moved workout against its old day, and counts it on the new one', () => {
    const state = shift(opened(trainingState(), MON), MON).next();
    expect(dayProgress(state.days[MON], state.programs, MON).total).toBe(0);
    const tuesday = opened(state, TUE);
    expect(dayProgress(tuesday.days[TUE], tuesday.programs, TUE).total).toBe(1);
  });

  it('crosses the end of the month and a daylight-saving change by calendar date', () => {
    // US daylight saving ends 2026-11-01; October 30 is a Friday, November 2 a Monday.
    const state = trainingState();
    const { plan } = shift(state, '2026-10-30', 'upper', '2026-10-30');
    expect(plan.conflicts).toEqual([]);
    expect(plan.moves.map((m) => m.to)).toEqual(['2026-10-31', '2026-11-03', '2026-11-05']);
    // End of a year too.
    expect(
      shift(trainingState(), '2026-12-30', 'lower', '2026-12-30').plan.moves.map((m) => m.to),
    ).toEqual(['2026-12-31', '2027-01-02', '2027-01-05']);
  });

  it('leaves a completed workout in place and refuses to land on it', () => {
    let state = opened(trainingState(), WED);
    const lower = state.days[WED].blocks.find((b) => b.routineId === 'lower')!;
    state = withDay(state, setStatus(state.days[WED], lower.id, 'done', NOW));
    // Monday lands on Tuesday; Wednesday is recorded and stays; Friday moves to Saturday. Nothing
    // collides, so it applies.
    const ok = shift(state, MON);
    expect(ok.plan.conflicts).toEqual([]);
    expect(ok.plan.unchanged.map((o) => `${o.date} ${o.status}`)).toEqual([`${WED} done`]);
    const after = ok.next();
    expect(after.days[WED].blocks.find((b) => b.id === lower.id)).toEqual(
      state.days[WED].blocks.find((b) => b.id === lower.id),
    );
    // Shifting Tuesday's workout again would land on the recorded Wednesday: refused, unchanged.
    const blocked = planShift(after, { date: TUE, routineId: 'upper' }, 'forward', MON);
    expect(blocked.conflicts.join(' ')).toMatch(/already recorded/);
    expect(() => applyShift(after, blocked, false, NOW, MON)).toThrow(/already recorded/);
  });

  it('refuses a recorded or past workout as the starting point', () => {
    let state = opened(trainingState(), MON);
    const upper = state.days[MON].blocks.find((b) => b.routineId === 'upper')!;
    state = withDay(state, setStatus(state.days[MON], upper.id, 'done', NOW));
    expect(
      planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON).conflicts.join(' '),
    ).toMatch(/already recorded/);
    expect(
      planShift(
        trainingState(),
        { date: '2026-11-06', routineId: 'upper' },
        'forward',
        MON,
      ).conflicts.join(' '),
    ).toMatch(/today and later/);
  });

  it('only moves workouts of this program: habits, measurements and other plans stay', () => {
    const state = opened(trainingState(), MON);
    const after = shift(state, MON).next();
    const sunday = '2026-11-15';
    expect(
      opened(after, sunday)
        .days[sunday].blocks.map((b) => b.routineId)
        .sort(),
    ).toEqual(['money-check', 'weigh-in']);
    expect(after.programs).toBe(state.programs);
    expect(after.workoutTemplates).toBe(state.workoutTemplates);
  });

  it('is bounded to one week: the following Monday stays, and a collision there is refused', () => {
    const state = opened(trainingState(), MON);
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.moves.some((m) => m.occurrence.date >= '2026-11-16')).toBe(false);
    // Friday's window runs to the next Thursday: Friday moves to Saturday, the next Monday to
    // Tuesday and the next Wednesday to Thursday.
    const fromFriday = planShift(state, { date: FRI, routineId: 'upper' }, 'forward', MON);
    expect(fromFriday.moves.map((m) => m.to)).toEqual([SAT, '2026-11-17', '2026-11-19']);
  });

  it('repeating the operation moves the same occurrences again without duplicates', () => {
    const once = shift(opened(trainingState(), MON), MON).next();
    const twice = shift(once, TUE).next();
    // The second shift's week runs Tuesday to the next Monday, so that Monday moves too and the
    // two-day gap after Sunday's workout is kept.
    expect(placements(twice, MON, '2026-11-17')).toEqual([
      `${WED} upper (from ${MON}) planned`,
      `${FRI} lower (from ${WED}) planned`,
      `2026-11-15 upper (from ${FRI}) planned`,
      '2026-11-17 upper (from 2026-11-16) planned',
    ]);
    // Each original day records exactly one move for its workout.
    expect(twice.days[MON].moved).toEqual([{ routineId: 'upper', to: WED, at: NOW }]);
  });

  it('restores moved workouts to their original days exactly', () => {
    const state = opened(trainingState(), MON);
    const moved = shift(state, MON).next();
    const { plan, next } = shift(moved, TUE, 'upper', MON, 'restore');
    expect(plan.conflicts).toEqual([]);
    const restored = next();
    expect(placements(restored, MON, SAT)).toEqual([
      `${MON} upper planned`,
      `${WED} lower planned`,
      `${FRI} upper planned`,
    ]);
    expect(restored.days[MON].moved).toBeUndefined();
    expect(restored.days[MON].blocks.find((b) => b.routineId === 'upper')!.id).toBe(
      `${MON}:routine:upper`,
    );
  });

  it('a timed fixed session whose time is taken needs an explicit choice; a flexible one loses its time', () => {
    const state = trainingState();
    const timed = state.programs[0].routines[0];
    state.programs[0].routines[0] = {
      ...timed,
      checklist: false,
      fixed: true,
      preferredStart: 600,
    };
    // Demo work runs 10:00–12:00 on weekdays, so a fixed 10:00 session on Tuesday collides.
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.slotConflicts.join(' ')).toMatch(/fixed time/);
    expect(() => applyShift(state, plan, false, NOW, MON)).toThrow(/fixed time/);
    const placed = applyShift(state, plan, true, NOW, MON);
    const moved = placed.days[TUE].blocks.find((b) => b.routineId === 'upper')!;
    expect(moved.start).toBeNull();
    expect(moved.reason).toMatch(/choose a time/i);
    state.programs[0].routines[0] = {
      ...timed,
      checklist: false,
      fixed: false,
      preferredStart: 600,
    };
    const flexible = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(flexible.slotConflicts).toEqual([]);
    expect(flexible.moves[0].note).toMatch(/without a time/);
  });

  it('a timed session moved off a day no longer blocks its Day Cleared', () => {
    const state = trainingState();
    state.programs[0].routines[0] = {
      ...state.programs[0].routines[0],
      checklist: false,
      preferredStart: 1200,
    };
    const monday = generateDay(MON, state.settings, state.programs, undefined, NOW);
    let s = withDay(state, ensureChecklistDay(MON, state.settings, state.programs, monday, NOW));
    expect(s.days[MON].dueTimed).toContain('upper');
    s = shift(s, MON).next();
    expect(s.days[MON].dueTimed ?? []).not.toContain('upper');
    expect(missingTimedIds(s.days[MON])).toEqual([]);
  });

  it('keeps a manually moved occurrence when the routine catalog changes', () => {
    const moved = shift(opened(trainingState(), MON), MON).next();
    const routine = moved.programs[0].routines[0];
    const edited = { ...routine, title: 'Upper body A' };
    const days = reconcileRoutineDays(moved.days, moved.programs, edited, routine, NOW);
    expect(days[TUE].blocks.find((b) => b.routineId === 'upper')).toEqual(
      moved.days[TUE].blocks.find((b) => b.routineId === 'upper'),
    );
    expect(days[MON]?.blocks.some((b) => b.routineId === 'upper') ?? false).toBe(false);
  });

  it('survives backup and restore', () => {
    const moved = shift(opened(trainingState(), MON), MON).next();
    expect(parseBackup(encodeBackup(moved, NOW)).state).toEqual(moved);
  });

  it('saves revisions on days that existed and changes nothing on refusal', () => {
    const state = opened(trainingState(), MON);
    const after = shift(state, MON).next();
    expect(after.days[MON].revisions.at(-1)!.reason).toBe('Move workout sequence');
    expect(after.days[MON].revisions.at(-1)!.blocks.some((b) => b.routineId === 'upper')).toBe(
      true,
    );
    // A refused plan throws before producing any state; the input is untouched.
    const snapshot = JSON.stringify(after);
    const refused = planShift(
      after,
      { date: shiftDate(MON, -3), routineId: 'upper' },
      'forward',
      MON,
    );
    expect(() => applyShift(after, refused, false, NOW, MON)).toThrow();
    expect(JSON.stringify(after)).toBe(snapshot);
  });
});

describe('shifts and the rest of the plan', () => {
  it('a bundled step never attaches to a moved-in workout, so the day still saves', () => {
    const state = trainingState();
    // Upper body on Monday, Tuesday and Friday; a bundled stretch inside Training on Tuesdays.
    state.programs[0].routines[0] = { ...state.programs[0].routines[0], weekdays: [1, 2, 5] };
    state.programs[0].routines.push({
      ...state.programs[0].routines[1],
      id: 'stretch',
      title: 'Stretch',
      weekdays: [2],
      bundledInto: 'training',
      checklist: false,
    });
    let s = shift(opened(state, MON), MON).next();
    // Monday's workout now sits on Tuesday (Tuesday's own moved on to Wednesday).
    expect(s.days[TUE].blocks.find((b) => b.routineId === 'upper')!.movedFrom).toBe(MON);
    for (const step of [
      (x: State) => withDay(x, generateDay(TUE, x.settings, x.programs, x.days[TUE], NOW)),
      (x: State) => opened(x, TUE),
    ])
      s = step(s);
    const moved = s.days[TUE].blocks.find((b) => b.movedFrom)!;
    expect(moved.bundledSteps ?? []).toEqual([]);
    expect(() => decodeState(s)).not.toThrow();
  });

  it('pausing a routine removes its planned moved-in workout and its marker', () => {
    const moved = shift(opened(trainingState(), MON), MON).next();
    const routine = moved.programs[0].routines[0];
    const paused = { ...routine, enabled: false };
    const programs = moved.programs.map((p) =>
      p.id === 'training'
        ? { ...p, routines: p.routines.map((r) => (r.id === 'upper' ? paused : r)) }
        : p,
    );
    const days = reconcileRoutineDays(moved.days, programs, paused, routine, NOW);
    expect(days[TUE].blocks.some((b) => b.routineId === 'upper')).toBe(false);
    expect(days[MON].moved).toBeUndefined();
  });

  it('a target day that exists but was never generated still counts its work hours', () => {
    const state = trainingState();
    state.programs[0].routines[0] = {
      ...state.programs[0].routines[0],
      checklist: false,
      fixed: true,
      preferredStart: 660,
    };
    // Opening Tuesday on Today creates the day with checklist items only.
    const s = opened(opened(state, MON), TUE);
    expect(s.days[TUE].commitmentsKey).toBeUndefined();
    const plan = planShift(s, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.slotConflicts.join(' ')).toMatch(/Work|Scrum/);
  });

  it('shifting again never rewrites a day that has passed', () => {
    const once = shift(opened(trainingState(), MON), MON).next();
    const mondayBefore = JSON.stringify(once.days[MON]);
    // A day later, Tuesday is today and Monday is history.
    const again = applyShift(
      once,
      planShift(once, { date: TUE, routineId: 'upper' }, 'forward', TUE),
      false,
      NOW,
      TUE,
    );
    expect(JSON.stringify(again.days[MON])).toBe(mondayBefore);
    expect(again.days[WED].blocks.find((b) => b.routineId === 'upper')!.movedFrom).toBe(MON);
    // Monday stays the original day, so the workout is still not regenerated there.
    expect(opened(again, MON).days[MON].blocks.some((b) => b.routineId === 'upper')).toBe(false);
  });
});

describe('timed workouts and saved shifts', () => {
  function timed(start: number, fixed: boolean): State {
    const state = trainingState();
    state.programs[0].routines[0] = {
      ...state.programs[0].routines[0],
      checklist: false,
      fixed,
      preferredStart: start,
    };
    return state;
  }

  it('a timed workout moved onto an unopened day keeps a free time and Generate day leaves work intact', () => {
    // 18:00 is clear of the synthetic 10:00–12:00 work block and scrum.
    const state = timed(1080, true);
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.conflicts).toEqual([]);
    expect(plan.slotConflicts).toEqual([]);
    let s = applyShift(state, plan, false, NOW, MON);
    s = withDay(s, generateDay(TUE, s.settings, s.programs, s.days[TUE], NOW));
    const tuesday = s.days[TUE].blocks;
    expect(tuesday.filter((b) => b.routineId === 'upper')).toEqual([
      expect.objectContaining({ start: 1080, movedFrom: MON }),
    ]);
    // Every work and meeting reservation still has its time.
    expect(
      tuesday.filter((b) => b.fixed && b.routineId === null).every((b) => b.start !== null),
    ).toBe(true);
  });

  it('refuses before any change when a fixed timed workout would land in work hours on an unopened day', () => {
    const state = timed(630, true);
    const snapshot = JSON.stringify(state);
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.slotConflicts.join(' ')).toMatch(/overlaps (Work|Scrum)/);
    expect(() => applyShift(state, plan, false, NOW, MON)).toThrow();
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('moves, returns, moves twice and stays consistent after a backup round trip each time', () => {
    let s = opened(trainingState(), MON);
    s = shift(s, MON).next();
    s = parseBackup(encodeBackup(s, NOW)).state;
    s = shift(s, TUE, 'upper', MON, 'restore').next();
    s = parseBackup(encodeBackup(s, NOW)).state;
    expect(placements(s, MON, SAT)).toEqual([
      `${MON} upper planned`,
      `${WED} lower planned`,
      `${FRI} upper planned`,
    ]);
    s = shift(shift(s, MON).next(), TUE).next();
    s = parseBackup(encodeBackup(s, NOW)).state;
    for (const date of [MON, TUE, WED, THU, FRI, SAT])
      s = withDay(
        opened(s, date),
        generateDay(date, s.settings, s.programs, opened(s, date).days[date], NOW),
      );
    const uppers = Object.values(s.days).flatMap((d) =>
      d.blocks.filter((b) => b.routineId === 'upper'),
    );
    expect(new Set(uppers.map((b) => b.id)).size).toBe(uppers.length);
  });

  it('a checklist workout with a stored start moves without that time and never asks for a choice', () => {
    // A checklist block carrying a 10:30 start, as a stored day can hold one; Tuesday's work hours
    // cover 10:30.
    let state = opened(trainingState(), MON);
    const id = `${MON}:routine:upper`;
    state = withDay(state, {
      ...state.days[MON],
      blocks: state.days[MON].blocks.map((b) =>
        b.id === id ? { ...b, start: 630, fixed: true } : b,
      ),
    });
    const plan = planShift(state, { date: MON, routineId: 'upper' }, 'forward', MON);
    expect(plan.conflicts).toEqual([]);
    expect(plan.slotConflicts).toEqual([]);
    expect(plan.moves[0]).toMatchObject({ to: TUE, start: null, note: null });
    const moved = applyShift(state, plan, false, NOW, MON).days[TUE].blocks.find(
      (b) => b.id === id,
    )!;
    expect(moved).toMatchObject({ checklist: true, start: null, reason: null, movedFrom: MON });
  });
});

describe('workouts that repeat every few weeks', () => {
  /** `routineId` every 2 weeks counted from the week of `anchor`. */
  function repeating(state: State, routineId: string, anchor: string): State {
    return {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === routineId ? { ...r, repeat: { everyWeeks: 2, anchor } } : r,
        ),
      })),
    };
  }

  it('has no occurrence in an off week, and a shift never moves one onto another day', () => {
    // Lower body every 2 weeks from 2026-11-02: this week (from MON) is an off week.
    const state = opened(repeating(trainingState(), 'lower', '2026-11-02'), MON);
    expect(placements(state, MON, '2026-11-22')).toEqual([
      `${MON} upper planned`,
      `${FRI} upper planned`,
      '2026-11-16 upper planned',
      '2026-11-18 lower planned',
      '2026-11-20 upper planned',
    ]);
    const { plan, next } = shift(state, MON);
    expect(plan.conflicts).toEqual([]);
    expect(plan.moves.map((m) => `${m.occurrence.date}→${m.to}`)).toEqual([
      `${MON}→${TUE}`,
      `${FRI}→${SAT}`,
    ]);
    const after = opened(next(), THU);
    expect(after.days[THU].blocks.some((b) => b.routineId === 'lower')).toBe(false);
    expect(after.days[WED]?.moved).toBeUndefined();
    expect(dayProgress(after.days[THU], after.programs, THU).total).toBe(0);
  });

  it('a fixed session in its off week does not take the time of a workout moving in', () => {
    // A fixed 6:00 PM Tuesday session every 2 weeks; a timed 6:00 PM workout moves onto Tuesday.
    const base = trainingState();
    base.programs[0].routines[0] = {
      ...base.programs[0].routines[0],
      checklist: false,
      preferredStart: 1080,
    };
    base.programs[1].routines.push({
      ...base.programs[1].routines[0],
      id: 'class',
      title: 'Evening class',
      weekdays: [2],
      checklist: false,
      fixed: true,
      preferredStart: 1080,
      duration: 60,
      private: false,
      capture: undefined,
    });
    const off = planShift(
      repeating(base, 'class', '2026-11-16'),
      { date: MON, routineId: 'upper' },
      'forward',
      MON,
    );
    expect(off.moves[0]).toEqual(expect.objectContaining({ to: TUE, start: 1080, note: null }));
    const on = planShift(
      repeating(base, 'class', MON),
      { date: MON, routineId: 'upper' },
      'forward',
      MON,
    );
    expect(on.moves[0]).toEqual(expect.objectContaining({ to: TUE, start: null }));
    expect(on.moves[0].note).toMatch(/overlaps Evening class/);
  });
});
