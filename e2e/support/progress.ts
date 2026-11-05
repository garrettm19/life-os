import { expect, type Locator, type Page } from '@playwright/test';

/** Opens one of Progress's folded sections under This week, if it is not open already. */
export async function openFold(page: Page, title: string) {
  const fold = page.getByRole('button', { name: new RegExp(`^${title}`) });
  await fold.scrollIntoViewIfNeeded();
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
}

/** Chooses a Progress range: 4 weeks to start, 12 weeks and a year one tap away. */
export async function chooseRange(page: Page, label: '4 weeks' | '12 weeks' | '1 year') {
  const radio = page
    .getByRole('radiogroup', { name: 'Time range' })
    .getByRole('radio', { name: label });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** How far you've come, open on Progress right after the charts, scrolled into view. */
export async function showJourney(page: Page) {
  const journey = page.getByTestId('journey');
  await journey.scrollIntoViewIfNeeded();
  await expect(journey).toBeVisible();
  return journey;
}

/** A Progress chart card by its test ID: consistency, weight, strength, study, cardio, jobs… */
export const card = (page: Page, id: string) => page.getByTestId(`card-${id}`);

/** A chart's one accessible element: VoiceOver's adjustable, the browser's slider. */
export const chartSlider = (chart: Locator) => chart.getByRole('slider');

/**
 * Steps a chart to the point whose reading contains `value`, the way the keyboard (and VoiceOver's
 * swipes) do: from the latest point, one position back at a time.
 */
export async function stepTo(chart: Locator, value: string) {
  const slider = chartSlider(chart);
  await slider.focus();
  await slider.press('End');
  for (let i = 0; i < 60; i++) {
    if ((await slider.getAttribute('aria-valuetext'))?.includes(value)) return;
    await slider.press('ArrowLeft');
  }
  throw new Error(`No point of the chart reads ${value}`);
}

/**
 * Presses on a chart's plot at a share of its width (0 is the left edge, 1 the right), optionally
 * dragging to another share, and lets go: the touch readout follows the nearest position.
 */
export async function touchChart(page: Page, chart: Locator, from: number, to = from) {
  const scrub = chart.getByTestId('chart-scrub');
  await scrub.scrollIntoViewIfNeeded();
  const box = (await scrub.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  if (to !== from) await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
  await page.mouse.up();
}
