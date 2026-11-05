import { test, expect } from '@playwright/test';
import {
  BEFORE_LIVE_LINE,
  EXISTING_ACCOUNT_LINE,
  answerReset,
  newThesis,
} from '../src/domain/trading-live';
import { MONEY_INFO_LINE, MONEY_NO_LINE, MONEY_QUESTION } from '../src/domain/trading-safeguards';
import { reviewedSessions } from '../src/test-support/trading-live';
import { saved } from './support/storage';
import {
  LIVE,
  begun,
  cockpitState,
  enteredAt,
  expectStatus,
  exited,
  openCockpit,
  readied,
  savedSession,
  status,
  saying,
} from './support/cockpit';
import { MON, at, ny } from './support/statuses';
import { TRADING_ROUTINE as R } from './support/trading-state';

// The safeguards in the browser: the session's entry cap and losses in a row named in the status
// band, a trade logged outside the checks ending the session, a refused I ENTERED kept for the
// review, a raise that waits for the next candle, and live trading behind its clean practice
// sessions (or one live account already traded, confirmed) and the money question, and the
// flat-by time. Synthetic data only: example limits on an example instrument; 16:45 is an example
// flat-by time.

const live = () => begun(cockpitState(), at(9, 40), {}, at(9, 35));
const profile = async (page: Parameters<typeof saved>[0]) =>
  (await saved(page)).ruleBooks.find((b) => b.routineId === R)!.trading!;
const another = (where: string) => ({
  where,
  changed: 'Example: price left the first area and built a new base',
  target: 25100,
  invalidation: 24980,
});

// The cockpit is a native screen: an iPhone 13's full 390 × 844 points, where the status band
// says its reason itself (the smallest phones are in e2e/layout.spec.ts).
test.use({ timezoneId: 'America/New_York', viewport: { width: 390, height: 844 } });

test('two losses in a row end the session, whatever the thesis', async ({ page }) => {
  let state = exited(enteredAt(live(), at(9, 45), at(9, 46)), 'a1', at(10, 0));
  state = answerReset(state, R, 't1', false, at(10, 1));
  state = newThesis(state, R, another('Example second level'), at(10, 30));
  state = enteredAt(state, at(10, 31), at(10, 32));
  await openCockpit(page, { state, clock: ny(10, 35) });
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  // The run so far is said under the thesis's own count, as plain text.
  await expect(page.getByTestId('session-counts')).toHaveText(
    'Session: entries 2 of 3 · losses in a row 1 of 2',
  );
  await page.getByRole('button', { name: 'Stopped out', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText(
    'The losses in a row that end the session are reached. No new trading until 9:30 AM New York, Tue, Nov 10.',
  );
  expect((await savedSession(page, MON))!.stopCause).toBe('loss-run');
});

test('the third entry ends the session after it', async ({ page }) => {
  let state = exited(enteredAt(live(), at(9, 45), at(9, 46)), 'a1', at(9, 50), 'objective');
  state = newThesis(state, R, another('Example second level'), at(9, 51));
  state = exited(enteredAt(state, at(9, 52), at(9, 53)), 'a2', at(9, 55), 'objective');
  state = readied(newThesis(state, R, another('Example third level'), at(9, 56)), at(9, 57));
  await openCockpit(page, { state, clock: ny(9, 58) });
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  // The session's count shows before the entry that reaches it, not only the thesis's.
  await expect(page.getByTestId('thesis-strip')).toHaveAccessibleName(
    saying('Thesis 3 · 0/2 attempts'),
  );
  await expect(page.getByTestId('session-counts')).toHaveText(
    'Session: entries 2 of 3 · losses in a row 0 of 2',
  );
  await page.getByRole('button', { name: 'I entered in my broker', exact: true }).click();
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  // Ended by the cap: the thesis's attempts are no longer shown as open.
  await expect(page.getByTestId('session-counts')).toContainText('entries 3 of 3');
  await expect(page.getByTestId('thesis-strip')).not.toHaveAccessibleName(saying('attempts'));
  await expect(
    page.getByText('The session has ended: no new entry after this trade.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Objective reached', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText('The entry cap for this session is reached.');
});

test('a trade logged while entries are held ends the session at once', async ({ page }) => {
  await openCockpit(page, { state: live(), clock: ny(9, 50) });
  await expectStatus(page, 'WAITING FOR ZONE');
  await page.getByRole('button', { name: 'Log an entry I took', exact: true }).click();
  await page.getByLabel('Entry', { exact: true }).fill('25040');
  await page.getByLabel('Stop · if any', { exact: true }).fill('25030');
  await page.getByLabel('Contracts per account', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Log this entry', exact: true }).click();
  await expectStatus(page, 'IN POSITION — MANAGE TO PLAN');
  await page.getByRole('button', { name: 'Objective reached', exact: true }).click();
  await expectStatus(page, 'SESSION ENDED — NO FURTHER TRADING');
  await expect(status(page)).toContainText('A trade was logged while entries were held.');
  // An app-level stop, never called a broker lockout.
  await expect(status(page)).not.toContainText(/lockout|locked out/i);
});

test('an I ENTERED tap the status refused is kept for the review', async ({ page }) => {
  // Live, ready at 3:59 PM New York: the 9:30 AM window closes at 4:00 PM.
  const state = readied(begun(cockpitState(LIVE), at(15, 50), {}, at(9, 35)), at(15, 58));
  await openCockpit(page, { state, clock: ny(15, 59) });
  await expectStatus(page, 'SETUP CHECKS COMPLETE — SELF-REPORTED');
  // The window closes before the screen reads the clock again.
  await page.clock.setSystemTime(ny(16, 1));
  await page.getByRole('button', { name: 'I entered in my broker', exact: true }).click();
  // Refused, with the reason said, and kept.
  await expect(
    page.getByText('WAIT — NO LIVE WINDOW. Live entries only in the 6 PM and 9:30 AM windows.'),
  ).toBeVisible();
  await expect.poll(async () => (await savedSession(page, MON))?.refusals?.length ?? 0).toBe(1);
  const session = (await savedSession(page, MON))!;
  expect(session.refusals![0].status).toBe('OUTSIDE_WINDOW');
  expect(session.attempts ?? []).toHaveLength(0);
});

test("a raise waits for the next candle's session; a cut applies at once", async ({ page }) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  // Saved before the session starts, it still waits.
  await expect(page.getByTestId('preparation')).toContainText('$100 per trade');
  await expect(page.getByTestId('preparation')).toContainText(
    'Raised on this candle: risk per trade. The new values apply from the session of Tue, Nov 10; until then the earlier ones hold.',
  );
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await expect(page.getByTestId('waiting-raise')).toBeVisible();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toContainText('$80 per trade');
  expect((await profile(page)).raisedOn).toBeUndefined();
});

test('a limit cleared and set higher on the same candle still waits', async ({ page }) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toContainText('risk per trade');
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await page.getByLabel('Risk per trade · $', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toContainText('$100 per trade');
  await expect(page.getByTestId('preparation')).toContainText(
    'Raised on this candle: risk per trade.',
  );
  expect((await profile(page)).raisedOn).toMatchObject({ before: { tradeRisk: 100 } });
});

test('the money question shows on screen wherever the switch is tapped', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openCockpit(page, { state: reviewedSessions(cockpitState(), 30), clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Live trading', exact: true });
  // The switch at the foot of the sheet's scrolled area, tapped where it is (no scrolling).
  await toggle.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const box = (await toggle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Seen where it is, without scrolling: in the viewport and on top, its corners not under the
  // pinned Save limits or cut by the sheet.
  const seen = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const inset = 2;
      const points = [
        [r.left + inset, r.top + inset],
        [r.right - inset, r.top + inset],
        [r.left + inset, r.bottom - inset],
        [r.right - inset, r.bottom - inset],
      ];
      return points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && el.contains(hit);
      });
    });
  const question = page.getByTestId('money-question');
  await expect(question).toBeInViewport({ ratio: 1 });
  expect(await seen('money-question')).toBe(true);
  await expect(question).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await expect(page.getByTestId('money-no')).toBeInViewport({ ratio: 1 });
  expect(await seen('money-no')).toBe(true);
  await expect(page.getByTestId('money-no')).toHaveAttribute('aria-live', 'polite');
});

test('live trading waits for 30 clean practice sessions, then asks about the money once', async ({
  page,
}) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Live trading', exact: true });
  await toggle.click();
  await expect(
    page.getByText('Live trading waits for 30 clean practice sessions: 0 of 30 so far.'),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('money-question')).toHaveCount(0);

  await openCockpit(page, { state: reviewedSessions(cockpitState(), 30), clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await expect(page.getByTestId('live-gates')).toContainText(
    'Clean practice sessions: 30 of 30, before live trading.',
  );
  // No: live stays off, with a kind line and one line of general information.
  await toggle.click();
  await expect(page.getByTestId('money-question')).toContainText(MONEY_QUESTION);
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await expect(page.getByText(MONEY_NO_LINE, { exact: true })).toBeVisible();
  await expect(page.getByText(MONEY_INFO_LINE, { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect((await profile(page)).liveTrading).toBeUndefined();
  // Asked again; Yes turns it on, kept only as the date answered.
  await toggle.click();
  await page.getByRole('button', { name: 'Yes, set aside', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await profile(page)).toMatchObject({ liveTrading: true, moneySetAsideOn: MON });
  // No money amount anywhere on trading.
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByTestId('preparation')).not.toContainText(/debt|credit|savings/i);
});

test('one live account already traded turns live on with its confirmation and the money question', async ({
  page,
}) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  await expect(page.getByTestId('before-live')).toHaveText(BEFORE_LIVE_LINE);
  const toggle = page.getByRole('switch', { name: 'Live trading', exact: true });
  await toggle.click();
  // The practice sessions hold it; the live account already traded is offered beside them.
  const gated = page.getByTestId('live-gated');
  await expect(gated).toContainText(
    'Live trading waits for 30 clean practice sessions: 0 of 30 so far.',
  );
  await expect(gated).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: 'I already trade one live account', exact: true }).click();
  const confirm = page.getByTestId('existing-account');
  await expect(confirm).toHaveText(new RegExp(`^${EXISTING_ACCOUNT_LINE}`));
  await expect(confirm).toHaveAttribute('aria-live', 'polite');
  // Not now changes nothing.
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await toggle.click();
  await page.getByRole('button', { name: 'I already trade one live account', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, confirm', exact: true }).click();
  // Then the money question, as on the other path.
  await expect(page.getByTestId('money-question')).toContainText(MONEY_QUESTION);
  await page.getByRole('button', { name: 'Yes, set aside', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await profile(page)).toMatchObject({
    liveTrading: true,
    moneySetAsideOn: MON,
    existingAccountOn: MON,
  });
  await expect(
    page.getByText(/^On for one live account you already trade, confirmed Mon, Nov 9/),
  ).toBeVisible();
  // More accounts still wait for their clean live sessions.
  await page.getByLabel('Accounts', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('2 accounts need 20 clean live sessions at 1: 0 of 20 so far.'),
  ).toBeVisible();
  // The session reads live: no practice badge.
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByText('PRACTICE', { exact: true })).toHaveCount(0);
});

test('the flat-by time is set in Your limits as a New York time', async ({ page }) => {
  await openCockpit(page, { clock: ny(9, 0) });
  await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
  const field = page.getByLabel('Flat by · New York time', { exact: true });
  await field.fill('18:30');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(
    page.getByText(
      'Enter the flat-by time as 24-hour New York time before 18:00, or leave it blank.',
    ),
  ).toBeVisible();
  await field.fill('16:45');
  await page.getByRole('button', { name: 'Save limits', exact: true }).click();
  await expect(page.getByTestId('preparation')).toBeVisible();
  expect((await profile(page)).flatBy).toBe('16:45');
});

test('an open trade is warned before the flat-by time and asked for its outcome after it', async ({
  page,
}) => {
  const state = enteredAt(
    begun(cockpitState({ ...LIVE, flatBy: '16:45' }), at(15, 50), {}, at(9, 35)),
    at(15, 54),
    at(15, 55),
  );
  await openCockpit(page, { state, clock: ny(16, 31) });
  await expectStatus(page, 'IN POSITION — FLAT BY 4:45 PM NEW YORK');
  await expect(status(page)).toContainText('Be flat by 4:45 PM New York.');
  await expect(page.getByText('PRACTICE', { exact: true })).toHaveCount(0);
  await openCockpit(page, { state, clock: ny(16, 46) });
  await expectStatus(page, 'PAST FLAT BY 4:45 PM NEW YORK — RECORD THE OUTCOME');
  await page.getByRole('button', { name: 'Objective reached', exact: true }).click();
  await expectStatus(page, 'NO ENTRY — PAST FLAT BY 4:45 PM NEW YORK');
  await expect(status(page)).not.toContainText(/lockout|locked out/i);
});
