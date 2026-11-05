import type { Day, State } from '../../src/domain/model';
import { dateObject, shiftDate } from '../../src/domain/model';
import { demoState } from '../../src/domain/demo';
import { toGrams } from '../../src/domain/records';
import { tradingBook } from '../../src/domain/trading';

// Synthetic data only: the fictional demo person's six weeks, with earlier stretches replayed from
// the same records a little earlier in their progress (heavier, more debt, lighter lifts). One
// replay gives Progress about three months of a personal-like plan; fifteen give two years, for
// timing. Study and trading start later, as they do in the demo, and trading is not paused (the
// demo pauses it a week before today), so Progress has its tile and card. A few days between
// replays were never opened, as happens. Nothing here is a real plan, balance or measurement.

/** Saturday, October 17, 2026: the screenshot day. */
export const HISTORY_TODAY = '2026-10-17';
/** Nine in the morning on that day, for the browser clock. */
export const HISTORY_CLOCK = new Date(2026, 9, 17, 9);

/** Each replay sits seven weeks before the one after it. */
const STEP = 49;

const swap = (text: string, from: string, to: string) => text.split(from).join(to);

export function progressHistory(today = HISTORY_TODAY, replays = 1): State {
  const demo = demoState(today);
  const days: Record<string, Day> = {};
  const measurements: State['measurements'] = [];
  const workoutSessions: State['workoutSessions'] = [];
  const moneyReviews: State['moneyReviews'] = [];
  const activitySessions: State['activitySessions'] = [];
  for (let k = 1; k <= replays; k++) {
    const shift = STEP * k;
    const back = (date: string) => shiftDate(date, -shift);
    const backAt = (iso: string) => new Date(Date.parse(iso) - shift * 86_400_000).toISOString();
    for (const day of Object.values(demo.days)) {
      if (day.date >= today) continue;
      const date = back(day.date);
      // Every occurrence ID (blocks, bundled steps, moves) carries its date.
      const copy: Day = JSON.parse(swap(JSON.stringify(day), day.date, date));
      const { protection: _protection, ...rest } = copy;
      days[date] = {
        ...rest,
        blocks: copy.blocks.map((b) =>
          // An ordinary earlier week: a habit on every fifth date left open, so the line can rise.
          b.status === 'done' &&
          dateObject(date).getDate() % 5 === 0 &&
          b.checklist &&
          !b.steps.length
            ? { ...b, status: 'planned', actualAt: null }
            : b,
        ),
        revisions: [],
      };
    }
    for (const m of demo.measurements) {
      const value = Math.round((m.entered.value + 2.4 * k) * 10) / 10;
      measurements.push({
        ...m,
        id: `${m.id}-${k}`,
        date: back(m.date),
        at: backAt(m.at),
        entered: { ...m.entered, value },
        grams: toGrams(value, m.entered.unit),
        occurrenceId: m.occurrenceId ? swap(m.occurrenceId, m.date, back(m.date)) : null,
      });
    }
    for (const s of demo.workoutSessions) {
      if (s.status !== 'completed') continue;
      const occurrenceId = swap(s.occurrenceId, s.date, back(s.date));
      workoutSessions.push({
        ...s,
        id: `session:${occurrenceId}`,
        occurrenceId,
        scheduledDate: back(s.scheduledDate),
        date: back(s.date),
        startedAt: backAt(s.startedAt),
        finishedAt: s.finishedAt ? backAt(s.finishedAt) : null,
        exercises: s.exercises.map((e) => ({
          ...e,
          sets: e.sets.map((set) => ({
            ...set,
            load: set.load === null ? null : Math.max(5, set.load - 10 * k),
          })),
        })),
      });
    }
    for (const r of demo.moneyReviews)
      moneyReviews.push({
        ...r,
        id: `${r.id}-${k}`,
        date: back(r.date),
        at: backAt(r.at),
        debt: r.debt === null ? null : r.debt + 120_000 * k,
        savings: r.savings === null ? null : Math.max(0, r.savings - 60_000 * k),
        nextAction: '',
        priorityDoneAt: null,
        occurrenceId: null,
      });
    for (const a of demo.activitySessions) {
      if (a.study) continue;
      activitySessions.push({
        ...a,
        id: `${a.id}-${k}`,
        date: back(a.date),
        at: backAt(a.at),
        occurrenceId: a.occurrenceId ? swap(a.occurrenceId, a.date, back(a.date)) : null,
        minutes: Math.max(10, a.minutes - 10),
      });
    }
  }
  return {
    ...demo,
    source: 'personal',
    programs: demo.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.id === tradingBook(demo)?.routineId ? { ...r, enabled: true } : r,
      ),
    })),
    days: { ...days, ...demo.days },
    measurements: [...measurements, ...demo.measurements],
    workoutSessions: [...workoutSessions, ...demo.workoutSessions],
    moneyReviews: [...moneyReviews, ...demo.moneyReviews],
    activitySessions: [...activitySessions, ...demo.activitySessions],
  };
}
