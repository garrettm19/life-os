import { test, expect } from '@playwright/test';
import { encodeBackup } from '../src/domain/backup';
import { demoState } from '../src/domain/demo';
import type { State } from '../src/domain/model';
import { chooseBackup } from './support/files';
import { savedText, seed } from './support/storage';

// The restore preview on the device: an older backup (fictional demo data) with replaced, removed
// and added records and different settings. The preview shows labels and counts, never values,
// and closing it changes nothing. The browser clock is Monday, November 9, 2026, 9:00.

const TODAY = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);
const device = (): State => ({ ...demoState(TODAY), source: 'personal' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('restoring an older backup says what it replaces, removes and adds, without values', async ({
  page,
}) => {
  // This device has one goal more than the backup (a goal no program uses yet).
  const base = device();
  const current: State = {
    ...base,
    goals: [...base.goals, { id: 'demo-later', title: 'A later goal', desiredState: '' }],
  };
  const older: State = {
    ...base,
    settings: { ...current.settings, wake: current.settings.wake + 30 },
    moneyReviews: base.moneyReviews.map((r, i) => (i === 0 ? { ...r, debt: 999_00 } : r)),
    measurements: [
      ...base.measurements.slice(2),
      { ...base.measurements[0], id: 'w-older', date: '2026-08-01' },
    ],
  };
  await seed(page, current, { clock: NINE, route: '/backup' });
  const before = await savedText(page);
  await chooseBackup(
    page,
    encodeBackup(older, new Date(2026, 9, 20, 12).toISOString()),
    'older-backup.json',
  );
  await expect(page.getByText('What restoring changes on this device')).toBeVisible();
  await expect(
    page.getByText(`goals: 1 removed (you have ${current.goals.length})`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `money reviews: 1 replaced by the backup's version (you have ${current.moneyReviews.length})`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `weights: 2 removed, 1 added from the backup (you have ${current.measurements.length})`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Settings: the backup's settings replace yours", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/restore-preview.png' });
  // No value from either side: no amount, no weight.
  const sheet = await page
    .getByText('What restoring changes on this device')
    .locator('..')
    .innerText();
  expect(sheet).not.toMatch(/\$|\d+(\.\d+)? ?(lb|kg)\b|999/);
  // Closing restores nothing.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await savedText(page)).toBe(before);
});

test('a backup of exactly this data says so', async ({ page }) => {
  const current = device();
  await seed(page, current, { clock: NINE, route: '/backup' });
  await chooseBackup(
    page,
    encodeBackup(current, new Date(2026, 10, 9, 8).toISOString()),
    'same-backup.json',
  );
  await expect(
    page.getByText('This backup holds exactly the data on this device.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('What restoring changes on this device')).toHaveCount(0);
});
