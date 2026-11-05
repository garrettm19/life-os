import { describe, expect, it } from '@jest/globals';
import { demoState } from '../demo';
import { DEMO } from '../demo-catalog';
import { defaultReviewDate, endFocus, startFocus } from '../focus';
import { State, weekStartOf } from '../model';
import { dayOutcome } from '../objectives';
import {
  deleteWeeklyReview,
  lastAdjustment,
  pastReviews,
  reviewFor,
  saveWeeklyReview,
} from '../weekly-reviews';

// Synthetic: the fictional demo's history as a device; "now" is Monday, November 9, 2026.
const TODAY = '2026-11-09';
const at = (d: number, h = 19) => new Date(2026, 10, d, h).toISOString();
const base = (): State => ({
  ...demoState(TODAY),
  source: 'personal',
  focuses: [],
  weeklyReviews: [],
  skillCheckpoints: [],
});
const withFocus = (s: State) =>
  startFocus(
    s,
    {
      title: 'Interview readiness',
      goalId: null,
      outcome: '',
      evidence: 'career',
      routineIds: [DEMO.study],
      leadRoutineId: null,
      cue: '',
      baseline: '',
      target: '',
      reviewDate: defaultReviewDate(TODAY),
    },
    'f1',
    at(9, 8),
  );
const input = (weekStart: string, extra: object = {}) => ({
  weekStart,
  obstacle: 'Late evenings at work',
  adjustment: 'Study before dinner',
  noChange: false,
  ...extra,
});

describe('weekly course correction', () => {
  it('names weeks by their Monday, across daylight saving and year ends', () => {
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('keeps one review per week; a correction keeps its first save and focus', () => {
    let s = withFocus(base());
    s = saveWeeklyReview(s, input('2026-11-09'), 'w1', at(9));
    s = endFocus(s, 'f1', 'archived', at(9, 20));
    s = saveWeeklyReview(s, input('2026-11-09', { adjustment: 'Study at lunch' }), 'w2', at(9, 21));
    expect(s.weeklyReviews).toHaveLength(1);
    expect(reviewFor(s, '2026-11-09')).toMatchObject({
      id: 'w1',
      focusId: 'f1',
      adjustment: 'Study at lunch',
      at: at(9),
      updatedAt: at(9, 21),
    });
  });

  it('records "no adjustment needed" explicitly, and refuses an empty review and a future week', () => {
    let s = base();
    s = saveWeeklyReview(
      s,
      input('2026-11-02', { obstacle: '', adjustment: 'ignored', noChange: true }),
      'w1',
      at(9),
    );
    expect(reviewFor(s, '2026-11-02')).toMatchObject({
      noChange: true,
      adjustment: '',
      focusId: null,
    });
    expect(() =>
      saveWeeklyReview(s, input('2026-11-09', { obstacle: '', adjustment: '' }), 'w2', at(9)),
    ).toThrow(/No adjustment needed/);
    expect(() => saveWeeklyReview(s, input('2026-11-16'), 'w2', at(9))).toThrow(
      /once it has started/,
    );
    expect(() => saveWeeklyReview(s, input('2026-11-10'), 'w2', at(9))).toThrow(/Monday/);
  });

  it('edits a past week without touching anything recorded, and never blocks Day Cleared', () => {
    const before = base();
    let s = saveWeeklyReview(before, input('2026-10-26'), 'w1', at(9));
    s = saveWeeklyReview(s, input('2026-11-02', { obstacle: 'Travel' }), 'w2', at(9));
    s = saveWeeklyReview(
      s,
      input('2026-10-26', { adjustment: 'Lay out the gym bag' }),
      'w3',
      at(9, 20),
    );
    expect({ ...s, weeklyReviews: [] }).toEqual(before);
    expect(pastReviews(s).map((r) => r.weekStart)).toEqual(['2026-11-02', '2026-10-26']);
    expect(lastAdjustment(s, '2026-11-09')?.adjustment).toBe('Study before dinner');
    for (const date of Object.keys(before.days))
      expect(dayOutcome(s, date)).toBe(dayOutcome(before, date));
    expect(deleteWeeklyReview(s, '2026-10-26').weeklyReviews.map((r) => r.id)).toEqual(['w2']);
  });
});

describe('weekly review focus link', () => {
  it('links the focus active during the week reviewed, not the one active now', () => {
    let s = withFocus(base());
    // f1 ran from Nov 9; it is replaced by f2 the same day, then last week's review is written.
    s = startFocus(
      s,
      { ...s.focuses[0], title: 'Save for a trip', evidence: 'money', routineIds: [] },
      'f2',
      at(9, 21),
      { replace: true },
    );
    s = saveWeeklyReview(s, input('2026-11-02'), 'w1', at(9, 22));
    // Neither focus existed in the week of Nov 2.
    expect(reviewFor(s, '2026-11-02')?.focusId).toBeNull();
    s = saveWeeklyReview(s, input('2026-11-09'), 'w2', at(9, 22));
    expect(reviewFor(s, '2026-11-09')?.focusId).toBe('f2');
  });
});
