import { expect, type Page } from '@playwright/test';

/** On Programs, opens every fold that holds paused programs or routines (closed on each visit). */
export async function showPaused(page: Page) {
  const folds = page.getByRole('button', { name: /^(Paused programs|Paused in .+), \d+\. Show$/ });
  await folds.first().waitFor();
  for (let left = await folds.count(); left > 0; left = await folds.count()) {
    const fold = folds.first();
    const name = (await fold.getAttribute('aria-label'))!;
    await fold.click();
    await expect(page.getByRole('button', { name: name.replace(/Show$/, 'Hide') })).toBeVisible();
  }
}
