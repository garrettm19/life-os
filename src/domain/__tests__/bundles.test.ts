import { expect, test } from '@jest/globals';
import { decodeState } from '../data';
import { basicState } from '../../test-support/basic-state';
import { encodeBackup, parseBackup } from '../backup';
import { configuredOccurrences, coverageLine, programCoverage } from '../bundles';
import { shiftDate } from '../model';
import { editBlock, generateDay, replanDay, setBundledStatus, setStatus } from '../planner';

const monday = '2026-11-09';
const friday = '2026-11-13';
const now = new Date(2026, 10, 9, 18, 0).toISOString();
function fixture() {
  const state = basicState();
  const parent = state.programs[1];
  parent.routines[0].duration = 90;
  state.programs.push({
    id: 'accessory',
    title: 'Accessory program',
    group: 'Synthetic',
    goalIds: [],
    routines: [
      {
        ...parent.routines[0],
        id: 'accessory-1',
        title: 'Accessory practice',
        duration: null,
        weekdays: [1, 5],
        bundledInto: parent.id,
        steps: ['Example step'],
      },
    ],
  });
  return state;
}
test('two child occurrences share parent time and only independent completion counts', () => {
  const state = fixture();
  const days = [monday, friday].map((date) => generateDay(date, state.settings, state.programs));
  const parent = days[0].blocks.find((b) => b.programId === 'strength')!;
  const step = parent.bundledSteps![0];
  expect(parent.duration).toBe(90);
  expect(days.flatMap((d) => d.blocks).filter((b) => b.programId === 'accessory')).toHaveLength(0);
  expect(programCoverage('accessory', days)).toEqual({
    done: 0,
    planned: 2,
    missed: 0,
    skipped: 0,
  });
  // Once Monday has passed, its open step was not done; Friday's is still open.
  expect(programCoverage('accessory', days, '2026-11-10')).toEqual({
    done: 0,
    planned: 1,
    missed: 1,
    skipped: 0,
  });
  const parentDone = setStatus(days[0], parent.id, 'done', now);
  expect(programCoverage('accessory', [parentDone, days[1]]).done).toBe(0);
  const completed = setBundledStatus(parentDone, parent.id, step.id, 'done', now);
  expect(programCoverage('accessory', [completed, days[1]])).toEqual({
    done: 1,
    planned: 1,
    missed: 0,
    skipped: 0,
  });
  expect(configuredOccurrences(state.programs[4], state.programs)).toBe(2);
  expect(parent.bundledSteps![0].status).toBe('planned');
  // A child action changes only the new day: the previous day is untouched and no copy is saved.
  expect(parentDone.blocks.find((b) => b.id === parent.id)!.bundledSteps![0].status).toBe(
    'planned',
  );
  expect(completed.revisions).toHaveLength(parentDone.revisions.length);
  const skippedParent = setStatus(completed, parent.id, 'skipped', now);
  expect(programCoverage('accessory', [skippedParent]).done).toBe(1);
  const childUndone = setBundledStatus(skippedParent, parent.id, step.id, 'planned', now);
  expect(childUndone.blocks.find((b) => b.id === parent.id)!.bundledSteps![0].actualAt).toBeNull();
});
test('regeneration, stale time editing and replanning preserve actual child records and snapshots', () => {
  const state = fixture();
  const day = generateDay(monday, state.settings, state.programs);
  const parent = day.blocks.find((b) => b.programId === 'strength')!;
  const completed = setBundledStatus(day, parent.id, parent.bundledSteps![0].id, 'done', now);
  const edited = editBlock(completed, { ...parent, title: 'Renamed parent' }, state.settings, now);
  state.programs[4].routines[0].enabled = false;
  const again = generateDay(monday, state.settings, state.programs, edited, now);
  const replanned = replanDay(again, state.settings, 780, now);
  expect(replanned.blocks.find((b) => b.id === parent.id)!.start).toBe(parent.start);
  expect(programCoverage('accessory', [replanned]).done).toBe(1);
  expect(day.blocks.find((b) => b.id === parent.id)!.bundledSteps![0].status).toBe('planned');
  state.days[monday] = replanned;
  expect(parseBackup(encodeBackup(state, now)).state).toEqual(state);
});
test('unknown weekdays, unmatched days and multiple parent sessions do not invent child occurrences', () => {
  const state = fixture();
  const child = state.programs[4].routines[0];
  child.weekdays = null;
  let day = generateDay(monday, state.settings, state.programs);
  expect(day.blocks.flatMap((b) => b.bundledSteps ?? [])).toHaveLength(0);
  child.weekdays = [2];
  expect(configuredOccurrences(state.programs[4], state.programs)).toBe(0);
  child.weekdays = [1];
  state.programs[1].routines.push({ ...state.programs[1].routines[0], id: 'second-session' });
  day = generateDay(monday, state.settings, state.programs);
  const again = generateDay(monday, state.settings, state.programs, day, now);
  expect(again.blocks.flatMap((b) => b.bundledSteps ?? [])).toHaveLength(1);
  child.enabled = false;
  const disabled = generateDay(monday, state.settings, state.programs, again, now);
  expect(disabled.blocks.flatMap((b) => b.bundledSteps ?? [])).toHaveLength(0);
  expect(disabled.revisions.at(-1)!.blocks.flatMap((b) => b.bundledSteps ?? [])).toHaveLength(1);
});
test('legacy plans load without completion inference; malformed or duplicated child records reject', () => {
  const state = fixture();
  const day = generateDay(monday, state.settings, state.programs);
  const parent = day.blocks.find((b) => b.programId === 'strength')!;
  const child = parent.bundledSteps![0];
  delete parent.bundledSteps;
  parent.steps.push('Accessory practice: Example step');
  state.days[monday] = day;
  expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const upgraded = generateDay(monday, state.settings, state.programs, day, now);
  expect(upgraded.blocks.find((b) => b.id === parent.id)!.steps).not.toContain(
    'Accessory practice: Example step',
  );
  expect(programCoverage('accessory', [upgraded]).done).toBe(0);
  const oldDone = setStatus(day, parent.id, 'done', now);
  expect(
    programCoverage('accessory', [
      generateDay(monday, state.settings, state.programs, oldDone, now),
    ]).done,
  ).toBe(0);
  parent.bundledSteps = [{ ...child, status: 'done', actualAt: 'invalid' }];
  expect(() => decodeState(state)).toThrow(/timestamp/);
  parent.bundledSteps = [child, child];
  expect(() => decodeState(state)).toThrow(/Duplicate/);
  parent.bundledSteps = [child, { ...child, id: 'duplicate-under-a-different-id' }];
  expect(() => decodeState(state)).toThrow(/occurrence ID/);
  parent.bundledSteps = [child];
  day.blocks[0].bundledSteps = [child];
  expect(() => decodeState(state)).toThrow(/Duplicate/);
});
test('configured occurrences count a repeat, and the steps bundled into it, only in its repeat weeks', () => {
  const state = fixture();
  const [strength, accessory] = [state.programs[1], state.programs[4]];
  // Every 3 weeks from the week of 2026-11-16, so the week of 2026-11-09 is an off week.
  strength.routines[0].repeat = { everyWeeks: 3, anchor: '2026-11-16' };
  const weekOf = (start: string) => Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  const offWeek = weekOf(monday);
  const onWeek = weekOf('2026-11-16');
  expect(configuredOccurrences(strength, state.programs, onWeek)).toBe(3);
  expect(configuredOccurrences(strength, state.programs, offWeek)).toBe(0);
  expect(configuredOccurrences(accessory, state.programs, onWeek)).toBe(2);
  expect(configuredOccurrences(accessory, state.programs, offWeek)).toBe(0);
  // Without dates: the configured weekdays of one week, every repeat counted as due.
  expect(configuredOccurrences(strength, state.programs)).toBe(3);
  expect(configuredOccurrences(accessory, state.programs)).toBe(2);
  // The count follows what is generated: nothing on the off week's Monday.
  expect(
    generateDay(monday, state.settings, state.programs).blocks.some(
      (b) => b.programId === 'strength',
    ),
  ).toBe(false);
});

test('a program reads as one line: done against this week, then what is open and skipped', () => {
  expect(coverageLine({ done: 15, planned: 0, skipped: 1 }, 29, 29)).toBe(
    '15 of 29 done this week · 1 skipped',
  );
  expect(coverageLine({ done: 1, planned: 1, skipped: 0 }, 2, 2)).toBe(
    '1 of 2 done this week · 1 still open',
  );
  // An earlier day's open item was not done; only today and later are still open.
  expect(coverageLine({ done: 0, planned: 4, missed: 2, skipped: 0 }, 6, 6)).toBe(
    '0 of 6 done this week · 2 not done · 4 still open',
  );
  // A repeat in its off week, and a routine with no weekly count (a bundled step without a
  // matching parent day): no setup advice here.
  expect(coverageLine({ done: 0, planned: 0, skipped: 0 }, 0, 3)).toBe(
    '0 done this week · not due this week',
  );
  expect(coverageLine({ done: 2, planned: 0, skipped: 0 }, 0, 0)).toBe('2 done this week');
});

test('a companion counts toward the week on the days of the workouts it follows, never past done', () => {
  // Synthetic: a home program with a companion of a rotation workout (no weekdays of its own) and
  // a routine on Tuesdays and Fridays, in the week of Monday, October 19.
  const routine = basicState().programs[1].routines[0];
  const home = {
    id: 'home',
    title: 'Home training',
    group: 'Synthetic',
    goalIds: [],
    routines: [
      {
        ...routine,
        id: 'neck',
        title: 'Home neck',
        duration: null,
        checklist: true,
        weekdays: [],
        follows: ['chest'],
      },
      {
        ...routine,
        id: 'knees',
        title: 'Knees',
        duration: null,
        checklist: true,
        weekdays: [2, 5],
      },
    ],
  };
  const gym = {
    id: 'gym',
    title: 'Gym',
    group: 'Synthetic',
    goalIds: [],
    routines: [{ ...routine, id: 'chest', title: 'Chest', checklist: true, weekdays: [] }],
  };
  const programs = [gym, home];
  const week = Array.from({ length: 7 }, (_, i) => shiftDate('2026-10-19', i));
  // Chest was placed on Wednesday with its companion, and is projected onto Saturday.
  const held = (date: string) => ({
    placed: new Set(date === '2026-10-21' ? ['chest', 'neck'] : []),
    projected: new Set(date === '2026-10-24' ? ['chest'] : []),
  });
  const target = configuredOccurrences(home, programs, week, held);
  expect(target).toBe(4);
  // Three done (the companion twice, Knees once) is never more than the target.
  expect(coverageLine({ done: 3, planned: 0, missed: 1, skipped: 0 }, target, 4)).toBe(
    '3 of 4 done this week · 1 not done',
  );
  // A companion moved to another day counts there, where it is placed.
  const moved = (date: string) => ({
    placed: new Set(date === '2026-10-22' ? ['neck'] : date === '2026-10-21' ? ['chest'] : []),
    projected: new Set<string>(),
  });
  expect(configuredOccurrences(home, programs, week, moved)).toBe(3);
  // An ordinary week counts a companion on the weekdays of a weekday routine it follows.
  const weekly = [{ ...gym, routines: [{ ...gym.routines[0], weekdays: [1, 3] }] }, home];
  expect(configuredOccurrences(home, weekly)).toBe(4);
});
