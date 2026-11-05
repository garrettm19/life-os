import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { Program, State, shiftDate } from '../model';
import { ensureChecklistDay, generateDay, makeBlock, setStatus } from '../planner';
import { ensureDay } from '../rotation';
import { restartNote } from '../focus';
import { workoutOccurrences } from '../sequence';
import { dayProgress } from '../objectives';
import { weekAgenda } from '../week-agenda';
import { studyState } from '../../test-support/fixtures';

// "Now" is Monday, November 9, 2026 at 9:00; the week runs Mon 9 – Sun 15.
const MON = '2026-11-09';
const NOW = new Date(2026, 10, 9, 9).toISOString();
const week = Array.from({ length: 7 }, (_, i) => shiftDate(MON, i));

function rotating(state: State): State {
  return {
    ...state,
    programs: state.programs.map((p): Program =>
      p.id === 'training'
        ? {
            ...p,
            routines: p.routines.map((r) => ({ ...r, weekdays: [], checklist: true })),
            rotation: { order: ['upper', 'lower'], restDays: [0], startWith: 'upper' },
          }
        : p,
    ),
  };
}

describe('week agenda', () => {
  it('reads a saved day: timed commitments in order, habits counted, workouts with status', () => {
    let state = studyState();
    let day = ensureChecklistDay(MON, state.settings, state.programs, undefined, NOW);
    day = {
      ...day,
      blocks: [
        ...day.blocks,
        makeBlock(`${MON}:manual:b`, 'Mentor call', 18 * 60 + 30, 30),
        makeBlock(`${MON}:manual:a`, 'Dentist', 8 * 60, 45),
      ],
    };
    day = setStatus(day, `${MON}:routine:study`, 'done', NOW);
    day = setStatus(day, `${MON}:routine:job-search`, 'skipped', NOW);
    state = withDay(state, day);
    const [monday] = weekAgenda(state, week, MON, NOW);
    expect(monday.saved).toBe(true);
    expect(monday.timed.map((e) => [e.title, e.time])).toEqual([
      ['Dentist', '8:00 AM'],
      ['Mentor call', '6:30 PM'],
    ]);
    // Study and the job search are habits; Upper body is a workout, counted apart. The skipped job
    // search is excused, so it is not due.
    expect(monday.habits).toEqual({ due: 1, done: 1, skipped: 1 });
    expect(monday.workouts.map((w) => [w.title, w.status, w.projected])).toEqual([
      ['Upper body', 'planned', false],
    ]);
    // The card's count is Today's: required objectives done of the day's total, timed ones too.
    expect(monday.progress).toEqual({
      done: dayProgress(day, state.programs, MON).done,
      total: dayProgress(day, state.programs, MON).total,
    });
    expect(monday.progress.done).toBe(1);
    // The skipped job search is excused: it leaves the card's total, as it leaves Today's.
    const unskipped = setStatus(day, `${MON}:routine:job-search`, 'planned', NOW);
    expect(monday.progress.total).toBe(dayProgress(unskipped, state.programs, MON).total - 1);
  });

  it('lists a timed workout once, as a workout with its time', () => {
    let state = studyState();
    state.programs = state.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) =>
        r.id === 'upper' ? { ...r, checklist: false, preferredStart: 18 * 60 } : r,
      ),
    }));
    let day = generateDay(MON, state.settings, state.programs, undefined, NOW);
    day = ensureChecklistDay(MON, state.settings, state.programs, day, NOW);
    day = setStatus(day, `${MON}:routine:upper`, 'done', NOW);
    state = withDay(state, day);
    const [monday] = weekAgenda(state, week, MON, NOW);
    expect(monday.workouts.map((w) => [w.title, w.time, w.status])).toEqual([
      ['Upper body', '6:00 PM', 'done'],
    ]);
    // Work and Scrum stay timed commitments; the workout is not one of them.
    expect(monday.timed.length).toBeGreaterThan(0);
    const ids = [...monday.timed, ...monday.workouts].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('computes later days on a copy: nothing is saved by looking', () => {
    const state = studyState();
    const before = JSON.stringify(state);
    const agenda = weekAgenda(state, week, MON, NOW);
    expect(JSON.stringify(state)).toBe(before);
    const wednesday = agenda[2];
    expect(wednesday.saved).toBe(false);
    expect(wednesday.workouts.map((w) => w.title)).toEqual(['Lower body']);
    // Timed sessions appear only once a day is planned; none are invented.
    expect(wednesday.timed).toEqual([]);
    expect(weekAgenda(state, week, MON, NOW)).toEqual(agenda);
  });

  it('shows nothing for a past day that was never opened', () => {
    const state = studyState();
    const [sunday] = weekAgenda(state, ['2026-11-08'], MON, NOW);
    expect(sunday).toMatchObject({
      saved: false,
      // Nothing was saved before it: tracking had not started.
      beforeStart: true,
      outcome: 'absent',
      timed: [],
      workouts: [],
      habits: { due: 0, done: 0, skipped: 0 },
      progress: { done: 0, total: 0 },
    });
  });

  it('tells a day before tracking started from a day left unopened since', () => {
    // Set up on Thursday: Monday to Wednesday came before it; Friday was left unopened. Today is
    // Sunday.
    let state = studyState();
    for (const date of [week[3], week[5]])
      state = withDay(
        state,
        ensureChecklistDay(date, state.settings, state.programs, undefined, NOW),
      );
    const agenda = weekAgenda(state, week, week[6], NOW);
    expect(agenda.map((d) => [d.saved, d.beforeStart])).toEqual([
      [false, true],
      [false, true],
      [false, true],
      [true, false],
      [false, false],
      [true, false],
      // Today, not opened yet: neither.
      [false, false],
    ]);
  });

  it('marks rotation workouts on later days as projected and names rest days', () => {
    const state = rotating(studyState());
    const agenda = weekAgenda(state, week, MON, NOW);
    const sunday = agenda[6];
    expect(sunday.rest).toEqual(['Training']);
    const projected = agenda.slice(1, 6).flatMap((d) => d.workouts);
    expect(projected.length).toBeGreaterThan(0);
    expect(projected.every((w) => w.projected)).toBe(true);
    // A rotation workout is projected once per day at most.
    for (const d of agenda) expect(d.workouts.length).toBeLessThanOrEqual(1);
  });

  it('counts what is planned for a later day, projected workouts included', () => {
    const state = rotating(studyState());
    const agenda = weekAgenda(state, week, MON, NOW);
    for (const d of agenda.slice(1)) {
      const projected = d.workouts.filter((w) => w.projected).length;
      expect(d.saved).toBe(false);
      expect(d.progress.done).toBe(0);
      expect(d.planned).toBe(d.progress.total + projected);
    }
    // A day with a projected workout plans more than its placed objectives alone.
    expect(agenda.slice(1).some((d) => d.planned > d.progress.total)).toBe(true);
  });
});

describe('week agenda with a plain rotation', () => {
  it('reads a rotation workout without a workout plan as a workout: Week, the review, the restart note', () => {
    // The same rotation with no workout plans: plain checklist workouts.
    let state: State = { ...rotating(studyState()), workoutTemplates: [] };
    state = ensureDay(state, MON, NOW);
    const [monday, tuesday] = weekAgenda(state, week, MON, NOW);
    expect(monday.workouts.map((w) => [w.title, w.projected])).toEqual([['Upper body', false]]);
    expect(tuesday.workouts.map((w) => [w.title, w.projected])).toEqual([['Lower body', true]]);
    // Today's workout is not read as a habit, as tomorrow's is not.
    const withPlans = weekAgenda(ensureDay(rotating(studyState()), MON, NOW), week, MON, NOW);
    expect(monday.habits).toEqual(withPlans[0].habits);
    // The weekly review reads its occurrences too.
    expect(workoutOccurrences(state, 'training', MON, MON, MON).map((o) => o.title)).toEqual([
      'Upper body',
    ]);
    // A day later, the restart note says the workout stays next.
    const upper = state.programs.flatMap((p) => p.routines).find((r) => r.id === 'upper')!;
    expect(restartNote(state, upper, week[1])).toBe(
      "Monday's workout didn't happen. It stays next; nothing is owed.",
    );
  });
});

describe('week agenda with companions', () => {
  it('counts a companion as due on the days its workout is projected, never twice', () => {
    const base = rotating(studyState());
    const state: State = {
      ...base,
      programs: base.programs.map((p) =>
        p.id === 'training'
          ? {
              ...p,
              routines: [
                ...p.routines,
                {
                  id: 'core',
                  title: 'Core',
                  duration: null,
                  weekdays: [],
                  preferredStart: null,
                  enabled: true,
                  fixed: false,
                  steps: [],
                  bundledInto: null,
                  checklist: true,
                  follows: ['lower'],
                },
              ],
            }
          : p,
      ),
    };
    const agenda = weekAgenda(state, week, MON, NOW);
    const plain = weekAgenda(rotating(studyState()), week, MON, NOW);
    for (const [i, day] of agenda.entries()) {
      const lower = day.workouts.some((w) => w.title === 'Lower body');
      expect(day.habits.due - plain[i].habits.due).toBe(lower ? 1 : 0);
    }
    expect(
      agenda.some((d) => d.workouts.some((w) => w.projected && w.title === 'Lower body')),
    ).toBe(true);
  });
});
