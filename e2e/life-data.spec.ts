import { test, expect } from '@playwright/test';
import { dateObject, displayDate, localDate, shiftDate, shortDate } from '../src/domain/model';
import { trainingState } from '../src/test-support/fixtures';
import { toGrams } from '../src/domain/records';
import { nextMonday } from './support/dates';
import { chooseBackup } from './support/files';
import { card, openFold } from './support/progress';
import {
  failSaves,
  restoreSaves,
  SAVE_FAILED_TEXT,
  saved,
  savedText,
  seed,
  writeState,
} from './support/storage';
import { openMore, stepDay } from './support/today';

// The next Monday after the real date keeps every objective in the future.
const realToday = localDate();
const MON = nextMonday();
const TUE = shiftDate(MON, 1);
const FRI = shiftDate(MON, 4);

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('a workout opens its plan, keeps partial sets, and finishes only on a successful save', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await expect(page.getByText('Bench press', { exact: true })).toBeVisible();
  await expect(page.getByText('No earlier session').first()).toBeVisible();
  await page.getByRole('button', { name: 'Log Bench press set 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Bench press set 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('In progress · 1 of 6 sets')).toBeVisible();
  // Partial progress survives a restart and is not a completed workout.
  await page.reload();
  const blockId = `${MON}:routine:upper`;
  let state = await saved(page);
  expect(state.workoutSessions[0]).toMatchObject({ occurrenceId: blockId, status: 'active' });
  expect(state.days[MON].blocks.find((b) => b.id === blockId)!.status).toBe('planned');
  await page.getByRole('button', { name: /^Open Upper body/ }).click();
  await page.getByRole('button', { name: 'Log Bench press set 2', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Bench press set 2', exact: true }),
  ).toBeVisible();
  // A failed Finish leaves the objective planned, the session active and no Day Cleared.
  const before = JSON.stringify(await saved(page));
  await failSaves(page, 'Synthetic finish failure');
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page.getByText(SAVE_FAILED_TEXT).first()).toBeVisible();
  expect(JSON.stringify(await saved(page))).toBe(before);
  await expect(page.getByText('Day cleared', { exact: true })).toHaveCount(0);
  await restoreSaves(page);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Upper body', exact: true })).toBeVisible();
  state = await saved(page);
  expect(state.days[MON].blocks.find((b) => b.id === blockId)!.status).toBe('done');
  expect(state.workoutSessions[0].status).toBe('completed');
  await page.screenshot({ path: 'test-results/life-data-workout-done.png' });
  // The next session shows what was done last time.
  await page.goto('/?date=' + FRI);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await expect(page.getByText(/: 135 lb × 8, 8$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/life-data-workout-previous.png' });
});

test('moving a workout previews the sequence, then moves it and keeps it moved', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: /^Open Upper body/ }).click();
  await page
    .getByRole('button', {
      name: 'Move this and later workouts in the next 7 days +1 day',
      exact: true,
    })
    .click();
  await expect(page.getByRole('button', { name: 'Move 3 workouts', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/life-data-shift-preview.png' });
  await page.getByRole('button', { name: 'Move 3 workouts', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open Upper body/ })).toHaveCount(0);
  await page.reload();
  const state = await saved(page);
  expect(state.days[MON].moved).toEqual([expect.objectContaining({ routineId: 'upper', to: TUE })]);
  expect(state.days[TUE].blocks.find((b) => b.routineId === 'upper')).toMatchObject({
    id: `${MON}:routine:upper`,
    movedFrom: MON,
  });
  await stepDay(page, 'Next day');
  await expect(page.getByText('2 exercises · moved from Mon', { exact: true })).toBeVisible();
  // Reopening Monday never brings the workout back.
  await stepDay(page, 'Previous day');
  await expect(page.getByRole('button', { name: /^Open Upper body/ })).toHaveCount(0);
});

test('weekly weight and money reviews complete their objectives and show real change in Progress', async ({
  page,
}) => {
  const state = trainingState();
  // Recorded today: a weight or review can never be dated in the future.
  const DAY = realToday;
  for (const routine of state.programs[1].routines) routine.weekdays = [dateObject(DAY).getDay()];
  state.moneyReviews = [
    {
      id: 'previous',
      date: shiftDate(DAY, -7),
      at: '2026-01-01T12:00:00.000Z',
      currency: 'USD',
      cash: null,
      savings: 250000,
      debt: 400000,
      upcoming: null,
      contributed: null,
      savingsTarget: null,
      nextAction: '',
      note: '',
      goalId: null,
      occurrenceId: null,
    },
  ];
  await seed(page, state);
  await page.goto('/?date=' + DAY);
  await page.getByRole('button', { name: 'Record Weekly weigh-in', exact: true }).click();
  await page.getByLabel('Weight in lb', { exact: true }).fill('180.4');
  await page.screenshot({ path: 'test-results/life-data-weight.png' });
  await page.getByRole('button', { name: 'Save weight', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo Weekly weigh-in', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Record Money review', exact: true }).click();
  await page.getByLabel('Total savings ($)', { exact: true }).fill('2700');
  await page.getByLabel('Total debt ($)', { exact: true }).fill('3,850');
  await page
    .getByLabel("This week's priority (optional)", { exact: true })
    .fill('Synthetic action');
  await page.screenshot({ path: 'test-results/life-data-money.png' });
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo Money review', exact: true })).toBeVisible();
  await page.reload();
  const after = await saved(page);
  expect(after.measurements).toEqual([
    expect.objectContaining({ grams: 81828, entered: { value: 180.4, unit: 'lb' }, date: DAY }),
  ]);
  expect(after.moneyReviews.at(-1)).toMatchObject({ savings: 270000, debt: 385000, cash: null });
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  // Both changes since the check-in before, debt first, in one sentence.
  await expect(
    card(page, 'money').getByText(
      `Debt down $150.00 and savings up $200.00 since ${shortDate(shiftDate(DAY, -7))}`,
      { exact: true },
    ),
  ).toBeVisible();
  // One weigh-in is a figure, not a chart.
  await expect(card(page, 'weight').getByText(`180.4 lb on ${shortDate(DAY)}`)).toBeVisible();
  await expect(card(page, 'weight').getByTestId('chart')).toHaveCount(0);
  // Cash was not reported: the check-in lists only what was, never a zero.
  await openFold(page, 'Money check-ins');
  await expect(
    page.getByRole('button', { name: `Edit money check-in for ${displayDate(DAY)}` }),
  ).toContainText('Debt $3,850.00 · Savings $2,700.00');
  await expect(
    page.getByRole('button', { name: `Edit money check-in for ${displayDate(DAY)}` }),
  ).not.toContainText('Cash');
  await page.screenshot({ path: 'test-results/life-data-review.png', fullPage: true });
});

test('the life log adds, edits and deletes entries without touching objectives', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await openMore(page);
  // MON is always a later day, so the log button names this day rather than today.
  await page.getByRole('button', { name: "Add to this day's log", exact: true }).click();
  await page.getByLabel('What happened?', { exact: true }).fill('Synthetic productive session');
  await page.getByRole('button', { name: 'Save to log', exact: true }).click();
  await expect(page.getByText('Synthetic productive session', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit log entry: Synthetic productive session' }).click();
  await page.getByLabel('What happened?', { exact: true }).fill('Synthetic edited session');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByText('Synthetic edited session', { exact: true })).toBeVisible();
  let state = await saved(page);
  expect(state.lifeLog).toHaveLength(1);
  expect(state.days[MON].blocks.every((b) => b.status === 'planned')).toBe(true);
  await page.getByRole('button', { name: 'Edit log entry: Synthetic edited session' }).click();
  await page.getByRole('button', { name: 'Delete this entry', exact: true }).click();
  await expect(page.getByText('Synthetic edited session', { exact: true })).toHaveCount(0);
  state = await saved(page);
  expect(state.lifeLog).toEqual([]);
});

test('Programs can turn a new habit into a workout and build its plan', async ({ page }) => {
  await page.goto('/programs');
  await page.getByRole('button', { name: 'Add objective', exact: true }).click();
  await page.getByRole('radio', { name: 'Strength workout', exact: true }).click();
  await page.getByLabel('Routine name', { exact: true }).fill('Example circuit');
  await page.getByLabel('Program name', { exact: true }).fill('Example training');
  await page.getByRole('button', { name: 'Every day', exact: true }).click();
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByLabel('Workout name', { exact: true })).toBeVisible();
  await page.getByLabel('Exercise name', { exact: true }).fill('Example push-up');
  await page.getByRole('button', { name: 'Save workout plan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit workout plan for Example circuit' }),
  ).toBeVisible();
  const state = await saved(page);
  expect(state.workoutTemplates).toEqual([
    expect.objectContaining({
      title: 'Example circuit',
      exercises: [expect.objectContaining({ name: 'Example push-up', sets: 3, repsMin: 8 })],
    }),
  ]);
});

test('a load typed on one set carries to the next, so each later set is one tap', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await page.getByLabel('Bench press set 1 load in lb', { exact: true }).fill('142.5');
  await page.getByLabel('Bench press set 1 reps', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Log Bench press set 1', exact: true }).click();
  // No earlier session: set 2 now suggests what set 1 logged, before the plan's own load.
  const load2 = page.getByLabel('Bench press set 2 load in lb', { exact: true });
  await expect(load2).toHaveAttribute('placeholder', '142.5');
  await expect(page.getByLabel('Bench press set 2 reps', { exact: true })).toHaveAttribute(
    'placeholder',
    '6',
  );
  await page.getByRole('button', { name: 'Log Bench press set 2', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).workoutSessions[0]?.exercises[0].sets[1])
    .toMatchObject({ done: true, load: 142.5, reps: 6 });
});

test('quick successive set taps all persist', async ({ page }) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  // No waiting between taps: each save applies its own edit to the latest saved session.
  await page.getByRole('button', { name: 'Log Bench press set 1', exact: true }).click();
  await page.getByRole('button', { name: 'Log Bench press set 2', exact: true }).click();
  await page.getByRole('button', { name: 'Log Bench press set 3', exact: true }).click();
  await expect(page.getByText('3 of 6 sets', { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await saved(page)).workoutSessions[0]?.exercises[0].sets.filter((s) => s.done).length,
    )
    .toBe(3);
  await page.reload();
  await expect(page.getByText('In progress · 3 of 6 sets')).toBeVisible();
});

test('logged sets replace Done without a log, and an unfinished log can be finished later', async ({
  page,
}) => {
  await seed(page, trainingState());
  await page.goto('/?date=' + MON);
  await page.getByRole('button', { name: 'Start Upper body', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Mark Upper body done without logging sets/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Log Bench press set 1', exact: true }).click();
  await expect(page.getByText(/1 logged set is saved/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Mark Upper body done without logging sets/ }),
  ).toHaveCount(0);
  // Stored data where the objective is Done while its workout log with sets is still open.
  const state = await saved(page);
  const blockId = `${MON}:routine:upper`;
  state.days[MON].blocks = state.days[MON].blocks.map((b) =>
    b.id === blockId ? { ...b, status: 'done', actualAt: '2026-01-01T12:00:00.000Z' } : b,
  );
  await writeState(page, state);
  await page.goto('/?date=' + MON);
  await expect(page.getByText('Done · workout log not finished')).toBeVisible();
  await page.getByRole('button', { name: /^Open Upper body/ }).click();
  await expect(page.getByText(/its workout log was never finished/)).toBeVisible();
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await expect(page.getByText('Done · workout log not finished')).toHaveCount(0);
  const after = await saved(page);
  expect(after.workoutSessions[0].status).toBe('completed');
  expect(after.workoutSessions[0].exercises[0].sets.filter((s) => s.done)).toHaveLength(1);
});

test('deleting a weight that completed a weigh-in asks what happens to the weigh-in', async ({
  page,
}) => {
  const state = trainingState();
  for (const routine of state.programs[1].routines)
    routine.weekdays = [dateObject(realToday).getDay()];
  await seed(page, state);
  await page.goto('/?date=' + realToday);
  await page.getByRole('button', { name: 'Record Weekly weigh-in', exact: true }).click();
  await page.getByLabel('Weight in lb', { exact: true }).fill('180.4');
  await page.getByRole('button', { name: 'Save weight', exact: true }).click();
  await page.getByRole('button', { name: /^Open Weekly weigh-in/ }).click();
  await expect(
    page.getByRole('button', { name: 'Delete weight and undo the weigh-in', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete weight, keep weigh-in done', exact: true })
    .click();
  await expect(page.getByText('Done · no measurement')).toBeVisible();
  const after = await saved(page);
  expect(after.measurements).toEqual([]);
  expect(after.days[realToday].blocks.find((b) => b.routineId === 'weigh-in')!.status).toBe('done');
});

test('restoring an older backup warns which records would be removed, and Close changes nothing', async ({
  page,
}) => {
  const current = trainingState();
  current.measurements = [
    {
      id: 'w1',
      kind: 'body-weight',
      grams: toGrams(180.4, 'lb'),
      entered: { value: 180.4, unit: 'lb' },
      date: realToday,
      at: '2026-01-01T12:00:00.000Z',
      fasted: true,
      note: '',
      occurrenceId: null,
    },
  ];
  await seed(page, current);
  const before = await savedText(page);
  const older: Record<string, unknown> = {
    ...JSON.parse(JSON.stringify(trainingState())),
    version: 1,
  };
  for (const key of [
    'measurements',
    'lifeLog',
    'workoutTemplates',
    'workoutSessions',
    'moneyReviews',
    'intervalRoutines',
    'intervalSessions',
    'activitySessions',
    'ruleBooks',
    'ruleReviews',
    'focuses',
    'weeklyReviews',
    'skillCheckpoints',
    'tradingSessions',
    'tradingSessionsImported',
  ])
    delete older[key];
  for (const program of older.programs as { routines: Record<string, unknown>[] }[])
    for (const routine of program.routines) delete routine.capture;
  await page.goto('/backup');
  await chooseBackup(
    page,
    JSON.stringify({
      format: 'life-os-backup',
      version: 1,
      createdAt: '2026-01-01T12:00:00.000Z',
      state: older,
    }),
    'older-backup.json',
  );
  await expect(page.getByText(/made by an older version of Life OS/)).toBeVisible();
  await expect(page.getByText('weights: 1 removed (you have 1)', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/life-data-restore-warning.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await savedText(page)).toBe(before);
});
