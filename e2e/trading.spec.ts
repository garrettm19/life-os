import { test, expect, type Page } from '@playwright/test';
import type { State } from '../src/domain/model';
import { saveRuleReview } from '../src/domain/rules';
import { ensureChecklistDay } from '../src/domain/planner';
import { withDay } from '../src/domain/data';
import { saveTradingReview } from '../src/domain/trading';
import { endSession } from '../src/domain/trading-live';
import { logTakenAttempt } from '../src/domain/trading-status';
import { saved, savedSession as savedCandle, seed } from './support/storage';
import {
  answerReview,
  begun,
  cockpitState,
  expectStatus,
  planned,
  status,
} from './support/cockpit';
import { TRADING_ROUTINE, tradingState } from './support/trading-state';
import { legacyEntry, legacySession } from '../src/test-support/legacy-trading';

// The browser runs in New York time, so its local day and the market clock
// agree; the clock is pinned to Monday, November 9, 2026 at 10:00 AM, inside the 9:30 AM window.
// Most tests use the generic trading routine with written limits only (no instrument): the
// cockpit says what is missing where it needs the numbers.
// The cockpit is a native screen: an iPhone 13's full 390 × 844 points, where the status band
// says its reason itself (the smallest phones are in e2e/layout.spec.ts).
test.use({ timezoneId: 'America/New_York', viewport: { width: 390, height: 844 } });

const MON = '2026-11-09';
const MIN = 60_000;
const NY_10AM = new Date('2026-11-09T15:00:00Z');
const at = (minutes: number) => new Date(NY_10AM.getTime() + minutes * MIN).toISOString();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Seeds the plan (with any sessions in it), then opens `route`. */
async function open(page: Page, state: State, route = '/', { clock = NY_10AM } = {}) {
  await seed(page, state, { clock, route });
}

const savedSession = (page: Page) => savedCandle(page, MON);
const review = (state: State) =>
  state.ruleReviews.find((r) => r.routineId === TRADING_ROUTINE && r.date === MON && r.trading);
const profile = () =>
  tradingState().ruleBooks.find((b) => b.routineId === TRADING_ROUTINE)!.trading!;
/** Monday's session started at 9:40 AM with the example limits: waiting for the zone. */
const started = () => begun(cockpitState(), at(-20), {}, at(-25));

async function answerAll(page: Page, answer: 'pass' | 'fail') {
  await answerReview(page, answer);
}

test("Today's row opens the cockpit at the same status; limits and rules one tap away", async ({
  page,
}) => {
  await open(page, tradingState());
  const row = page.getByTestId('row:Follow my trading rules');
  // The objective is one row at its place in the list, never a card above it.
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('trading-today')).toHaveCount(0);
  await expect(row.getByTestId('trading-caption')).toHaveText(
    /^Set today's daily bias\s*No trade — preparation incomplete$/,
  );
  await row.getByRole('button', { name: /^Open Follow my trading rules\./ }).click();
  await expect(page.getByRole('heading', { name: 'Trading', exact: true })).toBeVisible();
  await expectStatus(page, 'NO TRADE — PREPARATION INCOMPLETE');
  // No limit is assumed: what is missing is named, and entries are blocked until it is set.
  await expect(page.getByTestId('preparation')).toContainText(
    'Not set: risk per trade, thesis risk, daily loss limit, contract limit, instrument. Entries are blocked until they are.',
  );
  // The limits open from Preparation; the written ones are notes the app never checks.
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await expect(page.getByLabel('Notes · not checked by the app', { exact: true })).toHaveValue(
    /\$40 per account/,
  );
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByText(/cannot see your accounts/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open Rules & GEX/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/trading-start.png' });
  // Nothing about the session was saved into the plan: the review is the record.
  expect(review(await saved(page))).toBeUndefined();
});

test('Your limits takes the instrument and the numeric risk limits, all or nothing', async ({
  page,
}) => {
  await open(page, tradingState(), '/trading');
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Instrument', { exact: true }).fill('Example index');
  await page.getByLabel('Point value · $', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByText('Enter the instrument, its point value and its tick, or leave all three blank.'),
  ).toBeVisible();
  await page.getByLabel('Tick', { exact: true }).fill('0.25');
  await page.getByLabel('Contracts at most', { exact: true }).fill('5');
  // Risk is counted to the cent: a dollar limit with a fraction of a cent is refused.
  await page.getByLabel('Thesis budget · $', { exact: true }).fill('150.555');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByText('Enter the thesis budget in dollars to the cent, or leave it blank.'),
  ).toBeVisible();
  await page.getByLabel('Thesis budget · $', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toContainText(
    'Not set: risk per trade, daily loss limit.',
  );
  // A limit left blank is saved as not set, never as a default.
  expect((await saved(page)).ruleBooks.at(-1)!.trading).toMatchObject({
    instrument: { name: 'Example index', pointValue: 2, tick: 0.25 },
    risk: { tradeRisk: null, maxContracts: 5, thesisRisk: 150, dailyLoss: null },
    accounts: 1,
  });
});

test('a new session waits for the last session that ran to be reviewed', async ({ page }) => {
  // Friday's session ran (started at 9:40 AM) and was never reviewed.
  const friday = begun(cockpitState(), '2026-11-06T14:40:00.000Z');
  await open(page, planned(friday, at(-25)), '/trading');
  await expectStatus(page, 'NO TRADE — REVIEW YOUR LAST SESSION');
  await expect(status(page)).toContainText('The session of Fri, Nov 6 has no review yet.');
  // The plan stays readable, but the session never starts.
  await expect(page.getByRole('button', { name: /^I'm ready: calm/ })).toBeDisabled();
  // Reviewing it, with a hard violation, makes Monday study only: practice, never live.
  await page.getByRole('button', { name: 'Review Fri, Nov 6 first', exact: true }).click();
  await expect(page.getByRole('radio', { name: /: pass$/ })).toHaveCount(8);
  await answerAll(page, 'pass');
  await page.getByRole('button', { name: /^Record violation/ }).click();
  await page.getByRole('checkbox', { name: 'Widened a stop', exact: true }).click();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expectStatus(page, "NOT STARTED — TAP I'M READY");
  await expect(
    page.getByText(/Study-only day after a hard violation on Fri, Nov 6\./),
  ).toBeVisible();
  await page.getByRole('button', { name: /^I'm ready: calm/ }).click();
  expect((await savedSession(page))!.lock!.mode).toBe('practice');
});

test('a session an earlier build left with a trade open is reviewed, and the next one starts', async ({
  page,
}) => {
  // Friday's session from the earlier cockpit, its entry never given an outcome (nothing records
  // one any more).
  const FRI = '2026-11-06';
  const friday = {
    ...legacySession(FRI, {
      evening: '2026-11-05T23:30:00.000Z',
      open: '2026-11-06T14:40:00.000Z',
    }),
    entries: [legacyEntry('2026-11-06T14:50:00.000Z')],
  };
  const state = { ...cockpitState(), tradingSessions: { [FRI]: friday } };
  await open(page, planned(state, at(-25)), '/trading');
  await expectStatus(page, 'NO TRADE — REVIEW YOUR LAST SESSION');
  await page.getByRole('button', { name: 'Review Fri, Nov 6 first', exact: true }).click();
  // Not followed to plan: the entry has no outcome.
  await expect(
    page.getByRole('radio', {
      name: 'Followed my planned normal/runner management: no',
      exact: true,
    }),
  ).toHaveAttribute('aria-checked', 'true');
  await answerAll(page, 'pass');
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expectStatus(page, "NOT STARTED — TAP I'M READY");
});

test('a study-only day follows a hard violation on the previous trading day', async ({ page }) => {
  // Friday, Nov 6 was reviewed with a hard violation; Monday is the next scheduled trading day.
  const state = saveTradingReview(
    tradingState(),
    {
      date: '2026-11-06',
      routineId: TRADING_ROUTINE,
      session: 'traded',
      answers: Object.fromEntries(profile().checklist.map((c) => [c.id, 'yes' as const])),
      violations: ['hard-2'],
      entries: null,
      failedTheses: null,
      note: '',
    },
    'friday',
    new Date('2026-11-07T01:00:00Z').toISOString(),
  );
  await open(page, state, '/trading');
  // The day is practice only, said on the band and in words.
  await expect(status(page)).toContainText('PRACTICE');
  await expect(
    page.getByText(/Study-only day after a hard violation on Fri, Nov 6\./),
  ).toBeVisible();
  // Progress leads with honesty: the reviewed days and every violation recorded.
  await expect(page.getByLabel('Rule-clean days: 0 of 1 reviewed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Hard violations recorded: 1', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Recording every violation is what keeps this useful.'),
  ).toBeVisible();
  // Friday's review says what follows it.
  await page.goto('/trading?date=2026-11-06');
  await expect(page.getByTestId('trading-status')).toContainText(
    'The next trading day is study only.',
  );
  await page.goto('/trading');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'No trade taken', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the review reads the session: attempts, Recorded facts and the violations they point to', async ({
  page,
}) => {
  // A long taken outside the cockpit with a stop after the session's hard stop, then reported.
  let state = endSession(started(), TRADING_ROUTINE, 'hard-stop', at(5));
  state = logTakenAttempt(
    state,
    TRADING_ROUTINE,
    { side: 'long', entry: 25040, stop: 25030, contracts: 1 },
    at(10),
  );
  await open(page, state, '/trading', { clock: new Date(NY_10AM.getTime() + 15 * MIN) });
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  await page.getByRole('button', { name: 'Closed flat, breakeven or better', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  await expect(page.getByTestId('review-recorded')).toContainText(
    '1 thesis · 1 attempt · 1 failed · 1 taken outside the cockpit',
  );
  const entries = page.getByLabel('Entries taken · optional', { exact: true });
  await expect(entries).toHaveValue('1');
  // A session started: there is no day away to choose.
  await expect(
    page.getByRole('button', { name: 'Planned day away from trading', exact: true }),
  ).toHaveCount(0);
  // What the records point to is ticked and cannot be unticked.
  for (const name of ['Traded after the hard stop', 'Entered without a named setup']) {
    const box = page.getByRole('checkbox', {
      name: `${name}, recorded from the session`,
      exact: true,
    });
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect(box).toBeDisabled();
  }
  await answerAll(page, 'pass');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  const result = page.getByTestId('review-result');
  await expect(result).toContainText('Rule-broken session');
  await expect(result).toContainText('The next trading day is study only.');
  const first = review(await saved(page))!;
  expect(first.violations).toEqual(['hard-7', 'hard-20']);
  expect(first.trading).toMatchObject({ session: 'traded', entries: 1 });
  // A correction keeps them recorded, as saved.
  await page.getByRole('button', { name: 'Correct the review', exact: true }).click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Traded after the hard stop, recorded earlier',
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(result).toContainText(/Review edited Mon, Nov 9, 10:\d\d AM/);
  expect(review(await saved(page))).toMatchObject({ violations: ['hard-7', 'hard-20'] });
});

test('the review needs every answer; a hard violation makes 8/8 rule-broken', async ({ page }) => {
  // Opening Today puts the trading objective on the plan.
  await open(page, tradingState());
  await expect(page.getByTestId('row:Follow my trading rules')).toHaveCount(1);
  await page.goto('/trading');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  const save = page.getByRole('button', { name: /^Save review/ });
  await expect(save).toBeDisabled();
  // Eight items and six discipline answers: nothing is assumed without a session to read.
  await expect(page.getByText('14 left to answer', { exact: true })).toBeVisible();
  await answerAll(page, 'pass');
  await expect(save).toBeEnabled();
  await expect(page.getByText('Process score 8/8', { exact: true })).toBeVisible();
  await expect(page.getByText('Discipline: 6 of 6 Yes', { exact: true })).toBeVisible();
  await expect(page.getByText('Clean session', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Record violation/ }).click();
  await page.getByRole('checkbox', { name: 'Widened a stop', exact: true }).click();
  await expect(page.getByText('Rule-broken session', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Every item is PASS, but a hard violation is recorded/),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/trading-review.png' });
  await page.getByLabel('Entries taken · optional', { exact: true }).fill('2');
  await save.click();
  const result = page.getByTestId('review-result');
  await expect(result).toContainText('8/8');
  await expect(result).toContainText('Rule-broken session');
  await expect(result).toContainText('The next trading day is study only.');
  await expect(result).not.toContainText('Tomorrow starts clean.');
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText('The day is reviewed.');
  const state = await saved(page);
  expect(review(state)).toMatchObject({
    outcome: 'reviewed',
    violations: ['hard-2'],
    trading: { session: 'traded', entries: 2, failedTheses: null },
  });
  expect(review(state)!.answers.every((a) => a.answer === 'yes')).toBe(true);
  // The objective is done because the review is done, not because the rules were followed.
  expect(state.days[MON].blocks.find((b) => b.routineId === TRADING_ROUTINE)!.status).toBe('done');
  // Correcting it updates the one review: the earlier violation stays, a new one can be added.
  await page.getByRole('button', { name: 'Correct the review', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Widened a stop, recorded earlier', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Averaged into a losing trade', exact: true }).click();
  await page.getByRole('button', { name: /^Save review/ }).click();
  await expect(result).toContainText('2 hard violations');
  await expect(result).toContainText(/Review edited Mon, Nov 9/);
  const after = await saved(page);
  expect(after.ruleReviews.filter((r) => r.trading)).toHaveLength(1);
  expect(review(after)).toMatchObject({ violations: ['hard-2', 'hard-3'] });
  expect(review(after)!.editedAt).toEqual(expect.any(String));
});

test('a deliberate no-trade day can be clean; a planned day away is not scored', async ({
  page,
}) => {
  await open(page, tradingState(), '/trading');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  await page.getByRole('radio', { name: 'No trade taken', exact: true }).click();
  await answerAll(page, 'pass');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(
    page.getByText('Rules followed. No valid setup, no trade: that is a win.'),
  ).toBeVisible();
  await expect(page.getByLabel('Clean-session streak 1, best 1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Rule-clean days: 1 of 1 reviewed', { exact: true })).toBeVisible();
  // A reviewed session cannot be turned into a day away: its answers can only be corrected.
  await page.getByRole('button', { name: 'Correct the review', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Planned day away from trading', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  // An earlier trading day can be recorded as a planned day away: unscored, nothing invented.
  await page.getByTestId('trading-day:2026-11-06').click();
  await page.getByRole('button', { name: 'Review this day', exact: true }).click();
  await page.getByRole('button', { name: 'Planned day away from trading', exact: true }).click();
  // The day stays selected, now with what was recorded.
  await expect(page.getByText('Fri, Nov 6 · planned day away', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Clean-session streak 1, best 1', { exact: true })).toBeVisible();
  const away = (await saved(page)).ruleReviews.find((r) => r.date === '2026-11-06')!;
  expect(away).toMatchObject({ outcome: 'none', answers: [], trading: { session: 'away' } });
  expect(away.trading!.discipline).toBeUndefined();
});

test('Progress links to Trading progress and repeats no rules section', async ({ page }) => {
  await open(page, tradingState(), '/review');
  const link = page.getByTestId('trading-review-link');
  await expect(link).toContainText('No session reviewed yet');
  // Trading's numbers are on Trading only: no rule-adherence section repeats them here.
  await expect(page.getByRole('button', { name: /^Rules/ })).toHaveCount(0);
  await link.click();
  await expect(page.getByText('Progress · last 4 weeks', { exact: true })).toBeVisible();
  // Nothing recorded yet: one line, not a dash, zeros and an empty calendar.
  await expect(page.getByTestId('trading-progress-empty')).toHaveText(
    'No reviewed sessions in the last 4 weeks.',
  );
  await expect(page.getByTestId(/^trading-day:/)).toHaveCount(0);
  await expect(page.getByText('Clean streak', { exact: true })).toHaveCount(0);
});

test('the calendar runs Monday to Sunday, blank before tracking, with today outlined', async ({
  page,
}) => {
  // Tracking started Monday, Nov 2; today is Monday, Nov 9, reviewed as a no-trade session.
  await open(page, tradingState(), '/trading');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  await page.getByRole('radio', { name: 'No trade taken', exact: true }).click();
  await answerAll(page, 'pass');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  // Four rows from Monday, Oct 19, through today; the rest of this week is empty.
  const days = page.getByTestId(/^trading-day:/);
  await expect(days).toHaveCount(22);
  await expect(days.first()).toHaveAttribute('data-testid', 'trading-day:2026-10-19');
  const first = (await days.first().boundingBox())!;
  const today = (await page.getByTestId(`trading-day:${MON}`).boundingBox())!;
  expect(Math.abs(first.x - today.x)).toBeLessThan(1);
  await expect(
    page.getByRole('button', {
      name: 'Mon, Oct 26 · before trading tracking started',
      exact: true,
    }),
  ).toBeVisible();
  // A weekend day and a trading weekday never opened read the same, and neither is called a
  // day off: the record cannot tell them apart.
  for (const day of ['Sat, Nov 7', 'Tue, Nov 3'])
    await expect(
      page.getByRole('button', {
        name: `${day} · not a trading day or not opened, nothing recorded`,
        exact: true,
      }),
    ).toBeVisible();
  await expect(page.getByText(/· nothing to review$/)).toBeVisible();
  // A past day's page still links to the rules.
  await page.goto('/trading?date=2026-11-06');
  await expect(page.getByText('Fri, Nov 6', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open Rules & GEX/ })).toBeVisible();
});

test('a paused process reads as a choice, not an alarm', async ({ page }) => {
  const paused = tradingState();
  paused.programs = paused.programs.map((p) => ({
    ...p,
    routines: p.routines.map((r) => (r.id === TRADING_ROUTINE ? { ...r, enabled: false } : r)),
  }));
  await open(page, paused, '/trading');
  await expect(page.getByText(/Trading is paused in Programs\./)).toBeVisible();
  // PRACTICE in the band's dark ink on the amber fill of a hold (dark `bandWait`), never the
  // danger color (#E08A76) or the stop's coral.
  const tag = status(page).getByText('PRACTICE', { exact: true });
  expect(await tag.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(26, 22, 17)');
  expect(await status(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(245, 181, 68)',
  );
  await expect(page.getByTestId('trading-progress-empty')).toHaveText(
    'No reviewed sessions in the last 4 weeks. Live trading is paused.',
  );
});

test('setting up keeps the earlier rulebook and its reviews exactly', async ({ page }) => {
  let state = tradingState(null);
  state = withDay(
    state,
    ensureChecklistDay(
      '2026-11-06',
      state.settings,
      state.programs,
      undefined,
      new Date(2026, 10, 6, 8).toISOString(),
    ),
  );
  state = saveRuleReview(
    state,
    {
      date: '2026-11-06',
      routineId: TRADING_ROUTINE,
      outcome: 'reviewed',
      answers: [{ checkpointId: 'checkpoint-1', answer: 'na' }],
      violations: [],
      note: 'an earlier review',
    },
    'earlier',
    new Date(2026, 10, 6, 20).toISOString(),
  );
  await open(page, state, '/trading');
  await page
    .getByRole('button', { name: 'Set up trading discipline for Trading rules', exact: true })
    .click();
  await expect(status(page)).toBeVisible();
  const after = await saved(page);
  expect(after.ruleReviews).toEqual(state.ruleReviews);
  expect(after.ruleBooks[0].checkpoints).toEqual(state.ruleBooks[0].checkpoints);
  expect(after.ruleBooks[0].trading!.since).toBe(MON);
  // No instrument or risk limit is set for the user: those are theirs to enter.
  expect(after.ruleBooks[0].trading!.instrument).toBeUndefined();
  expect(after.ruleBooks[0].trading!.risk).toBeUndefined();
  // The earlier review shows as older, never as a score.
  await page.getByTestId('trading-day:2026-11-06').click();
  await expect(page.getByText(/earlier rule review, not scored/)).toBeVisible();
});

test('a rule-broken review without a hard violation says only that the review counts', async ({
  page,
}) => {
  await open(page, tradingState(), '/trading');
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  await page.getByRole('radio', { name: 'No trade taken', exact: true }).click();
  await answerAll(page, 'pass');
  await page.getByRole('radio', { name: 'Waited for location: fail', exact: true }).click();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  const result = page.getByTestId('review-result');
  await expect(result).toContainText('Rule-broken session');
  await expect(result).toContainText('The review is what counts.');
  await expect(result).not.toContainText('Tomorrow');
});

test('a lost account set pauses live trading for 30 days, with no early resume', async ({
  page,
}) => {
  await open(page, planned(cockpitState(), at(-30)), '/programs');
  const rule = page.getByTestId('account-set-rule');
  await expect(rule).toContainText(
    'If this account set is lost, live trading is paused for 30 days.',
  );
  await rule.getByRole('button', { name: /^Account set lost/ }).click();
  await page
    .getByRole('button', { name: 'Pause live trading until Wed, Dec 9', exact: true })
    .click();
  await expect(rule).toHaveText('Live trading paused until Wed, Dec 9.');
  const book = (await saved(page)).ruleBooks.find((b) => b.routineId === TRADING_ROUTINE)!;
  expect(book.trading!.fundedSetLost).toEqual({ at: expect.any(String), until: '2026-12-09' });
  // The cockpit says until when, and a session can start only as practice.
  await page.goto('/trading');
  await expect(status(page)).toContainText('PRACTICE');
  await expect(page.getByText(/Live trading paused until Wed, Dec 9\./)).toHaveCount(1);
  await page.getByRole('button', { name: /^I'm ready: calm/ }).click();
  expect((await savedSession(page))!.lock!.mode).toBe('practice');
  // Programs refuses to resume the trading objective before then.
  await page.goto('/programs');
  await page
    .getByRole('button', { name: 'Configure Follow my trading rules', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Enabled', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Live trading is paused until Wed, Dec 9.')).toBeVisible();
});

test('an account set lost mid-session ends the session and holds every live entry', async ({
  page,
}) => {
  // The session started at 10:00; at 10:15 the account set is reported lost.
  await open(page, started(), '/programs', { clock: new Date(NY_10AM.getTime() + 15 * MIN) });
  await page
    .getByTestId('account-set-rule')
    .getByRole('button', { name: /^Account set lost/ })
    .click();
  await expect(page.getByText(/a session running now ends as a hard stop/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Pause live trading until Wed, Dec 9', exact: true })
    .click();
  await expect(page.getByTestId('account-set-rule')).toHaveText(
    'Live trading paused until Wed, Dec 9.',
  );
  expect(await savedSession(page)).toMatchObject({ doneReason: 'hard-stop' });
  // The cockpit no longer waits for a setup: the session ended, and the pause is said.
  await page.goto('/trading');
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(page.getByText(/Live trading paused until Wed, Dec 9\./)).toBeVisible();
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  // An entry already taken can still be logged; it keeps the status and the stop it was logged
  // under (the cockpit's own hard stop, so the session's review reads it).
  await page.getByRole('button', { name: 'Log an entry I took', exact: true }).click();
  await page.getByLabel('Entry', { exact: true }).fill('25040');
  await page.getByLabel('Stop · if any', { exact: true }).fill('25030');
  await page.getByLabel('Contracts per account', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Log this entry', exact: true }).click();
  const saved = (await savedSession(page))!;
  expect(saved.attempts![0].taken).toEqual({ status: 'SESSION_STOPPED', stop: 'hard-stop' });
  expect(saved.sessionStop).toMatchObject({ reason: 'hard-stop' });
});

test.describe('east of New York', () => {
  // In Kiritimati (UTC+14) Monday's 9:30 AM window falls on Tuesday's calendar date. The plan and
  // the session are one record, Monday's candle's, whatever the phone's date.
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test('an account set lost ends the session on its candle record', async ({ page }) => {
    await open(page, started(), '/programs', { clock: new Date(NY_10AM.getTime() + 15 * MIN) });
    await page
      .getByTestId('account-set-rule')
      .getByRole('button', { name: /^Account set lost/ })
      .click();
    await page.getByRole('button', { name: /^Pause live trading until/ }).click();
    await expect(page.getByTestId('account-set-rule')).toHaveText(/^Live trading paused until/);
    expect(await savedCandle(page, MON)).toMatchObject({ doneReason: 'hard-stop' });
    expect(await savedCandle(page, '2026-11-10')).toBeNull();
    await page.goto('/trading');
    await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
    await expect(status(page)).toContainText('A hard stop ended the session.');
  });
});
