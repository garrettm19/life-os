import { describe, expect, it } from '@jest/globals';
import {
  TradingSession,
  VIOLATION_IDS,
  decodeTradingSession,
  defaultTradingProfile,
  endForAccountSet,
  endTrading,
  liveWindow,
  newSession,
  setBias,
  violationsFromLog,
} from '../trading';
import { EntrySnapshot, OutsideRule } from '../model';

// The live windows, and sessions the earlier Start session flow saved (a text thesis card, three
// gates, entries and resets): their writers are retired, and the review and the history still
// read them. Synthetic session data only: invented thesis wording, no account, instrument, price
// or amount. Instants are written in UTC so each test means the same New York time in every zone
// the suite runs in. Tuesday, October 20, 2026 is daylight time (New York = UTC-4).
const utc = (s: string) => Date.parse(`${s}Z`);
const stamp = (s: string) => new Date(utc(s)).toISOString();

const DAY = '2026-10-20';
const OPEN = '2026-10-20T13:30:00'; // 9:30 AM New York
const MID = '2026-10-20T14:15:00'; // 10:15 AM
const profile = defaultTradingProfile(DAY);

/** A bullish day started at 9:30 AM New York with an example text thesis card. */
function started(): TradingSession {
  return {
    ...setBias(newSession(DAY), 'bullish', stamp('2026-10-19T23:00:00')),
    startedAt: stamp(OPEN),
    thesis: {
      direction: 'long',
      expectation: 'I expect price to rise toward the upper level',
      gexReason: 'Holding above the example flip level',
      objective: 'The example upper level',
      zone: 'The example lower band',
      invalidation: 'A close below the example band',
      addPlan: 'The example middle band',
      committedAt: stamp(OPEN),
    },
    gates: { acceptLoss: true, calm: true, noPressure: true, at: stamp(OPEN) },
    lockedLimits: { maxEntries: 2, maxFailedTheses: 2 },
    lockedRisk: {
      maxContracts: null,
      thesisRisk: null,
      dailyLoss: null,
      pointValue: null,
      tick: null,
    },
  };
}

/** An entry with every condition confirmed; logged outside the rules when `outside` is given. */
function entry(at: string, outside: OutsideRule[] = [], over: Partial<EntrySnapshot> = {}) {
  const e: EntrySnapshot = {
    at: stamp(at),
    kind: 'entry',
    side: 'long',
    permission: 'cisd',
    zone: true,
    gexSupports: true,
    invalidation: true,
    ...(outside.length > 0 && { outsideRules: outside }),
    ...over,
  };
  return e;
}
const withEntry = (session: TradingSession, e: EntrySnapshot): TradingSession => ({
  ...session,
  entries: [...(session.entries ?? []), e],
});

describe('the live windows', () => {
  it('opens the 9:30 AM window at 9:30 AM New York and closes it at 4:00 PM', () => {
    expect(liveWindow(utc('2026-10-20T13:29:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-10-20T13:30:00'))).toBe('morning');
    expect(liveWindow(utc('2026-10-20T17:30:00'))).toBe('morning');
    expect(liveWindow(utc('2026-10-20T19:59:00'))).toBe('morning');
    expect(liveWindow(utc('2026-10-20T20:00:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-10-20T15:00:00'))).not.toBe('evening');
  });

  it('opens the 6 PM window at 6:00 PM and closes it at 12:30 AM', () => {
    expect(liveWindow(utc('2026-10-20T21:59:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-20T22:00:00'))).toBe('evening');
    expect(liveWindow(utc('2026-10-20T22:00:00'))).not.toBe('morning');
    // 10:00 PM and 12:29 AM are still the 6 PM window; 12:30 AM ends it.
    expect(liveWindow(utc('2026-10-21T02:00:00'))).toBe('evening');
    expect(liveWindow(utc('2026-10-21T04:29:00'))).toBe('evening');
    expect(liveWindow(utc('2026-10-21T04:29:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-10-21T04:30:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-21T04:30:00'))).not.toBe('morning');
  });

  it("is closed over a weekend, until Sunday 6 PM opens Monday's 6 PM window", () => {
    // Saturday 10:00 AM New York belongs to Monday's candle, whose 9:30 AM lock is two days away.
    expect(liveWindow(utc('2026-10-24T14:00:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-10-24T14:00:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-25T21:59:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-25T22:00:00'))).toBe('evening');
    // Monday 12:29 AM is still Sunday's 6 PM window, for Monday's candle.
    expect(liveWindow(utc('2026-10-26T04:29:00'))).toBe('evening');
    expect(liveWindow(utc('2026-10-26T04:30:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-26T13:30:00'))).toBe('morning');
    // Friday after 4:00 PM, and Friday night, have no window at all.
    expect(liveWindow(utc('2026-10-23T20:00:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-10-23T23:00:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-10-24T04:00:00'))).not.toBe('evening');
  });

  it('follows New York across both daylight-saving changes', () => {
    // Friday, March 6, 2026 is standard time (UTC-5); Monday, March 9 is daylight time (UTC-4).
    expect(liveWindow(utc('2026-03-06T14:29:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-03-06T14:30:00'))).toBe('morning');
    expect(liveWindow(utc('2026-03-09T13:29:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-03-09T13:30:00'))).toBe('morning');
    // Sunday, March 8 at 6 PM (daylight time) opens Monday's 6 PM window.
    expect(liveWindow(utc('2026-03-08T21:59:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-03-08T22:00:00'))).toBe('evening');
    expect(liveWindow(utc('2026-03-09T04:29:00'))).toBe('evening');
    expect(liveWindow(utc('2026-03-09T04:30:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-03-06T20:59:00'))).toBe('morning');
    expect(liveWindow(utc('2026-03-06T21:00:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-03-09T19:59:00'))).toBe('morning');
    expect(liveWindow(utc('2026-03-09T20:00:00'))).not.toBe('morning');
    // Friday, October 30 is daylight time; Monday, November 2 is standard time again.
    expect(liveWindow(utc('2026-10-30T13:30:00'))).toBe('morning');
    expect(liveWindow(utc('2026-10-30T19:59:00'))).toBe('morning');
    expect(liveWindow(utc('2026-10-30T20:00:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-11-02T14:29:00'))).not.toBe('morning');
    expect(liveWindow(utc('2026-11-02T14:30:00'))).toBe('morning');
    expect(liveWindow(utc('2026-11-02T20:59:00'))).toBe('morning');
    expect(liveWindow(utc('2026-11-02T21:00:00'))).not.toBe('morning');
    // Sunday, November 1 at 6 PM (standard time) opens Monday's 6 PM window, until 12:30 AM.
    expect(liveWindow(utc('2026-11-01T22:59:00'))).not.toBe('evening');
    expect(liveWindow(utc('2026-11-01T23:00:00'))).toBe('evening');
    expect(liveWindow(utc('2026-11-02T05:29:00'))).toBe('evening');
    expect(liveWindow(utc('2026-11-02T05:30:00'))).not.toBe('evening');
  });
});

describe('sessions the earlier flow saved, in the review', () => {
  const hardStop = () => endTrading(started(), 'hard-stop', stamp(MID));

  it('pre-selects what an entry logged outside the rules points to', () => {
    // After the hard stop, against the bias (said so), with no permission or invalidation.
    const session = withEntry(
      hardStop(),
      entry('2026-10-20T14:40:00', ['done', 'conditions'], {
        permission: null,
        invalidation: false,
        withBias: false,
      }),
    );
    const saved = JSON.parse(JSON.stringify(session));
    expect(decodeTradingSession(saved)).toEqual(saved);
    expect(violationsFromLog(profile, session)).toEqual([
      VIOLATION_IDS.noInvalidation,
      VIOLATION_IDS.afterHardStop,
      VIOLATION_IDS.againstBias,
      VIOLATION_IDS.noNamedSetup,
    ]);
    expect(violationsFromLog(profile, null)).toEqual([]);
  });

  it('points to Traded after the hard stop only after a hard stop', () => {
    const after = (session: TradingSession) =>
      violationsFromLog(profile, withEntry(session, entry('2026-10-20T14:40:00', ['done'])));
    expect(after(hardStop())).toEqual([VIOLATION_IDS.afterHardStop, VIOLATION_IDS.noNamedSetup]);
    // A session ended by the failed-thesis limit (saved by earlier builds) is a hard stop too.
    const limit = { ...started(), doneAt: stamp(MID), doneReason: 'failed-theses' as const };
    expect(after(limit)).toContain(VIOLATION_IDS.afterHardStop);
    // Finished, or an invalidated thesis, is no hard stop: nothing is pre-selected for it.
    expect(after(endTrading(started(), 'finished', stamp(MID)))).toEqual([
      VIOLATION_IDS.noNamedSetup,
    ]);
    const invalidated = { ...started(), doneAt: stamp(MID), doneReason: 'invalidated' as const };
    expect(after(invalidated)).toEqual([VIOLATION_IDS.noNamedSetup]);
  });

  it('points to nighttime recovery trading for an entry from 6 PM New York, and nothing else', () => {
    const at = (s: string, outside: OutsideRule[] = ['window'], session = started()) =>
      violationsFromLog(profile, withEntry(session, entry(s, outside)));
    // 7:30 PM and 1:00 AM New York.
    const night = [VIOLATION_IDS.nightRecovery, VIOLATION_IDS.noNamedSetup];
    expect(at('2026-10-20T23:30:00')).toEqual(night);
    expect(at('2026-10-21T05:00:00')).toEqual(night);
    // 5:00 PM New York, after the window but not at night: no hard stop happened.
    expect(at('2026-10-20T21:00:00')).toEqual([VIOLATION_IDS.noNamedSetup]);
    // After a hard stop and at night, both.
    expect(at('2026-10-20T23:30:00', ['done', 'window'], hardStop())).toEqual([
      VIOLATION_IDS.afterHardStop,
      VIOLATION_IDS.nightRecovery,
      VIOLATION_IDS.noNamedSetup,
    ]);
  });

  it('keeps the shape an older build reads: confirmed entries plainly, unconfirmed ones refused', () => {
    // The version-4 entry check before entries outside the rules: at most 10 entries, the first an
    // entry, a permission and every condition true. Unknown fields such as `outsideRules` and
    // `withBias` were never checked, so such a build reads an entry taken outside the rules with
    // every condition confirmed as an ordinary entry, and refuses one with any unconfirmed.
    const olderBuildReads = (log: EntrySnapshot[]) =>
      log.length <= 10 &&
      log.every(
        (e, i) =>
          e.kind === (i === 0 ? 'entry' : 'add') &&
          e.permission !== null &&
          e.zone === true &&
          e.gexSupports === true &&
          e.invalidation === true,
      );
    expect(olderBuildReads([entry('2026-10-20T14:40:00', ['done'])])).toBe(true);
    expect(olderBuildReads([entry('2026-10-20T23:30:00', ['window'])])).toBe(true);
    const unconfirmed: Partial<EntrySnapshot>[] = [
      { withBias: false },
      { permission: null },
      { invalidation: false },
    ];
    for (const over of unconfirmed) {
      const e = entry(MID, ['conditions'], over);
      const saved = JSON.parse(JSON.stringify(withEntry(started(), e)));
      expect(decodeTradingSession(saved)).toEqual(saved);
      // Against the bias is `withBias: false`, which that build ignores: it is refused only for
      // an unconfirmed condition.
      expect(olderBuildReads([e])).toBe('withBias' in over);
    }
  });
});

describe('an account set lost mid-session', () => {
  it('ends the running session as a hard stop; an entry taken after it points there', () => {
    const lost = { ...profile, fundedSetLost: { at: stamp(OPEN), until: '2026-11-19' } };
    const ended = endForAccountSet(started(), stamp(MID));
    expect(ended).toMatchObject({ doneAt: stamp(MID), doneReason: 'hard-stop' });
    // A session not started, or already ended, stays as it is.
    const prepared = setBias(newSession(DAY), 'bullish', stamp(OPEN));
    expect(endForAccountSet(prepared, stamp(MID))).toBe(prepared);
    const finished = endTrading(started(), 'finished', stamp(OPEN));
    expect(endForAccountSet(finished, stamp(MID))).toBe(finished);
    const taken = withEntry(ended, entry('2026-10-20T14:20:00', ['done']));
    expect(violationsFromLog(lost, taken)).toEqual([
      VIOLATION_IDS.afterHardStop,
      VIOLATION_IDS.noNamedSetup,
    ]);
  });
});

describe('reading a saved session', () => {
  const full = (): TradingSession => ({
    ...withEntry(started(), entry(MID)),
    failedTheses: 1,
    resetStartedAt: stamp('2026-10-20T15:00:00'),
    resets: [
      {
        at: stamp('2026-10-20T15:00:00'),
        whatIsNew: ['htf-structure'],
        answeredAt: stamp('2026-10-20T15:05:00'),
      },
    ],
  });

  it('keeps the thesis card, gates, entries and resets, and older days without them', () => {
    const saved = JSON.parse(JSON.stringify(full()));
    expect(decodeTradingSession(saved)).toEqual(saved);
    const ended = JSON.parse(
      JSON.stringify({ ...full(), doneAt: stamp(MID), doneReason: 'invalidated' }),
    );
    expect(decodeTradingSession(ended)?.doneReason).toBe('invalidated');
    expect(decodeTradingSession({ ...newSession(DAY), failedTheses: 2 })).toEqual({
      ...newSession(DAY),
      failedTheses: 2,
    });
  });

  it('refuses a malformed thesis card, gates, entry or reset', () => {
    const saved = JSON.parse(JSON.stringify(full()));
    const bad = (over: Record<string, unknown>) => decodeTradingSession({ ...saved, ...over });
    expect(bad({ thesis: { ...saved.thesis, zone: ' padded ' } })).toBeNull();
    expect(bad({ thesis: { ...saved.thesis, zone: 'x'.repeat(161) } })).toBeNull();
    expect(bad({ thesis: { ...saved.thesis, addPlan: '' } })).toBeNull();
    expect(bad({ thesis: { ...saved.thesis, direction: 'sideways' } })).toBeNull();
    // A card committed before the direction was kept stays valid.
    expect(bad({ thesis: { ...saved.thesis, direction: undefined } })).not.toBeNull();
    expect(bad({ thesis: undefined })).toBeNull();
    expect(bad({ gates: { ...saved.gates, calm: false } })).toBeNull();
    expect(bad({ gates: { ...saved.gates, extra: true } })).toBeNull();
    expect(bad({ startedAt: null })).toBeNull();
    expect(bad({ entries: [{ ...saved.entries[0], kind: 'add' }] })).toBeNull();
    expect(bad({ entries: [{ ...saved.entries[0], permission: 'hunch' }] })).toBeNull();
    expect(bad({ entries: [{ ...saved.entries[0], zone: false }] })).toBeNull();
    expect(bad({ entries: [{ ...saved.entries[0], unplanned: true }] })).toBeNull();
    expect(bad({ resets: [...saved.resets, ...saved.resets] })).toBeNull();
    expect(bad({ resets: [{ ...saved.resets[0], whatIsNew: ['vibes'] }] })).toBeNull();
    expect(bad({ doneReason: 'flipped' })).toBeNull();
    expect(bad({ lockedLimits: { maxEntries: 0, maxFailedTheses: null } })).toBeNull();
    expect(bad({ lockedLimits: { maxEntries: 11, maxFailedTheses: null } })).toBeNull();
    expect(bad({ lockedLimits: { maxEntries: 2, maxFailedTheses: 21 } })).toBeNull();
    expect(bad({ lockedLimits: { maxEntries: 2 } })).toBeNull();
    expect(bad({ lockedLimits: { ...saved.lockedLimits, extra: 1 } })).toBeNull();
    expect(
      decodeTradingSession({
        ...newSession(DAY),
        lockedLimits: { maxEntries: 2, maxFailedTheses: null },
      }),
    ).toBeNull();
    expect(bad({ lockedLimits: undefined })).not.toBeNull();
  });
});
