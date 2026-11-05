import { test, expect } from '@playwright/test';
import type { Routine, State } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { saved, seed } from './support/storage';

// Repeats every N weeks, set in Programs and followed by Today. Synthetic data only. The clock is
// pinned to Saturday, November 7, 2026, so "this week" is the week of Monday, November 2.
const SATURDAY = new Date(2026, 10, 7, 9);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a habit set to repeat every 3 weeks comes up this week, then three weeks later', async ({
  page,
}) => {
  await page.clock.install({ time: SATURDAY });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Example haircut');
  await page.getByLabel('Program name', { exact: true }).fill('Example grooming');
  await page.getByRole('checkbox', { name: 'Saturday', exact: true }).click();
  await page.getByRole('radio', { name: 'Every 3 wk', exact: true }).click();
  await expect(page.getByText(/every 3 weeks starting this week/)).toBeVisible();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Checklist · Sa, every 3 weeks', { exact: true })).toBeVisible();
  const routine = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.title === 'Example haircut')!;
  expect(routine.repeat).toEqual({ everyWeeks: 3, anchor: '2026-11-07' });

  // Due today (an "on" week), not next Saturday, and again three weeks on.
  await page.goto('/');
  await expect(page.getByTestId('row:Example haircut')).toBeVisible();
  await page.goto('/?date=2026-11-14');
  await page.getByRole('button', { name: /^More for this day/ }).click();
  await expect(page.getByTestId('row:Example haircut')).toHaveCount(0);

  // Back to weekly from the same editor.
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Configure Example haircut', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Every 3 wk', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: 'Weekly', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Checklist · Sa', { exact: true })).toBeVisible();
});

/** The training fixture with repeats set on its two workouts. */
function repeatingState(repeats: Record<string, Routine['repeat']>): State {
  const base = trainingState();
  return {
    ...base,
    programs: base.programs.map((p) => ({
      ...p,
      routines: p.routines.map((r) => (repeats[r.id] ? { ...r, repeat: repeats[r.id] } : r)),
    })),
  };
}

test('an existing repeat keeps its anchor in the editor and on save', async ({ page }) => {
  const state = repeatingState({
    // Anchored last week, so this week is off.
    lower: { everyWeeks: 2, anchor: '2026-10-28' },
    // Longer than the editor's own choices, as a setup file can hold.
    upper: { everyWeeks: 6, anchor: '2026-11-02' },
  });
  await seed(page, state, { clock: SATURDAY, route: '/programs' });
  await page.getByRole('button', { name: 'Configure Lower body', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Every 2 wk', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByText(/every 2 weeks, counted from the week of Wed, Oct 28; this week is off/),
  ).toBeVisible();
  await expect(page.getByText(/starting this week/)).toHaveCount(0);
  // A new count starts a new pattern this week; the stored count gets its anchor back.
  await page.getByRole('radio', { name: 'Every 3 wk', exact: true }).click();
  await expect(page.getByText(/every 3 weeks starting this week/)).toBeVisible();
  await page.getByRole('radio', { name: 'Every 2 wk', exact: true }).click();
  await expect(page.getByText(/counted from the week of Wed, Oct 28/)).toBeVisible();

  await page.goto('/programs');
  await page.getByRole('button', { name: 'Configure Upper body', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Every 6 wk', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByText(/every 6 weeks, counted from the week of Mon, Nov 2; this week is on/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save routine', exact: true })).toHaveCount(0);
  const upper = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.id === 'upper')!;
  expect(upper.repeat).toEqual({ everyWeeks: 6, anchor: '2026-11-02' });
});
