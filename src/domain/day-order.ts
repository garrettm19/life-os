import { Block, Program, State } from './model';
import { openObjective } from './objectives';

// The order of the day: the one rule for the order Today's list and the Large widget show a
// day's objectives in. A routine's `dayOrder` is configuration read at display time, like its
// links; nothing is copied into a day, so changing the order never touches history.

/** The highest `dayOrder` a routine can hold. */
export const DAY_ORDER_MAX = 10000;

/** The gap between places when the order is saved, so a routine can later be slotted between. */
const DAY_ORDER_STEP = 10;

/** A stored `dayOrder` is a whole number from 0 to 10000. */
export function validateDayOrder(value: unknown) {
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > DAY_ORDER_MAX)
  )
    throw new Error('Invalid order of the day.');
}

/**
 * One place in the order of the day: a routine, or every workout of one rotation together, since
 * only one of them is due on a day.
 */
export type DayOrderEntry = {
  /** The routine's ID, or `rotation:` and the program's ID. */
  key: string;
  title: string;
  /** The program's name; for a rotation, how many workouts it holds. */
  detail: string;
  /** The routines that take this place. */
  routineIds: string[];
};

/** Where a routine sorts: its order, if it has one, then its position in Programs. */
type Place = { order: number | null; catalog: number };

/**
 * Every routine's place. A routine with a `dayOrder` comes first, ascending; one without follows in
 * Programs order (program, then routine within it). A rotation's workouts share one place: the
 * lowest order among them and the position of the first.
 */
function places(programs: readonly Program[]): Map<string, Place> {
  const result = new Map<string, Place>();
  let catalog = 0;
  for (const program of programs)
    for (const routine of program.routines)
      result.set(routine.id, { order: routine.dayOrder ?? null, catalog: catalog++ });
  for (const program of programs) {
    const members = (program.rotation?.order ?? [])
      .map((id) => result.get(id))
      .filter((place): place is Place => !!place);
    if (!members.length) continue;
    const orders = members.flatMap((m) => (m.order === null ? [] : [m.order]));
    const shared: Place = {
      order: orders.length ? Math.min(...orders) : null,
      catalog: Math.min(...members.map((m) => m.catalog)),
    };
    for (const id of program.rotation!.order) if (result.has(id)) result.set(id, shared);
  }
  return result;
}

/** Sort key: tier, then the value within it. Lower comes first. */
function sortKey(
  block: Pick<Block, 'routineId' | 'start' | 'checklist'>,
  at: Map<string, Place>,
): number[] {
  const place = block.routineId ? at.get(block.routineId) : undefined;
  if (place && place.order !== null) return [0, place.order, place.catalog];
  if (place) return [1, place.catalog, 0];
  // A block with no routine (added by hand, or its routine since deleted): by its time, else last.
  // A checklist block's stored start is ignored, as everywhere.
  if (block.start !== null && !block.checklist) return [2, block.start, 0];
  return [3, 0, 0];
}

/**
 * A day's blocks in the order of the day: routines with a `dayOrder` first, ascending; then
 * routines without one in Programs order; then blocks with no routine by start time, and last
 * those without a time. Rotation workouts of one program share a place. Ties keep Programs order,
 * then the order given. Today's list and the Large widget both sort with this, so they never
 * disagree.
 */
export function dayListOrder<T extends Pick<Block, 'routineId' | 'start' | 'checklist'>>(
  blocks: readonly T[],
  programs: readonly Program[],
): T[] {
  const at = places(programs);
  return blocks
    .map((block, index) => ({ block, index, key: sortKey(block, at) }))
    .sort(
      (a, b) =>
        a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.index - b.index,
    )
    .map((x) => x.block);
}

/**
 * Every place the order of the day sets, in the current order: each routine that can come up on a
 * day (enabled and not a bundled step, which sits inside its parent) and one entry per rotation,
 * labeled with its program. Paused routines keep the order they have and are not listed.
 */
export function dayOrderEntries(programs: readonly Program[]): DayOrderEntry[] {
  // Each entry sorts by the place of its first routine, which a rotation's workouts share.
  const entries: { entry: DayOrderEntry; routineId: string; start: null }[] = [];
  for (const program of programs) {
    const members = new Set(program.rotation?.order ?? []);
    const workouts = program.routines.filter((r) => members.has(r.id));
    if (workouts.some((r) => r.enabled))
      entries.push({
        entry: {
          key: `rotation:${program.id}`,
          title: program.title,
          detail: `Rotation · ${workouts.length} workout${workouts.length === 1 ? '' : 's'}`,
          routineIds: workouts.map((r) => r.id),
        },
        routineId: workouts[0].id,
        start: null,
      });
    for (const routine of program.routines)
      if (routine.enabled && !routine.bundledInto && !members.has(routine.id))
        entries.push({
          entry: {
            key: routine.id,
            title: routine.title,
            detail: program.title,
            routineIds: [routine.id],
          },
          routineId: routine.id,
          start: null,
        });
  }
  return dayListOrder(entries, programs).map((x) => x.entry);
}

/**
 * Saves the order of the day: every routine of each entry takes its place, 0, 10, 20 and so on, so
 * a routine added later can be slotted between two others. Routines not listed keep theirs.
 */
export function withDayOrder(state: State, entries: readonly DayOrderEntry[]): State {
  const step = Math.max(
    1,
    Math.min(DAY_ORDER_STEP, Math.floor(DAY_ORDER_MAX / Math.max(1, entries.length - 1))),
  );
  const order = new Map<string, number>();
  entries.forEach((entry, index) => {
    for (const id of entry.routineIds) order.set(id, Math.min(DAY_ORDER_MAX, index * step));
  });
  return {
    ...state,
    programs: state.programs.map((program) =>
      program.routines.some((r) => order.has(r.id))
        ? {
            ...program,
            routines: program.routines.map((r) =>
              order.has(r.id) ? { ...r, dayOrder: order.get(r.id)! } : r,
            ),
          }
        : program,
    ),
  };
}

/**
 * The entries with the one at `index` taken out and put at place `to` (0 is the top); the others
 * keep their order. Moving to the top or the bottom is one step however far the entry travels.
 */
export function moveEntryTo<T>(entries: readonly T[], index: number, to: number): T[] {
  if (index < 0 || index >= entries.length || to < 0 || to >= entries.length) return [...entries];
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Today's one list: every checklist objective and every routine's block, timed or not, in the order
 * of the day. A block added by hand stays out of it, below the list under Schedule or Needs a time,
 * as a calendar commitment rather than an objective of the day's routines.
 */
export function todayList<T extends Pick<Block, 'routineId' | 'start' | 'checklist'>>(
  blocks: readonly T[],
  programs: readonly Program[],
): T[] {
  return dayListOrder(
    blocks.filter((b) => b.checklist || !!b.routineId),
    programs,
  );
}

/**
 * The next thing to do: the first block in list order that still holds a required objective open,
 * by the leaves Day Cleared counts (`openObjective`). A block with bundled steps is open while one
 * of its required steps is, whatever its own check says. An optional objective never holds this
 * place, as it never holds back Day Cleared.
 */
export function nextOpen<T extends Block>(list: readonly T[]): T | undefined {
  return list.find((block) => !!openObjective(block));
}
