import { describe, expect, it } from '@jest/globals';
import { calendarDays, daysBetween, shortDate, weekStartOf } from '../model';

// Calendar helpers on local date keys. Synthetic dates only; the suite runs in several zones.
describe('local calendar helpers', () => {
  it('counts whole days either way, across clock changes and a year end', () => {
    // US clocks change on March 8 and November 1, 2026; the EU on October 25.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-11-09', '2026-11-09')).toBe(0);
  });

  it('finds the Monday of the week holding a date', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02');
    expect(daysBetween(weekStartOf('2026-10-28'), weekStartOf('2026-11-04'))).toBe(7);
  });

  it('sizes a calendar of whole weeks ending with the current one', () => {
    // From the Monday three weeks before this week's, through today.
    expect(calendarDays('2026-11-09')).toBe(22); // a Monday
    expect(calendarDays('2026-11-12')).toBe(25); // a Thursday
    expect(calendarDays('2026-11-15')).toBe(28); // a Sunday
    // Across the November clock change.
    expect(calendarDays('2026-11-01')).toBe(28);
    expect(calendarDays('2026-11-09', 1)).toBe(1);
  });

  it('writes a date without its weekday, and refuses one that does not exist', () => {
    expect(shortDate('2026-11-09')).toBe('Nov 9');
    expect(shortDate('2027-01-01')).toBe('Jan 1');
    expect(() => shortDate('2026-02-30')).toThrow();
  });
});
