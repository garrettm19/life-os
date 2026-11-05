import { test, expect, type Page } from '@playwright/test';
import { VIOLATION_IDS, newSession } from '../src/domain/trading';
import { feelRushed, retireThesis } from '../src/domain/trading-live';
import { logTakenAttempt } from '../src/domain/trading-status';
import { saved, seed } from './support/storage';
import {
  LIVE,
  LONG_PLAN,
  begun,
  cockpitState,
  enteredAt,
  expectStatus,
  exited,
  iEntered,
  imReady,
  openCockpit,
  planned,
  profileOf,
  readied,
  rushed,
  savedSession,
  status,
  statusTitle,
  tapSetup,
  typePlan,
  typeRisk,
  saying,
} from './support/cockpit';
import { MON, STATUS_CASES, at, fri, ny } from './support/statuses';
import { TRADING_ROUTINE } from './support/trading-state';

// The trading cockpit driven as the user would: Preparation, one live screen under one status,
// the outcome and the review. Synthetic data only: an example instrument and labelled example
// prices. The browser runs in New York time, so its local day and the market clock agree; Monday,
// November 9, 2026 is standard time (New York = UTC-5). The cockpit is a native screen: an iPhone
// 13's full 390 × 844 points.
test.use({ timezoneId: 'America/New_York', viewport: { width: 390, height: 844 } });

const MIN = 60_000;
const R = TRADING_ROUTINE;
/** The session started at 9:40 AM, waiting for the zone. */
const live = () => begun(cockpitState(), at(9, 40), {}, at(9, 35));
/** The plan's thesis retired by hand at 9:50 AM. */
const retired = (state: ReturnType<typeof live>) => retireThesis(state, R, 't1', at(9, 50));

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Counts the taps and typed fields of a flow, as the user makes them. */
function counter(page: Page) {
  const n = { taps: 0, fields: 0 };
  return {
    n,
    tap: async (target: ReturnType<Page['getByRole']>) => {
      n.taps++;
      await target.click();
    },
    type: async (label: string, value: string) => {
      n.fields++;
      await page.getByLabel(label, { exact: true }).fill(value);
    },
  };
}

test('one normal session: Preparation, I am ready, one trade, the outcome, in few taps', async ({
  page,
}) => {
  await openCockpit(page, { clock: ny(9, 20) });
  await expectStatus(page, 'NO TRADE — PREPARATION INCOMPLETE');
  // Nothing about GEX numbers is asked: the levels live on the chart.
  await expect(page.getByRole('textbox', { name: /GEX/ })).toHaveCount(0);
  const c = counter(page);
  await c.tap(page.getByRole('radio', { name: 'HTF bullish', exact: true }));
  await c.type('Why · one line', LONG_PLAN.why);
  await c.type('Target', '25100');
  await c.type('Invalidation', '24980');
  await c.tap(page.getByRole('button', { name: 'Save plan', exact: true }));
  await expectStatus(page, "NOT STARTED — TAP I'M READY");
  await expect(page.getByTestId('plan-card')).toContainText('Target 25,100 · invalidation 24,980');
  await expect(page.getByTestId('plan-card')).toContainText('Where: My area');
  await page.clock.fastForward(15 * MIN);
  await c.tap(page.getByRole('button', { name: /^I'm ready: calm/ }));
  // Made before the 9:30 AM lock opened: one tap says it still stands (I'm ready never does).
  await expectStatus(page, 'NO ENTRY — CONFIRM YOUR PLAN FOR THIS GEX');
  await c.tap(page.getByRole('button', { name: 'Confirm the plan for this GEX lock' }));
  await expectStatus(page, 'WAITING FOR ZONE');
  // The four indicators and the thesis strip, the bias only on its own tile.
  await expect(page.getByTestId('tile-plan')).toContainText('▲ Bullish');
  await expect(page.getByTestId('tile-target')).toContainText('25,100');
  await expect(page.getByTestId('tile-location')).toContainText('○ NormalMy area');
  await expect(page.getByTestId('tile-risk')).toContainText('$100');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('0/2 attempts · thesis left $150 · loss $0 of $300'),
  );
  await expect(page.getByTestId('thesis-strip')).toContainText('Not broker-verified');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    /Planned · self-reported · not broker-verified\.$/,
  );
  // Practice: live trading is off, said on the band and in words.
  await expect(status(page)).toContainText('PRACTICE');
  await expect(
    page.getByText('Practice only: Live trading is off.', { exact: true }),
  ).toBeVisible();
  // The setup in taps.
  await c.tap(page.getByRole('radio', { name: 'Price at my area', exact: true }));
  await expectStatus(page, 'WAITING FOR SETUP');
  await c.tap(page.getByRole('radio', { name: /^Setup A:/ }));
  await c.tap(page.getByRole('radio', { name: '5 minute chart', exact: true }));
  await expectStatus(page, 'SETUP FORMING');
  await c.tap(page.getByRole('checkbox', { name: 'Setup confirmed', exact: true }));
  await expectStatus(page, 'NO ENTRY — NO STRUCTURAL STOP');
  await expect(page.getByRole('button', { name: 'I entered in my broker' })).toHaveCount(0);
  // Two prices; the contracts are computed from the fixed risk and the stop.
  await c.tap(page.getByRole('button', { name: 'Enter the entry and the structural stop' }));
  await c.type('Entry', '25040');
  await c.type('Stop', '25030');
  await expect(page.getByTestId('risk-size')).toContainText('5 contracts × 1 account');
  await expect(page.getByTestId('risk-size')).toContainText('$100 per account · $100 in all');
  await c.tap(page.getByRole('button', { name: 'Save', exact: true }));
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  await expect(status(page)).not.toContainText(/approved/i);
  await expect(page.getByTestId('tile-risk')).toContainText('5×1 · $100');
  await c.tap(page.getByRole('button', { name: 'I entered in my broker', exact: true }));
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  await c.tap(page.getByRole('button', { name: 'Objective reached', exact: true }));
  await expectStatus(page, 'THESIS COMPLETE — OBJECTIVE REACHED');
  expect(c.n).toEqual({ taps: 12, fields: 5 });
  const session = (await savedSession(page, MON))!;
  expect(session.lock).toMatchObject({ mode: 'practice', limits: { tradeRisk: 100 } });
  expect(session.attempts).toEqual([
    expect.objectContaining({
      side: 'long',
      entry: 25040,
      stop: 25030,
      contracts: 5,
      accounts: 1,
      plannedRisk: 100,
      practice: true,
      exit: expect.objectContaining({ kind: 'objective', result: 'gain' }),
    }),
  ]);
  // The setup was named, on record, before the entry.
  const reading = session.assessments!.find((a) => a.id === session.attempts![0].assessmentId)!;
  expect(reading.setup).toBe('pierce-push');
  expect(reading.at <= session.attempts![0].openedAt).toBe(true);
});

test("the previous candle's plan comes back with one Confirm; the event never does", async ({
  page,
}) => {
  const friday = planned(cockpitState(), fri(9, 0), {
    event: { name: 'CPI', time: '08:30' },
    where: 'Put wall',
  });
  await openCockpit(page, { state: friday, clock: ny(9, 0) });
  const card = page.getByTestId('plan-card');
  await expect(card).toContainText('Carried from Fri, Nov 6 — confirm or change');
  await expect(card).toContainText('Where: Put wall');
  await expect(card).not.toContainText('CPI');
  await page.getByRole('button', { name: 'Confirm the plan carried from Fri, Nov 6' }).click();
  await expectStatus(page, "NOT STARTED — TAP I'M READY");
  expect((await savedSession(page, MON))!.plan).toMatchObject({
    carriedFrom: '2026-11-06',
    where: 'Put wall',
    target: LONG_PLAN.target,
  });
  // Changing it opens the form with the plan as typed.
  await page.getByRole('button', { name: 'Change the plan', exact: true }).click();
  await expect(page.getByLabel('Where · optional', { exact: true })).toHaveValue('Put wall');
});

test('HTF unclear is no trade, and choosing a side again needs no retyping', async ({ page }) => {
  await openCockpit(page, { state: planned(cockpitState(), at(9, 0)), clock: ny(9, 10) });
  await page.getByRole('button', { name: 'Change the plan', exact: true }).click();
  await page.getByRole('radio', { name: 'HTF unclear', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save: no trade', exact: true }).click();
  await expectStatus(page, 'NO TRADE — HTF UNCLEAR');
  await expect(page.getByRole('button', { name: /^I'm ready/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change the HTF plan', exact: true }).click();
  await page.getByRole('radio', { name: 'HTF bullish', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('25100');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expectStatus(page, "NOT STARTED — TAP I'M READY");
});

test('every status reads its title on the band, from the one selector', async ({ page }) => {
  test.setTimeout(120_000);
  const titles: Record<string, string> = {
    LOAD_FAILED: "NO ENTRY — THE SESSION CAN'T BE READ",
    RECONCILE_POSITION: 'RECONCILE OPEN POSITION',
    IN_POSITION: 'IN POSITION — MANAGE TO PLAN',
    SESSION_STOPPED: 'SESSION ENDED — NO FURTHER TRADING',
    UNKNOWN_EXPOSURE: 'NO ENTRY — UNKNOWN EXPOSURE',
    COOLDOWN: 'COOLDOWN — STEP AWAY',
    REVIEW_FIRST: 'NO TRADE — REVIEW YOUR LAST SESSION',
    NO_BIAS: 'NO TRADE — HTF UNCLEAR',
    NO_PLAN: 'NO TRADE — PREPARATION INCOMPLETE',
    NOT_STARTED: "NOT STARTED — TAP I'M READY",
    OUTSIDE_WINDOW: 'WAIT — NO LIVE WINDOW',
    REGIME_RANGE: 'NO ENTRY — RANGE / CHOP',
    THESIS_EXHAUSTED: 'THESIS EXHAUSTED — THIS IDEA IS RETIRED',
    THESIS_COMPLETED: 'THESIS COMPLETE — OBJECTIVE REACHED',
    THESIS_INVALIDATED: 'THESIS INVALIDATED — THIS IDEA IS RETIRED',
    NO_THESIS: 'NO ACTIVE THESIS',
    LINE_BLOCKED: 'NO ENTRY — LINE IS BAITING',
    RESET_ANSWER: 'RESET — IS THE THESIS STILL VALID?',
    SECOND_ATTEMPT_WAIT: 'WAIT — NEW SETUP NEEDED FOR ATTEMPT 2',
    PLAN_RECONFIRM: 'NO ENTRY — CONFIRM YOUR PLAN FOR THIS GEX',
    MISSED: 'MISSED ENTRY — DO NOT CHASE',
    WAITING_ZONE: 'WAITING FOR ZONE',
    WAITING_SETUP: 'WAITING FOR SETUP',
    SETUP_FORMING: 'SETUP FORMING',
    CONFIRMATION_INCOMPLETE: 'CONFIRMATION INCOMPLETE',
    RISK_NEEDED: 'NO ENTRY — NO STRUCTURAL STOP',
    RISK_BLOCKED: 'NO ENTRY — STOP TOO WIDE',
    CHECKS_COMPLETE: 'SETUP CHECKS COMPLETE — SELF-REPORTED',
  };
  for (const [code, title] of Object.entries(titles)) {
    const { state, clock } = STATUS_CASES[code as keyof typeof STATUS_CASES]!();
    await openCockpit(page, { state, clock });
    await expectStatus(page, title);
    // I ENTERED exists only where the checks are complete.
    await expect(
      page.getByRole('button', { name: 'I entered in my broker', exact: true }),
      code,
    ).toHaveCount(code === 'CHECKS_COMPLETE' ? 1 : 0);
    // I FEEL RUSHED is always on screen.
    await expect(rushed(page), code).toBeInViewport();
  }
});

test('brief 1: a strong bias in a range is no entry, and no new thesis while it ranges', async ({
  page,
}) => {
  await openCockpit(page, { state: readied(live(), at(9, 45)), clock: ny(9, 50) });
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  await page.getByRole('radio', { name: 'Range / chop', exact: true }).click();
  await expectStatus(page, 'NO ENTRY — RANGE / CHOP');
  await expect(status(page)).toContainText('The bias does not override it.');
  await expect(page.getByTestId('tile-plan')).toContainText('▲ Bullish');
  await expect(page.getByRole('button', { name: 'I entered in my broker' })).toHaveCount(0);
  // The chip is a manual, timestamped report, never detection.
  await expect(page.getByTestId('thesis-strip')).toContainText('Regime range · 9:50 AM · manual');
  // Retiring the thesis offers no new one while it ranges: the range still holds the session.
  await page.getByRole('button', { name: 'Retire this thesis', exact: true }).click();
  await expectStatus(page, 'NO ENTRY — RANGE / CHOP');
  await expect(
    page.getByRole('button', { name: 'Start a new thesis at a different area' }),
  ).toHaveCount(0);
  // Once it no longer ranges, a new thesis can start at another area.
  await page.getByRole('radio', { name: 'Directional delivery', exact: true }).click();
  await expectStatus(page, 'NO ACTIVE THESIS');
  await expect(
    page.getByRole('button', { name: 'Start a new thesis at a different area' }),
  ).toBeVisible();
});

test('brief 2 and 3: a plan without a setup waits; a major event day is practice only', async ({
  page,
}) => {
  await openCockpit(page, { state: live(), clock: ny(9, 50) });
  await expectStatus(page, 'WAITING FOR ZONE');
  await expect(page.getByRole('button', { name: 'I entered in my broker' })).toHaveCount(0);
  // A plan with a major event: the session starts as practice, and says why.
  await openCockpit(page, { clock: ny(9, 0) });
  await typePlan(page, { event: { name: 'FOMC', time: '14:00' } });
  await expect(page.getByTestId('plan-card')).toContainText(
    'Major event: FOMC at 2:00 PM New York · practice only',
  );
  await expect(
    page.getByText(/Major event today: FOMC at 2:00 PM New York. No live trading./),
  ).toBeVisible();
  await page.clock.fastForward(35 * MIN);
  await imReady(page);
  await page.getByRole('button', { name: 'Confirm the plan for this GEX lock' }).click();
  await expectStatus(page, 'WAITING FOR ZONE');
  expect((await savedSession(page, MON))!.lock!.mode).toBe('practice');
  // The event is named in the band itself, not only in the notes below.
  await expect(status(page)).toContainText('EVENT · FOMC 2:00 PM');
  await expect(status(page)).toHaveAccessibleName(/^Practice\. Major event today: FOMC 2:00 PM\./);
});

test('brief 4 and 6: I FEEL RUSHED starts a cooldown at once, kept across reload and screens', async ({
  page,
}) => {
  await openCockpit(page, { state: readied(live(), at(9, 45)), clock: ny(10) });
  await rushed(page).click();
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  // An end time, never a countdown, and what to do now.
  await expect(page.getByTestId('cooldown')).toContainText('Back after 10:25 AM New York');
  await expect(page.getByTestId('cooldown')).not.toContainText(/left|remaining|:\d\d$/);
  await expect(page.getByTestId('cooldown')).toContainText('Stand up');
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'I entered in my broker' })).toHaveCount(0);
  // A reload, another screen and coming back: still the same cooldown.
  await page.reload();
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  await page.goto('/');
  await expect(page.getByTestId('trading-caption')).toContainText('Cooldown — step away');
  await page.goto('/bias-board');
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  await page.goto('/trading');
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  // Nothing qualifies while it runs, and the reading from before it no longer counts.
  await page.clock.fastForward(26 * MIN);
  await expectStatus(page, 'WAITING FOR ZONE');
  expect((await savedSession(page, MON))!.cooldowns).toEqual([
    { kind: 'rushed', at: expect.any(String), until: expect.any(String) },
  ]);
});

test('brief 5: a stop-out is a loss cooldown, then the reset, then a new setup for attempt 2', async ({
  page,
}) => {
  // Three losses in a row end this session (two by default), so the thesis's own rules show.
  const lenient = begun(cockpitState({ maxLossRun: 3 }), at(9, 40), {}, at(9, 35));
  await openCockpit(page, { state: enteredAt(lenient, at(9, 45), at(9, 46)), clock: ny(10) });
  await page.getByRole('button', { name: 'Stopped out', exact: true }).click();
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  await expect(page.getByTestId('cooldown')).toContainText('check every account is flat');
  await expect(page.getByText('Mark it on your chart too.')).toHaveCount(0);
  // The loss counts at its planned risk until reported; it can be reported once.
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('thesis left $50 (planned) · loss $100 (planned) of $300'),
  );
  await page.getByLabel('Loss across all accounts · $', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Report loss', exact: true }).click();
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(saying('loss $80 of $300'));
  await expect(page.getByTestId('loss-report')).toHaveCount(0);
  await page.clock.fastForward(26 * MIN);
  await expectStatus(page, 'RESET — IS THE THESIS STILL VALID?');
  await expect(page.getByText('Mark it on your chart too.')).toBeVisible();
  await expect(page.getByTestId('tile-location')).toContainText('△ Warning ×1');
  await page.getByRole('button', { name: 'Still valid', exact: true }).click();
  await expectStatus(page, 'WAIT — NEW SETUP NEEDED FOR ATTEMPT 2');
  // The reading before the failure never counts: the zone starts unanswered again.
  await expect(page.getByRole('radio', { name: 'Price at my area' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await tapSetup(page);
  await typeRisk(page, 25040, 25030);
  // The second attempt is sized from what the thesis budget leaves ($70).
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  await expect(page.getByTestId('tile-risk')).toContainText('3×1 · $60');
  await iEntered(page);
  await page.getByRole('button', { name: 'Stopped out', exact: true }).click();
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  await page.clock.fastForward(26 * MIN);
  await expectStatus(page, 'THESIS EXHAUSTED — THIS IDEA IS RETIRED');
  await expect(status(page)).toContainText('Two failed attempts. This idea is retired.');
  await expect(page.getByText(/Possible range conditions/)).toBeVisible();
  await expect(page.getByTestId('tile-location')).toContainText('⚠ Baiting ×2');
  // No third attempt: the controls are gone; only a new area can start a new thesis.
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Start a new thesis at a different area' }),
  ).toBeVisible();
});

test('brief 7: an ended session is never bypassed by a reload, a deep link, Today or the evening', async ({
  page,
}) => {
  await openCockpit(page, { state: live(), clock: ny(10) });
  await page.getByRole('button', { name: 'End session…', exact: true }).click();
  await page.getByRole('button', { name: /^Hard stop: a limit was hit/ }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText(
    'A hard stop ended the session. No new trading until 9:30 AM New York, Tue, Nov 10.',
  );
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /new thesis/i })).toHaveCount(0);
  await page.reload();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await page.goto(`/trading?date=${MON}`);
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await page.goto('/');
  await expect(page.getByTestId('trading-caption')).toContainText('Session ended');
  // 6 PM opens the next candle: its record is new, and the stop still holds it. A new plan and a
  // new bias can be prepared, but the session cannot start.
  await page.clock.fastForward(8 * 60 * MIN + 30 * MIN);
  await page.goto('/trading');
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await page.getByRole('button', { name: 'Change it', exact: true }).click();
  await typePlan(page, { bias: 'bearish', target: 24900, invalidation: 25020 });
  await expect(page.getByRole('button', { name: /^I'm ready: calm/ })).toBeDisabled();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
});

test('brief 8: a pause holds every way in: practice only, never live', async ({ page }) => {
  const state = planned(cockpitState(LIVE), at(9, 30));
  state.programs = state.programs.map((p) => ({
    ...p,
    routines: p.routines.map((r) => (r.id === R ? { ...r, enabled: false } : r)),
  }));
  await openCockpit(page, { state, clock: ny(9, 45) });
  await expect(status(page)).toContainText('PRACTICE');
  await expect(page.getByText(/Trading is paused in Programs\./)).toBeVisible();
  // Live trading cannot be turned back on from Your limits while paused.
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Live trading', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await imReady(page);
  expect((await savedSession(page, MON))!.lock!.mode).toBe('practice');
  await page.goto('/bias-board');
  await expect(status(page)).toContainText('PRACTICE');
  // Turning it off is always allowed; on again is refused while the pause holds.
  await page.goto('/trading');
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.getByText('Resume trading in Programs first.').first()).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('brief 9: a plan from the 6 PM GEX is confirmed with one tap before new entries', async ({
  page,
}) => {
  const { state, clock } = STATUS_CASES.PLAN_RECONFIRM!();
  await openCockpit(page, { state, clock });
  await expectStatus(page, 'NO ENTRY — CONFIRM YOUR PLAN FOR THIS GEX');
  await expect(status(page)).toContainText('Plan from the 6 PM GEX — still valid now?');
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm the plan for this GEX lock' }).click();
  await expectStatus(page, 'WAITING FOR ZONE');
  expect((await savedSession(page, MON))!.plan!.confirmed).toEqual([
    { lock: 'morning', at: expect.any(String) },
  ]);
});

test('brief 10 and the CISD rule: a single wick never completes; B waits for its retake rule', async ({
  page,
}) => {
  await openCockpit(page, { state: live(), clock: ny(9, 50) });
  await page.getByRole('radio', { name: 'Price at my area', exact: true }).click();
  await page.getByRole('radio', { name: /^Setup A:/ }).click();
  await page.getByRole('radio', { name: '5 minute chart', exact: true }).click();
  await page.getByRole('radio', { name: 'Single wick — not enough', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Setup confirmed', exact: true }).click();
  await expectStatus(page, 'CONFIRMATION INCOMPLETE');
  // The setup stays open while the confirmation is incomplete, with the rule said in full.
  await expect(page.getByTestId('setup-controls')).toContainText(
    'A single wick or tap is not enough',
  );
  await page.getByRole('radio', { name: 'Body in CISD', exact: true }).click();
  await expectStatus(page, 'NO ENTRY — NO STRUCTURAL STOP');
  // Complete, it folds to the one toggle that names it; unticked, the chips come back.
  await page.getByRole('checkbox', { name: /^Setup confirmed · A/ }).click();
  await page
    .getByRole('radio', { name: /^Setup B: Delivery, Sweep & Retake, retake rule/ })
    .click();
  await page.getByRole('checkbox', { name: 'Setup confirmed', exact: true }).click();
  await expectStatus(page, 'CONFIRMATION INCOMPLETE');
  await expect(status(page)).toContainText("Write Setup B's retake rule in My Trading Strategy");
  // Written in the reference, B can complete.
  await page.getByRole('button', { name: 'Open My Trading Strategy' }).first().click();
  await expect(page.getByTestId('retake-rule')).toContainText("Write Setup B's retake rule");
  await page.getByRole('button', { name: 'Edit my trading strategy', exact: true }).click();
  await page
    .getByLabel('Setup B · retake rule', { exact: true })
    .fill('Example: a 5m body back above the level');
  await page.getByRole('button', { name: 'Save strategy', exact: true }).click();
  await expect(page.getByTestId('retake-rule')).toContainText(
    'Retake rule: Example: a 5m body back above the level',
  );
  await page.goto('/trading');
  await expectStatus(page, 'NO ENTRY — NO STRUCTURAL STOP');
});

test('brief 11: unknown exposure is never zero, until the loss is reported', async ({ page }) => {
  await openCockpit(page, { state: live(), clock: ny(9, 50) });
  await page.getByRole('button', { name: 'Log an entry I took', exact: true }).click();
  await page.getByLabel('Entry', { exact: true }).fill('25040');
  await page.getByLabel('Contracts per account', { exact: true }).fill('2');
  await expect(
    page.getByText('No stop: the exposure is unknown until you report the loss.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Log this entry', exact: true }).click();
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  await expect(status(page)).toContainText('stop not set');
  await page
    .getByRole('button', { name: 'Closed in my broker earlier, not recorded here', exact: true })
    .click();
  // Logged while entries were held and with no stop: the session ended when it was logged, and
  // its unknown loss is still asked for (it holds the next session until reported).
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText('A trade was logged while entries were held.');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('loss unknown of $300'),
  );
  await expect(page.getByTestId('thesis-strip')).not.toHaveAccessibleName(saying('$0 of'));
  await page.getByLabel('Loss across all accounts · $', { exact: true }).fill('45.5');
  await page.getByRole('button', { name: 'Report loss', exact: true }).click();
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('loss $45.50 of $300'),
  );
});

test('brief 12 and 14: limits lock at the start, a raise waits; copied accounts count on each', async ({
  page,
}) => {
  await openCockpit(page, {
    state: readied(begun(cockpitState({ accounts: 2 }), at(9, 40)), at(9, 45)),
    clock: ny(9, 50),
  });
  await expect(page.getByTestId('tile-risk')).toContainText('5×2 · $200');
  // Every amount says its basis: per account on the tile, across accounts on the strip.
  await expect(page.getByTestId('tile-risk')).toContainText('Risk · $100/acct');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('thesis left $300 (2 accts) · loss $0 of $600 (2 × $300)'),
  );
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('400');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  // The raise applies from the next session: the size stays.
  await expect(page.getByTestId('tile-risk')).toContainText('5×2 · $200');
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  // A lower one applies at once.
  await expect(page.getByTestId('tile-risk')).toContainText('3×2 · $120');
});

test('brief 13: the daily loss limit stops the session until the next 9:30 AM window', async ({
  page,
}) => {
  const state = enteredAt(live(), at(9, 45), at(9, 46), { stop: 24990 });
  await openCockpit(page, { state: cockpitStateWith(state, 100), clock: ny(10) });
  await page.getByRole('button', { name: 'Stopped out', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText(
    'The daily loss limit is reached. No new trading until 9:30 AM New York, Tue, Nov 10.',
  );
});

/** The state with a lower daily loss limit, set after its session started (it applies at once). */
function cockpitStateWith(state: ReturnType<typeof live>, dailyLoss: number) {
  return {
    ...state,
    ruleBooks: state.ruleBooks.map((b) =>
      b.trading ? { ...b, trading: { ...b.trading, risk: { ...b.trading.risk!, dailyLoss } } } : b,
    ),
  };
}

test('brief 15 and addendum 15: the status, the indicators and I FEEL RUSHED on the first screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const code of ['WAITING_ZONE', 'CHECKS_COMPLETE', 'COOLDOWN', 'IN_POSITION'] as const) {
    const { state, clock } = STATUS_CASES[code]!();
    await openCockpit(page, { state, clock });
    for (const id of ['trade-status-title', 'indicators', 'thesis-strip', 'i-feel-rushed'])
      await expect(page.getByTestId(id), `${code} ${id}`).toBeInViewport({ ratio: 1 });
  }
});

test('lines: one tap marks baiting for the session; a new thesis at the same area is blocked', async ({
  page,
}) => {
  await openCockpit(page, { state: live(), clock: ny(9, 50) });
  await page
    .getByRole('button', { name: 'Mark Example level baiting for the rest of the session' })
    .click();
  await expectStatus(page, 'NO ENTRY — LINE IS BAITING');
  await expect(page.getByTestId('tile-location')).toContainText('⚠ Baiting');
  await page.reload();
  await expectStatus(page, 'NO ENTRY — LINE IS BAITING');
  await page.getByRole('button', { name: 'Retire this thesis', exact: true }).click();
  await expectStatus(page, 'NO ACTIVE THESIS');
  await page.getByRole('button', { name: 'Start a new thesis at a different area' }).click();
  // The same label, however typed, is the same area.
  await page.getByLabel('Where · a different area', { exact: true }).fill('  example   LEVEL ');
  await page.getByLabel('What changed · one line', { exact: true }).fill('Another wick');
  await page.getByLabel('Invalidation', { exact: true }).fill('24990');
  await expect(page.getByText('Example level is baiting for this session.')).toBeVisible();
  const start = page.getByRole('button', { name: 'Start this thesis', exact: true });
  await expect(start).toBeDisabled();
  // A different area with what changed starts thesis 2; the session's loss and limits carry on.
  await page.getByLabel('Where · a different area', { exact: true }).fill('Call wall');
  await expect(start).toBeEnabled();
  await start.click();
  await expectStatus(page, 'WAITING FOR ZONE');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('Thesis 2 · 0/2 attempts'),
  );
  await expect(page.getByTestId('tile-location')).toContainText('○ NormalCall wall');
});

test('a counter-bias thesis only behind its exception, with a written justification', async ({
  page,
}) => {
  const state = retired(live());
  await openCockpit(page, { state, clock: ny(9, 55) });
  await page.getByRole('button', { name: 'Start a new thesis at a different area' }).click();
  await page.getByLabel('Where · a different area', { exact: true }).fill('FVG');
  await page.getByLabel('What changed · one line', { exact: true }).fill('FVG tap at a level');
  await page.getByLabel('Target', { exact: true }).fill('24950');
  await page.getByLabel('Invalidation', { exact: true }).fill('25060');
  await expect(page.getByText(/^For a long/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Exception · against the bias', exact: true }).click();
  await expect(
    page.getByText('A thesis against the bias needs your written structural justification.'),
  ).toBeVisible();
  await page
    .getByLabel('Structural justification · e.g. FVG + GEX', { exact: true })
    .fill('Example: an FVG tap aligned with a level');
  await page.getByRole('button', { name: 'Start this thesis', exact: true }).click();
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('Thesis 2 · EXCEPTION · 0/2 attempts'),
  );
});

test('addendum 13 and 14: thesis states persist; ending the session ends simulated entries', async ({
  page,
}) => {
  const { state, clock } = STATUS_CASES.SECOND_ATTEMPT_WAIT!();
  await openCockpit(page, { state, clock });
  await expectStatus(page, 'WAIT — NEW SETUP NEEDED FOR ATTEMPT 2');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('1/2 attempts · thesis left'),
  );
  await page.goto('/review');
  await page.goto('/trading');
  await page.reload();
  await expectStatus(page, 'WAIT — NEW SETUP NEEDED FOR ATTEMPT 2');
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('1/2 attempts · thesis left'),
  );
  await page.getByRole('button', { name: 'End session…', exact: true }).click();
  await page.getByRole('button', { name: 'Finished for today', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(page.getByTestId('setup-controls')).toHaveCount(0);
  await expect(page.getByTestId('location-controls')).toHaveCount(0);
  expect((await savedSession(page, MON))!.sessionStop).toMatchObject({ reason: 'finished' });
});

test('outcomes: a partial exit is the same attempt; Closed in broker earlier reconciles', async ({
  page,
}) => {
  const { state, clock } = STATUS_CASES.RECONCILE_POSITION!();
  await openCockpit(page, { state, clock });
  await expectStatus(page, 'RECONCILE OPEN POSITION');
  await page.getByRole('button', { name: 'Record a partial exit: the same attempt' }).click();
  await expectStatus(page, 'RECONCILE OPEN POSITION');
  await page
    .getByRole('button', { name: 'Closed in my broker earlier, not recorded here', exact: true })
    .click();
  // Closed without a gain is a failed attempt: its cooldown first. Then the previous candle's
  // session, which ran, is reviewed before this one starts.
  await expectStatus(page, 'COOLDOWN — STEP AWAY');
  await page.clock.fastForward(26 * MIN);
  await expectStatus(page, 'NO TRADE — REVIEW YOUR LAST SESSION');
  const friday = (await savedSession(page, '2026-11-06'))!;
  expect(friday.attempts).toHaveLength(1);
  expect(friday.attempts![0]).toMatchObject({
    partials: [expect.any(String)],
    exit: { kind: 'reconciled' },
  });
  await page.getByRole('button', { name: 'Review Fri, Nov 6 first', exact: true }).click();
  await expect(page.getByText('Process · Fri, Nov 6', { exact: true })).toBeVisible();
});

test('the review reads the records: Recorded facts, and violations it points to stay ticked', async ({
  page,
}) => {
  // A short taken outside the cockpit on a bullish day, without a stop, then closed and reported.
  let state = logTakenAttempt(
    live(),
    R,
    { side: 'short', entry: 25040, stop: null, contracts: 1 },
    at(9, 45),
  );
  state = exited(state, 'a1', at(9, 50), 'stopped');
  state = feelRushed(state, R, at(9, 51));
  await openCockpit(page, { state, clock: ny(11) });
  await page.getByLabel('Loss across all accounts · $', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Report loss', exact: true }).click();
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  const recorded = page.getByTestId('review-recorded');
  await expect(recorded).toContainText(
    '1 thesis · 1 attempt · 1 failed · 1 taken outside the cockpit',
  );
  await expect(recorded).toContainText('Every trade on the HTF side');
  await expect(recorded).toContainText('not broker-verified');
  // The discipline answers the records give are pre-filled and labelled Recorded.
  await expect(
    page.getByRole('radio', { name: 'Avoided all trades against my HTF bias: no', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  for (const name of [
    'No clear invalidation',
    'Entered without a named setup',
    'Traded against my daily bias',
  ]) {
    const box = page.getByRole('checkbox', {
      name: `${name}, recorded from the session`,
      exact: true,
    });
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect(box).toBeDisabled();
  }
  await expect(page.getByLabel('Entries taken · optional', { exact: true })).toHaveValue('1');
});

test('Your limits: fixed risk per trade, budgets, the session caps, costs and cooldown; live trading off', async ({
  page,
}) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Live trading', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(
    page.getByText(/^Live trading is off\. It can be turned on only between sessions/),
  ).toBeVisible();
  // No freshness minutes, no event schedule, no failed-thesis count.
  await expect(page.getByLabel(/fresh|Entries that end|Failed theses/i)).toHaveCount(0);
  // The session caps, 3 entries and 2 losses in a row unless set; the clean sessions as counts.
  await expect(page.getByLabel('Entries per session', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Losses in a row', { exact: true })).toHaveValue('2');
  await expect(page.getByTestId('live-gates')).toHaveText(
    'Clean practice sessions: 0 of 30, before live trading.' +
      'Clean live sessions at 1 account: 0 of 20, before 2 accounts.',
  );
  // More accounts go one step at a time, after their clean live sessions.
  await page.getByLabel('Accounts', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Accounts go up one step at a time: 1 to 2 next.'),
  ).toBeVisible();
  await page.getByLabel('Accounts', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('2 accounts need 20 clean live sessions at 1: 0 of 20 so far.'),
  ).toBeVisible();
  await page.getByLabel('Accounts', { exact: true }).fill('1');
  await page.getByLabel('Entries per session', { exact: true }).fill('2');
  await page.getByLabel('Total across accounts · $', { exact: true }).fill('250');
  await page.getByLabel('Cooldown · minutes', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByText('Enter cooldown minutes as a whole number from 20 to 60, or leave it blank.'),
  ).toBeVisible();
  await page.getByLabel('Cooldown · minutes', { exact: true }).fill('30');
  await page.getByLabel('Commission · $ round trip', { exact: true }).fill('1.24');
  await page.getByLabel('Slippage · ticks', { exact: true }).fill('1');
  await page.getByLabel('Session max loss · $', { exact: true }).fill('300.004');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByText('Enter the session max loss in dollars to the cent, or leave it blank.'),
  ).toBeVisible();
  await page.getByLabel('Session max loss · $', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toContainText(
    '$100 per trade · $150 per thesis · $300 session · 5 contracts · 1 account · costs $1.24 + 1 ticks',
  );
  await expect(page.getByTestId('preparation')).toContainText(
    'Session: at most 2 entries · 2 losses in a row end it · $250 at most across accounts',
  );
  const profile = (await saved(page)).ruleBooks.find((b) => b.routineId === R)!.trading!;
  expect(profile).toMatchObject({
    accounts: 1,
    maxEntries: 2,
    maxLossRun: 2,
    dailyLossTotal: 250,
    cooldownMinutes: 30,
    costs: { commission: 1.24, slippageTicks: 1 },
  });
  // Cuts, all of them: nothing waits.
  expect(profile.raisedOn).toBeUndefined();
  expect(profile.liveTrading).toBeUndefined();
});

test('My Trading Strategy: template steps that open in full, My Key, edited in place', async ({
  page,
}) => {
  await openCockpit(page, { clock: ny(9, 0), route: '/programs' });
  await page.getByRole('button', { name: 'Open My Trading Strategy', exact: true }).click();
  const steps = page.getByTestId('strategy-steps').getByRole('button');
  await expect(steps).toHaveCount(5);
  const full = page.getByText(/^Write each setup you trade, what confirms it/);
  await expect(full).toHaveCount(0);
  await steps.nth(3).click();
  await expect(steps.nth(3)).toHaveAttribute('aria-expanded', 'true');
  await expect(full).toBeVisible();
  // The full wording sits outside the button, so a screen reader reaches it on its own.
  await expect(steps.nth(3).getByText(/^Write each setup you trade/)).toHaveCount(0);
  await expect(page.getByTestId('my-key')).toHaveText(/^Not written yet/);
  await page.getByRole('button', { name: 'Edit my trading strategy', exact: true }).click();
  await page.getByLabel('My key', { exact: true }).fill('Example: my own reading notes');
  await page.getByLabel('Step 1 · title', { exact: true }).fill('Daily chart first');
  await page.getByRole('button', { name: 'Save strategy', exact: true }).click();
  await expect(page.getByTestId('my-key')).toHaveText('Example: my own reading notes');
  await expect(steps.first()).toContainText('Daily chart first');
  const strategy = (await saved(page)).ruleBooks.find((b) => b.routineId === R)!.trading!.strategy!;
  expect(strategy).toMatchObject({ key: 'Example: my own reading notes', retakeRule: null });
  expect(strategy.steps).toHaveLength(5);
});

test("Today's row and Rules & GEX read the cockpit's one status", async ({ page }) => {
  const { state, clock } = STATUS_CASES.CHECKS_COMPLETE!();
  await openCockpit(page, { state, clock, route: '/' });
  await expect(page.getByTestId('trading-caption')).toHaveText(
    /^▲ Bullish · longs only\s*Setup checks complete — self-reported$/,
  );
  // No streak on Today's row.
  await expect(page.getByTestId('trading-caption')).not.toContainText(/streak/i);
  await page.goto('/bias-board');
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  await expect(page.getByTestId('gex-window')).toContainText('9:30 AM lock');
  await page.goto('/trading');
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  // No streak on the live cockpit either.
  await expect(page.getByText(/streak/i)).toHaveCount(0);
});

test('a session an earlier build kept on this device is moved in once, on load', async ({
  page,
}) => {
  // Data saved before version 5, with Monday's started session in the device's own record.
  const kept = live().tradingSessions[MON];
  const { tradingSessions: _sessions, tradingSessionsImported: _flag, ...v4 } = cockpitState();
  await seed(page, { ...v4, version: 4 }, { clock: ny(9, 45) });
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`life-os-trading-session:${MON}`, JSON.stringify(kept)],
  );
  await page.goto('/trading');
  await expectStatus(page, 'WAITING FOR ZONE');
  const after = await saved(page);
  expect(after.version).toBe(5);
  expect(after.tradingSessions[MON]).toEqual(kept);
  expect(after.tradingSessionsImported).toBe(true);
  // The device record is left as it was, and never read again.
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [`life-os-trading-session:${MON}`, JSON.stringify(newSession(MON))],
  );
  await page.reload();
  await expectStatus(page, 'WAITING FOR ZONE');
  expect((await saved(page)).tradingSessions[MON]).toEqual(kept);
});

test('an earlier day is only reviewed, titled by its date', async ({ page }) => {
  await openCockpit(page, { clock: ny(10), route: '/trading?date=2026-11-06' });
  await expect(statusTitle(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Review this day', exact: true }).click();
  await expect(page.getByText('Process · Fri, Nov 6', { exact: true })).toBeVisible();
  await expect(page.getByText(/Today's process/)).toHaveCount(0);
});

test.describe('east of New York', () => {
  // In Kiritimati (UTC+14) Monday's 9:30 AM window falls on Tuesday's calendar date. The plan, the
  // session and its review are kept by candle date, whatever the phone's date.
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test("the session starts on its candle's record, and is reviewed as that candle", async ({
    page,
  }) => {
    await openCockpit(page, { state: planned(cockpitState(), at(9, 35)), clock: ny(9, 45) });
    await imReady(page);
    await expectStatus(page, 'WAITING FOR ZONE');
    expect((await savedSession(page, MON))!.startedAt).toBeTruthy();
    expect(await savedSession(page, '2026-11-10')).toBeNull();
    await page.getByRole('button', { name: 'Review Mon, Nov 9', exact: true }).click();
    await expect(page.getByText('Process · Mon, Nov 9', { exact: true })).toBeVisible();
  });

  test('a session an earlier build reviewed on the next date shows and corrects that review', async ({
    page,
  }) => {
    // The earlier build kept Monday's session on Tuesday's record and reviewed it there, with a
    // hard violation; moved in, it sits on its candle and says where it came from.
    const state = cockpitState();
    const TUE = '2026-11-10';
    const monday = {
      ...newSession(MON),
      startedAt: at(9, 35),
      doneAt: at(14),
      doneReason: 'finished' as const,
      movedFrom: TUE,
    };
    const checklist = profileOf(state).checklist;
    const old = {
      id: 'r-old',
      date: TUE,
      at: at(14, 30),
      routineId: R,
      occurrenceId: null,
      outcome: 'reviewed' as const,
      answers: checklist.map((c) => ({ checkpointId: c.id, answer: 'yes' as const })),
      violations: [VIOLATION_IDS.revenge],
      note: 'Example: Monday review',
      trading: { session: 'traded' as const, entries: null, failedTheses: null },
    };
    await openCockpit(page, {
      state: {
        ...state,
        tradingSessions: { [MON]: monday },
        ruleReviews: [...state.ruleReviews, old],
      },
      clock: ny(15),
    });
    await expect(page.getByTestId('review-result')).toContainText(
      'The next trading day is study only.',
    );
    await page.getByRole('button', { name: 'Correct the review', exact: true }).click();
    await expect(page.getByText('Process · Mon, Nov 9', { exact: true })).toBeVisible();
    await expect(
      page.getByLabel('The one thing to improve tomorrow · optional', { exact: true }),
    ).toHaveValue('Example: Monday review');
  });
});
