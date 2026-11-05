import { test, expect } from '@playwright/test';
import type { State } from '../src/domain/model';
import { demoState } from '../src/domain/demo';
import { probeLayout, scaleText, scrollMain } from './support/layout-probe';
import { saved, seed } from './support/storage';
import { openMore } from './support/today';

// The 90-day focus, on synthetic data: the fictional demo's six weeks treated as the user's own,
// without its demo focus. The browser clock is Monday, November 9, 2026, 9:00.

const TODAY = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);
const device = (): State => ({
  ...demoState(TODAY),
  source: 'personal',
  focuses: [],
  weeklyReviews: [],
  skillCheckpoints: [],
});
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('choose a focus, link study, start from Today, and complete study as always', async ({
  page,
}) => {
  await seed(page, device(), { clock: NINE });
  // No focus: Today has no focus card and no prompt to make one.
  await page.goto('/');
  await expect(page.getByText(/90-day focus/i)).toHaveCount(0);
  const before = await saved(page);
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Choose a 90-day focus (optional)' }).click();
  await page.getByLabel('What is the priority?').fill('Problem-solving speed');
  await page.getByRole('radio', { name: 'Career and study' }).click();
  await page.getByRole('checkbox', { name: 'Coding practice' }).click();
  await page.getByRole('checkbox', { name: 'Career step' }).click();
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^90-day focus: Problem-solving speed/ }),
  ).toBeVisible();
  // Choosing a focus changed no day, routine or record.
  const after = await saved(page);
  expect(after.focuses).toHaveLength(1);
  expect({ ...after, focuses: [] }).toEqual(before);

  await page.goto('/');
  const card = page.getByRole('button', {
    name: /^90-day focus: Problem-solving speed\. Day 1 of 90/,
  });
  await openMore(page);
  await expect(card).toBeVisible();
  await expect(page.getByText('Next · Coding practice', { exact: true })).toBeVisible();
  // The study resource opens from the focus card, one tap away.
  // The example site is answered locally, so the check never depends on outside network.
  await page
    .context()
    .route('https://example.com/**', (route) => route.fulfill({ body: 'Example practice site' }));
  const popup = page.waitForEvent('popup');
  await page
    .getByRole('button', { name: 'Open Practice site (example) for Coding practice', exact: true })
    .click();
  expect((await popup).url()).toContain('example.com/practice');
  await page.screenshot({ path: 'test-results/focus-today.png' });
  // The study objective is still the ordinary one: one tap on its row's check completes it.
  await page.getByRole('button', { name: 'Mark Coding practice done', exact: true }).click();
  await expect(page.getByText('Next · Career step')).toBeVisible();
  const done = await saved(page);
  const blocks = done.days[TODAY].blocks.filter((b) => b.routineId === 'demo-study');
  expect(blocks).toHaveLength(1);
  expect(blocks[0].status).toBe('done');
  // On a Monday with the past week unreviewed, the review offered is for that week.
  await page.goto('/review');
  await expect(
    page.getByRole('button', { name: 'Review the week of Nov 2', exact: true }),
  ).toBeVisible();
});

test('the focus card fits Today at 320 points and the editor fits its sheet', async ({ page }) => {
  const state = device();
  state.focuses = [
    {
      id: 'f1',
      title: 'Become noticeably faster and calmer at solving new problems',
      goalId: 'demo-career',
      outcome: 'Solve new medium problems in time',
      evidence: 'career',
      routineIds: ['demo-study', 'demo-career-step'],
      leadRoutineId: 'demo-study',
      cue: 'If I put it off after dinner, I open the course and start with one problem.',
      baseline: '',
      target: '',
      startDate: '2026-10-26',
      reviewDate: '2027-01-24',
      status: 'active',
      endedAt: null,
      createdAt: new Date(2026, 9, 26, 9).toISOString(),
      updatedAt: new Date(2026, 9, 26, 9).toISOString(),
    },
  ];
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, state, { clock: NINE });
  for (const route of ['/', '/programs']) {
    await page.goto(route);
    if (route === '/') await openMore(page);
    await expect(page.getByRole('button', { name: /^90-day focus: Become/ })).toBeVisible();
    await scrollMain(page, 0);
    const issues = await probeLayout(page);
    expect(issues.map((i) => `${route}: ${i.kind} ${i.text} (${i.detail})`)).toEqual([]);
  }
  await page.getByRole('button', { name: /^90-day focus: Become/ }).click();
  const close = page.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeInViewport();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/focus-editor-320.png' });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  // Completing keeps the record and removes the card from Today.
  await page.getByRole('button', { name: 'Mark it complete', exact: true }).click();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^90-day focus/ })).toHaveCount(0);
  expect((await saved(page)).focuses[0].status).toBe('completed');
});

test('the weekly course correction: read the evidence, choose one adjustment, edit it', async ({
  page,
}) => {
  const state = device();
  const at = new Date(2026, 10, 2, 19).toISOString();
  state.focuses = [
    {
      id: 'f1',
      title: 'Problem-solving speed',
      goalId: null,
      outcome: '',
      evidence: 'career',
      routineIds: ['demo-study', 'demo-career-step'],
      leadRoutineId: null,
      cue: '',
      baseline: '',
      target: '',
      startDate: '2026-10-19',
      reviewDate: '2027-01-17',
      status: 'active',
      endedAt: null,
      createdAt: at,
      updatedAt: at,
    },
  ];
  state.weeklyReviews = [
    {
      id: 'w0',
      weekStart: '2026-11-02',
      focusId: 'f1',
      obstacle: 'Late evenings',
      adjustment: 'Study before dinner',
      noChange: false,
      at,
      updatedAt: at,
    },
  ];
  await seed(page, state, { clock: NINE });
  const before = await saved(page);
  await page.goto('/review');
  await expect(page.getByText('Focus · Problem-solving speed · last 7 days')).toBeVisible();
  await expect(page.getByText(/^\d+ of \d+ study days kept$/)).toBeVisible();
  await expect(
    page.getByText('Adjustment from the week of Nov 2: Study before dinner'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review this week', exact: true }).click();
  await page.getByLabel('What was the biggest obstacle? (optional)').fill('A busy release week');
  await page.getByRole('radio', { name: 'Make the first step smaller' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/focus-weekly-sheet.png' });
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Adjustment: Make the first step smaller')).toBeVisible();
  // Edit it: the same week, one review.
  await page.getByRole('button', { name: 'Edit the review for the week of Nov 9' }).click();
  await page.getByLabel('One adjustment for the week ahead').fill('Open the course at lunch');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Adjustment: Open the course at lunch')).toBeVisible();
  await page.screenshot({ path: 'test-results/focus-weekly-review.png' });
  const after = await saved(page);
  expect(after.weeklyReviews.map((r) => [r.weekStart, r.focusId, r.adjustment])).toEqual([
    ['2026-11-02', 'f1', 'Study before dinner'],
    ['2026-11-09', 'f1', 'Open the course at lunch'],
  ]);
  // Nothing recorded or planned changed.
  expect({ ...after, weeklyReviews: [] }).toEqual({ ...before, weeklyReviews: [] });
});

test('record a baseline checkpoint and a later one; the comparison uses the same conditions only', async ({
  page,
}) => {
  await seed(page, device(), { clock: NINE });
  await page.goto('/review');
  await page.getByRole('button', { name: 'Record a checkpoint', exact: true }).click();
  await page.getByLabel('Where and how').fill('Course site, new problems');
  await page.getByLabel('Attempted').fill('4');
  await page.getByLabel('Solved on your own').fill('1');
  await page.getByLabel('Time limit in minutes (blank = untimed)').fill('60');
  await page.getByLabel('Date (YYYY-MM-DD)').fill('2026-10-12');
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
  await expect(
    page.getByText(/^1 of 4 solved on your own \(Mon, Oct 12\)\. No earlier checkpoint/),
  ).toBeVisible();
  // The next one repeats the conditions: only the result is new.
  await page.getByRole('button', { name: 'Record a checkpoint', exact: true }).click();
  await expect(page.getByLabel('Attempted')).toHaveValue('4');
  await page.getByLabel('Solved on your own').fill('3');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/focus-checkpoint-sheet.png' });
  await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
  await expect(
    page.getByText(
      '1 of 4 on Mon, Oct 12 → 3 of 4 on Mon, Nov 9, same conditions (Medium · 60 min · new problems).',
    ),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/focus-checkpoints.png' });
  const state = await saved(page);
  expect(state.skillCheckpoints.map((c) => [c.date, c.solved, c.attempted, c.minutes])).toEqual([
    ['2026-10-12', 1, 4, 60],
    ['2026-11-09', 3, 4, 60],
  ]);
  // Daily study is untouched: still one ordinary objective, still open.
  expect(
    state.days[TODAY].blocks.filter((b) => b.routineId === 'demo-study').map((b) => b.status),
  ).toEqual(['planned']);
});

test('after a missed study day the focus card says today is a fresh start, and gives no credit', async ({
  page,
}) => {
  const state = device();
  // The demo studies Monday to Saturday: Saturday is the last study day before Monday.
  const yesterday = '2026-11-07';
  const day = state.days[yesterday];
  state.days[yesterday] = {
    ...day,
    blocks: day.blocks.map((b) =>
      b.routineId === 'demo-study'
        ? { ...b, status: 'skipped', actualAt: new Date(2026, 10, 8, 21).toISOString() }
        : b,
    ),
  };
  // Remove yesterday's timed session record so the skip is the whole story.
  state.activitySessions = state.activitySessions.filter((a) => !(a.date === yesterday && a.study));
  const at = new Date(2026, 10, 2, 9).toISOString();
  state.focuses = [
    {
      id: 'f1',
      title: 'Problem-solving speed',
      goalId: null,
      outcome: '',
      evidence: 'career',
      routineIds: ['demo-study'],
      leadRoutineId: null,
      cue: 'If I put it off after dinner, I open the course and start one problem.',
      baseline: '',
      target: '',
      startDate: '2026-11-02',
      reviewDate: '2027-01-31',
      status: 'active',
      endedAt: null,
      createdAt: at,
      updatedAt: at,
    },
  ];
  await seed(page, state, { clock: NINE });
  const before = await saved(page);
  await page.goto('/');
  await openMore(page);
  await expect(
    page.getByText("Saturday didn't happen. Start fresh today; five minutes is a fine start."),
  ).toBeVisible();
  await expect(
    page.getByText('Plan · If I put it off after dinner, I open the course and start one problem.'),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/focus-restart.png' });
  // Reading it changed nothing: yesterday stays skipped and today's study is still open.
  const after = await saved(page);
  expect(after.days[yesterday]).toEqual(before.days[yesterday]);
  expect(
    after.days[TODAY].blocks.filter((b) => b.routineId === 'demo-study').map((b) => b.status),
  ).toEqual(['planned']);
});

test('with larger text (×1.35) the focus card and the Progress sections still fit at 375 points', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, demoState(TODAY), { clock: NINE });
  for (const route of ['/', '/review']) {
    await page.goto(route);
    await page.waitForTimeout(400);
    await scaleText(page, 1.35);
    const issues = [];
    let { max } = await scrollMain(page, 0);
    for (let y = 0, i = 0; i < 25; i++, y += 500) {
      await scrollMain(page, y);
      issues.push(...(await probeLayout(page)));
      if (i === 0)
        await page.screenshot({
          path: `test-results/focus-large-text${route === '/' ? '-today' : '-review'}.png`,
        });
      if (y >= max) break;
      ({ max } = await scrollMain(page, y));
    }
    expect(issues.map((i) => `${route}: ${i.kind} ${i.text} (${i.detail})`)).toEqual([]);
  }
});
