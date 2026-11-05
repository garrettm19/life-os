import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import type { State } from '../src/domain/model';
import { saved, seed } from './support/storage';

// The quiet backup reminder on Today, on the fictional demo marked as personal data with a week of
// recorded history and no export yet. The browser clock is Monday, November 9, 2026, 9:00.

const TODAY = '2026-11-09';
const REMINDER = 'No backup yet: export one to keep your history safe.';

test('Today asks for a first backup once a week is recorded, and an export clears it', async ({
  page,
}) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  const state = { ...demoState(TODAY), source: 'personal' as const };
  await seed(page, state, { clock: new Date(2026, 10, 9, 9), route: '/' });
  await page.getByRole('button', { name: `${REMINDER} Open Backup and restore.` }).click();
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const file = await download;
  // Named by the local date and time, so the right file is easy to pick when restoring.
  expect(file.suggestedFilename()).toMatch(/^LifeOS-backup-2026-11-09-09\d{2}\.json$/);
  // The file never carries the time of the export; the device keeps it.
  const backup = JSON.parse(await readFile((await file.path())!, 'utf8')) as { state: State };
  expect(backup.state.settings.lastBackupAt).toBeUndefined();
  await expect.poll(async () => (await saved(page)).settings.lastBackupAt).toBeTruthy();
  await page.goto('/settings');
  await expect(page.getByText('Last backup: Today', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Today's objectives/ })).toBeVisible();
  await expect(page.getByText(REMINDER)).toHaveCount(0);
});
