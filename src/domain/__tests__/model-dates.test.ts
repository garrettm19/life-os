import { describe, expect, it } from '@jest/globals';
import {
  calendarDays,
  daysBetween,
  parseTime,
  readTime,
  shortDate,
  timeInput,
  weekStartOf,
} from '../model';

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

describe('typed times of day', () => {
  it.each([
    ['0:00', 0],
    ['7:30', 450],
    ['07:30', 450],
    ['19:30', 1170],
    ['7:30 am', 450],
    ['7:30 PM', 1170],
    ['7:30pm', 1170],
    ['7 pm', 1140],
    ['7pm', 1140],
    ['7:30 p.m.', 1170],
    ['7:05a', 425],
    ['12am', 0],
    ['12:30 am', 30],
    ['12pm', 720],
    ['12:45 PM', 765],
    ['  9:00 AM  ', 540],
  ])('reads %p as %p minutes', (text, minutes) => {
    expect(parseTime(text)).toBe(minutes);
  });

  it.each([
    '730',
    '1930',
    '7',
    '13pm',
    '0am',
    '0:30 pm',
    '7:60',
    '24:00',
    '25:00',
    'seven',
    '7:3',
    '',
  ])('refuses %p', (text) => {
    expect(() => parseTime(text)).toThrow();
  });

  it('takes the end of the day only where midnight is allowed', () => {
    expect(parseTime('24:00', true)).toBe(1440);
    expect(parseTime('12 am', true)).toBe(1440);
    expect(parseTime('12:00 AM', true)).toBe(1440);
    expect(parseTime('12:30 am', true)).toBe(30);
    expect(parseTime('0:00', true)).toBe(0);
    expect(() => parseTime('24:00')).toThrow();
  });

  it('prefills a saved time in the 12-hour form it reads back as', () => {
    for (const minutes of [0, 1, 450, 719, 720, 1170, 1439]) {
      expect(parseTime(timeInput(minutes))).toBe(minutes);
    }
    expect(timeInput(1440)).toBe('12:00 AM');
    expect(parseTime(timeInput(1440), true)).toBe(1440);
  });

  it('reads nothing back from a blank or wrong entry', () => {
    expect(readTime('')).toBeNull();
    expect(readTime('730')).toBeNull();
    expect(readTime('7pm')).toBe(1140);
  });
});
