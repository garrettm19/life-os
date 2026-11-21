import { test, expect } from '@playwright/test';
import { demoState } from '../src/domain/demo';
import { seed } from './support/storage';

// Paused routines and programs wait behind folds on Programs, closed on every visit. Synthetic
// data only: the fictional demo, with its paused trading practice and one routine paused here.

const TODAY = '2026-11-09';

function state() {
  const s = demoState(TODAY);
  const morning = s.programs.find((p) => p.title === 'Morning foundations')!;
  morning.routines[0] = { ...morning.routines[0], enabled: false };
  return { s, paused: morning.routines[0].title };
}

test('paused routines and programs fold away, and the folds close on every visit', async ({
  page,
}) => {
  const { s, paused } = state();
  await seed(page, s, { clock: new Date(2026, 10, 9, 9), route: '/programs' });
  // Nothing paused is in view: not the routine, not the trading practice or its pills.
  await expect(page.getByRole('button', { name: `Configure ${paused}`, exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Trading practice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open My Trading Strategy' })).toHaveCount(0);
  // One fold in the program with the count, named for VoiceOver by its program.
  await page
    .getByRole('button', { name: 'Paused in Morning foundations, 1. Show', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Configure ${paused}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Paused programs, 1. Show', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trading practice', exact: true })).toBeVisible();
  // Its routines show at once inside the fold: they are all paused.
  await expect(page.getByRole('button', { name: 'Open My Trading Strategy' })).toBeVisible();
  // Away and back: both folds are closed again.
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Paused programs, 1. Show', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Paused in Morning foundations, 1. Show', exact: true }),
  ).toBeVisible();
  // A search shows every match, paused or not.
  await page.getByLabel('Find a program').fill('trading');
  await expect(page.getByRole('heading', { name: 'Trading practice', exact: true })).toBeVisible();
});
