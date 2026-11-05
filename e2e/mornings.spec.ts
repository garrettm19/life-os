import { test, expect, type Page } from '@playwright/test';
import { withDay } from '../src/domain/data';
import { State, shiftDate } from '../src/domain/model';
import { ensureChecklistDay, setStatus } from '../src/domain/planner';
import { anchorState } from '../src/test-support/fixtures';
import { scaleText, scanPage, scrollMain } from './support/layout-probe';
import { saved, seed } from './support/storage';

// The morning anchor: set in Programs, read on Today's row, corrected the same day, and the
// Mornings card first on Progress. Synthetic data only: a "Up by 7:10" routine (7:10 AM is an
// example time) with mornings from Monday, November 2, 2026; the browser clock is pinned to Tuesday,
// November 10, when only the anchor is due, so ticking it clears the day.

const TODAY = '2026-11-10';
const ROW = 'Up by 7:10';
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute);
};

/** Opens each day and ticks the anchor at a local time; null leaves it open. */
function mornings(state: State, from: string, times: ([number, number] | null)[]): State {
  times.forEach((time, i) => {
    const date = shiftDate(from, i);
    state = withDay(
      state,
      ensureChecklistDay(
        date,
        state.settings,
        state.programs,
        state.days[date],
        at(date, 5).toISOString(),
      ),
    );
    if (time)
      state = withDay(
        state,
        setStatus(state.days[date], `${date}:routine:up`, 'done', at(date, ...time).toISOString()),
      );
  });
  return state;
}

/** Eight mornings from Nov 2: on time but for a late Thursday and an open Saturday. */
const WEEK: ([number, number] | null)[] = [
  [7, 2],
  [7, 8],
  [7, 15],
  [8, 5],
  [7, 0],
  null,
  [7, 20],
  [7, 4],
];

const row = (page: Page) => page.getByTestId(`row:${ROW}`);
const check = (page: Page) => page.getByRole('button', { name: `Mark ${ROW} done`, exact: true });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('the anchor is set in Programs, counting earlier mornings only when asked', async ({
  page,
}) => {
  const plain = anchorState();
  delete plain.programs[0].routines[0].anchor;
  await seed(page, mornings(plain, '2026-11-02', WEEK), {
    clock: at(TODAY, 6, 30),
    route: '/programs',
  });
  await page.getByRole('button', { name: `Configure ${ROW}`, exact: true }).click();
  const field = page.getByLabel('Up by · morning anchor (24-hour, optional)', { exact: true });
  await expect(field).toHaveValue('');
  await expect(
    page.getByRole('switch', { name: 'Private, hidden from the Home Screen widget', exact: true }),
  ).toBeVisible();
  await field.fill('07:10');
  // With a time set, private says what it hides: the title, never the Up by time on the widgets.
  await expect(
    page.getByRole('switch', {
      name: 'Private, title hidden from the widgets; the Up by time can still show on them',
      exact: true,
    }),
  ).toBeVisible();
  const offer = page.getByRole('switch', {
    name: 'Count mornings since Nov 2 against 7:10 AM',
    exact: true,
  });
  // The state is in the words as well as the fill.
  await expect(offer).toHaveAttribute('aria-checked', 'false');
  await expect(offer).toContainText('Starting today');
  const kept = page.getByText(
    'Once saved, those mornings keep this time. To correct it later, clear the time, end the anchor and set it again.',
    { exact: true },
  );
  await expect(kept).toHaveCount(0);
  await offer.click();
  await expect(offer).toHaveAttribute('aria-checked', 'true');
  await expect(offer).toContainText('Mornings since Nov 2 count against this time');
  // Counted mornings keep the time once saved, so the editor says how to correct a typo.
  await expect(kept).toBeVisible();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const routine = (await saved(page)).programs[0].routines[0];
  expect(routine.anchor).toEqual({ history: [{ from: '2026-11-02', upBy: 430 }] });
  // Today's row shows the mornings on time of the last seven; its title already gives the time.
  await page.goto('/');
  await expect(row(page).getByText('On time 5 of the last 7', { exact: true })).toBeVisible();
  await expect(row(page).getByText(/Up by 7:10 AM/)).toHaveCount(0);
  // A later change applies from today and leaves the first entry as it was.
  await page.goto('/programs');
  await page.getByRole('button', { name: `Configure ${ROW}`, exact: true }).click();
  await expect(field).toHaveValue('07:10');
  await expect(page.getByRole('switch', { name: /^Count mornings since/ })).toHaveCount(0);
  await field.fill('07:00');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  expect((await saved(page)).programs[0].routines[0].anchor).toEqual({
    history: [
      { from: '2026-11-02', upBy: 430 },
      { from: TODAY, upBy: 420 },
    ],
  });
});

test('clearing the time asks first, since it ends the anchor and its history', async ({ page }) => {
  await seed(page, mornings(anchorState(), '2026-11-02', WEEK), {
    clock: at(TODAY, 6, 30),
    route: '/programs',
  });
  await page.getByRole('button', { name: `Configure ${ROW}`, exact: true }).click();
  await page.getByLabel('Up by · morning anchor (24-hour, optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText(/ends the morning anchor and its history/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  expect((await saved(page)).programs[0].routines[0].anchor).toEqual({
    history: [{ from: '2026-11-02', upBy: 430 }],
  });
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await page.getByRole('button', { name: 'End the anchor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save routine', exact: true })).toHaveCount(0);
  expect((await saved(page)).programs[0].routines[0].anchor).toBeUndefined();
});

test('without the offer, the anchor starts today and earlier ticks are not counted', async ({
  page,
}) => {
  const plain = anchorState();
  delete plain.programs[0].routines[0].anchor;
  await seed(page, mornings(plain, '2026-11-02', WEEK), {
    clock: at(TODAY, 6, 30),
    route: '/programs',
  });
  await page.getByRole('button', { name: `Configure ${ROW}`, exact: true }).click();
  await page
    .getByLabel('Up by · morning anchor (24-hour, optional)', { exact: true })
    .fill('07:10');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  expect((await saved(page)).programs[0].routines[0].anchor).toEqual({
    history: [{ from: TODAY, upBy: 430 }],
  });
  // No morning counted yet: the row is its title alone, which already gives the time, never a zero.
  await page.goto('/');
  await expect(row(page).getByText(ROW, { exact: true })).toBeVisible();
  await expect(row(page).getByText(/Up by 7:10 AM|of the last|\b0\b/)).toHaveCount(0);
});

test('a tick on time reads its time, and the day clears with the usual celebration', async ({
  page,
}) => {
  await seed(page, mornings(anchorState(), '2026-11-02', WEEK), {
    clock: at(TODAY, 7, 6),
    route: '/',
  });
  await expect(row(page).getByText('On time 5 of the last 7', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mornings-today-before.png' });
  await check(page).click();
  const party = page.getByTestId('celebration');
  await expect(party.getByRole('heading', { name: 'Day cleared' })).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(row(page).getByText('Ticked 7:06 AM', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mornings-today-ticked.png' });
});

test('a late tick reads the same way, in the same color, and still clears the day', async ({
  page,
}) => {
  await seed(page, mornings(anchorState(), '2026-11-02', WEEK), {
    clock: at(TODAY, 8, 2),
    route: '/',
  });
  await check(page).click();
  // Day Cleared comes only from the checklist: a late tick clears it like any other.
  await expect(
    page.getByTestId('celebration').getByRole('heading', { name: 'Day cleared' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  const late = row(page).getByText('Ticked 8:02 AM', { exact: true });
  await expect(late).toBeVisible();
  await page.screenshot({ path: 'test-results/mornings-today-late.png' });
  const color = await late.evaluate((el) => getComputedStyle(el).color);
  // Fern text (dark `doneText`), as every done caption; never the danger color.
  expect(color).toBe('rgb(111, 220, 177)');
  await expect(page.getByText(/missed/i)).toHaveCount(0);
});

test('the first on-time tick after a morning that was not says Back on time', async ({ page }) => {
  // Monday, November 9 ticked late.
  const state = mornings(anchorState(), '2026-11-02', [...WEEK.slice(0, 7), [9, 15]]);
  await seed(page, state, { clock: at(TODAY, 7, 5), route: '/' });
  await check(page).click();
  const party = page.getByTestId('celebration');
  await expect(party.getByText('Back on time', { exact: true })).toBeVisible();
  await expect(party.getByText('Ticked 7:05 AM · up by 7:10 AM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(row(page).getByText('Back on time · 7:05 AM', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/mornings-today-back.png' });
});

test('I was up at corrects a forgotten tick the same day, marked corrected on Progress', async ({
  page,
}) => {
  await seed(page, mornings(anchorState(), '2026-11-02', WEEK), {
    clock: at(TODAY, 9, 30),
    route: '/',
  });
  await check(page).click();
  await page.getByRole('button', { name: 'Close the celebration', exact: true }).click();
  await expect(row(page).getByText('Ticked 9:30 AM', { exact: true })).toBeVisible();
  await row(page)
    .getByRole('button', { name: `Show details for ${ROW}`, exact: true })
    .click();
  const field = page.getByLabel('I was up at (24-hour)', { exact: true });
  // Only a time before the tick is taken, said beside the field.
  await field.fill('09:45');
  await page.getByRole('button', { name: 'Save the time you were up', exact: true }).click();
  await expect(page.getByRole('alert').getByText('Enter a time before the tick.')).toBeVisible();
  await field.fill('07:05');
  await page.getByRole('button', { name: 'Save the time you were up', exact: true }).click();
  await expect(row(page).getByText('Up at 7:05 AM · corrected', { exact: true })).toBeVisible();
  const block = (await saved(page)).days[TODAY].blocks.find((b) => b.routineId === 'up')!;
  expect(block.upAt).toBe(425);
  await page.goto('/review');
  const card = page.getByTestId('card-mornings');
  await card.focus();
  await card.press('End');
  await expect(page.getByTestId('mornings-readout')).toHaveText(
    'Tue, Nov 10: on time, up at 7:05 AM, corrected',
  );
  // The correction can be taken back: the tick time counts again.
  await page.goto('/');
  await row(page)
    .getByRole('button', { name: `Show details for ${ROW}`, exact: true })
    .click();
  await page.getByRole('button', { name: 'Remove the correction and use the tick time' }).click();
  await expect(row(page).getByText('Ticked 9:30 AM', { exact: true })).toBeVisible();
});

test('the Mornings card leads Progress as one element with a readout for each morning', async ({
  page,
}) => {
  await seed(page, mornings(anchorState('2026-10-26'), '2026-10-26', [...WEEK, ...WEEK]), {
    clock: at(TODAY, 12),
    route: '/review',
  });
  const card = page.getByTestId('card-mornings');
  await expect(card).toBeInViewport();
  // First on the page, above the range that scopes the rest.
  const cardBox = (await card.boundingBox())!;
  const range = (await page.getByRole('radiogroup', { name: 'Time range' }).boundingBox())!;
  expect(cardBox.y).toBeLessThan(range.y);
  await expect(card.getByText('On time 5 of the last 7', { exact: true })).toBeVisible();
  await expect(card.getByText('Up by 7:10 AM', { exact: true })).toBeVisible();
  // This month as a big figure; with no days of last month to compare, when it started.
  const month = page.getByTestId('mornings-month');
  await expect(month).toContainText('This month8');
  await expect(month).toContainText('Started Oct 26');
  await expect(month).not.toContainText('Last month');
  await expect(page.getByTestId('mornings-usual')).toHaveText(
    /^Usually ticked by 7:\d\d AM( · half of mornings between \d{1,2}:\d\d AM and \d{1,2}:\d\d AM)?$/,
  );
  // The key, drawn with the marks themselves.
  await expect(page.getByTestId('mornings-readout')).toHaveText(
    'On timeAfter the windowNot ticked',
  );
  // One element: a slider with the card's summary, stepped with the arrow keys.
  await expect(card).toHaveAttribute('role', 'slider');
  await expect(card).toHaveAttribute('aria-label', /^Mornings\. On time 5 of the last 7\./);
  await card.focus();
  await card.press('End');
  await expect(card).toHaveAttribute('aria-valuetext', 'Tue, Nov 10: on time, ticked 7:04 AM');
  await card.press('ArrowLeft');
  await expect(card).toHaveAttribute('aria-valuetext', 'Mon, Nov 9: on time, ticked 7:20 AM');
  await card.press('ArrowLeft');
  await expect(card).toHaveAttribute('aria-valuetext', 'Sun, Nov 8: not ticked');
  // A tap on a day reads it too.
  await page.getByTestId('morning:2026-11-06').click();
  await expect(page.getByTestId('mornings-readout')).toHaveText(
    'Fri, Nov 6: ticked 8:05 AM, after the window',
  );
  // Each mark has its own shape: a ring after the window, a filled disc on time, a dot not ticked.
  const mark = (date: string) => page.getByTestId(`morning:${date}`).locator('[data-mark]');
  await expect(mark('2026-11-06')).toHaveAttribute('data-mark', 'late');
  await expect(mark('2026-11-05')).toHaveAttribute('data-mark', 'on-time');
  await expect(mark('2026-11-08')).toHaveAttribute('data-mark', 'not-ticked');
  // The calendar starts with the anchor's first week, not with weeks of blanks before it.
  await expect(mark('2026-10-26')).toHaveAttribute('data-mark', 'on-time');
  await expect(page.getByTestId('morning:2026-10-25')).toHaveCount(0);
  await expect(card.getByText(/missed/i)).toHaveCount(0);
  await scrollMain(page, 0);
  await page.screenshot({ path: 'test-results/mornings-card.png' });
});

test('with one tick the card says what starts the calendar instead of drawing an empty one', async ({
  page,
}) => {
  await seed(page, mornings(anchorState(TODAY), TODAY, [[7, 1]]), {
    clock: at(TODAY, 12),
    route: '/review',
  });
  const card = page.getByTestId('card-mornings');
  await expect(card.getByText('Up by 7:10 AM', { exact: true })).toBeVisible();
  await expect(
    card.getByText('First tick Tue, Nov 10. The calendar fills in from the next one.'),
  ).toBeVisible();
  await expect(page.getByTestId(`morning:${TODAY}`)).toHaveCount(0);
});

test('Settings calls its morning time the start of the planning day, not a goal', async ({
  page,
}) => {
  await seed(page, anchorState(), { clock: at(TODAY, 12), route: '/settings' });
  await page.getByRole('button', { name: /^Day boundaries and work schedule\. Show$/ }).click();
  await expect(page.getByLabel('Day starts (for planning)', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Not a goal. Your morning time lives on your anchor routine.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Wake time', { exact: true })).toHaveCount(0);
});

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
] as const) {
  test(`the anchor row and the Mornings card fit a ${width}-point phone, also with larger text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const state = mornings(anchorState('2026-10-26'), '2026-10-26', [...WEEK, ...WEEK, [9, 30]]);
    await seed(page, state, { clock: at(TODAY, 9, 40), route: '/' });
    // The details open, with the correction field.
    await row(page)
      .getByRole('button', { name: `Show details for ${ROW}`, exact: true })
      .click();
    await expect(page.getByTestId('morning-correction')).toBeVisible();
    for (const route of ['/', '/review']) {
      if (route !== '/') await page.goto(route);
      for (const factor of [1, 1.35]) {
        if (factor !== 1) await scaleText(page, factor);
        await scrollMain(page, 0);
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(sideways, `${route} scrolls sideways`).toBeLessThanOrEqual(0);
        const issues = await scanPage(page, height, 6);
        expect(issues.map((i) => `${route} ×${factor}: ${i.kind} ${i.text} (${i.detail})`)).toEqual(
          [],
        );
      }
    }
  });
}
