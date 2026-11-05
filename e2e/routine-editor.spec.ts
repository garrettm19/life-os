import { test, expect } from '@playwright/test';
import { emptyState } from '../src/domain/model';
import { studyState, trainingState } from '../src/test-support/fixtures';
import {
  failSaves,
  restoreSaves,
  SAVE_FAILED_TEXT,
  saved,
  savedText,
  seed,
} from './support/storage';
import { openMore } from './support/today';

// The routine editor in Programs on a phone: the program is chosen, never renamed in passing;
// Save and its error stay on screen; Close asks before dropping edits.
const NINE = new Date(2026, 10, 9, 9);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.setViewportSize({ width: 390, height: 844 });
});

const save = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Save routine', exact: true });

test('a new objective needs a program: the error shows above Save, then the last one is preselected', async ({
  page,
}) => {
  await seed(page, trainingState(), { clock: NINE, route: '/programs' });
  const before = await savedText(page);
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  // Save stays on screen without scrolling the form.
  await expect(save(page)).toBeInViewport();
  await page.getByLabel('Routine name', { exact: true }).fill('Example stretch');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await save(page).click();
  const error = page.getByText('Choose a program for this objective, or a new one.', {
    exact: true,
  });
  await expect(error).toBeInViewport();
  expect(await savedText(page)).toBe(before);
  await page.getByRole('radio', { name: 'Tracking', exact: true }).click();
  await expect(error).toHaveCount(0);
  await save(page).click();
  await expect(save(page)).toHaveCount(0);
  const state = await saved(page);
  const tracking = state.programs.find((p) => p.id === 'tracking')!;
  expect(tracking.routines.map((r) => r.title)).toContain('Example stretch');
  expect(tracking.title).toBe('Tracking');
  // The next objective from the top starts in the program last saved to.
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Tracking', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByLabel('Program name', { exact: true })).toHaveCount(0);
});

test('a first objective on an empty device asks for its program name, and a failed save shows by Save', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, emptyState(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'New program…', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByLabel('Routine name', { exact: true }).fill('Example stretch');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await save(page).click();
  await expect(page.getByText('Give the new program a name.', { exact: true })).toBeInViewport();
  expect((await saved(page)).programs).toEqual([]);
  await page.getByLabel('Program name', { exact: true }).fill('Example mobility');
  // An error from the save itself sits by Save too, never above the scrolled form.
  await failSaves(page, 'Synthetic save failure');
  await save(page).click();
  await expect(page.getByText(SAVE_FAILED_TEXT, { exact: true })).toBeInViewport();
  await expect(page.getByText('Give the new program a name.', { exact: true })).toHaveCount(0);
  await restoreSaves(page);
  await save(page).click();
  await expect(save(page)).toHaveCount(0);
  const state = await saved(page);
  expect(state.programs.map((p) => [p.title, p.routines.map((r) => r.title)])).toEqual([
    ['Example mobility', ['Example stretch']],
  ]);
});

test('a blank routine name takes the name of the program it was moved to', async ({ page }) => {
  await seed(page, trainingState(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: 'Add another objective', exact: true }).first().click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByRole('radio', { name: 'Tracking', exact: true }).click();
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await save(page).click();
  await expect(save(page)).toHaveCount(0);
  const state = await saved(page);
  expect(state.programs.find((p) => p.id === 'tracking')!.routines.map((r) => r.title)).toEqual([
    'Weekly weigh-in',
    'Money review',
    'Tracking',
  ]);
});

test('a rotation workout and a routine hosting bundled steps stay in their program', async ({
  page,
}) => {
  const state = trainingState();
  state.programs[0].rotation = { order: ['upper', 'lower'], restDays: [0], startWith: null };
  state.programs.push({
    id: 'accessory',
    title: 'Accessory program',
    group: 'Synthetic',
    goalIds: [],
    routines: [
      {
        ...state.programs[1].routines[0],
        id: 'accessory-1',
        title: 'Accessory practice',
        private: false,
        capture: undefined,
        bundledInto: 'tracking',
      },
    ],
  });
  await seed(page, state, { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: 'Configure Upper body', exact: true }).click();
  await expect(
    page.getByText('Part of the Training rotation: the rotation decides its days.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Program' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Moving a host would leave its bundled steps with no session to sit in.
  await page.getByRole('button', { name: 'Configure Money review', exact: true }).click();
  await expect(
    page.getByText('Hosts the bundled steps Accessory practice: it stays in Tracking.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Program' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // The bundled routine itself can still move: its steps stay with their host.
  await page.getByRole('button', { name: 'Configure Accessory practice', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Program' })).toBeVisible();
});

test('choosing another program moves one routine; Edit program renames the program', async ({
  page,
}) => {
  await seed(page, trainingState(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: 'Configure Lower body', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Training', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // No free-text program name for an existing program: it cannot be renamed from here.
  await expect(page.getByLabel('Program name', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'New program…', exact: true }).click();
  await page.getByLabel('Program name', { exact: true }).fill('Example legs');
  await save(page).click();
  await expect(save(page)).toHaveCount(0);
  let state = await saved(page);
  const training = state.programs.find((p) => p.id === 'training')!;
  expect(training.title).toBe('Training');
  expect(training.routines.map((r) => r.id)).toEqual(['upper']);
  const legs = state.programs.find((p) => p.title === 'Example legs')!;
  expect(legs.routines.map((r) => r.id)).toEqual(['lower']);
  // A program is renamed for all its routines from its own card.
  await page.getByRole('button', { name: 'Edit program Training', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit program', exact: true })).toBeVisible();
  await page.getByLabel('Program name', { exact: true }).fill('Example strength');
  await page.getByRole('button', { name: 'Save program', exact: true }).click();
  state = await saved(page);
  expect(state.programs.find((p) => p.id === 'training')).toMatchObject({
    title: 'Example strength',
    goalIds: ['vitality'],
  });
  expect(state.programs.find((p) => p.id === 'training')!.routines.map((r) => r.id)).toEqual([
    'upper',
  ]);
});

test('the editor leads with the common switches, folds the rest and asks before dropping edits', async ({
  page,
}) => {
  await seed(page, studyState(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: 'Configure Job search', exact: true }).click();
  // Required, Private and Paused come before the days; Save is on screen from the start.
  const days = (await page.getByRole('checkbox', { name: 'Monday', exact: true }).boundingBox())!;
  for (const name of [
    'Optional, never required for Day Cleared',
    'Private, hidden from the Home Screen widget',
    'Enabled',
  ]) {
    const box = (await page.getByRole('switch', { name, exact: true }).boundingBox())!;
    expect(box.y, name).toBeLessThan(days.y);
  }
  await expect(save(page)).toBeInViewport();
  // The type is one line, not a second picker; More options holds steps, links and alternation.
  await expect(page.getByText('Simple habit', { exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Objective type' })).toHaveCount(0);
  await expect(page.getByLabel('Routine steps (one per line)')).toHaveCount(0);
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await expect(page.getByLabel('Routine steps (one per line)')).toBeVisible();
  // An unchanged form closes at once.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(save(page)).toHaveCount(0);
  // A changed one asks first; Keep editing keeps every edit.
  const before = await savedText(page);
  await page.getByRole('button', { name: 'Configure Job search', exact: true }).click();
  const privacy = page.getByRole('switch', {
    name: 'Private, hidden from the Home Screen widget',
    exact: true,
  });
  await privacy.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Discard your changes to this routine?')).toBeInViewport();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(privacy).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(save(page)).toHaveCount(0);
  expect(await savedText(page)).toBe(before);
});

test('Today edits one day of a routine and links to its settings in Programs', async ({ page }) => {
  await seed(page, studyState(), { clock: NINE, route: '/' });
  await page
    .getByTestId('row:Job search')
    .getByRole('button', { name: /^Job search(\.|$)/ })
    .click({ delay: 900 });
  await expect(page.getByText('Edit today only', { exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Change days, privacy or pause for Job search in Programs',
      exact: true,
    })
    .click();
  await expect(page.getByText('Configure a routine', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue('Job search');
  await expect(page).not.toHaveURL(/routine=/);
});

test('on another day the occurrence sheet reads Edit this day only', async ({ page }) => {
  await seed(page, studyState(), { clock: NINE, route: '/?date=2026-11-10' });
  await page
    .getByTestId('row:Job search')
    .getByRole('button', { name: /^Job search(\.|$)/ })
    .click({ delay: 900 });
  await expect(page.getByText('Edit this day only', { exact: true })).toBeVisible();
  await expect(page.getByText('Edit today only', { exact: true })).toHaveCount(0);
});

test.describe('a block sheet left open across midnight', () => {
  const MON = '2026-11-09';
  const TUE = '2026-11-10';
  const LATE = new Date(2026, 10, 9, 23, 59);
  /** Lets the clock pass midnight behind the open sheet, and Today's minute ticker see it. */
  const pastMidnight = async (page: import('@playwright/test').Page) => {
    await page.clock.fastForward(90_000);
    await page.clock.runFor(31_000);
  };

  test('edits the occurrence of the day it opened on, never adding a copy to the new day', async ({
    page,
  }) => {
    await seed(page, studyState(), { clock: LATE, route: '/' });
    await page
      .getByTestId('row:Job search')
      .getByRole('button', { name: /^Job search(\.|$)/ })
      .click({ delay: 900 });
    await expect(page.getByText('Edit today only', { exact: true })).toBeVisible();
    await page.getByLabel('Block name', { exact: true }).fill('Job search: two applications');
    await pastMidnight(page);
    // Today moved on to Tuesday behind the sheet, which still edits Monday's occurrence.
    await expect(page.getByText('Edit this day only', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save block', exact: true }).click();
    await expect(page.getByLabel('Block name', { exact: true })).toHaveCount(0);
    // Tuesday holds its own Job search once, and counts it once.
    await expect(page.getByTestId('row:Job search')).toHaveCount(1);
    await expect(page.getByTestId('row:Job search: two applications')).toHaveCount(0);
    const state = await saved(page);
    const jobs = (date: string) =>
      (state.days[date]?.blocks ?? []).filter((b) => b.routineId === 'job-search');
    expect(jobs(MON).map((b) => [b.id, b.title])).toEqual([
      [`${MON}:routine:job-search`, 'Job search: two applications'],
    ]);
    expect(jobs(TUE).map((b) => b.id)).toEqual([`${TUE}:routine:job-search`]);
  });

  test('adds a block to the day it opened on', async ({ page }) => {
    await seed(page, studyState(), { clock: LATE, route: '/' });
    await openMore(page);
    await page.getByRole('button', { name: 'Add block', exact: true }).click();
    await page.getByLabel('Block name', { exact: true }).fill('Example late item');
    await pastMidnight(page);
    await page.getByRole('button', { name: 'Save block', exact: true }).click();
    await expect(page.getByLabel('Block name', { exact: true })).toHaveCount(0);
    const state = await saved(page);
    const added = (date: string) =>
      (state.days[date]?.blocks ?? []).filter((b) => b.title === 'Example late item');
    expect(added(MON).map((b) => b.id.startsWith(`${MON}:manual:`))).toEqual([true]);
    expect(added(TUE)).toEqual([]);
  });
});
