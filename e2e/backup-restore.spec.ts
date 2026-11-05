import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { openBasic } from './support/basic';
import { nextMonday } from './support/dates';
import { chooseBackup, restoreFromToday } from './support/files';
import { encodeBackup } from '../src/domain/backup';
import { endSession } from '../src/domain/trading-live';
import { LIVE, begun, cockpitState, expectStatus, openCockpit, profileOf } from './support/cockpit';
import { TRADING_ROUTINE } from './support/trading-state';
import { failSaves, restoreSaves, SAVE_FAILED_TEXT, saved, writeState } from './support/storage';

// Export and restore of a whole backup, on synthetic data: nothing is replaced before the restore
// is confirmed, and a backup that cannot be read or saved leaves the saved data as it was.
const date = nextMonday();
// Monday, November 9, 2026, standard time in New York (UTC-5): a fixed candle with a pinned clock.
const MON = '2026-11-09';
const NY = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h + 5, m)).toISOString();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('downloaded backup restores complete history only after confirmation; cancel preserves changes', async ({
  page,
}) => {
  await openBasic(page, date);
  await page.getByRole('button', { name: 'Mark Morning reset done', exact: true }).click();
  const before = await saved(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Backup and restore', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloadEvent;
  const raw = await readFile((await download.path())!, 'utf8');
  const exported = JSON.parse(raw);
  expect(exported.format).toBe('life-os-backup');
  expect(exported.state).toEqual(before);
  // Backup sits on top of Settings: Back returns there.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Goals, / }).click();
  await page
    .getByRole('textbox', { name: 'Goal name', exact: true })
    .fill('A later synthetic goal');
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit goal A later synthetic goal', exact: true }),
  ).toBeVisible();
  const later = await saved(page);
  await page.getByRole('button', { name: 'Backup and restore', exact: true }).click();
  await chooseBackup(page, raw);
  await expect(
    page.getByText('4 goals · 4 programs · 1 planned day', { exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toEqual(later);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await saved(page)).toEqual(later);
  await chooseBackup(page, raw);
  await page
    .getByRole('button', { name: 'Restore and replace saved data', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/backup-restore-confirmation.png' });
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(
    page.getByText(
      'Backup restored on this device. Goals, programs and recorded history are available.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  // The restored history, recorded as backed up at the time of that backup.
  expect(await saved(page)).toEqual({
    ...before,
    settings: { ...before.settings, lastBackupAt: exported.createdAt },
  });
});

test('the empty Today restores a backup from its first button; closing the preview changes nothing', async ({
  page,
}) => {
  // A synthetic backup with live trading on: everything comes back except that switch.
  const backup = cockpitState(LIVE);
  const createdAt = '2026-11-08T23:30:00.000Z';
  const raw = encodeBackup(backup, createdAt);
  const days = Object.keys(backup.days).length;
  // The static page offers nothing before saved data has loaded.
  const html = await (await page.request.get('/')).text();
  expect(html).not.toContain('Restore my backup');
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
  await page.goto('/');
  await expect(
    page.getByText('Restore your backup, start with your setup, or explore.', { exact: true }),
  ).toBeVisible();
  // Your own backup is the filled primary; a setup and the demo are quiet rows under it.
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
  const restoreBox = (await page
    .getByRole('button', { name: 'Restore my backup', exact: true })
    .boundingBox())!;
  for (const name of ['Load my setup', 'Explore demo'])
    expect(
      (await page.getByRole('button', { name, exact: true }).boundingBox())!.y,
    ).toBeGreaterThan(restoreBox.y);

  // The picker opens at once; the preview shows what the backup holds, and Close changes nothing.
  await restoreFromToday(page, raw);
  await expect(page.getByText('Replace this device’s saved data?', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      `${backup.goals.length} goals · ${backup.programs.length} programs · ${days} planned ${days === 1 ? 'day' : 'days'}`,
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await saved(page))?.programs ?? []).toEqual([]);
  await expect(page.getByRole('button', { name: 'Restore my backup', exact: true })).toBeVisible();

  // A file that is not a backup is refused on Today, and nothing is saved.
  await restoreFromToday(page, '{bad');
  await expect(
    page.getByText('This backup is not valid JSON. Your saved data has not changed.', {
      exact: true,
    }),
  ).toBeVisible();
  expect((await saved(page))?.programs ?? []).toEqual([]);

  await restoreFromToday(page, raw);
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  const done = page.getByTestId('restore-done');
  await expect(
    done.getByText(
      'Backup restored on this device. Goals, programs and recorded history are available.',
      { exact: true },
    ),
  ).toBeVisible();
  for (const step of [
    /^• Add the Life OS widgets to your Home Screen and Lock Screen again/,
    /^• The widget's Day Cleared status is off/,
    /^• After a reinstall or on a new phone, allow notifications/,
    /^• Live trading is off: turn it on again in Your limits/,
  ])
    await expect(done.getByText(step)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore my backup', exact: true })).toHaveCount(0);
  const after = await saved(page);
  expect(after.programs).toEqual(backup.programs);
  expect(after.goals).toEqual(backup.goals);
  expect(after.settings.lastBackupAt).toBe(createdAt);
  // Live trading comes back off; the rest of the trading profile is as backed up.
  const { liveTrading: _on, ...rest } = profileOf(backup);
  expect(profileOf(after)).toEqual(rest);
  await page.getByRole('button', { name: 'Hide this notice', exact: true }).click();
  await expect(done).toHaveCount(0);
});

test('corrupt backups and failed restore writes leave saved data intact; retry recovers', async ({
  page,
}) => {
  await openBasic(page, date);
  await page.getByRole('button', { name: 'Mark Morning reset done', exact: true }).click();
  const before = await saved(page);
  await page.goto('/backup');
  await chooseBackup(page, '{bad');
  await expect(
    page.getByText('This backup is not valid JSON. Your saved data has not changed.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await saved(page)).toEqual(before);
  const target = JSON.parse(JSON.stringify(before));
  target.notes = ['Synthetic restored note'];
  const backup = {
    format: 'life-os-backup',
    version: 5,
    createdAt: '2026-10-04T23:30:00.000Z',
    state: target,
  };
  await chooseBackup(page, JSON.stringify({ ...backup, version: 99 }));
  await expect(
    page.getByText(
      'Choose a supported Life OS backup (version 1 to 5). Setup files are imported separately.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await chooseBackup(page, JSON.stringify(backup));
  await failSaves(page, 'Synthetic persistence failure');
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(page.getByText(SAVE_FAILED_TEXT, { exact: true })).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await restoreSaves(page);
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(
    page.getByText(
      'Backup restored on this device. Goals, programs and recorded history are available.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await saved(page)).toEqual({
    ...target,
    settings: { ...target.settings, lastBackupAt: backup.createdAt },
  });
});

test('trading sessions go into the backup, and restoring it brings them back as saved', async ({
  page,
}) => {
  // Monday's locked session at 9:45 AM New York, then a later change the restore rolls back.
  const started = begun(cockpitState(), NY(9, 40), {}, NY(9, 35));
  const kept = started.tradingSessions[MON];
  await openCockpit(page, { state: started, clock: new Date(NY(9, 45)), route: '/backup' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const raw = await readFile((await (await downloadEvent).path())!, 'utf8');
  const exported = JSON.parse(raw);
  expect(exported.version).toBe(5);
  expect(exported.state.tradingSessions).toEqual({ [MON]: kept });
  await writeState(page, endSession(started, TRADING_ROUTINE, 'hard-stop', NY(9, 50)));
  await page.reload();
  await chooseBackup(page, raw);
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(page.getByText(/^Backup restored on this device/)).toBeVisible();
  expect((await saved(page)).tradingSessions).toEqual({ [MON]: kept });
  await page.goto('/trading');
  await expectStatus(page, 'WAITING FOR ZONE');

  // A backup from before sessions were kept in backups says what restoring it replaces.
  const v4 = JSON.parse(raw);
  v4.version = 4;
  v4.state.version = 4;
  delete v4.state.tradingSessions;
  delete v4.state.tradingSessionsImported;
  await page.goto('/backup');
  await chooseBackup(page, JSON.stringify(v4));
  await expect(
    page.getByText(/^This backup was made before trading sessions were kept in backups/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(page.getByText(/^Backup restored on this device/)).toBeVisible();
  const after = await saved(page);
  expect(after.tradingSessions).toEqual({});
  // This device's earlier records were already moved in: they stay moved in.
  expect(after.tradingSessionsImported).toBe(true);
});
