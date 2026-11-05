import { describe, expect, it } from '@jest/globals';
import { decodeState, parseSetup, withDay } from '../data';
import { buildExport } from '../export';
import { previewSetup } from '../setup';
import {
  EntrySnapshot,
  Program,
  RuleReview,
  State,
  ThesisCard,
  TradingProfile,
  accountSetPause,
  shiftDate,
} from '../model';
import { upsertRoutine } from '../routines';
import { RISK_PRINCIPLES } from '../trading-rules';
import { protectDay } from '../objectives';
import { ensureChecklistDay, setStatus } from '../planner';
import { evidenceNote } from '../linked';
import { importDeviceSessions } from '../trading-sessions';
import { saveRuleReview } from '../rules';
import {
  TradingSession,
  VIOLATION_IDS,
  cleanStreak,
  dayAwayOffered,
  decodeTradingSession,
  defaultTradingProfile,
  enableTrading,
  endTrading,
  accountSetPauseLine,
  loseAccountSet,
  newSession,
  profitLimit,
  processScore,
  reviewEditedText,
  saveTradingProfile,
  saveTradingReview,
  sessionResult,
  nextDayStudyOnly,
  onTradingSchedule,
  studyOnlyDay,
  unreviewedTradingDay,
  tradingBook,
  tradingDayReader,
  tradingPaused,
  candleReview,
  tradingSummary,
  violationsFromLog,
} from '../trading';
import { legacyFailed } from '../../test-support/legacy-trading';
import { trainingState } from '../../test-support/fixtures';

// Synthetic data only: a generic trading routine with invented rules. No real account, instrument
// or amount. "Today" is Friday, November 13, 2026; the routine is due Monday to Friday.
const TODAY = '2026-11-13';
const AT = new Date(2026, 10, 13, 17).toISOString();
const MON = '2026-11-09';

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
        checkpoints: [
          { id: 'checkpoint-1', text: 'An older checkpoint' },
          { id: 'checkpoint-2', text: 'Another older checkpoint' },
        ],
        rules: [{ id: 'rule-1', title: 'An older rule', details: '' }],
        updatedAt: AT,
      },
    ],
  };
}

/** The process set up from Monday, with the generic eight items. */
function withTrading(): State {
  const state = enableTrading(base(), 'trade-rules', new Date(2026, 10, 9, 8).toISOString());
  return state;
}

function open(state: State, date: string): State {
  return withDay(
    state,
    ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      state.days[date],
      `${date}T08:00:00.000Z`,
    ),
  );
}

const all = (answer: 'yes' | 'no') =>
  Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, answer] as [string, 'yes' | 'no']),
  );

function review(
  state: State,
  date: string,
  over: Partial<Parameters<typeof saveTradingReview>[1]> = {},
  id = `r-${date}`,
): State {
  return saveTradingReview(
    state,
    {
      date,
      routineId: 'trade-rules',
      session: 'traded',
      answers: all('yes'),
      violations: [],
      entries: 2,
      failedTheses: 0,
      note: '',
      ...over,
    },
    id,
    AT,
  );
}

describe('trading process score', () => {
  it('scores eight PASS as 8/8 clean and eight FAIL as 0/8 rule-broken', () => {
    let state = review(withTrading(), MON);
    const book = tradingBook(state)!;
    const clean = candleReview(state, 'trade-rules', MON)!;
    expect(processScore(clean, book.trading!)).toEqual({ passed: 8, answered: 8, total: 8 });
    expect(sessionResult(clean, book.trading!)).toBe('clean');
    state = review(state, MON, { answers: all('no') });
    const failed = candleReview(state, 'trade-rules', MON)!;
    expect(processScore(failed, book.trading!).passed).toBe(0);
    expect(sessionResult(failed, book.trading!)).toBe('broken');
  });

  it('refuses a partial review: nothing defaults to PASS', () => {
    const answers = all('yes');
    delete answers['process-8'];
    expect(() => review(withTrading(), MON, { answers })).toThrow(/1 left/);
    expect(() => review(withTrading(), MON, { answers: {} })).toThrow(/8 left/);
  });

  it('any FAIL prevents a clean session', () => {
    const state = review(withTrading(), MON, { answers: { ...all('yes'), 'process-2': 'no' } });
    const r = candleReview(state, 'trade-rules', MON)!;
    expect(processScore(r, tradingBook(state)!.trading!).passed).toBe(7);
    expect(sessionResult(r, tradingBook(state)!.trading!)).toBe('broken');
  });

  it('a hard violation makes an 8/8 session rule-broken, keeping the 8/8 as answered', () => {
    const state = review(withTrading(), MON, { violations: ['hard-2'] });
    const r = candleReview(state, 'trade-rules', MON)!;
    expect(processScore(r, tradingBook(state)!.trading!).passed).toBe(8);
    expect(sessionResult(r, tradingBook(state)!.trading!)).toBe('broken');
    expect(r.violations).toEqual(['hard-2']);
  });

  it('a deliberate no-trade session can be clean only when reviewed', () => {
    let state = open(withTrading(), MON);
    expect(tradingDayReader(state, tradingBook(state)!)(MON, TODAY).status).toBe('missed');
    state = review(state, MON, { session: 'no-trade', entries: 0 });
    expect(tradingDayReader(state, tradingBook(state)!)(MON, TODAY).status).toBe('clean');
  });

  it('a planned day away is unscored and needs no answers', () => {
    const state = review(withTrading(), MON, { session: 'away', answers: {} });
    const r = candleReview(state, 'trade-rules', MON)!;
    expect(r).toMatchObject({ outcome: 'none', answers: [], violations: [] });
    expect(sessionResult(r, tradingBook(state)!.trading!)).toBe('away');
  });

  it('saving again updates the one review for the day; it never duplicates', () => {
    let state = review(withTrading(), MON, {}, 'first');
    state = review(state, MON, { answers: { ...all('yes'), 'process-5': 'no' } }, 'second');
    const reviews = state.ruleReviews.filter((r) => r.date === MON);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe('first');
  });

  it('counts entries as self-reported ideas, never multiplied by mirrored accounts', () => {
    const state = review(withTrading(), MON, { entries: 3, failedTheses: 1 });
    expect(candleReview(state, 'trade-rules', MON)!.trading).toEqual({
      session: 'traded',
      entries: 3,
      failedTheses: 1,
      ownCandle: true,
    });
    expect(() => review(withTrading(), MON, { entries: 2.5 })).toThrow(/whole number/);
  });

  it('completes the day objective for the review only, and a future date is refused', () => {
    let state = open(withTrading(), MON);
    state = review(state, MON, { answers: all('no') });
    const block = state.days[MON].blocks.find((b) => b.routineId === 'trade-rules')!;
    // Done means reviewed; the review itself says the rules were broken.
    expect(block.status).toBe('done');
    expect(tradingDayReader(state, tradingBook(state)!)(MON, TODAY).status).toBe('broken');
    expect(() => review(withTrading(), shiftDate(TODAY, 30))).toThrow(/today or an earlier day/);
  });
});

describe('clean-session streak', () => {
  it('counts clean sessions, ends on a broken or unreviewed trading day, and holds on days away', () => {
    let state = withTrading();
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
      state = open(state, d);
    state = review(state, '2026-11-09');
    state = review(state, '2026-11-10');
    // Wednesday: opened, never reviewed: a miss, not a clean day.
    state = review(state, '2026-11-12');
    const book = tradingBook(state)!;
    expect(tradingDayReader(state, book)('2026-11-11', TODAY).status).toBe('missed');
    expect(cleanStreak(state, book, TODAY)).toEqual({ current: 1, best: 2 });
    // Backfilling Wednesday as a planned day away restores the run without crediting it.
    state = review(state, '2026-11-11', { session: 'away', answers: {} });
    expect(cleanStreak(state, tradingBook(state)!, TODAY)).toEqual({ current: 3, best: 3 });
    // A backdated correction to rule-broken recalculates.
    state = review(state, '2026-11-10', { violations: ['hard-4'] });
    expect(cleanStreak(state, tradingBook(state)!, TODAY)).toEqual({ current: 1, best: 1 });
  });

  it('weekends, unopened days and today still open neither earn nor break', () => {
    let state = review(withTrading(), '2026-11-06'); // the Friday before, backdated
    state = review(state, '2026-11-09');
    state = open(state, TODAY);
    const book = tradingBook(state)!;
    expect(tradingDayReader(state, book)('2026-11-07', TODAY).status).toBe('none');
    expect(tradingDayReader(state, book)(TODAY, TODAY).status).toBe('open');
    expect(cleanStreak(state, book, TODAY)).toEqual({ current: 2, best: 2 });
  });

  it('a protected trading day holds the streak', () => {
    let state = review(withTrading(), '2026-11-09');
    state = open(state, '2026-11-10');
    state = withDay(state, protectDay(state.days['2026-11-10'], 'illness'));
    state = review(state, '2026-11-11');
    const book = tradingBook(state)!;
    expect(tradingDayReader(state, book)('2026-11-10', TODAY).status).toBe('held');
    expect(cleanStreak(state, book, TODAY).current).toBe(2);
  });

  it('invents no history before the process started', () => {
    let state = open(withTrading(), '2026-11-05');
    state = open(state, '2026-11-02');
    const book = tradingBook(state)!;
    expect(tradingDayReader(state, book)('2026-11-05', TODAY).status).toBe('before');
    expect(cleanStreak(state, book, TODAY)).toEqual({ current: 0, best: 0 });
  });
});

describe('earlier rule reviews', () => {
  it('are kept exactly, shown as older, and never scored or converted', () => {
    let state = open(base(), '2026-11-02');
    const block = state.days['2026-11-02'].blocks.find((b) => b.routineId === 'trade-rules')!;
    state = saveRuleReview(
      state,
      {
        date: '2026-11-02',
        routineId: 'trade-rules',
        outcome: 'reviewed',
        answers: [
          { checkpointId: 'checkpoint-1', answer: 'yes' },
          { checkpointId: 'checkpoint-2', answer: 'na' },
        ],
        violations: [],
        note: 'kept as written',
        occurrence: { date: '2026-11-02', blockId: block.id },
      },
      'old',
      AT,
    );
    const before: RuleReview = state.ruleReviews[0];
    state = enableTrading(state, 'trade-rules', new Date(2026, 10, 9, 8).toISOString());
    const book = tradingBook(state)!;
    expect(state.ruleReviews).toEqual([before]);
    expect(book.checkpoints).toEqual(base().ruleBooks[0].checkpoints);
    expect(book.rules).toEqual(base().ruleBooks[0].rules);
    expect(tradingDayReader(state, book)('2026-11-02', TODAY).status).toBe('older');
    // A new review on that same day sits beside the older one; the older one keeps its objective.
    state = review(state, '2026-11-02', { session: 'no-trade' });
    expect(state.ruleReviews.find((r) => r.id === 'old')).toEqual(before);
    expect(candleReview(state, 'trade-rules', '2026-11-02')!.occurrenceId).toBeNull();
  });

  it('turning the process on twice changes nothing the second time', () => {
    const once = withTrading();
    expect(enableTrading(once, 'trade-rules', AT)).toBe(once);
  });
});

describe('summary', () => {
  it('names the most often failed item from recorded answers', () => {
    let state = review(withTrading(), '2026-11-09', {
      answers: { ...all('yes'), 'process-2': 'no' },
    });
    state = review(state, '2026-11-10', { answers: { ...all('yes'), 'process-2': 'no' } });
    state = review(state, '2026-11-11', {
      answers: { ...all('yes'), 'process-7': 'no' },
      violations: ['hard-6'],
    });
    const s = tradingSummary(state, tradingBook(state)!, TODAY);
    expect(s.failed[0]).toMatchObject({ item: { title: 'Waited for location' }, count: 2 });
    expect(s.violations[0]).toMatchObject({
      item: { title: 'Exceeded the daily loss limit' },
      count: 1,
    });
    expect(s.broken).toBe(3);
    expect(s.latest?.date).toBe('2026-11-11');
  });
});

describe('session in progress', () => {
  it("reads an earlier build's failed theses, which never ended the day by count", () => {
    // Rewritten: the reset clock and the failed-thesis writer belonged to the retired step flow.
    const start = Date.parse('2026-11-13T15:00:00.000Z');
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const session = legacyFailed(
      legacyFailed({ ...newSession(TODAY), startedAt: at(0) }, at(0)),
      at(60),
    );
    expect(decodeTradingSession(session)).toEqual(session);
    expect(session).toMatchObject({ failedTheses: 2, doneAt: null, doneReason: null });
    const ended = endTrading(session, 'finished', AT);
    expect(ended.doneReason).toBe('finished');
    expect(endTrading(ended, 'hard-stop', AT)).toBe(ended);
  });

  it('reads back only a valid saved session', () => {
    expect(decodeTradingSession(newSession(TODAY))).toEqual(newSession(TODAY));
    expect(decodeTradingSession({ ...newSession(TODAY), failedTheses: -1 })).toBeNull();
    expect(decodeTradingSession({ date: 'soon' })).toBeNull();
  });
});

describe('storage and backup', () => {
  it('a state with trading records round-trips through the saved-data check, version 5', () => {
    let state = open(withTrading(), MON);
    state = review(state, MON, { violations: ['hard-1'], note: 'Wait for permission' });
    const decoded = decodeState(JSON.parse(JSON.stringify(state)));
    expect(decoded.version).toBe(5);
    expect(decoded.ruleBooks).toEqual(state.ruleBooks);
    expect(decoded.ruleReviews).toEqual(state.ruleReviews);
  });

  it('rejects a trading review answered Not applicable or with a mismatched session', () => {
    const state = review(withTrading(), MON);
    const bad = (r: Partial<RuleReview>) => () =>
      decodeState(
        JSON.parse(
          JSON.stringify({
            ...state,
            ruleReviews: [{ ...state.ruleReviews[0], ...r }],
          }),
        ),
      );
    expect(
      bad({
        answers: state.ruleReviews[0].answers.map((a, i) => (i ? a : { ...a, answer: 'na' })),
      }),
    ).toThrow(/Not applicable/);
    expect(bad({ outcome: 'none', answers: [], violations: [] })).toThrow(/disagree/);
  });

  it('keeps the eight items in place: wording can change, positions cannot', () => {
    const state = withTrading();
    const profile = tradingBook(state)!.trading!;
    const renamed = {
      ...profile,
      checklist: profile.checklist.map((c, i) => (i ? c : { ...c, title: 'Levels ready' })),
    };
    expect(
      tradingBook(saveTradingProfile(state, 'trade-rules', renamed, AT))!.trading!.checklist[0]
        .title,
    ).toBe('Levels ready');
    expect(() =>
      saveTradingProfile(
        state,
        'trade-rules',
        { ...profile, checklist: [...profile.checklist].reverse() },
        AT,
      ),
    ).toThrow(/keep their places/);
    expect(() =>
      saveTradingProfile(
        state,
        'trade-rules',
        { ...profile, checklist: profile.checklist.slice(1) },
        AT,
      ),
    ).toThrow();
  });
});

describe('selective export', () => {
  it('writes the score, result, items and violations by name, and no money figure', () => {
    const state = review(withTrading(), MON, {
      answers: { ...all('yes'), 'process-4': 'no' },
      violations: ['hard-1'],
    });
    const rows = buildExport(state, {
      categories: ['ruleReviews'],
      from: null,
      to: TODAY,
      includePrivate: true,
    });
    const value = (field: string, item?: string) =>
      rows.find((r) => r.field === field && (!item || r.item === item))?.value;
    expect(value('process score')).toBe(7);
    expect(value('result')).toBe('rule-broken');
    expect(value('process item', 'Stayed anchored to HTF')).toBe('fail');
    expect(value('hard violation', 'No clear invalidation')).toBe('yes');
    expect(rows.some((r) => /\$|profit|p&l|balance/i.test(`${r.item} ${r.field}`))).toBe(false);
  });
});

describe('setup import of the trading process', () => {
  const file = (since: string) =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: base().programs.filter((p) => p.id === 'trading'),
      ruleBooks: [
        {
          ...base().ruleBooks[0],
          checkpoints: [{ id: 'checkpoint-9', text: 'A different checkpoint in the file' }],
          trading: {
            ...tradingBook(withTrading())!.trading!,
            since,
            limits: [{ id: 'limit-1', label: 'Daily loss', value: 'An amount per account' }],
          },
        },
      ],
    });

  it('attaches only the process to a rulebook already on the device, from today', () => {
    let device = open(base(), '2026-11-02');
    device = saveRuleReview(
      device,
      {
        date: '2026-11-02',
        routineId: 'trade-rules',
        outcome: 'none',
        answers: [],
        violations: [],
        note: '',
      },
      'old',
      AT,
    );
    const preview = previewSetup(file('2026-01-01'), device, AT);
    expect(preview.tradingAdded).toBe(1);
    expect(preview.rulebooksAdded).toBe(0);
    const next = parseSetup(file('2026-01-01'), device, AT);
    const book = tradingBook(next)!;
    expect(book.checkpoints).toEqual(base().ruleBooks[0].checkpoints);
    expect(book.rules).toEqual(base().ruleBooks[0].rules);
    expect(book.trading!.since).toBe(TODAY);
    expect(book.trading!.limits).toEqual([
      { id: 'limit-1', label: 'Daily loss', value: 'An amount per account' },
    ]);
    expect(next.ruleReviews).toEqual(device.ruleReviews);
    // Nothing before today is judged by the process the import brought.
    expect(tradingDayReader(next, book)('2026-11-02', TODAY).status).toBe('older');
    // Importing again keeps the process already on the device.
    const edited = saveTradingProfile(next, 'trade-rules', { ...book.trading!, limits: [] }, AT);
    expect(tradingBook(parseSetup(file('2026-01-01'), edited, AT))!.trading!.limits).toEqual([]);
    expect(previewSetup(file('2026-01-01'), edited, AT).tradingAdded).toBe(0);
  });
});

describe('process start, days away and changed lists', () => {
  it('a new rulebook from a setup file also starts no earlier than today', () => {
    const file = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: base().programs.filter((p) => p.id === 'trading'),
      ruleBooks: [
        {
          ...tradingBook(withTrading())!,
          trading: { ...tradingBook(withTrading())!.trading!, since: '2026-09-01' },
        },
      ],
    });
    let device = open({ ...base(), ruleBooks: [] }, '2026-11-02');
    device = { ...device, programs: device.programs };
    const next = parseSetup(file, device, AT);
    const book = tradingBook(next)!;
    expect(book.trading!.since).toBe(TODAY);
    expect(tradingDayReader(next, book)('2026-11-02', TODAY).status).toBe('before');
  });

  it('a planned day away cannot replace a reviewed session', () => {
    const state = review(withTrading(), MON, { violations: ['hard-3'] });
    expect(() => review(state, MON, { session: 'away', answers: {} })).toThrow(
      /Correct its answers/,
    );
  });

  it('a violation removed from the list since stays on its review when it is corrected', () => {
    let state = review(withTrading(), MON, { violations: ['hard-13'] });
    const profile = tradingBook(state)!.trading!;
    state = saveTradingProfile(
      state,
      'trade-rules',
      { ...profile, violations: profile.violations.filter((v) => v.id !== 'hard-13') },
      AT,
    );
    // Correcting the answers keeps it, and leaving it out of a correction does not remove it.
    expect(() => review(state, MON, { violations: ['hard-13'], answers: all('no') })).not.toThrow();
    expect(
      candleReview(review(state, MON, { violations: [] }), 'trade-rules', MON)!.violations,
    ).toEqual(['hard-13']);
  });

  it('a session without trades reports no trade counts', () => {
    const state = review(withTrading(), MON, { session: 'no-trade', entries: 3, failedTheses: 1 });
    expect(candleReview(state, 'trade-rules', MON)!.trading).toEqual({
      session: 'no-trade',
      entries: null,
      failedTheses: null,
      ownCandle: true,
    });
    const bad = {
      ...state,
      ruleReviews: state.ruleReviews.map((r) => ({ ...r, trading: { ...r.trading!, entries: 2 } })),
    };
    expect(() => decodeState(JSON.parse(JSON.stringify(bad)))).toThrow(/trade counts/);
  });

  it('a backdated review moves the start, and the trading days after it are judged', () => {
    let state = open(withTrading(), '2026-11-05');
    state = review(state, '2026-11-04');
    const book = tradingBook(state)!;
    expect(tradingDayReader(state, book)('2026-11-05', TODAY).status).toBe('missed');
    expect(cleanStreak(state, book, TODAY).current).toBe(0);
  });
});

describe('profile and defaults for commits before the session', () => {
  it('rewords two review items in place and appends six hard violations under new IDs', () => {
    const profile = tradingBook(withTrading())!.trading!;
    expect(profile.checklist.map((c) => c.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `process-${i + 1}`),
    );
    expect(profile.checklist[0].title).toBe('Prepared the thesis');
    expect(profile.checklist[3].title).toBe('Stayed anchored to HTF');
    expect(profile.violations.map((v) => v.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `hard-${i + 1}`),
    );
    expect(profile.violations[12].title).toBe('Came back for nighttime recovery trading');
    const title = (id: string) => profile.violations.find((v) => v.id === id)!.title;
    expect(title(VIOLATION_IDS.againstBias)).toBe('Traded against my daily bias');
    expect(title(VIOLATION_IDS.unplannedAdd)).toBe(
      'Added at a location not planned before the first entry',
    );
    expect(title(VIOLATION_IDS.studyOnlyDay)).toBe('Traded on a study-only day');
    expect(title(VIOLATION_IDS.overEntryLimit)).toBe('More entries than the daily limit');
    expect(title(VIOLATION_IDS.noNamedSetup)).toBe('Entered without a named setup');
  });

  it('keeps an entry limit an earlier build saved, from 1 to 10', () => {
    // Rewritten: the day-wide entry limit is no longer counted; the field is still read.
    const state = withTrading();
    const profile = tradingBook(state)!.trading!;
    expect(profile.maxEntries).toBeUndefined();
    const saved = saveTradingProfile(state, 'trade-rules', { ...profile, maxEntries: 10 }, AT);
    expect(tradingBook(saved)!.trading!.maxEntries).toBe(10);
    for (const maxEntries of [0, 11, 1.5])
      expect(() =>
        saveTradingProfile(state, 'trade-rules', { ...profile, maxEntries }, AT),
      ).toThrow(/entry limit/);
    // A profile saved before the limit is still valid.
    const older = { ...profile };
    delete older.maxEntries;
    const decoded = decodeState(
      JSON.parse(JSON.stringify(saveTradingProfile(state, 'trade-rules', older, AT))),
    );
    expect(tradingBook(decoded)!.trading!.maxEntries).toBeUndefined();
  });
});

describe('cool-down after a hard violation', () => {
  it('makes the next candle study only, across a weekend', () => {
    let state = review(withTrading(), '2026-11-06', { violations: ['hard-4'] });
    const book = tradingBook(state)!;
    // Friday's violation reaches Monday's candle: the candle before Monday's is Friday's.
    expect(studyOnlyDay(state, book, '2026-11-09')).toEqual({ after: '2026-11-06' });
    expect(onTradingSchedule(state, book, '2026-11-07')).toBe(false);
    // Only the one previous candle counts: Tuesday is open again.
    expect(studyOnlyDay(state, book, '2026-11-10')).toBeNull();
    // A clean Monday leaves Tuesday open; a violation recorded on Monday carries on.
    state = review(state, '2026-11-09');
    expect(studyOnlyDay(state, book, '2026-11-10')).toBeNull();
    state = review(state, '2026-11-09', { violations: [VIOLATION_IDS.studyOnlyDay] });
    expect(studyOnlyDay(state, book, '2026-11-10')).toEqual({ after: '2026-11-09' });
  });

  it('reads the cool-down by candle, never from the schedule', () => {
    // The routine trades Monday to Thursday; Friday, November 13 is off its schedule.
    const fourDays = (state: State): State => ({
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === 'trade-rules' ? { ...r, weekdays: [1, 2, 3, 4] } : r,
        ),
      })),
    });
    let state = fourDays(review(withTrading(), '2026-11-12', { violations: ['hard-1'] }));
    const book = tradingBook(state)!;
    expect(nextDayStudyOnly(state, book, '2026-11-12')).toBe(true);
    // Thursday's violation holds Friday's candle, on the schedule or not, and not Monday's.
    expect(studyOnlyDay(state, book, '2026-11-13')).toEqual({ after: '2026-11-12' });
    expect(studyOnlyDay(state, book, '2026-11-16')).toBeNull();
    // A violation on Friday holds Monday's candle.
    state = fourDays(review(withTrading(), '2026-11-13', { violations: ['hard-1'] }));
    expect(nextDayStudyOnly(state, book, '2026-11-13')).toBe(true);
    expect(studyOnlyDay(state, book, '2026-11-16')).toEqual({ after: '2026-11-13' });
    // With violations on Thursday and on Friday, the latest is the one named.
    state = review(state, '2026-11-12', { violations: ['hard-2'] });
    expect(studyOnlyDay(state, book, '2026-11-13')).toEqual({ after: '2026-11-12' });
    expect(studyOnlyDay(state, book, '2026-11-16')).toEqual({ after: '2026-11-13' });
    // Adding Saturday to the schedule does not drop it (it once did).
    const sixDays = {
      ...state,
      programs: state.programs.map((p) => ({
        ...p,
        routines: p.routines.map((r) =>
          r.id === 'trade-rules' ? { ...r, weekdays: [1, 2, 3, 4, 5, 6] } : r,
        ),
      })),
    };
    expect(studyOnlyDay(sixDays, book, '2026-11-16')).toEqual({ after: '2026-11-13' });
    // Tuesday reads from Monday on: Friday's violation is spent.
    expect(studyOnlyDay(state, book, '2026-11-17')).toBeNull();
    // A clean review makes nothing study only.
    expect(nextDayStudyOnly(review(withTrading(), MON), book, MON)).toBe(false);
  });

  it('holds a new session until the latest session that ran is reviewed', () => {
    // Monday was a trading day on the plan with no session: the gate is by session, not schedule.
    let state = open(withTrading(), MON);
    const book = tradingBook(state)!;
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBeNull();
    // A session ran on Monday's candle: Tuesday's waits for its review, even if Today never saved
    // Monday, and even when Monday is protected.
    const ran = { ...newSession(MON), startedAt: '2026-11-09T15:00:00.000Z' };
    state = { ...state, tradingSessions: { [MON]: ran } };
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBe(MON);
    const held = withDay(state, protectDay(state.days[MON], 'illness'));
    expect(unreviewedTradingDay(held, book, '2026-11-10')).toBe(MON);
    // Still the latest session that ran, days later.
    expect(unreviewedTradingDay(state, book, '2026-11-12')).toBe(MON);
    // Reviewing it, with a violation, makes Tuesday study only instead.
    state = review(state, MON, { violations: ['hard-4'] });
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBeNull();
    expect(studyOnlyDay(state, book, '2026-11-10')).toEqual({ after: MON });
    // A trade logged without a started session counts as a session that ran.
    const taken = {
      ...withTrading(),
      tradingSessions: {
        [MON]: { ...newSession(MON), attempts: [] as never[] },
        '2026-11-06': {
          ...newSession('2026-11-06'),
          entries: [] as EntrySnapshot[],
        },
      },
    };
    expect(unreviewedTradingDay(taken, book, '2026-11-10')).toBeNull();
    // A session before the process started never needs one.
    const before = {
      ...withTrading(),
      tradingSessions: { '2026-11-06': { ...ran, date: '2026-11-06' } },
    };
    expect(unreviewedTradingDay(before, book, '2026-11-10')).toBeNull();
  });

  it('says at a skipped trading day that the next session waits for its review, when one ran', () => {
    // Skip excuses Monday for Day Cleared; without a session nothing waits for it.
    const opened = open(withTrading(), MON);
    const block = opened.days[MON].blocks.find((b) => b.routineId === 'trade-rules')!;
    let state = withDay(opened, setStatus(opened.days[MON], block.id, 'skipped', AT));
    const book = tradingBook(state)!;
    const skipped = () => state.days[MON].blocks.find((b) => b.id === block.id)!;
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBeNull();
    expect(evidenceNote(state, skipped(), MON)).toBeNull();
    // With a session that ran, the gate holds Tuesday and the skip says so.
    state = {
      ...state,
      tradingSessions: { [MON]: { ...newSession(MON), startedAt: '2026-11-09T15:00:00.000Z' } },
    };
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBe(MON);
    expect(evidenceNote(state, skipped(), MON)).toBe('Skipped · review it before the next session');
    // Once a review is saved, the gate and the note are gone.
    state = review(state, MON, { session: 'no-trade', entries: 0 });
    expect(unreviewedTradingDay(state, book, '2026-11-10')).toBeNull();
    expect(evidenceNote(state, skipped(), MON)).toBeNull();
  });

  it("reads a skipped day's review by its candle, wherever an earlier build saved it", () => {
    // East of New York the earlier build kept Tuesday's session on Wednesday's record and reviewed
    // it there (the review holds Wednesday's objective); Tuesday's objective was skipped.
    const TUE = '2026-11-10';
    const WED = '2026-11-11';
    const opened = open(open(withTrading(), TUE), WED);
    const block = opened.days[TUE].blocks.find((b) => b.routineId === 'trade-rules')!;
    const skippedDay = withDay(opened, setStatus(opened.days[TUE], block.id, 'skipped', AT));
    const reviewed = review(skippedDay, WED, { session: 'no-trade', entries: 0 }, 'r-old');
    const old = {
      ...reviewed,
      ruleReviews: reviewed.ruleReviews.map((r) => {
        const { ownCandle: _mark, ...trading } = r.trading!;
        return { ...r, trading };
      }),
    };
    expect(old.ruleReviews[0].occurrenceId).toBe(
      old.days[WED].blocks.find((b) => b.routineId === 'trade-rules')!.id,
    );
    const { tradingSessionsImported: _flag, ...rest } = old;
    const tuesday = { ...newSession(WED), startedAt: '2026-11-10T14:40:00.000Z' };
    const state = importDeviceSessions({ ...rest, tradingSessions: {} }, [
      [WED, JSON.stringify(tuesday)],
    ]);
    const book = tradingBook(state)!;
    expect(candleReview(state, 'trade-rules', TUE)?.id).toBe('r-old');
    expect(unreviewedTradingDay(state, book, '2026-11-12')).toBeNull();
    const skipped = state.days[TUE].blocks.find((b) => b.id === block.id)!;
    expect(evidenceNote(state, skipped, TUE)).toBeNull();
    // Wednesday's own objective, done when that review was saved, has no review of its own.
    const wed = state.days[WED].blocks.find((b) => b.routineId === 'trade-rules')!;
    expect(evidenceNote(state, wed, WED)).toBe('Done · no review');
    // Correcting Tuesday edits that review on its date and completes Tuesday's own objective.
    const corrected = review(state, TUE, { session: 'traded', entries: 1, note: 'Fixed' }, 'x');
    expect(corrected.ruleReviews.map((r) => [r.id, r.date, r.note])).toEqual([
      ['r-old', WED, 'Fixed'],
    ]);
    expect(corrected.days[TUE].blocks.find((b) => b.id === block.id)!.status).toBe('done');
  });

  it('is never set by a FAIL alone, a day away or a day without a review', () => {
    let state = review(withTrading(), '2026-11-09', { answers: all('no') });
    const book = tradingBook(state)!;
    expect(studyOnlyDay(state, book, '2026-11-10')).toBeNull();
    state = review(state, '2026-11-10', { session: 'away', answers: {} });
    expect(studyOnlyDay(state, book, '2026-11-11')).toBeNull();
    expect(studyOnlyDay(state, book, '2026-11-12')).toBeNull();
  });
});

describe('reviews against the session log', () => {
  const STARTED = '2026-11-09T14:30:00.000Z';
  const thesis: ThesisCard = {
    expectation: 'I expect price to rise toward the example level',
    gexReason: 'Holding above the example flip',
    objective: 'The example level',
    zone: 'The example band',
    invalidation: 'Below the example band',
    addPlan: null,
    committedAt: STARTED,
  };
  const entry = (kind: 'entry' | 'add', at: string, unplanned = false): EntrySnapshot => ({
    at,
    kind,
    side: 'long',
    permission: 'rejection',
    zone: true,
    gexSupports: true,
    invalidation: true,
    ...(unplanned && { unplanned: true as const }),
  });
  const day = (over: Partial<TradingSession> = {}): TradingSession => ({
    ...newSession(MON),
    preparedAt: STARTED,
    startedAt: STARTED,
    thesis,
    gates: { acceptLoss: true, calm: true, noPressure: true, at: STARTED },
    entries: [
      entry('entry', '2026-11-09T15:00:00.000Z'),
      entry('add', '2026-11-09T15:20:00.000Z', true),
    ],
    ...over,
  });

  it('copies the thesis card and the entries onto a traded review', () => {
    const state = review(withTrading(), MON, { daySession: day() });
    const saved = candleReview(state, 'trade-rules', MON)!;
    expect(saved.trading!.thesis).toEqual(thesis);
    expect(saved.trading!.entryLog).toEqual(day().entries);
    expect(saved.editedAt).toBeUndefined();
    const decoded = decodeState(JSON.parse(JSON.stringify(state)));
    expect(decoded.ruleReviews).toEqual(state.ruleReviews);
    // Another day's session is never copied.
    const other = review(withTrading(), MON, { daySession: { ...day(), date: TODAY } });
    expect(candleReview(other, 'trade-rules', MON)!.trading!.thesis).toBeUndefined();
  });

  it('keeps the thesis card on a session without trades, and refuses one with logged entries', () => {
    const noEntries = day({ entries: undefined });
    const state = review(withTrading(), MON, { session: 'no-trade', daySession: noEntries });
    expect(candleReview(state, 'trade-rules', MON)!.trading).toEqual({
      session: 'no-trade',
      entries: null,
      failedTheses: null,
      thesis,
      ownCandle: true,
    });
    expect(() => review(withTrading(), MON, { session: 'no-trade', daySession: day() })).toThrow(
      'Entries were logged in this session. Review it as Traded.',
    );
  });

  it('offers a planned day away only while no session started', () => {
    expect(dayAwayOffered(undefined, null)).toBe(true);
    expect(dayAwayOffered(undefined, newSession(MON))).toBe(true);
    expect(dayAwayOffered(undefined, day())).toBe(false);
    // A session this device could not read may have started: no day away for it.
    expect(dayAwayOffered(undefined, 'unread')).toBe(false);
    expect(() =>
      review(withTrading(), MON, { session: 'away', answers: {}, daySession: 'unread' }),
    ).toThrow(/could not read the day's session/);
    expect(() => review(withTrading(), MON, { daySession: 'unread' })).not.toThrow();
    expect(() =>
      review(withTrading(), MON, { session: 'away', answers: {}, daySession: day() }),
    ).toThrow(/A session ran on this day/);
    const state = review(withTrading(), MON);
    expect(dayAwayOffered(candleReview(state, 'trade-rules', MON), null)).toBe(false);
  });

  // Entries logged on the bias board have no named setup; that pre-selection has its own test.
  const withoutNamedSetup = (profile: TradingProfile): TradingProfile => ({
    ...profile,
    violations: profile.violations.filter((v) => v.id !== VIOLATION_IDS.noNamedSetup),
  });

  it('pre-selects an unplanned add from the session log, and no day-wide entry limit', () => {
    const profile = withoutNamedSetup(tradingBook(withTrading())!.trading!);
    expect(violationsFromLog(profile, day())).toEqual([VIOLATION_IDS.unplannedAdd]);
    expect(violationsFromLog(profile, newSession(MON))).toEqual([]);
    // A profile without those violations has nothing to pre-select.
    expect(violationsFromLog({ ...profile, violations: [] }, day())).toEqual([]);
  });

  it('pre-selects what entries taken outside the rules point to', () => {
    const profile = withoutNamedSetup(tradingBook(withTrading())!.trading!);
    const outside = (
      over: Partial<EntrySnapshot>,
      session: Partial<TradingSession> = {},
    ): TradingSession =>
      day({ entries: [{ ...entry('entry', '2026-11-09T15:00:00.000Z'), ...over }], ...session });
    expect(violationsFromLog(profile, outside({ outsideRules: ['nothing-new'] }))).toEqual([
      VIOLATION_IDS.revenge,
    ]);
    expect(violationsFromLog(profile, outside({ outsideRules: ['reset'] }))).toEqual([
      VIOLATION_IDS.revenge,
    ]);
    // After trading ended: Traded after the hard stop only when it was one.
    const ended = (doneReason: TradingSession['doneReason']) =>
      violationsFromLog(
        profile,
        outside({ outsideRules: ['done'] }, { doneAt: STARTED, doneReason }),
      );
    expect(ended('hard-stop')).toEqual([VIOLATION_IDS.afterHardStop]);
    expect(ended('failed-theses')).toEqual([VIOLATION_IDS.afterHardStop]);
    expect(ended('finished')).toEqual([]);
    expect(ended('invalidated')).toEqual([]);
    // Outside the window: nighttime recovery trading from 6 PM New York, nothing in the afternoon.
    const window = (at: string) =>
      violationsFromLog(profile, outside({ outsideRules: ['window'], at }));
    expect(window('2026-11-10T00:30:00.000Z')).toEqual([VIOLATION_IDS.nightRecovery]);
    expect(window('2026-11-09T19:00:00.000Z')).toEqual([]);
    expect(
      violationsFromLog(
        profile,
        outside({ outsideRules: ['conditions'], withBias: false, invalidation: false }),
      ),
    ).toEqual([VIOLATION_IDS.noInvalidation, VIOLATION_IDS.againstBias]);
    // Not every condition confirmed points to no violation by itself: the review says which.
    expect(
      violationsFromLog(profile, outside({ outsideRules: ['conditions'], zone: false })),
    ).toEqual([]);
    // There is no day-wide entry limit: more entries point to no violation by count.
    const three = day({
      entries: [
        entry('entry', '2026-11-09T15:00:00.000Z'),
        entry('add', '2026-11-09T15:10:00.000Z'),
        { ...entry('add', '2026-11-09T15:20:00.000Z'), outsideRules: ['limit'] },
      ],
    });
    expect(violationsFromLog(profile, three)).toEqual([]);
  });

  it('never takes the entries taken below the entries logged', () => {
    // Two logged: one typed is refused, more or blank is kept as typed.
    expect(() => review(withTrading(), MON, { entries: 1, daySession: day() })).toThrow(
      'Entries taken cannot be below the 2 logged in this session. Every logged entry counts.',
    );
    for (const entries of [2, 3, null]) {
      const state = review(withTrading(), MON, { entries, daySession: day() });
      expect(candleReview(state, 'trade-rules', MON)!.trading!.entries).toBe(entries);
    }
    // A correction keeps the log first copied, so it counts against that log.
    const state = review(withTrading(), MON, { daySession: day() });
    expect(() => review(state, MON, { entries: 0, daySession: day({ entries: [] }) })).toThrow(
      /below the 2 logged/,
    );
    // Without a log, any count from 0 to 99 is the user's own.
    expect(() => review(withTrading(), MON, { entries: 0 })).not.toThrow();
  });

  it('keeps entries taken outside the rules in the review, validated strictly', () => {
    const taken: EntrySnapshot = {
      ...entry('add', '2026-11-09T15:20:00.000Z'),
      permission: null,
      zone: false,
      withBias: false,
      outsideRules: ['done', 'conditions'],
    };
    const session = day({ entries: [entry('entry', '2026-11-09T15:00:00.000Z'), taken] });
    const state = review(withTrading(), MON, { daySession: session });
    const saved = candleReview(state, 'trade-rules', MON)!;
    expect(saved.trading!.entryLog).toEqual(session.entries);
    expect(decodeState(JSON.parse(JSON.stringify(state))).ruleReviews).toEqual(state.ruleReviews);
    const bad = (over: Record<string, unknown>) => () =>
      decodeState(
        JSON.parse(
          JSON.stringify({
            ...state,
            ruleReviews: [
              {
                ...saved,
                trading: {
                  ...saved.trading,
                  entryLog: [saved.trading!.entryLog![0], { ...taken, ...over }],
                },
              },
            ],
          }),
        ),
      );
    // An unconfirmed condition needs the conditions named; a rule-following entry names none.
    expect(bad({ outsideRules: ['done'] })).toThrow(/conditions and rules disagree/);
    expect(bad({ outsideRules: undefined })).toThrow(/conditions and rules disagree/);
    expect(
      bad({
        permission: 'cisd',
        zone: true,
        withBias: undefined,
        outsideRules: ['conditions'],
      }),
    ).toThrow(/conditions and rules disagree/);
    expect(bad({ outsideRules: [] })).toThrow(/outside the rules/);
    expect(bad({ outsideRules: ['done', 'done', 'conditions'] })).toThrow(/outside the rules/);
    expect(bad({ outsideRules: ['bored', 'conditions'] })).toThrow(/outside the rules/);
    expect(bad({ withBias: true })).toThrow(/entry side/);
    expect(bad({ zone: 'no' })).toThrow(/entry condition/);
    expect(bad({ permission: 'hunch' })).toThrow(/entry permission/);
    // Past the limit with every condition confirmed is outside the rules too.
    expect(
      bad({ permission: 'cisd', zone: true, withBias: undefined, outsideRules: ['limit'] }),
    ).not.toThrow();
  });

  it('a correction keeps earlier hard violations and the first copy, and says when', () => {
    const EDITED = new Date(2026, 10, 13, 21, 40).toISOString();
    let state = review(withTrading(), MON, { violations: ['hard-2'], daySession: day() });
    const first = candleReview(state, 'trade-rules', MON)!;
    state = saveTradingReview(
      state,
      {
        date: MON,
        routineId: 'trade-rules',
        session: 'traded',
        answers: all('yes'),
        violations: ['hard-5'],
        entries: 2,
        failedTheses: 0,
        note: '',
        daySession: day({ entries: undefined, thesis: { ...thesis, zone: 'A moved zone' } }),
      },
      'unused',
      EDITED,
    );
    const corrected = candleReview(state, 'trade-rules', MON)!;
    expect(corrected.id).toBe(first.id);
    expect(corrected.at).toBe(first.at);
    // The violations the session log points to are recorded with the first save, whatever was
    // ticked, and stay; a correction adds to them.
    expect(first.violations).toEqual([
      VIOLATION_IDS.unplannedAdd,
      VIOLATION_IDS.noNamedSetup,
      'hard-2',
    ]);
    expect(corrected.violations).toEqual([
      VIOLATION_IDS.unplannedAdd,
      VIOLATION_IDS.noNamedSetup,
      'hard-2',
      'hard-5',
    ]);
    expect(corrected.trading!.thesis).toEqual(thesis);
    expect(corrected.trading!.entryLog).toEqual(day().entries);
    expect(corrected.editedAt).toBe(EDITED);
    expect(reviewEditedText(corrected)).toBe('Review edited Fri, Nov 13, 9:40 PM');
    expect(reviewEditedText(first)).toBeNull();
    // A phone clock moved back since never puts a correction before the first save.
    const back = saveTradingReview(
      state,
      {
        date: MON,
        routineId: 'trade-rules',
        session: 'traded',
        answers: all('yes'),
        violations: [],
        entries: 2,
        failedTheses: 0,
        note: '',
      },
      'unused',
      new Date(2026, 10, 9, 21, 40).toISOString(),
    );
    expect(candleReview(back, 'trade-rules', MON)!.editedAt).toBe(first.at);
    expect(sessionResult(corrected, tradingBook(state)!.trading!)).toBe('broken');
  });

  it('rejects a malformed session log or correction time in saved data', () => {
    const state = review(withTrading(), MON, { daySession: day() });
    const saved = state.ruleReviews[0];
    const bad = (r: Partial<RuleReview>) => () =>
      decodeState(JSON.parse(JSON.stringify({ ...state, ruleReviews: [{ ...saved, ...r }] })));
    const trading = saved.trading!;
    expect(bad({ trading: { ...trading, thesis: { ...thesis, objective: '' } } })).toThrow(
      /thesis objective/,
    );
    expect(
      bad({ trading: { ...trading, entryLog: [entry('add', '2026-11-09T15:00:00.000Z')] } }),
    ).toThrow(/entry kind/);
    expect(
      bad({
        trading: {
          ...trading,
          entryLog: [
            entry('entry', '2026-11-09T15:20:00.000Z'),
            entry('add', '2026-11-09T15:00:00.000Z'),
          ],
        },
      }),
    ).toThrow(/out of order/);
    expect(
      bad({ trading: { ...trading, session: 'no-trade', entries: null, failedTheses: null } }),
    ).toThrow(/session log/);
    expect(
      bad({ trading: { ...trading, entryLog: Array(100).fill(entry('add', STARTED)) } }),
    ).toThrow(/logged entry list/);
    expect(bad({ editedAt: '2026-11-01T00:00:00.000Z' })).toThrow(/review correction/);
    expect(bad({ editedAt: 'yesterday' })).toThrow(/review correction/);
    expect(bad({ editedAt: AT })).not.toThrow();
  });

  it('counts reviewed days and every hard violation recorded, for Progress', () => {
    let state = open(withTrading(), MON);
    state = review(state, MON, { violations: ['hard-1', 'hard-2'] });
    state = review(state, '2026-11-10');
    state = review(state, '2026-11-11', { violations: ['hard-2'] });
    state = review(state, '2026-11-12', { session: 'away', answers: {} });
    const s = tradingSummary(state, tradingBook(state)!, TODAY);
    expect(s).toMatchObject({ clean: 1, broken: 2, reviewed: 3, violationsRecorded: 3 });
  });
});

describe('a lost account set', () => {
  const at = new Date(2026, 10, 13, 18).toISOString();

  it('pauses live trading for 30 days, with the trading objective', () => {
    const state = loseAccountSet(open(withTrading(), TODAY), 'trade-rules', at);
    const book = tradingBook(state)!;
    expect(book.trading!.fundedSetLost).toEqual({ at, until: '2026-12-13' });
    expect(accountSetPause(book.trading, TODAY)).toBe('2026-12-13');
    expect(accountSetPause(book.trading, '2026-12-12')).toBe('2026-12-13');
    expect(accountSetPause(book.trading, '2026-12-13')).toBeNull();
    expect(accountSetPauseLine('2026-12-13')).toBe('Live trading paused until Sun, Dec 13.');
    // Paused as a pause in Programs is: today's planned objective goes, its history stays.
    expect(tradingPaused(state, book)).toBe(true);
    expect(state.days[TODAY].blocks.some((b) => b.routineId === 'trade-rules')).toBe(false);
    // Reported again during the pause, nothing changes.
    expect(loseAccountSet(state, 'trade-rules', new Date(2026, 10, 20).toISOString())).toBe(state);
    // It is kept in a backup like the rest of the profile.
    expect(tradingBook(decodeState(JSON.parse(JSON.stringify(state))))!.trading).toEqual(
      book.trading,
    );
    expect(() => loseAccountSet(base(), 'trade-rules', at)).toThrow(/Set up Trading/);
  });

  it('cannot be resumed from the app before its date', () => {
    const state = loseAccountSet(withTrading(), 'trade-rules', at);
    const program = state.programs.find((p) => p.id === 'trading')!;
    const routine = program.routines[0];
    const resume = (now: string) =>
      upsertRoutine(state, program, { ...routine, enabled: true }, now);
    expect(() => resume(new Date(2026, 11, 12, 23).toISOString())).toThrow(
      'Live trading is paused until Sun, Dec 13.',
    );
    const resumed = resume(new Date(2026, 11, 13, 8).toISOString());
    expect(tradingPaused(resumed, tradingBook(resumed)!)).toBe(false);
    // Other edits while paused are kept, and so is the record of the lost set.
    const renamed = upsertRoutine(state, program, { ...routine, title: 'Trading rules' }, at);
    expect(tradingBook(renamed)!.trading!.fundedSetLost).toEqual({ at, until: '2026-12-13' });
  });

  it('refuses a malformed pause in saved data', () => {
    const state = loseAccountSet(withTrading(), 'trade-rules', at);
    const profile = tradingBook(state)!.trading!;
    for (const fundedSetLost of [{ at }, { at: 'soon', until: '2026-12-13' }, 'yes'])
      expect(() =>
        saveTradingProfile(
          state,
          'trade-rules',
          { ...profile, fundedSetLost } as unknown as TradingProfile,
          at,
        ),
      ).toThrow(/account set pause/);
  });
});

describe('profit limits on the live screens', () => {
  it('names a ceiling, target, quota, payout or +$ amount, and nothing else', () => {
    const limit = (label: string, value: string) => ({ id: 'l', label, value });
    for (const l of [
      limit('Profit ceiling', '+$300 per day · stop trading'),
      limit('Profit target', 'A ceiling, not a quota'),
      limit('Near the payout', 'Protect the day'),
      limit('Near +$500', 'Reduce new risk'),
      limit('Daily stop', 'Stop at +$ 250'),
    ])
      expect(profitLimit(l)).toBe(true);
    for (const l of [
      limit('Maximum daily loss', '$300'),
      limit('Maximum risk per thesis', '$150'),
      limit('Entries', '1 ideal · 2 maximum'),
      limit('Instrument', 'An example contract'),
    ])
      expect(profitLimit(l)).toBe(false);
  });

  it('keeps the profit-target rule and the account-set rule in the built-in risk rules', () => {
    expect(RISK_PRINCIPLES).toContain('Never take an extra trade to reach a profit target.');
    expect(RISK_PRINCIPLES).toContain(
      'If this account set is lost, live trading is paused for 30 days.',
    );
    const profile = defaultTradingProfile(MON);
    expect(profile.checklist[7].details).toBe(
      'Stopped when conditions no longer justified trading or a hard limit was reached. Never took an extra trade to reach a profit target.',
    );
    expect(profile.violations.find((v) => v.id === 'hard-8')!.title).toBe(
      'Took an extra trade to reach a profit target',
    );
    expect(JSON.stringify(profile)).not.toMatch(/ceiling/i);
  });
});

describe('re-importing the setup onto a process already on the device', () => {
  /** A device process from before: the old wording, 13 violations and its own limits. */
  function olderDevice(): State {
    const state = withTrading();
    const profile = tradingBook(state)!.trading!;
    const older: TradingProfile = {
      ...profile,
      checklist: profile.checklist.map((c, i) => (i ? c : { ...c, title: 'Prepared levels' })),
      violations: profile.violations.slice(0, 13),
      limits: [{ id: 'limit-1', label: 'Entries', value: 'Set on the device' }],
    };
    delete older.maxEntries;
    return review(saveTradingProfile(state, 'trade-rules', older, AT), MON, {
      violations: ['hard-13'],
    });
  }
  const file = (over: Partial<TradingProfile> = {}) =>
    JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: base().programs.filter((p) => p.id === 'trading'),
      ruleBooks: [
        {
          ...base().ruleBooks[0],
          trading: {
            ...defaultTradingProfile('2026-01-01'),
            maxEntries: 3,
            limits: [{ id: 'limit-1', label: 'Entries', value: 'From the file' }],
            ...over,
          },
        },
      ],
    });
  const LATER = new Date(2026, 10, 13, 18).toISOString();

  it('updates item wording by ID and adds new violations, keeping the rest of the device', () => {
    const device = olderDevice();
    const next = parseSetup(file(), device, LATER);
    const profile = tradingBook(next)!.trading!;
    expect(profile.checklist[0].title).toBe('Prepared the thesis');
    expect(profile.violations.map((v) => v.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `hard-${i + 1}`),
    );
    expect(profile.limits).toEqual([
      { id: 'limit-1', label: 'Entries', value: 'Set on the device' },
    ]);
    expect(profile.since).toBe(tradingBook(device)!.trading!.since);
    // The device had no entry limit, so the file's applies.
    expect(profile.maxEntries).toBe(3);
    expect(tradingBook(next)!.updatedAt).toBe(LATER);
    expect(next.ruleReviews).toEqual(device.ruleReviews);
    // Importing the same file again changes nothing.
    expect(parseSetup(file(), next, LATER).ruleBooks).toEqual(next.ruleBooks);
  });

  it('never removes a violation or replaces an entry limit set in the app', () => {
    const device = olderDevice();
    const profile = tradingBook(device)!.trading!;
    const own = saveTradingProfile(
      device,
      'trade-rules',
      {
        ...profile,
        maxEntries: 1,
        violations: [...profile.violations, { id: 'hard-own', title: 'My own', details: '' }],
      },
      AT,
    );
    const fewer = file({ violations: defaultTradingProfile(TODAY).violations.slice(0, 2) });
    const next = tradingBook(parseSetup(fewer, own, LATER))!.trading!;
    expect(next.maxEntries).toBe(1);
    // A process without the counter-bias violation gets it appended, after the device's own.
    expect(next.violations.map((v) => v.id)).toEqual([
      ...profile.violations.map((v) => v.id),
      'hard-own',
      'hard-14',
    ]);
    expect(next.violations.at(-1)!.title).toBe('Traded against my daily bias');
  });

  it('refuses a malformed process in the file before anything changes', () => {
    expect(() => parseSetup(file({ maxEntries: 0 }), olderDevice(), LATER)).toThrow(/entry limit/);
  });

  it('previews exactly what the import changes in the process', () => {
    const device = olderDevice();
    const preview = previewSetup(file(), device, LATER);
    const before = tradingBook(device)!.trading!;
    const after = tradingBook(parseSetup(file(), device, LATER))!.trading!;
    expect(after.checklist[0].title).toBe('Prepared the thesis');
    expect(preview.tradingUpdated).toEqual({
      reworded: 1,
      violationsAdded: after.violations.length - before.violations.length,
      maxEntries: 3,
      instrument: null,
      risk: [],
    });
    expect(preview.tradingUpdated!.violationsAdded).toBe(7);
    // The rulebook is changed, so it is not counted among the records left alone.
    expect(preview.recordsKept.rulebooks).toBe(0);
    expect(preview.tradingAdded).toBe(0);
    // Importing it again changes nothing, and says so.
    const again = previewSetup(file(), parseSetup(file(), device, LATER), LATER);
    expect(again.tradingUpdated).toBeNull();
    expect(again.recordsKept).toEqual({ plans: 0, circuits: 0, rulebooks: 1 });
  });

  it('never turns live trading on from a file, and keeps the risk per trade', () => {
    // A new process from the file: everything but the live trading switch.
    const fresh = JSON.stringify({
      format: 'life-os-setup-v1',
      goals: [],
      programs: base().programs.filter((p) => p.id === 'trading'),
      ruleBooks: [
        {
          ...tradingBook(withTrading())!,
          trading: {
            ...tradingBook(withTrading())!.trading!,
            liveTrading: true,
            risk: { tradeRisk: 100, maxContracts: 5, thesisRisk: 150, dailyLoss: 300 },
          },
        },
      ],
    });
    const device = open({ ...base(), ruleBooks: [] }, '2026-11-02');
    const imported = tradingBook(parseSetup(fresh, device, AT))!.trading!;
    expect(imported.liveTrading).toBeUndefined();
    expect(imported.risk?.tradeRisk).toBe(100);
    // A process on the device keeps its own switch and its risk per trade while the file fills
    // in a limit it lacks.
    const own = saveTradingProfile(
      withTrading(),
      'trade-rules',
      {
        ...tradingBook(withTrading())!.trading!,
        risk: { tradeRisk: 80, maxContracts: null, thesisRisk: null, dailyLoss: null },
      },
      AT,
    );
    const merged = tradingBook(
      parseSetup(
        file({ liveTrading: true, risk: { maxContracts: 4, thesisRisk: null, dailyLoss: null } }),
        own,
        LATER,
      ),
    )!.trading!;
    expect(merged.liveTrading).toBeUndefined();
    expect(merged.risk).toEqual({
      tradeRisk: 80,
      maxContracts: 4,
      thesisRisk: null,
      dailyLoss: null,
    });
  });

  it("applies the file's entry limit to a process enabled in the app", () => {
    const device = withTrading();
    expect(tradingBook(parseSetup(file(), device, LATER))!.trading!.maxEntries).toBe(3);
    expect(previewSetup(file(), device, LATER).tradingUpdated?.maxEntries).toBe(3);
  });
});
