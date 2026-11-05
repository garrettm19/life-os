// A .ts test has no JSX, and createElement's typing needs children among the props.
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { trainingState } from '../../test-support/fixtures';
import { dayOutcome, dayProgress } from '../../domain/objectives';
import { needsEnsure } from '../../domain/rotation';
import { Count } from '../mission';
import { ObjectiveBoard, streakDetailsLabel } from '../objective-board';
import { palette } from '../theme';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// Reanimated's mock leaves out useReducedMotion and LayoutAnimationConfig, which the count uses.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
}));

// Synthetic training setup: nothing is due on Tuesdays or Thursdays, so Today never saves them.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const THU = '2026-11-12';

function boardText(date: string, today: string): string[] {
  const state = trainingState();
  const outcome = dayOutcome(state, date);
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(
      createElement(ObjectiveBoard, {
        isToday: date === today,
        notPast: date >= today,
        progress: dayProgress({ date, blocks: [], revisions: [] }, state.programs, date),
        streak: { current: 0, best: 0 },
        outcome,
        hasActive: false,
        celebrate: false,
        onOpenStreak: () => {},
      }),
    );
  });
  return tree!.root
    .findAllByType(Text)
    .map((t) => t.props.children)
    .filter((c): c is string => typeof c === 'string');
}

describe('Objective board on a day with no record', () => {
  it('reads Nothing due today on today with nothing due, never Not recorded', () => {
    const state = trainingState();
    // Today saves a day only when something is due, so Tuesday stays unsaved.
    expect(needsEnsure(state, TUE, TUE)).toBe(false);
    expect(dayOutcome(state, TUE)).toBe('absent');
    const text = boardText(TUE, TUE);
    expect(text).toEqual(['Nothing due today.']);
    expect(text.join(' ')).not.toMatch(/Not recorded|never opened/);
  });

  it('reads Nothing due this day on a later day with nothing due', () => {
    expect(boardText(THU, TUE)).toEqual(['Nothing due this day.']);
  });

  it('shows Not recorded only for a past day', () => {
    const text = boardText(MON, TUE);
    expect(text).toContain('Not recorded');
    expect(text.join(' ')).toMatch(/never opened/);
  });
});

describe('the count on the board', () => {
  const totalColor = (compact: boolean) => {
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(createElement(Count, { done: 2, total: 6, compact }));
    });
    const total = tree!.root
      .findAllByType(Text)
      .find((t) => [t.props.children].flat().join('') === '/6')!;
    return StyleSheet.flatten(total.props.style).color;
  };

  it('draws the total in meta at the compact size, where faint is too faint to read', () => {
    expect(totalColor(true)).toBe(palette.label3);
    // At the full 26 pt the total is large text, and faint is enough.
    expect(totalColor(false)).toBe(palette.placeholder);
  });
});

describe('the board on a day with skips', () => {
  const render = (statuses: ('done' | 'skipped')[]) => {
    const state = trainingState();
    const day = {
      date: MON,
      revisions: [],
      blocks: statuses.map((status, i) => ({
        id: `${MON}:manual:${i}`,
        routineId: null,
        programId: null,
        title: `Example ${i}`,
        start: null,
        duration: null,
        fixed: false,
        steps: [],
        status,
        actualAt: null,
        reason: null,
        checklist: true,
      })),
    };
    const saved = { ...state, days: { [MON]: day } };
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(
        createElement(ObjectiveBoard, {
          isToday: true,
          notPast: true,
          progress: dayProgress(day, state.programs, MON),
          streak: { current: 0, best: 0 },
          outcome: dayOutcome(saved, MON),
          hasActive: false,
          celebrate: false,
          onOpenStreak: () => {},
        }),
      );
    });
    return tree!.root
      .findAllByType(Text)
      .map((t) => [t.props.children].flat().join(''))
      .filter(Boolean);
  };

  it('clears with a skip in the day once the rest is done, counting only what was not skipped', () => {
    const text = render(['done', 'skipped']);
    expect(text).toContain('Day cleared');
    expect(text).toContain('1 / 1 complete');
    expect(text.join(' ')).not.toMatch(/skip/i);
  });

  it('says a day with everything skipped is not cleared', () => {
    const text = render(['skipped', 'skipped']);
    expect(text).toContain('All skipped · not cleared');
    expect(text).not.toContain('Day cleared');
  });
});

describe('the streak details label', () => {
  it('reads one period between sentences and counts a single day as one day', () => {
    expect(streakDetailsLabel({ current: 0, best: 1 })).toBe(
      'Streak details. New run started. Best 1 day.',
    );
    expect(streakDetailsLabel({ current: 1, best: 1 })).toBe(
      'Streak details. 1-day streak. Best 1 day.',
    );
    expect(streakDetailsLabel({ current: 0, best: 0 })).toBe(
      'Streak details. No streak yet. Best 0 days.',
    );
    expect(streakDetailsLabel({ current: 3, best: 5 })).toBe(
      'Streak details. 3-day streak. Best 5 days.',
    );
  });
});

describe('the board on a protected day', () => {
  it('says protection marks nothing done, never that nothing on the day is done', () => {
    const state = trainingState();
    const done = {
      id: `${MON}:manual:0`,
      routineId: null,
      programId: null,
      title: 'Example done',
      start: null,
      duration: null,
      fixed: false,
      steps: [],
      status: 'done' as const,
      actualAt: null,
      reason: null,
      checklist: true,
    };
    const day = {
      date: MON,
      revisions: [],
      protection: { reason: 'travel' as const, at: '2026-11-09T20:00:00.000Z' },
      blocks: [
        done,
        { ...done, id: `${MON}:manual:1`, title: 'Example open', status: 'planned' as const },
      ],
    };
    const saved = { ...state, days: { [MON]: day } };
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(
        createElement(ObjectiveBoard, {
          isToday: false,
          notPast: false,
          progress: dayProgress(day, state.programs, MON),
          streak: { current: 0, best: 0 },
          outcome: dayOutcome(saved, MON),
          protection: day.protection,
          hasActive: false,
          celebrate: false,
          onOpenStreak: () => {},
        }),
      );
    });
    const text = tree!.root
      .findAllByType(Text)
      .map((t) => [t.props.children].flat().join(''))
      .filter(Boolean)
      .join(' | ');
    const labels = tree!.root
      .findAll((n) => typeof n.props.accessibilityLabel === 'string')
      .map((n) => n.props.accessibilityLabel as string)
      .join(' | ');
    expect(text).toContain('Protection marks nothing done');
    expect(`${text} ${labels}`).not.toMatch(/Nothing was marked done/);
    // A held past day reads only what is open, no countdown.
    expect(text).toContain('1 not done');
    expect(text).not.toMatch(/to clear the day/);
  });
});
