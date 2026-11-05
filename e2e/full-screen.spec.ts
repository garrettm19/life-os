import { test, expect, type Locator } from '@playwright/test';
import type { IntervalPlan } from '../src/domain/model';
import { shiftDate } from '../src/domain/model';
import { studyState } from '../src/test-support/fixtures';
import { CORE_CIRCUIT } from '../src/domain/intervals';
import { circuitState } from './support/circuit-state';
import { nextMonday } from './support/dates';
import { scaleText, scrollMain } from './support/layout-probe';
import { saved, seed } from './support/storage';

// The full-screen timers (circuit and study) keep Close on screen, as a full target, in every
// state, at every phone width, with a long title and larger text. Browser layout only: the native
// safe area (a SafeAreaProvider inside each modal) is checked on the iPhone (docs/TESTING.md).

const TUE = shiftDate(nextMonday(), 1);
const blockId = `${TUE}:routine:abs`;
const TITLE = 'Evening core strength and stability finisher circuit';

const SHORT: IntervalPlan = {
  prepSeconds: 3,
  steps: [
    { id: 'a', name: 'Plank', seconds: 5, restAfter: 2 },
    { id: 'b', name: 'Hollow hold', seconds: 5, restAfter: 0 },
  ],
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Close is fully on screen, a 44 × 44 pt target, and clear of the title beside it. */
async function expectReachable(close: Locator, title: Locator, where: string) {
  await expect(close, where).toBeInViewport({ ratio: 1 });
  const box = (await close.boundingBox())!;
  expect(box.height, where).toBeGreaterThanOrEqual(43.5);
  expect(box.width, where).toBeGreaterThanOrEqual(43.5);
  expect(box.y, where).toBeGreaterThanOrEqual(0);
  const t = (await title.boundingBox())!;
  const overlap =
    Math.min(t.x + t.width, box.x + box.width) - Math.max(t.x, box.x) > 1 &&
    Math.min(t.y + t.height, box.y + box.height) - Math.max(t.y, box.y) > 1;
  expect(overlap, `${where}: Close overlaps the title`).toBe(false);
}

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
] as const) {
  test(`the circuit timer keeps Close reachable in every state at ${width} points`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await seed(page, circuitState(CORE_CIRCUIT, TITLE), { clock: 'now', route: '/?date=' + TUE });
    await page.getByRole('button', { name: `Start ${TITLE}`, exact: true }).click();
    const close = page.getByRole('button', { name: 'Close the timer', exact: true });
    const title = page.getByRole('heading', { name: TITLE, exact: true });
    await expectReachable(close, title, 'ready');
    // Scrolled to the bottom, the header (and Close) stays where it is.
    await scrollMain(page, 10_000);
    await expectReachable(close, title, 'ready, scrolled');
    // After the modal's fade-in, so the capture shows the settled screen.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/full-screen-circuit-${width}.png` });
    // The editor opened from the timer keeps its own Close on screen.
    await page.getByRole('button', { name: 'Edit circuit', exact: true }).click();
    const editorClose = page.getByRole('button', { name: 'Close', exact: true }).last();
    await expect(editorClose).toBeInViewport({ ratio: 1 });
    await editorClose.click();
    await page.getByRole('radio', { name: 'Mute', exact: true }).click();
    await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
    await expectReachable(close, title, 'running');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expectReachable(close, title, 'paused');
    // Larger text (a browser stand-in for Dynamic Type) still leaves Close reachable.
    await scaleText(page, 1.35);
    await expectReachable(close, title, 'paused, larger text');
    // Closing an unfinished circuit neither completes it nor drops the paused run.
    await close.click();
    expect((await saved(page)).days[TUE].blocks.find((b) => b.id === blockId)!.status).toBe(
      'planned',
    );
    await page.getByRole('button', { name: `Start ${TITLE}`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expectReachable(close, title, 'reopened');
  });
}

test('a finished circuit keeps Close reachable on its recorded screen at 320 points', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, circuitState(SHORT, TITLE), { clock: 'now', route: '/?date=' + TUE });
  await page.getByRole('button', { name: `Start ${TITLE}`, exact: true }).click();
  await page.getByRole('radio', { name: 'Mute', exact: true }).click();
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(25_000);
  await expect(page.getByText('Circuit complete', { exact: true })).toBeVisible();
  const close = page.getByRole('button', { name: 'Close the timer', exact: true });
  const title = page.getByRole('heading', { name: TITLE, exact: true });
  await expectReachable(close, title, 'recorded');
  await scrollMain(page, 10_000);
  await expectReachable(close, title, 'recorded, scrolled');
  await close.click();
  await expect(close).toHaveCount(0);
});

test('the study session keeps Close reachable at 320 points, before and while running', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
  await page
    .getByTestId('row:Daily study')
    .getByRole('button', { name: 'Use the timer for Daily study', exact: true })
    .click();
  const close = page.getByRole('button', { name: 'Close the study session', exact: true });
  const title = page.getByRole('heading', { name: 'Daily study', exact: true }).last();
  await expectReachable(close, title, 'study ready');
  await scrollMain(page, 10_000);
  await expectReachable(close, title, 'study ready, scrolled');
  await page.getByRole('button', { name: 'Start the study session', exact: true }).click();
  await expectReachable(close, title, 'study running');
  await scaleText(page, 1.35);
  await expectReachable(close, title, 'study running, larger text');
  await close.click();
  await expect(close).toHaveCount(0);
});
