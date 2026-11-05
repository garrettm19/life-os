import { anchorRoutine, currentUpBy } from './anchor';
import { dayListOrder } from './day-order';
import { Block, Day, State, displayTime, localDate } from './model';
import { dayOutcome, dayProgress, privateRoutineIds } from './objectives';

// What the small, medium and Lock Screen widgets may show, as a timeline built from saved state.
// `todayWidgetTimeline` makes one entry for now, one at each remaining start and end of a public
// timed block, and a `stale` entry at midnight, so the widget moves on without the app.
// `widgetTimelineKey` lets a publisher skip a timeline identical to the last one. Privacy is decided
// here, not in the layouts: a private routine or occurrence is left out, no entry carries a count,
// a streak or a recorded figure, and the day status (from `dayOutcome`, the one Day Cleared rule)
// is added only when the user turns it on. The large list widget is in widget-list.ts, and the
// SwiftUI layouts and their publishers are in src/widget.
// Tests: __tests__/widget.test.ts, and src/widget/__tests__ for the serialized layouts.

/**
 * Today's status for the widget, derived from the same stored Day Cleared rule as Today and the
 * streak (`dayOutcome`), never from the visible schedule. It includes private objectives, so it is
 * published only when the user opts in (`settings.widgetDayStatus`), and never with titles or counts.
 */
export type WidgetDayStatus =
  'cleared' | 'remaining' | 'plan' | 'unresolved' | 'protected' | 'empty' | 'absent';

// Home Screen content is visible to anyone holding the phone: publish only a short title and time.
export type TodayWidgetProps = {
  /** The visible schedule only. `clear` means no public block is left on the clock, not Day Cleared. */
  kind: 'now' | 'next' | 'clear' | 'empty' | 'stale';
  // Absent rather than null: the timeline is stored in UserDefaults, which silently rejects null.
  title?: string;
  time?: string;
  /**
   * On a `now` entry for a block with a length: its start and end as ISO instants, so the bar under
   * NOW empties by itself. The same time as `time`, never a count.
   */
  startsAt?: string;
  endsAt?: string;
  /** The public scheduled block after the one shown, and its start, for the medium widget's THEN. */
  later?: string;
  laterTime?: string;
  /**
   * With no public block left on the clock (`clear` or `empty`): the first open objective of the
   * Today list widget (public and required, untimed or with its time over), so the widget never
   * says nothing is left while the list still has something. The list widget already publishes the
   * same title.
   */
  todo?: string;
  /** Present only with the opt-in; never on the midnight `stale` entry. */
  day?: WidgetDayStatus;
  /**
   * The morning anchor's time ("7:10 AM"), the only thing the Lock Screen accessory shows. It is the
   * time alone, never the routine's title, and the same on every entry, the midnight `stale` one
   * included, so the Lock Screen still reads it before the app is opened in the morning.
   */
  anchor?: string;
  /**
   * The anchor time for the Home Screen: only on today's entries before that time. The midnight
   * `stale` entry shows `anchor` there instead, since it is always before the morning.
   */
  upBy?: string;
};
export type TodayWidgetEntry = { date: Date; props: TodayWidgetProps };

export const WIDGET_TITLE_LIMIT = 60;

const end = (b: Block) => b.start! + (b.duration ?? 0);

/** On the clock as Today shows it: a checklist objective has no time, even with a start stored. */
export function timedBlock(b: Block): b is Block & { start: number } {
  return b.start !== null && !b.checklist;
}

/** A title as a widget shows it: trimmed and at most `WIDGET_TITLE_LIMIT` characters. */
export function widgetTitle(title: string): string {
  const t = title.trim();
  return t.length > WIDGET_TITLE_LIMIT ? `${t.slice(0, WIDGET_TITLE_LIMIT - 1)}…` : t;
}

/** The public scheduled blocks still to come at `minute`: the one shown first, then the rest. */
function upcoming(day: Day | undefined, minute: number): Block[] {
  return (day?.blocks ?? [])
    .filter((b) => timedBlock(b) && !b.private && b.status === 'planned' && end(b) > minute)
    .sort((a, b) => a.start! - b.start! || a.id.localeCompare(b.id));
}

export function todayWidgetAt(day: Day | undefined, minute: number): TodayWidgetProps {
  const [next] = upcoming(day, minute);
  if (!next)
    return {
      kind: (day?.blocks ?? []).some((b) => timedBlock(b) && !b.private) ? 'clear' : 'empty',
    };
  return {
    kind: next.start! <= minute ? 'now' : 'next',
    title: widgetTitle(next.title),
    time: next.duration
      ? `${displayTime(next.start!)} – ${displayTime(end(next))}`
      : displayTime(next.start!),
  };
}

/**
 * The objectives the Today list widget may show for a date: public, required and not
 * skipped, in the order of the day. One rule for the list and the Today widget's `todo`.
 */
export function publicListObjectives(state: State, date: string): Block[] {
  const hidden = privateRoutineIds(state.programs);
  return dayListOrder(
    (state.days[date]?.blocks ?? []).filter(
      (b) =>
        !b.private &&
        !(b.routineId && hidden.has(b.routineId)) &&
        !b.optional &&
        b.status !== 'skipped',
    ),
    state.programs,
  );
}

/**
 * The first open objective on the Today list widget at `minute` that the clock no longer shows:
 * untimed, or timed and already over (a missed workout stays open on the list), as the Today
 * widget shows it.
 */
export function nextListObjective(state: State, date: string, minute: number): string | undefined {
  const block = publicListObjectives(state, date).find(
    (b) => b.status === 'planned' && (!timedBlock(b) || end(b) <= minute),
  );
  return block ? widgetTitle(block.title) : undefined;
}

function withoutPrivateTitles(state: State, day: Day | undefined): Day | undefined {
  if (!day) return day;
  const hidden = privateRoutineIds(state.programs);
  if (!hidden.size && !day.blocks.some((b) => b.private)) return day;
  return {
    ...day,
    blocks: day.blocks.map((b) =>
      b.private || (b.routineId !== null && hidden.has(b.routineId)) ? { ...b, private: true } : b,
    ),
  };
}

export function widgetDayStatus(state: State, date: string): WidgetDayStatus {
  const outcome = dayOutcome(state, date);
  if (outcome !== 'open') return outcome;
  const progress = dayProgress(state.days[date], state.programs, date);
  if (progress.missingTimed > 0) return 'plan';
  return progress.remaining > 0 ? 'remaining' : 'unresolved';
}

/**
 * Identifies what a timeline would show. The first entry starts "now" and always differs, so it is
 * keyed by its props; later entries keep their dates (which include the next midnight).
 */
export function widgetTimelineKey(entries: TodayWidgetEntry[]): string {
  return JSON.stringify(
    entries.map((entry, i) => (i === 0 ? entry.props : [entry.date.getTime(), entry.props])),
  );
}

/**
 * The time of the morning anchor set now, for the Lock Screen: a time the user chose to show, so it
 * is published even when the routine is private (its title never is). Absent without an enabled
 * anchor.
 */
export function widgetAnchor(state: State): string | undefined {
  const minute = anchorMinute(state);
  return minute === null ? undefined : displayTime(minute);
}

function anchorMinute(state: State): number | null {
  const routine = anchorRoutine(state);
  return routine ? currentUpBy(routine) : null;
}

export function todayWidgetTimeline(state: State, now: Date): TodayWidgetEntry[] {
  const date = localDate(now);
  const day = withoutPrivateTitles(state, state.days[date]),
    minute = now.getHours() * 60 + now.getMinutes();
  // The status does not change with the clock, so one value covers every entry until midnight.
  const status = state.settings.widgetDayStatus === true ? widgetDayStatus(state, date) : undefined;
  const anchor = widgetAnchor(state);
  const upByMinute = anchorMinute(state);
  const withAnchor = (p: TodayWidgetProps): TodayWidgetProps => (anchor ? { ...p, anchor } : p);
  const at = (m: number) => {
    const d = new Date(now);
    d.setHours(0, m, 0, 0);
    return d;
  };
  const props = (m: number): TodayWidgetProps => {
    const p: TodayWidgetProps = todayWidgetAt(day, m);
    const [shown, following] = upcoming(day, m);
    if (p.kind === 'now' && shown.duration) {
      p.startsAt = at(shown.start!).toISOString();
      p.endsAt = at(end(shown)).toISOString();
    }
    if (following) {
      p.later = widgetTitle(following.title);
      p.laterTime = displayTime(following.start!);
    }
    const todo =
      p.kind === 'clear' || p.kind === 'empty' ? nextListObjective(state, date, m) : null;
    if (todo) p.todo = todo;
    if (status) p.day = status;
    if (anchor && upByMinute !== null && m < upByMinute) p.upBy = anchor;
    return withAnchor(p);
  };
  const boundaries = new Set<number>();
  for (const b of day?.blocks ?? [])
    if (b.status === 'planned' && timedBlock(b))
      for (const m of [b.start, end(b)]) if (m > minute && m < 1440) boundaries.add(m);
  // The Home Screen stops showing the Up by time once it has passed.
  if (anchor && upByMinute !== null && upByMinute > minute) boundaries.add(upByMinute);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const entries: TodayWidgetEntry[] = [
    { date: now, props: props(minute) },
    ...[...boundaries].sort((a, b) => a - b).map((m) => ({ date: at(m), props: props(m) })),
    // Tomorrow's plan may not exist or may change; never show today's plan after midnight. The
    // anchor time does not depend on the plan, so it stays.
    { date: midnight, props: withAnchor({ kind: 'stale' }) },
  ];
  // Keep only changes, in strictly increasing time (a daylight-saving gap can reorder wall times).
  const kept: TodayWidgetEntry[] = [];
  for (const entry of entries) {
    const last = kept[kept.length - 1];
    if (
      !last ||
      (entry.date > last.date && JSON.stringify(entry.props) !== JSON.stringify(last.props))
    )
      kept.push(entry);
  }
  return kept;
}
