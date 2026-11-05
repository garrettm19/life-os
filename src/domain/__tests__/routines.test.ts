import { expect, test } from '@jest/globals';
import { decodeState } from '../data';
import { Program, Routine, State, emptyState } from '../model';
import { editBlock, ensureChecklistDay, generateDay, setStatus } from '../planner';
import {
  LOCKED_OCCURRENCE_REASON,
  NO_DUE_DAYS,
  TIMED_PLACE_REASON,
  composeRoutine,
  routineSummary,
  upsertProgram,
  upsertRoutine,
} from '../routines';
import { dayClearStreak, dayOutcome, dayProgress } from '../objectives';
import { todayWidgetTimeline } from '../widget';

const monday = '2026-11-09';
const tuesday = '2026-11-10';
const now = new Date(2026, 10, 9, 16, 0).toISOString();
const settings = emptyState().settings;

function habit(extra: Partial<Routine> = {}): Routine {
  return {
    id: 'example-habit-1',
    title: 'Example everyday habit',
    duration: null,
    weekdays: [1],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    private: false,
    ...extra,
  };
}

function program(routines: Routine[], extra: Partial<Program> = {}): Program {
  return {
    id: 'example-habits',
    title: 'Example habits',
    group: 'Daily',
    goalIds: [],
    routines,
    ...extra,
  };
}

function timed(): Routine {
  return {
    id: 'example-timed-1',
    title: 'Example timed session',
    duration: 30,
    weekdays: [1],
    preferredStart: 720,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
  };
}

function stateWith(programs: Program[], days: State['days'] = {}): State {
  return { ...emptyState(), source: 'personal', programs, days };
}

test('creating an untimed checklist persists through reload and appears when due', () => {
  const empty = emptyState();
  const created = upsertRoutine(empty, program([]), habit({ weekdays: [0, 1, 2, 3, 4, 5, 6] }));
  expect(created.days).toBe(empty.days);
  const saved = decodeState(JSON.parse(JSON.stringify(created)));
  const routine = saved.programs[0].routines[0];
  expect(routine).toMatchObject({
    id: 'example-habit-1',
    title: 'Example everyday habit',
    checklist: true,
    duration: null,
    preferredStart: null,
    enabled: true,
  });
  expect(routineSummary(routine)).toBe('Checklist · Every day');
  const day = ensureChecklistDay(monday, settings, saved.programs);
  expect(day.blocks).toEqual([
    expect.objectContaining({
      id: `${monday}:routine:example-habit-1`,
      start: null,
      duration: null,
      checklist: true,
      reason: null,
    }),
  ]);
});

test('changing recurrence updates future dues without duplicating or rewriting history', () => {
  const first = ensureChecklistDay(monday, settings, [program([habit()])]);
  const done = setStatus(first, first.blocks[0].id, 'done', now);
  const state = stateWith([program([habit()])], { [monday]: done });
  const updated = upsertRoutine(
    state,
    program([habit()]),
    habit({ weekdays: [2], title: 'Example everyday habit' }),
  );
  expect(updated.programs[0].routines[0].id).toBe('example-habit-1');
  expect(updated.days).toBe(state.days);
  expect(updated.days[monday].blocks[0]).toMatchObject({ status: 'done', actualAt: now });
  const mondayAgain = ensureChecklistDay(monday, settings, updated.programs, updated.days[monday]);
  expect(mondayAgain.blocks.filter((block) => block.routineId === 'example-habit-1')).toEqual([
    expect.objectContaining({ status: 'done', actualAt: now }),
  ]);
  const next = ensureChecklistDay(tuesday, settings, updated.programs);
  expect(next.blocks.map((block) => block.id)).toEqual([`${tuesday}:routine:example-habit-1`]);
  const again = ensureChecklistDay(tuesday, settings, updated.programs, next, now);
  expect(again.blocks).toEqual(next.blocks);
});

test('pausing keeps completed history and editing private does not clear it', () => {
  const first = ensureChecklistDay(monday, settings, [program([habit({ private: true })])]);
  const done = setStatus(first, first.blocks[0].id, 'done', now);
  const state = stateWith([program([habit({ private: true })])], { [monday]: done });
  const paused = upsertRoutine(
    state,
    program([habit({ private: true })]),
    composeRoutine(habit({ private: true }), {
      title: 'Example private habit',
      duration: '',
      start: '',
      thursday: '',
      earliest: '',
      latest: '',
      weekdays: [1],
      enabled: false,
      fixed: false,
      steps: '',
      checklist: true,
      private: true,
    }),
  );
  expect(paused.programs[0].routines[0]).toMatchObject({
    id: 'example-habit-1',
    title: 'Example private habit',
    enabled: false,
    checklist: true,
    private: true,
  });
  expect(paused.days[monday].blocks[0].status).toBe('done');
  const afterPause = ensureChecklistDay(monday, settings, paused.programs, paused.days[monday]);
  expect(afterPause.blocks[0]).toMatchObject({ status: 'done', actualAt: now });
  const timeline = todayWidgetTimeline(
    {
      ...paused,
      days: {
        [monday]: {
          date: monday,
          blocks: [
            {
              ...paused.days[monday].blocks[0],
              start: 540,
              duration: 30,
              private: true,
            },
          ],
          revisions: [],
        },
      },
    },
    new Date(2026, 10, 9, 8, 0),
  );
  expect(JSON.stringify(timeline)).not.toContain('Example private habit');
});

test('checklist and timed conversion stays on the same id and leaves bundled steps independent', () => {
  const accessory: Routine = {
    id: 'example-part',
    title: 'Example part',
    duration: null,
    weekdays: [1],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: ['Example step'],
    bundledInto: 'example-session',
  };
  const session: Program = {
    id: 'example-session',
    title: 'Example session',
    group: 'Training',
    goalIds: [],
    routines: [timed(), accessory],
  };
  const generated = generateDay(monday, settings, [session]);
  const parent = generated.blocks.find((block) => block.routineId === 'example-timed-1')!;
  expect(parent.bundledSteps?.map((step) => step.title)).toEqual(['Example part']);
  const state = stateWith([session], { [monday]: generated });
  const asChecklist = upsertRoutine(
    state,
    session,
    composeRoutine(timed(), {
      title: 'Example timed session',
      duration: '',
      start: '',
      thursday: '',
      earliest: '',
      latest: '',
      weekdays: [1],
      enabled: true,
      fixed: false,
      steps: '',
      checklist: true,
      private: false,
    }),
    now,
  );
  expect(asChecklist.days).not.toBe(state.days);
  expect(
    asChecklist.days[monday].blocks.find((block) => block.routineId === 'example-timed-1'),
  ).toMatchObject({
    id: `${monday}:routine:example-timed-1`,
    start: null,
    checklist: true,
    reason: null,
  });
  expect(
    asChecklist.days[monday].blocks
      .find((block) => block.routineId === 'example-timed-1')
      ?.bundledSteps?.map((step) => step.title),
  ).toEqual(['Example part']);
  expect(asChecklist.programs[0].routines[0]).toMatchObject({
    id: 'example-timed-1',
    checklist: true,
    duration: null,
  });
  expect(asChecklist.programs[0].routines[1]).toEqual(accessory);
  const ensured = ensureChecklistDay('2026-11-16', settings, asChecklist.programs);
  expect(ensured.blocks.find((block) => block.routineId === 'example-timed-1')).toMatchObject({
    start: null,
    checklist: true,
    reason: null,
  });
  expect(ensured.blocks.some((block) => block.routineId === 'example-part')).toBe(false);
  const backToTimed = upsertRoutine(
    asChecklist,
    asChecklist.programs[0],
    composeRoutine(asChecklist.programs[0].routines[0], {
      title: 'Example timed session',
      duration: '30',
      start: '12:00',
      thursday: '',
      earliest: '',
      latest: '',
      weekdays: [1],
      enabled: true,
      fixed: false,
      steps: '',
      checklist: false,
      private: false,
    }),
  );
  const placed = generateDay(monday, settings, backToTimed.programs);
  expect(placed.blocks.find((block) => block.routineId === 'example-timed-1')).toMatchObject({
    start: 720,
    duration: 30,
  });
  expect(
    placed.blocks.find((block) => block.routineId === 'example-timed-1')!.checklist,
  ).toBeUndefined();
  expect(placed.blocks.filter((block) => block.routineId === 'example-timed-1')).toHaveLength(1);
});

test('composeRoutine writes checklist and private explicitly and timed validation still applies', () => {
  const edited = composeRoutine(habit({ private: true, checklist: true }), {
    title: 'Example everyday habit',
    duration: '20',
    start: '07:00',
    thursday: '',
    earliest: '',
    latest: '',
    weekdays: [1, 3],
    enabled: true,
    fixed: true,
    steps: '',
    checklist: false,
    private: true,
  });
  expect(edited).toMatchObject({
    id: 'example-habit-1',
    checklist: false,
    private: true,
    duration: 20,
    preferredStart: 420,
    fixed: true,
  });
  expect(() => upsertRoutine(emptyState(), program([]), { ...habit(), title: '' })).toThrow(/name/);
  expect(() => upsertRoutine(emptyState(), program([]), { ...timed(), duration: 0 })).toThrow(
    /Duration/,
  );
  expect(routineSummary(timed())).toBe('30 min · Mo');
  expect(routineSummary(habit({ weekdays: null }))).toBe('Checklist · weekdays needed');
  // A rotation workout has no weekdays of its own: the rotation places it.
  expect(routineSummary(habit({ weekdays: [] }), true)).toBe(
    'In the rotation · one per training day',
  );
  expect(routineSummary(habit({ weekdays: [] }))).toBe('Checklist · no days selected');
});

test('routine captions list days in week order, Monday first, and say Every day or Weekdays', () => {
  // Days are stored in the order they were tapped; the caption never follows that order.
  expect(routineSummary(habit({ weekdays: [5, 1] }))).toBe('Checklist · Mo, Fr');
  expect(
    routineSummary(habit({ weekdays: [6, 0], repeat: { everyWeeks: 2, anchor: monday } })),
  ).toBe('Checklist · Sa, Su, every 2 weeks');
  expect(routineSummary(habit({ weekdays: [0, 6, 5, 4, 3, 2, 1] }))).toBe('Checklist · Every day');
  expect(routineSummary(habit({ weekdays: [5, 4, 3, 2, 1] }))).toBe('Checklist · Weekdays');
  expect(routineSummary(habit({ weekdays: [1, 2, 3, 4, 5, 6] }))).toBe(
    'Checklist · Mo, Tu, We, Th, Fr, Sa',
  );
  // A kind label already says what the routine records, so "Checklist" is left out.
  expect(routineSummary(habit({ weekdays: [0], capture: 'weight' }), false, true)).toBe('Su');
  expect(routineSummary(timed(), false, true)).toBe('30 min · Mo');
});

test('upsertProgram creates an empty container without inventing a routine', () => {
  const empty = emptyState();
  const created = upsertProgram(empty, {
    ...program([]),
    title: 'Example container',
  });
  expect(created.programs).toEqual([
    expect.objectContaining({
      id: 'example-habits',
      title: 'Example container',
      routines: [],
    }),
  ]);
  expect(created.days).toBe(empty.days);
  expect(() => upsertProgram(emptyState(), { ...program([]), title: '  ' })).toThrow(/name/);
});

test('pending generated occurrences follow recurrence and kind; locked and completed stay', () => {
  const planned = ensureChecklistDay(monday, settings, [program([habit()])]);
  const emptyTuesday = { date: tuesday, blocks: [], revisions: [] };
  const state = stateWith([program([habit()])], { [monday]: planned, [tuesday]: emptyTuesday });
  const moved = upsertRoutine(state, program([habit()]), habit({ weekdays: [2] }), now);
  expect(moved.days[monday].blocks).toEqual([]);
  expect(moved.days[tuesday].blocks).toEqual([
    expect.objectContaining({
      id: `${tuesday}:routine:example-habit-1`,
      checklist: true,
      start: null,
    }),
  ]);
  const again = ensureChecklistDay(tuesday, settings, moved.programs, moved.days[tuesday]);
  expect(again.blocks).toEqual(moved.days[tuesday].blocks);

  const lockedDay = {
    ...planned,
    blocks: planned.blocks.map((block) => ({ ...block, fixed: true, start: 600, duration: 20 })),
  };
  const locked = upsertRoutine(
    stateWith([program([habit()])], { [monday]: lockedDay }),
    program([habit()]),
    habit({ weekdays: [2] }),
    now,
  );
  expect(locked.days[monday].blocks[0]).toMatchObject({
    status: 'planned',
    start: 600,
    fixed: true,
    reason: LOCKED_OCCURRENCE_REASON,
  });

  const generated = generateDay(monday, settings, [program([timed()])]);
  const converted = upsertRoutine(
    stateWith([program([timed()])], { [monday]: generated }),
    program([timed()]),
    { ...timed(), checklist: true, duration: null, preferredStart: null },
    now,
  );
  expect(
    converted.days[monday].blocks.filter((block) => block.routineId === 'example-timed-1'),
  ).toEqual([
    expect.objectContaining({
      id: `${monday}:routine:example-timed-1`,
      start: null,
      checklist: true,
    }),
  ]);
  const timedAgain = upsertRoutine(
    converted,
    converted.programs[0],
    { ...converted.programs[0].routines[0], checklist: false, duration: 30, preferredStart: 720 },
    now,
  );
  expect(
    timedAgain.days[monday].blocks.find((block) => block.routineId === 'example-timed-1'),
  ).toMatchObject({
    start: null,
    reason: TIMED_PLACE_REASON,
  });
  const generatedAgain = generateDay(
    monday,
    settings,
    timedAgain.programs,
    timedAgain.days[monday],
  );
  expect(
    generatedAgain.blocks.filter((block) => block.routineId === 'example-timed-1'),
  ).toHaveLength(1);
  expect(
    generatedAgain.blocks.find((block) => block.routineId === 'example-timed-1')!.checklist,
  ).toBeUndefined();
});

test('a manually moved start is preserved when the routine becomes a checklist', () => {
  const generated = generateDay(monday, settings, [program([timed()])]);
  const placed = generated.blocks.find((block) => block.routineId === 'example-timed-1')!;
  expect(placed.start).toBe(720);
  const moved = editBlock(generated, { ...placed, start: 800, fixed: false }, settings, now);
  expect(moved.blocks.find((block) => block.id === placed.id)).toMatchObject({
    start: 800,
    fixed: false,
  });
  const converted = upsertRoutine(
    stateWith([program([timed()])], { [monday]: moved }),
    program([timed()]),
    { ...timed(), checklist: true, duration: null, preferredStart: null },
    now,
  );
  expect(
    converted.days[monday].blocks.filter((block) => block.routineId === 'example-timed-1'),
  ).toEqual([
    expect.objectContaining({
      id: placed.id,
      start: 800,
      fixed: false,
      reason: LOCKED_OCCURRENCE_REASON,
    }),
  ]);
  expect(
    converted.days[monday].blocks.find((block) => block.routineId === 'example-timed-1')!.checklist,
  ).toBeUndefined();
  const ensured = ensureChecklistDay(monday, settings, converted.programs, converted.days[monday]);
  expect(ensured.blocks.filter((block) => block.routineId === 'example-timed-1')).toHaveLength(1);
  expect(ensured.blocks.find((block) => block.id === placed.id)!.start).toBe(800);
});

const sunday = '2026-11-08';
const wednesday = '2026-11-11';
const nextMonday = '2026-11-16';
const tuesdayNow = new Date(2026, 10, 10, 16, 0).toISOString();
const thursdayNow = new Date(2026, 10, 12, 16, 0).toISOString();
const nextWednesday = '2026-11-18';
const everyDay = [0, 1, 2, 3, 4, 5, 6];

function finished(date: string, programs: Program[]) {
  const day = ensureChecklistDay(date, settings, programs, undefined, now);
  return day.blocks.reduce((next, block) => setStatus(next, block.id, 'done', now), day);
}

test('creating a habit leaves past recorded days and the personal best unchanged', () => {
  const first = program([habit({ weekdays: everyDay })]);
  const state = stateWith([first], {
    [sunday]: finished(sunday, [first]),
    [monday]: finished(monday, [first]),
    [tuesday]: { date: tuesday, blocks: [], revisions: [] },
    [wednesday]: ensureChecklistDay(wednesday, settings, [first], undefined, now),
  });
  expect(dayClearStreak(state, monday, tuesday)).toEqual({ current: 2, best: 2 });
  const second = habit({
    id: 'example-habit-2',
    title: 'Example second habit',
    weekdays: everyDay,
  });
  const created = upsertRoutine(state, first, second, tuesdayNow);
  expect(created.days[sunday]).toBe(state.days[sunday]);
  expect(created.days[monday]).toBe(state.days[monday]);
  expect(created.days[tuesday].blocks.map((block) => block.routineId)).toEqual(['example-habit-2']);
  const again = upsertRoutine(created, created.programs[0], second, tuesdayNow);
  expect(
    again.days[wednesday].blocks.filter((block) => block.routineId === 'example-habit-2'),
  ).toHaveLength(1);
  expect(dayClearStreak(created, tuesday, tuesday)).toEqual({ current: 2, best: 2 });
});

test('pausing a missed habit does not heal the past miss', () => {
  const both = program([
    habit({ weekdays: everyDay }),
    habit({ id: 'example-habit-2', title: 'Example second habit', weekdays: everyDay }),
  ]);
  const missed = setStatus(
    ensureChecklistDay(monday, settings, [both], undefined, now),
    `${monday}:routine:example-habit-1`,
    'done',
    now,
  );
  const state = stateWith([both], {
    [sunday]: finished(sunday, [both]),
    [monday]: missed,
    [tuesday]: ensureChecklistDay(tuesday, settings, [both], undefined, now),
  });
  const paused = upsertRoutine(state, both, { ...both.routines[1], enabled: false }, tuesdayNow);
  expect(paused.days[monday]).toBe(missed);
  expect(dayOutcome(paused, monday)).toBe('open');
  expect(dayClearStreak(paused, tuesday, tuesday)).toEqual({ current: 0, best: 1 });
  expect(paused.days[tuesday].blocks.map((block) => block.routineId)).toEqual(['example-habit-1']);
});

test('rescheduling and kind conversion leave past days alone and still update later dues', () => {
  const plan = program([habit(), timed()]);
  const state = stateWith([plan], {
    [monday]: generateDay(monday, settings, [plan], undefined, now),
    [nextMonday]: generateDay(nextMonday, settings, [plan], undefined, now),
  });
  const moved = upsertRoutine(state, plan, habit({ weekdays: [2] }), tuesdayNow);
  expect(moved.days[monday]).toBe(state.days[monday]);
  expect(moved.days[nextMonday].blocks.some((block) => block.routineId === 'example-habit-1')).toBe(
    false,
  );
  const converted = upsertRoutine(
    moved,
    moved.programs[0],
    { ...timed(), checklist: true, duration: null, preferredStart: null },
    tuesdayNow,
  );
  expect(converted.days[monday]).toBe(state.days[monday]);
  expect(
    converted.days[nextMonday].blocks.find((block) => block.routineId === 'example-timed-1'),
  ).toMatchObject({ start: null, checklist: true });
});

test('a future day recorded in advance follows timed edits made before the date arrives', () => {
  const run: Routine = { ...timed(), id: 'example-run', title: 'Example run', weekdays: [3] };
  const plan = program([run]);
  const past = ensureChecklistDay(wednesday, settings, [plan], undefined, now);
  const future = ensureChecklistDay(nextWednesday, settings, [plan], undefined, now);
  expect(future.dueTimed).toEqual(['example-run']);
  const state = stateWith([plan], { [wednesday]: past, [nextWednesday]: future });
  const later = '2026-11-20';
  for (const edit of [
    { ...run, enabled: false },
    { ...run, weekdays: [2] },
    { ...run, checklist: true, duration: null, preferredStart: null },
  ]) {
    // Edited on Thursday the 12th: last Wednesday is history, next Wednesday is still ahead.
    const edited = upsertRoutine(state, plan, edit, thursdayNow);
    expect(edited.days[wednesday]).toBe(past);
    expect(edited.days[nextWednesday].dueTimed).toBeUndefined();
    expect(
      dayProgress(edited.days[nextWednesday], edited.programs, nextWednesday).missingTimed,
    ).toBe(0);
    const again = upsertRoutine(edited, edited.programs[0], edit, thursdayNow);
    expect(again.days).toBe(edited.days);
  }
  // Paused or moved away: the passed date is neutral, not a false miss.
  const paused = upsertRoutine(state, plan, { ...run, enabled: false }, thursdayNow);
  expect(dayOutcome(paused, nextWednesday)).toBe('empty');
  expect(dayOutcome(paused, wednesday)).toBe('open');
  expect(dayClearStreak(paused, later, later)).toEqual({ current: 0, best: 0 });
  // Converted: one checklist occurrence, no invented timed block, no stale timed obligation.
  const converted = upsertRoutine(
    state,
    plan,
    { ...run, checklist: true, duration: null, preferredStart: null },
    thursdayNow,
  );
  expect(
    converted.days[nextWednesday].blocks.filter((block) => block.routineId === 'example-run'),
  ).toEqual([expect.objectContaining({ checklist: true, start: null, status: 'planned' })]);
  // A routine newly due on a stored future day is recorded without inventing a timed block.
  const swim: Routine = { ...run, id: 'example-swim', title: 'Example swim' };
  const added = upsertRoutine(state, plan, swim, thursdayNow);
  expect(added.days[nextWednesday].dueTimed).toEqual(['example-run', 'example-swim']);
  expect(added.days[nextWednesday].blocks).toEqual([]);
  expect(added.days[wednesday]).toBe(past);
});

test('a new enabled checklist habit needs a due day; existing and imported routines are left alone', () => {
  const empty = stateWith([]);
  for (const weekdays of [null, []])
    expect(() => upsertRoutine(empty, program([]), habit({ weekdays }))).toThrow(NO_DUE_DAYS);
  const paused = upsertRoutine(empty, program([]), habit({ weekdays: null, enabled: false }));
  expect(paused.programs[0].routines[0]).toMatchObject({ enabled: false, weekdays: null });
  const timedUnset = upsertRoutine(empty, program([]), { ...timed(), weekdays: null });
  expect(timedUnset.programs[0].routines[0].weekdays).toBeNull();
  const created = upsertRoutine(empty, program([]), habit({ weekdays: [1, 3] }));
  expect(decodeState(JSON.parse(JSON.stringify(created))).programs[0].routines[0].weekdays).toEqual(
    [1, 3],
  );
  // An imported enabled habit without days stays valid and can still be renamed in place.
  const imported = decodeState(stateWith([program([habit({ weekdays: null })])]));
  const renamed = upsertRoutine(
    imported,
    imported.programs[0],
    habit({ weekdays: null, title: 'Example renamed habit' }),
    now,
  );
  expect(renamed.programs[0].routines[0]).toMatchObject({
    title: 'Example renamed habit',
    weekdays: null,
  });
});

test('a checklist item that becomes timed never keeps a stored start as its placement', () => {
  const day = ensureChecklistDay(monday, settings, [program([habit()])]);
  // A day saved by an earlier build can hold a checklist item with a start.
  day.blocks = day.blocks.map((block) => ({ ...block, start: 600, duration: 15 }));
  const state = stateWith([program([habit()])], { [monday]: day });
  const next = upsertRoutine(
    state,
    state.programs[0],
    composeRoutine(habit(), {
      title: 'Example everyday habit',
      duration: '15',
      start: '',
      thursday: '',
      earliest: '',
      latest: '',
      weekdays: [1],
      enabled: true,
      fixed: false,
      steps: '',
      checklist: false,
      private: false,
    }),
    now,
  );
  const block = next.days[monday].blocks.find((b) => b.routineId === 'example-habit-1')!;
  expect(block.checklist).toBeUndefined();
  expect(block.start).toBeNull();
  expect(block.reason).toBe(TIMED_PLACE_REASON);
});
