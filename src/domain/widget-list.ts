import { withDay } from './data';
import { recordKind } from './linked';
import { Block, State, displayDate, displayTime, localDate } from './model';
import { setStatus } from './planner';
import { privateRoutineIds } from './objectives';
import { publicListObjectives, timedBlock, widgetTitle } from './widget';

// The Large Home Screen widget: today's public objectives as a task list. A one-tap objective can
// be ticked on the widget (iOS 17); the tick lives in the widget's stored timeline until the app
// next opens and records it as Done at the time of the tap. The widget never decides Day Cleared
// and never shows a private title or count. Objectives that record something (a workout, a
// review) are listed but open the app instead.

export type WidgetTask = {
  id: string;
  title: string;
  time?: string;
  /** Done in the app. Absent rather than false: the timeline is stored in UserDefaults. */
  done?: true;
  /** Can be ticked on the widget: a one-tap objective still planned. */
  tap?: true;
};

export type TodayListProps = {
  /** The local date the list belongs to; ticks are applied to this date only. */
  date: string;
  /** "Mon, Nov 9". */
  label: string;
  tasks: WidgetTask[];
  /** Public objectives left off the list for lack of room. */
  more?: number;
  /** Task ID → when it was ticked on the widget, not yet recorded by the app. */
  ticked?: Record<string, string>;
  /** Ticks from an earlier day the app has not recorded yet, kept until it does. */
  earlier?: WidgetTick[];
  /** After midnight: the list is no longer today's. */
  stale?: true;
};

export type TodayListEntry = { date: Date; props: TodayListProps };

/** One tick made on the widget, read back from its stored timeline. */
export type WidgetTick = { date: string; id: string; at: string };

/** Rows that fit a Large widget with its header. */
export const WIDGET_LIST_LIMIT = 7;

/**
 * An objective completed with one tap in the app: no form, log, timer, review or bundled steps.
 * Study completes with one tap unless a timer session is running, which the app checks on apply.
 */
export function oneTap(state: State, block: Block): boolean {
  if (block.bundledSteps?.length) return false;
  const kind = recordKind(state, block);
  return kind === null || kind === 'study';
}

/**
 * A fixed calendar commitment: a timed block added by hand, not a routine's objective (on Today it
 * sits under Schedule, below the list).
 */
function commitment(block: Block): boolean {
  return !block.routineId && timedBlock(block);
}

/**
 * Today's public, required objectives that are planned or done (skipped ones are left out), in the
 * order of the day, as on Today (`dayListOrder`). When there are more than fit, the rows shown are
 * chosen planned commitments first (a meeting is never hidden behind an evening habit), then the
 * other planned objectives, then finished work, so nothing still to do hides behind what is done.
 * The rows chosen still show in the order of the day.
 */
export function widgetTasks(state: State, date: string): { tasks: WidgetTask[]; more: number } {
  const ordered = publicListObjectives(state, date);
  const shown = new Set(
    [
      ...ordered.filter((b) => b.status === 'planned' && commitment(b)),
      ...ordered.filter((b) => b.status === 'planned' && !commitment(b)),
      ...ordered.filter((b) => b.status === 'done'),
    ]
      .slice(0, WIDGET_LIST_LIMIT)
      .map((b) => b.id),
  );
  const tasks = ordered
    .filter((b) => shown.has(b.id))
    .map((b): WidgetTask => {
      const task: WidgetTask = { id: b.id, title: widgetTitle(b.title) };
      if (timedBlock(b)) task.time = displayTime(b.start);
      if (b.status === 'done') task.done = true;
      else if (oneTap(state, b)) task.tap = true;
      return task;
    });
  return { tasks, more: ordered.length - tasks.length };
}

/** Whether a tick can still be recorded: a public, one-tap objective still planned on its date. */
function stillOpen(state: State, hidden: Set<string>, tick: WidgetTick): Block | undefined {
  const block = state.days[tick.date]?.blocks.find((b) => b.id === tick.id);
  return block &&
    block.status === 'planned' &&
    !block.private &&
    !(block.routineId && hidden.has(block.routineId)) &&
    oneTap(state, block)
    ? block
    : undefined;
}

/** Ticks still waiting for the app, kept only for tasks that can still be ticked. */
function keptTicks(tasks: WidgetTask[], ticked: Record<string, string>): Record<string, string> {
  const open = new Set(tasks.filter((t) => t.tap).map((t) => t.id));
  return Object.fromEntries(Object.entries(ticked).filter(([id]) => open.has(id)));
}

/**
 * Today's list from now until midnight, then a stale entry. One entry covers the day, so a tick
 * made on the widget is never lost to a later entry. Pending ticks for today are carried into the
 * new timeline until the app records them. Only the day's entry holds them: the widget changes
 * just the entry on screen, so a copy elsewhere would outlive a tick taken back. The day's entry
 * stays stored, and is read, until the app next publishes.
 */
export function todayListTimeline(
  state: State,
  now: Date,
  pending: WidgetTick[] = [],
): TodayListEntry[] {
  const date = localDate(now);
  const { tasks, more } = widgetTasks(state, date);
  const ticked = keptTicks(
    tasks,
    Object.fromEntries(pending.filter((t) => t.date === date).map((t) => [t.id, t.at])),
  );
  const hidden = privateRoutineIds(state.programs);
  const earlier = pending.filter((t) => t.date !== date && stillOpen(state, hidden, t));
  const props: TodayListProps = { date, label: displayDate(date), tasks };
  if (more > 0) props.more = more;
  if (Object.keys(ticked).length) props.ticked = ticked;
  if (earlier.length) props.earlier = earlier;
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const stale: TodayListProps = { date, label: props.label, tasks: [], stale: true };
  if (earlier.length) stale.earlier = earlier;
  return [
    { date: now, props },
    { date: midnight, props: stale },
  ];
}

/**
 * Every tick stored in a widget timeline, as read back from the widget. A stale entry's `ticked`
 * counts only when no live entry holds that date: the live entry is the one the widget changes, so
 * it alone says whether a tick still stands.
 */
export function ticksIn(entries: { props: Partial<TodayListProps> }[]): WidgetTick[] {
  const ticks = new Map<string, WidgetTick>();
  const add = (date: unknown, id: unknown, at: unknown) => {
    if (typeof date === 'string' && typeof id === 'string' && typeof at === 'string')
      ticks.set(`${date}:${id}`, { date, id, at });
  };
  const live = new Set(entries.filter((e) => e.props && !e.props.stale).map((e) => e.props.date));
  for (const { props } of entries) {
    if (props?.ticked && typeof props.ticked === 'object' && !(props.stale && live.has(props.date)))
      for (const [id, at] of Object.entries(props.ticked)) add(props.date, id, at);
    if (Array.isArray(props?.earlier))
      for (const tick of props.earlier) add(tick?.date, tick?.id, tick?.at);
  }
  return [...ticks.values()];
}

/**
 * Records ticks made on the widget as Done, at the time of the tap. Only a tick on a public,
 * one-tap objective that is still planned on that date is applied; anything else (Undone, skipped,
 * changed or removed in the app since) is left as it is. A tap time that is unreadable, not on that
 * date or in the future becomes `now`, so a tick on today never gets another day's time; a late
 * tick from an earlier day is recorded like a Done added to that day later in the app.
 */
export function applyWidgetTicks(
  state: State,
  ticks: WidgetTick[],
  now: Date,
  skip: ReadonlySet<string> = new Set(),
): { state: State; applied: string[] } {
  const hidden = privateRoutineIds(state.programs);
  const applied: string[] = [];
  let next = state;
  for (const tick of ticks) {
    const block = stillOpen(next, hidden, tick);
    if (!block || skip.has(block.id)) continue;
    const day = next.days[tick.date];
    const tapped = new Date(tick.at);
    const at =
      !Number.isNaN(tapped.getTime()) && localDate(tapped) === tick.date && tapped <= now
        ? tapped.toISOString()
        : now.toISOString();
    try {
      next = withDay(next, setStatus(day, block.id, 'done', at));
      applied.push(block.id);
    } catch {
      // The slot is now occupied: leave it for the user to settle in the app.
    }
  }
  return { state: next, applied };
}
