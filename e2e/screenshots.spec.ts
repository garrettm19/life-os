import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { basicState } from '../src/test-support/basic-state';
import { denseState } from './support/dense-state';
import { probeLayout, scaleText, scrollMain, type LayoutIssue } from './support/layout-probe';
import { seed, writeState } from './support/storage';

// Optional screenshot sweep across phone widths, with synthetic data. It runs only when
// SCREENSHOT_DIR names a Git-ignored folder for the images and the probe's findings, for example
// `SCREENSHOT_DIR=screenshots/run`. Each screen is captured one screenful at a time while
// scrolling, the way it is read.
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, 'Set SCREENSHOT_DIR to capture the screenshot sweep.');
test.setTimeout(300_000);

// SCREENSHOT_WIDTHS=375 and SCREENSHOT_ONLY=progress,today narrow a run.
const widths = (process.env.SCREENSHOT_WIDTHS ?? '320,375,390,430').split(',').map(Number);
const only = process.env.SCREENSHOT_ONLY?.split(',');
const heights: Record<number, number> = { 320: 568, 375: 667, 390: 844, 430: 932 };

const findings: Record<string, LayoutIssue[]> = {};

/** Captures every screenful of the main scroller (pages p0, p1, …), up to `limit` screens. */
async function capture(page: Page, name: string, width: number, limit = 12) {
  await page.waitForTimeout(450);
  const out = path.resolve(dir!, `${width}`);
  mkdirSync(out, { recursive: true });
  const step = Math.round(heights[width] * 0.8);
  let { max } = await scrollMain(page, 0);
  for (let i = 0, y = 0; i < limit; i++, y += step) {
    await scrollMain(page, y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(out, `${name}-p${i}.png`) });
    const issues = await probeLayout(page);
    if (issues.length) findings[`${name}-p${i}`] = issues;
    if (y >= max) break;
    ({ max } = await scrollMain(page, y));
  }
  await scrollMain(page, 0);
}

const routes: [string, string][] = [
  ['today', '/'],
  ['week', '/week'],
  ['programs', '/programs'],
  ['progress', '/review'],
  ['trading', '/trading'],
  ['settings', '/settings'],
  ['backup', '/backup'],
  ['export', '/export'],
];

async function tap(page: Page, name: RegExp | string) {
  const target = page.getByRole('button', { name }).first();
  if (!(await target.count())) return false;
  await target.click({ timeout: 4000 }).catch(() => {});
  return true;
}

for (const width of widths) {
  test(`screens at ${width} pt`, async ({ page }) => {
    await page.setViewportSize({ width, height: heights[width] });
    await seed(page, denseState(), { clock: new Date(2026, 10, 9, 9) });
    for (const [name, route] of routes) {
      if (only && !only.includes(name)) continue;
      await page.goto(route);
      await capture(page, name, width);
    }
    if (only) return;
    // Larger text (approximation) on the primary screens.
    for (const [name, route] of routes.slice(0, 4)) {
      await page.goto(route);
      await page.waitForTimeout(400);
      await scaleText(page, 1.35);
      await capture(page, `${name}-large`, width, 4);
    }
    // Sheets and flows.
    await page.goto('/programs');
    if (await tap(page, /^Add objective/)) await capture(page, 'sheet-add-objective', width, 3);
    await page.goto('/');
    if (await tap(page, 'Start Upper body')) await capture(page, 'sheet-workout', width, 4);
    await page.goto('/');
    if (await tap(page, /^Use the timer for/)) await capture(page, 'sheet-study-timer', width, 2);
    await page.goto('/');
    if (await tap(page, 'Add block')) await capture(page, 'sheet-add-block', width, 2);
    await page.goto('/review');
    if (await tap(page, 'Add weigh-in')) await capture(page, 'sheet-weight', width, 2);
    await page.goto('/review');
    if (await tap(page, 'Add money check-in')) await capture(page, 'sheet-money', width, 3);
    // Empty first run.
    await writeState(page, basicState());
    for (const [name, route] of [
      ['empty-today', '/'],
      ['empty-progress', '/review'],
    ]) {
      await page.goto(route);
      await capture(page, name, width, 3);
    }
    writeFileSync(
      path.resolve(dir!, `${width}`, 'findings.json'),
      JSON.stringify(findings, null, 1),
    );
  });
}
