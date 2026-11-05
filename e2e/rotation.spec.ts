import { test, expect } from '@playwright/test';
import type { State } from '../src/domain/model';
import { withDay } from '../src/domain/data';
import { generateDay } from '../src/domain/planner';
import { trainingState } from '../src/test-support/fixtures';
import { saveSession, sessionFor, startSession } from '../src/domain/workouts';
import { setRotation } from '../src/domain/rotation';
import { saved, seed } from './support/storage';

// Synthetic data only: the fixture's Upper and Lower body workouts plus a home routine that follows
// Upper body. The browser clock is pinned to a Monday so the rotation's "today" is known.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const at = (day: number) => new Date(2026, 10, day, 12);

function seedState(): State {
  const base = trainingState();
  return {
    ...base,
    programs: base.programs.map((p) =>
      p.id === 'training'
        ? {
            ...p,
            routines: [
              ...p.routines,
              {
                id: 'neck',
                title: 'Home neck routine',
                duration: null,
                weekdays: [],
                preferredStart: null,
                enabled: true,
                fixed: false,
                steps: [],
                bundledInto: null,
                checklist: true,
                follows: ['upper'],
              },
            ],
          }
        : p,
    ),
  };
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a rotation places one workout a day with its companion, rests without advancing, and projects the week', async ({
  page,
}) => {
  await seed(page, seedState(), { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await expect(page.getByText('1. Upper body')).toBeVisible();
  await expect(page.getByText('2. Lower body')).toBeVisible();
  await page.getByRole('button', { name: 'Start rotation', exact: true }).click();
  let state = await saved(page);
  expect(state.programs.find((p) => p.id === 'training')!.rotation).toMatchObject({
    order: ['upper', 'lower'],
    restDays: [0],
    startWith: null,
  });
  // Monday: the first workout and the routine that follows it.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Lower body', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Upper body done without logging sets' }).click();
  // The companion is its own objective: still open.
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toBeVisible();
  // Tuesday: the next workout, no companion.
  await page.clock.setFixedTime(at(10));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Lower body', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Home neck routine done' })).toHaveCount(0);
  // Rest today: the workout leaves, and stays next. It keeps its place as a quiet row saying it
  // moved to the next training day, with Undo.
  await page.getByRole('button', { name: 'Start Lower body', exact: true }).click();
  await page.getByRole('button', { name: /^Rest today; Lower body stays next/ }).click();
  const rested = page.getByTestId('rested:Lower body');
  await expect(rested.getByText('Next training day', { exact: true })).toBeVisible();
  await expect(page.getByTestId('rest-day')).toHaveCount(0);
  const undo = rested.getByRole('button', { name: 'Undo: train Lower body today', exact: true });
  await expect(undo).toHaveCount(2);
  await expect(undo.last()).toHaveText('Undo');
  expect((await undo.last().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  state = await saved(page);
  expect(state.days[TUE].blocks.some((b) => b.routineId === 'lower')).toBe(false);
  expect(state.days[MON].blocks.find((b) => b.routineId === 'upper')!.status).toBe('done');
  await page.screenshot({ path: 'test-results/rotation-rest-day.png' });
  // The week shows what comes next.
  await page.goto('/week');
  await expect(page.getByText('Training rotation · coming days')).toBeVisible();
  await expect(page.getByText('Rest').first()).toBeVisible();
  // Changing your mind: train today after all.
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Undo: train Lower body today', exact: true })
    .last()
    .click();
  await expect(page.getByRole('button', { name: 'Start Lower body', exact: true })).toBeVisible();
  await expect(page.getByTestId('rested:Lower body')).toHaveCount(0);
  // A default rest weekday reads as a rest day, one line with its Train today link.
  await page.clock.setFixedTime(new Date(2026, 10, 15, 12));
  await page.goto('/');
  await expect(page.getByText('Training · rest day · Lower body next')).toBeVisible();
  const note = (await page.getByTestId('rest-day').boundingBox())!;
  expect(note.height).toBeLessThanOrEqual(48);
  const train = page.getByRole('button', { name: 'Train Training today instead of resting' });
  await expect(train).toHaveText('Train today');
  expect((await train.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('turning a rotation off gives each workout its earlier days back after confirming them', async ({
  page,
}) => {
  await seed(page, seedState(), { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await page.getByRole('button', { name: 'Start rotation', exact: true }).click();
  let state = await saved(page);
  const routines = (s: State) => s.programs.find((p) => p.id === 'training')!.routines;
  expect(routines(state).find((r) => r.id === 'upper')!.weekdays).toEqual([]);
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await page.getByRole('button', { name: 'Turn the rotation off', exact: true }).click();
  await expect(page.getByText('Back to weekly days')).toBeVisible();
  await page.getByRole('button', { name: 'Turn off with these days', exact: true }).click();
  state = await saved(page);
  expect(state.programs.find((p) => p.id === 'training')!.rotation).toBeUndefined();
  expect(routines(state).find((r) => r.id === 'upper')!.weekdays).toEqual([1, 5]);
  expect(routines(state).find((r) => r.id === 'lower')!.weekdays).toEqual([3]);
});

test('Week says a past workout that was planned and never done was not done', async ({ page }) => {
  const base = trainingState();
  const monday = generateDay(MON, base.settings, base.programs, undefined, at(9).toISOString());
  await seed(page, withDay(base, monday), { clock: at(10), route: '/week' });
  const card = page.getByRole('link', { name: /^Mon, Nov 9\./ });
  await expect(card.getByText(/Upper body · not done$/)).toBeVisible();
  // Today's and later planned work is not judged.
  await expect(
    page.getByRole('link', { name: /^Tue, Nov 10, today\./ }).getByText(/not done/),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: /^Wed, Nov 11\./ }).getByText(/not done/),
  ).toHaveCount(0);
});

test('a past workout with logged sets says so on Week, and Progress counts it as never finished', async ({
  page,
}) => {
  const base = trainingState();
  const monday = generateDay(MON, base.settings, base.programs, undefined, at(9).toISOString());
  const upper = monday.blocks.find((b) => b.routineId === 'upper')!;
  let state = startSession(withDay(base, monday), MON, upper, at(9).toISOString());
  const session = sessionFor(state, upper.id)!;
  state = saveSession(state, {
    ...session,
    exercises: session.exercises.map((e, i) =>
      i === 0 ? { ...e, sets: [{ load: 100, reps: 5, done: true }] } : e,
    ),
  });
  await seed(page, state, { clock: at(10), route: '/week' });
  await expect(
    page
      .getByRole('link', { name: /^Mon, Nov 9\./ })
      .getByText(/Upper body · sets saved, not finished$/),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByTestId('card-strength').getByTestId('unfinished-workouts')).toHaveText(
    '1 workout log with saved sets was never finished, so it does not count as a finished workout. Open its day on Today to finish it.',
  );
});

/** The rotation already on: Upper body then Lower body, resting on Sundays. */
const rotating = () =>
  setRotation(
    seedState(),
    'training',
    { order: ['upper', 'lower'], restDays: [0], startWith: null },
    at(9).toISOString(),
  );

test('a later training day says which workout is projected for it, as Week does', async ({
  page,
}) => {
  await seed(page, rotating(), { clock: at(9), route: '/' });
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  // Tuesday holds no rotation workout until it is the actual day; Today says what comes.
  await page.goto(`/?date=${TUE}`);
  await expect(page.getByTestId('projected-workout')).toHaveText(
    'Training · Lower body · projected, added on the day',
  );
  await expect(page.getByRole('button', { name: 'Start Lower body', exact: true })).toHaveCount(0);
  // Wednesday's is Upper body, with the routine that follows it.
  await page.goto('/?date=2026-11-11');
  await expect(page.getByTestId('projected-workout')).toHaveText(
    'Training · Upper body + Home neck routine · projected, added on the day',
  );
  // Sunday rests: the rest-day line, no projection. Today itself holds its own workout.
  await page.goto('/?date=2026-11-15');
  await expect(page.getByTestId('rest-day')).toBeVisible();
  await expect(page.getByTestId('projected-workout')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await expect(page.getByTestId('projected-workout')).toHaveCount(0);
});

test('the coming days show what Save places when today becomes a rest day', async ({ page }) => {
  await seed(page, rotating(), { clock: at(9), route: '/' });
  await expect(page.getByRole('button', { name: 'Start Upper body', exact: true })).toBeVisible();
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  const coming = page.getByText(/^(Mon|Tue|Wed), Nov (9|10|11) · /);
  await expect(coming).toHaveText([
    'Mon, Nov 9 · Upper body',
    'Tue, Nov 10 · Lower body',
    'Wed, Nov 11 · Upper body',
  ]);
  await page.getByRole('checkbox', { name: 'Monday', exact: true }).click();
  // Monday rests now: today's Upper body is the workout Save takes off, so it moves to Tuesday.
  await expect(coming).toHaveText([
    'Mon, Nov 9 · Rest',
    'Tue, Nov 10 · Upper body',
    'Wed, Nov 11 · Lower body',
  ]);
  await page.getByRole('button', { name: 'Save rotation', exact: true }).click();
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await expect(coming).toHaveText([
    'Mon, Nov 9 · Rest',
    'Tue, Nov 10 · Upper body',
    'Wed, Nov 11 · Lower body',
  ]);
});

test('turning a rotation off says next to its button which workout still needs days', async ({
  page,
}) => {
  await seed(page, rotating(), { clock: at(9), route: '/programs' });
  await page.getByRole('button', { name: 'Workout rotation for Training', exact: true }).click();
  await page.getByRole('button', { name: 'Turn the rotation off', exact: true }).click();
  await expect(page.getByText('Back to weekly days')).toBeVisible();
  // Lower body had Wednesday before the rotation: without it, it would leave with no days.
  await page.getByRole('checkbox', { name: 'Wednesday', exact: true }).last().click();
  const off = page.getByRole('button', { name: 'Turn off with these days', exact: true });
  await expect(off).toBeDisabled();
  await off.scrollIntoViewIfNeeded();
  await expect(
    page.getByText('Choose days for Lower body first.', { exact: true }),
  ).toBeInViewport();
  expect((await saved(page)).programs.find((p) => p.id === 'training')!.rotation).toBeDefined();
  // Given a day, it turns off.
  await page.getByRole('checkbox', { name: 'Thursday', exact: true }).last().click();
  await expect(off).toBeEnabled();
  await off.click();
  const state = await saved(page);
  expect(state.programs.find((p) => p.id === 'training')!.rotation).toBeUndefined();
  expect(
    state.programs.find((p) => p.id === 'training')!.routines.find((r) => r.id === 'lower')!
      .weekdays,
  ).toEqual([4]);
});
