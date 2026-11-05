import { test, expect, type Page } from '@playwright/test';
import type { State } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { saved, seed } from './support/storage';
import { stepDay } from './support/today';

// Synthetic: Upper body on Monday with a home neck companion. The browser clock is a Monday.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const at = (day: number) => new Date(2026, 10, day, 12);

function seedState(): State {
  const base = trainingState();
  return {
    ...base,
    programs: base.programs.map((p) =>
      p.id === 'training'
        ? {
            ...p,
            routines: [
              ...p.routines,
              {
                id: 'neck',
                title: 'Home neck routine',
                duration: null,
                weekdays: [],
                preferredStart: null,
                enabled: true,
                fixed: false,
                steps: [],
                bundledInto: null,
                checklist: true,
                follows: ['upper'],
              },
            ],
          }
        : p,
    ),
  };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function startRotation(page: Page) {
  await seed(page, seedState(), { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await page.getByRole('button', { name: 'Start rotation', exact: true }).click();
  await page.goto('/');
}

test('the day chips read day numbers as the rest of the app does, never zero-padded', async ({
  page,
}) => {
  await startRotation(page);
  await page.getByRole('button', { name: 'Move Home neck routine to another day' }).click();
  const chips = page.getByRole('radiogroup', { name: 'Move to' }).getByRole('radio');
  // The sheet draws its chips after it opens: wait for them before reading them all at once.
  await expect(chips.first()).toBeVisible();
  const names = await chips.evaluateAll((radios) => radios.map((r) => r.textContent ?? ''));
  // The clock is Monday, November 9: the first chip is Mon 9, not Mon 09.
  expect(names[0]).toBe('Mon 9');
  expect(names.filter((n) => / 0\d$/.test(n))).toEqual([]);
  await expect(page.getByRole('radio', { name: 'Mon 9', exact: true })).toBeVisible();
});

test('a companion moves to another day while its parent workout stays', async ({ page }) => {
  await startRotation(page);
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  // The move sits under its own row, indented to the title, not at the section's edge.
  const move = page.getByRole('button', { name: 'Move Home neck routine to another day' });
  const row = page.getByTestId('row:Home neck routine');
  expect((await move.boundingBox())!.x).toBeGreaterThanOrEqual((await row.boundingBox())!.x + 56);
  await move.click();
  await expect(page.getByText('Move companion', { exact: true })).toBeVisible();
  await expect(page.getByText(/Stays put: Upper body/)).toBeVisible();
  await page.getByRole('radio', { name: 'Tue 10', exact: true }).click();
  await page.getByRole('button', { name: 'Move Home neck routine to Tue, Nov 10' }).click();
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toHaveCount(0);
  let state = await saved(page);
  expect(state.days[MON].blocks.map((b) => b.routineId).sort()).toEqual(['upper']);
  expect(state.days[TUE].blocks.map((b) => b.routineId)).toEqual(['neck']);
  expect(state.days[TUE].blocks[0].movedFrom).toBe(MON);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toHaveCount(0);
  await stepDay(page, 'Next day');
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  await page.getByRole('button', { name: 'Move Home neck routine to another day' }).click();
  await page.getByRole('button', { name: /Return to/ }).click();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toHaveCount(0);
  await stepDay(page, 'Previous day');
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'neck')!.movedFrom).toBeUndefined();
  await page.getByRole('button', { name: 'Move Home neck routine to another day' }).click();
  await page.getByRole('radio', { name: 'Tue 10', exact: true }).click();
  await page.getByRole('button', { name: 'Move Home neck routine to Tue, Nov 10' }).click();
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Upper body done without logging sets' }).click();
  await page.clock.setFixedTime(at(10));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Lower body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toHaveCount(0);
  state = await saved(page);
  expect(state.days[TUE].blocks.filter((b) => b.routineId === 'neck')).toHaveLength(1);
  expect(state.days[MON].blocks.filter((b) => b.routineId === 'neck')).toHaveLength(0);
});

test('a completed companion is not offered a move', async ({ page }) => {
  await startRotation(page);
  await page.getByRole('button', { name: 'Mark Home neck routine done' }).click();
  await expect(
    page.getByRole('button', { name: 'Move Home neck routine to another day' }),
  ).toHaveCount(0);
});
