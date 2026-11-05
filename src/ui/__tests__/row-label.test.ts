import { describe, expect, it } from '@jest/globals';
import { instructionsCaption, rowLabel, tickHint } from '../row-label';

describe('rowLabel', () => {
  it('speaks the NOW and UP NEXT line with the times', () => {
    expect(rowLabel('Edit Strength session', 'planned', 'Now · 6:00–7:30 PM')).toBe(
      'Edit Strength session. Now, 6:00 to 7:30 PM',
    );
    expect(rowLabel('Edit Interview practice', 'planned', 'Up next · 11:30 AM – 12:15 PM')).toBe(
      'Edit Interview practice. Up next, 11:30 AM to 12:15 PM',
    );
  });

  it("reads Today's unbreakable time range as a plain range", () => {
    expect(rowLabel('Edit Plan', 'planned', 'Up next · 10:00–\u206011:00\u00a0AM')).toBe(
      'Edit Plan. Up next, 10:00 to 11:00\u00a0AM',
    );
  });

  it('speaks when an objective was completed', () => {
    expect(rowLabel('Edit Read 20 min', 'done', 'Done · 2:34 PM')).toBe(
      'Edit Read 20 min. Done, 2:34 PM',
    );
  });

  it('falls back to the status when there is no line', () => {
    expect(rowLabel('Edit Walk', 'skipped')).toBe('Edit Walk. Skipped');
    expect(rowLabel('Edit Walk', 'done', null)).toBe('Edit Walk. Completed');
  });

  it('is only the action for an open checklist item', () => {
    expect(rowLabel('Edit Walk', 'planned')).toBe('Edit Walk');
  });
});

describe('tickHint', () => {
  it('says what a tap on a tick row does in each status', () => {
    expect(tickHint('planned')).toBe('Marks it done. Long press to edit.');
    expect(tickHint('done')).toBe('Marks it not done. Long press to edit.');
    expect(tickHint('skipped')).toBe('Reopens it. Long press to edit.');
  });
});

describe('instructionsCaption', () => {
  it('counts the steps, or the links when there are no steps', () => {
    expect(instructionsCaption(1, 0)).toBe('1 step');
    expect(instructionsCaption(3, 2)).toBe('3 steps');
    expect(instructionsCaption(0, 1)).toBe('1 link');
    expect(instructionsCaption(0, 2)).toBe('2 links');
  });

  it('is null when there is nothing to fold', () => {
    expect(instructionsCaption(0, 0)).toBeNull();
  });
});
