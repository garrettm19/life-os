import { describe, expect, it } from '@jest/globals';
import { decodeState, withDay } from '../data';
import { Program, Routine, State, displayDate, shiftDate } from '../model';
import { dayClearStreak, protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { upsertRoutine } from '../routines';
import { DSA_STUDY, saveStudyPlan } from '../study';
import { studyDayResult, studyStreak, studyStreakLine } from '../study-streak';
import { studyState } from '../../test-support/fixtures';

// Tracking starts Monday, October 26, 2026; the week includes the US clock
// change on Sunday, November 1.
const START = '2026-10-26';
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const at = (date: string, hour = 9) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
const id = (date: string, routine = 'study') => `${date}:routine:${routine}`;

function tracked(from = START, weekdays = EVERY_DAY): State {
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
/** Opens each date and marks study done. */
function doneOn(state: State, ...dates: string[]): State {
  for (const d of dates) state = mark(open(state, d), d, 'done');
  return state;
}
const career = (state: State): Program => state.programs.find((p) => p.id === 'career')!;
const routine = (state: State): Routine => career(state).routines.find((r) => r.id === 'study')!;
/** Edits the study routine in Programs on `date`, as the user would. */
function editOn(state: State, date: string, change: Partial<Routine>): State {
  return upsertRoutine(state, career(state), { ...routine(state), ...change }, at(date, 12));
}
const streak = (state: State, today: string) => studyStreak(state, routine(state), today);
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

describe('the study streak', () => {
  it('counts consecutive completed study days, including across a clock change', () => {
    const state = doneOn(tracked(), ...days(START, 8));
    // Today (Nov 3) is still open: it holds the run without breaking it.
    expect(streak(open(state, '2026-11-03'), '2026-11-03')).toEqual({
      current: 8,
      best: 8,
      since: START,
      today: 'open',
      later: false,
      todayDue: true,
    });
    expect(streak(doneOn(state, '2026-11-03'), '2026-11-03').current).toBe(9);
  });

  it('never scores days before its starting date', () => {
    let state = mark(open(tracked(), '2026-10-20'), '2026-10-20', 'skipped');
    state = doneOn(state, START, '2026-10-27');
    expect(streak(state, '2026-10-28')).toMatchObject({ current: 2, since: START });
  });

  it('breaks on a skipped, an unfinished or a never-opened scheduled day', () => {
    const base = doneOn(tracked(), START, '2026-10-27');
    const skipped = doneOn(mark(open(base, '2026-10-28'), '2026-10-28', 'skipped'), '2026-10-29');
    expect(streak(skipped, '2026-10-30')).toMatchObject({ current: 1, best: 2 });
    const unfinished = doneOn(open(base, '2026-10-28'), '2026-10-29');
    expect(streak(unfinished, '2026-10-30')).toMatchObject({ current: 1, best: 2 });
    const unopened = doneOn(base, '2026-10-29');
    expect(streak(unopened, '2026-10-30')).toMatchObject({ current: 1, best: 2 });
    // An explicit skip today ends the run now rather than tomorrow.
    const skipToday = mark(open(base, '2026-10-28'), '2026-10-28', 'skipped');
    expect(streak(skipToday, '2026-10-28')).toMatchObject({ current: 0, best: 2, today: 'missed' });
  });

  it('holds on a protected day or a day the study moved away from, without counting it', () => {
    let state = doneOn(tracked(), START);
    state = withDay(state, protectDay(open(state, '2026-10-27').days['2026-10-27'], 'illness'));
    state = withDay(state, {
      date: '2026-10-28',
      blocks: [],
      revisions: [],
      moved: [{ routineId: 'study', to: '2026-10-29', at: at('2026-10-28') }],
    });
    state = doneOn(state, '2026-10-29');
    expect(streak(state, '2026-10-30')).toMatchObject({ current: 2, best: 2 });
    expect(streak(mark(state, '2026-10-27', 'done'), '2026-10-30').current).toBe(3);
    // A skip on a protected day holds today as well as once the day is past.
    let protectedToday = withDay(
      doneOn(tracked(), START),
      protectDay(open(doneOn(tracked(), START), '2026-10-27').days['2026-10-27'], 'travel'),
    );
    protectedToday = mark(protectedToday, '2026-10-27', 'skipped');
    expect(streak(protectedToday, '2026-10-27')).toMatchObject({ current: 1, today: 'open' });
    expect(streak(protectedToday, '2026-10-28').current).toBe(1);
  });

  it('counts a done optional study day as kept and never scores an optional one as missed', () => {
    // Study turned optional on Oct 27; each occurrence created from then on is optional.
    let state = doneOn(tracked(), START);
    state = editOn(state, '2026-10-27', { optional: true });
    state = doneOn(state, '2026-10-27', '2026-10-28');
    expect(state.days['2026-10-28'].blocks.find((b) => b.routineId === 'study')?.optional).toBe(
      true,
    );
    expect(studyDayResult(state, routine(state), '2026-10-28')).toBe('kept');
    expect(streak(state, '2026-10-29')).toMatchObject({ current: 3, best: 3, today: 'open' });
    // Done today counts at once, as a required occurrence does.
    const doneToday = doneOn(state, '2026-10-29');
    expect(streak(doneToday, '2026-10-29')).toMatchObject({ current: 4, today: 'kept' });
    // Left open or skipped, an optional day is not scored: it neither counts nor breaks the run.
    state = open(state, '2026-10-29');
    state = mark(open(state, '2026-10-30'), '2026-10-30', 'skipped');
    expect(studyDayResult(state, routine(state), '2026-10-29')).toBeNull();
    expect(studyDayResult(state, routine(state), '2026-10-30')).toBeNull();
    expect(streak(state, '2026-10-30')).toMatchObject({ current: 3, today: 'open' });
    state = doneOn(state, '2026-10-31');
    expect(streak(state, '2026-11-01')).toMatchObject({ current: 4, best: 4 });
  });

  it('recalculates after Undo or a past-day edit', () => {
    const state = doneOn(tracked(), ...days(START, 4));
    expect(streak(state, '2026-10-30').current).toBe(4);
    const undone = mark(state, '2026-10-28', 'planned');
    expect(streak(undone, '2026-10-30')).toMatchObject({ current: 1, best: 2 });
    expect(streak(mark(undone, '2026-10-28', 'done'), '2026-10-30').current).toBe(4);
  });

  it('ignores weekdays the study is not scheduled', () => {
    // Mon, Wed, Fri only: Tue and Thu are not study days even when never opened.
    const state = doneOn(tracked(START, [1, 3, 5]), '2026-10-26', '2026-10-28', '2026-10-30');
    expect(streak(state, '2026-11-01').current).toBe(3);
  });

  it('reads each past day by the schedule recorded then: pausing never breaks it later', () => {
    let state = doneOn(tracked(), START, '2026-10-27');
    // Paused on Oct 28 and resumed on Nov 2; the paused days were never opened.
    state = editOn(state, '2026-10-28', { enabled: false });
    state = editOn(state, '2026-11-02', { enabled: true });
    state = doneOn(state, '2026-11-02');
    expect(routine(state).study!.schedule!.map((e) => [e.from, e.enabled])).toEqual([
      [START, true],
      ['2026-10-28', false],
      ['2026-11-02', true],
    ]);
    expect(streak(state, '2026-11-03')).toMatchObject({ current: 3, best: 3 });
  });

  it('adding a weekday never invents earlier misses; removing one never forgives them', () => {
    // Weekdays only from Oct 26; Saturday Oct 31 and Sunday Nov 1 were not study days.
    let state = doneOn(tracked(START, [1, 2, 3, 4, 5]), ...days(START, 5));
    state = editOn(state, '2026-11-02', { weekdays: EVERY_DAY });
    state = doneOn(state, '2026-11-02');
    expect(streak(state, '2026-11-03').current).toBe(6);
    // Every day from Oct 26, Wednesday Oct 28 never opened: removing Wednesday later keeps the miss.
    let daily = doneOn(tracked(), START, '2026-10-27', '2026-10-29');
    daily = editOn(daily, '2026-10-30', { weekdays: [0, 1, 2, 4, 5, 6] });
    daily = doneOn(daily, '2026-10-30');
    expect(streak(daily, '2026-10-31')).toMatchObject({ current: 2, best: 2 });
  });

  it('never counts a never-opened day as missed without a recorded schedule', () => {
    const state = saveStudyPlan(studyState(), 'study', {
      ...DSA_STUDY,
      trackFrom: START,
      schedule: undefined,
    });
    const plain = {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === 'study' ? { ...r, study: { ...r.study!, schedule: undefined } } : r,
        ),
      })),
    };
    const done = doneOn(plain, START, '2026-10-28');
    expect(studyDayResult(done, routine(done), '2026-10-27')).toBeNull();
    expect(streak(done, '2026-10-29').current).toBe(2);
  });

  it('rolls over at midnight: yesterday stays counted while today is open', () => {
    const state = doneOn(tracked(), START, '2026-10-27');
    expect(streak(state, '2026-10-27').current).toBe(2);
    expect(streak(state, '2026-10-28')).toMatchObject({ current: 2, today: 'open' });
    expect(streak(state, '2026-10-29').current).toBe(0);
  });

  it('is independent of the Day Clear streak', () => {
    const state = doneOn(tracked(), '2026-10-26', '2026-10-27');
    expect(streak(state, '2026-10-27').current).toBe(2);
    expect(dayClearStreak(state, '2026-10-27', '2026-10-27').current).toBe(0);
  });

  it('scores nothing without a starting date, and says when a later start begins', () => {
    const base = studyState();
    const none = {
      ...base,
      programs: base.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) => (r.id === 'study' ? { ...r, study: { ...DSA_STUDY } } : r)),
      })),
    };
    expect(streak(doneOn(none, START), '2026-10-27')).toMatchObject({ current: 0, since: null });
    const later = streak(tracked('2026-11-05'), '2026-11-01');
    expect(later).toMatchObject({ current: 0, later: true });
    expect(studyStreakLine(later)).toBe(`Study streak starts ${displayDate('2026-11-05')}`);
  });

  it('keeps its starting date and schedule when the plan is edited and refuses invalid ones', () => {
    const state = tracked();
    const edited = saveStudyPlan(state, 'study', { ...DSA_STUDY, at: 19 * 60 });
    expect(routine(edited).study).toMatchObject({ trackFrom: START, schedule: [{ from: START }] });
    const withStudy = (study: object) => ({
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === 'study' ? { ...r, study: { ...r.study!, ...study } } : r,
        ),
      })),
    });
    expect(() => decodeState(withStudy({ trackFrom: 'soon' }))).toThrow('study tracking start');
    expect(() =>
      decodeState(
        withStudy({
          schedule: [
            { from: '2026-11-02', weekdays: [1], enabled: true },
            { from: '2026-11-01', weekdays: [1], enabled: true },
          ],
        }),
      ),
    ).toThrow('out of order');
  });

  it('says where it stands without blame', () => {
    const base = { since: START, later: false, todayDue: true } as const;
    expect(studyStreakLine({ ...base, current: 4, best: 9, today: 'open' })).toBe(
      'Study streak 4 · best 9',
    );
    expect(studyStreakLine({ ...base, current: 0, best: 9, today: 'missed' })).toBe(
      'Study streak 0 · best 9',
    );
    // On a day that is not a study day, no new run starts today.
    expect(studyStreakLine({ ...base, current: 0, best: 9, today: 'open', todayDue: false })).toBe(
      'Study streak 0 · best 9',
    );
    // After a miss, while today is open, the line looks forward; the best is unchanged.
    expect(studyStreakLine({ ...base, current: 0, best: 9, today: 'open' })).toBe(
      'New streak starts today · best 9',
    );
    expect(studyStreakLine({ ...base, current: 0, best: 0, today: 'open' })).toBe(
      'Study streak starts today',
    );
  });

  it('after a missed day: no credit restored, the next completion starts a new run, best kept', () => {
    // Four days kept, Oct 30 never opened, today Oct 31 open.
    const state = doneOn(tracked(), ...days(START, 4));
    expect(streak(state, '2026-10-31')).toMatchObject({ current: 0, best: 4, today: 'open' });
    expect(studyStreakLine(streak(state, '2026-10-31'))).toBe('New streak starts today · best 4');
    const restarted = doneOn(state, '2026-10-31');
    expect(streak(restarted, '2026-10-31')).toMatchObject({ current: 1, best: 4 });
    expect(studyStreakLine(streak(restarted, '2026-10-31'))).toBe('Study streak 1 · best 4');
  });
});
