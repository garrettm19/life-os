import { describe, expect, it } from '@jest/globals';
import { withDay } from '../data';
import { State } from '../model';
import { protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { saveMoneyReview } from '../money';
import { DSA_STUDY, saveStudyPlan } from '../study';
import { weeklySummary } from '../weekly';
import { studyState } from '../../test-support/fixtures';

// Today is Sunday, November 1, 2026 (the US clock change); the week is
// Monday Oct 26 – Sunday Nov 1, crossing the month boundary.
const TODAY = '2026-11-01';
const at = (date: string, hour = 9) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const id = (date: string, routine: string) => `${date}:routine:${routine}`;
const money = {
  currency: 'USD',
  cash: null,
  savings: null,
  debt: null,
  upcoming: null,
  contributed: null,
  savingsTarget: null,
  nextAction: '',
  note: '',
  goalId: null,
};

function tracked(): State {
  return saveStudyPlan(studyState(), 'study', {
    ...DSA_STUDY,
    trackFrom: '2026-10-01',
    schedule: [{ from: '2026-10-01', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }],
  });
}
function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], at(date, 8)),
  );
}
function mark(state: State, date: string, routine: string, status: 'done' | 'skipped') {
  return withDay(state, setStatus(state.days[date], id(date, routine), status, at(date, 20)));
}

describe('the weekly summary', () => {
  it('counts study by the streak rules and the job search over its scheduled weekdays', () => {
    let state = tracked();
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31'])
      state = open(state, d);
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-30', '2026-10-31'])
      state = mark(state, d, 'study', 'done');
    state = mark(state, '2026-10-28', 'study', 'skipped');
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-30'])
      state = mark(state, d, 'job-search', 'done');
    const week = weeklySummary(state, TODAY);
    expect(week).toMatchObject({ from: '2026-10-26', to: TODAY });
    // Study: Oct 26–31 scored (Oct 29 never opened = missed, Oct 28 skipped); today still open.
    expect(week.study[0]).toMatchObject({ completed: 4, eligible: 6 });
    expect(week.study[0].streak.current).toBe(2);
    expect(week.study[0].days).toHaveLength(7);
    // Job search, recorded days only: Mon, Tue, Fri done; Wednesday left open; Thursday was
    // never opened, so it is not counted (there is no record that it was due).
    expect(week.jobs).toEqual([
      { routineId: 'job-search', title: 'Job search', done: 3, opportunities: 4 },
    ]);
  });

  it('leaves a protected day, unopened days and an unresolved today out of the job-search count', () => {
    let state = open(tracked(), '2026-10-27');
    state = withDay(state, protectDay(state.days['2026-10-27'], 'illness'));
    state = mark(open(state, '2026-10-26'), '2026-10-26', 'job-search', 'done');
    // Monday Nov 2 is "today": its open job search is not counted yet.
    state = open(state, '2026-11-02');
    const week = weeklySummary(state, '2026-11-02');
    // Oct 27 protected; Oct 28–30 never opened; Nov 2 open today: nothing counted.
    expect(week.jobs[0]).toMatchObject({ title: 'Job search', done: 0, opportunities: 0 });
    const fromMonday = weeklySummary(state, '2026-10-30');
    expect(fromMonday.jobs[0]).toMatchObject({ title: 'Job search', done: 1, opportunities: 1 });
  });

  it('reports debt and savings honestly: increases, setbacks and a week without an update', () => {
    let state = saveMoneyReview(
      tracked(),
      { ...money, date: '2026-10-11', debt: 500000, savings: 100000 },
      'a',
      at('2026-10-11', 18),
    );
    state = saveMoneyReview(
      state,
      { ...money, date: '2026-10-18', debt: 520000, savings: 90000 },
      'b',
      at('2026-10-18', 18),
    );
    // Last review Oct 18: this week (Oct 26 – Nov 1) has no update.
    let week = weeklySummary(state, TODAY);
    expect(week.money).toMatchObject({ updatedThisWeek: false });
    expect(week.money!.debt).toMatchObject({ value: 520000, delta: 20000 });
    expect(week.money!.savings).toMatchObject({ value: 90000, delta: -10000 });
    state = saveMoneyReview(
      state,
      { ...money, date: TODAY, debt: 470000, nextAction: 'Call the lender' },
      'c',
      at(TODAY, 18),
    );
    week = weeklySummary(state, TODAY);
    expect(week.money).toMatchObject({ updatedThisWeek: true });
    expect(week.money!.debt).toMatchObject({ delta: -50000, sinceFirst: -30000 });
    // Savings were not reported this time: missing, not zero.
    expect(week.money!.savings).toMatchObject({ value: null, delta: null });
    expect(week.priority!.nextAction).toBe('Call the lender');
  });

  it('has nothing to report without money reviews', () => {
    expect(weeklySummary(tracked(), TODAY)).toMatchObject({ money: null, priority: null });
  });
});
