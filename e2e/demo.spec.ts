import { test, expect } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import { scanPage } from './support/layout-probe';
import { showJourney } from './support/progress';
import { saved, seed } from './support/storage';

// Explore demo: the fictional six weeks, loaded from the empty app, and its screens at phone widths.
// The browser clock is Monday, November 9, 2026, 9:00, so the demo ends on that day.

const TODAY = '2026-11-09';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
});

test('the empty app offers my backup, my setup or the demo; Load my setup opens the import', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByText('Restore your backup, start with your setup, or explore.'),
  ).toBeVisible();
  // The card is the one next step: no second instruction under it.
  await expect(page.getByText(/^No objectives yet/)).toHaveCount(0);
  // Your own backup is the filled primary (backup-restore.spec.ts restores from it); your setup and
  // the fictional demo are quiet rows under it.
  // The fill is drawn by the pressable's animated view inside the button.
  const fill = (name: string) =>
    page
      .getByRole('button', { name, exact: true })
      .locator('> div')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  // Dark tokens: the primary is filled in `label`; the rows have no fill of their own.
  expect(await fill('Restore my backup')).toBe('rgb(245, 241, 235)');
  expect(await fill('Load my setup')).toBe('rgba(0, 0, 0, 0)');
  expect(await fill('Explore demo')).toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Load my setup', exact: true }).click();
  // The import leads Settings on an empty device: its button is on screen without scrolling.
  await expect(
    page.getByRole('button', { name: 'Choose setup file', exact: true }),
  ).toBeInViewport();
  // Opening the import saves nothing.
  expect((await saved(page))?.programs ?? []).toEqual([]);
});

test('Explore demo loads the fictional six weeks, labeled as a demo, on every screen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByText('DEMO · fictional person and records')).toBeVisible();
  const state = await saved(page);
  expect(state.source).toBe('demo');
  expect(JSON.stringify(state.programs)).toBe(JSON.stringify(demoState(TODAY).programs));
  // Today: one list, a row per objective (study included), today's workout from the rotation.
  await expect(page.getByRole('button', { name: /^Mark Morning done/ })).toBeVisible();
  await expect(page.getByText(/^Mobility · /).first()).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Mark Coding practice done',
      exact: true,
    }),
  ).toBeVisible();
  // Trading practice is paused: nothing about it on Today.
  await expect(page.getByTestId('trading-caption')).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /^Start (Chest \/ Triceps \/ Shoulders|Back \/ Biceps|Legs) [AB]$/,
    }),
  ).toHaveCount(1);
  await page.screenshot({ path: 'test-results/demo-full-today.png', fullPage: true });
  // Programs holds the wider life: every goal, and the paused trading practice and its cockpit.
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  await page.getByRole('button', { name: /^Life goals/ }).click();
  const goals = page.getByTestId('goal-map');
  await expect(goals).toContainText('Close friends and a social life');
  await expect(goals).toContainText('No scheduled objective');
  await expect(goals).toContainText('Engineering skills · Career steps');
  await expect(
    page.getByRole('button', {
      name: 'Open the trading cockpit for Follow my trading plan',
      exact: true,
    }),
  ).toBeVisible();
  for (const [name, route] of [
    ['week', '/week'],
    ['programs', '/programs'],
    ['review', '/review'],
    ['trading', '/trading'],
  ]) {
    await page.goto(route);
    await expect(page.getByText('DEMO · fictional person and records')).toBeVisible();
    await page.screenshot({ path: `test-results/demo-full-${name}.png`, fullPage: true });
  }
  // Progress keeps the long view, open: weeks of cleared days, and body weight since the first
  // weigh-in.
  await page.goto('/review');
  await showJourney(page);
  await expect(page.getByTestId('journey-weeks')).toBeAttached();
  await expect(page.getByTestId('journey').getByText('Body weight', { exact: true })).toBeVisible();
});

test('a training focus shows its workouts in the course correction, not also as a tile', async ({
  page,
}) => {
  const state = demoState(TODAY);
  await seed(page, state, { route: '/review' });
  await expect(page.getByLabel(/^Workouts done: \d+ of \d+$/)).toBeVisible();
  state.focuses = state.focuses.map((f) => ({ ...f, evidence: 'training' as const }));
  await seed(page, state, { route: '/review' });
  await expect(page.getByText('Workouts finished', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Workouts done:/)).toHaveCount(0);
});

test('Programs names each program as a heading, and the trading editor points to Trading', async ({
  page,
}) => {
  await seed(page, demoState(TODAY), { route: '/programs' });
  // The headings rotor moves between programs and the group labels above them.
  for (const title of ['Morning foundations', 'Career steps', 'Trading practice', 'Paused'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Configure Follow my trading plan', exact: true }).click();
  await expect(page.getByText(/Its rules and limits are on the Trading page\.$/)).toBeVisible();
  await expect(page.getByText(/You add the rules after saving/)).toHaveCount(0);
});

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
]) {
  test(`the demo's screens fit a ${width}-point phone`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await seed(page, demoState(TODAY));
    for (const route of ['/', '/week', '/programs', '/review', '/trading', '/bias-board']) {
      await page.goto(route);
      await expect(page.getByText('DEMO · fictional person and records')).toBeVisible();
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(sideways, `${route} scrolls sideways`).toBeLessThanOrEqual(0);
      const issues = await scanPage(page, height, 25);
      expect(issues.map((i) => `${route}: ${i.kind} ${i.text} (${i.detail})`)).toEqual([]);
    }
  });
}
