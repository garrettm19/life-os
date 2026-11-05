import { test, expect } from '@playwright/test';
import { displayDate } from '../src/domain/model';
import { nextMonday } from './support/dates';
import { importSetup } from './support/files';
import { failSaves, restoreSaves, SAVE_FAILED_TEXT, savedText } from './support/storage';
import { openMore } from './support/today';

// Day Cleared from synthetic setup files: every due objective done clears the day, a skipped one
// is excused, and a day of only skips, a failed save or a timed session not yet on the board
// does not clear. The date is the next Monday after the real date, so it is due and still ahead.
const date = nextMonday();
/** The settings both setup files carry: a 9:00 to 23:00 day with no work or travel times. */
const SETTINGS = {
  wake: 540,
  bedtime: 1380,
  workStart: null,
  workEnd: null,
  scrumStart: null,
  scrumDuration: null,
  thursdayMeetingStart: null,
  thursdayMeetingDuration: null,
  gymTravel: null,
  eveningWorkMinutes: null,
};

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

test('opening Today creates due checklist items without generating timed work', async ({
  page,
}) => {
  const setup = {
    format: 'life-os-setup-v1',
    goals: [
      {
        id: 'example',
        title: 'Example goal',
        desiredState: 'A synthetic target',
      },
    ],
    programs: [
      {
        id: 'example-habit',
        title: 'Example habit program',
        group: 'Daily',
        goalIds: ['example'],
        routines: [
          {
            id: 'example-habit-1',
            title: 'Example morning habit',
            duration: null,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            preferredStart: null,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            checklist: true,
          },
        ],
      },
      {
        id: 'example-timed',
        title: 'Example timed program',
        group: 'Training',
        goalIds: ['example'],
        routines: [
          {
            id: 'example-timed-1',
            title: 'Example timed session',
            duration: 30,
            weekdays: [1],
            preferredStart: 720,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
          },
        ],
      },
    ],
    settings: SETTINGS,
    notes: ['Synthetic checklist used for automated checks.'],
  };
  await importSetup(page, setup, 'example-checklist-setup.json');
  await page.goto('/?date=' + date);
  await expect(page.getByTestId('row:Example morning habit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Example timed session' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Example morning habit done', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toHaveCount(0);
  // Said plainly, never as an error: what is missing and the one tap that places it.
  await expect(
    page.getByText(/Example timed session is due and not on the list yet/),
  ).toBeVisible();
  // The completion is kept: its row offers Undo.
  await expect(
    page.getByRole('button', { name: 'Undo Example morning habit', exact: true }),
  ).toBeVisible();
  // A blocked day earns no streak credit, on the board or in the streak sheet.
  await expect(page.getByRole('button', { name: /1-day streak/ })).toHaveCount(0);
  // The streak and its details sit in More, beside the day's date.
  await openMore(page);
  await expect(page.getByText('No streak yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Streak details/ }).click();
  // The test date is ahead of the real clock, so the blocked day is held as Upcoming.
  await expect(page.getByLabel(`${displayDate(date)}: Upcoming`, { exact: true })).toBeVisible();
  await expect(page.getByText('Cleared', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/is due and not on the list yet/)).toBeVisible();
  await openMore(page);
  await page.getByRole('button', { name: 'Generate day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Example timed session' })).toBeVisible();
  // Generating the day keeps the completion.
  await expect(
    page.getByRole('button', { name: 'Undo Example morning habit', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/is due and not on the list yet/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/day-cleared-open-and-act.png' });
  await page.getByRole('button', { name: 'Mark Example timed session done', exact: true }).click();
  await expect(page.getByText('Day cleared', { exact: true })).toBeVisible();
  // The cleared panel's streak, and the same one in the More for today opened above.
  await expect(page.getByRole('button', { name: /1-day streak/ })).toHaveCount(2);
});

test('completing every due objective clears the day; a skip is excused, a day of only skips is not cleared', async ({
  page,
}) => {
  const setup = {
    format: 'life-os-setup-v1',
    goals: [
      {
        id: 'example',
        title: 'Example goal',
        desiredState: 'A synthetic target',
      },
    ],
    programs: [
      {
        id: 'example-objectives',
        title: 'Example objectives',
        group: 'Daily',
        goalIds: ['example'],
        routines: [
          {
            id: 'example-one',
            title: 'Example first objective',
            duration: null,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            preferredStart: null,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            checklist: true,
          },
          {
            id: 'example-two',
            title: 'Example second objective',
            duration: null,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            preferredStart: null,
            enabled: true,
            fixed: false,
            steps: [],
            bundledInto: null,
            checklist: true,
          },
        ],
      },
    ],
    settings: SETTINGS,
    notes: ['Synthetic objectives used for automated checks.'],
  };
  await importSetup(page, setup, 'example-objectives-setup.json');
  await page.goto('/?date=' + date);
  await expect(page.getByTestId('row:Example first objective')).toBeVisible();
  await expect(page.getByLabel(/0 of 2 objectives complete/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark Example first objective done', exact: true })
    .click();
  await expect(page.getByLabel(/1 of 2 objectives complete/)).toBeVisible();
  await expect(page.getByText('Day cleared')).toHaveCount(0);
  // A failed save on the clearing action must not show Day cleared or advance the streak.
  const before = await savedText(page);
  await failSaves(page, 'Synthetic objective save failure');
  const second = page.getByRole('button', {
    name: 'Mark Example second objective done',
    exact: true,
  });
  await second.click();
  await expect(page.getByText(SAVE_FAILED_TEXT, { exact: true })).toBeVisible();
  await expect(page.getByText('Day cleared')).toHaveCount(0);
  await expect(page.getByLabel(/1 of 2 objectives complete/)).toBeVisible();
  await expect(page.getByRole('button', { name: /1-day streak/ })).toHaveCount(0);
  await expect(second).toBeVisible();
  expect(await savedText(page)).toBe(before);
  await restoreSaves(page);
  await second.click();
  await expect(page.getByText('Day cleared')).toBeVisible();
  await expect(page.getByLabel(/2 of 2 objectives complete/)).toBeVisible();
  await expect(page.getByRole('button', { name: /1-day streak/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/day-cleared.png' });
  // Reopening a day that is already cleared shows it settled; the reveal is only for a live clear.
  await page.reload();
  const cleared = page.getByText('Day cleared', { exact: true });
  await expect(cleared).toBeVisible();
  expect(
    await cleared.evaluate((element) => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    }),
  ).toBe(1);
  await page.getByRole('button', { name: 'Undo Example first objective', exact: true }).click();
  await expect(page.getByText('Day cleared')).toHaveCount(0);
  await expect(page.getByLabel(/1 of 2 objectives complete/)).toBeVisible();
  await page.getByRole('button', { name: 'Skip Example first objective', exact: true }).click();
  // The skip is excused, never done: the other objective done clears the day, one of one.
  await expect(page.getByText('Day cleared')).toBeVisible();
  await expect(page.getByLabel(/1 of 1 objectives complete/)).toBeVisible();
  await expect(page.getByText(/undo the skip/i)).toHaveCount(0);
  // With everything skipped nothing was done, so the day is not cleared.
  await page.getByRole('button', { name: 'Undo Example second objective', exact: true }).click();
  await page.getByRole('button', { name: 'Skip Example second objective', exact: true }).click();
  await expect(page.getByText('Day cleared')).toHaveCount(0);
  await expect(page.getByText('All skipped · not cleared', { exact: true })).toBeVisible();
});
