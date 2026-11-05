import { describe, expect, it } from '@jest/globals';
import { validateEntryLog, validateRegime, validateThesisCard } from '../records';
import { EntryPlan, EntrySnapshot, Regime } from '../model';
import {
  TradingSession,
  decodeTradingSession,
  disciplineFromRecords,
  regimeAt,
  stoppedRisk,
} from '../trading';
import { confirmedExpansion, regimeLabel } from '../trading-regime';
import { REGIME_CARDS } from '../trading-rules';
import {
  legacyEntry,
  legacyFinished,
  legacyPlan,
  legacySession,
} from '../../test-support/legacy-trading';

// The HTF candle classification, the normal and expansion objectives and the runner, as the
// earlier cockpit saved them: its writers are retired, and decoding, the review and the
// history still read them. Synthetic data only: example prices on an example instrument labelled
// as such. Instants are written in UTC so each test means the same New York time in every zone the
// suite runs in. Tuesday, October 20, 2026 is daylight time (New York = UTC-4).
const utc = (s: string) => Date.parse(`${s}Z`);
const stamp = (s: string) => new Date(utc(s)).toISOString();

const DAY = '2026-10-20';
const EVENING = '2026-10-19T22:30:00'; // 6:30 PM New York the evening before
const PRE = '2026-10-20T11:00:00'; // 7:00 AM
const OPEN = '2026-10-20T13:30:00'; // 9:30 AM
const MID = '2026-10-20T14:15:00'; // 10:15 AM
const LATER = '2026-10-20T14:45:00'; // 10:45 AM
const DONE = '2026-10-20T15:30:00'; // 11:30 AM

const ALL = { displacement: true, structure: true, room: true } as const;
const CONFIRMED: Omit<Regime, 'at'> = { kind: 'confirmed', context: 'four-day', evidence: ALL };
const TIMES = {
  evening: stamp(EVENING),
  open: stamp(OPEN),
  regime: CONFIRMED,
  expansionPrice: 25_250,
};
const PLAN = { entry: 25_040, stop: 25_030, contracts: 3, normalTarget: 25_120 };
const RUNNER: NonNullable<EntryPlan['runner']> = { contracts: 1, stopPlan: 'breakeven' };

/** The candle classified and planned the evening before, its GEX area mapped at 9:30 AM. */
const prepared = () => legacyPlan(DAY, TIMES);
/** Locked at 9:30 AM: a confirmed four-day expansion with an expansion target. */
const locked = () => legacySession(DAY, TIMES);
/** I ENTERED IN MY BROKER on Setup A, with the expansion target and an optional runner. */
const entry = (over: Partial<EntrySnapshot> = {}, runner?: typeof RUNNER): EntrySnapshot =>
  legacyEntry(stamp(MID), {
    setup: 'pierce-push',
    plan: { ...PLAN, expansionTarget: 25_250, ...(runner && { runner }) },
    ...over,
  });

describe('the HTF candle classification', () => {
  it('labels the header without ever reading as a signal', () => {
    expect(REGIME_CARDS.map((c) => [c.title, c.label])).toEqual([
      ['RANGE / SMALLER MOVE', 'RANGE'],
      ['EXPANSION CANDIDATE', 'EXPANSION CANDIDATE'],
      ['CONFIRMED EXPANSION', 'EXPANSION CONFIRMED'],
    ]);
    expect(regimeLabel(null)).toBe('NOT CLASSIFIED');
    expect(regimeLabel(locked().thesis!.regime)).toBe('EXPANSION CONFIRMED');
  });

  it('is a confirmed expansion only with all three pieces of evidence', () => {
    const at = stamp(PRE);
    expect(confirmedExpansion({ ...CONFIRMED, at })).toBe(true);
    for (const missing of ['displacement', 'structure', 'room'] as const)
      expect(confirmedExpansion({ ...CONFIRMED, evidence: { ...ALL, [missing]: false }, at })).toBe(
        false,
      );
    expect(confirmedExpansion({ kind: 'candidate', context: 'daily', at })).toBe(false);
    expect(confirmedExpansion(null)).toBe(false);
  });
});

describe('reassessments after the lock', () => {
  const reassessed = (log: Regime[]): TradingSession => ({ ...locked(), regimeLog: log });
  const range = (at: string): Regime => ({ kind: 'range', context: 'daily', at: stamp(at) });

  it('reads the classification standing at each moment, never touching the card', () => {
    const s = reassessed([
      { kind: 'candidate', context: 'daily', at: stamp(LATER) },
      { ...CONFIRMED, at: stamp(DONE) },
    ]);
    expect(regimeAt(s, stamp(MID))!.kind).toBe('confirmed');
    expect(regimeAt(s, stamp(LATER))!.kind).toBe('candidate');
    expect(regimeAt(s, stamp(DONE))).toMatchObject({ kind: 'confirmed', at: stamp(DONE) });
    expect(s.thesis!.regime!.at).toBe(stamp(EVENING));
    const saved = JSON.parse(JSON.stringify(s));
    expect(decodeTradingSession(saved)).toEqual(saved);
    // A runner planned while the expansion stood was distinguished; one after a downgrade was not.
    const runner = (log: Regime[]) =>
      disciplineFromRecords({ ...reassessed(log), entries: [entry({}, RUNNER)] }).distinguished;
    expect(runner([])).toBe(true);
    expect(runner([range(OPEN)])).toBe(false);
  });

  it('refuses a reassessment log that is malformed or out of place', () => {
    const s = reassessed([range(MID)]);
    const bad = (over: Record<string, unknown>, base: TradingSession = s) =>
      decodeTradingSession(JSON.parse(JSON.stringify({ ...base, ...over })));
    expect(bad({})).not.toBeNull();
    expect(bad({ regimeLog: [] })).toBeNull();
    expect(bad({ regimeLog: [{ kind: 'trend', context: 'daily', at: stamp(MID) }] })).toBeNull();
    expect(
      bad({ regimeLog: [{ kind: 'confirmed', context: 'daily', at: stamp(MID) }] }),
    ).toBeNull();
    expect(bad({ regimeLog: [range(LATER), { ...range(MID), kind: 'candidate' }] })).toBeNull();
    // Only after the lock, onto a classified card.
    expect(bad({ regimeLog: s.regimeLog }, prepared())).toBeNull();
    expect(bad({ thesis: { ...s.thesis!, regime: undefined } })).toBeNull();
  });
});

describe('the normal and expansion objectives', () => {
  it('keeps them on the plan and the card, and refuses them malformed', () => {
    const plan = prepared();
    const bad = (prep: Record<string, unknown>) =>
      decodeTradingSession(
        JSON.parse(JSON.stringify({ ...plan, prep: { ...plan.prep, ...prep } })),
      );
    expect(bad({})).not.toBeNull();
    expect(bad({ expansionPrice: 25_100 })).toBeNull();
    expect(bad({ expansionPrice: 0 })).toBeNull();
    expect(
      bad({ regime: { kind: 'range', context: 'daily', at: stamp(PRE), evidence: ALL } }),
    ).toBeNull();
    expect(bad({ regime: { kind: 'confirmed', context: 'daily', at: stamp(PRE) } })).toBeNull();
    // The objectives go together, and the expansion and GEX area only with them.
    expect(bad({ why: undefined })).toBeNull();
    const onlyRegime = { regime: plan.prep!.regime, updatedAt: stamp(PRE) };
    const read = (prep: Record<string, unknown>) =>
      decodeTradingSession(JSON.parse(JSON.stringify({ ...plan, prep })));
    expect(read(onlyRegime)).not.toBeNull();
    expect(read({ ...onlyRegime, expansionPrice: 25_250 })).toBeNull();
    const card = locked().thesis!;
    const fails = (over: Record<string, unknown>) => () => validateThesisCard({ ...card, ...over });
    expect(fails({})).not.toThrow();
    expect(fails({ expansionPrice: 25_000 })).toThrow(/short of the normal/);
    expect(fails({ objectivePrice: undefined, invalidationPrice: undefined })).toThrow();
    expect(fails({ expansionPrice: undefined })).toThrow(/expansion objective/);
    expect(fails({ regime: { ...card.regime!, evidence: undefined } })).toThrow(/evidence/);
    expect(() => validateRegime({ kind: 'range', context: 'daily', at: 'now' })).toThrow();
  });
});

describe('the runner', () => {
  /** The normal target reached at 10:45 AM with the runner left open. */
  const open = (runner = RUNNER) => entry({ partial: { at: stamp(LATER) } }, runner);

  it('reads every way a runner ended, and a runner plan stopped before the normal target', () => {
    for (const kind of ['expansion', 'runner-stopped', 'runner-structure'] as const) {
      const log = [{ ...open(), exit: { kind, at: stamp(DONE) } }];
      expect(() => validateEntryLog(log)).not.toThrow();
      const saved = JSON.parse(
        JSON.stringify(legacyFinished({ ...locked(), entries: log }, stamp(DONE))),
      );
      expect(decodeTradingSession(saved)).toEqual(saved);
    }
    expect(() => validateEntryLog([open()])).not.toThrow();
    expect(() =>
      validateEntryLog([{ ...entry({}, RUNNER), exit: { kind: 'stopped', at: stamp(LATER) } }]),
    ).not.toThrow();
  });

  it('counts a runner stopped at the original stop toward the daily estimate', () => {
    const stopped = (stopPlan: 'breakeven' | 'original'): TradingSession => ({
      ...locked(),
      entries: [
        { ...open({ contracts: 2, stopPlan }), exit: { kind: 'runner-stopped', at: stamp(DONE) } },
      ],
    });
    expect(stoppedRisk(stopped('original'), 2, 0.25)).toBe(40);
    expect(stoppedRisk(stopped('breakeven'), 2, 0.25)).toBe(0);
  });

  it('refuses a runner, a normal target reached or a runner exit out of place', () => {
    const e = open();
    const fails = (over: Partial<Record<keyof EntrySnapshot, unknown>>) => () =>
      validateEntryLog([{ ...e, ...over }]);
    expect(fails({})).not.toThrow();
    expect(fails({ exit: { kind: 'expansion', at: stamp(DONE) } })).not.toThrow();
    expect(fails({ exit: { kind: 'objective', at: stamp(DONE) } })).toThrow(/exit/);
    expect(fails({ partial: undefined, exit: { kind: 'expansion', at: stamp(DONE) } })).toThrow(
      /exit/,
    );
    expect(fails({ exit: { kind: 'runner-stopped', at: stamp(MID) } })).toThrow(/before/);
    expect(fails({ partial: { at: stamp(OPEN) } })).toThrow(/before its entry/);
    expect(fails({ plan: { ...e.plan!, runner: undefined } })).toThrow(/without a runner/);
    expect(fails({ plan: { ...e.plan!, runner: { contracts: 3, stopPlan: 'original' } } })).toThrow(
      /runner contracts/,
    );
    expect(fails({ plan: { ...e.plan!, runner: { contracts: 1, stopPlan: 'wider' } } })).toThrow(
      /stop plan/,
    );
    expect(fails({ plan: { ...e.plan!, expansionTarget: undefined } })).toThrow(
      /without an expansion target/,
    );
    expect(fails({ plan: { ...e.plan!, expansionTarget: 25_100 } })).toThrow(/wrong side/);
    expect(fails({ plan: { ...e.plan!, normalTarget: 25_030 } })).toThrow(/wrong side/);
    expect(fails({ plan: { ...e.plan!, normalTarget: undefined } })).toThrow(/normal target/);
  });
});
