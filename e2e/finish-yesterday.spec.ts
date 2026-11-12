import { test, expect } from '@playwright/test';
import { withDay } from '../src/domain/data';
import { Program, State, emptyState } from '../src/domain/model';
import { ensureChecklistDay, setStatus } from '../src/domain/planner';
import { probeLayout } from './support/layout-probe';
import { saved, seed } from './support/storage';

// Finishing yesterday from Today, and the Day Clear month. Synthetic data only: two daily habits,
// with the browser clock pinned to Wednesday, November 11, 2026. Sunday 8 and Monday 9 are
// cleared; Tuesday 10 has one of the two done.

const YESTERDAY = '2026-11-10';
const clock = new Date(2026, 10, 11, 9);

function habit(id: string) {
  return {
    id,
    title: `Example ${id}`,
    duration: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
  };
}

function state(): State {
  const programs: Program[] = [
    {
      id: 'example-daily',
      title: 'Example daily',
      group: 'Daily',
      goalIds: [],
      routines: [habit('a'), habit('b')],
    },
  ];
  let s: State = { ...emptyState(), source: 'personal', programs };
  for (const date of ['2026-11-08', '2026-11-09', YESTERDAY]) {
    const at = new Date(`${date}T20:00:00`).toISOString();
    let day = ensureChecklistDay(date, s.settings, programs, undefined, at);
    const ids = day.blocks.map((b) => b.id);
    for (const id of date === YESTERDAY ? ids.slice(0, 1) : ids)
      day = setStatus(day, id, 'done', at);
    s = withDay(s, day);
  }
  return s;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('an open yesterday can be finished from Today, and the run comes back', async ({ page }) => {
  await seed(page, state(), { clock, route: '/' });
  const hero = page.getByTestId('today-hero');
  await expect(hero.getByText('A fresh start today', { exact: true })).toBeVisible();
  const line = page.getByTestId('finish-yesterday');
  // In the hero card, where the note would be: it adds no row above the list.
  await expect(hero.getByTestId('finish-yesterday')).toBeVisible();
  await expect(line).toContainText('Yesterday · 1 still open · Finish ›');
  expect(await probeLayout(page)).toEqual([]);
  await line.getByRole('button', { name: 'Finish yesterday: 1 still open', exact: true }).click();
  // Yesterday's page, where ticks work as on Today, with a way back.
  await page.getByRole('button', { name: 'Mark Example b done', exact: true }).click();
  await expect.poll(async () => (await saved(page)).days[YESTERDAY].blocks[1].status).toBe('done');
  await page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  await expect(page.getByTestId('finish-yesterday')).toHaveCount(0);
  // Sunday, Monday and Tuesday cleared: the run is back, held into today.
  await expect(hero).toContainText('3');
  await expect(hero.getByText('Yesterday was cleared', { exact: true })).toBeVisible();
});

test('the line can be hidden, and never shows for an older day or the demo', async ({ page }) => {
  await seed(page, state(), { clock, route: '/' });
  await page.getByRole('button', { name: 'Hide Finish yesterday', exact: true }).click();
  await expect(page.getByTestId('finish-yesterday')).toHaveCount(0);
  // Two days on, Tuesday is history: nothing offers to finish it.
  await seed(page, state(), { clock: new Date(2026, 10, 12, 9), route: '/' });
  await expect(page.getByTestId('finish-yesterday')).toHaveCount(0);
  await seed(page, { ...state(), source: 'demo' }, { clock, route: '/' });
  await expect(page.getByTestId('finish-yesterday')).toHaveCount(0);
});

test('the streak details show the month, and a day opens from it', async ({ page }) => {
  const s = state();
  s.days[YESTERDAY] = setStatus(
    s.days[YESTERDAY],
    s.days[YESTERDAY].blocks[1].id,
    'done',
    new Date(`${YESTERDAY}T21:00:00`).toISOString(),
  );
  await seed(page, s, { clock, route: '/' });
  await page.getByRole('button', { name: /Streak details\.$/ }).click();
  const month = page.getByTestId('month-calendar');
  await expect(month.getByText('November', { exact: true })).toBeVisible();
  await expect(month.getByLabel('3 days cleared in November', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'November 9, cleared', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'November 11, today, in progress', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'November 3, not recorded', exact: true }),
  ).toBeVisible();
  // Each day is its whole column: 44 pt tall, and wide enough to tap on the narrowest phones.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const cell of await month.locator('[data-testid^="month-day:"]').all()) {
      const box = (await cell.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThanOrEqual(32);
    }
  }
  // November is the first recorded month: nothing earlier to show.
  await expect(page.getByRole('button', { name: 'No earlier month', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'November 9, cleared', exact: true }).click();
  await expect(page.getByTestId('month-calendar')).toHaveCount(0);
  await expect(page.getByText('Mon, Nov 9', { exact: true }).first()).toBeVisible();
});
