import { Routine, State, shiftDate } from './model';
import { StudyStreak, studyDayResult, studyStreak } from './study-streak';

// The last four weeks of study as a calendar, by exactly the study streak's rules: a past scheduled
// day is completed or missed, a protected (or moved-away) day is held, a day that was not a study day
// or came before tracking started is not scored, and today is open until it is done or skipped.

export type CalendarMark = 'completed' | 'missed' | 'held' | 'none' | 'before' | 'open';
export type CalendarDay = { date: string; mark: CalendarMark };
export type StudyCalendar = {
  days: CalendarDay[];
  /** Completed days in the window. */
  completed: number;
  /** Days that counted: completed plus missed (held, unscheduled and open days excluded). */
  eligible: number;
  streak: StudyStreak;
};

export const CALENDAR_DAYS = 28;

export function studyCalendar(
  state: State,
  routine: Routine,
  today: string,
  length = CALENDAR_DAYS,
): StudyCalendar {
  const streak = studyStreak(state, routine, today);
  const days: CalendarDay[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    days.push({ date, mark: markOn(state, routine, date, today, streak) });
  }
  const completed = days.filter((d) => d.mark === 'completed').length;
  return {
    days,
    completed,
    eligible: completed + days.filter((d) => d.mark === 'missed').length,
    streak,
  };
}

function markOn(
  state: State,
  routine: Routine,
  date: string,
  today: string,
  streak: StudyStreak,
): CalendarMark {
  if (!streak.since || date < streak.since) return 'before';
  if (date === today)
    return streak.today === 'kept' ? 'completed' : streak.today === 'missed' ? 'missed' : 'open';
  const result = studyDayResult(state, routine, date);
  if (result === 'kept') return 'completed';
  if (result === 'missed') return 'missed';
  if (result === 'held') return 'held';
  return 'none';
}

export const MARK_LABELS: Record<CalendarMark, string> = {
  completed: 'completed',
  missed: 'missed or skipped',
  held: 'protected or moved, streak held',
  none: 'not a study day',
  before: 'before study tracking started',
  open: 'today, still open',
};
