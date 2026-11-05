import { candleDate } from './market-clock';
import { State, dateObject } from './model';
import { TradingSession, decodeTradingSession, newSession, sessionDateOf } from './trading';

// Each daily candle's trading session, kept in the saved data by its candle date: in SQLite, in
// backups, and replaced only with the rest of the data. Earlier builds kept the sessions on the
// device beside the data (`life-os-trading-session:<date>`); they are moved in once
// (`importDeviceSessions`) and the device's records are left where they were.

/** Shown when a session would be saved that does not read back as one. */
const INVALID_LINE = 'The trading session is not valid and was not saved.';

/** Shown when the record a session belongs to could not be read when it was moved in. */
export const UNREADABLE_LINE = "The day's trading session cannot be read.";

/**
 * Whether a candle's session is unknown: a record kept on this device by an earlier build that
 * could hold it (the candle's own, or the record of its session date east of New York,
 * `sessionDateOf`) could not be read or placed when the sessions were moved in. It is never taken
 * for a candle without a session.
 */
export function sessionUnreadable(state: State, candle: string): boolean {
  const kept = state.tradingSessionsUnreadable;
  if (!kept) return false;
  return candle in kept || sessionDateOf(candle) in kept;
}

/**
 * Saves a candle's session, keyed by its date, once it reads back as a session; anything else
 * throws and nothing changes. A candle whose session could not be read is never overwritten.
 */
export function putTradingSession(state: State, session: TradingSession): State {
  dateObject(session.date);
  if (sessionUnreadable(state, session.date)) throw new Error(UNREADABLE_LINE);
  const stored = JSON.parse(JSON.stringify(session)) as TradingSession;
  if (!decodeTradingSession(stored)) throw new Error(INVALID_LINE);
  return { ...state, tradingSessions: { ...state.tradingSessions, [session.date]: stored } };
}

/**
 * Checks the saved sessions: each a session for the candle date it is kept under. `unchanged`
 * names dates whose stored content was already checked and saved, so they are not checked again.
 */
export function validateTradingSessions(
  sessions: unknown,
  unreadable: unknown,
  imported: unknown,
  unchanged?: ReadonlySet<string>,
): void {
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions))
    throw new Error('The file contains invalid trading sessions.');
  for (const [date, session] of Object.entries(sessions)) {
    if (unchanged?.has(date)) continue;
    dateObject(date);
    const decoded = decodeTradingSession(session);
    if (!decoded || decoded.date !== date)
      throw new Error('The file contains an invalid trading session.');
  }
  if (
    unreadable !== undefined &&
    (!unreadable ||
      typeof unreadable !== 'object' ||
      Array.isArray(unreadable) ||
      Object.values(unreadable).some((raw) => typeof raw !== 'string'))
  )
    throw new Error('The file contains invalid kept trading records.');
  if (imported !== undefined && imported !== true)
    throw new Error('The file contains an invalid trading sessions flag.');
}

/** The fields of a stored session that belong to its session (the lock, entries, the end). */
const SESSION_FIELDS = [
  'startedAt',
  'failedTheses',
  'resetStartedAt',
  'doneAt',
  'doneReason',
  'thesis',
  'gates',
  'entries',
  'resets',
  'lockedLimits',
  'lockedRisk',
  'regimeLog',
  'eveningSupport',
  'remappedGex',
] as const;

type Fields = Record<string, unknown>;

/** A session moved from a device record onto the candle it ran in. */
type Moved = { from: string; fields: Fields; started: boolean };

/**
 * A device record split in two: what belongs to its own candle (the bias, the preflight, the plan
 * and any key this build does not know), and its session, if it holds one, with the candle that
 * session ran in. East of New York earlier builds kept a candle's session on the next date's
 * record, beside that date's own bias (`sessionDateOf`): the session's candle is the one its start
 * fell in, and a record that never started belongs to its own candle.
 */
function split(session: Fields & TradingSession): {
  own: Fields;
  moved: Moved | null;
  candle: string;
} {
  const own: Fields = {};
  const fields: Fields = {};
  for (const [key, value] of Object.entries(session)) {
    if (key === 'date') continue;
    if ((SESSION_FIELDS as readonly string[]).includes(key)) fields[key] = value;
    else own[key] = value;
  }
  const blank = newSession(session.date) as unknown as Fields;
  const empty = SESSION_FIELDS.every((k) => fields[k] === undefined || fields[k] === blank[k]);
  const started = !!session.startedAt;
  const candle = started ? candleDate(Date.parse(session.startedAt!)) : session.date;
  // A started session placed off the record it was kept on says where it came from: its review
  // was saved on that date (`candleReview`).
  if (started && candle !== session.date) fields.movedFrom = session.date;
  return { own, moved: empty ? null : { from: session.date, fields, started }, candle };
}

/**
 * Moves the trading sessions earlier builds kept on this device (`records`: each record's date and
 * stored text) into the saved data, once: each is keyed by the candle it belongs to, the candle's
 * own fields and its session's merged into one record, with every field kept, unknown ones too.
 * A record that cannot be read, or a second session for a candle that already has one, is kept
 * verbatim in `tradingSessionsUnreadable` and never deleted. A candle already in the saved data
 * keeps its saved record. The device's records are left as they are; the flag set here means they
 * are never read again. Saved data already moved in is returned unchanged.
 */
export function importDeviceSessions(state: State, records: [string, string][]): State {
  if (state.tradingSessionsImported) return state;
  const unreadable: Record<string, string> = { ...state.tradingSessionsUnreadable };
  const raw = new Map<string, string>();
  const own = new Map<string, Fields>();
  const moved = new Map<string, Moved[]>();
  for (const [date, text] of [...records].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    let session: TradingSession | null = null;
    let stored: Fields = {};
    try {
      dateObject(date);
      stored = JSON.parse(text);
      session = decodeTradingSession(stored);
    } catch {
      session = null;
    }
    if (!session || session.date !== date) {
      unreadable[date] = text;
      continue;
    }
    raw.set(date, text);
    // Every stored key is kept, those the reader leaves out (a pre-1.1 `plans` list) too.
    const parts = split({ ...stored, ...session } as Fields & TradingSession);
    own.set(date, parts.own);
    if (parts.moved) moved.set(parts.candle, [...(moved.get(parts.candle) ?? []), parts.moved]);
  }
  const sessions: Record<string, TradingSession> = {};
  const candles = [...new Set([...own.keys(), ...moved.keys()])].sort();
  for (const candle of candles) {
    if (state.tradingSessions[candle]) continue;
    // One session per candle: a started one first, then the one kept where the cockpit kept it
    // (its session date's record, then its own); any other is kept verbatim.
    const rank = (m: Moved) =>
      (m.started ? 0 : 4) + (m.from === sessionDateOf(candle) ? 0 : m.from === candle ? 1 : 2);
    const [winner, ...others] = [...(moved.get(candle) ?? [])].sort(
      (a, b) => rank(a) - rank(b) || (a.from < b.from ? -1 : 1),
    );
    for (const other of others) unreadable[other.from] = raw.get(other.from)!;
    // A record with nothing of its own and no session (east of New York, a Saturday's record that
    // only held Friday's session) leaves no empty session behind.
    const ownFields = own.get(candle) ?? {};
    const blank = newSession(candle) as unknown as Fields;
    if (!winner && Object.entries(ownFields).every(([k, v]) => k in blank && v === blank[k]))
      continue;
    const merged = {
      ...newSession(candle),
      ...ownFields,
      ...winner?.fields,
      date: candle,
    } as TradingSession;
    if (decodeTradingSession(JSON.parse(JSON.stringify(merged)))) {
      sessions[candle] = merged;
      continue;
    }
    // Parts that do not read back as one session stay as they were stored.
    if (own.has(candle)) unreadable[candle] = raw.get(candle)!;
    if (winner) unreadable[winner.from] = raw.get(winner.from)!;
  }
  const kept = Object.keys(unreadable).length > 0;
  return {
    ...state,
    tradingSessions: { ...state.tradingSessions, ...sessions },
    ...(kept && { tradingSessionsUnreadable: unreadable }),
    tradingSessionsImported: true,
  };
}

/**
 * The data that replaces the saved data (Reset, restore, the demo, Start tracking) keeps this
 * device's moved-in flag: the device's earlier records were already moved in, and a restore of an
 * older backup never brings them back.
 */
export function keepSessionsImported(next: State, current: State): State {
  return current.tradingSessionsImported && !next.tradingSessionsImported
    ? { ...next, tradingSessionsImported: true }
    : next;
}
