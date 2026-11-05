import { describe, expect, it } from '@jest/globals';
import { anchorRoutine, correctMorning, morningOn } from '../anchor';
import { withDay } from '../data';
import { State, calendarDays, shiftDate } from '../model';
import { ensureChecklistDay, setStatus } from '../planner';
import { MORNING_WEEKS, morningWords, mornings, progress } from '../progress';
import { anchorState } from '../../test-support/fixtures';

// Synthetic data only: the Mornings card on Progress, read from a synthetic anchor at 7:10 AM.
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
};
const id = (date: string) => `${date}:routine:up`;
function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], at(date, 5)),
  );
}
function tick(state: State, date: string, hour: number, minute = 0): State {
  const opened = open(state, date);
  return withDay(opened, setStatus(opened.days[date], id(date), 'done', at(date, hour, minute)));
}
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

describe('the Mornings card', () => {
  it('shows only while an enabled routine is the anchor', () => {
    const plain = anchorState();
    delete plain.programs[0].routines[0].anchor;
    expect(mornings(plain, '2026-11-09')).toBeNull();
    const paused = anchorState();
    paused.programs[0].routines[0].enabled = false;
    expect(mornings(paused, '2026-11-09')).toBeNull();
    expect(progress(anchorState(), '4w', '2026-11-09').mornings).not.toBeNull();
  });

  it('starts with one line instead of an empty calendar until two mornings are ticked', () => {
    let s = open(anchorState(), '2026-11-02');
    expect(mornings(s, '2026-11-02')).toMatchObject({
      state: 'start',
      headline: 'Up by 7:10 AM',
      note: 'Your first tick starts the calendar.',
      month: null,
      usual: null,
    });
    s = tick(s, '2026-11-02', 7, 4);
    expect(mornings(s, '2026-11-02')).toMatchObject({
      state: 'start',
      headline: 'Up by 7:10 AM',
      note: 'First tick Mon, Nov 2. The calendar fills in from the next one.',
    });
    s = tick(s, '2026-11-03', 8, 20);
    expect(mornings(s, '2026-11-03')!.state).toBe('chart');
  });

  it('leads with the rolling count, and with the time alone when none of the last seven was on time', () => {
    let s = anchorState();
    for (const d of days('2026-11-02', 4)) s = tick(s, d, 7, 0);
    for (const d of days('2026-11-06', 3)) s = tick(s, d, 8, 30);
    s = open(s, '2026-11-09');
    expect(mornings(s, '2026-11-09')!.headline).toBe('On time 4 of the last 7');
    for (const d of days('2026-11-09', 7)) s = tick(s, d, 9, 0);
    const card = mornings(s, '2026-11-15')!;
    expect(card.headline).toBe('Up by 7:10 AM');
    expect(card.summary).not.toMatch(/(?<![\d:])0(?![\d:])/);
  });

  it('compares this month so far with the same days of last month, never with nothing', () => {
    // Started this month: "Started", never a comparison.
    let s = anchorState();
    for (const d of days('2026-11-02', 9)) s = tick(s, d, 7, 0);
    expect(mornings(s, '2026-11-10')!.month).toEqual({
      text: 'November: 9 by the 10th · Started Nov 2',
      spoken: 'November: 9 mornings on time by the 10th. Started Nov 2.',
      direction: null,
      now: 9,
      before: null,
      lastName: 'October',
      span: 'Started Nov 2',
      change: null,
    });
    // Started later in last month than today's date: "Started", never fewer days against these.
    let late = anchorState('2026-10-12');
    for (const d of days('2026-10-12', 25)) late = tick(late, d, 7, 0);
    expect(mornings(late, '2026-11-05')!.month!.text).toBe(
      'November: 5 by the 5th · Started Oct 12',
    );
    // Started on October 1: the first 16 days of each month.
    let t = anchorState('2026-10-01');
    for (const d of days('2026-10-01', 6)) t = tick(t, d, 7, 0);
    for (const d of days('2026-10-07', 10)) t = tick(t, d, 9, 0);
    for (const d of days('2026-11-01', 9)) t = tick(t, d, 7, 0);
    for (const d of days('2026-11-10', 7)) t = tick(t, d, 9, 0);
    // A morning after the 16th of October is not compared.
    t = tick(t, '2026-10-20', 7, 0);
    const month = mornings(t, '2026-11-16')!.month!;
    expect(month.text).toBe('November: 9 by the 16th · October: 6 by the 16th');
    expect(month.direction).toBe('up');
    // The card sets the two figures side by side, with the rise as a few words.
    expect(month).toMatchObject({
      now: 9,
      before: 6,
      span: 'Same days of October',
      change: '↑ 3 more',
    });
    expect(month.spoken).toBe(
      'November: 9 mornings on time by the 16th, 3 more than October, which had 6 by the 16th.',
    );
  });

  it('compares the 31st with the last day of a shorter month, and speaks a fall without its size', () => {
    let s = anchorState('2026-11-01');
    for (const d of days('2026-11-01', 30)) s = tick(s, d, 7, 0);
    for (const d of days('2026-12-01', 31)) s = tick(s, d, d < '2026-12-26' ? 7 : 9, 0);
    expect(mornings(s, '2026-12-31')!.month).toEqual({
      text: 'December: 25 by the 31st · November: 30 by the 30th',
      spoken:
        'December: 25 mornings on time by the 31st, fewer than November, which had 30 by the 30th.',
      direction: 'down',
      now: 25,
      before: 30,
      lastName: 'November',
      span: 'Same days of November',
      // A fall in neutral words, never its size.
      change: 'Fewer than November',
    });
  });

  it('compares the first month on the same days once the anchor began during last month', () => {
    let s = anchorState('2026-11-02');
    for (const d of days('2026-11-02', 29)) s = tick(s, d, 7, 0);
    for (const d of days('2026-12-01', 16))
      s = tick(s, d, d === '2026-12-10' || d === '2026-12-11' ? 9 : 7, 0);
    // The 1st of December is on time but before the days November can be compared on.
    expect(mornings(s, '2026-12-01')!.month!.text).toBe('December: 1 by the 1st · Started Nov 2');
    expect(mornings(s, '2026-12-16')!.month).toEqual({
      text: 'December 2–16: 13 · November 2–16: 15',
      spoken:
        'December: 13 mornings on time from the 2nd to the 16th, fewer than November, which had 15 from the 2nd to the 16th.',
      direction: 'down',
      now: 13,
      before: 15,
      lastName: 'November',
      span: 'December 2–16 · November 2–16',
      change: 'Fewer than November',
    });
    // Up, the spoken line gives the difference.
    for (const d of ['2026-11-03', '2026-11-04', '2026-11-05']) s = tick(s, d, 9, 0);
    expect(mornings(s, '2026-12-16')!.month).toMatchObject({
      text: 'December 2–16: 13 · November 2–16: 12',
      direction: 'up',
      change: '↑ 1 more',
    });
    expect(mornings(s, '2026-12-16')!.month!.spoken).toContain('1 more than November');
  });

  it('names only this month when last month had none, and nothing before this month has one', () => {
    let s = anchorState('2026-10-01');
    for (const d of days('2026-10-01', 10)) s = tick(s, d, 9, 0);
    for (const d of days('2026-11-01', 3)) s = tick(s, d, 7, 0);
    expect(mornings(s, '2026-11-10')!.month).toMatchObject({
      text: 'November: 3 by the 10th',
      now: 3,
      before: null,
      span: null,
      change: null,
    });
    let t = anchorState('2026-10-01');
    for (const d of days('2026-10-01', 10)) t = tick(t, d, 7, 0);
    for (const d of days('2026-11-01', 3)) t = tick(t, d, 9, 0);
    // Nothing on time this month yet: no month line rather than October against nothing.
    expect(mornings(t, '2026-11-10')!.month).toBeNull();
  });

  it('draws five Monday-to-Sunday weeks, a never-opened day left blank as not recorded', () => {
    let s = tick(anchorState('2026-10-20'), '2026-11-02', 7, 0);
    s = tick(s, '2026-11-03', 9, 0);
    s = open(s, '2026-11-04');
    s = open(s, '2026-11-06');
    const card = mornings(s, '2026-11-06')!;
    // From the week the anchor began (Monday, October 19), not five weeks of blanks.
    expect(card.days[0].date).toBe('2026-10-19');
    expect(card.days).toHaveLength(calendarDays('2026-11-06', 3));
    // An anchor older than five weeks fills all five.
    const old = mornings(tick(anchorState('2026-09-01'), '2026-11-02', 7, 0), '2026-11-06')!;
    expect(old.days).toHaveLength(calendarDays('2026-11-06', MORNING_WEEKS));
    expect(old.days[0].date).toBe('2026-10-05');
    const markOf = (d: string) => card.days.find((m) => m.date === d)!.mark;
    expect(markOf('2026-10-19')).toBe('before');
    expect(markOf('2026-10-21')).toBe('none');
    expect(markOf('2026-11-02')).toBe('on-time');
    expect(markOf('2026-11-03')).toBe('late');
    expect(markOf('2026-11-04')).toBe('not-ticked');
    expect(markOf('2026-11-05')).toBe('none');
    expect(markOf('2026-11-06')).toBe('open');
  });

  it('gives the usual tick time as the median and the middle half', () => {
    let s = anchorState();
    const minutes = [0, 5, 10, 12, 15, 20, 40];
    days('2026-11-02', 7).forEach((d, i) => (s = tick(s, d, 7, minutes[i])));
    // Median 7:12; the middle half from 7:07.5 to 7:17.5 (interpolated), each to the minute.
    expect(mornings(s, '2026-11-08')!.usual).toBe(
      'Usually ticked by 7:12 AM · half of mornings between 7:08 AM and 7:18 AM',
    );
    // Every tick at one minute: the median alone.
    let same = anchorState();
    for (const d of days('2026-11-02', 3)) same = tick(same, d, 7, 0);
    expect(mornings(same, '2026-11-04')!.usual).toBe('Usually ticked by 7:00 AM');
    let two = tick(anchorState(), '2026-11-02', 7, 0);
    two = tick(two, '2026-11-03', 7, 0);
    expect(mornings(two, '2026-11-03')!.usual).toBeNull();
  });

  it('reads each morning in words, a correction marked corrected', () => {
    let s = tick(anchorState(), '2026-11-02', 9, 40);
    s = withDay(s, correctMorning(s.days['2026-11-02'], id('2026-11-02'), 7 * 60 + 2));
    s = tick(s, '2026-11-03', 8, 5);
    s = open(s, '2026-11-04');
    const card = mornings(s, '2026-11-05')!;
    const words = (d: string) => morningWords(card.days.find((m) => m.date === d)!);
    expect(words('2026-11-02')).toBe('on time, up at 7:02 AM, corrected');
    expect(words('2026-11-03')).toBe('ticked 8:05 AM, after the window');
    expect(words('2026-11-04')).toBe('not ticked');
    expect(words('2026-11-05')).toBe('today, not ticked yet');
    expect(morningWords(morningOn(s, anchorRoutine(s)!, '2026-11-01', '2026-11-05'))).toBe(
      'before the anchor started',
    );
    for (const m of card.days) expect(morningWords(m)).not.toMatch(/miss/i);
  });
});
