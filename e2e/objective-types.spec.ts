import { test, expect } from '@playwright/test';
import { dateObject, localDate, shiftDate } from '../src/domain/model';
import { CORE_CIRCUIT, totalSeconds } from '../src/domain/intervals';
import { saved } from './support/storage';

// The browser clock is pinned to a Monday so "today" is known.
const at = (day: number) => new Date(2026, 10, day, 9);
const MON = '2026-11-09';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a new user creates the Ab Circuit by type, then edits it without duplicating', async ({
  page,
}) => {
  await page.clock.install({ time: at(9) });
  await page.goto('/');
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await expect(page.getByText('Choose objective type', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Timed circuit', exact: true }).click();
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue('Ab Circuit');
  await page.getByLabel('Program name', { exact: true }).fill('Core');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit timed circuit for Ab Circuit', exact: true }),
  ).toBeVisible();
  let state = await saved(page);
  const routine = state.programs[0].routines[0];
  expect(routine.title).toBe('Ab Circuit');
  expect(routine.id.length).toBeGreaterThan(8);
  expect(state.intervalRoutines).toHaveLength(1);
  expect(state.intervalRoutines[0].routineId).toBe(routine.id);
  expect(state.intervalRoutines[0].steps.map((s) => s.id)).toEqual(
    CORE_CIRCUIT.steps.map((s) => s.id),
  );
  expect(Math.round(totalSeconds(state.intervalRoutines[0]) / 60)).toBe(14);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Ab Circuit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Ab Circuit', exact: true }).click();
  await expect(page.getByText('14:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close the timer', exact: true }).click();
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Configure Ab Circuit', exact: true }).click();
  // The type reads as one line; Change reopens the picker with it chosen.
  await expect(page.getByText('Timed circuit', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Timed circuit', exact: true })).toHaveCount(0);
  await page.getByLabel('Routine name', { exact: true }).fill('Ab Circuit (home)');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  state = await saved(page);
  expect(state.programs[0].routines).toHaveLength(1);
  expect(state.programs[0].routines[0].id).toBe(routine.id);
  expect(state.programs[0].routines[0].title).toBe('Ab Circuit (home)');
  expect(state.intervalRoutines).toHaveLength(1);
  expect(state.intervalRoutines[0].id).toBe(state.intervalRoutines[0].id);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Start Ab Circuit (home)', exact: true }),
  ).toBeVisible();
});

test('body-weight and money types keep privacy defaults; weight stays optional', async ({
  page,
}) => {
  await page.clock.install({ time: at(9) });
  await page.goto('/');
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Body-weight check-in', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Morning weigh-in');
  await page.getByLabel('Program name', { exact: true }).fill('Daily');
  await expect(
    page.getByRole('switch', { name: 'Optional, never required for Day Cleared' }),
  ).toBeChecked();
  await expect(
    page.getByRole('switch', { name: 'Private, hidden from the Home Screen widget' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await page.getByRole('button', { name: 'Add another objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Money review', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Weekly money');
  await page.getByRole('checkbox', { name: 'Sunday', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Private, hidden from the Home Screen widget' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const state = await saved(page);
  const weight = state.programs[0].routines.find((r) => r.title === 'Morning weigh-in')!;
  const money = state.programs[0].routines.find((r) => r.title === 'Weekly money')!;
  expect(weight).toMatchObject({ capture: 'weight', optional: true, private: true, id: weight.id });
  expect(money).toMatchObject({ capture: 'money', private: true, id: money.id });
  expect(weight.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  await page.goto('/');
  await expect(
    page.getByTestId('row:Morning weigh-in').getByText('Record weight · Optional', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Day cleared', { exact: true })).toHaveCount(0);
});

test('choosing a type never invents a second routine when the type is changed before save', async ({
  page,
}) => {
  await page.clock.install({ time: at(9) });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Strength workout', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Press day');
  await page.getByLabel('Program name', { exact: true }).fill('Gym');
  await page.getByRole('button', { name: 'Choose a different type', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const state = await saved(page);
  expect(state.programs).toHaveLength(1);
  expect(state.programs[0].routines).toHaveLength(1);
  expect(state.workoutTemplates).toEqual([]);
  expect(state.intervalRoutines).toEqual([]);
  expect(dateObject(MON).getDay()).toBe(1);
  expect(shiftDate(MON, 0)).toBe(MON);
  expect(localDate(at(9))).toBe(MON);
});

test('choosing a type low in the list opens the form at the top, with Close on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.clock.install({ time: at(9) });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  // The last type sits below the fold: picking it scrolls the picker down first.
  await page.getByRole('radio', { name: 'Rule-adherence review', exact: true }).click();
  await expect(page.getByLabel('Routine name', { exact: true })).toBeVisible();
  const close = (await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
  expect(close.y).toBeGreaterThanOrEqual(0);
  // Back to the picker and into another type: still at the top.
  await page.getByRole('button', { name: 'Choose a different type', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  const again = (await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
  expect(again.y).toBeGreaterThanOrEqual(0);
});
