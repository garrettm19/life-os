import { describe, expect, test } from '@jest/globals';
import { decodeState, parseSetup } from '../data';
import {
  DAY_ORDER_MAX,
  dayListOrder,
  dayOrderEntries,
  moveEntryTo,
  nextOpen,
  todayList,
  withDayOrder,
} from '../day-order';
import { Block, BundledStep, Day, Program, Routine, State, emptyState } from '../model';
import { dayProgress } from '../objectives';
import { previewSetup } from '../setup';

// Synthetic routines and setup files only.
const AT = '2026-11-09T12:00:00.000Z';
const DATE = '2026-11-09';

const routine = (id: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title: `Example ${id}`,
  duration: null,
  weekdays: [1],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

const program = (id: string, routines: Routine[], extra: Partial<Program> = {}): Program => ({
  id,
  title: `Program ${id}`,
  group: 'Example',
  goalIds: [],
  routines,
  ...extra,
});

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  routineId: id,
  programId: null,
  title: `Example ${id}`,
  start: null,
  duration: null,
  fixed: false,
  status: 'planned',
  actualAt: null,
  steps: [],
  reason: null,
  checklist: true,
  ...extra,
});

const ids = (blocks: { id: string }[]) => blocks.map((b) => b.id);

function stateOf(programs: Program[]): State {
  return { ...emptyState(), source: 'personal', programs };
}

describe('the order of the day', () => {
  test('ordered routines first, then Programs order, then blocks added by hand by time', () => {
    const programs = [
      program('a', [routine('first'), routine('evening', { dayOrder: 50 })]),
      program('b', [routine('second'), routine('wake', { dayOrder: 0 })]),
    ];
    const blocks = [
      block('untimed', { routineId: null }),
      block('lunch', { routineId: null, start: 12 * 60, checklist: false }),
      block('second'),
      block('evening'),
      block('coffee', { routineId: null, start: 8 * 60, checklist: false }),
      block('first'),
      block('wake'),
    ];
    expect(ids(dayListOrder(blocks, programs))).toEqual([
      'wake',
      'evening',
      'first',
      'second',
      'coffee',
      'lunch',
      'untimed',
    ]);
  });

  test('ties keep Programs order, and a checklist block’s stored start never moves it', () => {
    const programs = [
      program('a', [routine('one', { dayOrder: 10 }), routine('two', { dayOrder: 10 })]),
    ];
    const blocks = [
      block('two'),
      block('one'),
      // A checklist item added by hand with a stored start still has no time.
      block('note', { routineId: null, start: 6 * 60 }),
      block('call', { routineId: null, start: 9 * 60, checklist: false }),
    ];
    expect(ids(dayListOrder(blocks, programs))).toEqual(['one', 'two', 'call', 'note']);
  });

  test('a routine no longer in Programs sorts like a block added by hand', () => {
    const programs = [program('a', [routine('kept')])];
    const blocks = [block('gone'), block('kept')];
    expect(ids(dayListOrder(blocks, programs))).toEqual(['kept', 'gone']);
  });

  test('the workouts of one rotation share a place', () => {
    const gym = program(
      'gym',
      [
        routine('push', { weekdays: [], dayOrder: 40 }),
        routine('pull', { weekdays: [], dayOrder: 20 }),
        routine('legs', { weekdays: [] }),
      ],
      { rotation: { order: ['push', 'pull', 'legs'], restDays: [0], startWith: 'push' } },
    );
    const programs = [
      program('day', [routine('walk', { dayOrder: 10 }), routine('read', { dayOrder: 30 })]),
      gym,
    ];
    // The rotation sits at its lowest order, 20: after the walk and before reading, for any workout.
    for (const workout of ['push', 'pull', 'legs'])
      expect(ids(dayListOrder([block('read'), block(workout), block('walk')], programs))).toEqual([
        'walk',
        workout,
        'read',
      ]);
  });

  test('a day is sorted without being changed', () => {
    const programs = [
      program('a', [routine('one', { dayOrder: 5 }), routine('two', { dayOrder: 1 })]),
    ];
    const blocks = [block('one'), block('two')];
    const copy = JSON.stringify(blocks);
    dayListOrder(blocks, programs);
    expect(JSON.stringify(blocks)).toBe(copy);
  });
});

describe("Today's one list", () => {
  const programs = [
    program('a', [
      routine('walk', { dayOrder: 0 }),
      routine('gym', { dayOrder: 20, checklist: false }),
      routine('read', { dayOrder: 10, optional: true }),
      routine('plan', { dayOrder: 30 }),
    ]),
  ];

  test('holds every routine block, timed or not, in order; blocks added by hand stay below', () => {
    const blocks = [
      block('plan'),
      block('meeting', { routineId: null, start: 10 * 60, checklist: false }),
      block('gym', { start: 18 * 60, duration: 60, checklist: false }),
      block('errand', { routineId: null, checklist: false }),
      block('note', { routineId: null }),
      block('read', { optional: true }),
      block('walk'),
    ];
    // A checklist item added by hand is still a completion item, so it is in the list (last).
    expect(ids(todayList(blocks, programs))).toEqual(['walk', 'read', 'gym', 'plan', 'note']);
  });

  test('the next thing to do is the first required objective still open, in list order', () => {
    const list = todayList(
      [
        block('plan'),
        block('gym', { checklist: false, status: 'skipped' }),
        block('read', { optional: true }),
        block('walk', { status: 'done' }),
      ],
      programs,
    );
    // Done, optional and skipped objectives are passed over; the order decides, not the input.
    expect(nextOpen(list)?.id).toBe('plan');
    expect(nextOpen(list.map((b) => ({ ...b, status: 'done' as const })))).toBeUndefined();
  });

  describe('a workout with a bundled step follows the leaves Day Cleared counts', () => {
    const step = (
      status: BundledStep['status'],
      extra: Partial<BundledStep> = {},
    ): BundledStep => ({
      id: 'gym:ankles',
      routineId: 'ankles',
      programId: 'p',
      title: 'Example ankles',
      steps: [],
      status,
      actualAt: null,
      ...extra,
    });
    const day = (blocks: Block[]): Day => ({ date: DATE, blocks, revisions: [] });
    const withSteps = [
      program('p', [
        routine('walk', { dayOrder: 0 }),
        routine('gym', { dayOrder: 10 }),
        routine('plan', { dayOrder: 20 }),
        routine('ankles', { bundledInto: 'gym' }),
      ]),
    ];

    test('the workout recorded but its step open: the workout still holds the place', () => {
      const blocks = [
        block('walk', { status: 'done' }),
        block('gym', { status: 'done', bundledSteps: [step('planned')] }),
        block('plan'),
      ];
      expect(nextOpen(todayList(blocks, withSteps))?.id).toBe('gym');
      expect(dayProgress(day(blocks), withSteps, DATE)).toMatchObject({ remaining: 2 });
      // With the rest done, the day is one step short and that step's workout is the next thing.
      const rest = blocks.map((b) => (b.id === 'plan' ? { ...b, status: 'done' as const } : b));
      expect(nextOpen(todayList(rest, withSteps))?.id).toBe('gym');
      expect(dayProgress(day(rest), withSteps, DATE)).toMatchObject({
        remaining: 1,
        cleared: false,
      });
    });

    test('the step recorded but the workout open: the workout no longer holds the place', () => {
      const blocks = [
        block('walk', { status: 'done' }),
        block('gym', { bundledSteps: [step('done')] }),
        block('plan', { status: 'done' }),
      ];
      expect(nextOpen(todayList(blocks, withSteps))).toBeUndefined();
      expect(dayProgress(day(blocks), withSteps, DATE)).toMatchObject({ cleared: true });
    });

    test('an optional step, or a step under an optional workout, never holds the place', () => {
      const optionalStep = [block('gym', { bundledSteps: [step('planned', { optional: true })] })];
      const optionalParent = [block('gym', { optional: true, bundledSteps: [step('planned')] })];
      expect(nextOpen(todayList(optionalStep, withSteps))).toBeUndefined();
      expect(nextOpen(todayList(optionalParent, withSteps))).toBeUndefined();
    });
  });
});

describe('the Order of the day sheet', () => {
  const gym = program(
    'gym',
    [
      routine('push', { weekdays: [] }),
      routine('pull', { weekdays: [] }),
      routine('ankles', { bundledInto: 'gym' }),
    ],
    { title: 'Strength', rotation: { order: ['push', 'pull'], restDays: [0], startWith: null } },
  );
  const programs = [
    program('day', [
      routine('walk'),
      routine('paused', { enabled: false }),
      routine('wake', { dayOrder: 0 }),
    ]),
    gym,
  ];

  test('lists each routine that can come up, one entry per rotation, in the current order', () => {
    const entries = dayOrderEntries(programs);
    expect(entries.map((e) => e.key)).toEqual(['wake', 'walk', 'rotation:gym']);
    expect(entries[2]).toEqual({
      key: 'rotation:gym',
      title: 'Strength',
      detail: 'Rotation · 2 workouts',
      routineIds: ['push', 'pull'],
    });
    expect(entries[1].detail).toBe('Program day');
  });

  test('saving writes 0, 10, 20… to every listed routine and leaves the rest as they were', () => {
    const before = {
      ...stateOf(programs),
      days: { [DATE]: { date: DATE, blocks: [], revisions: [] } },
    };
    const entries = dayOrderEntries(programs);
    const moved = moveEntryTo(entries, 2, 1);
    expect(moved.map((e) => e.key)).toEqual(['wake', 'rotation:gym', 'walk']);
    const after = withDayOrder(before, moved);
    const order = (id: string) =>
      after.programs.flatMap((p) => p.routines).find((r) => r.id === id)?.dayOrder;
    expect(['wake', 'push', 'pull', 'walk'].map(order)).toEqual([0, 10, 10, 20]);
    // A paused routine and a bundled step are not listed and keep what they had.
    expect(order('paused')).toBeUndefined();
    expect(order('ankles')).toBeUndefined();
    // Only the catalog changes: recorded days stay the same objects.
    expect(after.days).toBe(before.days);
    expect(() => decodeState(JSON.parse(JSON.stringify(after)))).not.toThrow();
    expect(dayOrderEntries(after.programs).map((e) => e.key)).toEqual(moved.map((e) => e.key));
  });

  test('a very long list still fits the stored range', () => {
    const many = Array.from({ length: 1500 }, (_, i) => routine(`r${i}`));
    const after = withDayOrder(
      stateOf([program('many', many)]),
      dayOrderEntries([program('many', many)]),
    );
    const orders = after.programs[0].routines.map((r) => r.dayOrder!);
    expect(Math.max(...orders)).toBeLessThanOrEqual(DAY_ORDER_MAX);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  test('moving past either end changes nothing', () => {
    expect(moveEntryTo(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveEntryTo(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveEntryTo(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  test('moves an entry to the top or the bottom in one step, the others in order', () => {
    const list = Array.from({ length: 15 }, (_, i) => `e${i + 1}`);
    const top = moveEntryTo(list, 14, 0);
    expect(top).toEqual(['e15', ...list.slice(0, 14)]);
    // From the top, one move later lands it second: two steps from 15th to 2nd.
    expect(moveEntryTo(top, 0, 1).slice(0, 3)).toEqual(['e1', 'e15', 'e2']);
    expect(moveEntryTo(list, 0, 14)).toEqual([...list.slice(1), 'e1']);
    expect(moveEntryTo(list, 3, 3)).toEqual(list);
    expect(moveEntryTo(list, 0, 15)).toEqual(list);
    expect(moveEntryTo(list, -1, 0)).toEqual(list);
  });
});

describe('storing the order', () => {
  test('decodes a whole number from 0 to 10000, or none', () => {
    const withOrder = (dayOrder: unknown) =>
      JSON.parse(
        JSON.stringify(stateOf([program('a', [{ ...routine('one'), dayOrder } as Routine])])),
      );
    for (const ok of [0, 10, DAY_ORDER_MAX]) expect(() => decodeState(withOrder(ok))).not.toThrow();
    expect(() =>
      decodeState(JSON.parse(JSON.stringify(stateOf([program('a', [routine('one')])])))),
    ).not.toThrow();
    for (const bad of [-1, 1.5, DAY_ORDER_MAX + 1, '10', null, true])
      expect(() => decodeState(withOrder(bad))).toThrow('Invalid order of the day.');
  });
});

describe('the order in a setup import', () => {
  const file = (routines: Routine[], id = 'p') =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [program(id, routines)],
    });
  const orderOf = (state: State, id: string) =>
    state.programs.flatMap((p) => p.routines).find((r) => r.id === id)?.dayOrder;

  test('places a routine that has no order on the device, and says so in the preview', () => {
    const device = stateOf([program('p', [routine('walk'), routine('read', { dayOrder: 40 })])]);
    const raw = file([
      routine('walk', { dayOrder: 10 }),
      routine('read', { dayOrder: 0 }),
      routine('new', { dayOrder: 20 }),
    ]);
    const result = parseSetup(raw, device, AT);
    expect(orderOf(result, 'walk')).toBe(10);
    expect(orderOf(result, 'new')).toBe(20);
    // The order set on the device wins.
    expect(orderOf(result, 'read')).toBe(40);
    const preview = previewSetup(raw, device, AT);
    expect(preview.orderSet).toEqual(['Example walk', 'Example new']);
    expect(preview.keptOnDevice).toContain('Example read: your place in the order of the day');
  });

  test('keeps the device’s order when the file has none', () => {
    const device = stateOf([program('old', [routine('walk', { dayOrder: 30 })])]);
    const result = parseSetup(file([routine('walk')], 'old'), device, AT);
    expect(orderOf(result, 'walk')).toBe(30);
    const preview = previewSetup(file([routine('walk')], 'old'), device, AT);
    expect(preview.orderSet).toEqual([]);
    expect(preview.keptOnDevice).toEqual([]);
  });

  test('over the demo, the file’s order applies as it is', () => {
    const demo = {
      ...stateOf([program('p', [routine('walk', { dayOrder: 90 })])]),
      source: 'demo' as const,
    };
    const result = parseSetup(file([routine('walk', { dayOrder: 5 })]), demo, AT);
    expect(orderOf(result, 'walk')).toBe(5);
  });

  test('the preview never lists a bundled step, and names a rotation once by its program', () => {
    const raw = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [
        program(
          'gym',
          [
            routine('push', { dayOrder: 30, weekdays: [] }),
            routine('pull', { dayOrder: 30, weekdays: [] }),
          ],
          { rotation: { order: ['push', 'pull'], restDays: [0], startWith: 'push' } },
        ),
        program('extras', [
          routine('walk', { dayOrder: 10 }),
          routine('ankles', { dayOrder: 40, bundledInto: 'gym' }),
        ]),
      ],
    });
    expect(previewSetup(raw, emptyState(), AT).orderSet).toEqual(['Program gym', 'Example walk']);
  });

  test('a file with an invalid order is refused', () => {
    expect(() =>
      parseSetup(file([{ ...routine('walk'), dayOrder: 2.5 }]), emptyState(), AT),
    ).toThrow('Invalid order of the day.');
  });
});
