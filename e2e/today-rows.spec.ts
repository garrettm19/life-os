import { test, expect, type Page } from '@playwright/test';
import type { Routine, State } from '../src/domain/model';
import { withDay } from '../src/domain/data';
import { setStatus } from '../src/domain/planner';
import { ensureDay, restDay } from '../src/domain/rotation';
import { denseState } from './support/dense-state';
import { scaleText } from './support/layout-probe';
import { seed } from './support/storage';
import { tradingState } from './support/trading-state';

// Today's rows never overlap: every kind of row, at four phone widths and at doubled text, with
// what each chevron folds closed and open. Synthetic data only; the browser clock is pinned to
// Monday, November 9, 2026 at 9:00. Browser layout only: Dynamic Type on the iPhone still needs
// the device (docs/TESTING.md).

const MON = '2026-11-09';
const NINE = new Date(2026, 10, 9, 9);
const LONG_LINK = 'Practice problems for the week (example site)';

const routine = (id: string, title: string, extra: Partial<Routine> = {}): Routine => ({
  id,
  title,
  duration: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  preferredStart: null,
  enabled: true,
  fixed: false,
  steps: [],
  bundledInto: null,
  checklist: true,
  ...extra,
});

/**
 * A day with one row of every kind: a workout, study, a step list (with a step long enough to
 * wrap), bundled steps, trading, a companion, an optional weigh-in, one skipped and one done, and a
 * skipped rotation workout moved to the next training day.
 */
function everyRow(): State {
  let state = tradingState();
  state.programs = [
    ...state.programs.map((p) =>
      p.id === 'training'
        ? {
            // A rotation starting with Upper body, which the companion follows.
            ...p,
            rotation: { order: ['upper', 'lower'], restDays: [], startWith: 'upper' },
            routines: [
              ...p.routines.map((r) => ({ ...r, weekdays: [] })),
              routine('neck', 'Home neck routine', { weekdays: [], follows: ['upper'] }),
            ],
          }
        : p.id === 'career'
          ? {
              // One study resource with a long label: its "Open … ↗" link must wrap at 200% text.
              ...p,
              routines: p.routines.map((r) =>
                r.study
                  ? {
                      ...r,
                      links: [{ label: LONG_LINK, url: 'https://example.com/practice' }],
                      study: {
                        ...r.study,
                        stages: r.study.stages.map((s) => ({ ...s, links: [] })),
                      },
                    }
                  : r,
              ),
            }
          : p,
    ),
    {
      id: 'daily',
      title: 'Daily',
      group: 'Daily',
      goalIds: [],
      routines: [
        routine('get-ready', 'Get ready for the day with a slow, steady start', {
          steps: [
            'Glass of water',
            'Open the blinds',
            'Five slow breaths',
            'Controlled contractions, endurance and coordination',
            'Plan the first task',
          ],
        }),
        routine('water', 'Drink water'),
        routine('read', 'Read twenty pages'),
        routine('weigh', 'Morning weigh-in', { capture: 'weight', optional: true }),
      ],
    },
    // A routine bundled into a program rides as a step under that program's session.
    {
      id: 'stretching',
      title: 'Stretching',
      group: 'Daily',
      goalIds: [],
      routines: [routine('stretch', 'Stretch session')],
    },
    {
      id: 'extras',
      title: 'Extras',
      group: 'Daily',
      goalIds: [],
      routines: [routine('stretch-hips', 'Hips and ankles', { bundledInto: 'stretching' })],
    },
    {
      id: 'cardio',
      title: 'Cardio',
      group: 'Training',
      goalIds: [],
      rotation: { order: ['intervals'], restDays: [], startWith: null },
      routines: [routine('intervals', 'Hill intervals on the long loop', { weekdays: [] })],
    },
  ];
  const at = NINE.toISOString();
  state = ensureDay(state, MON, at);
  // Skip on a rotation workout rests its program today; Today shows it as a quiet row.
  state = restDay(state, 'cardio', MON, at);
  let day = state.days[MON];
  day = setStatus(day, `${MON}:routine:water`, 'done', at);
  day = setStatus(day, `${MON}:routine:read`, 'skipped', at);
  return withDay(state, day);
}

const KINDS = [
  'row:Upper body',
  'row:Home neck routine',
  'row:Daily study',
  'row:Job search',
  'row:Follow my trading rules',
  'row:Get ready for the day with a slow, steady start',
  'row:Drink water',
  'row:Read twenty pages',
  'row:Morning weigh-in',
  'row:Stretch session',
  'rested:Hill intervals on the long loop',
];

type Issue = string;

/**
 * Within each row, no two controls or texts intersect (one inside the other is fine), every control
 * is a full 44 pt target, nothing leaves the screen sideways, and no row reaches into the next.
 */
function rowIssues(page: Page): Promise<Issue[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const vw = window.innerWidth;
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="today-list"] [data-testid^="row:"], [data-testid="today-list"] [data-testid^="rested:"]',
      ),
    );
    const ownText = (el: HTMLElement) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
    const name = (el: HTMLElement) =>
      (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
    rows.forEach((row, index) => {
      const id = row.dataset.testid!;
      const parts = Array.from(row.querySelectorAll<HTMLElement>('*')).filter(
        (el) => ownText(el) || ['button', 'link'].includes(el.getAttribute('role') ?? ''),
      );
      const boxes = parts
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0);
      for (const { el, r } of boxes) {
        if (r.right > vw + 1 || r.left < -1) issues.push(`${id}: ${name(el)} leaves the screen`);
        const role = el.getAttribute('role');
        if ((role === 'button' || role === 'link') && (r.width < 43.5 || r.height < 43.5))
          issues.push(`${id}: ${name(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      // Measured line by line: two runs of one wrapped sentence share a bounding box, not a line.
      const hits = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].el;
          const b = boxes[j].el;
          if (a.contains(b) || b.contains(a)) continue;
          const lines = Array.from(b.getClientRects());
          if (Array.from(a.getClientRects()).some((r) => lines.some((l) => hits(r, l))))
            issues.push(`${id}: ${name(a)} ⟂ ${name(b)}`);
        }
      const next = rows[index + 1];
      if (next && next.getBoundingClientRect().top < row.getBoundingClientRect().bottom - 0.5)
        issues.push(`${id} reaches into ${next.dataset.testid}`);
    });
    return issues;
  });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
])
  test(`every kind of row keeps its parts apart at ${width} pt, at 100% and 200% text`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    for (const scale of [1, 2]) {
      await seed(page, everyRow(), { clock: NINE, route: '/' });
      const list = page.getByTestId('today-list');
      await expect(list.locator('[data-testid^="row:"]').first()).toBeVisible();
      const ids = await list
        .locator('[data-testid^="row:"], [data-testid^="rested:"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
      expect(ids).toEqual(expect.arrayContaining(KINDS));
      // The bundled step, the companion's move and the optional caption are drawn in their rows.
      await expect(
        page.getByRole('button', { name: 'Mark Hips and ankles done', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Move Home neck routine to another day' }),
      ).toBeVisible();
      await expect(page.getByText('Record weight · Optional', { exact: true })).toBeVisible();
      if (scale !== 1) await scaleText(page, scale);
      expect(await rowIssues(page), `${width} pt, ${scale * 100}% text, closed`).toEqual([]);
      // Open everything the chevrons fold: steps, links and the study row's details.
      const toggles = list.locator('[aria-expanded="false"]');
      const count = await toggles.count();
      expect(count).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < count; i++) await toggles.first().click();
      await expect(list.locator('[aria-expanded="true"]')).toHaveCount(count);
      await expect(
        list.getByText('Controlled contractions, endurance and coordination'),
      ).toBeVisible();
      await expect(list.getByText(`Open ${LONG_LINK} ↗`, { exact: true })).toBeVisible();
      if (scale !== 1) await scaleText(page, scale);
      expect(await rowIssues(page), `${width} pt, ${scale * 100}% text, open`).toEqual([]);
      if (width === 320 && scale === 2)
        await page.screenshot({ path: 'test-results/today-rows-320-200.png', fullPage: true });
    }
  });

test('a wrapped step hangs from its number, aligned with the first line', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, everyRow(), { clock: NINE, route: '/' });
  const title = 'Get ready for the day with a slow, steady start';
  const row = page.getByTestId(`row:${title}`);
  await row.getByRole('button', { name: `Show 5 steps for ${title}`, exact: true }).click();
  const step = row.getByText('Controlled contractions, endurance and coordination', {
    exact: true,
  });
  const number = row.getByText('4.', { exact: true });
  const first = row.getByText('Glass of water', { exact: true });
  const box = (await step.boundingBox())!;
  // It wraps at 320 pt, and every line starts where the step's text starts, right of its number.
  expect(box.height).toBeGreaterThan(30);
  expect(box.x).toBeGreaterThanOrEqual((await number.boundingBox())!.x + 10);
  expect(Math.abs(box.x - (await first.boundingBox())!.x)).toBeLessThan(1);
});

for (const [width, height, least] of [
  // The hero card takes about one row's height that the bare count line
  // left to the list (7 and 4 rows before).
  [390, 844, 6],
  [375, 667, 3],
])
  test(`a full day shows at least ${least} rows on the first screen at ${width} × ${height}`, async ({
    page,
  }) => {
    // The greeting and the hero card stay compact, so the list still starts on the first screen.
    await page.setViewportSize({ width, height });
    await seed(page, denseState(), { clock: NINE, route: '/' });
    const rows = page.getByTestId('today-list').locator('[data-testid^="row:"]');
    await expect(rows.first()).toBeVisible();
    const shown = await rows.evaluateAll((els) => {
      const bottom =
        document.querySelector('[data-testid="tab-bar"]')?.getBoundingClientRect().top ??
        window.innerHeight;
      return els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= bottom;
      }).length;
    });
    expect(shown).toBeGreaterThanOrEqual(least);
  });
