import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import type { State } from '../src/domain/model';
import { newSession } from '../src/domain/trading';
import { STATE_KEY, saved, seed } from './support/storage';
import { TRADING_ROUTINE, tradingState } from './support/trading-state';

// The Day Cleared celebration and the week on Today, on the fictional demo. The browser clock is
// Monday, November 9, 2026, 9:00. Everything due today is done except the morning walk, so one tap
// clears the day.

const TODAY = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);

function almostCleared(): State {
  const state = demoState(TODAY);
  const day = state.days[TODAY];
  state.days[TODAY] = {
    ...day,
    blocks: day.blocks.map((b) =>
      b.routineId === 'demo-morning'
        ? b
        : {
            ...b,
            status: 'done',
            actualAt: new Date(2026, 10, 9, 8).toISOString(),
            ...(b.bundledSteps && {
              bundledSteps: b.bundledSteps.map((s) => ({
                ...s,
                status: 'done' as const,
                actualAt: new Date(2026, 10, 9, 8).toISOString(),
              })),
            }),
          },
    ),
  };
  return state;
}

async function open(page: Page, state: State, reducedMotion: 'reduce' | 'no-preference') {
  await page.emulateMedia({ reducedMotion });
  await seed(page, state, { clock: NINE, route: '/' });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('clearing the day on screen celebrates once, with the streak, the week and real moments', async ({
  page,
}) => {
  await open(page, almostCleared(), 'no-preference');
  // Opening a day that is not yet cleared celebrates nothing; the week is in Today's hero card.
  await expect(page.getByTestId('celebration')).toHaveCount(0);
  await expect(
    page.getByTestId('today-hero').getByRole('button', { name: /^Last 7 days: \d cleared\./ }),
  ).toBeVisible();
  await expect(page.getByText('One more to clear the day')).toBeVisible();
  await page.screenshot({ path: 'test-results/celebration-before.png' });
  await page.getByRole('button', { name: /^Mark Morning done/ }).click();
  const party = page.getByTestId('celebration');
  await expect(party).toBeVisible();
  await expect(page.getByTestId('confetti')).toHaveCount(1);
  await expect(party.getByRole('heading', { name: 'Day cleared' })).toBeVisible();
  await expect(party.getByText(/^All \d+ done · Monday, November 9$/)).toBeVisible();
  // What it lists as done is what that count counts: the optional weigh-in is left out.
  await expect(party.getByText('Morning weigh-in', { exact: true })).toHaveCount(0);
  // The streak rolls up into today, never from 0; the week shows today cleared.
  const state = await saved(page);
  expect(state.days[TODAY].blocks.find((b) => b.routineId === 'demo-morning')!.status).toBe('done');
  await expect(party.getByLabel(/^Streak \d+ days?$/)).toBeVisible();
  await expect(party.getByText(/^(Up from \d+|A new run starts today)$/)).toBeVisible();
  await expect(party.getByTestId('week-strip')).toHaveAttribute(
    'aria-label',
    /^Last 7 days: \d cleared\. .* Mon, Nov 9 cleared\.$/,
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/celebration.png' });
  // Closing returns to the cleared board, and the celebration does not come back on its own.
  // The day is finished, so its one button says so.
  await expect(page.getByRole('button', { name: 'Close the celebration', exact: true })).toHaveText(
    'Done',
  );
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(party).toHaveCount(0);
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('celebration')).toHaveCount(0);
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
});

test('under Reduce Motion the celebration shows its final state with no confetti', async ({
  page,
}) => {
  await open(page, almostCleared(), 'reduce');
  await page.getByRole('button', { name: /^Mark Morning done/ }).click();
  await expect(page.getByTestId('celebration')).toBeVisible();
  await expect(page.getByTestId('confetti')).toHaveCount(0);
});

test('Undo takes the clear back, and nothing celebrates a day that is not cleared', async ({
  page,
}) => {
  await open(page, almostCleared(), 'reduce');
  await page.getByRole('button', { name: /^Mark Morning done/ }).click();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await page
    .getByRole('button', { name: /^Undo Morning(?! weigh)|^Mark Morning not done/ })
    .click();
  await expect(page.getByText('One more to clear the day')).toBeVisible();
  await expect(page.getByTestId('celebration')).toHaveCount(0);
});

test('a day cleared on another page is not celebrated there, or when Today comes back', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seed(page, tradingState(), { clock: NINE, route: '/' });
  await expect(page.getByTestId('trading-caption')).toBeVisible();
  // Everything but the trading review is done, so saving the review on Trading clears the day.
  await page.evaluate(
    ({ key, date, routine, session }) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      for (const b of s.days[date].blocks)
        if (b.routineId !== routine) {
          b.status = 'done';
          b.actualAt = new Date(2026, 10, 9, 8).toISOString();
          for (const step of b.bundledSteps ?? []) {
            step.status = 'done';
            step.actualAt = b.actualAt;
          }
        }
      // The day's bias is labeled Unclear.
      s.tradingSessions[date] = session;
      localStorage.setItem(key, JSON.stringify(s));
    },
    {
      key: STATE_KEY,
      date: TODAY,
      routine: TRADING_ROUTINE,
      session: { ...newSession(TODAY), bias: 'unclear' },
    },
  );
  await page.reload();
  await page.getByRole('button', { name: /^Open Follow my trading rules\./ }).click();
  await page.getByRole('button', { name: 'Review today', exact: true }).click();
  // Wait for the sheet's eight items and the one discipline answer the day cannot tell.
  await expect(page.getByText('9 left to answer', { exact: true })).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: /: pass$/ }).all()) await radio.click();
  await page
    .getByRole('radio', {
      name: 'Avoided predicting and reacting emotionally to individual candles: yes',
      exact: true,
    })
    .click();
  await expect(page.getByRole('button', { name: /^Save review/ })).toBeEnabled();
  await page.getByRole('button', { name: /^Save review/ }).click();
  await expect(page.getByTestId('review-result')).toContainText('Clean session');
  await expect(page.getByTestId('celebration')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  await expect(page.getByTestId('celebration')).toHaveCount(0);
});
