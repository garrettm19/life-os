import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { trainingState } from '../src/test-support/fixtures';
import { demoState } from '../src/domain/demo';
import { defaultTradingProfile } from '../src/domain/trading';
import { chooseSetup, importSetup } from './support/files';
import { saved, seed } from './support/storage';

// Setup import from Settings, with synthetic setup files only.
const setup = {
  format: 'life-os-setup-v1',
  goals: [],
  programs: [
    {
      id: 'pack-daily',
      title: 'Daily',
      group: 'Daily',
      goalIds: [],
      routines: [
        {
          id: 'pack-reset',
          title: 'Upper body',
          duration: null,
          weekdays: [1],
          preferredStart: null,
          enabled: true,
          fixed: false,
          steps: [],
          bundledInto: null,
          checklist: true,
        },
      ],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Picks `file` from Settings. With programs already set up, the import section starts folded. */
async function choose(page: Page, file: unknown = setup) {
  const section = page.getByRole('button', { name: /^Import a private setup\. Show$/ });
  if (await section.count()) await section.click();
  await chooseSetup(page, file);
}

test('setup import previews additions and same-named routines; closing imports nothing', async ({
  page,
}) => {
  await seed(page, trainingState(), { route: '/settings' });
  const before = await saved(page);
  await choose(page);
  await expect(page.getByText('New programs (1): Daily')).toBeVisible();
  await expect(page.getByText('Same names as your routines')).toBeVisible();
  await expect(page.getByText(/Upper body: yours in Training/)).toBeVisible();
  await expect(page.getByText(/Keeps your settings/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  // Import and pause the existing same-named routine (its history stays).
  await choose(page);
  await page
    .getByRole('button', { name: 'Import and pause the existing routines with the same names' })
    .click();
  await expect(page.getByText('Setup imported', { exact: true })).toBeVisible();
  const state = await saved(page);
  expect(state.programs.find((p) => p.id === 'pack-daily')).toBeDefined();
  expect(
    state.programs.find((p) => p.id === 'training')!.routines.find((r) => r.id === 'upper')!
      .enabled,
  ).toBe(false);
});

test('a rulebook new from the file is previewed as added with its process, not as changed', async ({
  page,
}) => {
  const routine = setup.programs[0].routines[0];
  const file = {
    ...setup,
    programs: [
      {
        ...setup.programs[0],
        routines: [
          {
            ...routine,
            id: 'pack-trade',
            title: 'Example trading',
            capture: 'rules',
            private: true,
          },
        ],
      },
    ],
    ruleBooks: [
      {
        id: 'pack-book',
        routineId: 'pack-trade',
        title: 'Example rules',
        checkpoints: [{ id: 'checkpoint-1', text: 'An example checkpoint' }],
        rules: [],
        updatedAt: '2026-11-01T12:00:00.000Z',
        trading: defaultTradingProfile('2026-11-01'),
      },
    ],
  };
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
  await page.goto('/settings');
  await choose(page, file);
  await expect(
    page.getByText(
      'Adds 0 workout plans, 0 timed circuits and 1 rulebook with Trading discipline, starting today.',
      { exact: true },
    ),
  ).toBeVisible();
  // Nothing on this device is changed, so nothing says its rulebook or reviews are kept.
  await expect(page.getByText(/to your trading rulebook/)).toHaveCount(0);
});

test('importing onto a device with history says the history is kept and lists what is missing', async ({
  page,
}) => {
  const device = { ...demoState('2026-11-09'), source: 'personal' as const };
  await seed(page, device, { clock: new Date(2026, 10, 9, 9), route: '/settings' });
  const before = await saved(page);
  const gappy = {
    ...setup,
    programs: [
      {
        ...setup.programs[0],
        routines: [{ ...setup.programs[0].routines[0], title: 'Stretch', weekdays: [] }],
      },
    ],
  };
  await choose(page, gappy);
  await expect(
    page.getByText(/^Keeps your history: \d+ recorded days and \d+ records, unchanged\./),
  ).toBeVisible();
  await expect(page.getByText('Still to set up after importing')).toBeVisible();
  await page.getByRole('button', { name: 'Import this setup', exact: true }).click();
  await expect(page.getByText('Still to set up', { exact: true })).toBeVisible();
  await expect(
    page.getByText('• Stretch has no days yet, so it never comes up. Set its days in Programs.'),
  ).toBeVisible();
  const after = await saved(page);
  for (const key of [
    'days',
    'workoutSessions',
    'measurements',
    'moneyReviews',
    'ruleReviews',
  ] as const)
    expect(after[key]).toEqual(before[key]);
});

test('local setup import keeps every program and allows routine configuration', async ({
  page,
}) => {
  const large = {
    format: 'life-os-setup-v1',
    goals: [
      {
        id: 'example',
        title: 'Example goal',
        desiredState: 'A synthetic target',
      },
    ],
    programs: Array.from({ length: 33 }, (_, i) => ({
      id: 'example-' + i,
      title: 'Example program ' + i,
      group: 'Examples',
      goalIds: ['example'],
      routines: [
        {
          id: 'routine-' + i,
          title: 'Example routine ' + i,
          duration: null,
          weekdays: null,
          preferredStart: null,
          enabled: false,
          fixed: false,
          steps: [],
          bundledInto: null,
        },
      ],
    })),
    settings: {
      wake: 540,
      bedtime: 1380,
      workStart: null,
      workEnd: null,
      scrumStart: null,
      scrumDuration: null,
      thursdayMeetingStart: null,
      thursdayMeetingDuration: null,
      gymTravel: null,
      eveningWorkMinutes: null,
    },
    notes: ['Synthetic setup used for automated checks.'],
  };
  await importSetup(page, large, 'example-setup.json');
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  // All 33 programs stay visible, each with its own way to add an objective.
  await expect(
    page.getByRole('button', { name: 'Add another objective', exact: true }),
  ).toHaveCount(33);
  await page.screenshot({ path: 'test-results/setup-import-programs.png' });
  await page.getByRole('button', { name: 'Configure Example routine 0', exact: true }).click();
  await page.getByLabel('Duration in minutes (blank = unknown)').fill('25');
  await page.getByRole('checkbox', { name: 'Monday', exact: true }).click();
  await page.getByRole('switch', { name: 'Enabled', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('25 min · Mo', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Add another objective', exact: true }),
  ).toHaveCount(33);
  await expect(page.getByText('25 min · Mo', { exact: true })).toBeVisible();
});

test('a first-run import shows its result in place, folds the import and leads to Today', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load my setup', exact: true }).click();
  await chooseSetup(page, setup);
  await page.getByRole('button', { name: 'Import this setup', exact: true }).click();
  const result = page.getByText('This device now has 1 program and 1 routine.', { exact: true });
  await expect(result).toBeInViewport();
  // Nothing is left to set up, so nothing says so; the import folds away.
  await expect(page.getByText('Still to set up', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose setup file', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Import a private setup. Show', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open Today', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('row:Upper body')).toBeVisible();
});

test('a setup that cannot be read says why inside the import card', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 9, 9) });
  await page.goto('/settings');
  await page.getByLabel('Or paste setup JSON', { exact: true }).fill('{"format":"other"}');
  await page.getByRole('button', { name: 'Import pasted setup', exact: true }).click();
  const error = page.getByText('Choose a Life OS setup file (life-os-setup-v1).', { exact: true });
  await expect(error).toBeInViewport();
  // Under the button that failed, and still inside the import, before Local data.
  const button = (await page
    .getByRole('button', { name: 'Import pasted setup', exact: true })
    .boundingBox())!;
  const box = (await error.boundingBox())!;
  const local = (await page.getByText('Local data', { exact: true }).boundingBox())!;
  expect(box.y).toBeGreaterThan(button.y);
  expect(box.y).toBeLessThan(local.y);
});

test('schedule settings say what is wrong and that they saved, beside Save', async ({ page }) => {
  await seed(page, trainingState(), { route: '/settings' });
  await page.getByRole('button', { name: /^Day boundaries and work schedule\. Show$/ }).click();
  const wake = page.getByLabel('Day starts (for planning)', { exact: true });
  await wake.fill('25:99');
  await page.getByRole('button', { name: 'Save schedule settings', exact: true }).click();
  await expect(
    page.getByText('Day starts (for planning): That time is outside the day.'),
  ).toBeInViewport();
  await wake.fill('06:30');
  await page.getByRole('button', { name: 'Save schedule settings', exact: true }).click();
  await expect(page.getByText(/^Saved\. Existing blocks keep their history/)).toBeInViewport();
  await expect(
    page.getByText('Day starts (for planning): That time is outside the day.'),
  ).toHaveCount(0);
  expect((await saved(page)).settings.wake).toBe(390);
});

test('the About card names the version in app.json, from a web export built after it', async ({
  page,
}) => {
  // The web build inlines the app config when it is exported: a stale export cache once showed
  // the version before a release here (export:web now clears it).
  const app = JSON.parse(readFileSync('app.json', 'utf8')) as { expo: { version: string } };
  await seed(page, trainingState(), { clock: new Date(2026, 10, 9, 9), route: '/settings' });
  await expect(page.getByTestId('about')).toContainText(`Life OS`);
  await expect(page.getByText(`Version ${app.expo.version}`, { exact: true })).toBeAttached();
});
