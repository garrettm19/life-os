import { Routine, daysBetween } from './model';

// Daily alternation: a routine with variants (for example upper-body and lower-body mobility) takes
// one variant per calendar day, counted from an anchor date. It depends only on the date, so a
// missed day never shifts the pattern and never leaves anything owed.

/** Which variant a date takes, or null for a routine that does not alternate. */
export function variantIndex(routine: Routine, date: string): number | null {
  const alternate = routine.alternate;
  if (!alternate || alternate.variants.length < 2) return null;
  const n = alternate.variants.length;
  return (((daysBetween(alternate.anchor, date) % n) + n) % n) as number;
}

/** The title and steps an occurrence of the routine takes on a date. */
export function occurrenceText(routine: Routine, date: string): { title: string; steps: string[] } {
  const index = variantIndex(routine, date);
  if (index === null) return { title: routine.title, steps: [...routine.steps] };
  const variant = routine.alternate!.variants[index];
  return { title: `${routine.title} · ${variant.title}`, steps: [...variant.steps] };
}
