import { test, expect } from '@playwright/test';
import { openBasic } from './support/basic';
import { nextMonday } from './support/dates';
import { studyState } from '../src/test-support/fixtures';
import { failSaves, restoreSaves, SAVE_FAILED_TEXT, saved, seed } from './support/storage';
import { openMore } from './support/today';

// Blocks on Today: editing, a time that overlaps another block, and actions with no scheduled
// time. Synthetic data only, on the next Monday after the real date, so the day can be planned.
const date = nextMonday();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a block edit and its completion persist through a reload and Generate day', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openBasic(page, date);
  await expect(page.getByText('DEMO · fictional person and records')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Morning reset' }).click();
  await page.getByLabel('Block name', { exact: true }).fill('A renamed morning reset');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit A renamed morning reset' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark A renamed morning reset done', exact: true })
    .click();
  // The completion is kept, after a reload and a regenerated day too: its row offers Undo.
  const undo = page.getByRole('button', { name: 'Undo A renamed morning reset', exact: true });
  await expect(undo).toBeVisible();
  await page.reload();
  await expect(undo).toBeVisible();
  await openMore(page);
  await page.getByRole('button', { name: 'Generate day', exact: true }).click();
  await expect(undo).toBeVisible();
  await page.screenshot({ path: 'test-results/blocks-today.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('manual conflicting time is rejected and a valid task remains editable', async ({ page }) => {
  await openBasic(page, date);
  await openMore(page);
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Example focus task');
  await page.getByLabel('Start time (24-hour, blank = unscheduled)').fill('10:30');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect(
    page.getByText('That slot overlaps another block. Choose a free time.'),
  ).toBeVisible();
  await page.getByLabel('Start time (24-hour, blank = unscheduled)').fill('15:00');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Example focus task' })).toBeVisible();
  await page.getByRole('link', { name: 'Week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await page.screenshot({ path: 'test-results/blocks-week.png' });
  await page
    .getByRole('link', { name: /Open day$/ })
    .first()
    .click();
  await openMore(page);
  // The week's first day can be in the past: planning a past day is never offered, adding is.
  await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeVisible();
});

test('unscheduled actions can be completed, skipped and undone without inventing calendar time', async ({
  page,
}) => {
  await page.goto('/?date=' + date);
  await openMore(page);
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Block name', exact: true })
    .fill('Example unscheduled task');
  await page.getByRole('textbox', { name: 'Duration in minutes', exact: true }).fill('');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  const card = page.getByTestId('row:Example unscheduled task');
  await expect(
    card.getByRole('button', { name: 'Mark Example unscheduled task done', exact: true }),
  ).toBeVisible();
  const initial = await saved(page);
  const original = initial.days[date].blocks[0];
  expect(original.start).toBeNull();
  expect(original.duration).toBeNull();
  await failSaves(page, 'Synthetic unscheduled save failure');
  await card
    .getByRole('button', { name: 'Mark Example unscheduled task done', exact: true })
    .click();
  await expect(
    page.getByText(SAVE_FAILED_TEXT, { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  expect(await saved(page)).toEqual(initial);
  await restoreSaves(page);
  await card
    .getByRole('button', { name: 'Mark Example unscheduled task done', exact: true })
    .click();
  await expect(
    card.getByText('Completed without a scheduled time.', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Undo Example unscheduled task', exact: true }),
  ).toBeVisible();
  const completed = await saved(page);
  const actual = completed.days[date].blocks[0];
  expect(actual.id).toBe(original.id);
  expect(actual.start).toBeNull();
  expect(actual.duration).toBeNull();
  expect(actual.status).toBe('done');
  expect(actual.actualAt).toEqual(expect.any(String));
  await page.reload();
  await openMore(page);
  await page.getByRole('button', { name: 'Generate day', exact: true }).click();
  await page.getByRole('button', { name: 'Replan', exact: true }).click();
  await expect(
    card.getByText('Completed without a scheduled time.', { exact: true }),
  ).toBeVisible();
  const persisted = await saved(page);
  expect(persisted.days[date].blocks).toEqual(completed.days[date].blocks);
  expect(
    persisted.days[date].revisions.some((revision: { blocks: { status: string }[] }) =>
      revision.blocks.some((block) => block.status === 'done'),
    ),
  ).toBe(true);
  await card.getByRole('button', { name: 'Undo Example unscheduled task', exact: true }).click();
  await card.getByRole('button', { name: 'Skip Example unscheduled task', exact: true }).click();
  await expect(card.getByText('Skipped without a scheduled time.', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Undo Example unscheduled task', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Mark Example unscheduled task done', exact: true }),
  ).toBeVisible();
  await page.reload();
  const restored = await saved(page);
  expect(restored.days[date].blocks[0].status).toBe('planned');
  expect(restored.days[date].blocks[0].actualAt).toBeNull();
  expect(restored.days[date].blocks[0].start).toBeNull();
  expect(restored.days[date].blocks[0].duration).toBeNull();
  await card
    .getByRole('button', { name: 'Mark Example unscheduled task done', exact: true })
    .click();
  await card
    .getByRole('button', { name: 'Undo Example unscheduled task', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/blocks-unscheduled-done.png' });
});

test('a block added to a day that is over is never asked to be scheduled', async ({ page }) => {
  // Synthetic: Monday, November 9 is over; the clock is Thursday the 12th. Monday also holds a
  // block added that morning without a time, with the reason saved then.
  const MON = '2026-11-09';
  const state = studyState();
  state.days[MON] = {
    date: MON,
    revisions: [],
    blocks: [
      {
        id: `${MON}:manual:earlier`,
        routineId: null,
        programId: null,
        title: 'Example errand',
        start: null,
        duration: 30,
        fixed: false,
        steps: [],
        status: 'planned',
        actualAt: null,
        reason: 'Choose a time when this fits.',
      },
    ],
  };
  await seed(page, state, { clock: new Date(2026, 10, 12, 9), route: `/?date=${MON}` });
  await openMore(page);
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Block name', { exact: true }).fill('Called the bank');
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect(page.getByLabel('Block name', { exact: true })).toHaveCount(0);
  for (const title of ['Called the bank', 'Example errand'])
    await expect(page.getByTestId(`row:${title}`)).toContainText('No time set.');
  await expect(page.getByText(/Choose a time/)).toHaveCount(0);
  const added = (await saved(page)).days[MON].blocks.find((b) => b.title === 'Called the bank')!;
  expect(added).toMatchObject({ start: null, reason: null, status: 'planned' });
});
