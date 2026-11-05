import { describe, expect, it } from '@jest/globals';
import { programArea } from '../areas';

describe('programArea', () => {
  it('reads the area from the title first, then the group', () => {
    const area = (title: string, group = title) => programArea({ title, group }).symbol;
    expect(area('Morning foundations', 'Foundations')).toBe('sunrise');
    expect(area('Strength', 'Training')).toBe('dumbbell');
    expect(area('Home extras', 'Training')).toBe('dumbbell');
    expect(area('Cardio and sport', 'Training')).toBe('run');
    expect(area('Engineering skills', 'Career')).toBe('briefcase');
    expect(area('Coding practice')).toBe('briefcase');
    expect(area('Money')).toBe('dollar');
    expect(area('Trading practice', 'Money')).toBe('chart');
    expect(area('Home')).toBe('house');
    expect(area('Example routines', 'Social')).toBe('people');
  });

  it('gives a program its words do not place the neutral stack', () => {
    expect(programArea({ title: 'Example', group: 'Misc' })).toEqual({
      symbol: 'stack',
      tone: 'slate',
    });
  });

  it('never reads part of a word as an area', () => {
    expect(programArea({ title: 'Interview readiness', group: 'Misc' }).symbol).toBe('briefcase');
    expect(programArea({ title: 'Brunch', group: 'Misc' }).symbol).toBe('stack');
  });
});
