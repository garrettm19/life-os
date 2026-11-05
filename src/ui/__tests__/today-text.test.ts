import { describe, expect, it, jest } from '@jest/globals';
import { Block, Day } from '../../domain/model';
import { dayProgress } from '../../domain/objectives';
import { makeBlock } from '../../domain/planner';
import { doneAt } from '../objective-row';
import { clearedTitles, recordedSub, timeRange } from '../today-text';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({}));
const DATE = '2026-11-09';
const AT = new Date(2026, 10, 9, 8, 0).toISOString();
const item = (key: string, title: string, status: Block['status'], extra: Partial<Block> = {}) => ({
  ...makeBlock(`${DATE}:manual:${key}`, title, null, 20),
  checklist: true,
  status,
  actualAt: status === 'done' ? AT : null,
  ...extra,
});

describe('the done caption', () => {
  it('joins the time to its AM or PM, so a wrapped caption never splits the time', () => {
    expect(doneAt(AT)).toBe('8:00\u00a0AM');
    expect(recordedSub(item('walk', 'Walk', 'done'))).toBe('Done · 8:00\u00a0AM');
  });
});

describe('the planned time caption', () => {
  const at = (start: number, duration: number | null) =>
    makeBlock(`${DATE}:manual:plan`, 'Plan', start, duration);

  it('keeps a range whole and each AM or PM with its time, so a wrapped caption never splits it', () => {
    expect(timeRange(at(10 * 60, 60))).toBe('10:00–\u206011:00\u00a0AM');
    expect(timeRange(at(11 * 60 + 30, 45))).toBe('11:30\u00a0AM – 12:15\u00a0PM');
    expect(timeRange(at(19 * 60, null))).toBe('7:00\u00a0PM');
  });
});

describe('what Day cleared lists', () => {
  it('lists the required objectives done, the same set as the count above it', () => {
    const walk = item('walk', 'Walk', 'done');
    const weigh = item('weigh', 'Morning weigh-in', 'done', { optional: true });
    const read = item('read', 'Read', 'skipped');
    const morning = item('morning', 'Morning', 'done', {
      bundledSteps: [
        {
          id: 's1',
          routineId: 'r1',
          programId: 'p',
          title: 'Water',
          steps: [],
          status: 'done',
          actualAt: AT,
        },
        {
          id: 's2',
          routineId: 'r2',
          programId: 'p',
          title: 'Stretch',
          steps: [],
          status: 'done',
          actualAt: AT,
        },
      ],
    });
    const day: Day = { date: DATE, blocks: [weigh, walk, read, morning], revisions: [] };
    const list = [morning, weigh, walk, read];
    const titles = clearedTitles(day, list, []);
    // The optional weigh-in, the skipped read and the container's own check are left out.
    expect(titles).toEqual(['Water', 'Stretch', 'Walk']);
    expect(titles).toHaveLength(dayProgress(day, [], DATE).done);
  });
});
