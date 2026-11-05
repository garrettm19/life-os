import { test, expect, type Page } from '@playwright/test';
import type { Program, State } from '../src/domain/model';
import { withDay } from '../src/domain/data';
import { setStatus } from '../src/domain/planner';
import { ensureDay, setRotation } from '../src/domain/rotation';
import { trainingState } from '../src/test-support/fixtures';
import { saved, seed } from './support/storage';

// Skip on Today, on a synthetic setup: a two-workout rotation (Upper body, then Lower body,
// resting on Sundays) with a home routine that follows Upper body, and one daily habit. The browser
// clock is pinned to Monday, November 9, 2026 at 9:00, a training day.
const MON = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);

function rotationState(): State {
  const base = trainingState();
  const habits: Program = {
    id: 'habits',
    title: 'Habits',
    group: 'Daily',
    goalIds: [],
    routines: [
      {
        id: 'walk',
        title: 'Evening walk',
        duration: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        preferredStart: null,
        enabled: true,
        fixed: false,
        steps: [],
        bundledInto: null,
        checklist: true,
      },
    ],
  };
  const state: State = {
    ...base,
    programs: [
      ...base.programs.map((p) =>
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
      habits,
    ],
  };
  return setRotation(
    state,
    'training',
    { order: ['upper', 'lower'], restDays: [0], startWith: null },
    new Date(2026, 10, 8, 12).toISOString(),
  );
}

const board = (page: Page, done: number, total: number) =>
  page.getByRole('heading', {
    name: new RegExp(`^Today's objectives\\. ${done} of ${total} objectives complete`),
  });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('Skip on a rotation workout moves it to the next training day, the day still clears, and Undo brings it back', async ({
  page,
}) => {
  await seed(page, rotationState(), { clock: NINE, route: '/' });
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByTestId('row:Home neck routine')).toBeVisible();
  await expect(board(page, 0, 3)).toBeVisible();

  await page.getByRole('button', { name: 'Skip Upper body', exact: true }).click();
  // The workout stays in its place as a quiet row; it and its companion leave the day's count.
  const rested = page.getByTestId('rested:Upper body');
  await expect(rested.getByText('Next training day', { exact: true })).toBeVisible();
  await expect(rested.getByLabel('Upper body. Moved to the next training day')).toBeVisible();
  await expect(page.getByTestId('row:Upper body')).toHaveCount(0);
  await expect(page.getByTestId('row:Home neck routine')).toHaveCount(0);
  await expect(board(page, 0, 1)).toBeVisible();
  await expect(page.getByText(/undo the skip/i)).toHaveCount(0);
  let state = await saved(page);
  expect(state.days[MON].blocks.map((b) => b.routineId)).toEqual(['walk']);
  expect(state.days[MON].rotation).toMatchObject([{ programId: 'training', mode: 'rest' }]);

  // Undo (the word, or the dashed check) trains today again: the workout and companion come back.
  const undo = rested.getByRole('button', { name: 'Undo: train Upper body today', exact: true });
  await expect(undo).toHaveCount(2);
  await undo.last().click();
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByTestId('row:Home neck routine')).toBeVisible();
  await expect(rested).toHaveCount(0);
  await expect(board(page, 0, 3)).toBeVisible();

  // Skip it again and tick the rest: Day Cleared.
  await page.getByRole('button', { name: 'Skip Upper body', exact: true }).click();
  await expect(rested).toBeVisible();
  await page.getByRole('button', { name: 'Mark Evening walk done', exact: true }).click();
  const party = page.getByTestId('celebration');
  await expect(party).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'walk')!.status).toBe('done');
  // The quiet row stays under the cleared board, still with its Undo.
  await expect(rested.getByText('Next training day', { exact: true })).toBeVisible();

  // Tomorrow, the next training day, holds the same workout with its companion.
  await page.clock.setFixedTime(new Date(2026, 10, 10, 9));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByTestId('row:Home neck routine')).toBeVisible();
});

test('Skip on a plain habit excuses it: the count drops and the rest done clears the day', async ({
  page,
}) => {
  await seed(page, rotationState(), { clock: NINE, route: '/' });
  await expect(board(page, 0, 3)).toBeVisible();
  const walk = page.getByTestId('row:Evening walk');
  await walk.getByRole('button', { name: 'Skip Evening walk', exact: true }).click();
  // Still on the list, quiet, with Undo; out of the count, and never counted as done.
  await expect(walk.getByRole('button', { name: 'Undo skipping Evening walk' })).toBeVisible();
  await expect(walk.getByText('Skipped', { exact: true })).toBeVisible();
  await expect(board(page, 0, 2)).toBeVisible();
  expect((await saved(page)).days[MON].blocks.find((b) => b.routineId === 'walk')!.status).toBe(
    'skipped',
  );
  await page.getByRole('button', { name: 'Mark Home neck routine done', exact: true }).click();
  await expect(board(page, 1, 2)).toBeVisible();
  await expect(page.getByText('One more to clear the day', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Upper body done without logging sets' }).click();
  await expect(page.getByTestId('celebration')).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  await expect(page.getByLabel('2 of 2 objectives complete')).toBeVisible();
});

test('Week leaves skipped habits out of its day cards, and a later day of only skips reads All skipped', async ({
  page,
}) => {
  // Today (Monday) with the walk skipped, and Sunday, a rest day for the rotation, with everything
  // on it skipped.
  const now = NINE.toISOString();
  const SUN = '2026-11-15';
  let state = ensureDay(ensureDay(rotationState(), MON, now), SUN, now);
  state = withDay(state, setStatus(state.days[MON], `${MON}:routine:walk`, 'skipped', now));
  for (const block of state.days[SUN].blocks)
    state = withDay(state, setStatus(state.days[SUN], block.id, 'skipped', now));
  await seed(page, state, { clock: NINE, route: '/week' });
  // Monday: Upper body is the workout, and of the habits only the neck routine is still due.
  const monday = page.getByRole('link', { name: /^Mon, Nov 9, today\./ });
  await expect(monday).toHaveAccessibleName(/\. 1 habit due\. Open day$/);
  // Sunday had something due, and it was all skipped: not Nothing due, and not a rest day.
  const sunday = page.getByRole('link', { name: /^Sun, Nov 15\./ });
  await expect(sunday).toHaveAccessibleName(/^Sun, Nov 15\. All skipped\. Training · rest day\. /);
  await expect(sunday.getByText('All skipped', { exact: true })).toBeVisible();
});
