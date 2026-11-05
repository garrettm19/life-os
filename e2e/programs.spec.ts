import { test, expect } from '@playwright/test';
import { nextMonday } from './support/dates';
import { savedText } from './support/storage';

// Creating programs and habits in Programs, from the empty app. Synthetic names only.
const date = nextMonday();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('Programs can create a private checklist habit that appears on Today when due', async ({
  page,
}) => {
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Example everyday habit');
  await page.getByLabel('Program name', { exact: true }).fill('Example everyday');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  const privacy = page.getByRole('switch', {
    name: 'Private, hidden from the Home Screen widget',
    exact: true,
  });
  await expect(privacy).not.toHaveAttribute('aria-checked', 'true');
  await privacy.click();
  await expect(privacy).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Duration in minutes (blank = unknown)')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/programs-habit-editor.png' });
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Checklist · Every day', { exact: true })).toBeVisible();
  await expect(page.getByText('Duration needed')).toHaveCount(0);
  await expect(page.getByText(/· private$/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Checklist · Every day', { exact: true })).toBeVisible();
  await expect(page.getByText(/· private$/)).toBeVisible();
  await page.getByRole('button', { name: 'Configure Example everyday habit', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Private, hidden from the Home Screen widget', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Stays off the widget', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Needs a time slot', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText(/· private$/)).toBeVisible();
  await page.goto('/?date=' + date);
  await expect(page.getByTestId('row:Example everyday habit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Example timed session' })).toHaveCount(0);
});

test('Add program creates a container; Add objective still opens the type picker', async ({
  page,
}) => {
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add program', exact: true }).click();
  await expect(page.getByLabel('Routine name')).toHaveCount(0);
  await expect(page.getByLabel('Duration in minutes (blank = unknown)')).toHaveCount(0);
  await page.getByLabel('Program name', { exact: true }).fill('Example container');
  await page.getByRole('button', { name: 'Save program', exact: true }).click();
  await expect(page.getByText('Example container', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Nothing here yet. Add an objective when you are ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add another objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Example container habit');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Checklist · Every day', { exact: true })).toBeVisible();
});

test('a new habit needs a due day: inline error keeps the form, cancel saves nothing, a valid habit persists', async ({
  page,
}) => {
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Example dayless habit');
  await page.getByLabel('Program name', { exact: true }).fill('Example dayless');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  const message = page.getByText('Choose at least one day for this habit, or pause it.', {
    exact: true,
  });
  await expect(message).toBeVisible();
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue(
    'Example dayless habit',
  );
  expect(await savedText(page)).toBeNull();
  // Choosing a day clears the message; deselecting it again is not silently refilled.
  const monday = page.getByRole('checkbox', { name: 'Monday', exact: true });
  await monday.click();
  await expect(message).toHaveCount(0);
  await monday.click();
  await expect(monday).not.toHaveAttribute('aria-checked', 'true');
  // Close asks before throwing the typed details away.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByText('Example dayless', { exact: true })).toHaveCount(0);
  expect(await savedText(page)).toBeNull();
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
  await expect(message).toHaveCount(0);
  await expect(page.getByLabel('Routine name', { exact: true })).toHaveValue('');
  await page.getByLabel('Routine name', { exact: true }).fill('Example weekday habit');
  await page.getByLabel('Program name', { exact: true }).fill('Example weekday');
  await page.getByRole('checkbox', { name: 'Wednesday', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByText('Checklist · We', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Checklist · We', { exact: true })).toBeVisible();
});

for (const { name, width, rows } of [
  { name: 'standard', width: 390, rows: 1 },
  { name: 'narrow', width: 320, rows: 2 },
])
  test(`weekday choices keep 44pt targets without overlap on a ${name} phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/programs');
    await page.getByRole('button', { name: 'Add objective', exact: true }).click();
    await page.getByRole('radio', { name: 'Simple habit', exact: true }).click();
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    await expect(page.getByRole('checkbox', { name: 'Saturday', exact: true })).toBeVisible();
    // The sheet slides in: measure every cell in one frame so rows compare consistently.
    const boxes = await page.evaluate(
      (labels) =>
        labels.map((label) => {
          const r = document
            .querySelector(`[role="checkbox"][aria-label="${label}"]`)!
            .getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      names,
    );
    for (const box of boxes) {
      // Mid-slide frames report sub-pixel sizes such as 43.99997; a real 43.5 still fails.
      expect(box.width).toBeGreaterThanOrEqual(43.9);
      expect(box.height).toBeGreaterThanOrEqual(43.9);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const apart =
          a.x + a.width <= b.x + 0.5 ||
          b.x + b.width <= a.x + 0.5 ||
          a.y + a.height <= b.y + 0.5 ||
          b.y + b.height <= a.y + 0.5;
        expect(apart).toBe(true);
      }
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(rows);
    // A long sheet stays on screen: its Close control is reachable, not pushed above the top.
    const close = (await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
    expect(close.y).toBeGreaterThanOrEqual(0);
    const friday = page.getByRole('checkbox', { name: 'Friday', exact: true });
    await friday.click();
    await expect(friday).toHaveAttribute('aria-checked', 'true');
  });
