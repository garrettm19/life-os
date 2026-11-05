import { test, expect } from '@jest/globals';
import {
  Block,
  Day,
  Program,
  defaultSettings,
  emptyState,
  localDate,
  parseTime,
  shiftDate,
} from '../model';
import { configuredOccurrences } from '../bundles';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, parseSetup, withDay } from '../data';
import { basicState } from '../../test-support/basic-state';
import {
  editBlock,
  findSlot,
  checklistNeedsEnsure,
  ensureChecklistDay,
  generateDay,
  makeBlock,
  occupied,
  overlaps,
  replanDay,
  setStatus,
} from '../planner';

const monday = '2026-11-09',
  thursday = '2026-11-12';
const settings = {
  ...defaultSettings,
  workStart: 600,
  workEnd: 720,
  scrumStart: 660,
  scrumDuration: 15,
  thursdayMeetingStart: 780,
  thursdayMeetingDuration: 45,
  gymTravel: 20,
};
const program = (overrides: Partial<Program['routines'][number]> = {}): Program => ({
  id: 'gym',
  title: 'Strength',
  group: 'Training',
  goalIds: [],
  routines: [
    {
      id: 'session',
      title: 'Strength',
      duration: 60,
      weekdays: [0, 1, 2, 3, 4, 5],
      preferredStart: 720,
      thursdayStart: 840,
      enabled: true,
      fixed: false,
      steps: [],
      bundledInto: null,
      ...overrides,
    },
  ],
});
test('work is split around scrum without counting time twice', () => {
  const day = generateDay(monday, settings, []);
  const scheduled = day.blocks.filter(occupied);
  expect(scheduled.reduce((sum, b) => sum + b.duration!, 0)).toBe(120);
  for (const a of scheduled)
    for (const b of scheduled) if (a.id !== b.id) expect(overlaps(a, b)).toBe(false);
});
test('Saturday rest, travel and Thursday override are respected', () => {
  expect(
    generateDay('2026-11-14', settings, [program()]).blocks.some((b) => b.routineId === 'session'),
  ).toBe(false);
  const b = generateDay(thursday, settings, [program()]).blocks.find(
    (b) => b.routineId === 'session',
  )!;
  expect(b.start).toBe(840);
  expect(b.duration).toBe(80);
});
test('unknown meeting lengths and travel remain visible rather than guessed', () => {
  const day = generateDay(monday, { ...settings, scrumDuration: null }, [program()]);
  expect(day.blocks.find((b) => b.routineId === 'session')!.start).toBeNull();
  expect(day.blocks.find((b) => b.id.endsWith(':scrum'))!.duration).toBeNull();
  expect(() => replanDay(day, settings, 720)).toThrow();
  expect(
    generateDay(monday, { ...settings, gymTravel: null }, [program()]).blocks.find(
      (b) => b.routineId === 'session',
    )!.reason,
  ).toMatch(/travel/);
});
test('generation repairs configured overflow and never duplicates a completion', () => {
  const initial = generateDay(monday, { ...settings, scrumDuration: null }, [program()]);
  const repaired = generateDay(monday, settings, [program()], initial);
  expect(repaired.blocks.find((b) => b.routineId === 'session')!.start).toBe(720);
  const completed = setStatus(
    repaired,
    `${monday}:routine:session`,
    'done',
    '2026-11-09T18:00:00Z',
  );
  const again = generateDay(monday, settings, [program()], completed);
  expect(again.blocks.filter((b) => b.routineId === 'session')).toHaveLength(1);
  expect(again.blocks.find((b) => b.routineId === 'session')!.actualAt).toBe(
    '2026-11-09T18:00:00Z',
  );
  expect(initial.blocks.find((b) => b.routineId === 'session')!.start).toBeNull();
});
test('fixed routines are placed before flexible routines', () => {
  const flexible = program({ id: 'flex', preferredStart: 720 });
  flexible.id = 'other';
  const fixed = program({ id: 'fixed', preferredStart: 720, fixed: true });
  fixed.id = 'another';
  const day = generateDay(monday, settings, [flexible, fixed]);
  expect(day.blocks.find((b) => b.routineId === 'fixed')!.start).toBe(720);
  expect(day.blocks.find((b) => b.routineId === 'flex')!.start).toBe(780);
});
test('bundled routines appear as gym details and do not consume time twice', () => {
  const child = program({
    id: 'child',
    title: 'Accessory practice',
    bundledInto: 'gym',
    weekdays: [1],
    duration: 10,
  });
  child.id = 'accessory';
  const day = generateDay(monday, settings, [program(), child]);
  expect(day.blocks.filter((b) => b.routineId === 'child')).toHaveLength(0);
  expect(day.blocks.find((b) => b.routineId === 'session')!.bundledSteps?.[0].title).toBe(
    'Accessory practice',
  );
  expect(day.blocks.find((b) => b.routineId === 'session')!.duration).toBe(80);
});
test('replanning preserves fixed, completed, and already-started blocks, with overflow', () => {
  const fixed = makeBlock('fixed', 'Appointment', 900, 60, true),
    done = {
      ...makeBlock('done', 'Finished', 720, 60),
      status: 'done' as const,
      actualAt: '2026-11-09T18:00:00Z',
    },
    running = makeBlock('running', 'In progress', 800, 60),
    future = makeBlock('future', 'Next', 870, 60),
    large = makeBlock('large', 'Too large', 1000, 600);
  const day = {
    date: monday,
    blocks: [fixed, done, running, future, large],
    revisions: [],
  };
  const revised = replanDay(day, { ...settings, bedtime: 1080 }, 820);
  for (const id of ['fixed', 'done', 'running'])
    expect(revised.blocks.find((b) => b.id === id)).toEqual(day.blocks.find((b) => b.id === id));
  expect(revised.blocks.find((b) => b.id === 'future')!.start).toBe(960);
  expect(revised.blocks.find((b) => b.id === 'large')!.start).toBeNull();
  expect(revised.revisions[0].blocks).toEqual(day.blocks);
});
test('manual edits reject overlap, negative durations and bedtime overruns', () => {
  const day = {
    date: monday,
    blocks: [makeBlock('a', 'Existing', 900, 60)],
    revisions: [],
  };
  expect(() => editBlock(day, makeBlock('b', 'Conflict', 930, 30), settings)).toThrow(/overlaps/);
  expect(() => editBlock(day, makeBlock('b', 'Invalid', 960, -1), settings)).toThrow();
  expect(() => editBlock(day, makeBlock('b', 'Late', 1370, 30), settings)).toThrow();
});
test('a routine occurrence missing from the day is refused, never added as a second copy', () => {
  const day = { date: '2026-11-10', blocks: [], revisions: [] };
  const yesterdays = {
    ...makeBlock('2026-11-09:routine:job-search', 'Job search: two applications', null, 30),
    routineId: 'job-search',
  };
  expect(() => editBlock(day, yesterdays, settings)).toThrow('This block no longer exists.');
});
test('restoring a skipped block cannot create overlap with a new block', () => {
  const skipped = {
    ...makeBlock('a', 'Old', 900, 60),
    status: 'skipped' as const,
  };
  const day = {
    date: monday,
    blocks: [skipped, makeBlock('b', 'New', 900, 60)],
    revisions: [],
  };
  expect(() => setStatus(day, 'a', 'planned')).toThrow(/occupied/);
});
test('slot search maintains non-overlap across varied schedules and capacities', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const placed: Block[] = [makeBlock('meeting', 'Reserved', 750, 45, true)];
    for (let n = 1; n <= 15; n++) {
      const duration = 10 + ((seed * 17 + n * 13) % 80),
        start = findSlot(placed, duration, 540, 1320);
      if (start !== null) {
        const b = makeBlock(String(n), 'Task', start, duration);
        expect(placed.some((x) => overlaps(x, b))).toBe(false);
        expect(start + duration).toBeLessThanOrEqual(1320);
        placed.push(b);
      }
    }
  }
});
test('calendar dates are local and shift safely through DST and year boundaries', () => {
  expect(shiftDate('2026-11-01', 1)).toBe('2026-11-02');
  expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  expect(localDate(new Date(2026, 9, 4, 23))).toBe('2026-10-04');
  expect(parseTime('24:00', true)).toBe(1440);
  expect(() => parseTime('24:01', true)).toThrow();
});
test('imports preserve personal history, replace fictional demo data, and reject corrupt input', () => {
  const personal = emptyState();
  personal.source = 'personal';
  personal.days[monday] = {
    date: monday,
    blocks: [makeBlock('saved', 'Saved', 900, 30)],
    revisions: [],
  };
  const incoming = basicState(),
    raw = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: incoming.goals,
      programs: incoming.programs,
      settings: incoming.settings,
      notes: [],
    });
  expect(parseSetup(raw, personal).days[monday].blocks[0].id).toBe('saved');
  const demo = basicState();
  demo.days[monday] = personal.days[monday];
  expect(Object.keys(parseSetup(raw, demo).days)).toHaveLength(0);
  expect(() => parseSetup('{"format":"wrong"}', personal)).toThrow();
  expect(() =>
    decodeState({
      ...incoming,
      programs: [...incoming.programs, incoming.programs[0]],
    }),
  ).toThrow(/Duplicate/);
  expect(() =>
    decodeState({
      ...incoming,
      settings: { ...incoming.settings, wake: '09:00' },
    }),
  ).toThrow();
});

test('morning routines overflow rather than migrate outside their time window', () => {
  const s = basicState();
  const r = s.programs[0].routines[0];
  r.windowStart = 540;
  r.windowEnd = 600;
  r.duration = 70;
  const day = generateDay(monday, s.settings, [s.programs[0]]);
  expect(day.blocks.find((b) => b.routineId === r.id)!.start).toBeNull();
});
test('checklist routines are due without a time, survive regeneration, and stay off the clock', () => {
  const routine = (
    id: string,
    title: string,
    extra: Partial<Program['routines'][number]> = {},
  ): Program['routines'][number] => ({
    id,
    title,
    duration: 40,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  });
  const daily: Program = {
    id: 'example-daily',
    title: 'Example daily',
    group: 'Daily',
    goalIds: [],
    routines: [
      routine('example-check', 'Example check', { duration: null, steps: ['30–60 minutes'] }),
      routine('example-paused', 'Example paused', { enabled: false, weekdays: null }),
    ],
  };
  const weekday: Program = {
    id: 'example-weekday',
    title: 'Example weekday',
    group: 'Private',
    goalIds: [],
    routines: [
      routine('example-weekday-1', 'Example weekday practice', {
        weekdays: [1, 4, 6],
        private: true,
      }),
    ],
  };
  const training: Program = {
    id: 'example-session',
    title: 'Example session',
    group: 'Training',
    goalIds: [],
    routines: [
      routine('example-session-1', 'Example session', { weekdays: [1], duration: null }),
      routine('example-part', 'Example part', {
        weekdays: [1],
        duration: null,
        bundledInto: 'example-session',
      }),
    ],
  };
  const programs = [daily, weekday, training];
  const first = generateDay(monday, settings, programs);
  const check = first.blocks.find((b) => b.routineId === 'example-check')!;
  expect(check).toMatchObject({ start: null, reason: null, checklist: true, duration: null });
  expect(first.blocks.some((b) => b.routineId === 'example-paused')).toBe(false);
  expect(first.blocks.find((b) => b.routineId === 'example-weekday-1')).toMatchObject({
    private: true,
    start: null,
  });
  expect(
    first.blocks
      .find((b) => b.routineId === 'example-session-1')!
      .bundledSteps?.map((s) => s.title),
  ).toEqual(['Example part']);
  const done = setStatus(first, check.id, 'done', new Date(2026, 10, 9, 16, 0).toISOString());
  const again = generateDay(
    monday,
    settings,
    programs,
    done,
    new Date(2026, 10, 9, 17, 0).toISOString(),
  );
  expect(again.blocks.filter((b) => b.routineId === 'example-check')).toEqual([
    expect.objectContaining({ status: 'done' }),
  ]);
  const tuesday = generateDay('2026-11-10', settings, programs);
  expect(tuesday.blocks.some((b) => b.routineId === 'example-weekday-1')).toBe(false);
  expect(tuesday.blocks.some((b) => b.routineId === 'example-check')).toBe(true);
  expect(replanDay(first, settings, 0).blocks.find((b) => b.id === check.id)!.start).toBeNull();
  expect(configuredOccurrences(daily, programs)).toBe(7);
  const saved = decodeState(
    JSON.parse(
      JSON.stringify({
        ...emptyState(),
        source: 'personal',
        programs,
        settings,
        days: { [monday]: first },
      }),
    ),
  );
  expect(saved.days[monday].blocks.find((b) => b.routineId === 'example-check')!.checklist).toBe(
    true,
  );
  expect(saved.programs[1].routines[0].private).toBe(true);
  const paused = generateDay(
    monday,
    settings,
    [{ ...weekday, routines: [{ ...weekday.routines[0], enabled: false }] }],
    first,
  );
  expect(
    paused.blocks.some((b) => b.routineId === 'example-weekday-1' && b.status === 'planned'),
  ).toBe(false);
});

test('ensureChecklistDay adds due checklists only and leaves timed work uncreated', () => {
  const check: Program = {
    id: 'example-daily',
    title: 'Example daily',
    group: 'Daily',
    goalIds: [],
    routines: [
      {
        id: 'example-check',
        title: 'Example check',
        duration: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
      },
    ],
  };
  const timed: Program = {
    id: 'example-timed',
    title: 'Example timed',
    group: 'Training',
    goalIds: [],
    routines: [
      {
        id: 'example-run',
        title: 'Example run',
        duration: 30,
        weekdays: [1],
        preferredStart: 720,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
      },
    ],
  };
  const programs = [check, timed];
  expect(checklistNeedsEnsure(monday, programs)).toBe(true);
  const first = ensureChecklistDay(monday, settings, programs);
  expect(first.blocks.map((b) => b.routineId)).toEqual(['example-check']);
  expect(first.blocks[0]).toMatchObject({ start: null, checklist: true, reason: null });
  expect(first.blocks.some((b) => b.id.includes('work') || b.id.includes('scrum'))).toBe(false);
  expect(checklistNeedsEnsure(monday, programs, first)).toBe(false);
  const again = ensureChecklistDay(
    monday,
    settings,
    programs,
    first,
    new Date(2026, 10, 9, 12, 0).toISOString(),
  );
  expect(again.blocks).toEqual(first.blocks);
  expect(again.revisions).toEqual([]);
  const generated = generateDay(
    monday,
    settings,
    programs,
    first,
    new Date(2026, 10, 9, 13, 0).toISOString(),
  );
  expect(generated.blocks.some((b) => b.routineId === 'example-run')).toBe(true);
  expect(generated.blocks.some((b) => b.id === `${monday}:scrum`)).toBe(true);
  expect(generated.blocks.find((b) => b.routineId === 'example-check')!.checklist).toBe(true);
  const done = setStatus(
    first,
    first.blocks[0].id,
    'done',
    new Date(2026, 10, 9, 14, 0).toISOString(),
  );
  const paused = ensureChecklistDay(
    monday,
    settings,
    [{ ...check, routines: [{ ...check.routines[0], enabled: false }] }, timed],
    done,
    new Date(2026, 10, 9, 15, 0).toISOString(),
  );
  expect(paused.blocks.find((b) => b.routineId === 'example-check')!.status).toBe('done');
});

test('replanning respects evening windows and leaves expired morning tasks unscheduled', () => {
  const pm = { ...makeBlock('pm', 'Evening', null, 15), windowStart: 1080, windowEnd: 1380 };
  const am = { ...makeBlock('am', 'Morning', null, 15), windowStart: 540, windowEnd: 720 };
  const day = replanDay({ date: monday, blocks: [pm, am], revisions: [] }, settings, 780);
  expect(day.blocks.find((b) => b.id === 'pm')!.start).toBe(1080);
  expect(day.blocks.find((b) => b.id === 'am')!.start).toBeNull();
});

// A checklist block carrying a 10:00 start, as a stored day can hold one.
const stored = (over: Partial<Block> = {}): Block => ({
  ...makeBlock(`${monday}:routine:stretch`, 'Stretch', 600, 15),
  routineId: 'stretch',
  programId: 'daily',
  checklist: true,
  ...over,
});
const daily = (routines: Partial<Program['routines'][number]>[]): Program => ({
  id: 'daily',
  title: 'Daily',
  group: 'Foundation',
  goalIds: [],
  routines: routines.map((r) => ({
    id: 'stretch',
    title: 'Stretch',
    duration: 15,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    ...r,
  })),
});

test('a checklist item with a stored start holds no slot: a 10:00 block is added beside it', () => {
  const day = { date: monday, blocks: [stored()], revisions: [] };
  expect(occupied(day.blocks[0])).toBe(false);
  expect(findSlot(day.blocks, 30, 600, 1440)).toBe(600);
  const added = editBlock(day, makeBlock('call', 'Call', 600, 30), settings);
  expect(added.blocks.map((b) => b.id)).toEqual([stored().id, 'call']);
  // The stored start is left as recorded, and the day still passes backup validation.
  expect(added.blocks[0].start).toBe(600);
  const state = withDay(emptyState(), added);
  expect(parseBackup(encodeBackup(state, '2026-11-09T12:00:00.000Z')).state.days[monday]).toEqual(
    added,
  );
});

test('undoing a skipped checklist item succeeds when a block now sits at its stored start', () => {
  let day: Day = { date: monday, blocks: [stored()], revisions: [] };
  day = setStatus(day, stored().id, 'skipped', '2026-11-09T09:30:00Z');
  day = editBlock(day, makeBlock('call', 'Call', 600, 30), settings);
  const undone = setStatus(day, stored().id, 'planned');
  expect(undone.blocks.find((b) => b.id === stored().id)!.status).toBe('planned');
  expect(setStatus(day, stored().id, 'done').blocks[0].status).toBe('done');
});

test('generation keeps a 10:00 commitment placed beside a checklist item stored at 10:00', () => {
  const atTen = { ...settings, scrumStart: 600 };
  const previous = { date: monday, blocks: [stored()], revisions: [] };
  const day = generateDay(monday, atTen, [daily([{ checklist: true }])], previous);
  const scrum = day.blocks.find((b) => b.id === `${monday}:scrum`)!;
  expect(scrum).toMatchObject({ start: 600, duration: 15, reason: null });
  expect(day.blocks.filter((b) => b.routineId === 'stretch')).toEqual([stored()]);
});

test('a fixed checklist routine never blocks generation or replanning', () => {
  const programs = [
    daily([
      { checklist: true, fixed: true },
      { id: 'walk', title: 'Walk', duration: 30, preferredStart: 780 },
    ]),
  ];
  const day = generateDay(monday, settings, programs);
  expect(day.blocks.find((b) => b.routineId === 'stretch')).toMatchObject({
    checklist: true,
    fixed: true,
    start: null,
  });
  expect(day.blocks.find((b) => b.routineId === 'walk')).toMatchObject({
    start: 780,
    reason: null,
  });
  expect(
    replanDay(day, settings, 540).blocks.find((b) => b.routineId === 'walk')!.start,
  ).not.toBeNull();
  // The same holds for a fixed checklist item carrying a stored start.
  const timedStretch = {
    ...day,
    blocks: day.blocks.map((b) => (b.routineId === 'stretch' ? stored({ fixed: true }) : b)),
  };
  expect(() => replanDay(timedStretch, settings, 540)).not.toThrow();
  const regenerated = generateDay(monday, settings, programs, {
    ...timedStretch,
    blocks: timedStretch.blocks.filter((b) => b.routineId !== 'walk'),
  });
  expect(regenerated.blocks.find((b) => b.routineId === 'walk')).toMatchObject({
    start: 780,
    reason: null,
  });
});
