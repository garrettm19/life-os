import { test, expect, type Page } from '@playwright/test';
import { withDay } from '../src/domain/data';
import { demoState } from '../src/domain/demo';
import { State, emptyState, shiftDate } from '../src/domain/model';
import { dayProgress } from '../src/domain/objectives';
import { ensureChecklistDay, setStatus } from '../src/domain/planner';
import { DEFAULT_PROGRESS_RANGE, ProgressData, progress } from '../src/domain/progress';
import { saveTradingReview } from '../src/domain/trading';
import { studyState } from '../src/test-support/fixtures';
import { GRAPH_CLOCK, GRAPH_TODAY, graphState } from './support/graph-state';
import { scanPage } from './support/layout-probe';
import { HISTORY_CLOCK, HISTORY_TODAY, progressHistory } from './support/progress-history';
import {
  card,
  chartSlider,
  chooseRange,
  showJourney,
  stepTo,
  touchChart,
} from './support/progress';
import { seed } from './support/storage';
import { TRADING_ROUTINE, withTradingBook } from './support/trading-state';

// The Progress tab as a whole: the range control, the KPI row, each card's empty and sparse
// states, the touch readout and Show as list, and Week's day cards. Synthetic data only; the
// browser clock is pinned to Monday, November 9, 2026, 9:00 unless a test says otherwise.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const open = (page: Page, state: State, route = '/review') =>
  seed(page, state, { clock: GRAPH_CLOCK, route });

test('one range control rescopes every tile and chart, and says what it compares with', async ({
  page,
}) => {
  await open(page, graphState());
  const range = page.getByRole('radiogroup', { name: 'Time range' });
  // Four weeks to start, from Monday, October 19: this month against the one before it. One bench
  // session is in it, a figure with no chart.
  await expect(range.getByRole('radio', { name: '4 weeks' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('range-text')).toHaveText(
    'Oct 19 to Nov 9 · vs the previous 4 weeks',
  );
  const strength = card(page, 'strength');
  await expect(strength.getByText('Bench press 155 lb on Oct 28', { exact: true })).toBeVisible();
  await expect(strength.getByTestId('chart')).toHaveCount(0);
  await expect(
    card(page, 'money').getByText('Debt down $300.00 since Oct 24', { exact: true }),
  ).toBeVisible();
  // The columns start at the first week with a session, Monday, October 26, as a line starts at
  // its first point, never at an empty Monday of the range.
  await chartSlider(card(page, 'cardio')).focus();
  await chartSlider(card(page, 'cardio')).press('Home');
  await expect(card(page, 'cardio').getByTestId('chart-readout')).toContainText('Week of Oct 26');
  // Twelve weeks are one tap away.
  await chooseRange(page, '12 weeks');
  await expect(page.getByTestId('range-text')).toHaveText(
    'Aug 24 to Nov 9 · vs the previous 12 weeks',
  );
  await expect(strength.getByText('Bench press up 10 lb in the last 12 weeks')).toBeVisible();
  // A year names both years; a short history still starts its columns at its first week, so the
  // cards under one range share their first dates instead of crowding into the last weeks.
  await range.getByRole('radio', { name: '1 year' }).click();
  await expect(page.getByTestId('range-text')).toHaveText(
    'Nov 17, 2025 to Nov 9, 2026 · vs the previous year',
  );
  await chartSlider(card(page, 'cardio')).focus();
  await chartSlider(card(page, 'cardio')).press('Home');
  await expect(card(page, 'cardio').getByTestId('chart-readout')).toContainText('Week of Oct 26');
  await expect(strength.getByText('Bench press up 10 lb in the last year')).toBeVisible();
  // Series colors never change with the range.
  const color = await card(page, 'weight')
    .getByTestId('chart-line')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // The dark chart token (the suite runs in dark).
  expect(color).toBe('rgb(111, 166, 222)');
});

/**
 * The study plan's tracking starting on `since`: before it nothing is scored, so a new plan has no
 * missed study days behind it.
 */
function tracking(since: string): State {
  const state = studyState();
  state.programs = state.programs.map((p) => ({
    ...p,
    routines: p.routines.map((r) =>
      r.study ? { ...r, study: { ...r.study, trackFrom: since } } : r,
    ),
  }));
  return state;
}

/** Every tile and card the screen shows, with the domain's own words for this state. */
async function expectCards(page: Page, data: ProgressData) {
  for (const tile of data.tiles) {
    const el = page.getByTestId(`tile-${tile.id}`);
    await expect(el).toContainText(tile.label);
    if (tile.value) {
      await expect(el).toContainText(tile.value);
      await expect(el).toContainText(tile.change!);
      // A sparkline needs two points: one is not a trend.
      await expect(el.getByTestId('sparkline')).toHaveCount(tile.spark.length > 1 ? 1 : 0);
    } else await expect(el).toContainText(tile.empty!);
  }
  const ids = {
    consistency: data.consistency,
    study: data.study,
    jobs: data.jobs,
    trading: data.trading,
    habits: data.habits,
  };
  for (const [id, text] of Object.entries(ids)) {
    expect(text, id).not.toBeNull();
    const el = card(page, id);
    await expect(el.getByText(text!.headline, { exact: true })).toBeVisible();
    if (text!.note) await expect(el.getByText(text!.note, { exact: true })).toBeVisible();
    // The habits card is a list of bars, never a plot; every other card draws one only with two
    // points or more.
    const drawn = id === 'habits' ? el.getByTestId('habit-bar') : el.getByTestId('chart');
    if (text!.state === 'chart') await expect(drawn.first()).toBeVisible();
    else await expect(drawn).toHaveCount(0);
  }
}

test('a new plan: each tile and card says in one line what will fill it', async ({ page }) => {
  const state = withTradingBook(tracking(GRAPH_TODAY), GRAPH_TODAY);
  const data = progress(state, DEFAULT_PROGRESS_RANGE, GRAPH_TODAY);
  for (const c of [data.consistency, data.study, data.jobs, data.trading, data.habits])
    expect(c!.state).toBe('empty');
  await open(page, state);
  await expectCards(page, data);
  await expect(page.getByTestId('chart')).toHaveCount(0);
  await expect(page.getByTestId('tile-streak')).toContainText(
    'Clear a day on Today to start the streak.',
  );
  // No trading day has passed yet, so none is left without a review.
  expect(data.trading!.missed).toBe(0);
  await expect(page.getByTestId('trading-missed')).toHaveCount(0);
});

function oneWeek(): State {
  let state = withTradingBook(tracking('2026-11-02'), '2026-11-02');
  // Monday, November 2, to Saturday, November 7: study kept on four days, the job search done
  // on three, everything else left open.
  for (let i = 0; i < 6; i++) {
    const date = shiftDate('2026-11-02', i);
    const at = new Date(2026, 10, 2 + i, 20).toISOString();
    let day = ensureChecklistDay(date, state.settings, state.programs, state.days[date], at);
    if (i < 4) day = setStatus(day, `${date}:routine:study`, 'done', at);
    if (i % 2 === 0) day = setStatus(day, `${date}:routine:job-search`, 'done', at);
    state = withDay(state, day);
  }
  return saveTradingReview(
    state,
    {
      date: '2026-11-06',
      routineId: TRADING_ROUTINE,
      session: 'traded',
      answers: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`process-${i + 1}`, i === 3 ? 'no' : 'yes']),
      ) as Record<string, 'yes' | 'no'>,
      violations: [],
      entries: 1,
      failedTheses: 0,
      note: '',
    },
    'friday',
    new Date(2026, 10, 6, 17).toISOString(),
  );
}

test('one week of records: each card shows its figure and what starts the line', async ({
  page,
}) => {
  const state = oneWeek();
  const data = progress(state, DEFAULT_PROGRESS_RANGE, GRAPH_TODAY);
  for (const c of [data.consistency, data.study, data.jobs, data.trading])
    expect(c!.state).toBe('sparse');
  expect(data.habits!.state).toBe('chart');
  await open(page, state);
  await expectCards(page, data);
  // The habit bars read with a single week: steadiest first, each in words.
  const bars = card(page, 'habits').getByTestId('habit-bar');
  expect(await bars.count()).toBe(data.habits!.rows.length);
  await expect(bars.first()).toHaveAttribute(
    'aria-label',
    new RegExp(`^${data.habits!.rows[0].title}`),
  );
  // Rule-clean sessions lead the trading tile; the latest score follows, smaller.
  const tradingTile = page.getByTestId('tile-trading');
  await expect(tradingTile).toContainText('Rule-clean sessions');
  await expect(tradingTile).toContainText('0 of 1');
  await expect(tradingTile).toContainText('0 hard violations recorded · last score 7/8');
  // One review draws no line, yet the trading days left without one are still said.
  expect(data.trading!.missed).toBeGreaterThan(0);
  await expect(card(page, 'trading').getByTestId('trading-missed')).toHaveText(
    `${data.trading!.missed} trading day${data.trading!.missed === 1 ? '' : 's'} left without a review, never clean.`,
  );
  // No week has finished: the Study card never repeats the tile's figure.
  const studyTile = data.tiles.find((t) => t.id === 'study')!;
  await expect(page.getByTestId('tile-study')).toContainText(studyTile.value!);
  await expect(card(page, 'study')).not.toContainText(studyTile.value!);
  await page.screenshot({ path: 'test-results/progress-one-week.png' });
});

test('the touch readout follows the finger over the plot, stays after release and clears on a tap elsewhere', async ({
  page,
}) => {
  await open(page, graphState());
  // How to read a chart is said once, above the first chart, never on every card.
  await expect(page.getByTestId('chart-hint')).toHaveText(
    'Touch and drag along a chart to read each point or week.',
  );
  await expect(page.getByText(/^Touch and drag/)).toHaveCount(1);
  const weight = card(page, 'weight');
  const readout = weight.getByTestId('chart-readout');
  // Boxes measured from the card's corner, so a touch that scrolls the page changes nothing.
  const inCard = async (target: ReturnType<Page['getByTestId']>) => {
    const [box, frame] = [(await target.boundingBox())!, (await weight.boundingBox())!];
    return { ...box, x: box.x - frame.x, y: box.y - frame.y };
  };
  // Untouched, the plot sits right under the headline: no empty band is kept for a readout.
  await expect(readout).toHaveCount(0);
  const headline = await inCard(weight.getByRole('heading').first());
  const plot = await inCard(weight.getByTestId('chart'));
  expect(plot.y - (headline.y + headline.height)).toBeLessThanOrEqual(13);
  // Press near the start and drag to the end: the crosshair snaps to each weigh-in in turn.
  await touchChart(page, weight, 0.02);
  await expect(readout).toContainText('181.2 lbFri, Oct 30');
  await expect(weight.getByTestId('chart-crosshair')).toBeVisible();
  // The reading is over the plot, in the half away from the finger.
  let box = await inCard(readout);
  expect(box.y).toBeGreaterThanOrEqual(plot.y - 0.5);
  expect(box.x).toBeGreaterThanOrEqual(plot.x + plot.width / 2);
  await touchChart(page, weight, 0.02, 0.98);
  // Released: the last position stays read out, now in the left half.
  await expect(readout).toContainText('179.8 lbWed, Nov 4');
  box = await inCard(readout);
  expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width / 2);
  // The plot never moved.
  expect((await inCard(weight.getByTestId('chart'))).y).toBe(plot.y);
  // VoiceOver's element reads the same point, with what the readout adds.
  await expect(chartSlider(weight)).toHaveAttribute(
    'aria-valuetext',
    /^179\.8 lb, Wed, Nov 4\. Seven-day average 180\.\d lb$/,
  );
  // A tap elsewhere on the card clears it.
  await weight.getByText('Down 1.4 lb since Oct 30', { exact: true }).click();
  await expect(readout).toHaveCount(0);
  await expect(weight.getByTestId('chart-crosshair')).toHaveCount(0);
  // The whole plot height takes the touch: the top edge of the plot reads a point too.
  const scrub = (await weight.getByTestId('chart-scrub').boundingBox())!;
  await page.mouse.click(scrub.x + scrub.width / 2, scrub.y + 2);
  await expect(readout).toBeVisible();
  // Columns snap to the nearest week, a week with nothing recorded included.
  const cardio = card(page, 'cardio');
  await touchChart(page, cardio, 0.99);
  await expect(cardio.getByTestId('chart-readout')).toContainText('No cardioThis week so far');
});

test('stepping a chart with VoiceOver reads what the readout shows', async ({ page }) => {
  await seed(page, progressHistory(HISTORY_TODAY, 2), { clock: HISTORY_CLOCK, route: '/review' });
  await chooseRange(page, '12 weeks');
  // Trading: clean or broken is what the markers' colors say, so each step says it too.
  const trading = card(page, 'trading');
  await stepTo(trading, 'session');
  const value = (await chartSlider(trading).getAttribute('aria-valuetext'))!;
  expect(value).toMatch(/\. Rule-(clean|broken) session$/);
  await expect(trading.getByTestId('chart-readout')).toContainText(
    value.match(/Rule-(clean|broken) session/)![0],
  );
  // Cardio: the week's sessions and its target, as the readout gives them.
  const cardio = card(page, 'cardio');
  await stepTo(cardio, 'This week so far');
  await expect(chartSlider(cardio)).toHaveAttribute('aria-valuetext', /\. Target \d+ min/);
  // Study: kept of scored days.
  await stepTo(card(page, 'study'), 'scored day');
  await expect(chartSlider(card(page, 'study'))).toHaveAttribute(
    'aria-valuetext',
    /\d+ of \d+ scored days? kept/,
  );
});

test('Show as list gives the same points in words, newest first, and back to the chart', async ({
  page,
}) => {
  await open(page, graphState());
  await chooseRange(page, '12 weeks');
  const weight = card(page, 'weight');
  await weight.getByRole('button', { name: 'Show as list: Body weight' }).click();
  const list = weight.getByTestId('chart-list');
  await expect(weight.getByTestId('chart')).toHaveCount(0);
  const rows = list.locator('[aria-label]');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toHaveAttribute(
    'aria-label',
    /^179\.8 lb, Wed, Nov 4\. Seven-day average 180\.\d lb$/,
  );
  await expect(rows.last()).toHaveAttribute('aria-label', '181.2 lb, Fri, Oct 30');
  // Columns list only the weeks with a record.
  const cardio = card(page, 'cardio');
  await cardio.getByRole('button', { name: 'Show as list: Cardio' }).click();
  await expect(cardio.getByTestId('chart-list').locator('[aria-label]')).toHaveCount(2);
  await expect(cardio.getByTestId('chart-list')).toContainText('Week of Nov 225 min');
  await weight.getByRole('button', { name: 'Show as chart: Body weight' }).click();
  await expect(weight.getByTestId('chart')).toBeVisible();
  await expect(weight.getByTestId('chart-list')).toHaveCount(0);
  // Each chart has a summary for VoiceOver: its headline and the range.
  await expect(
    card(page, 'money').getByLabel(
      'Debt down $600.00 since Oct 10. Last 12 weeks, Aug 24 to Nov 9.',
      { exact: true },
    ),
  ).toBeAttached();
  // The chart steps point by point with the keyboard, as VoiceOver's swipes do.
  await stepTo(card(page, 'money'), 'Sat, Oct 24');
  await expect(card(page, 'money').getByTestId('chart-readout')).toContainText('Debt $5,100.00');
});

test('This week keeps the course correction, the ways to record and the folded history', async ({
  page,
}) => {
  await open(page, graphState());
  // How far you've come is open above it, never one of its folds.
  await showJourney(page);
  await expect(page.getByTestId('this-week').getByTestId('journey')).toHaveCount(0);
  const week = page.getByTestId('this-week');
  // Titled for the days it reads: Week's "This week" is Monday to Sunday.
  await expect(week.getByRole('heading', { name: 'Last 7 days', exact: true })).toBeAttached();
  await week.getByRole('button', { name: 'Add weigh-in', exact: true }).click();
  await expect(page.getByLabel('Weight in lb', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await week.getByRole('button', { name: 'Add money check-in', exact: true }).click();
  await expect(page.getByLabel('Total debt ($)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  for (const fold of ['Weigh-ins', 'Money check-ins'])
    await expect(week.getByRole('button', { name: new RegExp(`^${fold}`) })).toBeVisible();
});

test('Week says how to use it, and each day card counts as Today does', async ({ page }) => {
  // Wednesday, November 11: Monday cleared, Tuesday partly done, later days planned.
  let state = studyState();
  for (const [date, done] of [
    ['2026-11-09', 2],
    ['2026-11-10', 1],
  ] as const) {
    const at = new Date(`${date}T20:00:00`).toISOString();
    let day = ensureChecklistDay(date, state.settings, state.programs, undefined, at);
    const ids = day.blocks.filter((b) => b.checklist && !b.optional).map((b) => b.id);
    for (const id of ids.slice(0, done === 2 ? ids.length : 1))
      day = setStatus(day, id, 'done', at);
    state = withDay(state, day);
  }
  // Before anything is cleared, VoiceOver reads the glance's title as it is seen, never a zero.
  await seed(page, studyState(), { clock: new Date(2026, 10, 11, 9), route: '/week' });
  await expect(page.getByTestId('week-glance')).toContainText('Your week at a glance');
  await expect(page.getByTestId('week-glance')).toHaveAttribute(
    'aria-label',
    /^Your week at a glance\. Mon /,
  );
  await seed(page, state, { clock: new Date(2026, 10, 11, 9), route: '/week' });
  await expect(page.getByTestId('week-glance')).toHaveAttribute(
    'aria-label',
    /^This week: 1 day cleared so far\. Mon /,
  );
  // The title already says This week; the line says only what to do with the cards.
  await expect(page.getByTestId('week-hint')).toHaveText('Tap a day to open it');
  // The count is the one Day Cleared count, the same Today shows.
  const count = (date: string) => dayProgress(state.days[date], state.programs, date);
  const monday = page.getByRole('link', { name: /^Mon, Nov 9\./ });
  const mon = count('2026-11-09');
  expect(mon.cleared).toBe(true);
  await expect(monday).toContainText(`${mon.done} of ${mon.total}✓ Cleared`);
  await expect(monday.getByTestId('day-bar')).toBeVisible();
  await expect(monday).toHaveAttribute(
    'aria-label',
    new RegExp(`^Mon, Nov 9\\. Cleared, ${mon.done} of ${mon.total} done\\.`),
  );
  const tue = count('2026-11-10');
  const tuesday = page.getByRole('link', { name: /^Tue, Nov 10\./ });
  await expect(tuesday).toHaveAttribute(
    'aria-label',
    new RegExp(`^Tue, Nov 10\\. 1 of ${tue.total} done\\.`),
  );
  await expect(tuesday).not.toContainText('Cleared');
  // A later day says what is planned, without a bar.
  const friday = page.getByRole('link', { name: /^Fri, Nov 13\./ });
  await expect(friday).toContainText(/Planned · \d+/);
  await expect(friday.getByTestId('day-bar')).toHaveCount(0);
  // Without a program there are no day cards, so there is nothing to tap and no line saying so.
  await seed(page, emptyState(), { clock: new Date(2026, 10, 11, 9), route: '/week' });
  await expect(
    page.getByText('Import your setup or add a program to plan the week.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('week-hint')).toHaveCount(0);
});

test('the cardio key lists only the colors its columns use', async ({ page }) => {
  const NOV9 = '2026-11-09';
  const state = demoState(NOV9);
  const weeks = progress(state, DEFAULT_PROGRESS_RANGE, NOV9).cardio!.weeks.filter(
    (w) => w.value !== null,
  );
  const hit = weeks.some((w) => w.hit === true);
  const below = weeks.some((w) => w.hit !== true);
  // The demo hits its target every week it records cardio.
  expect([hit, below]).toEqual([true, false]);
  await seed(page, state, { clock: GRAPH_CLOCK, route: '/review' });
  const cardio = card(page, 'cardio');
  await expect(cardio.getByText('Hit the target', { exact: true })).toBeVisible();
  await expect(cardio.getByText(/^Below (it|the target)$/)).toHaveCount(0);
  await expect(cardio.getByText('Weekly target', { exact: false })).toBeVisible();
});

/** The top of a card's plot on the page. */
const plotTop = async (chart: ReturnType<typeof card>) =>
  (await chart.getByTestId('chart').first().boundingBox())!.y;

for (const width of [320, 390] as const)
  test(`no plot moves while a finger reads it, at ${width} points`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    // Two years of history, so every card has a chart at 12 weeks and at a year.
    await seed(page, progressHistory(HISTORY_TODAY, 15), {
      clock: HISTORY_CLOCK,
      route: '/review',
    });
    const range = page.getByRole('radiogroup', { name: 'Time range' });
    for (const label of ['12 weeks', '1 year']) {
      await range.getByRole('radio', { name: label }).click();
      for (const id of [
        'consistency',
        'weight',
        'strength',
        'study',
        'cardio',
        'jobs',
        'money',
        'trading',
      ]) {
        const chart = card(page, id);
        if (id === 'jobs' && !(await chart.getByTestId('chart-scrub').count())) continue;
        const scrub = chart.getByTestId('chart-scrub');
        await scrub.scrollIntoViewIfNeeded();
        // Clear a reading left from the other range first.
        await chart.getByRole('heading').first().click();
        const before = await plotTop(chart);
        const box = (await scrub.boundingBox())!;
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + 2, y);
        await page.mouse.down();
        // Across the whole plot, every entry the finger passes is read out above an unmoved plot.
        for (let i = 0; i <= 12; i++) {
          await page.mouse.move(box.x + 2 + ((box.width - 4) * i) / 12, y);
          expect(
            Math.abs((await plotTop(chart)) - before),
            `${id} at ${label}, step ${i}`,
          ).toBeLessThanOrEqual(0.5);
        }
        await page.mouse.up();
        await expect(chart.getByTestId('chart-readout')).toBeVisible();
      }
    }
  });

test('a year range names the year of its first dates on the axis and in the headlines', async ({
  page,
}) => {
  const state = progressHistory(HISTORY_TODAY, 15);
  const year = progress(state, '1y', HISTORY_TODAY);
  await seed(page, state, { clock: HISTORY_CLOCK, route: '/review' });
  await page
    .getByRole('radiogroup', { name: 'Time range' })
    .getByRole('radio', { name: '1 year' })
    .click();
  // "since Oct 20" would read as three days from now.
  expect(year.weight!.headline).toMatch(/since [A-Z][a-z]{2} \d+, 2025$/);
  await expect(
    card(page, 'weight').getByText(year.weight!.headline, { exact: true }),
  ).toBeVisible();
  for (const id of ['weight', 'consistency', 'cardio'])
    await expect(card(page, id).getByTestId('chart-axis-date').first()).toHaveText(/, 2025$/);
  // The latest date on each axis is this year's, without the year.
  await expect(card(page, 'cardio').getByTestId('chart-axis-date').last()).toHaveText(
    /^[A-Z][a-z]{2} \d+$/,
  );
});

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
] as const) {
  test(`three months of history fit Progress on a ${width}-point phone`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await seed(page, progressHistory(), { clock: HISTORY_CLOCK, route: '/review' });
    await expect(card(page, 'habits')).toBeAttached();
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    const issues = await scanPage(page, height);
    expect(issues.map((i) => `${i.kind} ${i.text} (${i.detail})`)).toEqual([]);
  });
}

test.describe('left open past midnight', () => {
  // Saturday, October 24, 2026 at 11:58 PM: the next minutes cross into Sunday the 25th.
  const LATE = new Date(2026, 9, 24, 23, 58);
  const pastMidnight = async (page: Page) => {
    await page.clock.runFor(10 * 60_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.clock.runFor(60_000);
  };

  test('Week moves to the new day without a reload', async ({ page }) => {
    await seed(page, demoState('2026-10-24'), { clock: LATE, route: '/week' });
    await expect(page.getByRole('link', { name: /^Sat, Oct 24, today\./ })).toBeVisible();
    await pastMidnight(page);
    await expect(page.getByRole('link', { name: /^Sun, Oct 25, today\./ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Sat, Oct 24, today\./ })).toHaveCount(0);
  });

  test('Progress moves its range to end on the new day', async ({ page }) => {
    await seed(page, demoState('2026-10-24'), { clock: LATE, route: '/review' });
    await expect(page.getByTestId('range-text')).toHaveText(/ to Oct 24 · vs the previous/);
    await pastMidnight(page);
    await expect(page.getByTestId('range-text')).toHaveText(/ to Oct 25 · vs the previous/);
  });
});
