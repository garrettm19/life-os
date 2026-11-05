import { Block, Day, Program, Routine, dateObject, shiftDate } from './model';
import { onItsDays } from './repeat';

export function copyBlock(block: Block): Block {
  return {
    ...block,
    steps: [...block.steps],
    ...(block.bundledSteps && {
      bundledSteps: block.bundledSteps.map((step) => ({ ...step, steps: [...step.steps] })),
    }),
  };
}

// Called on copied occurrences only. Each child has at most one parent per day.
export function attachBundles(date: string, blocks: Block[], programs: Program[]): void {
  const weekday = dateObject(date).getDay();
  const children = programs.flatMap((p) =>
    p.routines
      .filter((r) => r.enabled && r.bundledInto && r.weekdays?.includes(weekday))
      .map((r) => ({ p, r, id: `${date}:bundled:${r.id}` })),
  );
  for (const block of blocks) {
    // A workout moved here by a sequence shift belongs to its original day's configuration: it
    // never hosts this day's bundled steps (it moves only while nothing on it is recorded).
    if (block.movedFrom !== undefined && block.status === 'planned') delete block.bundledSteps;
    if (block.status !== 'planned' || !block.bundledSteps) continue;
    block.bundledSteps = block.bundledSteps.filter(
      (step) =>
        step.status !== 'planned' ||
        children.some((child) => child.id === step.id && child.r.bundledInto === block.programId),
    );
  }
  const claimed = new Set(blocks.flatMap((b) => b.bundledSteps?.map((step) => step.id) ?? []));
  for (const { p, r, id } of children) {
    if (claimed.has(id)) continue;
    const parent = blocks
      .filter(
        (b) =>
          b.programId === r.bundledInto &&
          b.status === 'planned' &&
          b.movedFrom === undefined &&
          programs
            .find((program) => program.id === b.programId)
            ?.routines.some(
              (routine) =>
                routine.id === b.routineId &&
                !routine.bundledInto &&
                routine.enabled &&
                // A rotation workout is due by its rotation, not by weekday.
                (routine.weekdays?.includes(weekday) ||
                  !!programs
                    .find((program) => program.id === b.programId)
                    ?.rotation?.order.includes(routine.id)),
            ),
      )
      .sort((a, b) => (a.start ?? 1440) - (b.start ?? 1440) || a.id.localeCompare(b.id))[0];
    if (!parent) continue;
    // Upgrade old planned text-only bundles without inferring completion from the parent.
    const legacy = `${r.title}${r.steps.length ? ': ' + r.steps.join(', ') : ''}`;
    const parentRoutine = programs
      .find((program) => program.id === parent.programId)
      ?.routines.find((routine) => routine.id === parent.routineId);
    if (!parentRoutine?.steps.includes(legacy))
      parent.steps = parent.steps.filter((text) => text !== legacy);
    parent.bundledSteps = [
      ...(parent.bundledSteps ?? []),
      {
        id,
        routineId: r.id,
        programId: p.id,
        title: r.title,
        steps: [...r.steps],
        status: 'planned',
        actualAt: null,
        ...(r.optional && { optional: true }),
      },
    ];
    claimed.add(id);
  }
}

/**
 * A program's occurrences on `days` by status. With `today`, one still planned on an earlier day is
 * `missed` (not done) rather than `planned` (still open).
 */
export function programCoverage(programId: string, days: (Day | undefined)[], today?: string) {
  const occurrences = days.flatMap((day) => {
    const blocks = day?.blocks ?? [];
    const past = today !== undefined && !!day && day.date < today;
    return [
      ...blocks.filter((b) => b.programId === programId),
      ...blocks.flatMap((b) => b.bundledSteps ?? []).filter((step) => step.programId === programId),
    ].map((item) => ({ status: item.status, past }));
  });
  const planned = occurrences.filter((item) => item.status === 'planned');
  return {
    done: occurrences.filter((item) => item.status === 'done').length,
    planned: planned.filter((item) => !item.past).length,
    missed: planned.filter((item) => item.past).length,
    skipped: occurrences.filter((item) => item.status === 'skipped').length,
  };
}

/**
 * A program's week in one line for Week: done against the occurrences its schedule gives this week
 * (`target`), then what earlier days left not done, what is still open today and later, and what
 * was skipped. `weekly` is the count in an ordinary week, so a repeat in an off week says it is not
 * due. Setup problems are listed in Programs and Settings.
 */
export function coverageLine(
  coverage: { done: number; planned: number; missed?: number; skipped: number },
  target: number,
  weekly: number,
): string {
  return [
    target ? `${coverage.done} of ${target} done this week` : `${coverage.done} done this week`,
    !target && weekly ? 'not due this week' : null,
    coverage.missed ? `${coverage.missed} not done` : null,
    coverage.planned ? `${coverage.planned} still open` : null,
    coverage.skipped ? `${coverage.skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Any seven consecutive days hold each weekday once. */
const ANY_WEEK = Array.from({ length: 7 }, (_, i) => shiftDate('2026-01-05', i));

/** The routines a day holds: placed on it, and projected onto it (rotation workouts). */
export type HeldRoutines = { placed: ReadonlySet<string>; projected: ReadonlySet<string> };

/**
 * How many times a program's timed or checklist routines come up on `dates` (Week passes the week
 * on screen), by the one due-day rule: a repeat counts only in its repeat weeks, and a bundled step
 * only on days an enabled parent session of its program is due. A companion is due on a day that
 * holds an occurrence of a routine it follows: with `held`, where it is placed, or where a
 * routine it follows is projected and not placed yet. Without dates, one week of the configured
 * weekdays, with every repeat due, and a companion on the weekdays of the routines it follows.
 */
export function configuredOccurrences(
  program: Program,
  programs: Program[],
  dates?: string[],
  held?: (date: string) => HeldRoutines,
): number {
  const own = (r: Routine, date: string) => onItsDays(dates ? r : { weekdays: r.weekdays }, date);
  const routines = programs.flatMap((p) => p.routines);
  const due = (r: Routine, date: string): boolean => {
    if (own(r, date)) return true;
    if (!r.follows?.length) return false;
    if (held) {
      const day = held(date);
      return day.placed.has(r.id) || r.follows.some((id) => day.projected.has(id));
    }
    return !dates && routines.some((x) => x.enabled && r.follows!.includes(x.id) && own(x, date));
  };
  const counted = (r: Routine) => r.duration !== null || !!r.checklist;
  return program.routines
    .filter((r) => r.enabled && r.weekdays !== null && (r.bundledInto || counted(r)))
    .reduce(
      (total, r) =>
        total +
        (dates ?? ANY_WEEK).filter(
          (date) =>
            due(r, date) &&
            (!r.bundledInto ||
              !!programs
                .find((p) => p.id === r.bundledInto)
                ?.routines.some(
                  (parent) =>
                    parent.enabled && !parent.bundledInto && counted(parent) && due(parent, date),
                )),
        ).length,
      0,
    );
}
