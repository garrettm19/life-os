import { test, expect, type Page } from '@playwright/test';
import { MoneyReview, State, displayDate } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { openFold, showJourney, stepTo } from './support/progress';
import { saved, seed } from './support/storage';
import { openMore } from './support/today';

// Synthetic balances only. The browser clock is pinned to Sunday, November 8, 2026 at 18:00, when
// the synthetic weekly money review is due.
const SUN = '2026-11-08';
const OCT25 = '2026-10-25';
const NOV1 = '2026-11-01';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

function earlier(id: string, date: string, figures: Partial<MoneyReview>): MoneyReview {
  return {
    id,
    date,
    at: `${date}T20:00:00.000Z`,
    currency: 'USD',
    cash: null,
    savings: null,
    debt: null,
    upcoming: null,
    contributed: null,
    savingsTarget: null,
    nextAction: '',
    note: '',
    goalId: null,
    occurrenceId: null,
    ...figures,
  };
}

function moneyState(): State {
  const state = trainingState();
  state.moneyReviews = [
    earlier('a', OCT25, { cash: 90000, savings: 200000, debt: 500000 }),
    // An earlier review with fields the review form does not ask for; debt left blank.
    earlier('b', NOV1, { cash: 80000, savings: 250000, upcoming: 12000, savingsTarget: 1000000 }),
  ];
  return state;
}

const open = (page: Page) =>
  seed(page, moneyState(), { clock: new Date(2026, 10, 8, 18), route: '/' });

test('the Sunday review asks exactly three figures, labels each change, and sets one priority', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Record Money review', exact: true }).click();
  await expect(page.getByLabel('Cash ($)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Total savings ($)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Total debt ($)', { exact: true })).toBeVisible();
  await expect(page.getByText(/Savings target|Upcoming expenses/)).toHaveCount(0);
  // Debt is compared with the review that last reported it (Oct 25), not the blank Nov 1 one.
  await expect(page.getByText(`${displayDate(OCT25)}: $5,000.00`)).toBeVisible();
  await page.getByLabel('Total debt ($)', { exact: true }).fill('4,700');
  await expect(
    page.getByText(`${displayDate(OCT25)}: $5,000.00  ·  −$300.00 since then`),
  ).toBeVisible();
  await page.getByLabel('Total savings ($)', { exact: true }).fill('2400');
  await expect(
    page.getByText(`${displayDate(NOV1)}: $2,500.00  ·  −$100.00 since then`),
  ).toBeVisible();
  await page
    .getByLabel("This week's priority (optional)", { exact: true })
    .fill('Call the lender about the due date');
  await page.screenshot({ path: 'test-results/money-review.png' });
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Money review', exact: true })).toBeVisible();
  let state = await saved(page);
  expect(state.moneyReviews.at(-1)).toMatchObject({
    date: SUN,
    cash: null,
    savings: 240000,
    debt: 470000,
    upcoming: null,
    savingsTarget: null,
    nextAction: 'Call the lender about the due date',
  });
  // The earlier review's extra fields are left as they were.
  expect(state.moneyReviews.find((r) => r.id === 'b')).toMatchObject({
    upcoming: 12000,
    savingsTarget: 1000000,
  });
  // The priority comes back on Today and can be marked done without affecting Day Cleared.
  const card = page.getByTestId('money-priority');
  await openMore(page);
  await expect(card.getByText('Call the lender about the due date')).toBeVisible();
  await expect(card.getByText('Not part of Day Cleared')).toBeVisible();
  await card
    .getByRole('button', { name: 'Mark money priority done: Call the lender about the due date' })
    .click();
  await expect(card.getByText(/^Done · /)).toBeVisible();
  state = await saved(page);
  expect(state.moneyReviews.at(-1)!.priorityDoneAt).toBeTruthy();
  // Progress draws debt and savings on one scale, debt first, with both changes in one sentence.
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  const money = page.getByTestId('card-money');
  await expect(
    money.getByText('Debt down $300.00 and savings up $400.00 since Oct 25', { exact: true }),
  ).toBeVisible();
  // Each check-in is a position on the chart; the readout gives both balances, value first.
  await stepTo(money, displayDate(NOV1));
  await expect(money.getByTestId('chart-readout')).toContainText(
    `Debt not reported · Savings $2,500.00${displayDate(NOV1)}`,
  );
  await stepTo(money, displayDate(SUN));
  await expect(money.getByTestId('chart-readout')).toContainText(
    `Debt $4,700.00 · Savings $2,400.00${displayDate(SUN)}`,
  );
  // The change since the first report is in How far you've come, open at the top, in whole
  // dollars.
  await expect((await showJourney(page)).getByText('$400', { exact: true })).toBeVisible();
  // Cash is listed with its check-in, never charted or invented.
  await openFold(page, 'Money check-ins');
  await expect(
    page.getByRole('button', { name: `Edit money check-in for ${displayDate(SUN)}` }),
  ).toContainText('Debt $4,700.00 · Savings $2,400.00');
  // The card's note, folded under About this chart, says there is no payoff date or advice.
  await money.getByRole('button', { name: 'About this chart: Money' }).click();
  await expect(page.getByText(/payoff date|savings target/i)).toHaveCount(1);
  await money.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/money-review-card.png' });
});

test('the review keeps Save near the figures: last values are buttons, the goal and note fold', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Record Money review', exact: true }).click();
  // An empty figure offers its last report as a real button, 44 pt tall in layout. The sheet
  // animates in, so the height is read once it has settled.
  const useDebt = page.getByRole('button', { name: 'Use last Total debt, $5,000.00', exact: true });
  await expect(useDebt).toHaveText('Use $5,000.00');
  await expect.poll(async () => (await useDebt.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await useDebt.click();
  await expect(page.getByLabel('Total debt ($)', { exact: true })).not.toHaveValue('');
  await expect(useDebt).toHaveCount(0);
  // Save follows the figures closely: only the priority and one folded row for the goal and the
  // note sit between the last figure and Save.
  const debt = (await page.getByLabel('Total debt ($)', { exact: true }).boundingBox())!;
  const save = (await page
    .getByRole('button', { name: 'Save review', exact: true })
    .boundingBox())!;
  expect(save.y - debt.y).toBeLessThan(420);
  await expect(page.getByRole('radio', { name: 'Organize my money', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Goal and note \(optional\)/ }).click();
  // The goals the money review's program serves come first; the rest are one tap further.
  await expect(page.getByRole('radio', { name: 'Organize my money', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Grow my career', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Link to another goal', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Grow my career', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Organize my money', exact: true }).click();
  // The folded row says a goal is chosen under its title, and stays two lines (the title and the
  // summary) at the narrowest phone width.
  await page.setViewportSize({ width: 320, height: 568 });
  const fold = page.getByRole('button', { name: /^Goal and note \(optional\), Goal set/ });
  await expect(fold).toBeVisible();
  await expect(fold.getByText('Goal set', { exact: true })).toBeVisible();
  expect((await fold.boundingBox())!.height).toBeLessThanOrEqual(72);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Money review', exact: true })).toBeVisible();
  expect((await saved(page)).moneyReviews.at(-1)).toMatchObject({ debt: 500000, goalId: 'money' });
});
