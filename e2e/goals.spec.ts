import { test, expect } from '@playwright/test';
import { openBasic } from './support/basic';
import { nextMonday } from './support/dates';
import { saved } from './support/storage';

// Goals in Settings, on synthetic data: edits keep programs and recorded days as they are.
const date = nextMonday();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('goal edits preserve links and history after reload; closing does not save a draft', async ({
  page,
}) => {
  await openBasic(page, date);
  await page.getByRole('button', { name: 'Mark Morning reset done', exact: true }).click();
  const before = await saved(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Goals, / }).click();
  await page.getByRole('button', { name: 'Edit goal Build strength', exact: true }).click();
  await page.getByLabel('Goal title', { exact: true }).fill('Draft that should not save');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit goal Build strength', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit goal Build strength', exact: true }).click();
  await expect(page.getByLabel('Goal title', { exact: true })).toHaveValue('Build strength');
  await page.getByLabel('Goal title', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Save goal changes', exact: true })).toBeDisabled();
  await page.getByLabel('Goal title', { exact: true }).fill('Example strength target');
  await page
    .getByLabel('Success criteria', { exact: true })
    .fill('Record planned sessions for four weeks');
  await page.screenshot({ path: 'test-results/goals-editor.png' });
  await page.getByRole('button', { name: 'Save goal changes', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Goals, / }).click();
  await expect(
    page.getByRole('button', { name: 'Edit goal Example strength target', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Record planned sessions for four weeks', { exact: true }),
  ).toBeVisible();
  const after = await saved(page);
  expect(after.programs).toEqual(before.programs);
  expect(after.days).toEqual(before.days);
  expect(after.goals.find((goal) => goal.id === 'vitality')!.title).toBe('Example strength target');
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Programs' })).toBeVisible();
  await expect(
    page.getByText('Example strength target', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
});

test('a new goal says what enables Save goal until it has a name', async ({ page }) => {
  await openBasic(page, date);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Goals, / }).click();
  const save = page.getByRole('button', { name: 'Save goal', exact: true });
  const needs = page.getByText('Give the goal a name to save it.', { exact: true });
  await expect(save).toBeDisabled();
  await expect(needs).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Goal name', exact: true }).fill('A synthetic goal');
  await expect(save).toBeEnabled();
  await expect(needs).toHaveCount(0);
});

test('two goals added at the same clock time keep separate ids and both survive a reload', async ({
  page,
}) => {
  await openBasic(page, date);
  // Date.now() returns one instant for the rest of the test; timers keep running.
  await page.clock.setFixedTime(new Date(2026, 10, 9, 9));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Goals, / }).click();
  const name = page.getByRole('textbox', { name: 'Goal name', exact: true });
  const save = page.getByRole('button', { name: 'Save goal', exact: true });
  for (const title of ['First synthetic goal', 'Second synthetic goal']) {
    await name.fill(title);
    await save.click();
    await expect(name).toHaveValue('');
  }
  const goals = (await saved(page)).goals;
  const added = goals.filter((goal) => goal.title.endsWith('synthetic goal'));
  expect(added.map((goal) => goal.title)).toEqual([
    'First synthetic goal',
    'Second synthetic goal',
  ]);
  expect(new Set(goals.map((goal) => goal.id)).size).toBe(goals.length);
  await page.reload();
  await page.getByRole('button', { name: /^Goals, / }).click();
  for (const title of ['First synthetic goal', 'Second synthetic goal'])
    await expect(
      page.getByRole('button', { name: `Edit goal ${title}`, exact: true }),
    ).toBeVisible();
});
