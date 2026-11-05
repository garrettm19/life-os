import { describe, expect, it } from '@jest/globals';
import {
  addDays,
  candleDate,
  gexLocks,
  gexWindow,
  nyClockText,
  nyInstant,
  nyOffsetHours,
  nyTime,
} from '../market-clock';

// Instants are written in UTC so the test means the same in every zone the suite runs in.
const utc = (s: string) => Date.parse(`${s}Z`);
const HOUR = 3_600_000;

describe('market clock', () => {
  it('follows the US daylight-saving rule for New York', () => {
    // 2026: daylight time from Sunday March 8 at 2:00 to Sunday November 1 at 2:00.
    expect(nyOffsetHours(utc('2026-03-08T06:59:00'))).toBe(5);
    expect(nyOffsetHours(utc('2026-03-08T07:00:00'))).toBe(4);
    expect(nyOffsetHours(utc('2026-11-01T05:59:00'))).toBe(4);
    expect(nyOffsetHours(utc('2026-11-01T06:00:00'))).toBe(5);
    expect(nyTime(utc('2026-10-19T22:42:00'))).toEqual({
      date: '2026-10-19',
      minutes: 18 * 60 + 42,
    });
    expect(nyTime(utc('2026-12-01T14:30:00'))).toEqual({
      date: '2026-12-01',
      minutes: 9 * 60 + 30,
    });
    expect(nyInstant('2026-10-20', 9 * 60 + 30)).toBe(utc('2026-10-20T13:30:00'));
    expect(nyInstant('2026-12-01', 9 * 60 + 30)).toBe(utc('2026-12-01T14:30:00'));
    expect(nyClockText(utc('2026-10-19T22:42:00'))).toBe('6:42 PM');
    expect(nyClockText(utc('2026-10-20T04:05:00'))).toBe('12:05 AM');
  });

  it('rolls the daily candle at 6 PM New York time, and weekends belong to Monday', () => {
    // Monday 5:59 PM is still Monday's candle; 6:00 PM opens Tuesday's.
    expect(candleDate(utc('2026-10-19T21:59:00'))).toBe('2026-10-19');
    expect(candleDate(utc('2026-10-19T22:00:00'))).toBe('2026-10-20');
    // Friday evening, Saturday and Sunday before 6 PM are all Monday's candle.
    expect(candleDate(utc('2026-10-23T22:30:00'))).toBe('2026-10-26');
    expect(candleDate(utc('2026-10-24T15:00:00'))).toBe('2026-10-26');
    expect(candleDate(utc('2026-10-25T21:59:00'))).toBe('2026-10-26');
    expect(candleDate(utc('2026-10-25T22:00:00'))).toBe('2026-10-26');
    // Across a month and year end.
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('a GEX range is valid for 6.5 hours after the 6 PM and 9:30 AM locks', () => {
    const [evening, morning] = gexLocks('2026-10-20');
    // The evening lock runs past midnight: Monday 6:00 PM to Tuesday 12:30 AM.
    expect(evening.start).toBe(utc('2026-10-19T22:00:00'));
    expect(evening.end).toBe(utc('2026-10-20T04:30:00'));
    expect(evening.hours).toBe('6:00 PM–12:30 AM');
    expect(morning.start).toBe(utc('2026-10-20T13:30:00'));
    expect(morning.end).toBe(utc('2026-10-20T20:00:00'));
    expect(morning.hours).toBe('9:30 AM–4:00 PM');
    expect(evening.end - evening.start).toBe(6.5 * HOUR);
    expect(morning.end - morning.start).toBe(6.5 * HOUR);
    // Monday's evening lock opens on Sunday and runs until Monday 12:30 AM.
    expect(gexLocks('2026-10-26')[0].start).toBe(utc('2026-10-25T22:00:00'));
    expect(gexLocks('2026-10-26')[0].end).toBe(utc('2026-10-26T04:30:00'));
  });

  it('says which lock is valid, and which comes next', () => {
    const at = (s: string) => gexWindow(utc(s));
    const evening = at('2026-10-19T23:00:00');
    expect(evening.candle).toBe('2026-10-20');
    expect(evening.valid?.id).toBe('evening');
    expect(evening.locks.map((l) => l.status)).toEqual(['valid', 'upcoming']);
    expect((evening.valid?.end ?? 0) - utc('2026-10-19T23:00:00')).toBe(5.5 * HOUR);
    // 12:15 AM Tuesday is Tuesday's candle, whose evening lock opened Monday at 6 PM.
    const late = at('2026-10-20T04:15:00');
    expect(late.candle).toBe('2026-10-20');
    expect(late.valid?.id).toBe('evening');
    expect(late.valid?.start).toBe(utc('2026-10-19T22:00:00'));
    // 12:29 AM: still valid; 12:30 AM: expired, and the 9:30 AM lock is next.
    expect(at('2026-10-20T04:29:00').valid?.id).toBe('evening');
    const night = at('2026-10-20T04:30:00');
    expect(night.valid).toBeNull();
    expect(night.next.id).toBe('morning');
    expect(night.locks.map((l) => l.status)).toEqual(['expired', 'upcoming']);
    expect(at('2026-10-20T15:00:00').valid?.id).toBe('morning');
    // 3:59 PM: the 9:30 AM range is still valid; 4:00 PM: both are spent, and the next is the
    // 6 PM lock that opens Wednesday's candle.
    expect(at('2026-10-20T19:59:00').valid?.id).toBe('morning');
    const afternoon = at('2026-10-20T20:00:00');
    expect(afternoon.valid).toBeNull();
    expect(afternoon.locks.map((l) => l.status)).toEqual(['expired', 'expired']);
    expect(afternoon.next.start).toBe(utc('2026-10-20T22:00:00'));
    // Friday after 4 PM: the next lock is Sunday 6 PM, for Monday. Friday night has none.
    expect(at('2026-10-23T20:00:00').next.start).toBe(utc('2026-10-25T22:00:00'));
    const friday = at('2026-10-24T04:15:00');
    expect(friday.candle).toBe('2026-10-26');
    expect(friday.valid).toBeNull();
    expect(friday.next.start).toBe(utc('2026-10-25T22:00:00'));
    // Sunday 6 PM opens Monday's candle, valid until Monday 12:30 AM.
    expect(at('2026-10-25T22:00:00').valid?.id).toBe('evening');
    expect(at('2026-10-26T04:29:00').valid?.id).toBe('evening');
    expect(at('2026-10-26T04:30:00').valid).toBeNull();
    // In winter the same wall-clock hours hold.
    expect(at('2026-12-01T14:30:00').valid?.id).toBe('morning');
    expect(at('2026-12-01T14:29:00').valid).toBeNull();
    expect(at('2026-12-01T20:59:00').valid?.id).toBe('morning');
    expect(at('2026-12-01T21:00:00').valid).toBeNull();
    expect(at('2026-12-01T05:29:00').valid?.id).toBe('evening');
    expect(at('2026-12-01T05:30:00').valid).toBeNull();
  });

  it('keeps the wall-clock windows across the daylight-saving changes', () => {
    const at = (s: string) => gexWindow(utc(s));
    // November 1, 2026: daylight time ends at 2:00 that Sunday. Friday's 9:30 AM range is still
    // EDT; Sunday's 6 PM lock for Monday is EST, 6:00 PM to 12:30 AM.
    expect(at('2026-10-30T19:59:00').valid?.id).toBe('morning');
    expect(at('2026-10-30T20:00:00').next.start).toBe(utc('2026-11-01T23:00:00'));
    const [nov, novMorning] = gexLocks('2026-11-02');
    expect([nov.start, nov.end]).toEqual([utc('2026-11-01T23:00:00'), utc('2026-11-02T05:30:00')]);
    expect([novMorning.start, novMorning.end]).toEqual([
      utc('2026-11-02T14:30:00'),
      utc('2026-11-02T21:00:00'),
    ]);
    expect(at('2026-11-02T05:29:00').valid?.id).toBe('evening');
    expect(at('2026-11-02T05:30:00').valid).toBeNull();
    // March 8, 2026: daylight time starts at 2:00 that Sunday. Friday's range is EST; Sunday's
    // 6 PM lock for Monday is EDT, 6:00 PM to 12:30 AM.
    expect(at('2026-03-06T20:59:00').valid?.id).toBe('morning');
    expect(at('2026-03-06T21:00:00').next.start).toBe(utc('2026-03-08T22:00:00'));
    const [mar, marMorning] = gexLocks('2026-03-09');
    expect([mar.start, mar.end]).toEqual([utc('2026-03-08T22:00:00'), utc('2026-03-09T04:30:00')]);
    expect([marMorning.start, marMorning.end]).toEqual([
      utc('2026-03-09T13:30:00'),
      utc('2026-03-09T20:00:00'),
    ]);
    expect(at('2026-03-09T04:29:00').valid?.id).toBe('evening');
    expect(at('2026-03-09T04:30:00').valid).toBeNull();
  });
});
