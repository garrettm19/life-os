import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup } from '../backup';
import { withDay } from '../data';
import { Program, Routine, State, shiftDate } from '../model';
import { protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { upsertRoutine } from '../routines';
import { DSA_STUDY, saveStudyPlan } from '../study';
import { CALENDAR_DAYS, studyCalendar } from '../study-calendar';
import { studyState } from '../../test-support/fixtures';

// Clocks are built from local dates.
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const at = (date: string, hour = 9) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const id = (date: string) => `${date}:routine:study`;

function tracked(from: string, weekdays = EVERY_DAY): State {
  return saveStudyPlan(studyState(), 'study', {
    ...DSA_STUDY,
    trackFrom: from,
    schedule: [{ from, weekdays, enabled: true }],
  });
}
function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], at(date, 8)),
  );
}
function mark(state: State, date: string, status: 'done' | 'skipped' | 'planned') {
  return withDay(state, setStatus(state.days[date], id(date), status, at(date, 20)));
}
function doneOn(state: State, ...dates: string[]): State {
  for (const d of dates) state = mark(open(state, d), d, 'done');
  return state;
}
const career = (state: State): Program => state.programs.find((p) => p.id === 'career')!;
const routine = (state: State): Routine => career(state).routines.find((r) => r.id === 'study')!;
const calendar = (state: State, today: string) => studyCalendar(state, routine(state), today);
const markOf = (state: State, today: string, date: string) =>
  calendar(state, today).days.find((d) => d.date === date)!.mark;

describe('the study calendar', () => {
  it('covers exactly the last 28 days, oldest first, across a leap day', () => {
    // 2028 is a leap year: Feb 29 is inside the window ending March 10.
    const cal = calendar(tracked('2028-01-01'), '2028-03-10');
    expect(cal.days).toHaveLength(CALENDAR_DAYS);
    expect(cal.days[0].date).toBe('2028-02-12');
    expect(cal.days.at(-1)!.date).toBe('2028-03-10');
    expect(cal.days.map((d) => d.date)).toContain('2028-02-29');
    expect(new Set(cal.days.map((d) => d.date)).size).toBe(CALENDAR_DAYS);
  });

  it('counts completed of eligible days with the streak rules, across a clock change', () => {
    // Oct 26 – Nov 3, 2026 includes the US clock change on Nov 1.
    let state = doneOn(tracked('2026-10-26'), '2026-10-26', '2026-10-27');
    state = mark(open(state, '2026-10-28'), '2026-10-28', 'skipped');
    state = doneOn(state, '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02');
    // Oct 29 never opened (missed); today Nov 3 open.
    const cal = calendar(state, '2026-11-03');
    expect(cal).toMatchObject({ completed: 6, eligible: 8 });
    expect(cal.streak).toMatchObject({ current: 4, best: 4 });
    expect(markOf(state, '2026-11-03', '2026-10-28')).toBe('missed');
    expect(markOf(state, '2026-11-03', '2026-10-29')).toBe('missed');
    expect(markOf(state, '2026-11-03', '2026-11-03')).toBe('open');
    // Days before tracking are not scored.
    expect(markOf(state, '2026-11-03', '2026-10-25')).toBe('before');
  });

  it('holds protected and moved-away days without counting them, and never double counts', () => {
    let state = doneOn(tracked('2026-10-26'), '2026-10-26');
    state = withDay(state, protectDay(open(state, '2026-10-27').days['2026-10-27'], 'illness'));
    state = withDay(state, {
      date: '2026-10-28',
      blocks: [],
      revisions: [],
      moved: [{ routineId: 'study', to: '2026-10-29', at: at('2026-10-28') }],
    });
    state = doneOn(state, '2026-10-29');
    const cal = calendar(state, '2026-10-30');
    expect(markOf(state, '2026-10-30', '2026-10-27')).toBe('held');
    expect(markOf(state, '2026-10-30', '2026-10-28')).toBe('held');
    expect(cal).toMatchObject({ completed: 2, eligible: 2 });
  });

  it('follows the recorded schedule: non-study days and pauses are not misses', () => {
    let state = doneOn(tracked('2026-10-26', [1, 3, 5]), '2026-10-26', '2026-10-28');
    expect(markOf(state, '2026-10-29', '2026-10-27')).toBe('none');
    state = upsertRoutine(
      state,
      career(state),
      { ...routine(state), enabled: false },
      at('2026-10-29', 12),
    );
    // Friday Oct 30 was a study weekday, but the routine was paused from Oct 29.
    expect(markOf(state, '2026-11-02', '2026-10-30')).toBe('none');
    expect(calendar(state, '2026-11-02')).toMatchObject({ completed: 2, eligible: 2 });
  });

  it('recalculates after a past-day Undo and an explicit skip today', () => {
    const state = doneOn(tracked('2026-10-26'), '2026-10-26', '2026-10-27');
    expect(calendar(state, '2026-10-28')).toMatchObject({ completed: 2, eligible: 2 });
    const undone = mark(state, '2026-10-27', 'planned');
    expect(calendar(undone, '2026-10-28')).toMatchObject({ completed: 1, eligible: 2 });
    const skipToday = mark(open(state, '2026-10-28'), '2026-10-28', 'skipped');
    expect(markOf(skipToday, '2026-10-28', '2026-10-28')).toBe('missed');
    expect(calendar(skipToday, '2026-10-28')).toMatchObject({ completed: 2, eligible: 3 });
  });

  it('shows nothing scored before a future start or without tracking', () => {
    const later = calendar(tracked('2026-12-01'), '2026-11-15');
    expect(later.days.every((d) => d.mark === 'before')).toBe(true);
    expect(later).toMatchObject({ completed: 0, eligible: 0 });
    const plain = studyState();
    const untracked = {
      ...plain,
      programs: plain.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === 'study' ? { ...r, study: { ...DSA_STUDY } } : r)),
      })),
    };
    expect(calendar(untracked, '2026-11-15').eligible).toBe(0);
  });

  it('reads the same after a backup is restored', () => {
    const today = '2026-11-03';
    let state = doneOn(
      tracked('2026-10-20'),
      ...[0, 1, 3, 4].map((i) => shiftDate('2026-10-26', i)),
    );
    state = mark(open(state, '2026-10-28'), '2026-10-28', 'skipped');
    const restored = parseBackup(encodeBackup(state)).state;
    expect(calendar(restored, today)).toEqual(calendar(state, today));
  });
});
