import { Routine, State, displayTime, localDate, shiftDate } from './model';
import { ensureDay, projectRotation } from './rotation';

// Tomorrow's preview on Today: read-only. It is computed on a copy of state with the same rules
// Today uses to open a day, and nothing is saved, so looking at it can never create, duplicate or
// complete anything. Rotation workouts are a projection (they are only placed on their own day);
// timed commitments appear only if they are already on tomorrow's plan, never with invented times.

export type PreviewItem = {
  id: string;
  title: string;
  kind: 'objective' | 'optional' | 'timed' | 'workout' | 'rest';
  /** "7:00 PM" for a timed commitment already on the plan. */
  time: string | null;
  /** A rotation workout (or its companion) that depends on what happens today. */
  projected: boolean;
};

export type TomorrowPreview = { date: string; protected: boolean; items: PreviewItem[] };

function routines(state: State): Routine[] {
  return state.programs.flatMap((p) => p.routines);
}

export function tomorrowPreview(state: State, now: Date): TomorrowPreview {
  const today = localDate(now);
  const date = shiftDate(today, 1);
  // The same opening rule as Today, applied to a copy; `state` itself is never changed.
  const day = ensureDay(state, date, now.toISOString()).days[date];
  const items: PreviewItem[] = [];
  const present = new Set(day.blocks.map((b) => b.routineId));
  for (const b of day.blocks.filter((x) => x.start === null || x.checklist)) {
    if (b.status !== 'planned') continue;
    items.push({
      id: b.id,
      title: b.title,
      kind: b.optional ? 'optional' : 'objective',
      time: null,
      projected: false,
    });
  }
  for (const b of day.blocks
    .filter((x) => x.start !== null && !x.checklist && x.status === 'planned')
    .sort((x, y) => x.start! - y.start!))
    items.push({
      id: b.id,
      title: b.title,
      kind: 'timed',
      time: displayTime(b.start!),
      projected: false,
    });
  for (const program of state.programs.filter((p) => p.rotation)) {
    const next = projectRotation(state, program, today, 2)[1];
    if (!next) continue;
    if (next.kind === 'rest') {
      items.push({
        id: `rest:${program.id}`,
        title: `${program.title} · rest day`,
        kind: 'rest',
        time: null,
        projected: false,
      });
      continue;
    }
    if (next.kind !== 'projected' || !next.routineId || present.has(next.routineId)) continue;
    const workout = routines(state).find((r) => r.id === next.routineId);
    if (!workout) continue;
    items.push({
      id: `projected:${workout.id}`,
      title: workout.title,
      kind: 'workout',
      time: null,
      projected: true,
    });
    // Its companions come with it, if it happens as projected.
    for (const c of routines(state).filter(
      (r) => r.enabled && r.follows?.includes(workout.id) && !present.has(r.id),
    ))
      items.push({
        id: `projected:${c.id}`,
        title: c.title,
        kind: c.optional ? 'optional' : 'objective',
        time: null,
        projected: true,
      });
  }
  const order: Record<PreviewItem['kind'], number> = {
    workout: 0,
    objective: 1,
    optional: 2,
    rest: 3,
    timed: 4,
  };
  return {
    date,
    protected: !!day.protection,
    items: items
      .map((item, i) => ({ item, i }))
      // The projected workout and its companions together first, then the rest by kind.
      .sort(
        (a, b) =>
          Number(!a.item.projected) - Number(!b.item.projected) ||
          order[a.item.kind] - order[b.item.kind] ||
          a.i - b.i,
      )
      .map(({ item }) => item),
  };
}
