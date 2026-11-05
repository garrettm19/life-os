import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { basicState } from '../src/test-support/basic-state';
import { shiftDate } from '../src/domain/model';
import { generateDay } from '../src/domain/planner';
import { chooseBackup } from './support/files';
import { failSaves, restoreSaves, SAVE_FAILED_TEXT, saved, seed } from './support/storage';
import { openMore } from './support/today';

// A routine bundled into another as a step, on synthetic data.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('bundled completion is independent, persists through plan changes and backup restore, and counts in Week', async ({
  page,
}) => {
  // The clock is pinned to a Monday, so that Monday is today and can still be planned.
  const monday = '2026-11-09';
  const state = basicState();
  state.programs[1].routines[0].weekdays = [1, 5];
  state.programs[1].routines[0].duration = 90;
  state.programs.push({
    id: 'accessory',
    title: 'Accessory program',
    group: 'Synthetic',
    goalIds: [],
    routines: [
      {
        ...state.programs[1].routines[0],
        id: 'accessory-1',
        title: 'Accessory practice',
        duration: null,
        bundledInto: 'strength',
        steps: ['Example step'],
      },
    ],
  });
  for (const date of [monday, shiftDate(monday, 4)])
    state.days[date] = generateDay(date, state.settings, state.programs);
  await seed(page, state, { clock: new Date(2026, 10, 9, 9), route: '/?date=' + monday });
  const parentCard = page.getByTestId('row:Strength session');
  await parentCard.getByRole('button', { name: 'Mark Strength session done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Mark Accessory practice done', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Skip Accessory practice', exact: true }).click();
  await page.getByRole('button', { name: 'Undo Accessory practice', exact: true }).click();
  const before = await saved(page);
  await failSaves(page, 'Synthetic completion failure');
  await page.getByRole('button', { name: 'Mark Accessory practice done', exact: true }).click();
  await expect(page.getByText(SAVE_FAILED_TEXT, { exact: true })).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await restoreSaves(page);
  await page.getByRole('button', { name: 'Mark Accessory practice done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Accessory practice', exact: true }),
  ).toBeVisible();
  await page.reload();
  await openMore(page);
  await page.getByRole('button', { name: 'Generate day', exact: true }).click();
  await page.getByRole('button', { name: 'Replan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Accessory practice', exact: true }),
  ).toBeVisible();
  const recorded = await saved(page);
  const parent = recorded.days[monday].blocks.find((b) => b.programId === 'strength')!;
  expect(parent.duration).toBe(90);
  expect(parent.bundledSteps![0].status).toBe('done');
  expect(recorded.days[monday].blocks.some((b) => b.programId === 'accessory')).toBe(false);
  await page
    .getByRole('button', { name: 'Undo Accessory practice', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/bundled-routines.png' });
  await page.getByRole('link', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: /^Program coverage/ }).click();
  // One line per program: done against this week's occurrences, then what is still open.
  const coverageCard = page.getByText('Accessory program', { exact: true }).locator('..');
  await expect(
    coverageCard.getByText('1 of 2 done this week · 1 still open', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/configured occurrence|Configure frequency|choose days/)).toHaveCount(
    0,
  );
  await page.goto('/backup');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const raw = await readFile((await (await event).path())!, 'utf8');
  expect(JSON.parse(raw).state).toEqual(recorded);
  await chooseBackup(page, raw);
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(
    page.getByText(
      'Backup restored on this device. Goals, programs and recorded history are available.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto('/?date=' + monday);
  await expect(
    page.getByRole('button', { name: 'Undo Accessory practice', exact: true }),
  ).toBeVisible();
});
