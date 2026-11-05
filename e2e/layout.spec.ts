import { test, expect, type Page } from '@playwright/test';
import { basicState } from '../src/test-support/basic-state';
import { denseState } from './support/dense-state';
import { scaleText, scanPage, scrollMain } from './support/layout-probe';
import { seed } from './support/storage';
import { openMore } from './support/today';
import { StatusCode } from '../src/domain/trading-live-model';
import { begun, cockpitState, imReady, openCockpit, planned, tapSetup } from './support/cockpit';
import { STATUS_CASES, at, ny } from './support/statuses';
import { reviewedSessions } from '../src/test-support/trading-live';

// Layout release gate: every primary screen, with a crowded synthetic month, at four phone widths.
// Each screen is checked one screenful at a time while scrolling, as it is read: nothing leaves the
// screen sideways, no text is cut off, no text or control sits on another, every control is a full
// touch target, and the screen's main action is on the first screen. Browser layout only: native
// iPhone layout, Dynamic Type and safe areas still need the device (docs/TESTING.md).

const widths: [number, number][] = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
];

const screens: {
  name: string;
  route: string;
  first: (page: Page) => ReturnType<Page['getByRole']>;
}[] = [
  {
    name: 'Today',
    route: '/',
    first: (page) => page.getByRole('button', { name: 'Mark Daily study done', exact: true }),
  },
  {
    name: 'Week',
    route: '/week',
    first: (page) => page.getByRole('link', { name: /^Mon, Nov 9, today\. .*Open day$/ }),
  },
  {
    name: 'Programs',
    route: '/programs',
    first: (page) => page.getByRole('button', { name: 'Add objective', exact: true }),
  },
  {
    name: 'Progress',
    route: '/review',
    // The hero: Mornings with a morning anchor, otherwise How far you've come.
    first: (page) => page.locator('[data-testid="card-mornings"], [data-testid="journey"]').first(),
  },
  {
    name: 'Trading',
    route: '/trading',
    // The status band and I FEEL RUSHED, always on screen.
    first: (page) => page.getByTestId('i-feel-rushed'),
  },
  {
    name: 'Rules & GEX',
    route: '/bias-board',
    first: (page) => page.getByTestId('trade-status'),
  },
  {
    name: 'Settings',
    route: '/settings',
    first: (page) => page.getByRole('button', { name: 'Backup and restore', exact: true }),
  },
];

const NINE = new Date(2026, 10, 9, 9);

test.use({ timezoneId: 'America/New_York' });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const [width, height] of widths) {
  test(`primary screens fit a ${width}-point phone without overflow, overlap or small targets`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await seed(page, denseState(), { clock: NINE });
    for (const screen of screens) {
      await page.goto(screen.route);
      await expect(screen.first(page)).toBeInViewport();
      // The page itself never scrolls sideways.
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(sideways, `${screen.name} scrolls sideways`).toBeLessThanOrEqual(0);
      const issues = await scanPage(page, height);
      expect(
        issues.map((i) => `${screen.name}: ${i.kind} ${i.text} (${i.detail})`),
        `${screen.name} at ${width} pt`,
      ).toEqual([]);
    }
  });
}

test('the first run and an empty Progress explain what to do, within the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, basicState(), { clock: NINE });
  for (const route of ['/', '/review', '/week', '/programs']) {
    await page.goto(route);
    const issues = await scanPage(page, 568);
    expect(issues.map((i) => `${route}: ${i.kind} ${i.text} (${i.detail})`)).toEqual([]);
  }
});

test('sheets keep Close on screen and their content inside the screen at 320 points', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, denseState(), { clock: NINE });
  const sheets: [string, string][] = [
    ['/programs', 'Add objective'],
    ['/', 'Start Upper body'],
    ['/', 'Add block'],
    ['/trading', 'Review today'],
  ];
  for (const [route, opener] of sheets) {
    await page.goto(route);
    if (opener === 'Add block') await openMore(page);
    await page.getByRole('button', { name: opener, exact: true }).click();
    const close = page.getByRole('button', { name: 'Close', exact: true }).last();
    await expect(close).toBeInViewport();
    const box = (await close.boundingBox())!;
    // Subpixel rounding while the sheet rises can read 43.99998.
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways, `${opener} sheet scrolls sideways`).toBeLessThanOrEqual(0);
    await close.click();
  }
});

// The trading cockpit at each width, in every status the table has, and Preparation: nothing
// overflows, overlaps or is cut, every control is a full target, and the status title, the four
// indicators, the thesis strip and I FEEL RUSHED are wholly on the first screen, again with text
// at ×1.35. The status band's reason and next action and the tiles' labels are never cut at the
// default text size: they carry a stop's end time, the exhausted wording and the planned size.
const COCKPIT: StatusCode[] = [
  'LOAD_FAILED',
  'NO_BIAS',
  'NO_PLAN',
  'NOT_STARTED',
  'REVIEW_FIRST',
  'OUTSIDE_WINDOW',
  'REGIME_RANGE',
  'WAITING_ZONE',
  'WAITING_SETUP',
  'MISSED',
  'SETUP_FORMING',
  'CONFIRMATION_INCOMPLETE',
  'RISK_NEEDED',
  'RISK_BLOCKED',
  'CHECKS_COMPLETE',
  'IN_POSITION',
  'RECONCILE_POSITION',
  'COOLDOWN',
  'RESET_ANSWER',
  'SECOND_ATTEMPT_WAIT',
  'THESIS_EXHAUSTED',
  'THESIS_COMPLETED',
  'THESIS_INVALIDATED',
  'NO_THESIS',
  'LINE_BLOCKED',
  'PLAN_RECONFIRM',
  'UNKNOWN_EXPOSURE',
  'SESSION_STOPPED',
];

/** Text cut with an ellipsis or a line clamp among the band's lines and the tiles' labels. */
async function cutText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids = ['trade-status-reason', 'trade-status-next'];
    const els = [
      ...ids.map((id) => document.querySelector(`[data-testid="${id}"]`)),
      ...Array.from(document.querySelectorAll('[data-testid^="tile-"] > div')),
    ].filter((el): el is HTMLElement => el instanceof HTMLElement);
    return els
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.textContent ?? '');
  });
}

for (const [width, height] of widths) {
  test(`the trading cockpit fits a ${width}-point phone in every status`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    for (const code of COCKPIT) {
      const { state, clock } = STATUS_CASES[code]!();
      await openCockpit(page, { state, clock });
      const live = !!state.tradingSessions['2026-11-09']?.lock || code === 'RECONCILE_POSITION';
      const first = async (size: string) => {
        const ids = ['trade-status-title', 'i-feel-rushed'];
        if (live && code !== 'RECONCILE_POSITION') ids.push('indicators', 'thesis-strip');
        for (const id of ids)
          await expect(page.getByTestId(id), `${code} ${id} at ${size}`).toBeInViewport({
            ratio: 1,
          });
      };
      await first('×1');
      if (width >= 390) expect(await cutText(page), `${code} cut at ${width} pt`).toEqual([]);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(sideways, `${code} scrolls sideways`).toBeLessThanOrEqual(0);
      const issues = await scanPage(page, height);
      expect(
        issues.map((i) => `${code}: ${i.kind} ${i.text} (${i.detail})`),
        `${code} at ${width} pt`,
      ).toEqual([]);
      await scrollMain(page, 0);
      await scaleText(page, 1.35);
      await first('×1.35');
      if (width > 375) continue;
      const large = await scanPage(page, height);
      expect(
        large.map((i) => `${code} ×1.35: ${i.kind} ${i.text} (${i.detail})`),
        `${code} at ${width} pt, text ×1.35`,
      ).toEqual([]);
    }
  });
}

// The live cockpit's moments under pressure, at the smallest phones: the start opens on the four
// tiles, the entry and stop come up where the setup was confirmed, and a major event is named in
// the status band itself.
for (const [width, height] of [
  [320, 568],
  [375, 667],
] as const) {
  test(`the cockpit keeps the next step on screen at ${width} points`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // I'm ready, reached by scrolling, opens the live cockpit at the top.
    await openCockpit(page, { state: planned(cockpitState(), at(9, 35)), clock: ny(9, 40) });
    await imReady(page);
    for (const id of ['trade-status-title', 'indicators', 'thesis-strip'])
      await expect(page.getByTestId(id), `${id} after I'm ready`).toBeInViewport({ ratio: 1 });
    // Setup confirmed, the last setup tap: the entry and stop are right there.
    await tapSetup(page);
    await expect(page.getByTestId('entry-actions')).toBeInViewport({ ratio: 1 });
    // A major event: named in the band, on the first screen.
    const event = begun(
      cockpitState(),
      at(9, 40),
      { event: { name: 'FOMC', time: '14:00' } },
      at(9, 35),
    );
    await openCockpit(page, { state: event, clock: ny(9, 45) });
    await expect(page.getByTestId('trade-status')).toContainText('EVENT · FOMC 2:00 PM');
    await expect(page.getByText('EVENT · FOMC 2:00 PM', { exact: true })).toBeInViewport({
      ratio: 1,
    });
  });
}

// Your limits with the safeguards: the session caps, the clean-session counts and the money
// question with its No lines, at each width and with text ×1.35. A sheet sits over the page, so
// the sheet itself is checked: nothing leaves it sideways or is cut, and its answers are full
// touch targets.
for (const [width, height] of widths) {
  test(`Your limits and the money question fit a ${width}-point phone`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openCockpit(page, { state: reviewedSessions(cockpitState(), 30), clock: ny(9, 0) });
    await page.getByRole('button', { name: 'Edit your limits', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(page.getByRole('button', { name: 'Close', exact: true }).last()).toBeInViewport();
    await page.getByRole('switch', { name: 'Live trading', exact: true }).click();
    await expect(page.getByTestId('money-question')).toBeVisible();
    const check = async (moment: string) => {
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(sideways, `${moment} scrolls sideways`).toBeLessThanOrEqual(0);
      const cut = await sheet.evaluate((root) =>
        Array.from(root.querySelectorAll<HTMLElement>('*'))
          .filter((el) =>
            Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim()),
          )
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 ||
              el.getBoundingClientRect().right > window.innerWidth + 0.5,
          )
          .map((el) => el.textContent ?? ''),
      );
      expect(cut, `${moment} at ${width} pt`).toEqual([]);
    };
    for (const name of ['Yes, set aside', 'No']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.height, `${name} at ${width} pt`).toBeGreaterThanOrEqual(43.5);
    }
    await page.getByTestId('money-question').scrollIntoViewIfNeeded();
    await check('the money question');
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByTestId('money-no')).toBeVisible();
    await check('the No lines');
    await page.getByTestId('live-gates').scrollIntoViewIfNeeded();
    await check('the clean-session counts');
    await scaleText(page, 1.35);
    await check('text ×1.35');
  });
}
