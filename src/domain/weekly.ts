import { careerRoutines } from './career';
import { MoneyReview, Routine, State, shiftDate } from './model';
import { FieldChange, currentPriority, fieldChanges, sortedReviews } from './money';
import { CalendarDay, studyCalendar } from './study-calendar';
import { StudyStreak } from './study-streak';

// The last seven days on one card: effort (study, career objectives) next to the money evidence.
// All from what was recorded; nothing is projected, scored or interpolated.

const WEEK_DAYS = 7;

export type WeeklySummary = {
  from: string;
  to: string;
  study: {
    routineId: string;
    title: string;
    completed: number;
    eligible: number;
    streak: StudyStreak;
    days: CalendarDay[];
  }[];
  jobs: { routineId: string; title: string; done: number; opportunities: number }[];
  money: {
    latest: MoneyReview;
    /** The latest review is dated in these seven days. */
    updatedThisWeek: boolean;
    debt: FieldChange;
    savings: FieldChange;
  } | null;
  priority: MoneyReview | null;
};

/**
 * A Career objective's recorded days in the window: each day it was on the plan (done, skipped or
 * left open), except a protected day where it was not done, and today until it is done or skipped.
 * A day never opened is not counted: without a recorded schedule there is no telling it was due.
 */
function jobWeek(state: State, routine: Routine, dates: string[], today: string) {
  let done = 0;
  let opportunities = 0;
  for (const date of dates) {
    const day = state.days[date];
    const block = day?.blocks.find((b) => b.routineId === routine.id && !b.optional);
    if (!block) continue;
    if (block.status === 'done') {
      done++;
      opportunities++;
      continue;
    }
    if (day?.protection) continue;
    if (date === today && block.status !== 'skipped') continue;
    opportunities++;
  }
  return { routineId: routine.id, title: routine.title, done, opportunities };
}

export function weeklySummary(state: State, today: string): WeeklySummary {
  const from = shiftDate(today, -(WEEK_DAYS - 1));
  const dates = Array.from({ length: WEEK_DAYS }, (_, i) => shiftDate(from, i));
  const routines = careerRoutines(state);
  const study = routines
    .filter((r) => r.study)
    .map((r) => {
      const cal = studyCalendar(state, r, today, WEEK_DAYS);
      return {
        routineId: r.id,
        title: r.title,
        completed: cal.completed,
        eligible: cal.eligible,
        streak: cal.streak,
        days: cal.days,
      };
    });
  const jobs = routines.filter((r) => !r.study).map((r) => jobWeek(state, r, dates, today));
  const latest = sortedReviews(state).at(-1);
  const money = latest
    ? (() => {
        const changes = fieldChanges(state, latest);
        return {
          latest,
          updatedThisWeek: latest.date >= from && latest.date <= today,
          debt: changes.find((c) => c.field === 'debt')!,
          savings: changes.find((c) => c.field === 'savings')!,
        };
      })()
    : null;
  return { from, to: today, study, jobs, money, priority: currentPriority(state, today) };
}
