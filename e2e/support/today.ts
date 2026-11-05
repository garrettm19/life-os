import type { Page } from '@playwright/test';

/**
 * Opens Today's folded section, if it is not open already. It reads "More for today" on today and
 * "More for this day" on any other date.
 */
export async function openMore(page: Page) {
  const more = page.getByRole('button', { name: /^More for (today|this day)/ });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}

/** Moves Today to the previous or next day: the steppers sit at the top of More for today. */
export async function stepDay(page: Page, to: 'Previous day' | 'Next day') {
  await openMore(page);
  await page.getByRole('button', { name: to, exact: true }).click();
}
