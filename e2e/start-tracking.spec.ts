import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import { DEMO_ROTATION } from '../src/domain/demo-catalog';
import { STUDY_PREFIX, TRADING_PREFIX } from '../src/state/session-store';
import { saved, seed } from './support/storage';

// Start tracking: the demo's programs become the device's own and its fictional six weeks are
// cleared. The browser clock is Monday, November 9, 2026, 9:00, a training day of the rotation.

const TODAY = '2026-11-09';
const MARKER = 'DEMO · fictional person and records';
const RECORDS = [
  'measurements',
  'lifeLog',
  'workoutSessions',
  'moneyReviews',
  'intervalSessions',
  'activitySessions',
  'ruleReviews',
  'focuses',
  'weeklyReviews',
  'skillCheckpoints',
] as const;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const demoTitle = (id: string) =>
  demoState(TODAY)
    .programs.flatMap((p) => p.routines)
    .find((r) => r.id === id)!.title;

const heading = (page: Page) =>
  page.getByRole('heading', { name: 'Start tracking with these programs?', exact: true });

async function expectFreshStart(page: Page) {
  const state = await saved(page);
  expect(state.source).toBe('personal');
  expect(Object.keys(state.days)).toEqual([TODAY]);
  expect(state.days[TODAY].blocks.every((b) => b.status === 'planned')).toBe(true);
  for (const key of RECORDS) expect([key, state[key]]).toEqual([key, []]);
  const demo = demoState(TODAY);
  expect(state.programs.map((p) => p.id)).toEqual(demo.programs.map((p) => p.id));
  expect(state.goals).toEqual(demo.goals);
  expect(state.workoutTemplates).toHaveLength(demo.workoutTemplates.length);
  expect(state.intervalRoutines).toHaveLength(1);
  expect(state.ruleBooks[0].trading!.since).toBe(TODAY);
}

test('Start tracking keeps the demo programs, clears its history and starts Today fresh', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByText(MARKER)).toBeVisible();
  // A study session from the demo, which a whole-state replacement clears, and a trading record
  // an earlier build kept on the device, which is left alone: the demo's trading sessions are in
  // its saved data, and go with it.
  const slots = [`${STUDY_PREFIX}${TODAY}:demo-study`, `${TRADING_PREFIX}${TODAY}`];
  await page.evaluate((keys) => keys.forEach((k) => localStorage.setItem(k, '{}')), slots);

  // Closing the confirmation changes nothing.
  const start = page.getByRole('button', { name: 'Start tracking with the demo programs' });
  await start.click();
  await expect(heading(page)).toBeVisible();
  await expect(page.getByText(/clears the demo's six weeks of fictional history/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(heading(page)).toHaveCount(0);
  expect((await saved(page)).source).toBe('demo');

  await start.click();
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click();
  await expect(heading(page)).toHaveCount(0);
  await expect(page.getByText(MARKER)).toHaveCount(0);
  await expect(start).toHaveCount(0);
  // Today's due objectives, with the rotation back at its first workout and no streak yet.
  await expect(page.getByRole('button', { name: /^Mark Morning done/ })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Mark Coding practice done',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Start ${demoTitle(DEMO_ROTATION[0])}`, exact: true }),
  ).toBeVisible();
  // Today gives no objective more weight: no study streak line; Progress keeps it.
  await expect(page.getByText(/^Study streak/)).toHaveCount(0);
  await expectFreshStart(page);
  expect(await page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), slots)).toEqual([
    null,
    '{}',
  ]);
  expect((await saved(page)).tradingSessions).toEqual({});

  // Progress shows no fictional records; Week projects the rotation from its first workout.
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(
    page.getByTestId('card-money').getByText('Add a money check-in to start the lines.'),
  ).toBeVisible();
  await expect(page.getByText('No skill checkpoint recorded yet.')).toBeVisible();
  await expect(
    page
      .getByTestId('card-strength')
      .getByText('Finish a workout with logged sets to start the line.'),
  ).toBeVisible();
  await expect(page.getByTestId('chart')).toHaveCount(0);
  await expect(page.getByText(/Back squat 185/)).toHaveCount(0);
  await expect(page.getByText(MARKER)).toHaveCount(0);
  await page.getByRole('link', { name: 'Week', exact: true }).click();
  await expect(page.getByText('Back / Biceps A · projected', { exact: true })).toBeVisible();
  await expect(page.getByText(MARKER)).toHaveCount(0);

  // A reload keeps it: the plan is the device's own now.
  await page.reload();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Mark Morning done/ })).toBeVisible();
  await expect(page.getByText(MARKER)).toHaveCount(0);
  await expectFreshStart(page);
});

test('Settings offers Start tracking beside Reset while the demo is loaded', async ({ page }) => {
  await seed(page, demoState(TODAY), { clock: new Date(2026, 10, 9, 9), route: '/settings' });
  await page
    .getByRole('button', { name: 'Start tracking with these programs', exact: true })
    .click();
  await expect(heading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click();
  await expect(
    page.getByText('Tracking started. Today starts fresh with these programs.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start tracking with these programs', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(MARKER)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Reset this device’s plan', exact: true }),
  ).toBeVisible();
  const state = await saved(page);
  expect(state.source).toBe('personal');
  expect(state.days).toEqual({});
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Mark Morning done/ })).toBeVisible();
  await expectFreshStart(page);
});

test('Start tracking from another screen opens Today with the fresh plan', async ({ page }) => {
  await seed(page, demoState(TODAY), { clock: new Date(2026, 10, 9, 9), route: '/trading' });
  await page.getByRole('button', { name: 'Start tracking with the demo programs' }).click();
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: /^Mark Morning done/ })).toBeVisible();
  await expect(page.getByText(MARKER)).toHaveCount(0);
  await expectFreshStart(page);
});
