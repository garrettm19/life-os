import { describe, expect, test } from '@jest/globals';
import { dayListOrder } from '../day-order';
import { Block, Program, Routine, State, emptyState } from '../model';
import { dayProgress } from '../objectives';
import {
  WIDGET_LIST_LIMIT,
  applyWidgetTicks,
  oneTap,
  ticksIn,
  todayListTimeline,
  widgetTasks,
} from '../widget-list';

// Synthetic objectives only: invented titles, no personal data.
const DATE = '2026-11-09';
const local = (hour: number, minute = 0, date = DATE) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

const routine = (id: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title: `Routine ${id}`,
  duration: null,
  weekdays: [1, 2, 3, 4, 5],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  routineId: id,
  programId: 'p',
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

function stateWith(routines: Routine[], blocks: Block[]): State {
  const s = emptyState();
  const program: Program = { id: 'p', title: 'Example', group: 'Example', goalIds: [], routines };
  s.programs = [program];
  s.days[DATE] = { date: DATE, blocks, revisions: [] };
  return s;
}

describe('the Large widget task list', () => {
  test('lists public required objectives; never a private, optional or skipped one', () => {
    const s = stateWith(
      [
        routine('walk'),
        routine('secret', { private: true, title: 'Example private habit' }),
        routine('weigh', { capture: 'weight' }),
        routine('extra'),
        routine('skipped'),
      ],
      [
        block('walk'),
        block('secret', { title: 'Example private habit' }),
        block('flagged', { routineId: null, private: true, title: 'Example private block' }),
        block('weigh'),
        block('extra', { optional: true }),
        block('skipped', { status: 'skipped' }),
        block('run', { routineId: null, start: 7 * 60 + 30, duration: 30, checklist: false }),
      ],
    );
    const { tasks, more } = widgetTasks(s, DATE);
    // In the order of the day, as on Today: routines in Programs order, then a block added by hand.
    expect(tasks.map((t) => t.id)).toEqual(['walk', 'weigh', 'run']);
    expect(tasks[2]).toEqual({ id: 'run', title: 'Example run', time: '7:30 AM', tap: true });
    // A weigh-in records a value: listed, but it opens the app.
    expect(tasks[1].tap).toBeUndefined();
    expect(more).toBe(0);
    const published = JSON.stringify(todayListTimeline(s, local(9)));
    for (const secret of ['Example private habit', 'Example private block', 'secret', 'flagged'])
      expect(published).not.toContain(secret);
  });

  test('a checklist objective has no time, even with a start stored, as on Today', () => {
    const s = stateWith(
      [routine('stretch'), routine('walk')],
      [
        block('stretch', { start: 10 * 60, duration: 15 }),
        block('run', { routineId: null, start: 11 * 60, duration: 30, checklist: false }),
        block('walk'),
      ],
    );
    const { tasks } = widgetTasks(s, DATE);
    expect(tasks.map((t) => t.id)).toEqual(['stretch', 'walk', 'run']);
    expect(tasks[0]).toEqual({ id: 'stretch', title: 'Example stretch', tap: true });
  });

  test('shows planned objectives first when there are more than fit', () => {
    const ids = Array.from({ length: WIDGET_LIST_LIMIT + 3 }, (_, i) => `h${i}`);
    const s = stateWith(
      ids.map((id) => routine(id)),
      ids.map((id, i) => block(id, { status: i < 5 ? 'done' : 'planned' })),
    );
    const { tasks, more } = widgetTasks(s, DATE);
    expect(tasks).toHaveLength(WIDGET_LIST_LIMIT);
    expect(more).toBe(3);
    expect(tasks.filter((t) => !t.done)).toHaveLength(5);
    // Order stays as stored: finished work keeps its place, it is never moved.
    expect(tasks.map((t) => t.id)).toEqual(['h0', 'h1', ...ids.slice(5)]);
  });

  test('on a busy day a fixed meeting is kept on the widget ahead of routine objectives', () => {
    const ids = Array.from({ length: WIDGET_LIST_LIMIT + 2 }, (_, i) => `h${i}`);
    const meeting = block('meeting', {
      routineId: null,
      programId: null,
      title: 'Example meeting',
      start: 11 * 60,
      duration: 30,
      fixed: true,
      checklist: false,
    });
    const errand = block('errand', { routineId: null, programId: null, checklist: false });
    const s = stateWith(
      ids.map((id) => routine(id)),
      [...ids.map((id) => block(id)), meeting, errand],
    );
    const { tasks, more } = widgetTasks(s, DATE);
    expect(tasks).toHaveLength(WIDGET_LIST_LIMIT);
    expect(more).toBe(4);
    // The meeting is chosen first, but shown at its place in the order of the day, after the
    // routines, as on Today; an untimed block added by hand gets no such priority.
    expect(tasks.map((t) => t.id)).toEqual([...ids.slice(0, WIDGET_LIST_LIMIT - 1), 'meeting']);
    expect(tasks.at(-1)).toMatchObject({ title: 'Example meeting', time: '11:00 AM' });
  });

  test('follows the order of the day, the same order Today uses', () => {
    const s = stateWith(
      [
        routine('read', { dayOrder: 30 }),
        routine('wake', { dayOrder: 0 }),
        routine('walk', { dayOrder: 10 }),
        routine('later'),
      ],
      [block('later'), block('read'), block('walk'), block('wake')],
    );
    const blocks = s.days[DATE].blocks;
    const expected = dayListOrder(blocks, s.programs).map((b) => b.id);
    expect(expected).toEqual(['wake', 'walk', 'read', 'later']);
    expect(widgetTasks(s, DATE).tasks.map((t) => t.id)).toEqual(expected);
  });

  test('one tap only for objectives the app completes with one tap', () => {
    const s = stateWith(
      [routine('walk'), routine('lift'), routine('notes', { capture: 'rules' })],
      [],
    );
    s.workoutTemplates = [{ routineId: 'lift' } as State['workoutTemplates'][number]];
    expect(oneTap(s, block('walk'))).toBe(true);
    expect(oneTap(s, block('lift'))).toBe(false);
    expect(oneTap(s, block('notes'))).toBe(false);
    expect(
      oneTap(
        s,
        block('parent', {
          bundledSteps: [
            { id: 'step', routineId: 'walk', title: 'Step', status: 'planned', actualAt: null },
          ],
        } as Partial<Block>),
      ),
    ).toBe(false);
  });

  test('one entry for the day, a stale one at midnight, and pending ticks carried over', () => {
    const s = stateWith([routine('walk'), routine('read')], [block('walk'), block('read')]);
    // Yesterday's read is still planned, so a tick made on it before midnight is kept.
    s.days['2026-11-08'] = { date: '2026-11-08', blocks: [block('read')], revisions: [] };
    const yesterday = local(23, 0, '2026-11-08').toISOString();
    const entries = todayListTimeline(s, local(9), [
      { date: DATE, id: 'walk', at: local(8).toISOString() },
      // A tick for a task no longer on the list is not carried.
      { date: DATE, id: 'gone', at: local(8).toISOString() },
      { date: '2026-11-08', id: 'read', at: yesterday },
      { date: '2026-11-07', id: 'read', at: yesterday },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].props).toMatchObject({
      date: DATE,
      label: 'Mon, Nov 9',
      ticked: { walk: local(8).toISOString() },
      earlier: [{ date: '2026-11-08', id: 'read', at: yesterday }],
    });
    expect(entries[1].date).toEqual(local(24));
    expect(entries[1].props).toMatchObject({ date: DATE, tasks: [], stale: true });
    // Only the day's entry holds today's ticks: it is the one the widget changes.
    expect(entries[1].props.ticked).toBeUndefined();
    expect(ticksIn(entries)).toEqual([
      { date: DATE, id: 'walk', at: local(8).toISOString() },
      { date: '2026-11-08', id: 'read', at: yesterday },
    ]);
    // Once recorded, a tick is no longer carried.
    const recorded = applyWidgetTicks(s, ticksIn(entries), local(10)).state;
    const next = todayListTimeline(recorded, local(10), ticksIn(entries));
    expect(next[0].props.ticked).toBeUndefined();
    expect(next[0].props.earlier).toBeUndefined();
    expect(recorded.days['2026-11-08'].blocks[0]).toMatchObject({
      status: 'done',
      actualAt: yesterday,
    });
    // Nothing null or undefined reaches the widget's stored timeline.
    expect(JSON.stringify(entries)).not.toContain('null');
  });
});

describe('ticks made on the widget', () => {
  test('are recorded as Done at the time of the tap, through the one Day Cleared rule', () => {
    const s = stateWith([routine('walk'), routine('read')], [block('walk'), block('read')]);
    const tapped = local(8, 15).toISOString();
    const { state, applied } = applyWidgetTicks(
      s,
      [
        { date: DATE, id: 'walk', at: tapped },
        { date: DATE, id: 'read', at: local(9).toISOString() },
      ],
      local(10),
    );
    expect(applied).toEqual(['walk', 'read']);
    expect(state.days[DATE].blocks[0]).toMatchObject({ status: 'done', actualAt: tapped });
    expect(dayProgress(state.days[DATE], state.programs, DATE).cleared).toBe(true);
    // Applying the same ticks again changes nothing.
    expect(
      applyWidgetTicks(state, [{ date: DATE, id: 'walk', at: tapped }], local(11)).applied,
    ).toEqual([]);
  });

  test('never touch a private, recording, skipped, undone-elsewhere or study-in-progress objective', () => {
    const s = stateWith(
      [
        routine('secret', { private: true }),
        routine('weigh', { capture: 'weight' }),
        routine('walk'),
        routine('read'),
      ],
      [block('secret'), block('weigh'), block('walk', { status: 'skipped' }), block('read')],
    );
    const ticks = ['secret', 'weigh', 'walk', 'read', 'missing'].map((id) => ({
      date: DATE,
      id,
      at: local(8).toISOString(),
    }));
    const { state, applied } = applyWidgetTicks(s, ticks, local(10), new Set(['read']));
    expect(applied).toEqual([]);
    expect(state).toBe(s);
  });

  test('a tick taken back on the widget stays taken back', () => {
    const s = stateWith([routine('a')], [block('a')]);
    const tapped = local(8).toISOString();
    const [today, stale] = todayListTimeline(s, local(9), [{ date: DATE, id: 'a', at: tapped }]);
    expect(today.props.ticked).toEqual({ a: tapped });
    // Even with a copy in the stale entry, the day's entry decides: the widget changes only the
    // entry on screen.
    const copy = { ...stale, props: { ...stale.props, ticked: { a: tapped } } };
    const untick = [{ ...today, props: { ...today.props, ticked: {} } }, copy];
    expect(ticksIn(untick)).toEqual([]);
    expect(applyWidgetTicks(s, ticksIn(untick), local(10)).applied).toEqual([]);
    expect(todayListTimeline(s, local(10), ticksIn(untick))[0].props.ticked).toBeUndefined();
    // Ticked again later: the new tap time stands.
    const again = local(9, 30).toISOString();
    const retick = [{ ...today, props: { ...today.props, ticked: { a: again } } }, copy];
    expect(ticksIn(retick)).toEqual([{ date: DATE, id: 'a', at: again }]);
    // A stale entry on its own still counts.
    expect(ticksIn([copy])).toEqual([{ date: DATE, id: 'a', at: tapped }]);
  });

  test('a tap time that cannot be right becomes now', () => {
    const s = stateWith(
      [routine('a'), routine('b'), routine('c'), routine('d'), routine('e')],
      [block('a'), block('b'), block('c')],
    );
    s.days['2026-11-08'] = { date: '2026-11-08', blocks: [block('d'), block('e')], revisions: [] };
    const now = local(10);
    const { state, applied } = applyWidgetTicks(
      s,
      [
        { date: DATE, id: 'a', at: 'soon' },
        { date: DATE, id: 'b', at: local(23, 0, '2026-11-08').toISOString() },
        { date: DATE, id: 'c', at: local(11).toISOString() },
        { date: '2026-11-08', id: 'd', at: 'soon' },
        { date: '2026-11-08', id: 'e', at: local(0, 2).toISOString() },
      ],
      now,
    );
    expect(applied).toEqual(['a', 'b', 'c', 'd', 'e']);
    // A tick on today never gets another day's time.
    expect(state.days[DATE].blocks.map((b) => b.actualAt)).toEqual([
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    ]);
    // A late tick from an earlier day is recorded now, like a Done added to that day in the app.
    expect(state.days['2026-11-08'].blocks.map((b) => b.actualAt)).toEqual([
      now.toISOString(),
      now.toISOString(),
    ]);
  });

  test('reading ticks back ignores anything malformed', () => {
    expect(
      ticksIn([
        { props: {} },
        { props: { date: DATE, ticked: { a: 'x', b: 5 as unknown as string } } },
        { props: { ticked: { c: 'y' } } },
      ]),
    ).toEqual([{ date: DATE, id: 'a', at: 'x' }]);
  });
});
