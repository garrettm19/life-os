import { test, expect } from '@playwright/test';
import { emptyState } from '../src/domain/model';
import { saved, seed } from './support/storage';

// The browser clock is pinned to a Monday so "today" is known.
const at = (day: number) => new Date(2026, 10, day, 9);
const MON = '2026-11-09';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('an alternating routine shows the right variant, its steps and links; a missed day owes nothing', async ({
  page,
}) => {
  await seed(page, { ...emptyState(), source: 'personal' }, { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Program name').fill('Daily');
  await page.getByLabel('Routine name', { exact: true }).fill('Mobility');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('switch', { name: 'Alternate daily between two variants' }).click();
  await page.getByLabel('First variant (today if new)').fill('Upper');
  await page.getByLabel('First variant steps (one per line)').fill('Door stretch\nWall slides');
  await page.getByLabel('Second variant', { exact: true }).fill('Lower');
  await page.getByLabel('Second variant steps (one per line)').fill('Ankle rocks');
  await page
    .getByLabel('Links (optional, one per line: Label | https://…)')
    .fill('Guide | https://example.com/guide');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const state = await saved(page);
  const routine = state.programs[0].routines[0];
  expect(routine.alternate).toEqual({
    anchor: MON,
    variants: [
      { title: 'Upper', steps: ['Door stretch', 'Wall slides'] },
      { title: 'Lower', steps: ['Ankle rocks'] },
    ],
  });
  expect(routine.links).toEqual([{ label: 'Guide', url: 'https://example.com/guide' }]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mark Mobility · Upper done' })).toBeVisible();
  await page.getByRole('button', { name: 'Show 2 steps for Mobility · Upper' }).click();
  await expect(page.getByText('Wall slides')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Guide' })).toBeVisible();
  await page.screenshot({ path: 'test-results/habits-instructions.png' });
  // Two days are never opened; Thursday takes its own variant.
  await page.clock.setFixedTime(at(12));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mark Mobility · Lower done' })).toBeVisible();
});

test('an optional weigh-in sits in the list, marked Optional, and never blocks Day Cleared', async ({
  page,
}) => {
  await seed(page, { ...emptyState(), source: 'personal' }, { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Program name').fill('Daily');
  await page.getByLabel('Routine name', { exact: true }).fill('Morning reset');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await page.getByRole('button', { name: 'Add another objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Body-weight check-in', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Morning weigh-in');
  // A new weigh-in starts optional.
  await expect(
    page.getByRole('switch', { name: 'Optional, never required for Day Cleared' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await page.goto('/');
  // One list, no Optional section: the weigh-in says so quietly in its own caption.
  await expect(
    page.getByTestId('row:Morning weigh-in').getByText('Record weight · Optional', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/never blocks Day Cleared/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Morning reset done', exact: true }).click();
  // Clearing the day on screen celebrates; closing it shows the cleared board.
  await expect(page.getByTestId('celebration')).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  const state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.title === 'Morning weigh-in')!).toMatchObject({
    optional: true,
    status: 'planned',
  });
  await page.screenshot({ path: 'test-results/habits-optional.png' });
});
