import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { localDate, shiftDate } from '../src/domain/model';
import type { State } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { recordWeight } from '../src/domain/measurements';
import { seed } from './support/storage';
const today = localDate();
const noon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

function seedState(): State {
  let s = trainingState();
  const date = shiftDate(today, -3);
  s = recordWeight(s, { value: 180.4, unit: 'lb', date, fasted: true, note: '' }, 'w1', noon(date));
  return {
    ...s,
    lifeLog: [
      {
        id: 'l1',
        date,
        at: noon(date),
        text: 'Synthetic private note',
        category: null,
        energy: null,
        mood: null,
        goalId: null,
      },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('export includes only chosen categories, warns about sensitive ones, and downloads locally', async ({
  page,
}) => {
  await seed(page, seedState(), { route: '/settings' });
  await page.getByRole('button', { name: 'Export data for analysis', exact: true }).click();
  // The disabled Export says what enables it, once, and the line goes when a category is chosen.
  const needs = page.getByText('Choose at least one category to export.', { exact: true });
  await expect(needs).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Body weight', exact: true }).click();
  await expect(page.getByText(/Body weight: 2 rows/)).toBeVisible();
  await expect(needs).toHaveCount(0);
  // A sensitive category shows a warning; removing it removes the warning.
  await page.getByRole('checkbox', { name: 'Life log · sensitive', exact: true }).click();
  await expect(page.getByText('Sensitive data included')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Life log · sensitive', exact: true }).click();
  await expect(page.getByText('Sensitive data included')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`LifeOS-analysis-${today}.csv`);
  const text = await readFile((await file.path())!, 'utf8');
  expect(text.split('\n')[0]).toBe('category,date,item,field,value,unit,note');
  expect(text).toContain('weight,');
  expect(text).toContain(',180.4,lb,fasted');
  expect(text).not.toContain('Synthetic private note');
});

test('export picks dates and the format with segmented controls', async ({ page }) => {
  await seed(page, seedState(), { route: '/export' });
  const dates = page.getByRole('radiogroup', { name: 'Dates', exact: true });
  const format = page.getByRole('radiogroup', { name: 'Format', exact: true });
  // The boxes are read once the screen has drawn every segment.
  await expect(dates.getByRole('radio')).toHaveCount(4);
  await expect(format.getByRole('radio')).toHaveCount(2);
  // One row of equal segments each, as on Progress, not wrapping chips.
  for (const group of [dates, format]) {
    const boxes = await Promise.all(
      (await group.getByRole('radio').all()).map(async (r) => (await r.boundingBox())!),
    );
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
    expect(new Set(boxes.map((b) => Math.round(b.width))).size).toBe(1);
    for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await expect(dates.getByRole('radio', { name: '90 days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await dates.getByRole('radio', { name: '1 year' }).click();
  await expect(dates.getByRole('radio', { name: '1 year' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dates.getByRole('radio', { name: '90 days' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(
    page.getByText(`From ${shiftDate(today, -364)} to ${today}.`, { exact: false }),
  ).toBeVisible();
  await format.getByRole('radio', { name: 'JSON' }).click();
  await expect(format.getByRole('radio', { name: 'JSON' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Export JSON', exact: true })).toBeVisible();
});
