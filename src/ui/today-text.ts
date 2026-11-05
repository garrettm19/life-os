import { Block, Day, Program, displayTime } from '../domain/model';
import { objectiveLeaves } from '../domain/objectives';
import { doneAt } from './objective-row';

/** A planned time with its AM or PM joined by a no-break space, so a caption never splits it. */
const clockTime = (minutes: number) => displayTime(minutes).replace(' ', '\u00a0');

/**
 * 10:00–11:00 AM, or 11:30 AM – 12:15 PM when the range crosses noon or midnight. A range within
 * one half of the day is one unbreakable run (a word joiner after the dash), so a narrow caption
 * moves it to the next line whole rather than ending a line on "10:00–".
 */
export function timeRange(block: Block): string {
  const start = clockTime(block.start!);
  if (block.duration == null) return start;
  const end = clockTime(block.start! + block.duration);
  const [startClock, startPeriod] = start.split('\u00a0');
  const [endClock, endPeriod] = end.split('\u00a0');
  return startPeriod === endPeriod
    ? `${startClock}–\u2060${endClock}\u00a0${endPeriod}`
    : `${start} – ${end}`;
}

/** The status line under a recorded objective; open checklist items need none. */
export function recordedSub(block: Block): string | null {
  if (block.status === 'done') {
    const at = doneAt(block.actualAt);
    return at ? `Done · ${at}` : 'Done';
  }
  if (block.status === 'skipped') return 'Skipped';
  return null;
}

/** Today's title: a greeting for the time of day on the phone's clock. */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * What Day cleared lists as done: the required objectives that are done, the same set
 * `dayProgress` counts, so the list and "All 6 done" always agree. Optional objectives and a
 * container's own check are left out. Today's list comes first, in the order of the day, then any
 * other block on the day.
 */
export function clearedTitles(day: Day, list: readonly Block[], programs: Program[]): string[] {
  const blocks = [...list, ...day.blocks.filter((block) => !list.includes(block))];
  return objectiveLeaves({ ...day, blocks }, programs)
    .filter((leaf) => !leaf.optional && leaf.status === 'done')
    .map((leaf) => leaf.title);
}
