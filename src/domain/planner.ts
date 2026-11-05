import { onItsDays } from './repeat';
import { Block, Day, Program, Settings, dateObject, localDate, validateSettings } from './model';
import { attachBundles, copyBlock } from './bundles';
import { occurrenceText } from './alternation';

// The day plan. `generateDay` lays out a date: the work commitments from settings, then each
// routine due that date (`onItsDays`, repeat.ts), a fixed routine at its own start and a flexible
// one in the first free gap of its window (`findSlot`, a first-fit sweep over the occupied blocks).
// `ensureChecklistDay` brings a day's checklist items in line with the routines due without moving
// timed blocks, and `replanDay` places the planned flexible blocks again from a given time. Done,
// Skip and Undo (`setStatus`) change a block in place; every plan change keeps the previous blocks
// as a revision. Past days keep the timed routines they recorded as due. Times are minutes after
// local midnight. Tests: __tests__/planner.test.ts.

/** A block holding calendar time. A checklist item is never a slot, even with a stored start. */
export function occupied(b: Block): boolean {
  return b.start !== null && !b.checklist && b.duration !== null && b.status !== 'skipped';
}
/** A planned fixed meeting whose time or length is still unknown; a checklist item never is one. */
export function unconfirmedFixed(b: Block): boolean {
  return b.fixed && !b.checklist && b.status === 'planned' && !occupied(b);
}
export function overlaps(a: Block, b: Block): boolean {
  return (
    occupied(a) &&
    occupied(b) &&
    a.start! < b.start! + b.duration! &&
    b.start! < a.start! + a.duration!
  );
}
export function findSlot(
  blocks: Block[],
  duration: number,
  earliest: number,
  end: number,
): number | null {
  let cursor = earliest;
  for (const b of blocks.filter(occupied).sort((a, b) => a.start! - b.start!)) {
    if (b.start! + b.duration! <= cursor) continue;
    if (cursor + duration <= b.start!) return cursor + duration <= end ? cursor : null;
    cursor = Math.max(cursor, b.start! + b.duration!);
  }
  return cursor + duration <= end ? cursor : null;
}
export function makeBlock(
  id: string,
  title: string,
  start: number | null,
  duration: number | null,
  fixed = false,
): Block {
  return {
    id,
    title,
    start,
    duration,
    fixed,
    routineId: null,
    programId: null,
    status: 'planned',
    actualAt: null,
    steps: [],
    reason: null,
  };
}
export function commitments(date: string, s: Settings): Block[] {
  const day = dateObject(date).getDay(),
    result: Block[] = [];
  if (day > 0 && day < 6) {
    const meeting = (id: string, title: string, start: number | null, duration: number | null) => {
      if (start === null) return;
      const b = makeBlock(`${date}:${id}`, title, duration === null ? null : start, duration, true);
      if (duration === null) b.reason = 'Set the meeting duration before generating the full day.';
      result.push(b);
    };
    meeting('scrum', 'Scrum', s.scrumStart, s.scrumDuration);
    if (day === 4)
      meeting(
        'thursday-meeting',
        'Thursday meeting',
        s.thursdayMeetingStart,
        s.thursdayMeetingDuration,
      );
    if (s.workStart !== null && s.workEnd !== null) {
      let cursor = s.workStart,
        segment = 0;
      for (const b of result.filter(occupied).sort((a, b) => a.start! - b.start!)) {
        if (b.start! >= s.workEnd || b.start! + b.duration! <= cursor) continue;
        if (cursor < b.start!)
          result.push(
            makeBlock(`${date}:work-${segment++}`, 'Work', cursor, b.start! - cursor, true),
          );
        cursor = Math.max(cursor, b.start! + b.duration!);
      }
      if (cursor < s.workEnd)
        result.push(makeBlock(`${date}:work-${segment}`, 'Work', cursor, s.workEnd - cursor, true));
    }
    if (s.eveningWorkMinutes) {
      const work = makeBlock(`${date}:evening-work`, 'Finish work', null, s.eveningWorkMinutes);
      work.reason = 'Choose a feasible work slot; late evening timing is flexible.';
      result.push(work);
    }
  }
  return result;
}
export function revision(previous: Day, blocks: Block[], reason: string, now: string): Day {
  return {
    ...previous,
    blocks,
    revisions: [
      ...previous.revisions,
      {
        at: now,
        reason,
        blocks: previous.blocks.map(copyBlock),
      },
    ],
  };
}
export function generateDay(
  date: string,
  settings: Settings,
  programs: Program[],
  previous?: Day,
  now = new Date().toISOString(),
  /** Occurrences that must stay, such as workouts with logged sets. */
  keep: ReadonlySet<string> = new Set(),
): Day {
  validateSettings(settings);
  const d = dateObject(date).getDay();
  const commitmentsKey = JSON.stringify([
    settings.workStart,
    settings.workEnd,
    settings.scrumStart,
    settings.scrumDuration,
    settings.thursdayMeetingStart,
    settings.thursdayMeetingDuration,
    settings.eveningWorkMinutes,
  ]);
  const settingsChanged = previous?.commitmentsKey !== commitmentsKey;
  const movedOut = movedRoutines(previous);
  const activeIds = new Set(
    programs.flatMap((p) =>
      p.routines
        .filter((r) => r.enabled && !r.bundledInto && onItsDays(r, date) && !movedOut.has(r.id))
        .map((r) => r.id),
    ),
  );
  const systemId = (b: Block) =>
    b.id === `${date}:scrum` ||
    b.id === `${date}:thursday-meeting` ||
    b.id === `${date}:evening-work` ||
    b.id.startsWith(`${date}:work-`);
  const blocks = previous
    ? previous.blocks
        .filter(
          (b) =>
            // A moved-in occurrence is a deliberate placement and is never regenerated here.
            b.movedFrom !== undefined ||
            keep.has(b.id) ||
            !(
              b.status === 'planned' &&
              !b.bundledSteps?.some((step) => step.status !== 'planned') &&
              ((systemId(b) && settingsChanged) ||
                (b.start === null &&
                  (systemId(b) || (b.routineId !== null && activeIds.has(b.routineId)))) ||
                (b.checklist &&
                  b.start === null &&
                  b.routineId !== null &&
                  !activeIds.has(b.routineId)))
            ),
        )
        .map(copyBlock)
    : [];
  const ids = new Set(blocks.map((b) => b.id));
  for (const b of commitments(date, settings)) {
    if (ids.has(b.id)) continue;
    if (
      occupied(b) &&
      (b.start! < settings.wake ||
        b.start! + b.duration! > settings.bedtime ||
        blocks.some((x) => overlaps(x, b)))
    ) {
      b.start = null;
      b.reason = 'Commitment conflicts with the current plan or day boundaries. Edit its time.';
    }
    blocks.push(b);
    ids.add(b.id);
  }
  const candidates = programs
    .flatMap((p) => p.routines.map((r) => ({ p, r })))
    .sort((a, b) => Number(b.r.fixed) - Number(a.r.fixed));
  for (const { p, r } of candidates) {
    if (!r.enabled || r.bundledInto || (r.weekdays !== null && !onItsDays(r, date))) continue;
    const id = `${date}:routine:${r.id}`;
    // One occurrence of a routine per day: a moved-out one stays moved, a moved-in one is not doubled.
    if (ids.has(id) || movedOut.has(r.id) || blocks.some((b) => b.routineId === r.id)) continue;
    const text = occurrenceText(r, date);
    const b = makeBlock(id, text.title, null, r.duration, r.fixed);
    b.routineId = r.id;
    b.programId = p.id;
    b.windowStart = r.windowStart ?? null;
    b.windowEnd = r.windowEnd ?? null;
    b.steps = text.steps;
    if (r.checklist || r.private) {
      b.checklist = !!r.checklist;
      b.private = !!r.private;
    }
    if (r.optional) b.optional = true;
    if (r.checklist) {
      b.start = null;
      b.reason = null;
      blocks.push(b);
      ids.add(id);
      continue;
    }
    const preferred = d === 4 && r.thursdayStart != null ? r.thursdayStart : r.preferredStart;
    if (r.weekdays === null) b.reason = 'Choose this routine’s weekdays.';
    else if (r.duration === null) b.reason = 'Set a duration.';
    else if (!r.fixed && blocks.some(unconfirmedFixed))
      b.reason = 'Confirm meeting times and lengths before allocating more time.';
    else if (p.id === 'gym' && settings.gymTravel === null)
      b.reason = 'Set gym travel time (zero if already included).';
    else {
      // Travel belongs to the same gym block; no overlapping duplicate allocation.
      if (p.id === 'gym') b.duration = r.duration + (settings.gymTravel ?? 0);
      if (r.fixed) {
        const candidate = { ...b, start: preferred };
        if (preferred === null) b.reason = 'Set this fixed routine’s start time.';
        else if (
          preferred < Math.max(settings.wake, r.windowStart ?? 0) ||
          preferred + b.duration! > Math.min(settings.bedtime, r.windowEnd ?? 1440) ||
          blocks.some((x) => overlaps(x, candidate))
        )
          b.reason = 'Fixed time conflicts with another block or day boundary.';
        else b.start = preferred;
      } else
        b.start = findSlot(
          blocks,
          b.duration!,
          Math.max(settings.wake, preferred ?? settings.wake, r.windowStart ?? 0),
          Math.min(settings.bedtime, r.windowEnd ?? 1440),
        );
      if (b.start === null && !b.reason)
        b.reason = 'No available slot in the routine window. Move it or choose another day.';
    }
    blocks.push(b);
    ids.add(id);
  }
  attachBundles(date, blocks, programs);
  const result = { date, blocks, commitmentsKey, revisions: [] };
  return previous
    ? {
        ...revision(previous, blocks, 'Generate missing occurrences', now),
        commitmentsKey,
      }
    : result;
}

/** Routines moved off this day by a sequence shift. */
export function movedRoutines(day?: Day): Set<string> {
  return new Set(day?.moved?.map((move) => move.routineId) ?? []);
}

/**
 * Checklist routines due on a date: by weekday, plus `extra` (rotation workouts and companions,
 * which do not follow weekdays; see `rotation.ts`).
 */
function dueChecklistIds(
  date: string,
  programs: Program[],
  day?: Day,
  extra: ReadonlySet<string> = new Set(),
) {
  const movedOut = movedRoutines(day);
  return new Set([
    ...programs.flatMap((program) =>
      program.routines
        .filter(
          (routine) =>
            routine.enabled &&
            routine.checklist &&
            !routine.bundledInto &&
            onItsDays(routine, date) &&
            !movedOut.has(routine.id),
        )
        .map((routine) => routine.id),
    ),
    ...[...extra].filter((id) => !movedOut.has(id)),
  ]);
}

function dueTimedIds(date: string, programs: Program[], day?: Day): string[] {
  const movedOut = movedRoutines(day);
  const ids = programs.flatMap((program) =>
    program.routines
      .filter(
        (routine) =>
          routine.enabled &&
          !routine.checklist &&
          !routine.bundledInto &&
          // An optional session never blocks the day, placed or not.
          !routine.optional &&
          onItsDays(routine, date) &&
          !movedOut.has(routine.id),
      )
      .map((routine) => routine.id),
  );
  return [...new Set(ids)].sort();
}

function sameIds(stored: string[] | undefined, due: string[]): boolean {
  const sorted = [...(stored ?? [])].sort();
  return sorted.length === due.length && sorted.every((id, i) => id === due[i]);
}

function withDueTimed(day: Day, dueTimed: string[]): Day {
  if (sameIds(day.dueTimed, dueTimed)) return day;
  if (dueTimed.length) return { ...day, dueTimed };
  const next = { ...day };
  delete next.dueTimed;
  return next;
}

/** Re-record a today-or-later day's timed obligations from the catalog; unchanged days keep identity. */
export function recordDueTimed(day: Day, programs: Program[]): Day {
  return withDueTimed(day, dueTimedIds(day.date, programs, day));
}

export function checklistNeedsEnsure(
  date: string,
  programs: Program[],
  previous?: Day,
  today = localDate(),
  keep: ReadonlySet<string> = new Set(),
  extra: ReadonlySet<string> = new Set(),
): boolean {
  if (checklistBlocksNeedEnsure(date, programs, previous, keep, extra)) return true;
  // Only today and later follow the catalog. A past day keeps the timed obligations it recorded.
  return date >= today && !sameIds(previous?.dueTimed, dueTimedIds(date, programs, previous));
}

function checklistBlocksNeedEnsure(
  date: string,
  programs: Program[],
  previous?: Day,
  keep: ReadonlySet<string> = new Set(),
  extra: ReadonlySet<string> = new Set(),
): boolean {
  const due = dueChecklistIds(date, programs, previous, extra);
  const blocks = previous?.blocks ?? [];
  // By routine, not ID: a moved-in occurrence keeps its original day's ID and still counts.
  const present = new Set(blocks.map((block) => block.routineId));
  if ([...due].some((id) => !present.has(id))) return true;
  return blocks.some(
    (block) =>
      block.movedFrom === undefined &&
      !keep.has(block.id) &&
      block.checklist &&
      block.start === null &&
      block.status === 'planned' &&
      !block.bundledSteps?.some((step) => step.status !== 'planned') &&
      block.routineId !== null &&
      !due.has(block.routineId),
  );
}

export function ensureChecklistDay(
  date: string,
  settings: Settings,
  programs: Program[],
  previous?: Day,
  now = new Date().toISOString(),
  keep: ReadonlySet<string> = new Set(),
  extra: ReadonlySet<string> = new Set(),
): Day {
  validateSettings(settings);
  const today = localDate(new Date(now));
  const empty: Day = { date, blocks: [], revisions: [] };
  if (!checklistNeedsEnsure(date, programs, previous, today, keep, extra)) return previous ?? empty;
  // Past dates never gain or lose timed obligations from today's catalog.
  const record = (day: Day) => (date >= today ? recordDueTimed(day, programs) : day);
  if (!checklistBlocksNeedEnsure(date, programs, previous, keep, extra))
    return record(previous ?? empty);
  const due = dueChecklistIds(date, programs, previous, extra);
  const blocks = (previous?.blocks ?? [])
    .filter(
      (block) =>
        block.movedFrom !== undefined ||
        keep.has(block.id) ||
        !(
          block.checklist &&
          block.start === null &&
          block.status === 'planned' &&
          !block.bundledSteps?.some((step) => step.status !== 'planned') &&
          block.routineId !== null &&
          !due.has(block.routineId)
        ),
    )
    .map(copyBlock);
  const ids = new Set(blocks.map((block) => block.id));
  for (const program of programs) {
    for (const routine of program.routines) {
      if (!due.has(routine.id)) continue;
      const id = `${date}:routine:${routine.id}`;
      if (ids.has(id) || blocks.some((block) => block.routineId === routine.id)) continue;
      const text = occurrenceText(routine, date);
      const block = makeBlock(id, text.title, null, routine.duration, routine.fixed);
      block.routineId = routine.id;
      block.programId = program.id;
      block.windowStart = routine.windowStart ?? null;
      block.windowEnd = routine.windowEnd ?? null;
      block.steps = text.steps;
      block.checklist = true;
      if (routine.private) block.private = true;
      if (routine.optional) block.optional = true;
      block.reason = null;
      blocks.push(block);
      ids.add(id);
    }
  }
  attachBundles(date, blocks, programs);
  const result = {
    date,
    blocks,
    commitmentsKey: previous?.commitmentsKey,
    revisions: previous?.revisions ?? [],
  };
  return record(previous ? revision(previous, blocks, 'Ensure due checklist items', now) : result);
}
export function editBlock(
  day: Day,
  changed: Block,
  settings: Settings,
  now = new Date().toISOString(),
): Day {
  if (!changed.title.trim()) throw new Error('Give this block a name.');
  if (
    changed.duration !== null &&
    (!Number.isInteger(changed.duration) || changed.duration < 1 || changed.duration > 720)
  )
    throw new Error('Duration must be 1–720 whole minutes.');
  if (changed.start !== null) {
    if (changed.duration === null) throw new Error('Set a duration before scheduling.');
    if (
      !Number.isInteger(changed.start) ||
      changed.start < settings.wake ||
      changed.start + changed.duration > settings.bedtime
    )
      throw new Error('This block is outside your wake-to-bedtime window.');
    if (day.blocks.some((b) => b.id !== changed.id && overlaps(b, changed)))
      throw new Error('That slot overlaps another block. Choose a free time.');
  }
  const current = day.blocks.find((b) => b.id === changed.id);
  // A routine's occurrence is only ever edited where it is: adding it again would make a second copy.
  if (!current && changed.routineId) throw new Error('This block no longer exists.');
  // A time editor may have opened before a bundled completion was recorded.
  if (current?.bundledSteps)
    changed = { ...changed, bundledSteps: copyBlock(current).bundledSteps };
  const exists = !!current;
  const blocks = exists
    ? day.blocks.map((b) => (b.id === changed.id ? changed : b))
    : [...day.blocks, changed];
  return revision(day, blocks, exists ? 'Edit block' : 'Add block', now);
}
export function setStatus(
  day: Day,
  id: string,
  status: Block['status'],
  now = new Date().toISOString(),
): Day {
  const b = day.blocks.find((b) => b.id === id);
  if (!b) throw new Error('This block no longer exists.');
  if (
    status !== 'skipped' &&
    day.blocks.some((other) => other.id !== id && overlaps(other, { ...b, status }))
  )
    throw new Error('This slot is now occupied. Move the block before restoring its status.');
  // Status and its actual time live on the block itself; a full-day copy per Done/Skip/Undo added
  // nothing a feature reads (revisions record plan changes) and grew history about 30 KB a day.
  return {
    ...day,
    blocks: day.blocks.map((b) => {
      if (b.id !== id) return b;
      // A corrected morning time belongs to the tick it corrected: any change of status drops it.
      const next: Block = { ...b, status, actualAt: status === 'planned' ? null : now };
      delete next.upAt;
      return next;
    }),
  };
}
export function replanDay(
  day: Day,
  settings: Settings,
  from: number,
  now = new Date().toISOString(),
): Day {
  validateSettings(settings);
  if (!Number.isInteger(from) || from < 0 || from > 1440)
    throw new Error('Choose a valid replanning time.');
  const movable = day.blocks.filter(
    (b) =>
      !b.fixed &&
      !b.checklist &&
      b.status === 'planned' &&
      !b.bundledSteps?.some((step) => step.status !== 'planned') &&
      b.duration !== null &&
      (b.start === null || b.start >= from) &&
      !b.reason?.startsWith('Set ') &&
      !b.reason?.startsWith('Choose this') &&
      !b.reason?.startsWith('Confirm meeting'),
  );
  const movableIds = new Set(movable.map((b) => b.id));
  const placed = day.blocks.filter((b) => !movableIds.has(b.id)).map(copyBlock);
  // Fixed commitments with unresolved lengths make automatic placement unsafe. A checklist item
  // holds no time, so a fixed one is never such a commitment.
  if (placed.some(unconfirmedFixed))
    throw new Error('Set fixed meeting times and durations before replanning.');
  for (const b of movable.sort((a, b) => (a.start ?? 1440) - (b.start ?? 1440))) {
    const start = findSlot(
      placed,
      b.duration!,
      Math.max(from, settings.wake, b.windowStart ?? 0),
      Math.min(settings.bedtime, b.windowEnd ?? 1440),
    );
    placed.push({
      ...b,
      start,
      reason: start === null ? 'No available slot in the routine window.' : null,
    });
  }
  return revision(day, placed, 'Replan future flexible blocks', now);
}

export function setBundledStatus(
  day: Day,
  blockId: string,
  stepId: string,
  status: Block['status'],
  now = new Date().toISOString(),
): Day {
  const block = day.blocks.find((b) => b.id === blockId);
  if (!block?.bundledSteps?.some((step) => step.id === stepId))
    throw new Error('This bundled routine no longer exists.');
  // Like setStatus: the step keeps its own status and time; no full-day copy is saved.
  return {
    ...day,
    blocks: day.blocks.map((b) =>
      b.id === blockId
        ? {
            ...b,
            bundledSteps: b.bundledSteps!.map((step) =>
              step.id === stepId
                ? {
                    ...step,
                    status,
                    actualAt: status === 'planned' ? null : now,
                  }
                : step,
            ),
          }
        : b,
    ),
  };
}
