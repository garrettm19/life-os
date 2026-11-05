import { test, expect, type Locator, type Page } from '@playwright/test';
import type { State } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { GRAPH_CLOCK, graphState } from './support/graph-state';
import {
  card,
  chartSlider,
  chooseRange,
  showJourney,
  stepTo,
  touchChart,
} from './support/progress';
import { seed } from './support/storage';

// Progress's chart cards, drawn from synthetic records only. The browser clock is pinned to
// Monday, November 9, 2026, 9:00; each test reads the 12 weeks from Monday, August 24, one tap from
// the 4-week default.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function openProgress(page: Page, state: State) {
  await seed(page, state, { clock: GRAPH_CLOCK, route: '/review' });
  await chooseRange(page, '12 weeks');
}

/** Every drawn mark (marker or column) of each visible chart lies inside that chart's own box. */
async function expectMarksInside(page: Page) {
  const charts = page.getByTestId('chart');
  const count = await charts.count();
  let marks = 0;
  for (let c = 0; c < count; c++) {
    const chart = charts.nth(c);
    if (!(await chart.isVisible())) continue;
    const box = (await chart.boundingBox())!;
    const inside = chart.getByTestId('chart-mark');
    const n = await inside.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const m = (await inside.nth(i).boundingBox())!;
      expect(m.width).toBeGreaterThan(0);
      expect(m.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(m.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(m.x + m.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(m.y + m.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    marks += n;
  }
  expect(marks).toBeGreaterThan(0);
}

const readout = (chart: Locator) => chart.getByTestId('chart-readout');

test('Progress draws money, strength, weight and cardio from records, and reads each point out', async ({
  page,
}) => {
  await openProgress(page, graphState());
  // Money: debt from the first check-in in the range to the latest; savings was never reported.
  const money = card(page, 'money');
  await expect(money.getByText('Debt down $600.00 since Oct 10', { exact: true })).toBeVisible();
  await expect(money.getByText('Savings', { exact: true })).toHaveCount(0);
  // The chart is one element that steps through the three check-ins, oldest to latest.
  const slider = chartSlider(money);
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Debt $5,400.00, Sat, Oct 10');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Debt $5,100.00, Sat, Oct 24');
  await expect(slider).toHaveAttribute('aria-label', /^Debt down \$600\.00 since Oct 10\. /);
  await stepTo(money, 'Sat, Nov 7');
  await expect(readout(money)).toContainText('Debt $4,800.00Sat, Nov 7');
  await expectMarksInside(page);
  // Strength: one point per finished workout, its heaviest working set.
  const strength = card(page, 'strength');
  await expect(
    strength.getByText('Bench press up 10 lb in the last 12 weeks', { exact: true }),
  ).toBeVisible();
  await stepTo(strength, 'Wed, Oct 28');
  await expect(readout(strength)).toContainText('155 lb × 5Wed, Oct 28');
  await expect(
    readout(strength).getByText('All working sets: 150 × 6, 155 × 4, 155 × 5 lb'),
  ).toBeVisible();
  // What the chart counts is folded under About this chart.
  await expect(strength.getByTestId('chart-note')).toHaveCount(0);
  await strength.getByRole('button', { name: 'About this chart: Strength' }).click();
  await expect(
    strength.getByText('Heaviest working set of each finished workout, in lb.'),
  ).toBeVisible();
  // Body weight: measured days only; the seven-day average is a number in the readout, never a
  // second line.
  const weight = card(page, 'weight');
  await expect(weight.getByText('Down 1.4 lb since Oct 30', { exact: true })).toBeVisible();
  await expect(weight.getByTestId('chart-line')).toHaveCount(5);
  await stepTo(weight, 'Wed, Nov 4');
  await expect(readout(weight)).toContainText('179.8 lbWed, Nov 4');
  await expect(readout(weight).getByText(/^Seven-day average 180\.\d lb$/)).toBeVisible();
  // Cardio: a column per week with a session; a week without one is a gap, never 0 min.
  const cardio = card(page, 'cardio');
  await expect(
    cardio.getByText('65 cardio minutes recorded in the last 12 weeks', { exact: true }),
  ).toBeVisible();
  await expect(cardio.getByTestId('chart-mark')).toHaveCount(2);
  await touchChart(page, cardio, 0.99);
  await expect(readout(cardio)).toContainText('No cardioThis week so far');
  await stepTo(cardio, 'Week of Nov 2');
  await expect(readout(cardio)).toContainText('25 minWeek of Nov 2');
  await expect(readout(cardio).getByText('1 session', { exact: true })).toBeVisible();
  await expectMarksInside(page);
  await page.screenshot({ path: 'test-results/graphs-progress.png' });
});

test('one record is a figure without a chart, and says what starts the line', async ({ page }) => {
  const full = graphState();
  const state = trainingState();
  state.moneyReviews = full.moneyReviews.slice(-1);
  state.measurements = full.measurements.slice(-1);
  state.workoutSessions = full.workoutSessions.slice(-1);
  state.activitySessions = full.activitySessions.slice(-1);
  await openProgress(page, state);
  const sparse: [string, string, string][] = [
    ['money', 'Debt $4,800.00 on Nov 7', 'The next money check-in starts the lines.'],
    ['weight', '179.8 lb on Nov 4', 'The next weigh-in starts the line.'],
    ['strength', 'Bench press 155 lb on Oct 28', 'The next session starts the line.'],
    [
      'cardio',
      '25 cardio minutes recorded in the last 12 weeks',
      'The next week with cardio starts the chart.',
    ],
  ];
  for (const [id, headline, note] of sparse) {
    await expect(card(page, id).getByText(headline, { exact: true })).toBeVisible();
    await expect(card(page, id).getByText(note, { exact: true })).toBeVisible();
    await expect(card(page, id).getByRole('button', { name: /^Show as list/ })).toHaveCount(0);
  }
  await expect(page.getByTestId('chart')).toHaveCount(0);
});

test('the change since the start is in How far you have come, open above the range', async ({
  page,
}) => {
  await openProgress(page, graphState());
  const journey = await showJourney(page);
  // First without a morning anchor, above the range and the charts, never folded.
  const [start, range, consistency] = await Promise.all(
    [journey, page.getByRole('radiogroup', { name: 'Time range' }), card(page, 'consistency')].map(
      async (el) => (await el.boundingBox())!,
    ),
  );
  expect(range.y).toBeGreaterThan(start.y + start.height - 1);
  expect(consistency.y).toBeGreaterThan(range.y);
  await expect(page.getByRole('button', { name: /^How far you've come/ })).toHaveCount(0);
  await expect(journey.getByText('$600', { exact: true })).toBeVisible();
  // The lift that grew most as a scoreboard row: first load, heaviest and the gain.
  const lift = journey.getByTestId('journey-lift');
  await expect(lift).toHaveAttribute(
    'aria-label',
    'Bench press, the lift that grew most: 145 to 155 lb, up 10 lb.',
  );
  await expect(lift.getByText('+10 lb', { exact: true })).toBeVisible();
  await expect(journey).toContainText('181.2 lb on');
});

/** The numeric y-axis labels of one chart ($5.4k reads 5.4). */
async function axisValues(chart: Locator) {
  return (await chart.getByText(/^\$?[\d,.]+k?$/).allTextContents()).map((t) =>
    Number(t.replace(/[$,k]/g, '')),
  );
}

test('a labeled line sits above the highest value and below the lowest', async ({ page }) => {
  await openProgress(page, graphState());
  await expect(card(page, 'weight').getByTestId('chart-mark').first()).toBeVisible();
  await expect(card(page, 'money').getByTestId('chart-mark').first()).toBeVisible();
  // Debt from $4,800 to $5,400.
  let values = await axisValues(card(page, 'money').getByTestId('chart'));
  expect(Math.max(...values)).toBeGreaterThanOrEqual(5.4);
  expect(Math.min(...values)).toBeLessThanOrEqual(4.8);
  // Weigh-ins from 179.8 to 181.2 lb.
  values = await axisValues(card(page, 'weight').getByTestId('chart'));
  expect(Math.max(...values)).toBeGreaterThanOrEqual(181.2);
  expect(Math.min(...values)).toBeLessThanOrEqual(179.8);
});

test('a cardio target is a labeled line, and only weeks that hit it are Fern', async ({ page }) => {
  const state = graphState();
  state.programs = [
    ...state.programs,
    {
      id: 'cardio-program',
      title: 'Cardio',
      group: 'Training',
      goalIds: [],
      routines: [
        {
          id: 'cardio',
          title: 'Cardio',
          duration: 30,
          weekdays: [1, 3, 5],
          preferredStart: null,
          enabled: true,
          fixed: false,
          steps: [],
          bundledInto: null,
          checklist: true,
          capture: 'activity',
          activities: ['Bike', 'Walk'],
        },
      ],
    },
  ];
  state.activitySessions = [
    ...state.activitySessions,
    { ...state.activitySessions[0], id: 'c3', date: '2026-10-21', minutes: 95 },
  ];
  await openProgress(page, state);
  const cardio = card(page, 'cardio');
  await expect(
    cardio.getByText('1 of the last 3 weeks hit 90 cardio minutes', { exact: true }),
  ).toBeVisible();
  await expect(cardio.getByTestId('chart-target')).toHaveText('90');
  await expect(cardio.getByTestId('chart-target-line')).toBeVisible();
  await expect(cardio.getByText('90 min', { exact: true })).toBeVisible();
  // The week that hit the target is Fern (done); the others are the chart color (dark tokens).
  const colors = await cardio
    .getByTestId('chart-mark')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(colors).toEqual(['rgb(95, 211, 166)', 'rgb(111, 166, 222)', 'rgb(111, 166, 222)']);
  await stepTo(cardio, 'Week of Nov 2');
  await expect(readout(cardio).getByText('Target 90 min', { exact: true })).toBeVisible();
  await expectMarksInside(page);
});

test('cards say what will fill them instead of drawing anything', async ({ page }) => {
  await openProgress(page, trainingState());
  const empty: [string, string, string][] = [
    ['money', 'No money check-in in the last 12 weeks', 'Add a money check-in to start the lines.'],
    ['weight', 'No weigh-ins in the last 12 weeks', 'Record a weigh-in to start the line.'],
    [
      'strength',
      'No finished workouts with logged sets in the last 12 weeks',
      'Finish a workout with logged sets to start the line.',
    ],
  ];
  for (const [id, headline, note] of empty) {
    await expect(card(page, id).getByText(headline, { exact: true })).toBeVisible();
    await expect(card(page, id).getByText(note, { exact: true })).toBeVisible();
  }
  // Without an activity routine or a session there is no cardio card at all.
  await expect(card(page, 'cardio')).toHaveCount(0);
  await expect(page.getByTestId('chart')).toHaveCount(0);
  // A weigh-in routine with nothing recorded yet adds no empty Weigh-ins fold.
  await expect(page.getByRole('button', { name: /^Weigh-ins/ })).toHaveCount(0);
});
