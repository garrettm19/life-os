import { test, expect } from '@playwright/test';
import { shiftDate } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { nextMonday } from './support/dates';
import { saved, seed } from './support/storage';

// Upper body is due on Mondays, Lower body on Wednesdays.
const MON = nextMonday();
const WED = shiftDate(MON, 2);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a plan can hold a timed exercise and link an exercise shared with another workout', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Edit workout plan for Lower body', exact: true }).click();
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await page.getByLabel('Exercise name').nth(2).fill('Backward sled');
  await page.getByRole('radio', { name: 'Time', exact: true }).nth(2).click();
  await page.getByLabel('Sets').nth(2).fill('1');
  await page.getByLabel('Seconds per set (optional)').fill('300');
  await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
  // Typing a name used in another workout offers to share that exercise.
  await page.getByLabel('Exercise name').nth(3).fill('Lat pull');
  await page.getByRole('checkbox', { name: 'Same as Lat pulldown · Upper body' }).click();
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  const state = await saved(page);
  const lower = state.workoutTemplates.find((t) => t.routineId === 'lower')!;
  expect(lower.exercises[2]).toMatchObject({ name: 'Backward sled', kind: 'time', seconds: 300 });
  expect(lower.exercises[3]).toMatchObject({ id: 'upper-b', name: 'Lat pulldown' });

  // The timed exercise logs seconds in one tap.
  await page.goto('/?date=' + WED);
  await page.getByRole('button', { name: 'Start Lower body', exact: true }).click();
  await expect(page.getByText('1 × 5 min')).toBeVisible();
  await page.getByRole('button', { name: 'Log Backward sled set 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Backward sled set 1', exact: true }),
  ).toBeVisible();
  const logged = (await saved(page)).workoutSessions[0].exercises.find(
    (e) => e.name === 'Backward sled',
  )!;
  expect(logged.sets[0]).toMatchObject({ done: true, seconds: 300, reps: null });
});

test('an exercise can be swapped for today only, without changing the plan', async ({ page }) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await page
    .getByRole('button', { name: 'Swap Bench press for another exercise today', exact: true })
    .click();
  await page.getByLabel('Or name another exercise').fill('Dumbbell press');
  await page.getByRole('button', { name: 'Swap the exercise', exact: true }).click();
  await expect(page.getByText('Today instead of Bench press')).toBeVisible();
  await expect(page.getByText('Dumbbell press', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log Dumbbell press set 1', exact: true }).click();
  const state = await saved(page);
  expect(state.workoutSessions[0].exercises[0]).toMatchObject({
    name: 'Dumbbell press',
    substitutedFor: { exerciseId: 'upper-a', name: 'Bench press' },
  });
  expect(state.workoutTemplates.find((t) => t.routineId === 'upper')!.exercises[0].name).toBe(
    'Bench press',
  );
  // Once a set is logged, the swap is no longer offered for that exercise.
  await expect(
    page.getByRole('button', { name: 'Swap Dumbbell press for another exercise today' }),
  ).toHaveCount(0);
});
