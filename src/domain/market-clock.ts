// New York time for the futures day, from the US daylight-saving rule (second Sunday of March to
// the first Sunday of November, changing at 2:00 local), so the phone's own zone never matters.
// The daily candle opens at 6:00 PM New York time; a bias set after that belongs to the next
// day's candle. Session-locked GEX is read at the 6:00 PM and 9:30 AM opens and is valid for six
// and a half hours after each: 6:00 PM to 12:30 AM and 9:30 AM to 4:00 PM. Exchange holidays and
// early closes are not known here.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The daily candle opens at 6:00 PM New York time. */
const CANDLE_OPEN = 18 * 60;
/** How long a session-locked GEX range stays valid after its lock. */
const GEX_VALID_HOURS = 6.5;

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m - 1, d];
}

/**
 * A calendar date moved by whole days, with no time zone involved. These are New York trading
 * dates, so the arithmetic is in UTC rather than `shiftDate`'s local calendar: the phone's zone must
 * never matter here.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return iso(new Date(Date.UTC(y, m, d + days)));
}

/** 0 Sunday … 6 Saturday. */
function weekdayOf(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/** Day of the month of the nth Sunday. */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

/** Hours New York is behind UTC at an instant: 4 in daylight time, 5 otherwise. */
export function nyOffsetHours(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 7); // 2:00 EST
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 6); // 2:00 EDT
  return ms >= start && ms < end ? 4 : 5;
}

/** The New York calendar date and minutes after midnight at an instant. */
export function nyTime(ms: number): { date: string; minutes: number } {
  const wall = new Date(ms - nyOffsetHours(ms) * HOUR);
  return { date: iso(wall), minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes() };
}

/** The instant of a New York wall-clock time on a date. */
export function nyInstant(date: string, minutes: number): number {
  const [y, m, d] = parts(date);
  const wall = Date.UTC(y, m, d) + minutes * MINUTE;
  const standard = wall + 5 * HOUR;
  return nyOffsetHours(standard) === 5 ? standard : wall + 4 * HOUR;
}

/**
 * The trading date of the daily candle at an instant: the New York date, or the next day from
 * 6:00 PM. A weekend belongs to Monday's candle, which opens Sunday at 6:00 PM.
 */
export function candleDate(ms: number): string {
  const { date, minutes } = nyTime(ms);
  const next = minutes >= CANDLE_OPEN ? addDays(date, 1) : date;
  const weekday = weekdayOf(next);
  return weekday === 6 ? addDays(next, 2) : weekday === 0 ? addDays(next, 1) : next;
}

/** The candle before a candle's date: the weekday before it (Friday's before Monday's). */
export function previousCandle(candle: string): string {
  let day = addDays(candle, -1);
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = addDays(day, -1);
  return day;
}

/** The candle after a candle's date: the next weekday (Monday's after Friday's). */
export function nextCandle(candle: string): string {
  let day = addDays(candle, 1);
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = addDays(day, 1);
  return day;
}

export type GexLockId = 'evening' | 'morning';

export type GexLock = {
  id: GexLockId;
  /** "6 PM lock" or "9:30 AM lock". */
  title: string;
  /** "6:00 PM–12:30 AM" in New York time. */
  hours: string;
  start: number;
  end: number;
};

/**
 * A candle's two session locks: 6:00 PM the evening before, valid past midnight until 12:30 AM on
 * the candle's date, then 9:30 AM on the day, valid until 4:00 PM.
 */
export function gexLocks(candle: string): GexLock[] {
  const evening = nyInstant(addDays(candle, -1), CANDLE_OPEN);
  const morning = nyInstant(candle, 9 * 60 + 30);
  return [
    {
      id: 'evening',
      title: '6 PM lock',
      hours: '6:00 PM–12:30 AM',
      start: evening,
      end: evening + GEX_VALID_HOURS * HOUR,
    },
    {
      id: 'morning',
      title: '9:30 AM lock',
      hours: '9:30 AM–4:00 PM',
      start: morning,
      end: morning + GEX_VALID_HOURS * HOUR,
    },
  ];
}

export type LockStatus = 'upcoming' | 'valid' | 'expired';

function lockStatus(lock: GexLock, now: number): LockStatus {
  return now < lock.start ? 'upcoming' : now < lock.end ? 'valid' : 'expired';
}

export type GexWindow = {
  candle: string;
  locks: { lock: GexLock; status: LockStatus }[];
  /** The lock whose range is valid now, if any. */
  valid: GexLock | null;
  /** The next lock to open: later today, or the next candle's 6 PM lock. */
  next: GexLock;
};

/** Where the GEX range stands at an instant. */
export function gexWindow(now: number): GexWindow {
  const candle = candleDate(now);
  const locks = gexLocks(candle).map((lock) => ({ lock, status: lockStatus(lock, now) }));
  const valid = locks.find((l) => l.status === 'valid')?.lock ?? null;
  const upcoming = locks.find((l) => l.status === 'upcoming')?.lock;
  // After 4:00 PM both locks are spent; the next one is tonight's 6 PM open for the next candle,
  // or Sunday's after a Friday.
  return { candle, locks, valid, next: upcoming ?? gexLocks(nextCandle(candle))[0] };
}

/** "7:42 PM" in New York time. */
export function nyClockText(ms: number): string {
  const { minutes } = nyTime(ms);
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
