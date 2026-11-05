import { test, expect, type Locator, type Page } from '@playwright/test';
import { emptyState, type Program, type Routine, type State } from '../src/domain/model';
import { scaleText } from './support/layout-probe';
import { saved, seed } from './support/storage';
import { openMore } from './support/today';

// The Order of the day sheet, on synthetic routines. The browser clock is Monday, November 9,
// 2026, 9:00.

const NINE = new Date(2026, 10, 9, 9);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const routine = (id: string, title: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title,
  duration: null,
  weekdays: EVERY_DAY,
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

function device(): State {
  const programs: Program[] = [
    {
      id: 'morning',
      title: 'Example morning',
      group: 'Example',
      goalIds: [],
      routines: [routine('walk', 'Example walk'), routine('wake', 'Example wake up')],
    },
    {
      id: 'gym',
      title: 'Example strength',
      group: 'Training',
      goalIds: [],
      routines: [
        routine('push', 'Example push day', { weekdays: [] }),
        routine('pull', 'Example pull day', { weekdays: [] }),
      ],
      rotation: { order: ['push', 'pull'], restDays: [0], startWith: 'push' },
    },
    {
      id: 'evening',
      title: 'Example evening',
      group: 'Example',
      goalIds: [],
      routines: [
        routine('read', 'Example reading with a long name that wraps on a narrow phone'),
        routine('paused', 'Example paused habit', { enabled: false }),
      ],
    },
  ];
  return { ...emptyState(), source: 'personal', programs };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const entries = (page: Page) => page.getByTestId('day-order-entry');

const titles = (page: Page) => page.getByTestId('day-order-title').allTextContents();

test('reorder from Programs: one entry per rotation, saved to every listed routine', async ({
  page,
}) => {
  await seed(page, device(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: /^Order of the day: / }).click();
  await expect(page.getByText('Order of the day', { exact: true }).first()).toBeVisible();
  // Every routine that can come up, the rotation once under its program; never a paused one.
  expect(await titles(page)).toEqual([
    'Example walk',
    'Example wake up',
    'Example strength',
    'Example reading with a long name that wraps on a narrow phone',
  ]);
  await expect(page.getByText('Rotation · 2 workouts', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Example walk earlier' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Example wake up earlier' }).click();
  await page
    .getByRole('button', {
      name: 'Move Example reading with a long name that wraps on a narrow phone earlier',
    })
    .click();
  expect(await titles(page)).toEqual([
    'Example wake up',
    'Example walk',
    'Example reading with a long name that wraps on a narrow phone',
    'Example strength',
  ]);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Save order' }).click();
  await expect(entries(page)).toHaveCount(0);
  const after = await saved(page);
  const order = (id: string) =>
    after.programs.flatMap((p) => p.routines).find((r) => r.id === id)?.dayOrder;
  expect(['wake', 'walk', 'read', 'push', 'pull', 'paused'].map(order)).toEqual([
    0,
    10,
    20,
    30,
    30,
    undefined,
  ]);
  // Only the order changed: every day stays exactly as recorded.
  expect(after.days).toEqual(before.days);
  // The row in Programs reads the new order.
  await expect(
    page.getByRole('button', { name: /^Order of the day: Example wake up · Example walk · / }),
  ).toBeVisible();
});

test('closing with changes asks first; Discard keeps the saved order', async ({ page }) => {
  await seed(page, device(), { clock: NINE, route: '/' });
  await openMore(page);
  await page.getByRole('button', { name: 'Change the order of the day' }).click();
  await page.getByRole('button', { name: 'Move Example wake up earlier' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Discard your changes to the order?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  expect((await titles(page))[0]).toBe('Example wake up');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(entries(page)).toHaveCount(0);
  const stored = await saved(page);
  expect(stored.programs.flatMap((p) => p.routines).some((r) => r.dayOrder !== undefined)).toBe(
    false,
  );
  // Closing without a change closes at once.
  await page.getByRole('button', { name: 'Change the order of the day' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(entries(page)).toHaveCount(0);
});

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('Not visible');
  return b;
}

const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the move buttons keep 44 pt and never cover a title, at 320 pt and doubled text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await seed(page, device(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: /^Order of the day: / }).click();
  await expect(entries(page)).toHaveCount(4);
  await scaleText(page, 2);
  // Doubled text widens the page behind the sheet too, so rows are measured against their list.
  const list = await box(page.getByRole('list'));
  for (let i = 0; i < 4; i++) {
    const row = entries(page).nth(i);
    await row.scrollIntoViewIfNeeded();
    const buttons = row.getByRole('button', { name: /(earlier|later)$/ });
    await expect(buttons).toHaveCount(2);
    const text = await box(row.getByTestId('day-order-text'));
    const rowBox = await box(row);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(list.x + list.width + 0.5);
    for (let b = 0; b < 2; b++) {
      const button = await box(buttons.nth(b));
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.x + button.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
      // The title and caption wrap beside the buttons, never under them.
      expect(intersects(text, button)).toBe(false);
    }
    if (i > 0) {
      const above = await box(entries(page).nth(i - 1));
      expect(above.y + above.height).toBeLessThanOrEqual(rowBox.y + 0.5);
    }
  }
});

test('tapping a name offers Move to top and Move to bottom, one tap however far', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, device(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: /^Order of the day: / }).click();
  const last = 'Example reading with a long name that wraps on a narrow phone';
  // The top and bottom moves stay folded until a name is tapped.
  await expect(page.getByRole('button', { name: `Move ${last} to the top` })).toHaveCount(0);
  const name = page.getByRole('button', { name: new RegExp(`^${last}, Example evening, 4 of 4`) });
  await expect(name).toHaveAttribute('aria-expanded', 'false');
  await name.click();
  await expect(name).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: `Move ${last} to the bottom` })).toBeDisabled();
  await page.getByRole('button', { name: `Move ${last} to the top` }).click();
  expect(await titles(page)).toEqual([last, 'Example walk', 'Example wake up', 'Example strength']);
  // The entry stays picked where it landed, so the next move is right there.
  await expect(page.getByRole('button', { name: `Move ${last} to the top` })).toBeDisabled();
  await page.getByRole('button', { name: `Move ${last} to the bottom` }).click();
  expect((await titles(page)).at(-1)).toBe(last);
  for (const label of [`Move ${last} to the top`, `Move ${last} to the bottom`]) {
    const b = await box(page.getByRole('button', { name: label }));
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  }
  // Tapping the name again folds them away.
  await page.getByRole('button', { name: new RegExp(`^${last}, Example evening, 4 of 4`) }).click();
  await expect(page.getByRole('button', { name: `Move ${last} to the top` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Example walk, Example morning, 1 of 4' }).click();
  await page.getByRole('button', { name: 'Move Example walk to the bottom' }).click();
  await page.getByRole('button', { name: 'Save order' }).click();
  await expect(entries(page)).toHaveCount(0);
  const after = await saved(page);
  const order = (id: string) =>
    after.programs.flatMap((p) => p.routines).find((r) => r.id === id)?.dayOrder;
  expect(['wake', 'push', 'pull', 'read', 'walk'].map(order)).toEqual([0, 10, 10, 20, 30]);
});

test('a sheet opens with focus inside it, not on the backdrop, and a tap on the backdrop closes it', async ({
  page,
}) => {
  await seed(page, device(), { clock: NINE, route: '/programs' });
  await page.getByRole('button', { name: /^Order of the day: / }).click();
  await expect(entries(page)).toHaveCount(4);
  // No full-screen Dismiss control comes first: the first focus is the sheet's own Close.
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe('Close');
  const backdrop = page.getByTestId('sheet-backdrop');
  expect(await backdrop.getAttribute('tabindex')).toBeNull();
  expect(await backdrop.getAttribute('aria-hidden')).toBe('true');
  // Tabbing through the sheet never lands on the backdrop.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).not.toBe(
      'sheet-backdrop',
    );
  }
  await expect(entries(page)).toHaveCount(4);
  // A tap above the sheet still closes it.
  await page.mouse.click(10, 10);
  await expect(entries(page)).toHaveCount(0);
});
