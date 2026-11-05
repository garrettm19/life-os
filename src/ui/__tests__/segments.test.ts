import { describe, expect, it } from '@jest/globals';
import type { DayProgress } from '../../domain/objectives';
import { callout, progressLabel, SEGMENT_LIMIT, segmentStates } from '../segments';

function progress(over: Partial<DayProgress>): DayProgress {
  return {
    done: 0,
    total: 0,
    skipped: 0,
    remaining: 0,
    missingTimed: 0,
    missingTimedTitles: [],
    cleared: false,
    protected: false,
    ...over,
  };
}

describe('segmentStates', () => {
  it('orders done, the active objective, then open; a skipped objective has no segment', () => {
    // A skip is excused, so it is not in the total and takes no segment.
    expect(segmentStates(progress({ done: 2, skipped: 1, remaining: 3, total: 5 }), true)).toEqual([
      'done',
      'done',
      'active',
      'open',
      'open',
    ]);
  });

  it('shows no active segment when nothing is in progress', () => {
    expect(segmentStates(progress({ done: 1, remaining: 2, total: 3 }), false)).toEqual([
      'done',
      'open',
      'open',
    ]);
  });

  it('never marks a segment active once nothing remains', () => {
    expect(segmentStates(progress({ done: 1, skipped: 1, remaining: 0, total: 1 }), true)).toEqual([
      'done',
    ]);
  });

  it('has exactly one segment per objective, including timed sessions not yet on the board', () => {
    const states = segmentStates(
      progress({ done: 1, remaining: 2, missingTimed: 1, total: 3 }),
      true,
    );
    expect(states).toEqual(['done', 'active', 'open']);
  });

  it('falls back to a continuous bar for very long days', () => {
    expect(
      segmentStates(progress({ total: SEGMENT_LIMIT, remaining: SEGMENT_LIMIT }), false),
    ).toHaveLength(SEGMENT_LIMIT);
    expect(
      segmentStates(progress({ total: SEGMENT_LIMIT + 1, remaining: SEGMENT_LIMIT + 1 }), false),
    ).toBeNull();
  });

  it('is all done when the day is cleared', () => {
    expect(segmentStates(progress({ done: 3, total: 3, cleared: true }), true)).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});

describe('callout', () => {
  it('counts what is left to clear the day', () => {
    expect(callout(progress({ done: 1, remaining: 6, total: 7 }))).toEqual({
      text: '6 to clear the day',
      tone: 'text',
    });
    expect(callout(progress({ done: 0, remaining: 2, total: 2 }))).toEqual({
      text: '2 to clear the day',
      tone: 'text',
    });
  });

  it('says how close the day is: halfway, then the last one', () => {
    expect(callout(progress({ done: 4, remaining: 3, total: 7 }))).toEqual({
      text: 'Halfway there · 3 to go',
      tone: 'text',
    });
    expect(callout(progress({ done: 6, remaining: 1, total: 7 }))).toEqual({
      text: 'One more to clear the day',
      tone: 'text',
    });
  });

  it('explains a day that only waits on timed sessions missing from the board', () => {
    expect(callout(progress({ done: 1, remaining: 1, missingTimed: 1, total: 2 }))).toEqual({
      text: 'Not on the list yet',
      tone: 'now',
    });
  });

  it('says a day with everything skipped is not cleared', () => {
    expect(callout(progress({ done: 0, skipped: 2, remaining: 0, total: 0 }))).toEqual({
      text: 'All skipped · not cleared',
      tone: 'now',
    });
  });

  it('counts down to the clear as usual with a skip in the day: the skip is excused', () => {
    expect(callout(progress({ done: 1, skipped: 1, remaining: 1, total: 2 }))).toEqual({
      text: 'One more to clear the day',
      tone: 'text',
    });
    // Past the halfway point, and with more than one skip.
    expect(callout(progress({ done: 4, skipped: 2, remaining: 2, total: 6 }))).toEqual({
      text: 'Halfway there · 2 to go',
      tone: 'text',
    });
  });

  it('still explains timed sessions missing from the board when a skip is in the day', () => {
    expect(
      callout(progress({ done: 1, skipped: 1, remaining: 1, missingTimed: 1, total: 2 })),
    ).toEqual({ text: 'Not on the list yet', tone: 'now' });
  });

  it('is silent once the day is cleared', () => {
    expect(callout(progress({ done: 2, total: 2, cleared: true }))).toBeNull();
  });

  it('never counts down on a day that is over: it reads Not cleared, or only what is open when held', () => {
    for (const p of [
      progress({ done: 1, remaining: 2, total: 3 }),
      progress({ done: 4, remaining: 3, total: 7 }),
      progress({ done: 6, remaining: 1, total: 7 }),
      progress({ done: 0, remaining: 1, missingTimed: 1, total: 1 }),
    ])
      expect(callout(p, true)).toEqual({
        text: `Not cleared · ${p.remaining} not done`,
        tone: 'now',
      });
    expect(callout(progress({ done: 1, remaining: 4, total: 5, protected: true }), true)).toEqual({
      text: '4 not done',
      tone: 'text',
    });
    expect(callout(progress({ done: 2, total: 2, cleared: true }), true)).toBeNull();
  });
});

describe('progressLabel', () => {
  it('reads the count and the goal as one sentence', () => {
    expect(progressLabel(progress({ done: 1, remaining: 1, total: 2 }), true)).toBe(
      "Today's objectives. 1 of 2 objectives complete. One more to clear the day.",
    );
    expect(progressLabel(progress({ done: 0, remaining: 2, total: 2 }), false)).toBe(
      'Objectives. 0 of 2 objectives complete. 2 to clear the day.',
    );
  });

  it('reads a past open day as not cleared, never as a countdown', () => {
    expect(progressLabel(progress({ done: 1, remaining: 2, total: 3 }), false, true)).toBe(
      'Objectives. 1 of 3 objectives complete. Not cleared · 2 not done.',
    );
  });

  it('speaks the count without the skipped objective', () => {
    expect(progressLabel(progress({ done: 1, skipped: 1, remaining: 1, total: 2 }), true)).toBe(
      "Today's objectives. 1 of 2 objectives complete. One more to clear the day.",
    );
  });
});
