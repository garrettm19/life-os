import { expect, type Page } from '@playwright/test';

/** Taps `button`, which opens the file picker, and picks one JSON file. */
async function chooseJson(page: Page, button: string, name: string, content: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button, exact: true }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
}

/** On Backup and restore, picks the backup file `raw` to preview a restore. */
export function chooseBackup(page: Page, raw: string, name = 'synthetic-backup.json') {
  return chooseJson(page, 'Choose backup to restore', name, raw);
}

/** On the empty Today, taps Restore my backup and picks the backup file `raw`. */
export function restoreFromToday(page: Page, raw: string, name = 'LifeOS-backup-synthetic.json') {
  return chooseJson(page, 'Restore my backup', name, raw);
}

/** Picks `setup` as the setup file to import (the button must be on screen). */
export function chooseSetup(page: Page, setup: unknown, name = 'synthetic-setup.json') {
  return chooseJson(page, 'Choose setup file', name, JSON.stringify(setup));
}

/** On a device with no programs yet, imports `setup` from Settings as its preview shows it. */
export async function importSetup(page: Page, setup: unknown, name: string) {
  await page.goto('/settings');
  await chooseSetup(page, setup, name);
  await page.getByRole('button', { name: 'Import this setup', exact: true }).click();
  await expect(page.getByText('Setup imported', { exact: true })).toBeVisible();
}
