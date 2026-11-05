import { test, expect, type Page } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import { seed } from './support/storage';

// Top-level navigation: the four tabs are destinations, not a history. Repeated tab taps must not
// stack copies of the same screen, and Back from a page opened on top returns to where it was
// opened. The browser clock is Monday, November 9, 2026, 9:00, on the fictional demo.

const TODAY = '2026-11-09';
// VoiceOver reads Today's date with its title.
const TODAY_TITLE = 'Today, Monday, November 9';
// Another day is titled with its date, read in full.
const WED_TITLE = 'Wednesday, November 11';
const TITLES = [TODAY_TITLE, 'This week', 'Programs', 'Progress'];

async function openDemo(page: Page) {
  await seed(page, demoState(TODAY), { clock: new Date(2026, 10, 9, 9), route: '/' });
  await expect(page.getByRole('heading', { name: TODAY_TITLE, exact: true })).toBeVisible();
}

/** Copies of a screen in the page: a screen left underneath in a stack stays mounted, hidden. */
const copies = (page: Page, title: string) =>
  page.getByRole('heading', { name: title, exact: true, includeHidden: true }).count();

async function tab(page: Page, name: string, title: string) {
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('switching tabs many times keeps at most one copy of each screen', async ({ page }) => {
  await openDemo(page);
  for (let i = 0; i < 5; i++) {
    await tab(page, 'Week', 'This week');
    await tab(page, 'Progress', 'Progress');
    await tab(page, 'Programs', 'Programs');
    await tab(page, 'Today', TODAY_TITLE);
  }
  for (const title of TITLES) expect(await copies(page, title), title).toBeLessThanOrEqual(1);
});

test('tapping the tab already open does nothing', async ({ page }) => {
  await openDemo(page);
  await tab(page, 'Week', 'This week');
  for (let i = 0; i < 5; i++) await page.getByRole('link', { name: 'Week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  expect(page.url()).toMatch(/\/week$/);
  for (const title of TITLES) expect(await copies(page, title), title).toBeLessThanOrEqual(1);
});

test('Back from pages opened on top returns where they were opened', async ({ page }) => {
  await openDemo(page);
  // Settings, then Backup on top of it: Back walks back down to Today.
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Backup and restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: TODAY_TITLE, exact: true })).toBeVisible();
  // The demo's trading is paused, so Trading opens from Programs; Rules & GEX opens on top of
  // it, and Back walks down the same way: rules, Trading, Programs.
  await tab(page, 'Programs', 'Programs');
  await page
    .getByRole('button', {
      name: 'Open the trading cockpit for Follow my trading plan',
      exact: true,
    })
    .click();
  await expect(page.getByRole('heading', { name: 'Trading', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Open Rules & GEX/ }).click();
  await expect(page.getByRole('heading', { name: 'Rules & GEX', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trading', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible();
  expect(await copies(page, 'Programs')).toBe(1);
  expect(await copies(page, 'Trading')).toBe(0);
  expect(await copies(page, 'Rules & GEX')).toBe(0);
  // Opened directly (a reload, a link), the rules' Back goes to Trading, not out of the app.
  await page.goto('/bias-board');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trading', exact: true })).toBeVisible();
});

test('a tab tapped on a page opened on top goes to that tab, without stacking', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await tab(page, 'Today', TODAY_TITLE);
  expect(await copies(page, 'Settings')).toBe(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await tab(page, 'Week', 'This week');
  expect(await copies(page, 'Settings')).toBe(0);
  for (const title of TITLES) expect(await copies(page, title), title).toBeLessThanOrEqual(1);
});

test('a day opened from Week returns to Week, and the Today tab shows the actual today', async ({
  page,
}) => {
  await openDemo(page);
  await tab(page, 'Week', 'This week');
  await page.getByRole('link', { name: /^Wed, Nov 11.*Open day$/ }).click();
  await expect(page.getByRole('heading', { name: WED_TITLE, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^Wed, Nov 11.*Open day$/ }).click();
  await expect(page.getByRole('heading', { name: WED_TITLE, exact: true })).toBeVisible();
  await tab(page, 'Today', TODAY_TITLE);
  // The actual today: titled Today, with no way back to it needed.
  await expect(page.getByRole('button', { name: 'Back to today', exact: true })).toHaveCount(0);
  for (const title of TITLES) expect(await copies(page, title), title).toBeLessThanOrEqual(1);
});

test('a deep link to a tab still opens it, and the other tabs work from there', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
  await tab(page, 'Programs', 'Programs');
  await tab(page, 'Today', TODAY_TITLE);
  for (const title of TITLES) expect(await copies(page, title), title).toBeLessThanOrEqual(1);
});
