import type { Page } from '@playwright/test';
import type { State } from '../../src/domain/model';
import type { TradingSession } from '../../src/domain/trading';

/** The localStorage key the web build keeps the app state under. */
export const STATE_KEY = 'life-os-v1';

type SeedOptions = {
  /** Installs the browser clock first: at this time, or at the real time with `'now'`. */
  clock?: Date | 'now';
  /** Opened once the state is written, so the app loads it. */
  route?: string;
};

/**
 * Writes `state` as the saved app state before the app reads it. The write happens on a missing
 * page of the app's origin, where no app runs: an app still loading would read the seeded state
 * and save its own day first. Without `route` the page stays there, so a test can read the state
 * back exactly as written and open the app when it is ready.
 */
export async function seed(page: Page, state: unknown, { clock, route }: SeedOptions = {}) {
  if (clock) await page.clock.install(clock === 'now' ? {} : { time: clock });
  await page.goto('/__seed__');
  await writeState(page, state);
  if (route) await page.goto(route);
}

/** Replaces the saved app state; the app reads it on its next load. */
export function writeState(page: Page, state: unknown): Promise<void> {
  return page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: STATE_KEY,
    value: state,
  });
}

/**
 * Reads the stored app state once a change the last action started has been saved. The app waits
 * one painted frame, then a timer, before each save (`afterPaint` in src/state/app-state.tsx), so a
 * save lands a frame after its tap: this waits for the same frame and timer, which run after the
 * app's, twice over so a change queued behind another one has saved too.
 */
function readAfterSaves<T>(page: Page, read: (text: string | null) => T): Promise<T> {
  return page
    .evaluate(async (key) => {
      for (let i = 0; i < 2; i++)
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      return localStorage.getItem(key);
    }, STATE_KEY)
    .then(read);
}

/** The saved app state, or null when nothing is saved. */
export function saved(page: Page): Promise<State> {
  return readAfterSaves(page, (text) => JSON.parse(text!));
}

/** The saved app state exactly as stored, or null when nothing is saved. */
export function savedText(page: Page): Promise<string | null> {
  return readAfterSaves(page, (text) => text);
}

/**
 * What the app says when the device refuses a save (`SAVE_FAILED` in src/state/app-state.tsx,
 * which the browser suite cannot import): the storage's own error text is never shown.
 */
export const SAVE_FAILED_TEXT =
  'Could not save on this device, so that change was not made. Try again; if it keeps failing, free up storage.';

/** Makes every save of the app state throw `message` until `restoreSaves`. */
export function failSaves(page: Page, message: string): Promise<void> {
  return page.evaluate(
    ({ key, text }) => {
      const original = Storage.prototype.setItem;
      (window as Window & { restoreStorage?: () => void }).restoreStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new Error(text);
        original.call(this, name, value);
      };
    },
    { key: STATE_KEY, text: message },
  );
}

/** Lets saves through again after `failSaves`. */
export function restoreSaves(page: Page): Promise<void> {
  return page.evaluate(() =>
    (window as Window & { restoreStorage?: () => void }).restoreStorage!(),
  );
}

/** A candle's saved trading session, or null, once the last action's saves have landed. */
export function savedSession(page: Page, date: string): Promise<TradingSession | null> {
  return readAfterSaves(page, (text) => JSON.parse(text!).tradingSessions?.[date] ?? null);
}
