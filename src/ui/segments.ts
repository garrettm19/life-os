import type { DayProgress } from '../domain/objectives';

export type SegmentState = 'done' | 'active' | 'open';

/** Above this many objectives the segmented bar becomes one continuous bar. */
export const SEGMENT_LIMIT = 24;

/**
 * One segment per objective the day counts, in reading order: done, then the objective in progress
 * (at most one), then what is still open. A skipped objective is excused, so it has no segment.
 * Counts come from `dayProgress`, the only Day Cleared rule.
 */
export function segmentStates(progress: DayProgress, hasActive: boolean): SegmentState[] | null {
  if (progress.total > SEGMENT_LIMIT) return null;
  const done = Math.min(progress.done, progress.total);
  const active = hasActive && progress.remaining > 0 && done < progress.total ? 1 : 0;
  const open = Math.max(0, progress.total - done - active);
  return [
    ...Array<SegmentState>(done).fill('done'),
    ...Array<SegmentState>(active).fill('active'),
    ...Array<SegmentState>(open).fill('open'),
  ];
}

/** Plain text while the day counts down; Ember when something stands in its way. */
export type Callout = { text: string; tone: 'text' | 'now' };

/**
 * The goal line beside the count: how far the day is from clearing. A day that is over (`past`)
 * gets no countdown: it already counts as not cleared, or as held when it is protected, though its
 * rows can still be recorded.
 */
export function callout(progress: DayProgress, past = false): Callout | null {
  if (progress.cleared) return null;
  if (progress.remaining > 0) {
    if (past)
      return progress.protected
        ? { text: `${progress.remaining} not done`, tone: 'text' }
        : { text: `Not cleared · ${progress.remaining} not done`, tone: 'now' };
    // Timed sessions missing from the board are part of what remains, but the board cannot act on
    // them until the day is generated, so the line says why instead of only counting.
    if (progress.remaining === progress.missingTimed)
      return { text: 'Not on the list yet', tone: 'now' };
    // Say how close the day is, not only what is left: the last one and the halfway point are felt.
    if (progress.remaining === 1) return { text: 'One more to clear the day', tone: 'text' };
    if (progress.done > 0 && progress.done * 2 >= progress.total)
      return { text: `Halfway there · ${progress.remaining} to go`, tone: 'text' };
    return { text: `${progress.remaining} to clear the day`, tone: 'text' };
  }
  // Everything required was skipped: excused, but nothing was done, so the day is not cleared.
  if (progress.skipped > 0) return { text: 'All skipped · not cleared', tone: 'now' };
  return null;
}

/** Spoken summary for the progress panel, read as one heading. */
export function progressLabel(progress: DayProgress, isToday: boolean, past = false): string {
  const scope = isToday ? "Today's objectives" : 'Objectives';
  const line = callout(progress, past);
  return `${scope}. ${progress.done} of ${progress.total} objectives complete.${line ? ` ${line.text}.` : ''}`;
}
