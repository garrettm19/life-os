import { Block, Routine, State, shiftDate } from './model';
import { fullStudy, studySessionFor } from './study';
import { StudyStreak, studyStreak } from './study-streak';

// Career progress: the study objective and the Career program's other objectives over recent
// weeks, read only from recorded days. A day never opened is not counted; today counts once
// its objective is done or skipped. A protected day counts only where the objective was done, as
// Weekly and Focus count it: protection holds a day, it never stands in for the work. Nothing here
// tracks applications or companies.

export type DayMark = 'done' | 'skipped' | 'open' | 'none';

export type CareerLine = {
  routineId: string;
  title: string;
  /** Recorded occurrences in the window (today only once resolved; protected days only if done). */
  due: number;
  done: number;
  skipped: number;
  /** Earlier days left open. */
  open: number;
  /** One mark per day of the window, oldest first; `none` where it was not due or not recorded. */
  marks: { date: string; mark: DayMark }[];
  study?: {
    /** The study streak (separate from the Day Clear streak). */
    streak: StudyStreak;
    /** Done with a full, confirmed timed session (the timer is optional). */
    full: number;
    /** Sessions shorter than planned (whether or not counted as done). */
    shorter: number;
    /** Done by one tap, without a timed session: ordinary self-reported completion. */
    withoutTimer: number;
    minutes: number;
  };
};

export const CAREER_DAYS = 28;

/**
 * The routines career progress covers: study objectives and everything in a Career program.
 * Optional routines are left out: their days are never counted, so they would only read 0 of 0.
 */
export function careerRoutines(state: State): Routine[] {
  return state.programs
    .flatMap((p) => p.routines.map((r) => ({ r, group: p.group })))
    .filter(({ r, group }) => !r.bundledInto && !r.optional && (r.study || group === 'Career'))
    .map(({ r }) => r);
}

function occurrence(state: State, routine: Routine, date: string): Block | undefined {
  return state.days[date]?.blocks.find((b) => b.routineId === routine.id && !b.optional);
}

export function careerProgress(state: State, today: string, days = CAREER_DAYS): CareerLine[] {
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, i - days + 1));
  return careerRoutines(state).map((routine) => {
    const line: CareerLine = {
      routineId: routine.id,
      title: routine.title,
      due: 0,
      done: 0,
      skipped: 0,
      open: 0,
      marks: [],
    };
    let full = 0,
      shorter = 0,
      withoutTimer = 0;
    for (const date of dates) {
      const block = occurrence(state, routine, date);
      const resolved = block && block.status !== 'planned';
      const held = block && block.status !== 'done' && !!state.days[date]?.protection;
      if (!block || (date === today && !resolved) || held) {
        line.marks.push({ date, mark: 'none' });
        continue;
      }
      line.due++;
      const mark: DayMark = block.status === 'planned' ? 'open' : block.status;
      line.marks.push({ date, mark });
      if (mark === 'done') line.done++;
      else if (mark === 'skipped') line.skipped++;
      else line.open++;
      if (!routine.study) continue;
      const record = studySessionFor(state, block.id)?.study;
      if (record && fullStudy(record)) {
        // A full session whose objective was later undone is neither full nor shorter.
        if (mark === 'done') full++;
      } else if (record) shorter++;
      else if (mark === 'done') withoutTimer++;
    }
    if (routine.study) {
      line.study = {
        streak: studyStreak(state, routine, today),
        full,
        shorter,
        withoutTimer,
        minutes: state.activitySessions
          .filter(
            (a) => a.study && a.routineId === routine.id && a.date >= dates[0] && a.date <= today,
          )
          .reduce((sum, a) => sum + a.minutes, 0),
      };
    }
    return line;
  });
}
