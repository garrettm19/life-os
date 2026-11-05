import { test, expect, type Page } from '@playwright/test';
import { withDay } from '../src/domain/data';
import { demoState } from '../src/domain/demo';
import { ensureChecklistDay } from '../src/domain/planner';
import { studyState } from '../src/test-support/fixtures';
import { showJourney } from './support/progress';
import { seed } from './support/storage';
import { tradingState } from './support/trading-state';
import {
  LONG_PLAN,
  SHORT_PLAN,
  begun,
  cockpitState,
  openCockpit,
  readied,
} from './support/cockpit';

// The browser clock is pinned to Monday, November 9, 2026 at 9:00 unless a
// test says otherwise.
const MON = '2026-11-09';
/** A New York wall-clock time on Monday as an instant. */
const nyIso = (h: number, m: number) => new Date(Date.UTC(2026, 10, 9, h + 5, m)).toISOString();

// Tokens from src/ui/theme.ts (which the browser suite cannot import: it loads React Native). The
// suite runs in dark (playwright.config.ts); the light tests below emulate light.
const dark = {
  canvas: '#100F0E',
  surface: '#1C1A18',
  fill: '#2A2724',
  label: '#F5F1EB',
  label2: '#B8B0A6',
  label3: '#9A9187',
  checkEdge: '#7E766D',
  accent: '#FF9A57',
  accentText: '#FFA86E',
  done: '#5FD3A6',
};
const light: typeof dark = {
  canvas: '#F7F4EF',
  surface: '#FFFFFF',
  fill: '#EFEAE3',
  label: '#1D1B18',
  label2: '#5C564F',
  label3: '#6B645C',
  checkEdge: '#8C847B',
  accent: '#AE4E18',
  accentText: '#994515',
  done: '#1C7A50',
};
const palette = dark;
/** Trading's market colors in dark, as in src/ui/theme.ts. */
const market = { bull: '#2BE0A3', bear: '#FF6B7E', amber: '#F5B544' };

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/**
 * Every visible element drawn in `hex` (its own text, fill or edge), named by the control it belongs
 * to: "tab:Today" for a tab, else the control's name.
 */
function colorOnScreen(page: Page, hex: string): Promise<string[]> {
  return page.evaluate((color) => {
    const names = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el);
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
      );
      const edge = ['Top', 'Right', 'Bottom', 'Left'].some(
        (side) =>
          style.getPropertyValue(`border-${side.toLowerCase()}-color`) === color &&
          parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
      );
      if (!(ownText && style.color === color) && style.backgroundColor !== color && !edge) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      if (opacity === 0) continue;
      const control = el.closest('[role="button"],[role="link"],a,button');
      const name = control?.getAttribute('aria-label') ?? control?.textContent ?? el.textContent;
      names.add(el.closest('[data-testid="tab-bar"]') ? `tab:${name}` : (name ?? '').trim());
    }
    return [...names].sort();
  }, rgb(hex));
}

/**
 * Visible text below its contrast minimum against the background it is drawn on: 4.5:1, or 3:1
 * for large text (24 px, or 18.66 px bold). The background is the element's own and its
 * ancestors' fills laid over each other down to the first opaque one, so text on the translucent
 * tab bar is measured over the page under it. Text on a gradient (a wash behind it, as an ancestor
 * or as a layer drawn under it) has no single fill to read, so it is measured on the screen
 * itself: the text is hidden, the screen captured, and the text's color compared with the median
 * pixel under its box.
 */
async function lowContrast(page: Page): Promise<string[]> {
  const { found, washed } = await page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim());
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const gradient = (node: Element) => getComputedStyle(node).backgroundImage.includes('gradient');
    const washes = Array.from(document.querySelectorAll('body *')).filter(gradient);
    /** The fills under the text, and the first opaque one (null: the page itself). */
    const under = (el: Element) => {
      const layers: number[][] = [];
      let floor: Element | null = null;
      let onWash = false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (gradient(node)) onWash = true;
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) {
            floor = node;
            break;
          }
        }
      }
      let base = parse(getComputedStyle(document.body).backgroundColor)!;
      for (const [r, g, b, a] of layers.reverse())
        base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1];
      return { base, floor, onWash };
    };
    const found: string[] = [];
    const washed: { text: string; box: number[]; color: number[]; min: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
      );
      if (!own || el.closest('[aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < 0 || box.top > window.innerHeight) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const min = large ? 3 : 4.5;
      const color = parse(style.color)!;
      const { base, floor, onWash } = under(el);
      // A wash drawn as its own layer: over the text's first opaque fill, before the text, and
      // under its box.
      const layered = washes.some((w) => {
        if (w.contains(el) || (floor && !floor.contains(w))) return false;
        if (!(w.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const r = w.getBoundingClientRect();
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      });
      const text = el.textContent!.trim().slice(0, 40);
      if (onWash || layered) {
        washed.push({ text, box: [box.left, box.top, box.right, box.bottom], color, min });
        continue;
      }
      const value = ratio(color, base);
      if (value < min) found.push(`${text} ${value.toFixed(2)}`);
    }
    return { found, washed };
  });
  if (!washed.length) return found;
  const hide = await page.addStyleTag({
    content:
      '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}',
  });
  const shot = (await page.screenshot()).toString('base64');
  await hide.evaluate((node) => (node as Element).remove());
  const measured = await page.evaluate(
    async ({ png, texts }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const scale = image.width / window.innerWidth;
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const out: string[] = [];
      for (const { text, box, color, min } of texts) {
        const [x0, y0, x1, y1] = box.map((v) => Math.round(v * scale));
        const left = Math.max(0, x0);
        const top = Math.max(0, y0);
        const width = Math.min(image.width, x1) - left;
        const height = Math.min(image.height, y1) - top;
        if (width < 1 || height < 1) continue;
        const data = context.getImageData(left, top, width, height).data;
        const levels: number[] = [];
        for (let i = 0; i < data.length; i += 4)
          levels.push(lum([data[i], data[i + 1], data[i + 2]]));
        levels.sort((a, b) => a - b);
        const ground = levels[Math.floor(levels.length / 2)];
        const [hi, lo] = [lum(color), ground].sort((a, b) => b - a);
        const value = (hi + 0.05) / (lo + 0.05);
        if (value < min) out.push(`${text} ${value.toFixed(2)} (on a wash)`);
      }
      return out;
    },
    { png: shot, texts: washed },
  );
  return [...found, ...measured];
}

test('an untouched day shows no Fern, and Ember only on the next thing to do and the tab', async ({
  page,
}) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
  await expect(page.getByText('to clear the day')).toBeVisible();
  // The goal line counts down in plain text until the day is cleared.
  await expect(page.getByText(/to clear the day/)).toHaveCSS('color', rgb(palette.label));
  // The list has no primary button: Fern arrives only with done work.
  expect(await colorOnScreen(page, palette.done)).toEqual([]);
  // Ember marks now: the first open objective's check, and today in the hero card's chain (its
  // ring and its letter).
  const chain = (names: string[]) => names.map((n) => (n.startsWith('Last 7 days') ? 'chain' : n));
  expect(chain(await colorOnScreen(page, palette.accent))).toEqual(['chain', 'Start Upper body']);
  expect(chain(await colorOnScreen(page, palette.accentText))).toEqual(['chain', 'tab:Today']);
  // Ticking an objective is what brings Fern in.
  await page.getByRole('button', { name: 'Mark Job search done', exact: true }).click();
  await expect
    .poll(async () =>
      (await colorOnScreen(page, palette.done)).some((n) => n.includes('Job search')),
    )
    .toBe(true);
});

test("Today's trading row says its status in the market's amber, never Ember", async ({ page }) => {
  // Monday 10:00 AM in New York, before the daily bias is set: preparation is incomplete.
  await seed(page, tradingState(), { clock: new Date('2026-11-09T15:00:00Z'), route: '/' });
  const caption = page.getByTestId('trading-caption');
  await expect(caption).toContainText('No trade — preparation incomplete');
  // Ember on Today marks only the row in progress; the trading row is not it.
  await expect(caption.getByText(/No trade/)).toHaveCSS('color', rgb(market.amber));
  expect(
    (await colorOnScreen(page, palette.accent)).filter((n) => n.includes('trading rules')),
  ).toEqual([]);
});

test('the open check outline and the tab bar use tokens', async ({ page }) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
  const check = page.getByRole('button', { name: 'Mark Job search done', exact: true });
  // The outline is drawn by the pressable's animated view inside the button.
  await expect(check.locator('> div').first()).toHaveCSS(
    'border-top-color',
    rgb(palette.checkEdge),
  );
  await expect(check.locator('> div').first()).toHaveCSS('border-top-left-radius', '999px');
  const tabs = page.getByTestId('tab-bar');
  await expect(tabs.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tabs.getByText('Week', { exact: true })).toHaveCSS('color', rgb(palette.label2));
  await expect(page.locator('body')).toHaveCSS('background-color', rgb(palette.canvas));
});

test("Today's compact count draws its total in label3: at 20 pt the placeholder tone is too faint", async ({
  page,
}) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
  const total = page.getByText(/^\/\d+$/).first();
  await expect(total).toBeVisible();
  await expect(total).toHaveCSS('font-size', '20px');
  await expect(total).toHaveCSS('color', rgb(palette.label3));
});

test('a past day never opened reads in label3, which small text can read', async ({ page }) => {
  // Wednesday: Monday was opened, Tuesday is past and was never opened.
  const opened = ensureChecklistDay(
    MON,
    studyState().settings,
    studyState().programs,
    undefined,
    new Date(2026, 10, 9, 9).toISOString(),
  );
  await seed(page, withDay(studyState(), opened), {
    clock: new Date(2026, 10, 11, 9),
    route: '/week',
  });
  const status = page.getByText('Not opened', { exact: true });
  await expect(status).toHaveCount(1);
  await expect(status).toHaveCSS('color', rgb(palette.label3));
});

test('a plan set up mid-week reads the days before it as before you started, not missed', async ({
  page,
}) => {
  // Set up on Wednesday: Monday and Tuesday came before tracking, so neither is a day left
  // unopened.
  await seed(page, studyState(), { clock: new Date(2026, 10, 11, 9), route: '/week' });
  const before = page.getByText('Before you started', { exact: true });
  await expect(before).toHaveCount(2);
  await expect(before.first()).toHaveCSS('color', rgb(palette.label3));
  await expect(page.getByText('Not opened', { exact: true })).toHaveCount(0);
});

test('at 320 pt the selected tab, the tile figures and the journey figures are never cut', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, demoState(MON), { clock: new Date(2026, 10, 9, 9), route: '/programs' });
  // Cut text, measured by the laid-out width of the words (scrollWidth rounds a sub-pixel cut
  // away, as with a bold label at 70.3 of 70 pt) and by height (a wrapped line under a single-line box).
  const cut = (selector: string) =>
    page.locator(selector).evaluateAll((els) =>
      els
        .filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return (
            range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.05 ||
            el.scrollHeight > el.clientHeight + 1
          );
        })
        .map((el) => el.textContent),
    );
  const tab = page.getByTestId('tab-bar').getByRole('link', { name: 'Programs', exact: true });
  await expect(tab).toHaveAttribute('aria-current', 'page');
  expect(await cut('[data-testid="tab-bar"] a div:not(:has(div))')).toEqual([]);
  await page.getByTestId('tab-bar').getByRole('link', { name: 'Progress', exact: true }).click();
  // The KPI tiles' figures fit their tiles at the narrowest width.
  await expect(page.getByTestId('tile-value').first()).toBeVisible();
  expect(await page.getByTestId('tile-value').count()).toBeGreaterThan(1);
  expect(await cut('[data-testid="tile-value"]')).toEqual([]);
  await showJourney(page);
  const figures = page.getByTestId('journey-figure');
  expect(await figures.count()).toBeGreaterThan(1);
  expect(await cut('[data-testid="journey-figure"]')).toEqual([]);
  // Each figure stays inside its own cell.
  for (const figure of await figures.all()) {
    const fits = await figure.evaluate((el) => {
      const own = el.getBoundingClientRect();
      const cell = el.parentElement!.parentElement!.getBoundingClientRect();
      return own.right <= cell.right + 0.5 && el.scrollWidth <= own.width + 1;
    });
    expect(fits).toBe(true);
  }
});

test('the tab labels are sentence case and untracked at every width, from the first load', async ({
  page,
}) => {
  // The web page is prerendered at no width: the loaded page must look the same at each width.
  const looks = () =>
    page
      .getByTestId('tab-bar')
      .locator('a div:not(:has(div))')
      .evaluateAll((els) => [
        ...new Set(
          els.map(
            (el) => `${getComputedStyle(el).textTransform} ${getComputedStyle(el).letterSpacing}`,
          ),
        ),
      ]);
  for (const [width, height] of [
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/week' });
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect.poll(looks).toEqual(['none normal']);
  }
});

test('a setting is a real switch: its state is spoken, written and drawn on the track', async ({
  page,
}) => {
  await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/settings' });
  const toggle = page.getByRole('switch', {
    name: 'Show Day Cleared on the Home Screen widget',
    exact: true,
  });
  const track = toggle.locator('> div > div').last();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toContainText('Hidden from the widget');
  await expect(track).toHaveCSS('background-color', rgb(palette.checkEdge));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('Shown on the widget');
  await expect(track).toHaveCSS('background-color', rgb(palette.label));
  await expect.poll(async () => (await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('editor links under a Programs row are quiet pills with a chevron', async ({ page }) => {
  await seed(page, demoState(MON), { clock: new Date(2026, 10, 9, 9), route: '/programs' });
  const links = page.getByRole('button', {
    name: /^(Edit (study plan|rules|workout plan|timed circuit)|Open Trading and the bias board) for /,
  });
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(1);
  for (const link of await links.all()) {
    // The words in the text color on the quiet fill, and a dim chevron after them.
    const [words, chevron] = await link.locator('div:not(:has(div))').all();
    await expect(words).not.toHaveText(/›/);
    await expect(words).toHaveCSS('color', rgb(palette.label));
    await expect(chevron).toHaveText('›');
    await expect(chevron).toHaveCSS('color', rgb(palette.label3));
    await expect(link.locator('> div > div').first()).toHaveCSS(
      'background-color',
      rgb(palette.fill),
    );
  }
});

test('the cockpit shows no Fern or Ember, and no bias color outside its HTF tile', async ({
  page,
}) => {
  for (const [bias, color] of [
    ['bullish', market.bull],
    ['bearish', market.bear],
  ] as const) {
    const plan = bias === 'bullish' ? LONG_PLAN : SHORT_PLAN;
    const live = begun(cockpitState(), nyIso(9, 40), plan, nyIso(9, 35));
    const state = readied(live, nyIso(9, 45), {
      entry: bias === 'bullish' ? 25040 : 24960,
      stop: bias === 'bullish' ? 25030 : 24970,
    });
    await openCockpit(page, { state, clock: new Date(nyIso(10, 0)) });
    // The bias color shows on the HTF tile only, so it never reads as permission.
    await expect(page.getByTestId('tile-plan').getByText(/Bullish|Bearish/)).toHaveCSS(
      'color',
      rgb(color),
    );
    // A chosen chip and the confirmed setup (folded to one toggle) are neutral rings on the card;
    // the primary is the solid neutral capsule. Never the bias color, Fern or Ember.
    const chosen = page.getByRole('radio', { name: 'Price at my area', exact: true });
    await expect(chosen).toHaveCSS('background-color', rgb(palette.surface));
    await expect(chosen).toHaveCSS('border-top-color', rgb(palette.label));
    const confirmed = page
      .getByRole('checkbox', { name: /^Setup confirmed · A · Pierce · 5m$/ })
      .locator(':scope > div');
    await expect(confirmed).toHaveCSS('background-color', rgb(palette.surface));
    await expect(confirmed).toHaveCSS('border-top-color', rgb(palette.label));
    await expect(
      page
        .getByRole('button', { name: 'I entered in my broker', exact: true })
        .locator(':scope > div'),
    ).toHaveCSS('background-color', rgb(palette.label));
    expect(await colorOnScreen(page, palette.done)).toEqual([]);
    expect(await colorOnScreen(page, palette.accent)).toEqual([]);
    expect(await colorOnScreen(page, palette.accentText)).toEqual([]);
  }
});

for (const scheme of ['dark', 'light'] as const)
  test.describe(`${scheme} appearance`, () => {
    test.use({ colorScheme: scheme });
    const t = scheme === 'dark' ? dark : light;

    test('follows the appearance: the page, cards, text and the primary', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('body')).toHaveCSS('background-color', rgb(t.canvas));
      await expect(page.getByText('Welcome to Life OS', { exact: true })).toHaveCSS(
        'color',
        rgb(t.label),
      );
      await expect(
        page.getByText('Restore your backup, start with your setup, or explore.'),
      ).toHaveCSS('color', rgb(t.label2));
      await expect(
        page
          .getByRole('button', { name: 'Restore my backup', exact: true })
          .locator('> div')
          .first(),
      ).toHaveCSS('background-color', rgb(t.label));
      await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
      const check = page.getByRole('button', { name: 'Mark Job search done', exact: true });
      await expect(check.locator('> div').first()).toHaveCSS('border-top-color', rgb(t.checkEdge));
      await check.click();
      await expect(
        page.getByRole('button', { name: 'Undo Job search', exact: true }).locator('> div').first(),
      ).toHaveCSS('background-color', rgb(t.done));
    });

    test('keeps every visible text at its contrast minimum on the main screens', async ({
      page,
    }) => {
      await seed(page, studyState(), { clock: new Date(2026, 10, 9, 9), route: '/' });
      await expect(page.getByText(/to clear the day/)).toBeVisible();
      expect(await lowContrast(page), 'Today').toEqual([]);
      await seed(page, demoState(MON), { clock: new Date(2026, 10, 9, 9), route: '/' });
      await expect(page.getByTestId('today-list')).toBeVisible();
      expect(await lowContrast(page), 'Today, demo').toEqual([]);
      for (const route of ['/week', '/programs', '/review', '/settings']) {
        await page.goto(route);
        await expect(page.getByTestId('tab-bar')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await lowContrast(page), route).toEqual([]);
      }
      const live = begun(cockpitState(), nyIso(9, 40), LONG_PLAN, nyIso(9, 35));
      await openCockpit(page, { state: live, clock: new Date(nyIso(10, 0)) });
      await expect(page.getByTestId('trade-status')).toBeVisible();
      expect(await lowContrast(page), 'cockpit').toEqual([]);
    });
  });
