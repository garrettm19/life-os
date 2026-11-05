import { test, expect } from '@playwright/test';
import type { Program, State } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { openFold } from './support/progress';
import { saved, seed } from './support/storage';

// Synthetic data only: a cardio objective and a generic rule review with invented rules. The browser
// clock is pinned to a Monday.
const at = (day: number) => new Date(2026, 10, day, 18);
const MON = '2026-11-09';
const TUE = '2026-11-10';

function seedState(): State {
  const base = trainingState();
  const trackers: Program = {
    id: 'trackers',
    title: 'Trackers',
    group: 'Daily',
    goalIds: [],
    routines: [
      {
        id: 'cardio',
        title: 'Cardio',
        duration: 30,
        weekdays: [1, 3, 5],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
        capture: 'activity',
        activities: ['Bike', 'Stairs', 'Other'],
      },
      {
        id: 'rules',
        title: 'Follow my rules',
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
    ...base,
    programs: [trackers],
    ruleBooks: [
      {
        id: 'book',
        routineId: 'rules',
        title: 'My rules',
        checkpoints: [
          { id: 'checkpoint-1', text: 'Planned first' },
          { id: 'checkpoint-2', text: 'Respected the limit' },
        ],
        rules: [
          { id: 'rule-1', title: 'Plan before acting', details: '' },
          { id: 'rule-2', title: 'Stop at the limit', details: '' },
        ],
        updatedAt: '2026-11-01T12:00:00.000Z',
      },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('cardio records activity and minutes; the rule review records answers or a day without it', async ({
  page,
}) => {
  await seed(page, seedState(), { clock: at(9), route: '/' });
  await page.getByRole('button', { name: 'Record Cardio', exact: true }).click();
  await page.getByRole('radio', { name: 'Stairs', exact: true }).click();
  await page.getByLabel('Minutes', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Save and complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Cardio', exact: true })).toBeVisible();
  // The review needs every checkpoint answered; a broken full rule is recorded too.
  await page.getByRole('button', { name: 'Record Follow my rules', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save review', exact: true })).toBeDisabled();
  await expect(page.getByText('Answer the 2 open checkpoints to save.')).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Planned first' })
    .getByRole('radio', { name: 'Yes' })
    .click();
  // The caption names no position: the open checkpoint can be anywhere in the list.
  await expect(page.getByText('Answer the remaining checkpoint to save.')).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Respected the limit' })
    .getByRole('radio', { name: 'N/A' })
    .click();
  await expect(page.getByText(/checkpoints? to save\./)).toHaveCount(0);
  await page.getByRole('button', { name: /Full rules/ }).click();
  await page.getByRole('checkbox', { name: '2. Stop at the limit' }).click();
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  // Clearing the day on screen celebrates; closing it shows the cleared board.
  await expect(page.getByTestId('celebration')).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  let state = await saved(page);
  expect(state.activitySessions[0]).toMatchObject({ activity: 'Stairs', minutes: 35, date: MON });
  expect(state.ruleReviews[0]).toMatchObject({
    outcome: 'reviewed',
    violations: ['rule-2'],
    answers: [
      { checkpointId: 'checkpoint-1', answer: 'yes' },
      { checkpointId: 'checkpoint-2', answer: 'na' },
    ],
  });
  // Tuesday: no activity is its own outcome and completes the review.
  await page.clock.setFixedTime(at(10));
  await page.goto('/');
  await page.getByRole('button', { name: 'Record Follow my rules', exact: true }).click();
  await page
    .getByRole('button', { name: 'Record a day without the activity', exact: true })
    .click();
  state = await saved(page);
  expect(state.ruleReviews.find((r) => r.date === TUE)).toMatchObject({
    outcome: 'none',
    answers: [],
  });
  await page.goto('/review');
  // Cardio is shown once, in its card: one recorded week is its figure, no chart yet.
  await expect(page.getByRole('button', { name: /^Cardio by week/ })).toHaveCount(0);
  const cardio = page.getByTestId('card-cardio');
  await expect(
    cardio.getByText('35 cardio minutes recorded in the last 4 weeks', { exact: true }),
  ).toBeVisible();
  await expect(cardio.getByText('The next week with cardio starts the chart.')).toBeVisible();
  await expect(cardio.getByTestId('chart')).toHaveCount(0);
  // Rule adherence is folded under History and details.
  await openFold(page, 'Rules');
  await expect(
    page.getByText('1 reviewed · 0 fully followed · 1 without the activity'),
  ).toBeVisible();
  await expect(page.getByText('100% of applicable checkpoints kept')).toBeVisible();
  await page.screenshot({ path: 'test-results/trackers-review.png', fullPage: true });
});
