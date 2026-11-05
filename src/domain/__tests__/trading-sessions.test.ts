import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { decodeState } from '../data';
import { CATEGORIES, buildExport } from '../export';
import { State } from '../model';
import { TradingSession, decodeTradingSession, newSession, sessionDateOf } from '../trading';
import {
  UNREADABLE_LINE,
  importDeviceSessions,
  keepSessionsImported,
  putTradingSession,
  sessionUnreadable,
} from '../trading-sessions';
import { todayWidgetTimeline } from '../widget';
import { todayListTimeline } from '../widget-list';
import { trainingState } from '../../test-support/fixtures';
import {
  legacyEntry,
  legacyFinished,
  legacyLocked,
  legacyPlan,
} from '../../test-support/legacy-trading';

// Trading sessions move from the device into the saved data, keyed by candle date (state, SQLite
// and backup version 5). Synthetic sessions only: example prices on an example instrument.
// Tuesday, October 20, 2026 is daylight time in New York (UTC-4).
const utc = (s: string) => Date.parse(`${s}Z`);
const stamp = (s: string) => new Date(utc(s)).toISOString();

const TUE = '2026-10-20';
const WED = '2026-10-21';
const EVENING = '2026-10-19T22:30:00'; // 6:30 PM New York Monday: Tuesday's candle
const OPEN = '2026-10-20T13:30:00'; // 9:30 AM Tuesday
const CLOSE = '2026-10-20T20:30:00'; // 4:30 PM
const WED_EVENING = '2026-10-20T23:00:00'; // 7:00 PM Tuesday: Wednesday's candle

const TIMES = { evening: stamp(EVENING), open: stamp(OPEN) };

/** Tuesday's candle planned the evening before: preflight, bias, classification, plan, GEX. */
function planned(date = TUE): TradingSession {
  return legacyPlan(date, TIMES);
}

/** The plan locked at 9:30 AM and finished at 4:30 PM, on the record `on` (its date). */
function session(on: TradingSession, candle = planned()): TradingSession {
  return legacyFinished(legacyLocked(on, candle, stamp(OPEN)), stamp(CLOSE));
}

const text = (s: unknown) => JSON.stringify(s);

/** The data as saved before version 5: no session moved in yet. */
function older(state: State = trainingState()): State {
  const { tradingSessionsImported: _flag, ...rest } = state;
  return { ...rest, tradingSessions: {} };
}

describe('moving the device trading records in', () => {
  it('keeps a US-layout record as it was, by its candle date', () => {
    // On a US phone a candle's plan and its session are one record, under the candle's date.
    const record = session(planned());
    const state = importDeviceSessions(older(), [[TUE, text(record)]]);
    expect(state.tradingSessions).toEqual({ [TUE]: record });
    expect(state.tradingSessionsImported).toBe(true);
    expect(state.tradingSessionsUnreadable).toBeUndefined();
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('re-keys the far-east layout: the next date held the session beside its own bias', () => {
    // East of New York an earlier build kept Tuesday's session on Wednesday's record, which also
    // held Wednesday's bias and a key this build does not know. Each part goes to its candle.
    const plan = planned();
    const wedBias = { bias: 'bearish' as const, biasAt: stamp(WED_EVENING), preparedAt: null };
    const kept = { ...session(newSession(WED), plan), ...wedBias, laterField: { kept: true } };
    const state = importDeviceSessions(older(), [
      [WED, text(kept)],
      [TUE, text(plan)],
    ]);
    const tue = state.tradingSessions[TUE];
    expect(tue).toMatchObject({
      date: TUE,
      bias: 'bullish',
      preflight: plan.preflight,
      prep: plan.prep,
      startedAt: kept.startedAt,
      thesis: kept.thesis,
      gates: kept.gates,
      lockedRisk: kept.lockedRisk,
      doneAt: stamp(CLOSE),
      doneReason: 'finished',
    });
    // Every field of either record is on one of the two, the unknown one included.
    expect(state.tradingSessions[WED]).toEqual({
      ...newSession(WED),
      ...wedBias,
      laterField: { kept: true },
    });
    for (const [key, value] of Object.entries(kept))
      if (key !== 'date')
        expect(
          [tue, state.tradingSessions[WED]].some((r) => text(r[key as never]) === text(value)),
        ).toBe(true);
    // It says the record it came from, where that build saved its review.
    expect(tue.movedFrom).toBe(WED);
  });

  it('keeps every stored key, a pre-1.1 plans list too, and makes no session of an empty date', () => {
    // East of New York an earlier build kept Friday's session on Saturday's record, which held
    // nothing else; Friday's own record kept its bias and a plans list the reader leaves out.
    const fri = '2026-10-23';
    const sat = '2026-10-24';
    const kept = {
      ...newSession(sat),
      startedAt: stamp('2026-10-23T13:40:00'),
      doneAt: stamp('2026-10-23T20:30:00'),
      doneReason: 'finished' as const,
    };
    const own = {
      ...newSession(fri),
      bias: 'bullish' as const,
      biasAt: stamp('2026-10-22T22:30:00'),
      plans: [{ legacy: true }],
    };
    const state = importDeviceSessions(older(), [
      [sat, text(kept)],
      [fri, text(own)],
    ]);
    expect(Object.keys(state.tradingSessions)).toEqual([fri]);
    expect(state.tradingSessions[fri]).toMatchObject({
      bias: 'bullish',
      plans: [{ legacy: true }],
      startedAt: kept.startedAt,
      doneReason: 'finished',
      movedFrom: sat,
    });
    expect(state.tradingSessionsUnreadable).toBeUndefined();
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(parseBackup(encodeBackup(state)).state.tradingSessions).toEqual(state.tradingSessions);
  });

  it('keeps a record it cannot read verbatim, never deletes it, and never overwrites its day', () => {
    const records: [string, string][] = [
      [TUE, text(session(planned()))],
      ['2026-10-22', '{not json'],
      // Another date's session under this date is not this date's.
      ['2026-10-23', text(newSession('2026-10-26'))],
      ['2026-10-26', text({ ...newSession('2026-10-26'), failedTheses: -1 })],
      // A key without a date is kept too, and never stops the data from loading.
      ['', 'damaged'],
    ];
    const state = importDeviceSessions(older(), records);
    expect(state.tradingSessionsUnreadable).toEqual({
      '': 'damaged',
      '2026-10-22': '{not json',
      '2026-10-23': records[2][1],
      '2026-10-26': records[3][1],
    });
    expect(decodeState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(Object.keys(state.tradingSessions)).toEqual([TUE]);
    // The day shows the load failure and takes no write; a readable day is unaffected.
    for (const date of ['2026-10-22', '2026-10-23', '2026-10-26']) {
      expect(sessionUnreadable(state, date)).toBe(true);
      expect(() => putTradingSession(state, newSession(date))).toThrow(UNREADABLE_LINE);
    }
    // East of New York the candle whose session date it is cannot be read either.
    expect(sessionUnreadable(state, '2026-10-21')).toBe(
      sessionDateOf('2026-10-21') === '2026-10-22',
    );
    expect(sessionUnreadable(state, TUE)).toBe(false);
    // It passes every saved-data check and survives a backup as it was.
    const restored = parseBackup(encodeBackup(state)).state;
    expect(restored.tradingSessionsUnreadable).toEqual(state.tradingSessionsUnreadable);
  });

  it('keeps one session per candle; a second for the same candle is kept verbatim', () => {
    // An earlier build that kept a started session on both the candle's record and its session
    // date's: the one the cockpit read stays, the other is kept as it was stored.
    const own = session(planned());
    const next = session(newSession(WED), planned());
    const state = importDeviceSessions(older(), [
      [TUE, text(own)],
      [WED, text(next)],
    ]);
    const winner = sessionDateOf(TUE) === WED ? next : own;
    const loser = winner === own ? [WED, text(next)] : [TUE, text(own)];
    expect(state.tradingSessions[TUE].startedAt).toBe(winner.startedAt);
    expect(state.tradingSessionsUnreadable).toEqual({ [loser[0]]: loser[1] });
  });

  it('runs once: the flag stops a second run, and saved sessions are never replaced', () => {
    const saved = { ...planned(), bias: 'bearish' as const };
    const before = { ...older(), tradingSessions: { [TUE]: saved } };
    const records: [string, string][] = [[TUE, text(session(planned()))]];
    const once = importDeviceSessions(before, records);
    expect(once.tradingSessions[TUE]).toEqual(saved);
    expect(importDeviceSessions(once, records)).toBe(once);
    expect(importDeviceSessions(once, [['2026-10-27', text(newSession('2026-10-27'))]])).toBe(once);
    // Nothing to move in still marks the data, so the device is never read again.
    expect(importDeviceSessions(older(), [])).toEqual({
      ...older(),
      tradingSessionsImported: true,
    });
  });

  it('moves in a session locked in the 6 PM window with everything that build kept on it', () => {
    // Locked at 6:30 PM the evening before: the support checks, the area re-mapped under the
    // 9:30 AM lock, a reassessed candle and an entry.
    const locked = stamp(EVENING);
    const plan = legacyPlan(TUE, { evening: locked, open: locked });
    expect(plan.prep!.gex!.lock).toBe('evening');
    const kept = legacyFinished(
      {
        ...legacyLocked(plan, plan, locked),
        eveningSupport: { gex: true, htf: true, at: locked },
        remappedGex: {
          kind: 'focus',
          price: 25_050,
          zone: 10,
          lock: 'morning',
          candle: TUE,
          at: stamp('2026-10-20T13:35:00'),
        },
        regimeLog: [{ kind: 'candidate', context: 'daily', at: stamp('2026-10-20T13:38:00') }],
        entries: [legacyEntry(stamp('2026-10-20T13:40:00'))],
      },
      stamp(CLOSE),
    );
    expect(decodeTradingSession(JSON.parse(text(kept)))).toEqual(kept);
    const state = importDeviceSessions(older(), [[TUE, text(kept)]]);
    expect(state.tradingSessions).toEqual({ [TUE]: kept });
    expect(state.tradingSessionsUnreadable).toBeUndefined();
    expect(decodeState(JSON.parse(text(state))).tradingSessions).toEqual({ [TUE]: kept });
  });

  it('leaves the rest of the history exactly as it was', () => {
    const history = trainingState();
    const state = importDeviceSessions(older(history), [[TUE, text(session(planned()))]]);
    const { tradingSessions: _s, tradingSessionsImported: _f, ...rest } = state;
    const { tradingSessions: _s2, tradingSessionsImported: _f2, ...before } = history;
    expect(rest).toEqual(before);
  });
});

describe('the saved sessions', () => {
  const withSession = () => importDeviceSessions(older(), [[TUE, text(session(planned()))]]);

  it('save a session by its candle date and refuse one that would not read back', () => {
    const state = putTradingSession(withSession(), planned(WED));
    expect(Object.keys(state.tradingSessions)).toEqual([TUE, WED]);
    expect(state.tradingSessions[WED]).toEqual(planned(WED));
    const bad = { ...planned(WED), failedTheses: -1 };
    expect(() => putTradingSession(state, bad)).toThrow(/not valid/);
    // A locked risk before the start is refused too.
    expect(() =>
      putTradingSession(state, {
        ...newSession(WED),
        lockedRisk: { maxContracts: 5, thesisRisk: 150, dailyLoss: 300, pointValue: 2, tick: 0.25 },
      }),
    ).toThrow(/not valid/);
    expect(() => putTradingSession(state, { ...newSession(WED), date: 'Wed' })).toThrow();
  });

  it('round-trip through a backup, and a restore of the same backup keeps them', () => {
    const state = withSession();
    const raw = encodeBackup(state);
    expect(JSON.parse(raw)).toMatchObject({
      version: 5,
      state: { tradingSessions: { [TUE]: {} } },
    });
    const parsed = parseBackup(raw);
    expect(parsed.sourceVersion).toBe(5);
    expect(parsed.state).toEqual(state);
    // The same backup restored after more trading brings back exactly what it holds.
    const later = putTradingSession(state, planned(WED));
    const restored = keepSessionsImported(restoredState(parsed), later);
    expect(restored.tradingSessions).toEqual(state.tradingSessions);
    expect(restored.tradingSessionsImported).toBe(true);
  });

  it('restore from a version-4 backup with none, and keep this device moved in', () => {
    const state = withSession();
    const v4 = JSON.parse(encodeBackup(state));
    v4.version = 4;
    v4.state.version = 4;
    delete v4.state.tradingSessions;
    delete v4.state.tradingSessionsImported;
    const parsed = parseBackup(JSON.stringify(v4));
    expect(parsed.sourceVersion).toBe(4);
    expect(parsed.state.tradingSessions).toEqual({});
    expect(parsed.state.ruleReviews).toEqual(state.ruleReviews);
    expect(parsed.state.ruleBooks).toEqual(state.ruleBooks);
    const restored = keepSessionsImported(restoredState(parsed), state);
    expect(restored.tradingSessionsImported).toBe(true);
    // A version-4 file that claims to carry sessions is refused, not half-read.
    v4.state.tradingSessions = state.tradingSessions;
    expect(() => parseBackup(JSON.stringify(v4))).toThrow(/unsupported version/);
  });

  it('are refused in a backup when one does not read back for its date', () => {
    const raw = JSON.parse(encodeBackup(withSession()));
    raw.state.tradingSessions[WED] = raw.state.tradingSessions[TUE];
    expect(() => parseBackup(JSON.stringify(raw))).toThrow(/invalid trading session/);
  });

  it('never reach an analysis export or a widget', () => {
    const state = withSession();
    const rows = buildExport(state, {
      categories: CATEGORIES.map((c) => c.key),
      from: null,
      to: '2026-10-31',
      includePrivate: true,
    });
    const now = new Date(2026, 9, 20, 12);
    const out = JSON.stringify([
      rows,
      todayWidgetTimeline(state, now),
      todayListTimeline(state, now),
    ]);
    expect(out).not.toMatch(/Example: price|25[,.]?(040|120|000)|tradingSessions|MNQ/);
  });
});
