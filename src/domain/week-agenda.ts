import { Block, State, daysBetween, displayTime } from './model';
import { DayOutcome, dayOutcome, dayProgress } from './objectives';
import { ensureDay, projectRotation } from './rotation';
import { isPlanWorkout } from './sequence';

// Week's agenda: what each day holds, read-only. A saved day shows what is on it; a later day that
// has not been opened is computed on a copy with the same rule Today uses to open a day, so nothing
// is created by looking. Rotation workouts on later days are projections and say so. A past day
// that was never opened shows nothing: it is not recorded, not empty. One before the first day the
// app saved is from before tracking started, so it is not a day left unopened either.

export type AgendaEntry = {
  id: string;
  title: string;
  /** "6:30 PM" for a planned commitment or a timed workout; null for anything without a time. */
  time: string | null;
  status: Block['status'];
  /** A rotation workout expected on this day, not yet placed. */
  projected: boolean;
  /** The day it was moved from, when a shift moved it here. */
  movedFrom: string | null;
};

export type AgendaDay = {
  date: string;
  /** The day has a saved plan (it was opened or planned). */
  saved: boolean;
  /** A past day never opened, earlier than any saved day: before tracking started. */
  beforeStart: boolean;
  outcome: DayOutcome;
  /** Planned commitments with a start time, in order (workouts excluded: each carries its own time). */
  timed: AgendaEntry[];
  /** Workouts on the day: placed ones with their status and time, projected ones marked. */
  workouts: AgendaEntry[];
  /**
   * Untimed objectives that count toward Day Cleared (workouts excluded): `due` leaves out the
   * skipped ones, which are excused and counted apart.
   */
  habits: { due: number; done: number; skipped: number };
  /** Rotation programs resting on this day. */
  rest: string[];
  /**
   * Required objectives done of the day's total, by the one Day Cleared count (`dayProgress`), so
   * the card reads as Today does. Zero for a past day never opened.
   */
  progress: { done: number; total: number };
  /**
   * For a later day: what is planned so far, that count plus the projected rotation workouts and
   * their companions, which are placed when the day opens.
   */
  planned: number;
  /**
   * The routines on the day: placed on it (bundled steps aside), and rotation workouts projected
   * onto it, for the companions that come with them (`configuredOccurrences`).
   */
  routineIds: { placed: string[]; projected: string[] };
};

export function weekAgenda(state: State, dates: string[], today: string, now: string): AgendaDay[] {
  const rotations = state.programs.filter((p) => p.rotation);
  const span = Math.max(0, ...dates.map((d) => (d >= today ? daysBetween(today, d) + 1 : 0)));
  const projections = new Map(
    rotations.map((p) => [p.id, span ? projectRotation(state, p, today, span) : []]),
  );
  let first: string | undefined;
  for (const date of Object.keys(state.days)) if (first === undefined || date < first) first = date;
  return dates.map((date) => {
    const saved = state.days[date];
    const day = saved ?? (date >= today ? ensureDay(state, date, now).days[date] : undefined);
    const blocks = day?.blocks ?? [];
    const at = (b: Block) => (b.start !== null && !b.checklist ? displayTime(b.start) : null);
    const timed = blocks
      .filter((b) => at(b) !== null && !isPlanWorkout(state, b.routineId))
      .sort((a, b) => a.start! - b.start!)
      .map((b) => entry(b, at(b)));
    const workouts = blocks
      .filter((b) => isPlanWorkout(state, b.routineId))
      .map((b) => entry(b, at(b)));
    const rest: string[] = [];
    const projectedIds = new Set<string>();
    if (date >= today)
      for (const program of rotations) {
        const projected = projections.get(program.id)?.find((p) => p.date === date);
        if (!projected) continue;
        if (projected.kind === 'rest') rest.push(program.title);
        else if (
          projected.kind === 'projected' &&
          projected.routineId &&
          !blocks.some((b) => b.routineId === projected.routineId)
        ) {
          const routine = program.routines.find((r) => r.id === projected.routineId);
          if (routine) projectedIds.add(routine.id);
          if (routine)
            workouts.push({
              id: `projected:${date}:${routine.id}`,
              title: routine.title,
              time: null,
              status: 'planned',
              projected: true,
              movedFrom: null,
            });
        }
      }
    const habits = blocks.filter(
      (b) => (b.start === null || b.checklist) && !b.optional && !isPlanWorkout(state, b.routineId),
    );
    // Companions of a projected workout come with it, so they are due too (still a projection).
    const onDay = new Set(blocks.map((b) => b.routineId));
    const movedAway = new Set(day?.moved?.map((m) => m.routineId) ?? []);
    const companions = state.programs
      .flatMap((p) => p.routines)
      .filter(
        (r) =>
          r.enabled &&
          !r.optional &&
          r.follows?.some((id) => projectedIds.has(id)) &&
          !onDay.has(r.id) &&
          !movedAway.has(r.id),
      ).length;
    // A skipped habit is excused: it leaves the count of habits due, as it leaves the day's.
    const skipped = habits.filter((b) => b.status === 'skipped').length;
    const progress = dayProgress(day, state.programs, date);
    return {
      date,
      saved: !!saved,
      beforeStart: !saved && date < today && (first === undefined || date < first),
      outcome: dayOutcome(state, date),
      timed,
      workouts,
      habits: {
        due: habits.length - skipped + companions,
        done: habits.filter((b) => b.status === 'done').length,
        skipped,
      },
      rest,
      progress: { done: progress.done, total: progress.total },
      planned: progress.total + workouts.filter((w) => w.projected).length + companions,
      routineIds: {
        placed: [...new Set(blocks.flatMap((b) => (b.routineId ? [b.routineId] : [])))],
        projected: [...projectedIds],
      },
    };
  });
}

function entry(b: Block, time: string | null): AgendaEntry {
  return {
    id: b.id,
    title: b.title,
    time,
    status: b.status,
    projected: false,
    movedFrom: b.movedFrom ?? null,
  };
}
