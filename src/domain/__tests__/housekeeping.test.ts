import { describe, expect, it } from '@jest/globals';
import { MAX_BACKUP_BYTES } from '../backup';
import { withDay } from '../data';
import { backupSizeWarning, housekeepingLine, weeklyReviewDue } from '../housekeeping';
import { Routine, State, emptyState, shiftDate } from '../model';
import { ensureChecklistDay, setStatus } from '../planner';
import { saveWeeklyReview } from '../weekly-reviews';

// The week of Monday, November 2, 2026, with synthetic records. Local clocks only.
const WEEK = '2026-11-02';
const SUNDAY = '2026-11-08';
const at = (date: string, hour: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour);
};

function routine(id: string, weekdays: number[], extra: Partial<Routine> = {}): Routine {
  return {
    id,
    title: `Example ${id}`,
    duration: null,
    weekdays,
    preferredStart: null,
    enabled: true,
    fixed: false,
    steps: [],
    bundledInto: null,
    checklist: true,
    ...extra,
  };
}

/** A daily habit done on the first `days` days of the week, and a money review each Sunday. */
function week(days: number, moneyDone = true): State {
  let state: State = {
    ...emptyState(),
    source: 'personal',
    programs: [
      {
        id: 'example',
        title: 'Example',
        group: 'Daily',
        goalIds: [],
        routines: [
          routine('habit', [0, 1, 2, 3, 4, 5, 6]),
          routine('money', [0], { capture: 'money' }),
        ],
      },
    ],
  };
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(WEEK, i);
    let day = ensureChecklistDay(
      date,
      state.settings,
      state.programs,
      undefined,
      at(date, 8).toISOString(),
    );
    const habit = day.blocks.find((b) => b.routineId === 'habit')!;
    if (i < days) day = setStatus(day, habit.id, 'done', at(date, 9).toISOString());
    const money = day.blocks.find((b) => b.routineId === 'money');
    if (money && moneyDone) day = setStatus(day, money.id, 'done', at(date, 10).toISOString());
    state = withDay(state, day);
  }
  return state;
}

describe('weekly review due', () => {
  it('asks from Sunday 3 PM for the week ending, and on Monday for the week just ended', () => {
    expect(weeklyReviewDue(week(5), at(SUNDAY, 14))).toBeNull();
    expect(weeklyReviewDue(week(5), at(SUNDAY, 15))).toBe(WEEK);
    expect(weeklyReviewDue(week(5), at('2026-11-09', 8))).toBe(WEEK);
    expect(weeklyReviewDue(week(5), at('2026-11-10', 8))).toBeNull();
    expect(weeklyReviewDue(week(5), at('2026-11-07', 18))).toBeNull();
  });

  it('never for a reviewed week, the demo, a thin week or beside an open money review', () => {
    const reviewed = saveWeeklyReview(
      week(5),
      {
        weekStart: WEEK,
        obstacle: '',
        adjustment: '',
        noChange: true,
      },
      'review-1',
      at(SUNDAY, 16).toISOString(),
    );
    expect(weeklyReviewDue(reviewed, at(SUNDAY, 16))).toBeNull();
    expect(weeklyReviewDue({ ...week(5), source: 'demo' }, at(SUNDAY, 16))).toBeNull();
    // Three habit days and Sunday's money review make four recorded days; two and the review, three.
    expect(weeklyReviewDue(week(2), at(SUNDAY, 16))).toBeNull();
    expect(weeklyReviewDue(week(3), at(SUNDAY, 16))).toBe(WEEK);
    // Sunday's money review is still open: it comes first, and the two never stack.
    expect(weeklyReviewDue(week(5, false), at(SUNDAY, 16))).toBeNull();
  });
});

describe('the one housekeeping line', () => {
  it('warns about the backup size above 70% of the limit only', () => {
    expect(backupSizeWarning(null)).toBe(false);
    expect(backupSizeWarning(MAX_BACKUP_BYTES * 0.7)).toBe(false);
    expect(backupSizeWarning(MAX_BACKUP_BYTES * 0.7 + 1)).toBe(true);
  });

  it('shows at most one line: the review, then a backup, then the size', () => {
    // A full week recorded: enough for the backup reminder too.
    const state = week(7);
    const big = MAX_BACKUP_BYTES * 0.8;
    // No backup yet and a review due: the review goes first.
    expect(housekeepingLine(state, at(SUNDAY, 16), big)).toMatchObject({ kind: 'review' });
    expect(housekeepingLine(state, at('2026-11-10', 9), big)).toMatchObject({ kind: 'backup' });
    const backedUp = {
      ...state,
      settings: { ...state.settings, lastBackupAt: at('2026-11-10', 8).toISOString() },
    };
    expect(housekeepingLine(backedUp, at('2026-11-10', 9), big)).toEqual({
      kind: 'size',
      text: 'Your backup is 80% of its 20 MB limit ›',
    });
    expect(housekeepingLine(backedUp, at('2026-11-10', 9), null)).toBeNull();
  });
});
