import { test, expect, type Page } from '@playwright/test';
import type { State } from '../src/domain/model';
import { studyState } from '../src/test-support/fixtures';
import { withDay } from '../src/domain/data';
import { ensureChecklistDay, setStatus } from '../src/domain/planner';
import { saveMoneyReview } from '../src/domain/money';
import { todayList } from '../src/domain/day-order';
import { scaleText, scrollMain } from './support/layout-probe';
import { SAVE_FAILED_TEXT, STATE_KEY, saved, seed } from './support/storage';
import { openMore } from './support/today';

// The browser clock is pinned to Monday, November 9, 2026 at 9:00.
const MON = '2026-11-09';
const TUE = '2026-11-10';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const open = (page: Page, state: State = studyState()) =>
  seed(page, state, { clock: new Date(2026, 10, 9, 9), route: '/' });

// Dark tokens from src/ui/theme.ts (which the browser suite cannot import: it loads React
// Native); the suite runs in dark.
const palette = { accent: '#FF9A57', checkEdge: '#7E766D' };
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
/** The outline of a row's check: drawn by the pressable's animated view inside the button. */
const outline = (row: ReturnType<Page['getByTestId']>) =>
  row.getByRole('button').first().locator('> div').first();

/** Study plus daily checklist items with steps, `count` of them, the first with a long title. */
function withEssentials(count: number): State {
  const state = studyState();
  const titles = ['Morning mobility and stretching routine', 'Plan tomorrow'];
  state.programs.push({
    id: 'essentials',
    title: 'Daily essentials',
    group: 'Daily essentials',
    goalIds: [],
    routines: Array.from({ length: count }, (_, i) => ({
      id: `essential-${i + 1}`,
      title: titles[i] ?? `Essential ${i + 1}`,
      duration: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      preferredStart: null,
      enabled: true,
      fixed: false,
      steps: ['Start slowly', 'Keep going', 'Finish'],
      bundledInto: null,
      checklist: true,
    })),
  });
  return state;
}

test("Today is one list in the order of the day, and tomorrow's preview is read-only", async ({
  page,
}) => {
  // The job search is set first in the order of the day; the rest keep Programs order.
  const state = studyState();
  for (const program of state.programs)
    for (const routine of program.routines) if (routine.id === 'job-search') routine.dayOrder = 0;
  await open(page, state);
  const list = page.getByTestId('today-list');
  const rows = list.locator('[data-testid^="row:"]');
  await expect(rows.first()).toHaveAttribute('data-testid', 'row:Job search');
  const ids = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const day = (await saved(page)).days[MON];
  const order = todayList(day.blocks, state.programs).map((b) => `row:${b.title}`);
  expect(await ids()).toEqual(order);
  // No headed groups or per-group counts, and no card above the list: study is a row in it.
  await expect(
    page.getByText(/^(Career|Daily essentials|Training today|Specific-day habits|Optional)/),
  ).toHaveCount(0);
  await expect(page.getByTestId('study-card')).toHaveCount(0);
  await expect(page.getByTestId('row:Daily study')).toHaveCount(1);
  await expect(page.getByText(/to clear the day|to go$/i)).toBeVisible();
  // The next thing to do has the Ember outline; ticking it passes that on, and the done row
  // stays where it was.
  await expect(outline(rows.nth(0))).toHaveCSS('border-top-color', rgb(palette.accent));
  await expect(outline(rows.nth(1))).toHaveCSS('border-top-color', rgb(palette.checkEdge));
  await page.getByRole('button', { name: 'Mark Job search done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Job search', exact: true })).toBeVisible();
  await expect(outline(rows.nth(1))).toHaveCSS('border-top-color', rgb(palette.accent));
  expect(await ids()).toEqual(order);
  const preview = page.getByRole('button', { name: /^Tomorrow, Tue, Nov 10: \d+ due/ });
  await openMore(page);
  await expect(preview).toBeVisible();
  await expect(page.getByText('Job search', { exact: true })).toHaveCount(1);
  await preview.click();
  await expect(page.getByLabel('Daily study', { exact: true })).toBeVisible();
  // The preview lists it; the row on Today underneath has the same name.
  await expect(page.getByLabel('Job search', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Timed sessions appear once tomorrow is planned/)).toBeVisible();
  await page.screenshot({ path: 'test-results/today-preview.png', fullPage: true });
  // Opening and closing it twice saves nothing for tomorrow and changes nothing today.
  const before = await saved(page);
  await preview.click();
  await page.getByRole('button', { name: /^Tomorrow, Tue, Nov 10/ }).click();
  const after = await saved(page);
  expect(after.days[TUE]).toBeUndefined();
  expect(after.days[MON]).toEqual(before.days[MON]);
});

test('after a missed study day the next Done starts a new run, kept on Progress, not Today', async ({
  page,
}) => {
  // Saturday Nov 7 done; Sunday Nov 8 never opened; today is Monday Nov 9.
  let state = studyState();
  const day = ensureChecklistDay(
    '2026-11-07',
    state.settings,
    state.programs,
    undefined,
    new Date(2026, 10, 7, 8).toISOString(),
  );
  state = withDay(
    state,
    setStatus(day, '2026-11-07:routine:study', 'done', new Date(2026, 10, 7, 20).toISOString()),
  );
  await open(page, state);
  // Today reads the study row like any other: no streak line gives it more weight.
  await expect(page.getByText(/streak starts today/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Daily study done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Daily study', exact: true })).toBeVisible();
  await expect(page.getByText(/^Study streak/)).toHaveCount(0);
  // Nothing was backfilled for the missed Sunday.
  expect((await saved(page)).days['2026-11-08']).toBeUndefined();
  await page.goto('/review');
  await expect(page.getByText('Study streak 1 · best 1', { exact: true }).first()).toBeVisible();
});

test('study can be skipped from its row; the skip is excused, never completion, and Undo reopens it in place', async ({
  page,
}) => {
  await open(page);
  const board = page.getByRole('heading', { name: /^Today's objectives\. 0 of \d+ objectives/ });
  const before = Number(/0 of (\d+)/.exec((await board.getAttribute('aria-label'))!)![1]);
  const row = page.getByTestId('row:Daily study');
  // Skip sits in the row's details: the trailing action is the Timer.
  await row.getByRole('button', { name: 'Show details for Daily study', exact: true }).click();
  await row.getByRole('button', { name: 'Skip Daily study', exact: true }).click();
  const state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'study')!.status).toBe('skipped');
  // The skip leaves the day's count, so the rest alone clears the day; no line asks to undo it.
  const fewer = page.getByRole('heading', {
    name: new RegExp(`^Today's objectives\\. 0 of ${before - 1} objectives`),
  });
  await expect(fewer).toBeVisible();
  await expect(page.getByText(/undo the skip/i)).toHaveCount(0);
  // The skipped objective stays in the list, once, with Undo where the Timer was.
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: /^Use the timer/ })).toHaveCount(0);
  await row.getByRole('button', { name: 'Undo skipping Daily study', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Use the timer for Daily study', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: new RegExp(`^Today's objectives\\. 0 of ${before} objectives`),
    }),
  ).toBeVisible();
});

test('a checklist item edits without a start time, and saving it clears a stored one', async ({
  page,
}) => {
  // A checklist block carrying a start, as a stored day can hold one.
  const state = studyState();
  const day = ensureChecklistDay(
    MON,
    state.settings,
    state.programs,
    undefined,
    new Date(2026, 10, 9, 8).toISOString(),
  );
  const id = `${MON}:routine:job-search`;
  const seeded = withDay(state, {
    ...day,
    blocks: day.blocks.map((b) => (b.id === id ? { ...b, start: 600, duration: 15 } : b)),
  });
  await open(page, seeded);
  // A long press on the row opens its editor; a tap would tick it.
  await page
    .getByTestId('row:Job search')
    .getByRole('button', { name: /^Job search(\.|$)/ })
    .click({ delay: 900 });
  await expect(page.getByLabel('Block name', { exact: true })).toHaveValue('Job search');
  await expect(page.getByLabel('Start time (24-hour, blank = unscheduled)')).toHaveCount(0);
  await expect(page.getByLabel('Fixed time', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save block', exact: true }).click();
  await expect(page.getByLabel('Block name', { exact: true })).toHaveCount(0);
  const block = (await saved(page)).days[MON].blocks.find((b) => b.id === id)!;
  expect(block).toMatchObject({ checklist: true, start: null, reason: null, status: 'planned' });
});

test('a day not saved yet never reads as empty while Today prepares it', async ({ page }) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9) });
  // Watches every change to the page from the first render of the next load.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as Window & { emptySeen?: string[] }).emptySeen = seen;
    new MutationObserver(() => {
      const text = document.body?.textContent ?? '';
      for (const copy of ['Nothing due today', 'No objectives yet'])
        if (text.includes(copy) && !seen.includes(copy)) seen.push(copy);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Mark Job search done', exact: true }),
  ).toBeVisible();
  expect((await saved(page)).days[MON]).toBeDefined();
  expect(
    await page.evaluate(() => (window as Window & { emptySeen?: string[] }).emptySeen),
  ).toEqual([]);
});

test('folded steps open below their row from a trailing chevron, and a skipped row says Undo', async ({
  page,
}) => {
  await open(page);
  const row = page.getByTestId('row:Job search');
  // VoiceOver hears what the chevron holds; it sits on the row's line with the check and Skip.
  const toggle = row.getByRole('button', { name: 'Show 1 step for Job search', exact: true });
  const check = (await row
    .getByRole('button', { name: 'Mark Job search done', exact: true })
    .boundingBox())!;
  const box = (await toggle.boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - (check.y + check.height / 2))).toBeLessThan(2);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect((await row.boundingBox())!.height).toBeLessThan(64);
  await toggle.click();
  // The step opens below the row, indented to the title, and the row grows to hold it.
  const step = row.getByText(/Apply, tailor a resume/);
  await expect(step).toBeVisible();
  const stepBox = (await step.boundingBox())!;
  const title = (await row.getByText('Job search', { exact: true }).boundingBox())!;
  expect(stepBox.y).toBeGreaterThanOrEqual(check.y + check.height - 1);
  expect(stepBox.x).toBeGreaterThanOrEqual(title.x - 1);
  await expect(
    row.getByRole('button', { name: 'Hide 1 step for Job search', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  // Skipping shows Undo in words where Skip was; it reopens the item.
  await row.getByRole('button', { name: 'Skip Job search', exact: true }).click();
  await row.getByRole('button', { name: 'Undo skipping Job search', exact: true }).click();
  await expect(
    row.getByRole('button', { name: 'Mark Job search done', exact: true }),
  ).toBeVisible();
  const block = (await saved(page)).days[MON].blocks.find((b) => b.routineId === 'job-search')!;
  expect(block.status).toBe('planned');
});

test('the header greets the time of day over the date; the thin bar appears once the card scrolls away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await open(page, withEssentials(6));
  const header = page.getByTestId('page-header');
  // A greeting over the date, and no streak; VoiceOver reads it as Today with the date.
  await expect(page.getByRole('heading', { name: 'Today, Monday, November 9' })).toHaveText(
    'Good morning',
  );
  await expect(header.getByText('Monday, November 9', { exact: true })).toBeVisible();
  await expect(header.getByText(/streak/i)).toHaveCount(0);
  const edge = () => header.evaluate((el) => getComputedStyle(el).borderBottomColor);
  expect(await edge()).toBe('rgba(0, 0, 0, 0)');
  // While the board is on screen the bar would repeat it, so it waits.
  await expect(page.getByTestId('pinned-progress')).toHaveCount(0);
  const headerBox = (await header.boundingBox())!;
  await scrollMain(page, 300);
  await expect.poll(edge).not.toBe('rgba(0, 0, 0, 0)');
  const pinned = page.getByTestId('pinned-progress');
  await expect(pinned).toBeVisible();
  expect((await pinned.boundingBox())!.height).toBeLessThanOrEqual(4);
  // It sits inside the header's own padding, so the page never moves when it appears.
  expect((await header.boundingBox())!.height).toBe(headerBox.height);
  await scrollMain(page, 0);
  await expect(pinned).toHaveCount(0);
});

test('the hero card opens the streak details; other days are in More for today', async ({
  page,
}) => {
  await open(page);
  // The last seven days in the hero card open the streak details and Protect this day.
  await page
    .getByTestId('today-hero')
    .getByRole('button', { name: /^Last 7 days: .*Streak details\.$/ })
    .click();
  await expect(page.getByText('Day clear streak', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await openMore(page);
  await expect(page.getByRole('button', { name: 'Mon, Nov 9, today', exact: true })).toBeVisible();
  // The hero card holds the streak on today, so More does not repeat it.
  await expect(page.getByRole('button', { name: /^Streak details/ })).toHaveCount(0);
  // Another day is titled with its date, and a quiet link goes back.
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tuesday, November 10' })).toHaveText(
    /Tue, Nov 10/i,
  );
  // There, More holds the streak beside the date.
  await expect(page.getByRole('button', { name: /^Streak details/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today, Monday, November 9' })).toBeVisible();
});

test('More for today keeps the log apart from planning and lists only what it holds', async ({
  page,
}) => {
  await open(page);
  // No 90-day focus here, so the summary never promises one.
  await expect(
    page.getByRole('button', {
      name: 'More for today, tomorrow, log, plan. Show',
      exact: true,
    }),
  ).toBeVisible();
  await openMore(page);
  const add = page.getByRole('button', { name: "Add to today's log", exact: true });
  const plan = page.getByText('Plan this day', { exact: true });
  await expect(add).toHaveText('Add');
  expect((await add.boundingBox())!.y).toBeLessThan((await plan.boundingBox())!.y);
  await add.click();
  await expect(page.getByRole('button', { name: 'Save to log', exact: true })).toBeVisible();
});

test('the chevron keeps its own column beside a long title at large text, and once done', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await open(page, withEssentials(2));
  const title = 'Morning mobility and stretching routine';
  const row = page.getByTestId(`row:${title}`);
  const heading = row.getByRole('button', { name: new RegExp(`^${title}`) });
  const toggle = row.getByRole('button', { name: `Show 3 steps for ${title}` });
  const check = row.getByRole('button', { name: `Mark ${title} done`, exact: true });
  await row.scrollIntoViewIfNeeded();
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
  const box = (await toggle.boundingBox())!;
  expect(Math.abs(mid(box) - mid((await check.boundingBox())!))).toBeLessThan(2);
  // Done drops Skip, but its column stays, so a quick second tap never lands on the chevron.
  await check.click();
  await expect(row.getByRole('button', { name: `Undo ${title}`, exact: true })).toBeVisible();
  expect(Math.abs((await toggle.boundingBox())!.x - box.x)).toBeLessThan(1);
  // Larger text: the title wraps in its own column and never reaches under the chevron.
  const before = (await heading.boundingBox())!;
  await scaleText(page, 2);
  const after = (await heading.boundingBox())!;
  const chevron = (await toggle.boundingBox())!;
  expect(after.x + after.width).toBeLessThanOrEqual(chevron.x + 0.5);
  expect(after.height).toBeGreaterThan(before.height);
  expect(chevron.width).toBeGreaterThanOrEqual(44);
});

test("a long day's compact board keeps a continuous 6 pt bar; the pinned bar is thinner", async ({
  page,
}) => {
  // Over 24 objectives, the board draws one continuous bar instead of segments.
  await open(page, withEssentials(30));
  await expect(page.getByText(/^\/3\d$/)).toBeVisible();
  const board = page
    .getByRole('heading', { name: /^Today's objectives/ })
    .getByTestId('charge-bar');
  expect((await board.boundingBox())!.height).toBe(6);
  await scrollMain(page, 400);
  const pinned = page.getByTestId('pinned-progress').getByTestId('charge-bar');
  await expect(pinned).toBeVisible();
  expect((await pinned.boundingBox())!.height).toBeLessThanOrEqual(4);
});

test('when the new day cannot be saved, Today says what to do instead of going blank', async ({
  page,
}) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9) });
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('Quota exceeded (synthetic)');
      original.call(this, name, value);
    };
  }, STATE_KEY);
  await page.goto('/');
  // The storage's own error text stays out: the message says the change was not made.
  await expect(page.getByText(SAVE_FAILED_TEXT)).toBeVisible();
  await expect(page.getByText('Quota exceeded (synthetic)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText(/^No objectives yet\. Open More for today/)).toBeVisible();
  expect((await saved(page)).days[MON]).toBeUndefined();
});

test('the More for today summary names the money priority when one is set', async ({ page }) => {
  const state = saveMoneyReview(
    studyState(),
    {
      date: '2026-11-08',
      currency: 'USD',
      cash: 1200_00,
      savings: null,
      debt: null,
      upcoming: null,
      contributed: null,
      savingsTarget: null,
      nextAction: 'Move $50 to savings',
      note: '',
      goalId: null,
    },
    'm1',
    new Date(2026, 10, 8, 12).toISOString(),
  );
  await open(page, state);
  await expect(
    page.getByRole('button', {
      name: 'More for today, money, tomorrow, log, plan. Show',
      exact: true,
    }),
  ).toBeVisible();
  await openMore(page);
  await expect(page.getByText('Move $50 to savings')).toBeVisible();
});
