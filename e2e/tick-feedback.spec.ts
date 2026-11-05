import { devices, expect, test, type Page } from '@playwright/test';
import { basicState } from '../src/test-support/basic-state';
import { localDate } from '../src/domain/model';
import { generateDay } from '../src/domain/planner';
import { failSaves, SAVE_FAILED_TEXT, seed, STATE_KEY } from './support/storage';

// Today is the real date, so frames and timers run as they do for a person:
// these tests are about what is painted before a save, which a pinned clock would emulate.

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

/** Opens Today planned from the small synthetic state, and returns the first open check's title. */
async function openToday(page: Page): Promise<string> {
  const state = basicState();
  const today = localDate();
  state.days[today] = generateDay(today, state.settings, state.programs);
  await seed(page, state, { route: '/' });
  const first = page.getByRole('button', { name: /^Mark .+ done$/ }).first();
  await expect(first).toBeVisible();
  return (await first.getAttribute('aria-label'))!.replace(/^Mark (.+) done$/, '$1');
}

/**
 * Makes each save of the app state take `ms` on the main thread, like a long history, and records
 * when the first one starts; records when the check for `title` is first painted as pending, and
 * whether, while pending, it ever carried another label than `Mark … done` or showed its tick. The
 * busy check is found by its row, not by its label, so a pending check relabelled as done is seen.
 */
function watch(page: Page, title: string, ms: number) {
  return page.evaluate(
    ({ key, title, ms }) => {
      const log = window as Window & {
        saveAt?: number;
        pendingFrameAt?: number;
        claimed?: boolean;
        pendingSeen?: boolean;
      };
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          log.saveAt ??= performance.now();
          const until = performance.now() + ms;
          while (performance.now() < until);
        }
        original.call(this, name, value);
      };
      const pending = () =>
        document.querySelector(`[data-testid="row:${title}"] [aria-busy="true"]`);
      new MutationObserver(() => {
        const check = pending();
        if (!check) return;
        log.pendingSeen = true;
        if (
          check.getAttribute('aria-label') !== `Mark ${title} done` ||
          check.querySelector('[data-testid="check-tick"]')
        )
          log.claimed = true;
        if (log.pendingFrameAt === undefined)
          requestAnimationFrame(() => {
            if (pending()) log.pendingFrameAt ??= performance.now();
          });
      }).observe(document, { subtree: true, attributes: true, childList: true });
    },
    { key: STATE_KEY, title, ms },
  );
}

test('a tick shows at once that it is saving, and only the saved change fills the check', async ({
  page,
}) => {
  const title = await openToday(page);
  await watch(page, title, 600);
  await page.getByRole('button', { name: `Mark ${title} done`, exact: true }).click();
  const undo = page.getByRole('button', { name: `Undo ${title}`, exact: true });
  await expect(undo).toBeVisible();
  await expect(undo).not.toHaveAttribute('aria-busy', 'true');
  const log = await page.evaluate(() => {
    const w = window as Window & {
      saveAt?: number;
      pendingFrameAt?: number;
      claimed?: boolean;
      pendingSeen?: boolean;
    };
    return {
      saveAt: w.saveAt,
      pendingFrameAt: w.pendingFrameAt,
      claimed: w.claimed ?? false,
      pendingSeen: w.pendingSeen ?? false,
    };
  });
  // The pending check was painted in a frame before the save began to hold the screen.
  expect(log.pendingFrameAt).toBeDefined();
  expect(log.saveAt).toBeDefined();
  expect(log.pendingFrameAt!).toBeLessThan(log.saveAt!);
  // While pending it kept its open label and showed no tick.
  expect(log.pendingSeen).toBe(true);
  expect(log.claimed).toBe(false);
  // Once saved, the same check reads as done and shows its tick.
  await expect(undo.getByTestId('check-tick')).toHaveCount(1);
});

test('a refused save returns the check to open, with the error', async ({ page }) => {
  const title = await openToday(page);
  await failSaves(page, 'Synthetic tick failure');
  await page.getByRole('button', { name: `Mark ${title} done`, exact: true }).click();
  await expect(page.getByText(SAVE_FAILED_TEXT).first()).toBeVisible();
  const check = page.getByRole('button', { name: `Mark ${title} done`, exact: true });
  await expect(check).toBeVisible();
  await expect(check).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: `Undo ${title}`, exact: true })).toHaveCount(0);
});

test.describe('in a desktop browser', () => {
  // expo-symbols' icon font would be fetched in desktop and Android browsers (the suite's iPhone
  // browser skips it), so this checks there.
  test.use({ userAgent: devices['Desktop Chrome'].userAgent });

  test('the Settings gear is the text gear, without the 966 KB icon font', async ({ page }) => {
    const fonts: string[] = [];
    page.on('request', (request) => {
      if (/\.(ttf|otf|woff2?)(\?|$)/.test(request.url())) fonts.push(request.url());
    });
    await openToday(page);
    const settings = page.getByRole('link', { name: 'Settings', exact: true }).first();
    await expect(settings).toHaveText('⚙︎');
    await settings.click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    // Fonts load after the screen mounts: wait until nothing more is fetched.
    await page.waitForLoadState('networkidle');
    // The type is the system's own, so no font file is fetched at all: not the icon font, and no
    // bundled face.
    expect(fonts).toEqual([]);
  });
});
