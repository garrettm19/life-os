import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBackup, parseBackup } from '../backup';
import { decodeState, parseSetup } from '../data';
import { candleDate } from '../market-clock';
import { demoRuleBook } from '../demo-catalog';
import { CATEGORIES, buildExport } from '../export';
import { Program, State, TradingProfile } from '../model';
import { previewSetup } from '../setup';
import {
  TradingSession,
  defaultTradingProfile,
  enableTrading,
  saveTradingProfile,
  saveTradingReview,
  tradingBook,
  candleReview,
} from '../trading';
import { todayWidgetTimeline, widgetDayStatus } from '../widget';
import { todayListTimeline, widgetTasks } from '../widget-list';
import { trainingState } from '../../test-support/fixtures';
import { legacyEntry, legacyFinished, legacySession } from '../../test-support/legacy-trading';

// The cockpit's prices and limits in the permanent record: copied onto the day's review (and so
// into SQLite and backups), set up from a setup file only where the device has none, and never in
// an analysis export or on a widget. Synthetic data only: example prices on an example instrument
// labelled as such. Monday, November 9, 2026 is standard time (New York = UTC-5).
const MON = '2026-11-09';
const AT = new Date(2026, 10, 13, 17).toISOString();
const EVENING = '2026-11-08T23:30:00.000Z'; // 6:30 PM New York, Sunday: Monday's 6 PM lock
const OPEN = '2026-11-09T14:30:00.000Z'; // 9:30 AM
const MID = '2026-11-09T15:15:00.000Z'; // 10:15 AM
const DONE = '2026-11-09T16:00:00.000Z';

const INSTRUMENT = { name: 'MNQ (example)', pointValue: 2, tick: 0.25 };
const RISK = { maxContracts: 5, thesisRisk: 150, dailyLoss: 300 };

function base(): State {
  const state = trainingState();
  const trading: Program = {
    id: 'trading',
    title: 'Trading discipline',
    group: 'Private',
    goalIds: [],
    routines: [
      {
        id: 'trade-rules',
        title: 'Follow my trading rules',
        duration: null,
        weekdays: [1, 2, 3, 4, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        private: true,
        capture: 'rules',
      },
    ],
  };
  return {
    ...state,
    programs: [...state.programs, trading],
    ruleBooks: [
      {
        id: 'book',
        routineId: 'trade-rules',
        title: 'Trading rules',
        checkpoints: [],
        rules: [{ id: 'rule-1', title: 'An example rule', details: '' }],
        updatedAt: AT,
      },
    ],
  };
}

const withTrading = () =>
  enableTrading(base(), 'trade-rules', new Date(2026, 10, 2, 8).toISOString());

function withLimits(state = withTrading()): State {
  const profile = tradingBook(state)!.trading!;
  return saveTradingProfile(
    state,
    'trade-rules',
    { ...profile, instrument: INSTRUMENT, risk: RISK },
    AT,
  );
}

/**
 * Monday's cockpit session: a confirmed expansion planned and locked, one entry with a runner,
 * the normal target reached and the runner closed at the expansion target.
 */
function cockpitDay(): TradingSession {
  const s = legacySession(MON, {
    evening: EVENING,
    open: OPEN,
    expansionPrice: 25_250,
    regime: {
      kind: 'confirmed',
      context: 'four-day',
      evidence: { displacement: true, structure: true, room: true },
    },
  });
  const entry = legacyEntry(MID, {
    setup: 'double-pierce',
    timeframe: '15m',
    plan: {
      entry: 25_040.25,
      stop: 25_030.5,
      contracts: 3,
      normalTarget: 25_120,
      expansionTarget: 25_250,
      runner: { contracts: 1, stopPlan: 'breakeven' },
    },
    partial: { at: MID },
    exit: { kind: 'expansion', at: DONE },
  });
  return legacyFinished({ ...s, entries: [entry] }, DONE);
}

function reviewed(): State {
  const state = withLimits();
  return saveTradingReview(
    state,
    {
      date: MON,
      routineId: 'trade-rules',
      session: 'traded',
      answers: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, 'yes' as const]),
      ),
      violations: [],
      entries: 1,
      failedTheses: 0,
      note: '',
      discipline: {
        labeled: true,
        distinguished: true,
        withBias: true,
        namedSetups: true,
        noPrediction: true,
        followedPlan: true,
      },
      daySession: cockpitDay(),
    },
    'r-mon',
    AT,
  );
}

/** Every way a price, a limit or a cockpit field could be written out. */
const PRIVATE =
  /25[,.]?(040|120|000|030|250)|\b150\b|\b300\b|MNQ|double-pierce|objectivePrice|plan|exit|regime|expansion|runner|partial|discipline|labeled/;

describe('cockpit prices in the record', () => {
  it('are copied onto the review as committed, and pass every state and backup check', () => {
    const state = reviewed();
    const review = candleReview(state, 'trade-rules', MON)!;
    expect(review.trading!.thesis).toMatchObject({
      objective: '25,120',
      objectivePrice: 25_120,
      invalidationPrice: 25_000,
      expansionPrice: 25_250,
      gex: { kind: 'focus', price: 25_040, zone: 10, lock: 'morning' },
      regime: { kind: 'confirmed', context: 'four-day' },
    });
    expect(review.trading!.entryLog![0]).toMatchObject({
      setup: 'double-pierce',
      timeframe: '15m',
      plan: {
        entry: 25_040.25,
        stop: 25_030.5,
        contracts: 3,
        normalTarget: 25_120,
        expansionTarget: 25_250,
        runner: { contracts: 1, stopPlan: 'breakeven' },
      },
      partial: { at: MID },
      exit: { kind: 'expansion', at: DONE },
    });
    expect(review.trading!.discipline).toMatchObject({ labeled: true, followedPlan: true });
    expect(decodeState(JSON.parse(JSON.stringify(state))).ruleReviews).toEqual(state.ruleReviews);
    const restored = parseBackup(encodeBackup(state, AT));
    expect(restored.state.ruleReviews).toEqual(state.ruleReviews);
    expect(restored.state.ruleBooks).toEqual(state.ruleBooks);
  });

  it('never reach an analysis export', () => {
    const state = reviewed();
    const rows = buildExport(state, {
      categories: CATEGORIES.map((c) => c.key),
      from: null,
      to: '2026-11-13',
      includePrivate: true,
    });
    const reviewRows = rows.filter((r) => r.category === 'ruleReviews');
    expect(reviewRows.length).toBeGreaterThan(0);
    for (const row of rows) expect(JSON.stringify(row)).not.toMatch(PRIVATE);
  });

  it('never reach a widget', () => {
    const state = reviewed();
    const now = new Date(2026, 10, 9, 12);
    const out = JSON.stringify([
      todayWidgetTimeline(state, now),
      todayListTimeline(state, now),
      widgetTasks(state, MON),
      widgetDayStatus(state, MON),
    ]);
    expect(out).not.toMatch(PRIVATE);
    // The widget code reads nothing of the trading session, its plan or its limits.
    const root = join(__dirname, '..', '..');
    const sources = [
      ...readdirSync(join(root, 'widget')).map((f) => join(root, 'widget', f)),
      join(root, 'domain', 'widget.ts'),
      join(root, 'domain', 'widget-list.ts'),
    ].filter((f) => /\.tsx?$/.test(f));
    for (const file of sources)
      expect(readFileSync(file, 'utf8')).not.toMatch(
        /from '[^']*(trading|trading-cockpit|trading-prices|trading-store|trading-rules)'/,
      );
  });
});

describe('setup import of the instrument and risk limits', () => {
  const file = (over: Partial<TradingProfile>) =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: base().programs.filter((p) => p.id === 'trading'),
      ruleBooks: [
        {
          ...base().ruleBooks[0],
          trading: { ...defaultTradingProfile('2026-01-01'), ...over },
        },
      ],
    });
  const LATER = new Date(2026, 10, 13, 18).toISOString();
  const profileOf = (state: State) => tradingBook(state)!.trading!;

  it('applies them where the device has none, and the preview names them', () => {
    const device = withTrading();
    const raw = file({ instrument: INSTRUMENT, risk: RISK });
    const next = parseSetup(raw, device, LATER);
    expect(profileOf(next)).toMatchObject({ instrument: INSTRUMENT, risk: RISK });
    expect(previewSetup(raw, device, LATER).tradingUpdated).toMatchObject({
      instrument: 'MNQ (example)',
      risk: ['maxContracts', 'thesisRisk', 'dailyLoss'],
    });
    // Importing the same file again changes nothing.
    expect(parseSetup(raw, next, LATER).ruleBooks).toEqual(next.ruleBooks);
    expect(previewSetup(raw, next, LATER).tradingUpdated).toBeNull();
  });

  it("keeps the device's own instrument and each limit it set", () => {
    const own = saveTradingProfile(
      withTrading(),
      'trade-rules',
      {
        ...profileOf(withTrading()),
        instrument: { name: 'Example index (example)', pointValue: 20, tick: 0.25 },
        risk: { maxContracts: 2, thesisRisk: null, dailyLoss: null },
      },
      AT,
    );
    const raw = file({ instrument: INSTRUMENT, risk: RISK });
    expect(profileOf(parseSetup(raw, own, LATER))).toMatchObject({
      instrument: { name: 'Example index (example)', pointValue: 20, tick: 0.25 },
      risk: { maxContracts: 2, thesisRisk: 150, dailyLoss: 300 },
    });
    expect(previewSetup(raw, own, LATER).tradingUpdated).toMatchObject({
      instrument: null,
      risk: ['thesisRisk', 'dailyLoss'],
    });
    // A file without them leaves the device's as they are.
    expect(profileOf(parseSetup(file({}), own, LATER))).toMatchObject({
      instrument: { name: 'Example index (example)' },
      risk: { maxContracts: 2, thesisRisk: null, dailyLoss: null },
    });
  });

  it('never takes the accounts, the money answer or the live-account confirmation from a file, and a raise from one waits', () => {
    const attached = parseSetup(
      file({
        accounts: 5,
        liveTrading: true,
        moneySetAsideOn: '2026-11-01',
        existingAccountOn: '2026-11-01',
      }),
      base(),
      LATER,
    );
    expect(profileOf(attached).accounts).toBeUndefined();
    expect(profileOf(attached).liveTrading).toBeUndefined();
    expect(profileOf(attached).moneySetAsideOn).toBeUndefined();
    expect(profileOf(attached).existingAccountOn).toBeUndefined();
    // An entry cap above the default, where the device has none: it waits for the next candle.
    const raised = profileOf(parseSetup(file({ maxEntries: 6 }), withTrading(), LATER));
    expect(raised.maxEntries).toBe(6);
    expect(raised.raisedOn).toEqual({
      candle: candleDate(Date.parse(LATER)),
      before: expect.objectContaining({ maxEntries: 3 }),
    });
  });

  it('importing the same file again with a raise waiting changes nothing, not even the time', () => {
    const raw = file({ maxEntries: 6 });
    const once = parseSetup(raw, withTrading(), LATER);
    expect(profileOf(once).raisedOn).toBeDefined();
    const soon = new Date(Date.parse(LATER) + 10 * 60_000).toISOString();
    expect(candleDate(Date.parse(soon))).toBe(candleDate(Date.parse(LATER)));
    expect(parseSetup(raw, once, soon).ruleBooks).toEqual(once.ruleBooks);
  });

  it('refuses a malformed instrument or limit in the file before anything changes', () => {
    expect(() =>
      parseSetup(file({ instrument: { ...INSTRUMENT, tick: 0 } }), withTrading(), LATER),
    ).toThrow(/tick/);
    expect(() =>
      parseSetup(file({ risk: { ...RISK, maxContracts: 100 } }), withTrading(), LATER),
    ).toThrow(/contract limit/);
  });

  it('gives the demo labelled example values only', () => {
    const demo = demoRuleBook('2026-11-02', AT).trading!;
    expect(demo.instrument).toEqual({ name: 'MNQ (example)', pointValue: 2, tick: 0.25 });
    expect(demo.risk).toEqual({ maxContracts: 5, thesisRisk: 150, dailyLoss: 300 });
    // A new profile has none: nothing is ever a code default.
    const fresh = defaultTradingProfile('2026-11-02');
    expect(fresh.instrument).toBeUndefined();
    expect(fresh.risk).toBeUndefined();
  });
});
