import { describe, expect, it } from '@jest/globals';
import { encodeBackup, parseBackup, restoredState } from '../backup';
import { decodeState } from '../data';
import { State, TradingProfile, localDate } from '../model';
import { saveTradingProfile, tradingBook } from '../trading';
import {
  EXISTING_ACCOUNTS_LINE,
  existingAccountProblem,
  feelRushed,
  liveByExistingAccount,
  liveSwitchProblem,
  liveTradingOn,
  recordExit,
  setLiveTrading,
} from '../trading-live';
import {
  FLAT_WARN_MINUTES,
  MONEY_NO_LINE,
  effectiveSettings,
  flatByPhase,
  waitingRaiseLine,
  withRaises,
} from '../trading-safeguards';
import { enterAttempt, logTakenAttempt, tradeStatus } from '../trading-status';
import {
  LIVE,
  OPEN,
  PRE,
  ROUTINE,
  TUE,
  WED,
  after,
  ctxAt,
  liveState,
  ready,
  reviewedSessions,
  sessionOf,
  started,
  statusAt,
  withProfile,
  z,
} from '../../test-support/trading-live';

// Live trading for one account the trader already trades, and the optional flat-by time.
// Synthetic data only: example limits and invented prices. The flat-by time 16:45 is an example
// New York time. Instants are UTC; every rule reads New York time, so the suite holds in any zone.

const profileOf = (s: State) => tradingBook(s)!.trading!;
const save = (s: State, over: Partial<TradingProfile>, at: string) =>
  saveTradingProfile(s, ROUTINE, { ...profileOf(s), ...over }, at);
const PATH = 'Live trading waits for 30 clean practice sessions: 0 of 30 so far.';

describe('live trading for one account already traded', () => {
  it('stands in for the clean practice sessions, with the money question too', () => {
    const fresh = liveState();
    expect(liveSwitchProblem(fresh, ROUTINE, PRE)).toBe(PATH);
    expect(liveSwitchProblem(fresh, ROUTINE, PRE, true)).toBeNull();
    // The money question is still asked: without a Yes nothing changes.
    expect(() => setLiveTrading(fresh, ROUTINE, true, PRE, false, true)).toThrow(MONEY_NO_LINE);
    // Without the confirmation the practice sessions hold it.
    expect(() => setLiveTrading(fresh, ROUTINE, true, PRE, true)).toThrow(PATH);
    const on = setLiveTrading(fresh, ROUTINE, true, PRE, true, true);
    const today = localDate(new Date(PRE));
    expect(profileOf(on)).toMatchObject({
      liveTrading: true,
      moneySetAsideOn: today,
      existingAccountOn: today,
    });
    expect(liveTradingOn(profileOf(on))).toBe(true);
    expect(liveByExistingAccount(profileOf(on))).toBe(true);
    // The session starts live and reads honestly: no practice banner, the live totals labeled.
    const s = started(on);
    expect(sessionOf(s).lock!.mode).toBe('live');
    const st = statusAt(s, after(OPEN, 1));
    expect(st.practice).toBe(false);
    expect(st.banner).toBeNull();
    expect(st.facts.mode).toBe('live');
  });

  it('allows one account only; more follow their clean live sessions as always', () => {
    const two = withProfile(liveState(), { ...profileOf(liveState()), accounts: 2 });
    expect(existingAccountProblem(profileOf(two))).toBe(EXISTING_ACCOUNTS_LINE);
    expect(() => setLiveTrading(two, ROUTINE, true, PRE, true, true)).toThrow(
      EXISTING_ACCOUNTS_LINE,
    );
    const on = setLiveTrading(liveState(), ROUTINE, true, PRE, true, true);
    expect(() => save(on, { accounts: 2 }, after(PRE, 1))).toThrow(
      '2 accounts need 20 clean live sessions at 1: 0 of 20 so far.',
    );
    const earned = reviewedSessions(on, 20, { mode: 'live' });
    expect(profileOf(save(earned, { accounts: 2 }, after(PRE, 1))).accounts).toBe(2);
  });

  it('keeps every other refusal: a running session, a cooldown, a lost account set', () => {
    const running = started(liveState());
    expect(liveSwitchProblem(running, ROUTINE, after(OPEN, 1), true)).toBe(
      'A session is running: change this between sessions.',
    );
    const cooled = feelRushed(liveState(), ROUTINE, PRE);
    expect(liveSwitchProblem(cooled, ROUTINE, after(PRE, 1), true)).toBe('Not during a cooldown.');
    const lost = withProfile(liveState(), {
      ...profileOf(liveState()),
      fundedSetLost: { at: z('2026-11-05T15:00'), until: '2026-12-05' },
    });
    expect(liveSwitchProblem(lost, ROUTINE, PRE, true)).toMatch(/^Live trading paused until/);
  });

  it('is confirmed again each time live trading is turned on, and after a restore', () => {
    const on = setLiveTrading(liveState(), ROUTINE, true, PRE, true, true);
    const off = setLiveTrading(on, ROUTINE, false, after(PRE, 1));
    expect(liveTradingOn(profileOf(off))).toBe(false);
    expect(() => setLiveTrading(off, ROUTINE, true, after(PRE, 2), true)).toThrow(PATH);
    // A restore leaves live trading off; turning it on asks both again.
    const restored = restoredState(parseBackup(encodeBackup(on, z('2026-11-10T13:00'))));
    expect(liveTradingOn(profileOf(restored))).toBe(false);
    expect(() => setLiveTrading(restored, ROUTINE, true, PRE, true)).toThrow(PATH);
    expect(() => setLiveTrading(restored, ROUTINE, true, PRE, false, true)).toThrow(MONEY_NO_LINE);
    expect(liveTradingOn(profileOf(setLiveTrading(restored, ROUTINE, true, PRE, true, true)))).toBe(
      true,
    );
  });

  it('turned on after the clean practice sessions, it is not the live-account path', () => {
    const on = setLiveTrading(reviewedSessions(liveState(), 30), ROUTINE, true, PRE, true);
    expect(profileOf(on).existingAccountOn).toBeUndefined();
    expect(liveByExistingAccount(profileOf(on))).toBe(false);
  });

  it('turned on the other way later, even the same day, it no longer reads as the live-account path', () => {
    const on = setLiveTrading(liveState(), ROUTINE, true, PRE, true, true);
    const off = setLiveTrading(on, ROUTINE, false, after(PRE, 1));
    const again = setLiveTrading(reviewedSessions(off, 30), ROUTINE, true, after(PRE, 2), true);
    expect(profileOf(again).moneySetAsideOn).toBe(localDate(new Date(PRE)));
    expect(profileOf(again).existingAccountOn).toBeUndefined();
    expect(liveByExistingAccount(profileOf(again))).toBe(false);
    // Confirmed again, it is the live-account path again.
    const confirmed = setLiveTrading(
      setLiveTrading(again, ROUTINE, false, after(PRE, 3)),
      ROUTINE,
      true,
      after(PRE, 4),
      true,
      true,
    );
    expect(liveByExistingAccount(profileOf(confirmed))).toBe(true);
  });

  it('reads its date back strictly', () => {
    const on = setLiveTrading(liveState(), ROUTINE, true, PRE, true, true);
    expect(decodeState(JSON.parse(JSON.stringify(on)))).toEqual(on);
    const bad = { ...profileOf(on), existingAccountOn: 'yesterday' };
    expect(() => withProfile(on, bad)).toThrow(/live account confirmation/);
  });
});

describe('the flat-by time', () => {
  /** Tuesday, November 10, 2026 (EST): New York wall-clock times as UTC instants. */
  const ny = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return z(`2026-11-10T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };
  const live = (over: Partial<TradingProfile> = {}) =>
    liveState({ ...LIVE, flatBy: '16:45', ...over });
  /** A trade entered at 3:55 PM New York, in the 9:30 AM window. */
  const holding = (state = live()) =>
    enterAttempt(ready(started(state), ny('15:54')), ROUTINE, ny('15:55'));

  it('warns an open trade 15 minutes before, then asks for its outcome', () => {
    const s = holding();
    expect(FLAT_WARN_MINUTES).toBe(15);
    expect(statusAt(s, ny('16:29')).title).toBe('IN POSITION — MANAGE TO PLAN');
    const soon = statusAt(s, ny('16:30'));
    expect(soon).toMatchObject({
      code: 'IN_POSITION',
      title: 'IN POSITION — FLAT BY 4:45 PM NEW YORK',
      next: 'Be flat by 4:45 PM New York. Record the outcome when it ends.',
    });
    const past = statusAt(s, ny('16:45'));
    expect(past.code).toBe('IN_POSITION');
    expect(past.title).toBe('PAST FLAT BY 4:45 PM NEW YORK — RECORD THE OUTCOME');
    expect(past.reason).toMatch(/Your flat-by time, 4:45 PM New York, has passed\.$/);
    expect(past.next).toBe(
      "Record how it ended: your firm's rules may have closed it at the broker.",
    );
    // Recorded, no new entry that day; the next candle's 6 PM window opens as usual.
    const closed = recordExit(s, ROUTINE, 'a1', { kind: 'objective' }, ny('16:50'));
    expect(statusAt(closed, ny('16:51'))).toMatchObject({
      code: 'OUTSIDE_WINDOW',
      title: 'NO ENTRY — PAST FLAT BY 4:45 PM NEW YORK',
    });
    expect(statusAt(closed, ny('17:59')).code).toBe('OUTSIDE_WINDOW');
    // Still open at 6 PM, it is the next candle's open position to reconcile.
    expect(statusAt(s, ny('18:30')).code).toBe('RECONCILE_POSITION');
  });

  it('holds new entries after it on the candle, also inside a live window', () => {
    const s = ready(started(live({ flatBy: '11:00' })), ny('10:40'));
    const before = statusAt(s, ny('10:50'));
    expect(before.code).toBe('CHECKS_COMPLETE');
    expect(before.notes).toContain('Flat by 11:00 AM New York.');
    const after11 = statusAt(s, ny('11:00'));
    expect(after11).toMatchObject({
      code: 'OUTSIDE_WINDOW',
      title: 'NO ENTRY — PAST FLAT BY 11:00 AM NEW YORK',
      reason: 'No new entries after your flat-by time, 11:00 AM New York, on this candle.',
    });
    expect(() => enterAttempt(s, ROUTINE, ny('11:01'))).toThrow(/PAST FLAT BY 11:00 AM/);
    // A trade logged after it was outside the checks: it ends the session.
    const logged = logTakenAttempt(
      s,
      ROUTINE,
      { side: 'long', entry: 25_040, stop: 25_030, contracts: 1 },
      ny('11:05'),
    );
    expect(sessionOf(logged).stopCause).toBe('logged-trade');
  });

  it('a session started live keeps it after live trading is turned off, a restore or a pause', () => {
    const s = holding();
    const off = setLiveTrading(s, ROUTINE, false, ny('16:00'));
    const restored = restoredState(parseBackup(encodeBackup(s, ny('16:00'))));
    for (const state of [off, restored]) {
      expect(liveTradingOn(profileOf(state))).toBe(false);
      expect(statusAt(state, ny('16:30')).title).toBe('IN POSITION — FLAT BY 4:45 PM NEW YORK');
      const past = statusAt(state, ny('16:46'));
      expect(past.title).toBe('PAST FLAT BY 4:45 PM NEW YORK — RECORD THE OUTCOME');
      expect(past).toMatchObject({ practice: false, banner: null });
    }
    // Paused in Programs during it, the session reads as practice, but the open trade is real.
    const paused = tradeStatus({ ...ctxAt(s, ny('16:46')), paused: true });
    expect(paused.practice).toBe(true);
    expect(paused.title).toBe('PAST FLAT BY 4:45 PM NEW YORK — RECORD THE OUTCOME');
    // With no trade open, one tap on Off never lifts the hold on new entries.
    const flat = ready(started(live({ flatBy: '11:00' })), ny('10:40'));
    const offLate = setLiveTrading(flat, ROUTINE, false, ny('11:06'));
    expect(statusAt(offLate, ny('11:07'))).toMatchObject({
      code: 'OUTSIDE_WINDOW',
      title: 'NO ENTRY — PAST FLAT BY 11:00 AM NEW YORK',
    });
    expect(() => enterAttempt(offLate, ROUTINE, ny('11:08'))).toThrow(/PAST FLAT BY 11:00 AM/);
    const pausedFlat = tradeStatus({ ...ctxAt(flat, ny('11:07')), paused: true });
    expect(pausedFlat.title).toBe('NO ENTRY — PAST FLAT BY 11:00 AM NEW YORK');
  });

  it('practice skips it, as it skips the live windows', () => {
    const practice = liveState({ flatBy: '11:00' });
    const s = ready(started(practice), ny('10:40'));
    expect(statusAt(s, ny('11:30')).code).toBe('CHECKS_COMPLETE');
    const held = enterAttempt(s, ROUTINE, ny('11:31'));
    expect(statusAt(held, ny('11:50')).title).toBe('IN POSITION — MANAGE TO PLAN');
  });

  it('is a New York time on the candle, across both daylight saving changes', () => {
    const p = profileOf(live());
    const at = (candle: string) => new Date(flatByPhase(p, candle, 0)!.at).toISOString();
    // Friday, October 30, 2026 (EDT) and Monday, November 2 (EST).
    expect(at('2026-10-30')).toBe('2026-10-30T20:45:00.000Z');
    expect(at('2026-11-02')).toBe('2026-11-02T21:45:00.000Z');
    // Friday, March 12, 2027 (EST) and Monday, March 15 (EDT).
    expect(at('2027-03-12')).toBe('2027-03-12T21:45:00.000Z');
    expect(at('2027-03-15')).toBe('2027-03-15T20:45:00.000Z');
    expect(flatByPhase(p, '2026-11-02', Date.parse('2026-11-02T21:29:59.000Z'))!.phase).toBe(
      'before',
    );
    expect(flatByPhase(p, '2026-11-02', Date.parse('2026-11-02T21:30:00.000Z'))!.phase).toBe(
      'soon',
    );
    expect(flatByPhase(p, '2026-10-30', Date.parse('2026-10-30T20:45:00.000Z'))!.phase).toBe(
      'past',
    );
    expect(flatByPhase(profileOf(liveState()), TUE, 0)).toBeNull();
  });

  it('a later time or none waits for the next candle; an earlier one applies at once', () => {
    const set = save(liveState(), { flatBy: '16:45' }, PRE);
    // Set for the first time it never waits.
    expect(profileOf(set).raisedOn).toBeUndefined();
    expect(effectiveSettings(profileOf(set), TUE).flatBy).toBe('16:45');
    const later = save(set, { flatBy: '16:55' }, after(PRE, 1));
    expect(effectiveSettings(profileOf(later), TUE).flatBy).toBe('16:45');
    expect(effectiveSettings(profileOf(later), WED).flatBy).toBe('16:55');
    expect(waitingRaiseLine(profileOf(later), TUE)).toMatch(
      /^Raised on this candle: flat-by time\./,
    );
    const cleared = save(set, { flatBy: undefined }, after(PRE, 1));
    expect(profileOf(cleared).flatBy).toBeUndefined();
    expect(effectiveSettings(profileOf(cleared), TUE).flatBy).toBe('16:45');
    expect(effectiveSettings(profileOf(cleared), WED).flatBy).toBeUndefined();
    const earlier = save(set, { flatBy: '15:30' }, after(PRE, 1));
    expect(profileOf(earlier).raisedOn).toBeUndefined();
    expect(effectiveSettings(profileOf(earlier), TUE).flatBy).toBe('15:30');
    // Saved again with the wait in place, it reads back byte for byte, and strictly.
    const p = profileOf(later);
    expect(JSON.stringify(withRaises(p, p, TUE))).toBe(JSON.stringify(p));
    expect(decodeState(JSON.parse(JSON.stringify(later)))).toEqual(later);
  });

  it('reads back strictly: New York HH:MM before 6 PM', () => {
    const s = liveState();
    for (const flatBy of ['18:00', '4:45', '16:60', '24:00', '16:45 '])
      expect(() => withProfile(s, { ...profileOf(s), flatBy })).toThrow(/flat-by time/);
    expect(profileOf(withProfile(s, { ...profileOf(s), flatBy: '17:59' })).flatBy).toBe('17:59');
    const raised = save(save(s, { flatBy: '16:45' }, PRE), { flatBy: '16:55' }, after(PRE, 1));
    const bad = {
      ...profileOf(raised),
      raisedOn: {
        ...profileOf(raised).raisedOn!,
        before: { ...profileOf(raised).raisedOn!.before, flatBy: '9 PM' },
      },
    };
    expect(() => withProfile(raised, bad)).toThrow(/waiting raise/);
  });
});
