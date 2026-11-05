import { expect, test } from '@jest/globals';
import { decodeState, parseSetup } from '../data';
import { Day, Program, emptyState } from '../model';
import {
  dayClearStreak,
  dayOutcome,
  dayProgress,
  objectiveLeaves,
  outcomeLabel,
  protectDay,
  streakCaption,
  streakHistory,
} from '../objectives';
import { encodeBackup, parseBackup } from '../backup';
import {
  checklistNeedsEnsure,
  ensureChecklistDay,
  generateDay,
  setBundledStatus,
  setStatus,
} from '../planner';
import { todayWidgetTimeline } from '../widget';

const monday = '2026-11-09';
const tuesday = '2026-11-10';
const wednesday = '2026-11-11';
const saturday = '2026-11-14';
const now = new Date(2026, 10, 9, 16, 0).toISOString();
const settings = emptyState().settings;

function check(id: string, weekdays: number[], extra: Partial<Program['routines'][number]> = {}) {
  return {
    id,
    title: `Example ${id}`,
    duration: null,
    weekdays,
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  };
}

function daily(): Program {
  return {
    id: 'example-daily',
    title: 'Example daily',
    group: 'Daily',
    goalIds: [],
    routines: [
      check('example-a', [0, 1, 2, 3, 4, 5, 6]),
      check('example-b', [0, 1, 2, 3, 4, 5, 6]),
    ],
  };
}

test('progress counts independently completable leaves; a skip is excused, never credit', () => {
  const programs = [daily()];
  const first = ensureChecklistDay(monday, settings, programs);
  expect(dayProgress(first, programs, monday)).toMatchObject({
    done: 0,
    total: 2,
    remaining: 2,
    cleared: false,
  });
  const one = setStatus(first, first.blocks[0].id, 'done', now);
  expect(dayProgress(one, programs, monday)).toMatchObject({ done: 1, total: 2, remaining: 1 });
  // The skipped objective leaves the count and is never done; the rest done clears the day.
  const skipped = setStatus(one, one.blocks[1].id, 'skipped', now);
  expect(dayProgress(skipped, programs, monday)).toMatchObject({
    done: 1,
    total: 1,
    skipped: 1,
    remaining: 0,
    cleared: true,
  });
  const both = setStatus(one, one.blocks[1].id, 'done', now);
  expect(dayProgress(both, programs, monday).cleared).toBe(true);
  const undone = setStatus(both, both.blocks[1].id, 'planned', now);
  expect(dayProgress(undone, programs, monday).cleared).toBe(false);
});

test('bundled children are leaves and the parent is not a fifth objective', () => {
  const parent: Program = {
    id: 'example-session',
    title: 'Example session',
    group: 'Training',
    goalIds: [],
    routines: [
      {
        id: 'example-parent',
        title: 'Example parent',
        duration: 60,
        weekdays: [1],
        preferredStart: 720,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
      },
    ],
  };
  const child: Program = {
    id: 'example-parts',
    title: 'Example parts',
    group: 'Training',
    goalIds: [],
    routines: ['one', 'two'].map((id) => ({
      id: `example-${id}`,
      title: `Example ${id}`,
      duration: null,
      weekdays: [1],
      preferredStart: null,
      enabled: true,
      fixed: false,
      steps: [],
      bundledInto: 'example-session',
    })),
  };
  const generated = generateDay(monday, settings, [parent, child]);
  const leaves = objectiveLeaves(generated, [parent, child]);
  expect(leaves.map((leaf) => leaf.title)).toEqual(['Example one', 'Example two']);
  expect(dayProgress(generated, [parent, child], monday).total).toBe(2);
  const parentBlock = generated.blocks.find((block) => block.routineId === 'example-parent')!;
  const done = setBundledStatus(
    generated,
    parentBlock.id,
    parentBlock.bundledSteps![0].id,
    'done',
    now,
  );
  expect(dayProgress(done, [parent, child], monday)).toMatchObject({
    done: 1,
    total: 2,
    cleared: false,
  });
});

const sunday = '2026-11-08';
const tuesdayNow = new Date(2026, 10, 10, 16, 0).toISOString();

function timedRoutine(
  id: string,
  weekdays: number[],
  extra: Partial<Program['routines'][number]> = {},
): Program['routines'][number] {
  return {
    id,
    title: `Example ${id}`,
    duration: 30,
    weekdays,
    preferredStart: 720,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    ...extra,
  };
}

function training(routines: Program['routines']): Program {
  return { id: 'example-timed', title: 'Example timed', group: 'Training', goalIds: [], routines };
}

function finishChecklists(date: string, programs: Program[], at = now): Day {
  const day = ensureChecklistDay(date, settings, programs, undefined, at);
  return day.blocks.reduce((next, block) => setStatus(next, block.id, 'done', at), day);
}

function withRun(): Program[] {
  return [daily(), training([timedRoutine('run', [1])])];
}

test('an ungenerated due timed session blocks the board, outcome, streak and sheet alike', () => {
  const programs = withRun();
  const mon = finishChecklists(monday, programs);
  expect(mon.dueTimed).toEqual(['run']);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [sunday]: finishChecklists(sunday, programs), [monday]: mon },
  };
  expect(dayProgress(mon, programs, monday)).toMatchObject({
    cleared: false,
    missingTimed: 1,
    missingTimedTitles: ['Example run'],
    total: 3,
    remaining: 1,
  });
  expect(dayOutcome(state, monday)).toBe('open');
  // Held while Monday is today, but never incremented by the blocked day.
  expect(dayClearStreak(state, monday, monday)).toEqual({ current: 1, best: 1 });
  expect(streakHistory(state, monday).map(outcomeLabel)).toEqual(['Cleared', 'Not cleared']);
  // After midnight the obligation is still unresolved and Monday is a miss, not a clear.
  expect(dayProgress(state.days[monday], programs, monday).missingTimed).toBe(1);
  expect(dayClearStreak(state, tuesday, tuesday)).toEqual({ current: 0, best: 1 });
});

test('a generated and completed timed session clears the day; skipping it excuses it', () => {
  const programs = withRun();
  const generated = generateDay(
    monday,
    settings,
    programs,
    finishChecklists(monday, programs),
    now,
  );
  const runId = `${monday}:routine:run`;
  expect(generated.dueTimed).toEqual(['run']);
  expect(dayProgress(generated, programs, monday).missingTimed).toBe(0);
  const base = { ...emptyState(), source: 'personal' as const, programs };
  const pending = { ...base, days: { [monday]: generated } };
  expect(dayOutcome(pending, monday)).toBe('open');
  const done = { ...base, days: { [monday]: setStatus(generated, runId, 'done', now) } };
  expect(dayOutcome(done, monday)).toBe('cleared');
  expect(dayClearStreak(done, monday, monday)).toEqual({ current: 1, best: 1 });
  // With every checklist item done, the skipped run is excused and the day clears.
  const skipped = { ...base, days: { [monday]: setStatus(generated, runId, 'skipped', now) } };
  expect(dayProgress(skipped.days[monday], programs, monday)).toMatchObject({
    cleared: true,
    done: 2,
    total: 2,
    skipped: 1,
  });
  expect(dayOutcome(skipped, monday)).toBe('cleared');
  expect(dayClearStreak(skipped, tuesday, tuesday)).toEqual({ current: 1, best: 1 });
  // A skipped run is on the board, so it is never a missing timed session.
  expect(dayProgress(skipped.days[monday], programs, monday).missingTimed).toBe(0);
});

test('a skip excuses its objective; a day with only skips is not cleared', () => {
  const programs = [
    {
      ...daily(),
      routines: [
        ...daily().routines,
        check('example-c', [0, 1, 2, 3, 4, 5, 6]),
        check('example-weigh', [0, 1, 2, 3, 4, 5, 6], { optional: true }),
      ],
    },
  ];
  const day = ensureChecklistDay(monday, settings, programs, undefined, now);
  const [a, b, c, weigh] = day.blocks.map((block) => block.id);
  const set = (d: Day, statuses: [string, 'done' | 'skipped'][]) =>
    statuses.reduce((next, [id, status]) => setStatus(next, id, status, now), d);
  const state = (d: Day) => ({
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: d },
  });
  // Some skipped, the rest done: cleared, and the count leaves the skip out.
  const some = set(day, [
    [a, 'skipped'],
    [b, 'done'],
    [c, 'done'],
  ]);
  expect(dayProgress(some, programs, monday)).toMatchObject({
    done: 2,
    total: 2,
    skipped: 1,
    cleared: true,
  });
  expect(dayOutcome(state(some), monday)).toBe('cleared');
  // A skip and an objective still open: one to go, not cleared.
  const open = set(day, [
    [a, 'skipped'],
    [b, 'done'],
  ]);
  expect(dayProgress(open, programs, monday)).toMatchObject({
    done: 1,
    total: 2,
    remaining: 1,
    cleared: false,
  });
  // Every required objective skipped and nothing required done: no free clear, and it is a day
  // with something due, not an empty one.
  const all = set(day, [
    [a, 'skipped'],
    [b, 'skipped'],
    [c, 'skipped'],
  ]);
  expect(dayProgress(all, programs, monday)).toMatchObject({
    done: 0,
    total: 0,
    skipped: 3,
    remaining: 0,
    cleared: false,
  });
  expect(dayOutcome(state(all), monday)).toBe('open');
  expect(outcomeLabel(streakHistory(state(all), monday, tuesday).at(-1)!)).toBe('Not cleared');
  // An optional objective done never stands in for the required ones, skipped or not.
  const optionalDone = set(all, [[weigh, 'done']]);
  expect(dayProgress(optionalDone, programs, monday).cleared).toBe(false);
  expect(dayOutcome(state(optionalDone), monday)).toBe('open');
  // A skipped optional objective changes nothing: it was never counted.
  const optionalSkipped = set(day, [
    [a, 'done'],
    [b, 'done'],
    [c, 'done'],
    [weigh, 'skipped'],
  ]);
  expect(dayProgress(optionalSkipped, programs, monday)).toMatchObject({
    done: 3,
    total: 3,
    skipped: 0,
    cleared: true,
  });
  // Undo of a skip puts the objective back in the count.
  const undone = setStatus(some, a, 'planned', now);
  expect(dayProgress(undone, programs, monday)).toMatchObject({
    total: 3,
    remaining: 1,
    cleared: false,
  });
});

test('a skipped bundled step is excused like any other objective', () => {
  const session: Program = {
    id: 'example-session',
    title: 'Example session',
    group: 'Training',
    goalIds: [],
    routines: [{ ...check('example-parent', [1]), checklist: false, duration: 60 }],
  };
  const parts: Program = {
    id: 'example-parts',
    title: 'Example parts',
    group: 'Training',
    goalIds: [],
    routines: ['one', 'two'].map((id) =>
      check(`example-${id}`, [1], { checklist: undefined, bundledInto: 'example-session' }),
    ),
  };
  const programs = [session, parts];
  const day = generateDay(monday, settings, programs, undefined, now);
  const parent = day.blocks.find((b) => b.routineId === 'example-parent')!;
  expect(parent.bundledSteps).toHaveLength(2);
  const [one, two] = parent.bundledSteps!;
  const skipped = setBundledStatus(day, parent.id, one.id, 'skipped', now);
  expect(dayProgress(skipped, programs, monday)).toMatchObject({ total: 1, skipped: 1 });
  const cleared = setBundledStatus(skipped, parent.id, two.id, 'done', now);
  expect(dayProgress(cleared, programs, monday)).toMatchObject({
    done: 1,
    total: 1,
    cleared: true,
  });
});

test('a past day keeps its recorded timed obligations when the catalog changes', () => {
  const mon = finishChecklists(monday, withRun());
  // Later: the run moves off Mondays and a new Monday swim is created.
  const later = [daily(), training([timedRoutine('run', [2]), timedRoutine('swim', [1])])];
  expect(dayProgress(mon, later, monday).missingTimedTitles).toEqual(['Example run']);
  expect(checklistNeedsEnsure(monday, later, mon, tuesday)).toBe(false);
  expect(ensureChecklistDay(monday, settings, later, mon, tuesdayNow)).toBe(mon);
  const state = { ...emptyState(), source: 'personal' as const, programs: later };
  expect(dayOutcome({ ...state, days: { [monday]: mon } }, monday)).toBe('open');
  // While the date is still today, the snapshot follows the catalog.
  expect(checklistNeedsEnsure(monday, later, mon, monday)).toBe(true);
  expect(ensureChecklistDay(monday, settings, later, mon, now).dueTimed).toEqual(['swim']);
  // A deleted routine keeps blocking with a safe title.
  expect(dayProgress(mon, [daily()], monday).missingTimedTitles).toEqual(['A timed session']);
});

test('an unrecorded past date gains no timed obligations when its due items are written', () => {
  const lastMonday = '2026-11-02';
  const shown = ensureChecklistDay(lastMonday, settings, withRun(), undefined, now);
  expect(shown.blocks).toHaveLength(2);
  expect(shown.dueTimed).toBeUndefined();
  const withPast = { ...shown, dueTimed: ['run'] };
  const newHabit = [
    { ...daily(), routines: [...daily().routines, check('example-c', [1])] },
    training([timedRoutine('run', [1]), timedRoutine('swim', [1])]),
  ];
  const reshown = ensureChecklistDay(lastMonday, settings, newHabit, withPast, now);
  expect(reshown.dueTimed).toEqual(['run']);
});

test('a day recorded before due timed snapshots keeps its stored outcome', () => {
  const programs = withRun();
  const legacy = finishChecklists(monday, programs);
  delete legacy.dueTimed;
  const state = decodeState({
    ...emptyState(),
    source: 'personal',
    programs,
    days: { [monday]: legacy },
  });
  expect(state.days[monday].dueTimed).toBeUndefined();
  expect(dayOutcome(state, monday)).toBe('cleared');
  expect(dayClearStreak(state, tuesday, tuesday)).toEqual({ current: 1, best: 1 });
});

test('a protected day with an unresolved timed session holds without incrementing', () => {
  const programs = withRun();
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: {
      [sunday]: finishChecklists(sunday, programs),
      [monday]: protectDay(finishChecklists(monday, programs), 'travel', now),
    },
  };
  expect(dayOutcome(state, monday)).toBe('protected');
  expect(dayClearStreak(state, monday, monday)).toEqual({ current: 1, best: 1 });
  expect(dayClearStreak(state, wednesday, wednesday)).toEqual({ current: 1, best: 1 });
  expect(outcomeLabel(streakHistory(state, tuesday)[2])).toBe('Not recorded');
  expect(outcomeLabel(streakHistory(state, tuesday)[1])).toBe('Protected · Travel');
});

test('viewing an unfinished past date does not treat it as still in progress', () => {
  const programs = [daily()];
  const tue = ensureChecklistDay(tuesday, settings, programs, undefined, now);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: finishChecklists(monday, programs), [tuesday]: tue },
  };
  expect(dayClearStreak(state, tuesday, tuesday)).toEqual({ current: 1, best: 1 });
  expect(dayClearStreak(state, tuesday, wednesday)).toEqual({ current: 0, best: 1 });
});

test('ensure records sorted, unique timed IDs and is idempotent', () => {
  const programs = [
    daily(),
    training([timedRoutine('zeta', [1]), timedRoutine('alpha', [1]), timedRoutine('off', [2])]),
  ];
  const first = ensureChecklistDay(monday, settings, programs, undefined, now);
  expect(first.dueTimed).toEqual(['alpha', 'zeta']);
  expect(checklistNeedsEnsure(monday, programs, first, monday)).toBe(false);
  expect(ensureChecklistDay(monday, settings, programs, first, now)).toBe(first);
  const timedOnly = ensureChecklistDay(monday, settings, [programs[1]], undefined, now);
  expect(timedOnly).toMatchObject({ blocks: [], dueTimed: ['alpha', 'zeta'] });
  expect(checklistNeedsEnsure(monday, [programs[1]], timedOnly, monday)).toBe(false);
  const nothingTimed = ensureChecklistDay(monday, settings, [daily()], first, now);
  expect(nothingTimed.dueTimed).toBeUndefined();
  expect(nothingTimed.blocks).toBe(first.blocks);
});

test('a private missing timed session counts in the app and stays out of public totals', () => {
  const programs = [daily(), training([timedRoutine('private-run', [1], { private: true })])];
  const mon = finishChecklists(monday, programs);
  expect(dayProgress(mon, programs, monday).total).toBe(3);
  expect(dayProgress(mon, programs, monday, { publicOnly: true })).toMatchObject({
    total: 2,
    missingTimed: 0,
    missingTimedTitles: [],
  });
  expect(dayProgress(mon, [daily()], monday, { publicOnly: true }).missingTimed).toBe(0);
});

test('due timed snapshots are validated and survive a backup round trip', () => {
  const programs = withRun();
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: finishChecklists(monday, programs) },
  };
  const restored = parseBackup(encodeBackup(state, now)).state;
  expect(restored.days[monday].dueTimed).toEqual(['run']);
  expect(dayOutcome(restored, monday)).toBe('open');
  for (const dueTimed of ['run', [1], [''], ['run', 'run'], [null]])
    expect(() =>
      decodeState({ ...state, days: { [monday]: { ...state.days[monday], dueTimed } } }),
    ).toThrow(/due timed/);
});

test('day-clear streak uses recorded days, a day of only skips breaks, protection holds, and best survives', () => {
  const programs = [daily()];
  let state = { ...emptyState(), source: 'personal' as const, programs };
  const mon = ensureChecklistDay(monday, settings, programs);
  const monDone = mon.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), mon);
  state = { ...state, days: { [monday]: monDone } };
  expect(dayClearStreak(state, monday, monday)).toEqual({ current: 1, best: 1 });
  const tue = ensureChecklistDay(tuesday, settings, programs);
  const tueSkip = tue.blocks.reduce((day, block) => setStatus(day, block.id, 'skipped', now), tue);
  state = { ...state, days: { ...state.days, [tuesday]: tueSkip } };
  expect(dayOutcome(state, tuesday)).toBe('open');
  expect(dayClearStreak(state, tuesday, tuesday)).toEqual({ current: 0, best: 1 });
  const wed = protectDay(ensureChecklistDay(wednesday, settings, programs), 'illness', now);
  state = { ...state, days: { ...state.days, [wednesday]: wed } };
  expect(wed.blocks.every((block) => block.status === 'planned')).toBe(true);
  expect(dayClearStreak(state, wednesday, wednesday)).toEqual({ current: 0, best: 1 });
  const sat = ensureChecklistDay(saturday, settings, programs);
  const satDone = sat.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), sat);
  state = { ...state, days: { ...state.days, [saturday]: satDone } };
  expect(dayClearStreak(state, saturday, saturday)).toEqual({ current: 1, best: 1 });
});

test('the streak runs through a day with a skip once the rest is done', () => {
  const programs = [daily()];
  const doneAll = (d: Day) => d.blocks.reduce((n, b) => setStatus(n, b.id, 'done', now), d);
  const mon = doneAll(ensureChecklistDay(monday, settings, programs));
  const tue = ensureChecklistDay(tuesday, settings, programs);
  const tueSkip = setStatus(
    setStatus(tue, tue.blocks[0].id, 'skipped', now),
    tue.blocks[1].id,
    'done',
    now,
  );
  const wed = doneAll(ensureChecklistDay(wednesday, settings, programs));
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: mon, [tuesday]: tueSkip, [wednesday]: wed },
  };
  expect(dayOutcome(state, tuesday)).toBe('cleared');
  expect(dayClearStreak(state, wednesday, wednesday)).toEqual({ current: 3, best: 3 });
  // History is read again from the records: undoing the skip reopens Tuesday and breaks the run.
  const reopened = {
    ...state,
    days: { ...state.days, [tuesday]: setStatus(tueSkip, tue.blocks[0].id, 'planned', now) },
  };
  expect(dayClearStreak(reopened, wednesday, wednesday)).toEqual({ current: 1, best: 1 });
});

test('recurrence edits do not rewrite historical day-clear results', () => {
  const programs = [daily()];
  const mon = ensureChecklistDay(monday, settings, programs);
  const monDone = mon.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), mon);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs: [
      {
        ...programs[0],
        routines: programs[0].routines.map((routine) => ({ ...routine, weekdays: [2] })),
      },
    ],
    days: { [monday]: monDone },
  };
  expect(dayClearStreak(state, monday, monday)).toEqual({ current: 1, best: 1 });
  expect(dayProgress(monDone, state.programs, monday).cleared).toBe(true);
});

test('private leaves stay in the app total and out of public aggregates and the widget', () => {
  const programs: Program[] = [
    daily(),
    {
      id: 'example-secret',
      title: 'Example secret',
      group: 'Private',
      goalIds: [],
      routines: [check('example-secret-1', [1], { private: true })],
    },
  ];
  const day = ensureChecklistDay(monday, settings, programs);
  expect(dayProgress(day, programs, monday).total).toBe(3);
  expect(dayProgress(day, programs, monday, { publicOnly: true }).total).toBe(2);
  const state = {
    ...emptyState(),
    programs,
    days: {
      [monday]: {
        ...day,
        blocks: day.blocks.map((block) =>
          block.routineId === 'example-secret-1'
            ? { ...block, start: 540, duration: 15, private: true }
            : { ...block, start: 600, duration: 15 },
        ),
      },
    },
  };
  expect(JSON.stringify(todayWidgetTimeline(state, new Date(2026, 10, 9, 8, 0)))).not.toContain(
    'Example example-secret-1',
  );
});

test('a cleared day stays a clear if protection is added later', () => {
  const programs = [daily()];
  const mon = ensureChecklistDay(monday, settings, programs);
  const monDone = mon.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), mon);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: protectDay(monDone, 'travel', now) },
  };
  expect(dayClearStreak(state, monday, monday)).toEqual({ current: 1, best: 1 });
});

test('ensure and generate keep protection and do not mark items done', () => {
  const programs = [daily()];
  const protectedDay = protectDay(ensureChecklistDay(monday, settings, programs), 'recovery', now);
  const ensured = ensureChecklistDay(monday, settings, programs, protectedDay);
  expect(ensured.protection).toEqual(protectedDay.protection);
  expect(ensured.blocks.every((block) => block.status === 'planned')).toBe(true);
  const generated = generateDay(monday, settings, programs, protectedDay);
  expect(generated.protection).toEqual(protectedDay.protection);
  expect(generated.blocks.every((block) => block.status === 'planned')).toBe(true);
});

test('streak copy stays forward-looking after a break', () => {
  expect(streakCaption(13, 21)).toBe('13-day streak');
  expect(streakCaption(0, 94)).toBe('New run started');
  expect(streakCaption(0, 0)).toBe('No streak yet');
});

test('a never-opened day stays not recorded and a protected day is an explicit excuse', () => {
  const programs = [daily()];
  const mon = ensureChecklistDay(monday, settings, programs);
  const monDone = mon.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), mon);
  const wed = ensureChecklistDay(wednesday, settings, programs);
  const wedDone = wed.blocks.reduce((day, block) => setStatus(day, block.id, 'done', now), wed);
  const openGap = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: monDone, [wednesday]: wedDone },
  };
  expect(dayOutcome(openGap, tuesday)).toBe('absent');
  expect(outcomeLabel({ date: tuesday, outcome: 'absent' })).toBe('Not recorded');
  expect(dayClearStreak(openGap, wednesday, wednesday)).toEqual({ current: 2, best: 2 });
  const protectedGap = {
    ...openGap,
    days: {
      ...openGap.days,
      [tuesday]: protectDay({ date: tuesday, blocks: [], revisions: [] }, 'illness', now),
    },
  };
  expect(dayOutcome(protectedGap, tuesday)).toBe('protected');
  expect(
    outcomeLabel({
      date: tuesday,
      outcome: 'protected',
      protection: protectedGap.days[tuesday].protection,
    }),
  ).toBe('Protected · Illness');
  expect(dayClearStreak(protectedGap, wednesday, wednesday)).toEqual({ current: 2, best: 2 });
  const history = streakHistory(protectedGap, wednesday);
  expect(history.map((entry) => entry.outcome)).toEqual(['cleared', 'protected', 'cleared']);
});

test('an unfinished day keeps the held streak; undo and past edits recalculate current and best', () => {
  const programs = [daily()];
  const finish = (date: string) => {
    const day = ensureChecklistDay(date, settings, programs);
    return day.blocks.reduce((next, block) => setStatus(next, block.id, 'done', now), day);
  };
  let state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: finish(monday), [tuesday]: finish(tuesday), [wednesday]: finish(wednesday) },
  };
  expect(dayClearStreak(state, wednesday, wednesday)).toEqual({ current: 3, best: 3 });
  const unfinishedTuesday = setStatus(
    state.days[tuesday],
    state.days[tuesday].blocks[1].id,
    'planned',
    now,
  );
  const inProgress = { ...state, days: { ...state.days, [tuesday]: unfinishedTuesday } };
  expect(dayClearStreak(inProgress, tuesday, tuesday)).toEqual({ current: 1, best: 1 });
  const undoneToday = {
    ...state,
    days: {
      ...state.days,
      [wednesday]: setStatus(
        state.days[wednesday],
        state.days[wednesday].blocks[1].id,
        'planned',
        now,
      ),
    },
  };
  expect(dayClearStreak(undoneToday, wednesday, wednesday)).toEqual({ current: 2, best: 2 });
  const undonePast = {
    ...state,
    days: {
      ...state.days,
      [tuesday]: setStatus(state.days[tuesday], state.days[tuesday].blocks[0].id, 'planned', now),
    },
  };
  expect(dayClearStreak(undonePast, wednesday, wednesday)).toEqual({ current: 1, best: 1 });
});

test('protection round-trips through decode without fabricating completions', () => {
  const day = protectDay(ensureChecklistDay(monday, settings, [daily()]), 'recovery', now);
  const saved = decodeState(
    JSON.parse(JSON.stringify({ ...emptyState(), source: 'personal', days: { [monday]: day } })),
  );
  expect(saved.days[monday].protection).toEqual({ reason: 'recovery', at: now });
  expect(saved.days[monday].blocks.every((block) => block.status === 'planned')).toBe(true);
  const backup = parseBackup(encodeBackup(saved, now));
  expect(backup.state.days[monday].protection).toEqual({ reason: 'recovery', at: now });
});

test('a setup import updates future timed obligations and leaves past days untouched', () => {
  const programs = withRun();
  const pastMonday = finishChecklists(monday, programs);
  const nextMonday = '2026-11-16';
  const future = ensureChecklistDay(nextMonday, settings, programs, undefined, now);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: { [monday]: pastMonday, [nextMonday]: future },
  };
  const paused = withRun().map((program) => ({
    ...program,
    routines: program.routines.map((routine) =>
      routine.id === 'run' ? { ...routine, enabled: false } : routine,
    ),
  }));
  const raw = JSON.stringify({
    format: 'life-os-setup-v1',
    goals: [],
    programs: paused,
    settings,
    notes: [],
  });
  const imported = parseSetup(raw, state, tuesdayNow);
  expect(imported.days[monday]).toEqual(pastMonday);
  expect(imported.days[monday].dueTimed).toEqual(['run']);
  expect(imported.days[nextMonday].dueTimed).toBeUndefined();
  expect(imported.days[nextMonday].blocks).toEqual(future.blocks);
});

test('streak history labels a held day as in progress or upcoming, and a past open day as a miss', () => {
  const programs = [daily()];
  const open = (date: string) => ensureChecklistDay(date, settings, programs, undefined, now);
  const state = {
    ...emptyState(),
    source: 'personal' as const,
    programs,
    days: {
      [sunday]: finishChecklists(sunday, programs),
      [monday]: open(monday),
      [tuesday]: open(tuesday),
      [wednesday]: protectDay(open(wednesday), 'recovery', now),
    },
  };
  const labels = (today: string) =>
    streakHistory(state, '2026-11-12', today).map((entry) => outcomeLabel(entry));
  expect(labels(monday)).toEqual([
    'Cleared',
    'In progress',
    'Upcoming',
    'Protected · Recovery',
    'Not recorded',
  ]);
  expect(dayClearStreak(state, tuesday, monday)).toEqual({ current: 1, best: 1 });
  // A day later, Monday is a miss and Tuesday is the day still in progress.
  expect(labels(tuesday).slice(0, 3)).toEqual(['Cleared', 'Not cleared', 'In progress']);
  expect(dayClearStreak(state, tuesday, tuesday)).toEqual({ current: 0, best: 1 });
  // Without the actual date the sheet never guesses a day is still in progress.
  expect(streakHistory(state, tuesday).map((entry) => outcomeLabel(entry))[1]).toBe('Not cleared');
});
