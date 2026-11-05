import { test, expect, type Page } from '@playwright/test';
import type { IntervalPlan } from '../src/domain/model';
import { shiftDate } from '../src/domain/model';
import { encodeBackup } from '../src/domain/backup';
import { circuitState } from './support/circuit-state';
import { nextMonday } from './support/dates';
import { chooseBackup } from './support/files';
import { failSaves, restoreSaves, SAVE_FAILED_TEXT, saved, seed } from './support/storage';

// A paused circuit must never survive a Reset or a restore of the whole plan,
// and must survive a canceled or rejected restore unchanged.
const TUE = shiftDate(nextMonday(), 1);
const slot = `life-os-active-circuit:${TUE}:routine:abs`;
const SHORT: IntervalPlan = {
  prepSeconds: 3,
  steps: [
    { id: 'a', name: 'Plank', seconds: 30, restAfter: 5 },
    { id: 'b', name: 'Hollow hold', seconds: 30, restAfter: 0 },
  ],
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** The paused or finished run kept on the device for Tuesday's circuit, or null. */
const slotValue = (page: Page) => page.evaluate((k) => localStorage.getItem(k), slot);

/** Seeds the plan, starts the circuit, runs it a little and closes it, leaving it paused. */
async function pausedCircuit(page: Page) {
  await seed(page, circuitState(SHORT), { clock: 'now', route: '/?date=' + TUE });
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await page.getByRole('radio', { name: 'Mute', exact: true }).click();
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(10_000);
  await page.getByRole('button', { name: 'Close the timer', exact: true }).click();
  await expect.poll(() => slotValue(page)).not.toBeNull();
}

test('a paused circuit survives closing and reopening the app, and still never completes by itself', async ({
  page,
}) => {
  await pausedCircuit(page);
  await page.reload();
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.clock.runFor(120_000);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect((await saved(page)).intervalSessions).toEqual([]);
});

test('Reset clears a paused circuit along with the plan', async ({ page }) => {
  await pausedCircuit(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Reset this device’s plan', exact: true }).click();
  await page.getByRole('button', { name: 'Clear this device’s plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reset this device’s plan', exact: true }),
  ).toBeVisible();
  expect(await slotValue(page)).toBeNull();
});

test('a restore clears a paused circuit; a canceled or rejected restore keeps it', async ({
  page,
}) => {
  await pausedCircuit(page);
  const before = await slotValue(page);
  // The backup holds the same objective and circuit: the paused run belongs to the old data anyway.
  const backup = encodeBackup(circuitState(SHORT), '2026-01-02T00:00:00.000Z');
  await page.goto('/backup');
  // Rejected: not a backup at all.
  await chooseBackup(page, '{not json');
  await expect(page.getByText(/not valid JSON/)).toBeVisible();
  expect(await slotValue(page)).toBe(before);
  // Canceled: the preview is closed without confirming.
  await chooseBackup(page, backup);
  await expect(
    page.getByRole('button', { name: 'Restore and replace saved data', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await slotValue(page)).toBe(before);
  // A failed save leaves it too.
  await failSaves(page, 'Synthetic restore failure');
  await chooseBackup(page, backup);
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(page.getByText(SAVE_FAILED_TEXT).first()).toBeVisible();
  expect(await slotValue(page)).toBe(before);
  await restoreSaves(page);
  // Confirmed: the plan is replaced and the paused run from the old data is gone.
  await page.getByRole('button', { name: 'Restore and replace saved data', exact: true }).click();
  await expect(page.getByText(/Backup restored on this device/)).toBeVisible();
  expect(await slotValue(page)).toBeNull();
  await page.goto('/?date=' + TUE);
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start the timer', exact: true })).toBeVisible();
});

test('a saved finished run is offered for saving, never recorded on its own', async ({ page }) => {
  const finished = {
    intervalId: 'circuit-1',
    planVersion: '2026-01-01T00:00:00.000Z',
    date: TUE,
    blockId: `${TUE}:routine:abs`,
    run: {
      status: 'finished',
      elapsedMs: 68_000,
      anchor: null,
      startedAt: '2026-01-02T10:00:00.000Z',
      skipped: [],
      endedAt: '2026-01-02T10:01:08.000Z',
    },
  };
  await seed(page, circuitState(SHORT), { clock: 'now' });
  await page.evaluate(([key, run]) => localStorage.setItem(key, JSON.stringify(run)), [
    slot,
    finished,
  ] as const);
  await page.goto('/?date=' + TUE);
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save circuit', exact: true })).toBeVisible();
  expect((await saved(page)).intervalSessions).toEqual([]);
  // Saving is the user's choice.
  await page.getByRole('button', { name: 'Save circuit', exact: true }).click();
  await expect(page.getByText('Circuit complete', { exact: true })).toBeVisible();
  expect((await saved(page)).intervalSessions).toHaveLength(1);
  // Once recorded, no saved run is left to record again.
  expect(await slotValue(page)).toBeNull();
});
