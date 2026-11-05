import { test, expect } from '@playwright/test';
import { withDay } from '../src/domain/data';
import { State, shiftDate } from '../src/domain/model';
import { ensureChecklistDay, setStatus } from '../src/domain/planner';
import { DSA_STUDY, advanceStudy, recordStudy, startStudy } from '../src/domain/study';
import { studyState } from '../src/test-support/fixtures';
import { card, openFold, stepTo } from './support/progress';
import { seed } from './support/storage';

// The browser clock is pinned to Wednesday, November 11, 2026, 9:00.
const TODAY = '2026-11-11';
const NINE = new Date(2026, 10, 11, 9);
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
};
const id = (date: string, routine: string) => `${date}:routine:${routine}`;

function recorded(): State {
  let state = studyState();
  for (let i = -6; i <= 0; i++) {
    const date = shiftDate(TODAY, i);
    state = withDay(
      state,
      ensureChecklistDay(
        date,
        state.settings,
        state.programs,
        state.days[date],
        new Date(at(date, 8)).toISOString(),
      ),
    );
  }
  for (const date of ['2026-11-05', '2026-11-09']) {
    let run = startStudy(
      DSA_STUDY,
      { routineId: 'study', date, blockId: id(date, 'study') },
      at(date, 19),
    );
    let t = at(date, 19);
    for (const stage of DSA_STUDY.stages) run = advanceStudy(run, (t += stage.minutes * 60_000));
    state = recordStudy(state, run, { countAsDone: false }, `s-${date}`, new Date(t).toISOString());
  }
  const mark = (date: string, routine: string, status: 'done' | 'skipped') =>
    (state = withDay(
      state,
      setStatus(state.days[date], id(date, routine), status, new Date(at(date, 20)).toISOString()),
    ));
  mark('2026-11-07', 'study', 'done');
  mark('2026-11-05', 'job-search', 'done');
  mark('2026-11-06', 'job-search', 'done');
  mark('2026-11-10', 'job-search', 'done');
  return state;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('Progress keeps career progress from recorded days, folded: study days and streak apart from the job search', async ({
  page,
}) => {
  await seed(page, recorded(), { clock: NINE, route: '/review' });
  await openFold(page, 'Study calendar and career');
  // The window is four whole weeks from Monday, Oct 19. Tracking started long before it: every
  // unopened day in it is a miss, and Nov 6, 8 and 10 were left open; today (Nov 11) is still open
  // and not counted.
  await expect(
    page.getByLabel('3 completed of 23 eligible study days in the last 4 weeks', { exact: true }),
  ).toBeVisible();
  // The streak broke on Nov 10; today is open, so the line looks forward (shown in both cards).
  await expect(
    page.getByText('New streak starts today · best 1', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Optional timer: 2 full timed sessions · 120 min timed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Thu, Nov 5: completed', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Wed, Nov 11: today, still open', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fri, Nov 6: missed or skipped', exact: true }).click();
  await expect(page.getByText('Fri, Nov 6 · missed or skipped', { exact: true })).toBeVisible();
  await expect(page.getByText('of 4 recorded days done', { exact: false })).toBeVisible();
  await expect(
    page.getByLabel('Job search, last 4 weeks: 3 done, 0 skipped, 1 left open, of 4 recorded.'),
  ).toBeVisible();
  await expect(page.getByText(/^Oldest day first: filled done/)).toBeVisible();
  await page.screenshot({ path: 'test-results/career-progress.png' });
});

test('the week shows effort at a glance, and money says when balances were not updated', async ({
  page,
}) => {
  const review = (id: string, date: string, debt: number, savings: number | null) => ({
    id,
    date,
    at: `${date}T20:00:00.000Z`,
    currency: 'USD',
    cash: null,
    savings,
    debt,
    upcoming: null,
    contributed: null,
    savingsTarget: null,
    nextAction: '',
    note: '',
    goalId: null,
    occurrenceId: null,
  });
  const state = recorded();
  state.moneyReviews = [
    review('a', '2026-10-25', 500000, 200000),
    review('b', '2026-11-01', 480000, null),
  ];
  await seed(page, state, { clock: NINE, route: '/review' });
  await expect(page.getByText('Nov 5 – Nov 11', { exact: true })).toBeAttached();
  // Study: Nov 6, 8 and 10 left open count as missed; today is still open.
  await expect(page.getByLabel('Daily study · days: 3 of 6', { exact: true })).toBeVisible();
  // Job search: Thu, Fri and Tue done; Monday left open; today not counted yet.
  await expect(page.getByLabel('Job search · days: 3 of 4', { exact: true })).toBeVisible();
  // Money: debt first, with its change and a note that the balances are not this week's.
  const money = card(page, 'money');
  await expect(
    money.getByText('Debt down $200.00 since Oct 25 · savings $2,000.00 on Oct 25', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    money.getByText('Not updated this week · last check-in Sun, Nov 1', { exact: true }),
  ).toBeVisible();
  // Savings were not reported in the last check-in: shown as missing, not zero, and the key keeps
  // the last reported figure.
  await expect(money.getByText('$2,000.00', { exact: true })).toBeVisible();
  await stepTo(money, 'Sun, Nov 1');
  await expect(
    money
      .getByTestId('chart-readout')
      .getByText('Debt $4,800.00 · Savings not reported', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/weekly-review.png' });
});

test('every study calendar day is a full-size, selectable target on a 375-point screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, recorded(), { clock: NINE, route: '/review' });
  await openFold(page, 'Study calendar and career');
  // Monday to Sunday, as on Week: four rows from Monday, Oct 19, through today, Wednesday,
  // November 11; the rest of this week is empty, with nothing to tap.
  const days = page.getByTestId(/^study-day:/);
  await expect(days).toHaveCount(24);
  await expect(days.first()).toHaveAttribute('data-testid', 'study-day:2026-10-19');
  await expect(days.last()).toHaveAttribute('data-testid', `study-day:${TODAY}`);
  for (const heading of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
    await expect(page.getByText(heading, { exact: true }).first()).toBeAttached();
  const monday = (await days.first().boundingBox())!;
  const nextMonday = (await page.getByTestId('study-day:2026-10-26').boundingBox())!;
  expect(Math.abs(monday.x - nextMonday.x)).toBeLessThan(1);
  for (let i = 0; i < 24; i++) {
    const box = (await days.nth(i).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(42);
  }
  // Tapping selects (and says so), tapping again clears.
  const day = page.getByRole('button', { name: 'Thu, Nov 5: completed', exact: true });
  await day.click();
  await expect(day).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Thu, Nov 5 · completed', { exact: true })).toBeVisible();
  await day.click();
  await expect(day).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByText(/✓ completed {2}× missed/)).toBeVisible();
});

test('Progress shows each figure once, and one quiet line where nothing is recorded yet', async ({
  page,
}) => {
  const state = recorded();
  state.focuses = [
    {
      id: 'f1',
      title: 'Study every day',
      goalId: null,
      outcome: '',
      evidence: 'career',
      routineIds: ['study'],
      leadRoutineId: 'study',
      cue: '',
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
  await seed(page, state, { clock: NINE, route: '/review' });
  // The focus's study days are in the course correction, so their tile is left out.
  await expect(page.getByText('Weekly course correction', { exact: true })).toBeAttached();
  await expect(page.getByLabel(/^Daily study · days:/)).toHaveCount(0);
  await expect(page.getByLabel('Job search · days: 3 of 4', { exact: true })).toBeVisible();
  // No second presentation of the same figures.
  for (const title of ['Since you started', 'Plan history', 'Workouts · last 4', 'Cardio by week'])
    await expect(page.getByRole('button', { name: new RegExp(`^${title}`) })).toHaveCount(0);

  // A device where tracking starts today: no "0 of 0" tiles and no empty calendar or strip.
  const fresh = studyState();
  fresh.programs = fresh.programs.map((p) => ({
    ...p,
    routines: p.routines.map((r) =>
      r.study ? { ...r, study: { ...r.study, trackFrom: TODAY } } : r,
    ),
  }));
  await seed(page, fresh, { clock: NINE, route: '/review' });
  await openFold(page, 'Study calendar and career');
  // No tiles, so not their dates either.
  await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/)).toHaveCount(0);
  await expect(
    page.getByText('No study day scored yet. The calendar fills in from the first one.'),
  ).toBeVisible();
  await expect(page.getByTestId(/^study-day:/)).toHaveCount(0);
  await expect(
    page.getByText('No recorded day yet. The strip fills in as days are done or skipped.'),
  ).toBeVisible();
});
