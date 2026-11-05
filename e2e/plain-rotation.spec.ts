import { test, expect } from '@playwright/test';
import type { Program, Routine, State } from '../src/domain/model';
import { setRotation } from '../src/domain/rotation';
import { basicState } from '../src/test-support/basic-state';
import { saved, seed } from './support/storage';

// Synthetic data only: a rotation of three plain workouts with no workout plans (no exercises),
// resting on Sundays, and a one-objective cardio program. The browser clock is pinned to Monday,
// November 9, 2026 at 9:00, a training day.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const at = (day: number) => new Date(2026, 10, day, 9);

const plain = (id: string, title: string): Routine => ({
  id,
  title,
  duration: null,
  weekdays: [1, 3, 5],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
});

function plainRotation(): State {
  const gym: Program = {
    id: 'gym',
    title: 'Gym',
    group: 'Training',
    goalIds: [],
    routines: [
      plain('push', 'Chest / Triceps / Shoulders'),
      plain('pull', 'Back / Biceps'),
      plain('legs', 'Legs'),
    ],
  };
  const cardio: Program = {
    id: 'cardio',
    title: 'Cardio',
    group: 'Training',
    goalIds: [],
    routines: [{ ...plain('walk', 'Cardio'), weekdays: [6] }],
  };
  const state: State = { ...basicState(), source: 'personal', programs: [gym, cardio] };
  return setRotation(
    state,
    'gym',
    { order: ['push', 'pull', 'legs'], restDays: [0], startWith: null },
    new Date(2026, 10, 8, 12).toISOString(),
  );
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a rotation of plain workouts ticks in one tap, advances, skips to the next training day, and edits in Programs', async ({
  page,
}) => {
  await seed(page, plainRotation(), { clock: at(9), route: '/' });
  // A plain row: one tap marks it done, with no Start, no exercise count and no workout screen.
  const push = page.getByTestId('row:Chest / Triceps / Shoulders');
  await expect(push).toBeVisible();
  await expect(page.getByRole('button', { name: /^Start / })).toHaveCount(0);
  await expect(page.getByText(/exercises?$/)).toHaveCount(0);
  await expect(page.getByTestId('row:Back / Biceps')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Mark Chest / Triceps / Shoulders done', exact: true })
    .click();
  await expect(page.getByTestId('celebration')).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'push')!.status).toBe('done');
  expect(state.workoutSessions).toEqual([]);

  // Tuesday: the next workout. Skip moves it to the next training day, as a quiet row with Undo.
  await page.clock.setFixedTime(at(10));
  await page.goto('/');
  await expect(page.getByTestId('row:Back / Biceps')).toBeVisible();
  await page.getByRole('button', { name: 'Skip Back / Biceps', exact: true }).click();
  const rested = page.getByTestId('rested:Back / Biceps');
  await expect(rested.getByText('Next training day', { exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.days[TUE].blocks.some((b) => b.routineId === 'pull')).toBe(false);
  await rested
    .getByRole('button', { name: 'Undo: train Back / Biceps today', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark Back / Biceps done', exact: true }),
  ).toBeVisible();

  // Programs: the rotation link sits on the gym, never on the one-objective cardio program.
  await page.goto('/programs');
  const link = page.getByRole('button', { name: 'Workout rotation for Gym', exact: true });
  await expect(link).toHaveText('Rotation · 3 workouts ›');
  await expect(page.getByRole('button', { name: 'Workout rotation for Cardio' })).toHaveCount(0);
  await link.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('1. Chest / Triceps / Shoulders')).toBeVisible();
  await expect(sheet.getByText('2. Back / Biceps')).toBeVisible();
  await expect(sheet.getByText('3. Legs')).toBeVisible();
  // A plain workout can leave the rotation and come back.
  await sheet.getByRole('button', { name: 'Remove Legs from the rotation', exact: true }).click();
  await expect(sheet.getByText('3. Legs')).toHaveCount(0);
  await sheet.getByRole('checkbox', { name: 'Add Legs', exact: true }).click();
  await sheet.getByRole('button', { name: 'Move Legs earlier', exact: true }).click();
  await expect(sheet.getByText('2. Legs')).toBeVisible();
  await sheet.getByRole('checkbox', { name: 'Saturday', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save rotation', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  state = await saved(page);
  expect(state.programs.find((p) => p.id === 'gym')!.rotation).toMatchObject({
    order: ['push', 'legs', 'pull'],
    restDays: [0, 6],
  });
});
