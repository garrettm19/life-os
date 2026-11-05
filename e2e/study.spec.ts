import { test, expect, type Page } from '@playwright/test';
import type { State } from '../src/domain/model';
import { studyState } from '../src/test-support/fixtures';
import { ensureDay } from '../src/domain/rotation';
import { saved, seed } from './support/storage';
import { stepDay } from './support/today';

// The browser clock is pinned to Monday, November 9, 2026 at 9:00 local, so
// "today" is known and a 60-minute session never crosses midnight.
const MON = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);
const blockId = `${MON}:routine:study`;
const MIN = 60_000;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const open = (page: Page, state: State = studyState()) =>
  seed(page, state, { clock: NINE, route: '/' });
const slot = (page: Page) =>
  page.evaluate((id) => localStorage.getItem(`life-os-active-study:${id}`), blockId);
const status = (state: State) => state.days[MON].blocks.find((b) => b.id === blockId)!.status;
/** Today's study row: one row in the list, like any other. */
const row = (page: Page) => page.getByTestId('row:Daily study');
const timer = (page: Page) =>
  row(page).getByRole('button', { name: 'Use the timer for Daily study', exact: true });
/** Opens the row's folded details: the resource, Skip, the reminder and the plan's cue. */
async function details(page: Page) {
  await row(page)
    .getByRole('button', { name: 'Show details for Daily study', exact: true })
    .click();
}
const countdown = (page: Page) => page.getByLabel(/seconds left|Time is up for/);

test('a full study session runs on the clock, survives a reload, and completes only on confirmation', async ({
  page,
}) => {
  await open(page);
  // Study is a row at its place, with a short caption; the trailing Timer is optional.
  await expect(row(page).getByText('60 min target', { exact: true })).toBeVisible();
  await expect(page.getByText(/required today/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/study-row.png' });
  await timer(page).click();
  await expect(page.getByText('60:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start the study session', exact: true }).click();
  await expect(page.getByText('Stage 1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Learn and implement' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Course notes', exact: true })).toBeVisible();
  await page.clock.runFor(MIN);
  await expect(countdown(page)).toHaveText(/^(24:00|23:5\d)$/);
  await page.screenshot({ path: 'test-results/study-running.png' });
  // Paused time never counts.
  await page.getByRole('button', { name: 'Pause Learn and implement' }).click();
  const pausedAt = (await countdown(page).textContent())!;
  await page.clock.fastForward(10 * MIN);
  await expect(countdown(page)).toHaveText(pausedAt);
  await expect(page.getByText('Stage 1 of 3 · paused', { exact: true })).toBeVisible();
  // Leaving and reopening the app keeps the session exactly where it was.
  await page.getByRole('button', { name: 'Close the study session', exact: true }).click();
  await page.reload();
  await expect(row(page).getByText('Paused · stage 1 of 3', { exact: true })).toBeVisible();
  // The row is the study objective's one place on Today: no card above the list.
  await expect(row(page)).toHaveCount(1);
  await expect(page.getByTestId('study-card')).toHaveCount(0);
  await row(page).getByRole('button', { name: 'Open timer: Daily study', exact: true }).click();
  await expect(countdown(page)).toHaveText(pausedAt);
  await page.getByRole('button', { name: 'Resume Learn and implement' }).click();
  // Away in other apps for half an hour: the stage clock keeps running but stops at its plan.
  await page.clock.fastForward(30 * MIN);
  await expect(page.getByText('Stage 1 of 3 · time is up', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/study-time-up.png' });
  await expect(countdown(page)).toHaveText('0:00');
  await expect(
    page.getByText('25 of 60 min · next · Algorithm-recognition practice'),
  ).toBeVisible();
  // Nothing is recorded or completed before the user confirms.
  let state = await saved(page);
  expect(state.activitySessions).toEqual([]);
  expect(status(state)).toBe('planned');
  await page
    .getByRole('button', { name: 'Start stage 2, Algorithm-recognition practice', exact: true })
    .click();
  await page.clock.fastForward(31 * MIN);
  await page.getByRole('button', { name: 'Start stage 3, Review mistakes', exact: true }).click();
  await page.clock.fastForward(5 * MIN);
  await page.getByRole('button', { name: 'Review the session', exact: true }).click();
  await expect(page.getByText('Every stage complete', { exact: true })).toBeVisible();
  await expect(page.getByText('60 of 60 min', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/study-review.png' });
  await page
    .getByRole('button', {
      name: 'Confirm the study session and complete Daily study',
      exact: true,
    })
    .click();
  // Back on Today: the objective is done, in place.
  await expect(page.getByRole('button', { name: 'Undo Daily study', exact: true })).toBeVisible();
  await expect(row(page).getByText(/^Done · /)).toBeVisible();
  state = await saved(page);
  expect(status(state)).toBe('done');
  expect(state.activitySessions).toHaveLength(1);
  expect(state.activitySessions[0]).toMatchObject({
    occurrenceId: blockId,
    routineId: 'study',
    minutes: 60,
  });
  expect(state.activitySessions[0].study!.stages.map((s) => [s.seconds, s.done])).toEqual([
    [1500, true],
    [1800, true],
    [300, true],
  ]);
  expect(await slot(page)).toBeNull();
});

test('a shorter session is recorded as it happened and never as a full study day', async ({
  page,
}) => {
  await open(page);
  await timer(page).click();
  await page.getByRole('button', { name: 'Start the study session', exact: true }).click();
  await page.clock.fastForward(20 * MIN);
  await page.getByRole('button', { name: 'Finish stage early', exact: true }).click();
  await expect(
    page.getByText(/5:00 early\? The session will be recorded as shorter/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish stage', exact: true }).click();
  await expect(page.getByText('Stage 2 of 3', { exact: true })).toBeVisible();
  await page.clock.fastForward(4 * MIN);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  // Running, the Ember Pause stays beside the confirmation, as its copy says.
  await expect(page.getByText(/Pausing keeps it for later instead\./)).toBeVisible();
  await page.getByRole('button', { name: 'Keep going', exact: true }).click();
  await page.getByRole('button', { name: /^Pause / }).click();
  // Paused, the confirmation holds the one primary action: the Fern Resume waits for Keep going.
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByText(/Keep going leaves it paused for later\./)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resume / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Keep going', exact: true }).click();
  await page.getByRole('button', { name: /^Resume / }).click();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Pause / })).toBeVisible();
  await page
    .getByRole('button', {
      name: 'End and save what was timed, keeping the objective open',
      exact: true,
    })
    .click();
  await expect(page.getByText('Shorter session recorded', { exact: true })).toBeVisible();
  await expect(page.getByText('24 of 60 min', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Counts for Day Cleared. Progress shows it as a shorter session.', {
      exact: true,
    }),
  ).toBeVisible();
  let state = await saved(page);
  expect(status(state)).toBe('planned');
  expect(state.activitySessions[0].minutes).toBe(24);
  expect(state.activitySessions[0].study!.stages.map((s) => s.done)).toEqual([true, false, false]);
  await page.getByRole('button', { name: 'Close the study session', exact: true }).click();
  // Counting it as done is an explicit choice, and Today keeps saying what really happened.
  await expect(
    row(page).getByText('24 of 60 min recorded · still open', { exact: true }),
  ).toBeVisible();
  await row(page).getByRole('button', { name: 'Mark Daily study done', exact: true }).click();
  await expect(page.getByText('Done · 24 of 60 min timed')).toBeVisible();
  state = await saved(page);
  expect(status(state)).toBe('done');
});

test('one tap completes study without inventing minutes; the job search stays separate', async ({
  page,
}) => {
  await open(page);
  // Study and the job search are two distinct rows in the one list, with no Career heading, and
  // Today shows no study streak: no objective gets more weight than another.
  await expect(page.getByText('Career', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^(New )?[Ss]tudy streak|^New streak/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Job search done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Job search', exact: true })).toBeVisible();
  // One tap on the row's check, no timer.
  await row(page).getByRole('button', { name: 'Mark Daily study done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Daily study', exact: true })).toBeVisible();
  await expect(page.getByText(/no timed study/)).toHaveCount(0);
  let state = await saved(page);
  expect(status(state)).toBe('done');
  expect(state.activitySessions).toEqual([]);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'job-search')!.status).toBe('done');
  // Undo reopens it in place; Mark done is one tap again.
  await page.getByRole('button', { name: 'Undo Daily study', exact: true }).click();
  await row(page).getByRole('button', { name: 'Mark Daily study done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Daily study', exact: true })).toBeVisible();
  state = await saved(page);
  expect(status(state)).toBe('done');
  expect(state.activitySessions).toEqual([]);
  // The study streak is kept on Progress, recalculated from the record.
  await page.goto('/review');
  await expect(page.getByText('Study streak 1 · best 1', { exact: true }).first()).toBeVisible();
});

test('the study plan can be edited from the session; a running session keeps its own plan', async ({
  page,
}) => {
  await open(page);
  await timer(page).click();
  await page.getByRole('button', { name: 'Edit plan, time and reminders', exact: true }).click();
  await page.getByLabel('Stage 3 minutes', { exact: true }).fill('10');
  await page.getByLabel('Preferred study time (24-hour, optional)', { exact: true }).fill('19:30');
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(page.getByText('65:00', { exact: true })).toBeVisible();
  await expect(page.getByText('3 stages · planned 7:30 PM')).toBeVisible();
  const state = await saved(page);
  const plan = state.programs.flatMap((p) => p.routines).find((r) => r.id === 'study')!.study!;
  expect(plan.stages.map((s) => s.minutes)).toEqual([25, 30, 10]);
  expect(plan.at).toBe(19 * 60 + 30);
  // Invalid input is refused with a message and nothing is saved.
  await page.getByRole('button', { name: 'Edit plan, time and reminders', exact: true }).click();
  await page.getByLabel('Stage 1 links (one per line: Label | https://…)').fill('Course notes');
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(page.getByText(/Write each link as Label \| https/)).toBeVisible();
});

test('Programs creates a study objective from its type with the 25 + 30 + 5 plan', async ({
  page,
}) => {
  await page.clock.install({ time: NINE });
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Study session', exact: true }).click();
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue('Daily study');
  await page.getByLabel('Program name', { exact: true }).fill('Learning');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  // A new study objective goes straight to its plan.
  await expect(page.getByText('Study plan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit study plan for Daily study', exact: true }),
  ).toBeVisible();
  const state = await saved(page);
  const routine = state.programs[0].routines[0];
  expect(routine.study!.stages.map((s) => s.minutes)).toEqual([25, 30, 5]);
  expect(routine.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(routine.capture).toBeUndefined();
  // The streak starts the day the objective became a study objective.
  expect(routine.study!.trackFrom).toBe(MON);
  await page.goto('/');
  await expect(row(page).getByRole('button', { name: 'Mark Daily study done' })).toBeVisible();
});

test('a session under a minute is refused in view, and another day cannot start a new session', async ({
  page,
}) => {
  // Yesterday was opened (its study objective is still open): a past day is never opened by looking.
  const state = studyState();
  const sunday = '2026-11-08';
  state.days[sunday] = ensureDay(state, sunday, new Date(2026, 10, 8, 9).toISOString()).days[
    sunday
  ];
  await open(page, state);
  await timer(page).click();
  await page.getByRole('button', { name: 'Start the study session', exact: true }).click();
  await page.clock.runFor(20_000);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'End and save what was timed, keeping the objective open',
      exact: true,
    })
    .click();
  // The refusal is shown inside the full-screen session, not hidden behind it.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Less than a minute was timed' }).last(),
  ).toBeVisible();
  expect((await saved(page)).activitySessions).toEqual([]);
  await page.getByRole('button', { name: 'Close the study session', exact: true }).click();
  // Yesterday's open study objective cannot start a new timer today.
  await stepDay(page, 'Previous day');
  await page.getByRole('button', { name: /^Open the timer for Daily study/ }).click();
  await expect(page.getByText(/A study session starts on its own day/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start the study session', exact: true }),
  ).toBeDisabled();
});

test('reminder choices are saved with the plan and say honestly where they work', async ({
  page,
}) => {
  await open(page);
  await timer(page).click();
  await page.getByRole('button', { name: 'Edit plan, time and reminders', exact: true }).click();
  // The browser preview has no local notifications and says so; the choice is still saved.
  await expect(page.getByText(/This preview cannot schedule notifications/)).toBeVisible();
  await page.getByRole('switch', { name: 'Remind me at my study time', exact: true }).click();
  // A start reminder needs a time.
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(page.getByText(/Choose a study time for the reminder/)).toBeVisible();
  await page.getByLabel('Preferred study time (24-hour, optional)', { exact: true }).fill('19:00');
  await page
    .getByRole('switch', { name: 'Evening reminder if the study is still open', exact: true })
    .click();
  await page.getByLabel('Evening reminder time (24-hour)', { exact: true }).fill('9pm');
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(page.getByText(/Enter the evening reminder time in 24-hour form/)).toBeVisible();
  await page.getByLabel('Evening reminder time (24-hour)', { exact: true }).fill('21:30');
  await page.getByRole('switch', { name: "Alert when a stage's time is up", exact: true }).click();
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(page.getByText('3 stages · planned 7:00 PM')).toBeVisible();
  const plan = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.id === 'study')!.study!;
  expect(plan.at).toBe(19 * 60);
  expect(plan.reminders).toEqual({ start: true, evening: 21 * 60 + 30, stageEnd: true });
});

test('a session that crosses midnight stays reachable from the next day and records on its own day', async ({
  page,
}) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 23, 30), route: '/' });
  await timer(page).click();
  await page.getByRole('button', { name: 'Start the study session', exact: true }).click();
  await page.clock.fastForward(25 * MIN);
  await page
    .getByRole('button', { name: 'Start stage 2, Algorithm-recognition practice', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close the study session', exact: true }).click();
  // Past midnight: Tuesday shows Monday's session still in progress, and its own new row.
  await page.clock.fastForward(31 * MIN);
  await page.reload();
  const monday = page.getByTestId('study-card').filter({ hasText: 'Mon · ' });
  await expect(monday.getByText('Mon · Timer · Stage 2 of 3')).toBeVisible();
  await monday.getByRole('button', { name: /Daily study/ }).click();
  await expect(page.getByText('Stage 2 of 3 · time is up', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start stage 3, Review mistakes', exact: true }).click();
  await page.clock.fastForward(5 * MIN);
  await page.getByRole('button', { name: 'Review the session', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Confirm the study session and complete Daily study',
      exact: true,
    })
    .click();
  const state = await saved(page);
  expect(state.activitySessions[0]).toMatchObject({
    date: MON,
    occurrenceId: blockId,
    minutes: 60,
  });
  expect(status(state)).toBe('done');
  await expect(page.getByTestId('study-card').filter({ hasText: 'Mon · ' })).toHaveCount(0);
});

test('a daily study reminder is set from the Today row in a few taps, with no time assumed', async ({
  page,
}) => {
  await open(page);
  await details(page);
  await row(page).getByRole('button', { name: 'Set a study reminder', exact: true }).click();
  await expect(
    page.getByLabel('Preferred study time (24-hour, optional)', { exact: true }),
  ).toHaveValue('');
  await page.getByRole('switch', { name: 'Remind me at my study time', exact: true }).click();
  await expect(page.getByText(/Repeats on each study day at your study time/)).toBeVisible();
  await page.getByLabel('Preferred study time (24-hour, optional)', { exact: true }).fill('19:30');
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(
    row(page).getByRole('button', { name: 'Study reminder at 7:30 PM. Change it', exact: true }),
  ).toBeVisible();
  let plan = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.id === 'study')!.study!;
  expect(plan).toMatchObject({ at: 19 * 60 + 30, reminders: { start: true, evening: null } });
  // Turning it off keeps the time, so it can be resumed.
  await row(page)
    .getByRole('button', { name: 'Study reminder at 7:30 PM. Change it', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Remind me at my study time', exact: true }).click();
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(row(page).getByRole('button', { name: 'Set a study reminder' })).toBeVisible();
  plan = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.id === 'study')!.study!;
  expect(plan).toMatchObject({ at: 19 * 60 + 30, reminders: { start: false } });
});

test('study resources open from the row without completing anything; the cue shows as a plan', async ({
  page,
}) => {
  await open(page);
  // Record what the row asks the system to open instead of leaving the test page.
  await page.evaluate(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await details(page);
  await row(page)
    .getByRole('button', { name: 'Open Course notes for Daily study', exact: true })
    .click();
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([
    'https://example.com/course',
  ]);
  expect(status(await saved(page))).toBe('planned');
  // A starting cue, in the user's words, is shown as the plan; it is not a reminder.
  await row(page).getByRole('button', { name: 'Set a study reminder', exact: true }).click();
  await page.getByLabel('Starting cue (optional)', { exact: true }).fill('After dinner');
  await page
    .getByLabel('Stage 2 links (one per line: Label | https://…)')
    .fill('Recognition practice | https://example.com/practice');
  await page.getByRole('button', { name: 'Save study plan', exact: true }).click();
  await expect(row(page).getByText('Plan · After dinner', { exact: true })).toBeVisible();
  // Two resources now: the row lists them.
  await row(page)
    .getByRole('button', { name: 'Show study resources for Daily study', exact: true })
    .click();
  await expect(row(page).getByRole('link', { name: 'Open Recognition practice' })).toBeVisible();
  await page.screenshot({ path: 'test-results/study-row-resources.png' });
  const plan = (await saved(page)).programs
    .flatMap((p) => p.routines)
    .find((r) => r.id === 'study')!.study!;
  expect(plan.cue).toBe('After dinner');
  expect(plan.reminders.start).toBe(false);
});

test('a study objective without links offers to add them instead of a broken button', async ({
  page,
}) => {
  const state = studyState();
  for (const p of state.programs)
    for (const r of p.routines)
      if (r.study)
        r.study = { ...r.study, stages: r.study.stages.map((s) => ({ ...s, links: [] })) };
  await open(page, state);
  await details(page);
  await row(page)
    .getByRole('button', { name: 'Add study links for Daily study', exact: true })
    .click();
  await expect(page.getByText('Study plan', { exact: true })).toBeVisible();
});

test('a double tap on Start study starts the session, never pausing it at once', async ({
  page,
}) => {
  // A first stage with a short title and no links: the big Pause takes Start's place on screen.
  const state = studyState();
  const study = state.programs.find((p) => p.id === 'career')!.routines[0].study!;
  study.stages[0] = { ...study.stages[0], title: 'Example problems', links: [] };
  await open(page, state);
  await timer(page).click();
  // Two taps on the same spot, a quarter of a second apart, as a person double-taps.
  const start = (await page
    .getByRole('button', { name: 'Start the study session', exact: true })
    .boundingBox())!;
  const [x, y] = [start.x + start.width / 2, start.y + start.height / 2];
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
  await page.mouse.click(x, y);
  await expect(page.getByText('Stage 1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Stage 1 of 3 · paused', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pause / })).toBeVisible();
  // A deliberate tap a moment later still pauses it.
  await page.clock.runFor(MIN);
  await page.getByRole('button', { name: /^Pause / }).click();
  await expect(page.getByText('Stage 1 of 3 · paused', { exact: true })).toBeVisible();
});
