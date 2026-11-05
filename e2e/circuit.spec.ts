import { test, expect, type Page } from '@playwright/test';
import type { IntervalPlan, State } from '../src/domain/model';
import { shiftDate } from '../src/domain/model';
import { circuitState } from './support/circuit-state';
import { nextMonday } from './support/dates';
import { saved, seed } from './support/storage';

// A Tuesday in the future holds a plain checklist routine with a timed circuit.
const TUE = shiftDate(nextMonday(), 1);
const blockId = `${TUE}:routine:abs`;

/** A short synthetic circuit, so a full run takes seconds of simulated time. */
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

async function open(page: Page, state: State) {
  await seed(page, state, { clock: 'now', route: '/?date=' + TUE });
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await page.getByRole('radio', { name: 'Mute', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Mute', exact: true })).toBeChecked();
}
const countdown = (page: Page) => page.getByLabel(/seconds left/);
const status = (state: State) => state.days[TUE].blocks.find((b) => b.id === blockId)!.status;
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });

/** Whether the countdown shows its whole time: drawn at a real size and not clipped. */
async function countdownFits(page: Page) {
  return countdown(page).evaluate((el) => ({
    whole: el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width > 0,
    size: parseFloat(getComputedStyle(el).fontSize),
  }));
}

for (const width of [320, 375, 430])
  test(`the countdown shows in full during work over a minute and during rests at ${width} pt`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await open(page, circuitState());
    await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
    // 30 s to get ready, then Crunches for 70 s: 1:05 left.
    await page.clock.runFor(35_000);
    await expect(page.getByText('Work', { exact: true })).toBeVisible();
    await expect(countdown(page)).toHaveText('1:05');
    await expect(countdown(page)).toBeVisible();
    const work = await countdownFits(page);
    expect(work.whole).toBe(true);
    expect(work.size).toBeGreaterThanOrEqual(40);
    // The rest after it.
    await page.clock.runFor(70_000);
    await expect(page.getByText('Rest · up next')).toBeVisible();
    await expect(countdown(page)).toHaveText('0:05');
    const rest = await countdownFits(page);
    expect(rest.whole).toBe(true);
    expect(rest.size).toBe(work.size);
  });

test('the preset circuit runs from the clock, pauses, skips and comes back paused after a reload', async ({
  page,
}) => {
  await open(page, circuitState());
  await expect(page.getByText('14:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await expect(page.getByText('Get ready · first up')).toBeVisible();
  await expect(heading(page, 'Crunches')).toBeVisible();
  await page.clock.runFor(65_000);
  await expect(page.getByText('Work', { exact: true })).toBeVisible();
  await expect(countdown(page)).toHaveText('0:35');
  await expect(page.getByText('Next · Rest, then Bicycle Kicks')).toBeVisible();
  // Paused time does not count.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.runFor(60_000);
  await expect(countdown(page)).toHaveText('0:35');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  // Next skips to the rest, which already shows what comes next; Previous goes back.
  await page.getByRole('button', { name: 'Next interval', exact: true }).click();
  await expect(page.getByText('Rest · up next')).toBeVisible();
  await expect(heading(page, 'Bicycle Kicks')).toBeVisible();
  await page.getByRole('button', { name: 'Previous interval', exact: true }).click();
  await expect(heading(page, 'Crunches')).toBeVisible();
  await page.clock.runFor(5_000);
  // Closing pauses it; nothing is recorded and the objective stays open.
  await page.getByRole('button', { name: 'Close the timer', exact: true }).click();
  let state = await saved(page);
  expect(state.intervalSessions).toEqual([]);
  expect(status(state)).toBe('planned');
  expect(state.settings.timerCue).toBe('mute');
  // A reload brings it back paused where it was, never as if it kept running.
  await page.reload();
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByText('Paused · Work')).toBeVisible();
  await page.clock.runFor(30_000);
  await expect(page.getByText('Paused · Work')).toBeVisible();
  // A jump in the clock (the app suspended without notice) pauses instead of finishing.
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.fastForward(20 * 60_000);
  await page.clock.runFor(1_000);
  await expect(page.getByText(/the timer was interrupted/)).toBeVisible();
  await expect(page.getByText('Paused · Work')).toBeVisible();
  state = await saved(page);
  expect(state.intervalSessions).toEqual([]);
  expect(status(state)).toBe('planned');
});

test('a finished circuit records once, keeps it through Undo, and can be removed if it was a mistake', async ({
  page,
}) => {
  await open(page, circuitState(SHORT));
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(4_000);
  await expect(heading(page, 'Plank')).toBeVisible();
  await page.clock.runFor(7_500);
  await expect(heading(page, 'Hollow hold')).toBeVisible();
  // Next on the last interval asks before it finishes.
  await page.getByRole('button', { name: 'Next interval', exact: true }).click();
  await expect(page.getByText(/This is the last interval/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep going', exact: true }).click();
  await page.clock.runFor(6_000);
  await expect(page.getByText('Circuit complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Every interval was run to its end.')).toBeVisible();
  let state = await saved(page);
  expect(state.intervalSessions).toHaveLength(1);
  expect(state.intervalSessions[0]).toMatchObject({
    id: `interval:${blockId}`,
    occurrenceId: blockId,
    plannedSeconds: 15,
    skipped: [],
  });
  expect(status(state)).toBe('done');
  await page.screenshot({ path: 'test-results/circuit-complete.png' });
  await page.getByRole('button', { name: 'Close the timer', exact: true }).click();
  // Undo keeps the recorded circuit; marking it done again never records a second one.
  await page.getByRole('button', { name: 'Undo Core circuit', exact: true }).click();
  await expect(page.getByText('Circuit recorded · tap to mark done')).toBeVisible();
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await page
    .getByRole('button', { name: 'Mark Core circuit done from the recorded circuit', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Undo Core circuit', exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.intervalSessions).toHaveLength(1);
  expect(status(state)).toBe('done');
  // A mistaken recording can be removed deliberately; the objective is open again.
  await page.getByRole('button', { name: /^Open Core circuit/ }).click();
  await page.getByRole('button', { name: 'Remove this recorded circuit', exact: true }).click();
  await page.getByRole('button', { name: 'Remove circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start the timer', exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.intervalSessions).toEqual([]);
  expect(status(state)).toBe('planned');
});

test('ending early, or skipping every interval, records nothing', async ({ page }) => {
  await open(page, circuitState(SHORT));
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(5_000);
  await expect(heading(page, 'Plank')).toBeVisible();
  await page.screenshot({ path: 'test-results/circuit-running.png' });
  await page.getByRole('button', { name: 'End the circuit', exact: true }).click();
  await page.getByRole('button', { name: 'End circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start the timer', exact: true })).toBeVisible();
  let state = await saved(page);
  expect(state.intervalSessions).toEqual([]);
  expect(status(state)).toBe('planned');
  expect(
    await page.evaluate((id) => localStorage.getItem(`life-os-active-circuit:${id}`), blockId),
  ).toBeNull();
  // Next through everything reaches the end but is not a completed circuit.
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Next interval', exact: true }).click();
  await page.getByRole('button', { name: 'Next interval', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and record', exact: true }).click();
  await expect(page.getByText(/Every interval was skipped/)).toBeVisible();
  state = await saved(page);
  expect(state.intervalSessions).toEqual([]);
  expect(status(state)).toBe('planned');
});

test('the circuit editor changes lengths and rests, shows the total, and restores the original', async ({
  page,
}) => {
  await seed(page, circuitState(), { route: '/programs' });
  await page
    .getByRole('button', { name: 'Edit timed circuit for Core circuit', exact: true })
    .click();
  await page.getByLabel('Crunches length in seconds', { exact: true }).fill('60');
  await page.getByLabel('Rest after Crunches in seconds', { exact: true }).fill('0');
  await expect(page.getByText('13:40', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save circuit', exact: true }).click();
  await expect(page.getByText('Timed circuit · 13:40')).toBeVisible();
  let state = await saved(page);
  expect(state.intervalRoutines[0].steps[0]).toMatchObject({ seconds: 60, restAfter: 0 });
  await page
    .getByRole('button', { name: 'Edit timed circuit for Core circuit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Restore original…', exact: true }).click();
  await page.getByRole('button', { name: 'Restore original', exact: true }).click();
  await expect(page.getByText('14:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save circuit', exact: true }).click();
  await expect(page.getByText('Timed circuit · 14:00')).toBeVisible();
  state = await saved(page);
  expect(state.intervalRoutines[0].steps[0]).toMatchObject({ seconds: 70, restAfter: 10 });
});

test('a circuit finished with a skipped interval is recorded as done, but not as the full circuit', async ({
  page,
}) => {
  await open(page, circuitState(SHORT));
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(4_000);
  // Cut Plank short; let the rest of the circuit run to its end.
  await page.getByRole('button', { name: 'Next interval', exact: true }).click();
  await page.clock.runFor(10_000);
  await expect(page.getByText('Circuit finished with skips')).toBeVisible();
  let state = await saved(page);
  expect(state.intervalSessions[0]).toMatchObject({ skipped: ['Plank'] });
  // The objective is left open; counting it is a deliberate choice.
  expect(status(state)).toBe('planned');
  await page
    .getByRole('button', { name: /^Mark Core circuit done from the recorded circuit/ })
    .click();
  state = await saved(page);
  expect(status(state)).toBe('done');
  await expect(page.getByText('Done · circuit with 1 interval skipped')).toBeVisible();
});

test('an interval removed while its length is cleared never holds Save back', async ({ page }) => {
  await seed(page, circuitState(), { route: '/programs' });
  await page
    .getByRole('button', { name: 'Edit timed circuit for Core circuit', exact: true })
    .click();
  await page.getByLabel('Bicycle Kicks length in seconds', { exact: true }).fill('');
  await expect(page.getByText('14:00', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Bicycle Kicks', exact: true }).click();
  // Every field left holds a number: the total comes back without the removed 1:20.
  await expect(page.getByText('12:40', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save circuit', exact: true }).click();
  await expect(page.getByText('Timed circuit · 12:40')).toBeVisible();
  await expect(page.getByText('Use whole seconds for every length and rest.')).toHaveCount(0);
  const steps = (await saved(page)).intervalRoutines[0].steps;
  expect(steps).toHaveLength(12);
  expect(steps.some((s) => s.id === 'bicycle-kicks')).toBe(false);
});

test("Today's row says a circuit is paused where it was, after closing and after a reload", async ({
  page,
}) => {
  await open(page, circuitState());
  await page.getByRole('button', { name: 'Start the timer', exact: true }).click();
  await page.clock.runFor(200_000);
  await page.getByRole('button', { name: 'Close the timer', exact: true }).click();
  const row = page.getByTestId('row:Core circuit');
  await expect(row).toContainText(/Paused at 3:2\d · tap to resume/);
  await expect(
    row.getByRole('button', { name: /^Open Core circuit\. Paused at 3:2\d, tap to resume/ }),
  ).toBeVisible();
  await page.reload();
  await expect(row).toContainText(/Paused at 3:2\d · tap to resume/);
  // Opened, it resumes exactly there.
  await page.getByRole('button', { name: 'Start Core circuit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});
