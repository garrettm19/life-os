import { describe, expect, test } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState } from '../data';
import { emptyState, shiftDate, type Day, type Program, type Routine, type State } from '../model';
import { dayClearStreak, dayOutcome } from '../objectives';
import {
  editBlock,
  ensureChecklistDay,
  generateDay,
  replanDay,
  setBundledStatus,
  setStatus,
} from '../planner';
import { LOCKED_OCCURRENCE_REASON, upsertRoutine } from '../routines';

// Retention: actual history is kept, but Done, Skip and Undo save no full-day copy. Revisions
// record plan changes; existing revisions are never pruned or rewritten.
const settings = emptyState().settings;
const monday = '2026-11-09';
const at = (hour: number, date = monday) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const routine = (id: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title: `Example ${id}`,
  duration: 30,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  preferredStart: 600,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  ...extra,
});
const program = (routines: Routine[], id = 'example-program'): Program => ({
  id,
  title: 'Example program',
  group: 'Daily',
  goalIds: [],
  routines,
});

describe('status actions keep actual history without full-day copies', () => {
  test('Done, Skip and Undo update status and actual time in place', () => {
    const programs = [program([routine('a'), routine('b', { preferredStart: 720 })])];
    const day = generateDay(monday, settings, programs);
    const [a, b] = day.blocks.map((block) => block.id);
    const done = setStatus(day, a, 'done', at(10));
    expect(done.revisions).toEqual(day.revisions);
    expect(done.blocks.find((x) => x.id === a)).toMatchObject({
      status: 'done',
      actualAt: at(10),
    });
    expect(day.blocks.find((x) => x.id === a)).toMatchObject({ status: 'planned', actualAt: null });
    const skipped = setStatus(done, b, 'skipped', at(12));
    expect(skipped.blocks.find((x) => x.id === b)).toMatchObject({
      status: 'skipped',
      actualAt: at(12),
    });
    const undone = setStatus(skipped, a, 'planned', at(13));
    expect(undone.blocks.find((x) => x.id === a)).toMatchObject({
      status: 'planned',
      actualAt: null,
    });
    expect(undone.blocks.find((x) => x.id === b)!.status).toBe('skipped');
    expect(undone.revisions).toEqual(day.revisions);
  });

  test('bundled steps stay independent of the parent and save no copy', () => {
    const accessory = routine('part', { bundledInto: 'example-session', duration: null });
    const programs = [program([routine('session')], 'example-session'), program([accessory])];
    const day = generateDay(monday, settings, programs);
    const parent = day.blocks.find((block) => block.routineId === 'session')!;
    const step = parent.bundledSteps![0];
    const stepDone = setBundledStatus(day, parent.id, step.id, 'done', at(10));
    const parentSkipped = setStatus(stepDone, parent.id, 'skipped', at(11));
    const after = parentSkipped.blocks.find((block) => block.id === parent.id)!;
    expect(after.status).toBe('skipped');
    expect(after.bundledSteps![0]).toMatchObject({ status: 'done', actualAt: at(10) });
    expect(parentSkipped.revisions).toEqual(day.revisions);
  });

  test('replanning after status changes keeps completed work and records the plan change', () => {
    const programs = [program([routine('a'), routine('b', { preferredStart: 900 })])];
    const day = generateDay(monday, settings, programs);
    const done = setStatus(day, day.blocks[0].id, 'done', at(10));
    const replanned = replanDay(done, settings, 660, at(11));
    expect(replanned.blocks.find((b) => b.id === day.blocks[0].id)).toMatchObject({
      status: 'done',
      start: 600,
    });
    expect(replanned.revisions.at(-1)!.reason).toBe('Replan future flexible blocks');
    expect(replanned.revisions.at(-1)!.blocks.find((b) => b.id === day.blocks[0].id)!.status).toBe(
      'done',
    );
  });

  test('a manual move is still protected after a later Done and a routine edit', () => {
    const programs = [program([routine('moved'), routine('other', { preferredStart: 900 })])];
    const day = generateDay(monday, settings, programs);
    const moved = day.blocks.find((block) => block.routineId === 'moved')!;
    const other = day.blocks.find((block) => block.routineId === 'other')!;
    const edited = editBlock(day, { ...moved, start: 780 }, settings, at(9));
    const later = setStatus(edited, other.id, 'done', at(10));
    const state: State = {
      ...emptyState(),
      source: 'personal',
      programs,
      days: { [monday]: later },
    };
    const converted = upsertRoutine(
      state,
      programs[0],
      { ...programs[0].routines[0], checklist: true, duration: null, preferredStart: null },
      at(11),
    );
    expect(converted.days[monday].blocks.find((block) => block.id === moved.id)).toMatchObject({
      start: 780,
      reason: LOCKED_OCCURRENCE_REASON,
    });
  });
});

test('a manual move survives Done, a replan that leaves it, Undo, regeneration and a routine edit', () => {
  const programs = [program([routine('moved'), routine('other', { preferredStart: 900 })])];
  const day = generateDay(monday, settings, programs);
  const moved = day.blocks.find((block) => block.routineId === 'moved')!;
  const other = day.blocks.find((block) => block.routineId === 'other')!;
  let next = editBlock(day, { ...moved, start: 780 }, settings, at(9));
  next = setStatus(next, other.id, 'done', at(10));
  // Replanning from 14:00 leaves the 13:00 block where the user put it.
  next = replanDay(next, settings, 840, at(11));
  next = setStatus(next, other.id, 'planned', at(12));
  next = generateDay(monday, settings, programs, next, at(13));
  expect(next.blocks.find((block) => block.id === moved.id)!.start).toBe(780);
  const state: State = { ...emptyState(), source: 'personal', programs, days: { [monday]: next } };
  const converted = upsertRoutine(
    state,
    programs[0],
    { ...programs[0].routines[0], checklist: true, duration: null, preferredStart: null },
    at(14),
  );
  expect(converted.days[monday].blocks.find((block) => block.id === moved.id)).toMatchObject({
    start: 780,
    reason: LOCKED_OCCURRENCE_REASON,
  });
});

describe('existing history keeps its copies and its outcomes', () => {
  // A day saved by earlier builds: one full-day copy per Done.
  const legacyDay = (): { day: Day; programs: Program[] } => {
    const programs = [
      program([routine('a', { checklist: true, duration: null, preferredStart: null })]),
    ];
    const opened = ensureChecklistDay(monday, settings, programs, undefined, at(8));
    const block = { ...opened.blocks[0], status: 'done' as const, actualAt: at(10) };
    return {
      programs,
      day: {
        ...opened,
        blocks: [block],
        revisions: [
          ...opened.revisions,
          { at: at(10), reason: 'Mark done', blocks: opened.blocks },
        ],
      },
    };
  };

  test('legacy status copies decode, round-trip through a backup, and stay untouched by new actions', () => {
    const { day, programs } = legacyDay();
    const state: State = {
      ...emptyState(),
      source: 'personal',
      programs,
      days: { [monday]: day },
    };
    const decoded = decodeState(JSON.parse(JSON.stringify(state)));
    expect(decoded).toEqual(state);
    expect(parseBackup(encodeBackup(state, at(12))).state).toEqual(state);
    const undone = setStatus(day, day.blocks[0].id, 'planned', at(13));
    expect(undone.revisions).toEqual(day.revisions);
  });

  test('Day Cleared and the personal best read the same with or without legacy copies', () => {
    const { day, programs } = legacyDay();
    const withCopies: State = {
      ...emptyState(),
      source: 'personal',
      programs,
      days: { [monday]: day },
    };
    const withoutCopies: State = {
      ...withCopies,
      days: { [monday]: { ...day, revisions: [] } },
    };
    for (const state of [withCopies, withoutCopies]) {
      expect(dayOutcome(state, monday)).toBe('cleared');
      expect(dayClearStreak(state, shiftDate(monday, 1), shiftDate(monday, 1))).toEqual({
        current: 1,
        best: 1,
      });
    }
  });
});

test('three years of daily use stay well inside the backup limit and restore exactly', () => {
  const habits = Array.from({ length: 8 }, (_, i) =>
    routine(`h${i}`, {
      checklist: true,
      duration: null,
      preferredStart: null,
      steps: ['Example step one', 'Example step two'],
    }),
  );
  const programs = [
    program(habits, 'daily'),
    program([routine('session', { duration: 60, weekdays: [1, 3, 5] })], 'training'),
  ];
  const state: State = { ...emptyState(), source: 'personal', programs, days: {} };
  let date = '2024-01-01';
  for (let i = 0; i < 3 * 365; i++) {
    let day = ensureChecklistDay(date, settings, programs, undefined, at(7, date));
    if (i % 2 === 0) day = generateDay(date, settings, programs, day, at(7, date));
    day = day.blocks.reduce((d, b) => setStatus(d, b.id, 'done', at(9, date)), day);
    // One Undo and redo each day, as real use does.
    const first = day.blocks[0].id;
    day = setStatus(setStatus(day, first, 'planned', at(10, date)), first, 'done', at(10, date));
    state.days[date] = day;
    date = shiftDate(date, 1);
  }
  const raw = encodeBackup(state, at(12));
  // Measured at about 4.2 MB, well under the 20 MB backup limit.
  expect(raw.length).toBeLessThan(8_000_000);
  expect(parseBackup(raw).state).toEqual(state);
});
