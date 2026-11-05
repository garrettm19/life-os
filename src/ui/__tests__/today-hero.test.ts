import { describe, expect, it, jest } from '@jest/globals';
import type { WeekDayMark } from '../../domain/moments';
import { heroLead, leadLabel } from '../today-hero';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
}));

// Synthetic weeks ending on today, Monday, November 9, 2026.
const marks = (list: WeekDayMark['mark'][]): WeekDayMark[] =>
  list.map((mark, i) => ({
    date: `2026-11-0${3 + i}`,
    letter: 'TWTFSSM'[i],
    mark,
    today: i === 6,
  }));

describe("Today's hero headline", () => {
  it('leads with yesterday cleared and puts the run under it as a figure', () => {
    const lead = heroLead(
      { current: 4, best: 9 },
      marks(['cleared', 'missed', 'cleared', 'cleared', 'cleared', 'cleared', 'open']),
      false,
    );
    expect(lead).toEqual({
      title: 'Yesterday was cleared',
      figure: 4,
      unit: 'days in a row',
      best: 9,
      atBest: false,
      note: null,
    });
    expect(leadLabel(lead)).toBe('Yesterday was cleared. 4 days in a row. Best 9.');
  });

  it('never leads with a broken run: a fresh start, counting only what was cleared', () => {
    const lead = heroLead(
      { current: 0, best: 9 },
      marks(['cleared', 'missed', 'cleared', 'cleared', 'cleared', 'missed', 'open']),
      false,
    );
    expect(lead.title).toBe('A fresh start today');
    expect(lead.figure).toBeNull();
    expect(lead.note).toBe('4 cleared in the last 7 days');
    expect(leadLabel(lead)).not.toMatch(/\b0\b|missed|broke|lost/i);
  });

  it('starts a first run without a zero', () => {
    const lead = heroLead(
      { current: 0, best: 0 },
      marks(Array(6).fill('none').concat('open')),
      false,
    );
    expect(lead).toMatchObject({ figure: null, best: null, note: 'Clear today to start a run' });
  });

  it('says a protected or neutral yesterday kept the run going', () => {
    const week = (y: WeekDayMark['mark']) =>
      marks(['cleared', 'cleared', 'cleared', 'cleared', 'cleared', y, 'open']);
    expect(heroLead({ current: 5, best: 5 }, week('protected'), false)).toMatchObject({
      title: 'Yesterday was protected',
      atBest: true,
    });
    expect(heroLead({ current: 5, best: 7 }, week('free'), false).title).toBe(
      'Your run is still going',
    );
  });

  it('once today is cleared, says so with the run through today', () => {
    const lead = heroLead(
      { current: 1, best: 9 },
      marks(Array(6).fill('missed').concat('cleared')),
      true,
    );
    expect(lead).toMatchObject({ title: 'Day cleared', figure: 1, unit: 'day in a row' });
  });
});
