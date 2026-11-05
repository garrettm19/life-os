import { describe, expect, jest, test } from '@jest/globals';
import { Block, Day, Program, Routine, State, emptyState, localDate, shiftDate } from '../model';
import {
  type TodayWidgetProps,
  type WidgetDayStatus,
  WIDGET_TITLE_LIMIT,
  todayWidgetAt,
  todayWidgetTimeline,
  widgetAnchor,
  widgetDayStatus,
  widgetTimelineKey,
} from '../widget';
import { anchorRoutine, withAnchorTime } from '../anchor';
import { anchorState } from '../../test-support/fixtures';
import { dayProgress, outcomeLabel, protectDay, streakHistory } from '../objectives';
import { ensureChecklistDay, generateDay, setBundledStatus, setStatus } from '../planner';
import { saveThenPublish } from '../../state/persist';
import { decodeState, parseSetup } from '../data';
import { encodeBackup, parseBackup } from '../backup';
import { todayListTimeline } from '../widget-list';

const block = (
  id: string,
  start: number | null,
  duration: number | null,
  extra: Partial<Block> = {},
): Block => ({
  id,
  routineId: null,
  programId: null,
  title: `Example ${id}`,
  start,
  duration,
  fixed: false,
  status: 'planned',
  actualAt: null,
  steps: ['Private step detail'],
  reason: null,
  ...extra,
});
const day = (date: string, blocks: Block[]): Day => ({ date, blocks, revisions: [] });
const at = (date: string, minute: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60);
};
const stateWith = (...days: Day[]): State => {
  const s = emptyState();
  for (const d of days) s.days[d.date] = d;
  return s;
};
const date = '2026-10-08';

describe('today widget selection', () => {
  const plan = day(date, [block('b', 660, 30), block('a', 540, 60)]);

  test('shows the current action while it is in progress', () => {
    expect(todayWidgetAt(plan, 570)).toEqual({
      kind: 'now',
      title: 'Example a',
      time: '9:00 AM – 10:00 AM',
    });
  });

  test('shows the next action between and before blocks', () => {
    expect(todayWidgetAt(plan, 615)).toMatchObject({ kind: 'next', title: 'Example b' });
    expect(todayWidgetAt(plan, 300)).toMatchObject({ kind: 'next', title: 'Example a' });
    expect(todayWidgetAt(plan, 600)).toMatchObject({ kind: 'next', title: 'Example b' });
  });

  test('ignores completed and skipped actions', () => {
    const recorded = day(date, [
      block('a', 540, 60, { status: 'done', actualAt: '2026-10-08T13:30:00.000Z' }),
      block('b', 660, 30, { status: 'skipped', actualAt: '2026-10-08T15:00:00.000Z' }),
      block('c', 720, 30),
    ]);
    expect(todayWidgetAt(recorded, 570)).toMatchObject({ kind: 'next', title: 'Example c' });
    recorded.blocks[2].status = 'done';
    expect(todayWidgetAt(recorded, 570)).toEqual({ kind: 'clear' });
  });

  test('handles missing schedules without inventing a time', () => {
    expect(todayWidgetAt(undefined, 600)).toEqual({ kind: 'empty' });
    expect(todayWidgetAt(day(date, [block('u', null, null)]), 600)).toEqual({ kind: 'empty' });
    expect(todayWidgetAt(day(date, [block('p', 700, null)]), 600)).toEqual({
      kind: 'next',
      title: 'Example p',
      time: '11:40 AM',
    });
    expect(todayWidgetAt(plan, 690)).toEqual({ kind: 'clear' });
  });

  test('never puts a checklist objective on the clock, even with a start stored, as on Today', () => {
    const checklist = block('c', 600, 15, { checklist: true });
    expect(todayWidgetAt(day(date, [checklist]), 540)).toEqual({ kind: 'empty' });
    expect(todayWidgetAt(day(date, [checklist, block('t', 720, 30)]), 540)).toEqual({
      kind: 'next',
      title: 'Example t',
      time: '12:00 PM – 12:30 PM',
    });
  });

  test('publishes only a bounded title and time, never steps or other records', () => {
    const long = 'x'.repeat(200);
    const props = todayWidgetAt(day(date, [block('a', 540, 60, { title: long })]), 500);
    expect(Object.keys(props).sort()).toEqual(['kind', 'time', 'title']);
    expect(props.title).toHaveLength(WIDGET_TITLE_LIMIT);
    expect(JSON.stringify(props)).not.toContain('Private step detail');
  });
});

describe('today widget timeline', () => {
  test('changes at block boundaries and goes stale at local midnight', () => {
    const plan = day(date, [block('a', 540, 60), block('b', 660, 30)]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 500));
    expect(
      entries.map((e) => [e.date.getHours() * 60 + e.date.getMinutes(), e.props.kind]),
    ).toEqual([
      [500, 'next'],
      [540, 'now'],
      [600, 'next'],
      [660, 'now'],
      [690, 'clear'],
      [0, 'stale'],
    ]);
    const last = entries[entries.length - 1].date;
    expect(localDate(last)).toBe(shiftDate(date, 1));
    expect(entries.every((e, i) => i === 0 || e.date > entries[i - 1].date)).toBe(true);
  });

  test('a checklist objective with a stored start adds no entries', () => {
    const plan = day(date, [block('c', 600, 15, { checklist: true }), block('t', 720, 30)]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 540));
    expect(
      entries.map((e) => [e.date.getHours() * 60 + e.date.getMinutes(), e.props.kind]),
    ).toEqual([
      [540, 'next'],
      [720, 'now'],
      [750, 'clear'],
      [0, 'stale'],
    ]);
  });

  test("uses today's date, not a plan from a previous day", () => {
    const yesterday = day(shiftDate(date, -1), [block('old', 600, 30)]);
    const entries = todayWidgetTimeline(stateWith(yesterday), at(date, 480));
    expect(entries[0].props).toEqual({ kind: 'empty' });
    expect(entries.map((e) => e.props.kind)).toEqual(['empty', 'stale']);
  });

  test('skips past boundaries and recorded actions', () => {
    const plan = day(date, [
      block('a', 540, 60, { status: 'done', actualAt: '2026-10-08T13:30:00.000Z' }),
      block('b', 660, 30),
    ]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 650));
    expect(entries.map((e) => e.props.kind)).toEqual(['next', 'now', 'clear', 'stale']);
  });

  test('omits a private routine title even when that block has a time', () => {
    const secret = block('secret', 540, 30, {
      title: 'Example private practice',
      private: true,
    });
    expect(todayWidgetAt(day(date, [secret, block('a', 600, 30)]), 500)).toMatchObject({
      kind: 'next',
      title: 'Example a',
    });
    const state = stateWith(
      day(date, [
        block('named', 540, 30, { routineId: 'hidden', title: 'Example private practice' }),
      ]),
    );
    state.programs = [
      {
        id: 'example-private',
        title: 'Example private',
        group: 'Private',
        goalIds: [],
        routines: [
          {
            id: 'hidden',
            title: 'Example private practice',
            duration: 30,
            weekdays: [4],
            preferredStart: 540,
            enabled: true,
            fixed: false,
            steps: ['Do not publish this step'],
            bundledInto: null,
            private: true,
          },
        ],
      },
    ];
    expect(JSON.stringify(todayWidgetTimeline(state, at(date, 500)))).not.toContain(
      'Example private practice',
    );
    expect(JSON.stringify(todayWidgetTimeline(state, at(date, 500)))).not.toContain(
      'Do not publish this step',
    );
  });

  test('keeps a private checklist off the widget after an unrelated catalog edit', () => {
    const state = stateWith(
      day(date, [
        block('named', 540, 30, {
          routineId: 'example-habit-1',
          title: 'Example everyday habit',
        }),
      ]),
    );
    state.programs = [
      {
        id: 'example-habits',
        title: 'Example habits',
        group: 'Daily',
        goalIds: [],
        routines: [
          {
            id: 'example-habit-1',
            title: 'Example everyday habit',
            duration: null,
            weekdays: [4],
            preferredStart: null,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            checklist: true,
            private: true,
          },
        ],
      },
    ];
    expect(JSON.stringify(todayWidgetTimeline(state, at(date, 500)))).not.toContain(
      'Example everyday habit',
    );
  });

  test('public objective aggregates omit private leaves and do not publish counts', () => {
    const state = stateWith(
      day(date, [
        block('public', 600, 30, { routineId: 'example-public', title: 'Example public' }),
        block('secret', 540, 30, {
          routineId: 'example-secret',
          title: 'Example private practice',
          private: true,
        }),
      ]),
    );
    state.programs = [
      {
        id: 'example-mix',
        title: 'Example mix',
        group: 'Daily',
        goalIds: [],
        routines: [
          {
            id: 'example-public',
            title: 'Example public',
            duration: 30,
            weekdays: [4],
            preferredStart: 600,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
          },
          {
            id: 'example-secret',
            title: 'Example private practice',
            duration: 30,
            weekdays: [4],
            preferredStart: 540,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            private: true,
          },
        ],
      },
    ];
    expect(dayProgress(state.days[date], state.programs, date).total).toBe(2);
    expect(dayProgress(state.days[date], state.programs, date, { publicOnly: true }).total).toBe(1);
    expect(JSON.stringify(todayWidgetTimeline(state, at(date, 500)))).not.toMatch(
      /1 \/ 2|2 complete/,
    );
    expect(JSON.stringify(todayWidgetTimeline(state, at(date, 500)))).not.toContain(
      'Example private practice',
    );
  });

  test('every published value is a string, so iOS can store the timeline', () => {
    const plan = day(date, [block('a', 540, 60), block('b', 660, null), block('u', null, null)]);
    for (const now of [at(date, 500), at(date, 1439)])
      for (const entry of todayWidgetTimeline(stateWith(plan), now))
        for (const value of Object.values(entry.props)) expect(typeof value).toBe('string');
    expect(todayWidgetTimeline(stateWith(), at(date, 600)).map((e) => e.props)).toEqual([
      { kind: 'empty' },
      { kind: 'stale' },
    ]);
  });
});

describe('widget publication after saves', () => {
  test('publishes only after a successful save', async () => {
    const calls: string[] = [];
    await saveThenPublish(
      emptyState(),
      async () => void calls.push('save'),
      async () => void calls.push('publish'),
    );
    expect(calls).toEqual(['save', 'publish']);
  });

  test('a failed save rejects and never publishes', async () => {
    const publish = jest.fn(async () => {});
    await expect(
      saveThenPublish(
        emptyState(),
        async () => {
          throw new Error('Synthetic save failure');
        },
        publish,
      ),
    ).rejects.toThrow('Synthetic save failure');
    expect(publish).not.toHaveBeenCalled();
  });

  test('a failed publish does not turn a saved change into an error', async () => {
    const save = jest.fn(async () => {});
    await expect(
      saveThenPublish(emptyState(), save, async () => {
        throw new Error('Synthetic widget failure');
      }),
    ).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('a publish that never settles does not hold up the save', async () => {
    const publish = jest.fn(() => new Promise<void>(() => {}));
    await expect(saveThenPublish(emptyState(), async () => {}, publish)).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe('widget Day Cleared follows the stored Day Cleared rule', () => {
  const thursday = date; // 2026-10-08 is a Thursday
  const at13 = new Date(2026, 9, 8, 13, 0).toISOString();
  const settings = emptyState().settings;
  const habit = (id: string, extra: Partial<Routine> = {}): Routine => ({
    id,
    title: `Example ${id}`,
    duration: null,
    weekdays: [4],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  });
  const timedRoutine = (id: string, extra: Partial<Routine> = {}): Routine => ({
    id,
    title: `Example ${id}`,
    duration: 30,
    weekdays: [4],
    preferredStart: 720,
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
  const optedIn = (programs: Program[], days: Day[]): State => {
    const s = emptyState();
    s.source = 'personal';
    s.programs = programs;
    s.settings = { ...s.settings, widgetDayStatus: true };
    for (const d of days) s.days[d.date] = d;
    return s;
  };
  const doneAll = (d: Day) => d.blocks.reduce((next, b) => setStatus(next, b.id, 'done', at13), d);
  const opened = (programs: Program[], on = thursday, now = at13) =>
    ensureChecklistDay(on, settings, programs, undefined, now);
  const published = (s: State, minute = 600) =>
    todayWidgetTimeline(s, at(thursday, minute)).map((e) => e.props);

  test('a day of only checklist habits clears, and Undo retracts it on the next publish', () => {
    const programs = [program([habit('a'), habit('b')])];
    const done = doneAll(opened(programs));
    const cleared = optedIn(programs, [done]);
    expect(widgetDayStatus(cleared, thursday)).toBe('cleared');
    expect(published(cleared)).toEqual([{ kind: 'empty', day: 'cleared' }, { kind: 'stale' }]);
    const undone = optedIn(programs, [setStatus(done, done.blocks[0].id, 'planned', at13)]);
    // The list's next open objective leads the widget, beside the status.
    expect(published(undone)[0]).toEqual({ kind: 'empty', day: 'remaining', todo: 'Example a' });
  });

  test('a finished schedule is not Day Cleared while another due leaf is unfinished', () => {
    const programs = [program([habit('check'), timedRoutine('run')])];
    const generated = generateDay(thursday, settings, programs);
    const runDone = setStatus(generated, `${thursday}:routine:run`, 'done', at13);
    const s = optedIn(programs, [runDone]);
    expect(published(s, 800)[0]).toEqual({
      kind: 'clear',
      day: 'remaining',
      todo: 'Example check',
    });
    expect(widgetDayStatus(s, thursday)).not.toBe('cleared');
  });

  test('a skip is excused; an all-skipped day, ungenerated timed work, protection, and empty or unopened days never celebrate', () => {
    const programs = [program([habit('a'), habit('b')])];
    const open = opened(programs);
    // A skipped objective leaves the count, so the rest done clears the day.
    const skipped = setStatus(doneAll(open), open.blocks[1].id, 'skipped', at13);
    expect(widgetDayStatus(optedIn(programs, [skipped]), thursday)).toBe('cleared');
    // Everything skipped and nothing done is not a clear.
    const allSkipped = open.blocks.reduce((d, b) => setStatus(d, b.id, 'skipped', at13), open);
    expect(widgetDayStatus(optedIn(programs, [allSkipped]), thursday)).toBe('unresolved');
    const withRun = [program([habit('a'), timedRoutine('run')])];
    const blocked = doneAll(opened(withRun));
    expect(blocked.dueTimed).toEqual(['run']);
    expect(widgetDayStatus(optedIn(withRun, [blocked]), thursday)).toBe('plan');
    const protectedDay = protectDay(open, 'travel', at13);
    expect(widgetDayStatus(optedIn(programs, [protectedDay]), thursday)).toBe('protected');
    expect(widgetDayStatus(optedIn(programs, [day(thursday, [])]), thursday)).toBe('empty');
    expect(widgetDayStatus(optedIn(programs, []), thursday)).toBe('absent');
  });

  test('bundled steps count as leaves exactly as on Today', () => {
    const accessory = habit('part', { checklist: undefined, bundledInto: 'example-program' });
    const programs = [program([timedRoutine('session'), accessory])];
    const generated = generateDay(thursday, settings, programs);
    const parent = generated.blocks.find((b) => b.routineId === 'session')!;
    expect(parent.bundledSteps).toHaveLength(1);
    const parentDone = setStatus(generated, parent.id, 'done', at13);
    expect(widgetDayStatus(optedIn(programs, [parentDone]), thursday)).toBe('remaining');
    const stepDone = setBundledStatus(
      parentDone,
      parent.id,
      parent.bundledSteps![0].id,
      'done',
      at13,
    );
    expect(dayProgress(stepDone, programs, thursday).cleared).toBe(true);
    expect(widgetDayStatus(optedIn(programs, [stepDone]), thursday)).toBe('cleared');
  });

  test('each fixture gets its expected status, matching the Today board and the streak sheet', () => {
    const programs = [program([habit('a'), habit('b'), timedRoutine('run')])];
    const base = opened(programs);
    const generated = generateDay(thursday, settings, programs, base, at13);
    const cases: [Day | undefined, WidgetDayStatus][] = [
      [undefined, 'absent'],
      [day(thursday, []), 'empty'],
      [base, 'plan'],
      [doneAll(base), 'plan'],
      [generated, 'remaining'],
      [doneAll(generated), 'cleared'],
      [setStatus(doneAll(generated), `${thursday}:routine:run`, 'skipped', at13), 'cleared'],
      [
        generated.blocks.reduce((d, b) => setStatus(d, b.id, 'skipped', at13), generated),
        'unresolved',
      ],
      [protectDay(base, 'illness', at13), 'protected'],
      [protectDay(doneAll(generated), 'illness', at13), 'cleared'],
    ];
    for (const [fixture, expected] of cases) {
      const s = optedIn(programs, fixture ? [fixture] : []);
      expect(widgetDayStatus(s, thursday)).toBe(expected);
      const board = dayProgress(fixture, programs, thursday).cleared;
      const sheet = streakHistory(s, thursday, thursday).at(-1);
      expect(board).toBe(expected === 'cleared');
      if (fixture) expect(sheet && outcomeLabel(sheet) === 'Cleared').toBe(expected === 'cleared');
    }
  });

  test('without the opt-in no day status is published; with it, nothing private or numeric is', () => {
    const programs = [
      program([
        habit('public'),
        habit('secret', { private: true, title: 'Example private habit', steps: ['Secret step'] }),
      ]),
    ];
    const done = doneAll(opened(programs));
    const off = { ...optedIn(programs, [done]), settings };
    expect(JSON.stringify(published(off))).not.toContain('"day"');
    const on = optedIn(programs, [done]);
    const text = JSON.stringify(published(on));
    expect(text).toContain('"day":"cleared"');
    for (const leak of ['Example private habit', 'Secret step', 'Example public'])
      expect(text).not.toContain(leak);
    // No counts or fractions of any kind.
    expect(text).not.toMatch(/\d/);
    for (const props of published(on)) {
      expect(
        Object.keys(props).every((key) => ['kind', 'title', 'time', 'day'].includes(key)),
      ).toBe(true);
      for (const value of Object.values(props)) expect(typeof value).toBe('string');
    }
  });

  test('a Day Cleared from yesterday never carries into today, and midnight goes stale', () => {
    const programs = [program([habit('a', { weekdays: [3, 4, 5] })])];
    const yesterday = shiftDate(thursday, -1);
    const clearedYesterday = doneAll(
      opened(programs, yesterday, new Date(2026, 9, 7, 13, 0).toISOString()),
    );
    const s = optedIn(programs, [clearedYesterday]);
    expect(widgetDayStatus(s, yesterday)).toBe('cleared');
    expect(todayWidgetTimeline(s, at(thursday, 480)).map((e) => e.props)).toEqual([
      { kind: 'empty', day: 'absent' },
      { kind: 'stale' },
    ]);
    const late = todayWidgetTimeline(s, at(yesterday, 1439));
    expect(late[0].props).toEqual({ kind: 'empty', day: 'cleared' });
    expect(late[late.length - 1]).toEqual({ date: at(thursday, 0), props: { kind: 'stale' } });
  });

  test('timelines stay ordered and a repeated publish is identical', () => {
    const programs = [
      program([habit('check'), timedRoutine('run'), timedRoutine('walk', { preferredStart: 900 })]),
    ];
    const s = optedIn(programs, [generateDay(thursday, settings, programs)]);
    const first = todayWidgetTimeline(s, at(thursday, 500));
    expect(todayWidgetTimeline(s, at(thursday, 500))).toEqual(first);
    expect(first.every((e, i) => i === 0 || e.date > first[i - 1].date)).toBe(true);
    expect(
      first.every(
        (e, i) => i === 0 || JSON.stringify(e.props) !== JSON.stringify(first[i - 1].props),
      ),
    ).toBe(true);
    expect(first.slice(0, -1).every((e) => e.props.day === 'remaining')).toBe(true);
  });

  test('a successful save publishes the saved Day Cleared state; a failed save publishes nothing', async () => {
    const programs = [program([habit('a')])];
    const next = optedIn(programs, [doneAll(opened(programs))]);
    const seen: TodayWidgetProps[][] = [];
    const publish = async (saved: State) =>
      void seen.push(todayWidgetTimeline(saved, at(thursday, 600)).map((e) => e.props));
    await saveThenPublish(next, async () => {}, publish);
    expect(seen[0][0]).toEqual({ kind: 'empty', day: 'cleared' });
    await expect(
      saveThenPublish(
        next,
        async () => {
          throw new Error('Synthetic save failure');
        },
        publish,
      ),
    ).rejects.toThrow('Synthetic save failure');
    expect(seen).toHaveLength(1);
  });
});

test('the widget opt-in is a validated device preference that setup imports cannot change', () => {
  const on = {
    ...emptyState(),
    source: 'personal' as const,
    settings: { ...emptyState().settings, widgetDayStatus: true },
  };
  expect(decodeState(JSON.parse(JSON.stringify(on))).settings.widgetDayStatus).toBe(true);
  expect(() =>
    decodeState({ ...on, settings: { ...on.settings, widgetDayStatus: 'yes' } }),
  ).toThrow(/widget/);
  const setup = (extra: object) =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: [],
      settings: { ...emptyState().settings, ...extra },
      notes: [],
    });
  expect(parseSetup(setup({ widgetDayStatus: false }), on).settings.widgetDayStatus).toBe(true);
  const off = { ...on, settings: emptyState().settings };
  expect(
    parseSetup(setup({ widgetDayStatus: true }), off).settings.widgetDayStatus,
  ).toBeUndefined();
});

describe('restoring a backup never turns on the public Day Cleared widget', () => {
  const programs: Program[] = [
    {
      id: 'example-program',
      title: 'Example program',
      group: 'Daily',
      goalIds: [],
      routines: [
        {
          id: 'secret',
          title: 'Example private habit',
          duration: null,
          weekdays: [4],
          preferredStart: null,
          enabled: true,
          fixed: false,
          steps: [],
          bundledInto: null,
          checklist: true,
          private: true,
        },
      ],
    },
  ];
  const at13 = new Date(2026, 9, 8, 13, 0).toISOString();
  const cleared = (widgetDayStatus?: boolean): State => {
    const opened = ensureChecklistDay(date, emptyState().settings, programs, undefined, at13);
    return {
      ...emptyState(),
      source: 'personal',
      programs,
      settings: {
        ...emptyState().settings,
        ...(widgetDayStatus !== undefined && { widgetDayStatus }),
      },
      days: { [date]: setStatus(opened, opened.blocks[0].id, 'done', at13) },
    };
  };

  test('enabled, disabled and default backups all restore with the option off', () => {
    for (const choice of [true, false, undefined]) {
      const raw = encodeBackup(cleared(choice), at13);
      expect(raw).not.toContain('widgetDayStatus');
      const restored = parseBackup(raw).state;
      expect(restored.settings.widgetDayStatus).toBeUndefined();
      expect(restored.days[date]).toEqual(cleared(choice).days[date]);
    }
  });

  test('a file that still carries the option, from an earlier build, restores with it off', () => {
    const legacy = JSON.parse(encodeBackup(cleared(), at13));
    legacy.state.settings.widgetDayStatus = true;
    expect(parseBackup(JSON.stringify(legacy)).state.settings.widgetDayStatus).toBeUndefined();
  });

  test('the first publish after a restore carries no day status, even if the device had it on', async () => {
    const device = cleared(true);
    expect(todayWidgetTimeline(device, at(date, 600))[0].props.day).toBe('cleared');
    const restored = parseBackup(encodeBackup(device, at13)).state;
    const published: TodayWidgetProps[] = [];
    await saveThenPublish(
      restored,
      async () => {},
      async (saved) =>
        void published.push(...todayWidgetTimeline(saved, at(date, 600)).map((e) => e.props)),
    );
    expect(published.every((props) => props.day === undefined)).toBe(true);
    expect(JSON.stringify(published)).not.toContain('Example private habit');
  });
});

describe('the morning anchor on the Lock Screen', () => {
  // Synthetic: the fixture's anchor is "Up by 7:10", every day from Monday, November 2, 2026.
  const wednesday = '2026-11-04';
  const anchored = (change: (r: Routine) => Routine = (r) => r): State => {
    const s = anchorState();
    s.programs = s.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (r.id === 'up' ? change(r) : r)),
    }));
    s.days[wednesday] = day(wednesday, [
      block('up', null, null, {
        routineId: 'up',
        programId: 'mornings',
        title: 'Example private morning',
        checklist: true,
      }),
      block('pub', 540, 60, { title: 'Example public session' }),
      block('sec', 720, 30, { title: 'Example private session', private: true }),
    ]);
    return s;
  };

  test('every entry, the midnight one included, carries the anchor time and never a private title', () => {
    const s = anchored((r) => ({ ...r, private: true, title: 'Example private morning' }));
    for (const optIn of [false, true]) {
      const state = { ...s, settings: { ...s.settings, widgetDayStatus: optIn } };
      for (const minute of [300, 600, 1380]) {
        const entries = todayWidgetTimeline(state, at(wednesday, minute));
        expect(entries.length).toBeGreaterThan(1);
        for (const { props } of entries) {
          expect(props.anchor).toBe('7:10 AM');
          for (const value of Object.values(props)) expect(typeof value).toBe('string');
          expect(
            Object.keys(props).every((key) =>
              [
                'kind',
                'title',
                'time',
                'startsAt',
                'endsAt',
                'later',
                'laterTime',
                'todo',
                'day',
                'anchor',
                'upBy',
              ].includes(key),
            ),
          ).toBe(true);
        }
        // After midnight, before the app is opened: the anchor time and nothing from today.
        expect(entries.at(-1)).toEqual({
          date: at(shiftDate(wednesday, 1), 0),
          props: { kind: 'stale', anchor: '7:10 AM' },
        });
        const text = JSON.stringify(entries);
        for (const leak of ['Example private morning', 'Example private session', 'Mornings'])
          expect(text).not.toContain(leak);
      }
    }
    expect(todayWidgetTimeline(s, at(wednesday, 500))[0].props).toEqual({
      kind: 'next',
      title: 'Example public session',
      time: '9:00 AM – 10:00 AM',
      anchor: '7:10 AM',
    });
  });

  test('a new time shows on every entry; no anchor, or a paused one, publishes none', () => {
    const changed = anchored((r) => withAnchorTime(r, 6 * 60 + 45, wednesday));
    expect(widgetAnchor(changed)).toBe('6:45 AM');
    expect(
      todayWidgetTimeline(changed, at(wednesday, 600)).every((e) => e.props.anchor === '6:45 AM'),
    ).toBe(true);
    const paused = anchored((r) => ({ ...r, enabled: false }));
    expect(anchorRoutine(paused)).toBeNull();
    for (const state of [paused, emptyState(), stateWith(day(wednesday, [block('a', 540, 60)]))]) {
      expect(widgetAnchor(state)).toBeUndefined();
      expect(JSON.stringify(todayWidgetTimeline(state, at(wednesday, 600)))).not.toContain(
        '"anchor"',
      );
    }
  });
});

describe('the Today widget in every state of the day', () => {
  const wednesday = '2026-11-04';
  const checklist = (id: string, extra: Partial<Block> = {}) =>
    block(id, null, null, { checklist: true, ...extra });

  test('with nothing left on the clock, the next open public objective on the list leads', () => {
    const plan = day(date, [
      block('done', 540, 30, { status: 'done', actualAt: '2026-10-08T13:30:00.000Z' }),
      checklist('secret', { title: 'Example private habit', private: true }),
      checklist('maybe', { title: 'Example optional habit', optional: true }),
      checklist('skipped', { status: 'skipped', actualAt: '2026-10-08T13:00:00.000Z' }),
      checklist('ticked', { status: 'done', actualAt: '2026-10-08T13:00:00.000Z' }),
      checklist('open', { title: `  ${'y'.repeat(80)}  ` }),
    ]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 600));
    expect(entries[0].props).toEqual({ kind: 'clear', todo: `${'y'.repeat(59)}…` });
    expect(JSON.stringify(entries)).not.toMatch(/private habit|optional habit|Example skipped/);
    // Midnight never carries it: tomorrow's list is not known yet.
    expect(entries.at(-1)!.props).toEqual({ kind: 'stale' });
    // A block on the clock leads instead; the list's objective waits.
    const busy = day(date, [checklist('open'), block('t', 720, 30)]);
    const first = todayWidgetTimeline(stateWith(busy), at(date, 600))[0].props;
    expect(first).toMatchObject({ kind: 'next', title: 'Example t' });
    expect(first.todo).toBeUndefined();
    // Every objective done, skipped or private: nothing to name.
    const none = day(date, [
      checklist('secret', { private: true }),
      checklist('maybe', { optional: true }),
    ]);
    expect(todayWidgetTimeline(stateWith(none), at(date, 600))[0].props).toEqual({ kind: 'empty' });
  });

  test('a timed objective whose time is over is still on the list, so the widget names it', () => {
    const late = stateWith(day(date, [block('gym', 1050, 60)]));
    const entries = todayWidgetTimeline(late, at(date, 1080));
    expect(entries[0].props).toMatchObject({ kind: 'now', title: 'Example gym' });
    expect(entries[0].props.todo).toBeUndefined();
    // From its end, the clock has nothing left but the list still has it open.
    expect(entries[1]).toEqual({
      date: at(date, 1110),
      props: { kind: 'clear', todo: 'Example gym' },
    });
    const evening = todayWidgetTimeline(late, at(date, 1200))[0].props;
    expect(evening).toEqual({ kind: 'clear', todo: 'Example gym' });
    expect(todayListTimeline(late, at(date, 1200))[0].props.tasks).toEqual([
      expect.objectContaining({ id: 'gym', title: 'Example gym' }),
    ]);
    // With an untimed one too, it is the list's first open row, in the list's order.
    const both = stateWith(day(date, [checklist('habit'), block('gym', 1050, 60)]));
    const rows = todayListTimeline(both, at(date, 1200))[0].props.tasks!;
    expect(rows.map((t) => t.id).sort()).toEqual(['gym', 'habit']);
    expect(todayWidgetTimeline(both, at(date, 1200))[0].props.todo).toBe(rows[0].title);
  });

  test("the next objective follows the order of the day, and a private routine's never shows", () => {
    const s = anchorState();
    s.programs = s.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (r.id === 'up' ? { ...r, private: true } : r)),
    }));
    s.days[wednesday] = day(wednesday, [
      checklist('later', { title: 'Example evening habit' }),
      checklist('up', { routineId: 'up', programId: 'mornings', title: 'Example private morning' }),
    ]);
    const props = todayWidgetTimeline(s, at(wednesday, 600))[0].props;
    expect(props.todo).toBe('Example evening habit');
    expect(JSON.stringify(todayWidgetTimeline(s, at(wednesday, 300)))).not.toContain(
      'Example private morning',
    );
  });

  test('medium names the public block after the one shown, never a private one', () => {
    const plan = day(date, [
      block('a', 540, 60),
      block('secret', 610, 20, { title: 'Example private call', private: true }),
      block('b', 660, null),
      block('c', 720, 30, { status: 'skipped', actualAt: '2026-10-08T15:00:00.000Z' }),
    ]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 500));
    expect(
      entries.map((e) => [e.props.kind, e.props.title, e.props.later, e.props.laterTime]),
    ).toEqual([
      ['next', 'Example a', 'Example b', '11:00 AM'],
      ['now', 'Example a', 'Example b', '11:00 AM'],
      ['next', 'Example b', undefined, undefined],
      ['clear', undefined, undefined, undefined],
      ['stale', undefined, undefined, undefined],
    ]);
    expect(JSON.stringify(entries)).not.toContain('Example private call');
  });

  test('a block on the clock with a length carries its start and end for the bar, and nothing else does', () => {
    const plan = day(date, [block('a', 540, 60), block('point', 700, null)]);
    const entries = todayWidgetTimeline(stateWith(plan), at(date, 500));
    const now = entries.find((e) => e.props.kind === 'now' && e.props.title === 'Example a')!;
    expect(new Date(now.props.startsAt!)).toEqual(at(date, 540));
    expect(new Date(now.props.endsAt!)).toEqual(at(date, 600));
    for (const entry of entries.filter((e) => e !== now)) {
      expect(entry.props.startsAt).toBeUndefined();
      expect(entry.props.endsAt).toBeUndefined();
    }
    // Opened in the middle of the block, the first entry carries it too.
    expect(todayWidgetTimeline(stateWith(plan), at(date, 570))[0].props).toMatchObject({
      kind: 'now',
      startsAt: at(date, 540).toISOString(),
      endsAt: at(date, 600).toISOString(),
    });
  });

  test('the Home Screen shows the Up by time until it passes, and after midnight; never a title', () => {
    const s = anchorState();
    s.days[wednesday] = day(wednesday, [
      block('pub', 540, 60, { title: 'Example public session' }),
    ]);
    const entries = todayWidgetTimeline(s, at(wednesday, 300));
    expect(
      entries.map((e) => [
        e.date.getHours() * 60 + e.date.getMinutes(),
        e.props.kind,
        e.props.upBy,
      ]),
    ).toEqual([
      [300, 'next', '7:10 AM'],
      // 7:10 AM: the time has passed, so the Home Screen drops it; the Lock Screen keeps `anchor`.
      [430, 'next', undefined],
      [540, 'now', undefined],
      [600, 'clear', undefined],
      [0, 'stale', undefined],
    ]);
    expect(entries.every((e) => e.props.anchor === '7:10 AM')).toBe(true);
    expect(todayWidgetTimeline(s, at(wednesday, 431))[0].props.upBy).toBeUndefined();
    expect(JSON.stringify(entries)).not.toContain('Up by 7:10');
    // Without an anchor there is no morning line and no extra entry.
    const plain = stateWith(day(wednesday, [block('pub', 540, 60)]));
    const without = todayWidgetTimeline(plain, at(wednesday, 300));
    expect(without.map((e) => e.props.kind)).toEqual(['next', 'now', 'clear', 'stale']);
    expect(JSON.stringify(without)).not.toContain('upBy');
  });

  test('every value of every new field is a string, so iOS can store the timeline', () => {
    const s = anchorState();
    s.days[wednesday] = day(wednesday, [
      block('a', 540, 60),
      block('b', 660, 30),
      checklist('open'),
    ]);
    s.settings = { ...s.settings, widgetDayStatus: true };
    for (const minute of [0, 300, 570, 700, 1439])
      for (const { props } of todayWidgetTimeline(s, at(wednesday, minute)))
        for (const value of Object.values(props)) expect(typeof value).toBe('string');
  });
});

test('the publish key ignores the moving first instant but sees any visible change', () => {
  const plan = day(date, [block('a', 540, 60), block('b', 660, 30)]);
  const s = stateWith(plan);
  const key = (state: State, minute: number, on = date) =>
    widgetTimelineKey(todayWidgetTimeline(state, at(on, minute)));
  expect(key(s, 610)).toBe(key(s, 620));
  expect(key(s, 610)).not.toBe(key(s, 670));
  const done = stateWith(day(date, [plan.blocks[0], { ...plan.blocks[1], status: 'done' }]));
  expect(key(done, 610)).not.toBe(key(s, 610));
  const optedIn = { ...s, settings: { ...s.settings, widgetDayStatus: true } };
  expect(key(optedIn, 610)).not.toBe(key(s, 610));
  expect(key(stateWith(), 600)).not.toBe(key(stateWith(), 600, shiftDate(date, 1)));
});

// Jest gives each file its own process.env, so a test cannot switch the zone: these run only when
// the process starts in New York (CI has a dedicated step with TZ=America/New_York).
const inNewYork = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York';
(inNewYork ? describe : describe.skip)('daylight saving boundaries (America/New_York)', () => {
  test('in the repeated hour, a boundary that maps to the earlier 1 AM is dropped, keeping order', () => {
    const fallBack = '2026-11-01';
    // 01:30 in the second (standard-time) occurrence of 1 AM.
    const now = new Date(Date.UTC(2026, 10, 1, 6, 30));
    expect([now.getHours(), now.getMinutes()]).toEqual([1, 30]);
    const plan = day(fallBack, [block('a', 105, 30), block('b', 600, 30)]);
    const entries = todayWidgetTimeline(stateWith(plan), now);
    expect(entries.every((e, i) => i === 0 || e.date > entries[i - 1].date)).toBe(true);
    expect(entries[0].date).toBe(now);
  });

  test('a 25-hour day keeps wall-clock boundaries, its own date, and one midnight', () => {
    const fallBack = '2026-11-01';
    expect(new Date(2026, 10, 1, 0).getTimezoneOffset()).not.toBe(
      new Date(2026, 10, 1, 12).getTimezoneOffset(),
    );
    expect(shiftDate(fallBack, 1)).toBe('2026-11-02');
    expect(shiftDate('2026-03-08', -1)).toBe('2026-03-07');
    const plan = day(fallBack, [block('a', 540, 60), block('b', 1380, 30)]);
    const entries = todayWidgetTimeline(stateWith(plan), at(fallBack, 30));
    expect(
      entries.map((e) => [localDate(e.date), e.date.getHours() * 60 + e.date.getMinutes()]),
    ).toEqual([
      [fallBack, 30],
      [fallBack, 540],
      [fallBack, 600],
      [fallBack, 1380],
      [fallBack, 1410],
      ['2026-11-02', 0],
    ]);
    expect(entries.every((e, i) => i === 0 || e.date > entries[i - 1].date)).toBe(true);
  });
});
