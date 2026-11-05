import { describe, expect, it } from '@jest/globals';
import { careerProgress, careerRoutines } from '../career';
import { withDay } from '../data';
import { consistency } from '../focus-evidence';
import { State, shiftDate } from '../model';
import { protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { DSA_STUDY, advanceStudy, pauseStudy, recordStudy, startStudy } from '../study';
import { studyStreak } from '../study-streak';
import { weeklySummary } from '../weekly';
import { studyState } from '../../test-support/fixtures';

// Wednesday, November 11, 2026 is "today"; the week before is recorded.
const TODAY = '2026-11-11';
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const id = (date: string, routine: string) => `${date}:routine:${routine}`;

function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      state.days[date],
      new Date(at(date, 8)).toISOString(),
    ),
  );
}
function mark(state: State, date: string, routine: string, status: 'done' | 'skipped'): State {
  return withDay(
    state,
    setStatus(state.days[date], id(date, routine), status, new Date(at(date, 20)).toISOString()),
  );
}
function study(state: State, date: string, minutes: number[]): State {
  const target = { routineId: 'study', date, blockId: id(date, 'study') };
  let run = startStudy(DSA_STUDY, target, at(date, 19));
  let t = at(date, 19);
  minutes.forEach((m, i) => {
    t += m * 60_000;
    run =
      i < minutes.length - 1 || m >= DSA_STUDY.stages[i].minutes
        ? advanceStudy(run, t)
        : pauseStudy(run, t);
  });
  return recordStudy(state, run, { countAsDone: false }, `s-${date}`, new Date(t).toISOString());
}

describe('career progress', () => {
  it('covers the study objective and Career-program objectives only', () => {
    expect(careerRoutines(studyState()).map((r) => r.id)).toEqual(['study', 'job-search']);
    // An optional Career objective is never counted, so it gets no "0 of 0" line.
    const withOptional = studyState();
    withOptional.programs = withOptional.programs.map((p) =>
      p.routines.some((r) => r.id === 'job-search')
        ? { ...p, routines: p.routines.map((r) => ({ ...r, optional: true })) }
        : p,
    );
    expect(careerRoutines(withOptional).map((r) => r.id)).not.toContain('job-search');
  });

  it('counts recorded days only, separates full study days from shorter and untimed ones', () => {
    let state = studyState();
    // Thursday Nov 5 to Tuesday Nov 10 recorded; Wednesday Nov 4 and earlier never opened.
    for (let i = -6; i <= 0; i++) state = open(state, shiftDate(TODAY, i));
    state = study(state, '2026-11-05', [25, 30, 5]); // full
    state = study(state, '2026-11-06', [25, 15]); // shorter, left open
    state = mark(state, '2026-11-07', 'study', 'done'); // without the timer
    state = mark(state, '2026-11-08', 'study', 'skipped');
    state = study(state, '2026-11-09', [25, 30, 5]); // full
    state = mark(state, '2026-11-05', 'job-search', 'done');
    state = mark(state, '2026-11-06', 'job-search', 'done');
    state = mark(state, '2026-11-09', 'job-search', 'skipped');
    const [studyLine, job] = careerProgress(state, TODAY);
    // Today is still open, so it is not counted yet; Nov 10 was left open.
    expect(studyLine).toMatchObject({ due: 6, done: 3, skipped: 1, open: 2 });
    expect(studyLine.study).toMatchObject({ full: 2, shorter: 1, withoutTimer: 1, minutes: 160 });
    // The study streak: Nov 10 was left open, so the run ended; the best run was one day.
    expect(studyLine.study!.streak).toMatchObject({ current: 0, best: 1, since: '2026-01-01' });
    expect(studyLine.marks.at(-1)).toEqual({ date: TODAY, mark: 'none' });
    expect(studyLine.marks.filter((m) => m.mark !== 'none')).toHaveLength(6);
    // Weekdays only for the job search: Thu, Fri, Mon, Tue recorded.
    expect(job).toMatchObject({ due: 4, done: 2, skipped: 1, open: 1 });
    expect(job.study).toBeUndefined();
    // Today counts once it is resolved.
    const doneToday = mark(state, TODAY, 'job-search', 'done');
    expect(careerProgress(doneToday, TODAY)[1]).toMatchObject({ due: 5, done: 3 });
  });

  it('a full session whose objective was undone is neither a full day nor a shorter session', () => {
    let state = open(studyState(), '2026-11-10');
    state = study(state, '2026-11-10', [25, 30, 5]);
    state = withDay(
      state,
      setStatus(state.days['2026-11-10'], id('2026-11-10', 'study'), 'planned'),
    );
    expect(careerProgress(state, TODAY)[0].study).toMatchObject({ full: 0, shorter: 0 });
  });

  describe('protected days', () => {
    // Thursday Nov 5 to today recorded. The job search (weekdays): Thu done, Fri skipped,
    // Mon left open, Tue protected and left open; study done Thu, skipped Fri.
    function week(): State {
      let state = studyState();
      for (let i = -6; i <= 0; i++) state = open(state, shiftDate(TODAY, i));
      state = mark(state, '2026-11-05', 'job-search', 'done');
      state = mark(state, '2026-11-06', 'job-search', 'skipped');
      state = mark(state, '2026-11-05', 'study', 'done');
      state = mark(state, '2026-11-06', 'study', 'skipped');
      return protect(state, '2026-11-10');
    }
    function protect(state: State, date: string): State {
      return withDay(
        state,
        protectDay(state.days[date], 'illness', new Date(at(date, 9)).toISOString()),
      );
    }
    const job = (state: State) => careerProgress(state, TODAY)[1];
    const markOn = (state: State, date: string) =>
      job(state).marks.find((m) => m.date === date)?.mark;

    it('a protected day left open is neither due nor open: completed, skipped and open still count', () => {
      const state = week();
      expect(job(state)).toMatchObject({ due: 3, done: 1, skipped: 1, open: 1 });
      expect(markOn(state, '2026-11-10')).toBe('none');
      // Without the protection the same day counts as an open, due day.
      const unprotected = {
        ...state,
        days: {
          ...state.days,
          '2026-11-10': { ...state.days['2026-11-10'], protection: undefined },
        },
      };
      expect(job(unprotected)).toMatchObject({ due: 4, open: 2 });
    });

    it('a protected day that was skipped is not counted as skipped', () => {
      const state = protect(mark(week(), '2026-11-09', 'job-search', 'skipped'), '2026-11-09');
      expect(job(state)).toMatchObject({ due: 2, done: 1, skipped: 1, open: 0 });
      expect(markOn(state, '2026-11-09')).toBe('none');
    });

    it('work actually done on a protected day still counts as done', () => {
      const state = mark(week(), '2026-11-10', 'job-search', 'done');
      expect(job(state)).toMatchObject({ due: 4, done: 2, skipped: 1, open: 1 });
      expect(markOn(state, '2026-11-10')).toBe('done');
    });

    it('protection never makes an unrecorded day or an unresolved today count', () => {
      let state = week();
      // Wednesday Nov 4 was never opened; protecting it records no occurrence.
      state = withDay(
        state,
        protectDay(
          { date: '2026-11-04', blocks: [], revisions: [] },
          'travel',
          new Date(at('2026-11-04', 9)).toISOString(),
        ),
      );
      state = protect(state, TODAY);
      expect(job(state)).toMatchObject({ due: 3, done: 1, skipped: 1, open: 1 });
      expect(markOn(state, '2026-11-04')).toBe('none');
      expect(markOn(state, TODAY)).toBe('none');
      // Today protected and skipped is held too; today protected and done counts.
      expect(job(mark(state, TODAY, 'job-search', 'skipped'))).toMatchObject({
        due: 3,
        skipped: 1,
      });
      expect(job(mark(state, TODAY, 'job-search', 'done'))).toMatchObject({ due: 4, done: 2 });
    });

    it('applies the same rule at the edges of the window', () => {
      // The first day of the 28-day window, and the day just before it.
      const first = shiftDate(TODAY, -27);
      const before = shiftDate(first, -1);
      let state = studyState();
      for (const date of [before, first]) state = protect(open(state, date), date);
      expect(careerProgress(state, TODAY)[0]).toMatchObject({ due: 0, skipped: 0, open: 0 });
      state = mark(mark(state, first, 'study', 'done'), before, 'study', 'done');
      expect(careerProgress(state, TODAY)[0]).toMatchObject({ due: 1, done: 1 });
    });

    it('the study line holds a protected day the same way, and the study streak is unchanged', () => {
      const state = protect(mark(week(), '2026-11-09', 'study', 'skipped'), '2026-11-09');
      const [studyLine] = careerProgress(state, TODAY);
      // Thu done, Fri skipped, Sun and Sat left open; Mon and Tue protected and not done.
      expect(studyLine).toMatchObject({ due: 4, done: 1, skipped: 1, open: 2 });
      const routine = careerRoutines(state)[0];
      expect(studyLine.study!.streak).toEqual(studyStreak(state, routine, TODAY));
    });

    it('agrees with Weekly and Focus on the same week', () => {
      for (const state of [
        week(),
        mark(week(), '2026-11-10', 'job-search', 'done'),
        mark(protect(week(), TODAY), TODAY, 'job-search', 'skipped'),
      ]) {
        const routine = careerRoutines(state)[1];
        const line = careerProgress(state, TODAY, 7)[1];
        const weekly = weeklySummary(state, TODAY).jobs[0];
        expect({ done: weekly.done, due: weekly.opportunities }).toEqual({
          done: line.done,
          due: line.due,
        });
        expect(consistency(state, routine, shiftDate(TODAY, -6), TODAY).value).toBe(
          `Done on ${line.done} of ${line.due} recorded days`,
        );
      }
    });
  });
});
