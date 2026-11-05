import { decodeState } from './data';
import { Routine, State, daysBetween, shiftDate, weekStartOf } from './model';
import { inRepeatWeek } from './repeat';

// Start tracking: the demo's plan becomes the device's own, with none of its fictional history.
// What is kept is a plan or a definition (goals, programs and routines, workout plans, timed
// circuits, rulebooks with their trading process, settings and setup notes). What is cleared is a
// record of what happened (days and their blocks, revisions, protections, rotation choices and
// moves, measurements, the life log, workout, circuit and activity sessions, money, rule and
// trading reviews, focuses, weekly reviews and skill checkpoints). Every date the plan keeps is
// today or later, so nothing is scored, owed or shown before the day tracking starts.

/** The first date on or after `today` with the same variant as before (a missed day never shifts it). */
function alternationAnchor(anchor: string, variants: number, today: string): string {
  if (anchor >= today || variants < 2) return anchor;
  const behind = daysBetween(anchor, today);
  return shiftDate(anchor, Math.ceil(behind / variants) * variants);
}

/** Today, or the Monday of the next "on" week: the same repeat weeks, anchored no earlier than today. */
function repeatAnchor(routine: Routine, today: string): string {
  const repeat = routine.repeat!;
  if (repeat.anchor >= today) return repeat.anchor;
  if (inRepeatWeek(routine, today)) return today;
  let week = shiftDate(weekStartOf(today), 7);
  while (!inRepeatWeek(routine, week)) week = shiftDate(week, 7);
  return week;
}

function freshRoutine(routine: Routine, today: string): Routine {
  const next: Routine = { ...routine };
  if (routine.alternate)
    next.alternate = {
      ...routine.alternate,
      anchor: alternationAnchor(routine.alternate.anchor, routine.alternate.variants.length, today),
    };
  if (routine.repeat) next.repeat = { ...routine.repeat, anchor: repeatAnchor(routine, today) };
  if (routine.study)
    // The study streak and the schedule record start today, so no earlier day is kept or missed.
    next.study = {
      ...routine.study,
      trackFrom: today,
      schedule: [
        {
          from: today,
          weekdays: [...(routine.weekdays ?? [])].sort((a, b) => a - b),
          enabled: routine.enabled,
        },
      ],
    };
  return next;
}

/**
 * The demo's plan as a personal state starting `today`, with every demo record cleared. Rotations
 * restart at their first workout because no workout is recorded, and the trading process starts
 * today. Device settings (the widget's Day Cleared opt-in, the timer cue) are kept as they are; the
 * last backup time is dropped, because a backup of the demo holds none of the new records. Today's
 * objectives appear when Today opens, through the usual daily ensure.
 */
export function startTracking(state: State, today: string, now: string): State {
  if (state.source !== 'demo') throw new Error('Only the demo can start tracking this way.');
  const { lastBackupAt: _demoBackup, ...settings } = state.settings;
  // Every field is listed, so a new kind of record cannot be carried over by accident.
  const next: State = {
    version: state.version,
    source: 'personal',
    goals: state.goals.map((g) => ({ ...g })),
    programs: state.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => freshRoutine(r, today)),
    })),
    settings,
    notes: [...state.notes],
    workoutTemplates: state.workoutTemplates.map((t) => ({ ...t, updatedAt: now })),
    intervalRoutines: state.intervalRoutines.map((c) => ({ ...c, updatedAt: now })),
    ruleBooks: state.ruleBooks.map((b) => ({
      ...b,
      updatedAt: now,
      ...(b.trading && { trading: { ...b.trading, since: today } }),
    })),
    days: {},
    measurements: [],
    lifeLog: [],
    workoutSessions: [],
    moneyReviews: [],
    intervalSessions: [],
    activitySessions: [],
    ruleReviews: [],
    focuses: [],
    weeklyReviews: [],
    skillCheckpoints: [],
    tradingSessions: {},
    ...(state.tradingSessionsImported && { tradingSessionsImported: true }),
  };
  return decodeState(next);
}
