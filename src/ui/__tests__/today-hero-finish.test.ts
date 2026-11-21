// A .ts test has no JSX, and createElement's typing needs children among the props.
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { DayProgress } from '../../domain/objectives';
import { WeekDayMark } from '../../domain/moments';
import { TodayHero, leadLabel, heroLead } from '../today-hero';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ error: null }),
  useBusy: () => false,
}));

const week: WeekDayMark[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((letter, i) => ({
  date: `2026-11-${String(15 + i).padStart(2, '0')}`,
  letter,
  mark: i === 6 ? 'cleared' : i === 5 ? 'missed' : 'none',
  today: i === 6,
}));
const cleared: DayProgress = {
  done: 3,
  total: 3,
  skipped: 0,
  remaining: 0,
  missingTimed: 0,
  missingTimedTitles: [],
  cleared: true,
  protected: false,
};

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
}

describe('the hero with yesterday to finish', () => {
  it('keeps the streak figure it reads to VoiceOver on screen', () => {
    const streak = { current: 1, best: 4 };
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(
        createElement(TodayHero, {
          progress: cleared,
          streak,
          week,
          outcome: 'cleared',
          hasActive: false,
          celebrate: false,
          onOpenStreak: () => {},
          finish: { remaining: 1, onOpen: () => {}, onDismiss: () => {} },
        }),
      );
    });
    expect(leadLabel(heroLead(streak, week, true))).toContain('1 day in a row');
    expect(texts(tree!)).toContain('1');
    expect(texts(tree!)).toContain('day in a row');
  });
});
