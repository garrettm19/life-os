import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import * as moments from '../../domain/moments';
import { State } from '../../domain/model';
import { trainingState } from '../../test-support/fixtures';
import { JourneyCard } from '../journey-card';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
const mockCurrent: { state: State } = { state: trainingState() };
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ state: mockCurrent.state, busy: false, error: null }),
  useBusy: () => false,
}));

describe('How far you have come on Progress', () => {
  it('reads the whole history once per saved state, not on every re-render of Progress', () => {
    const journey = jest.spyOn(moments, 'journey');
    const weeks = jest.spyOn(moments, 'clearedByWeek');
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(createElement(JourneyCard));
    });
    // Progress re-renders (a range, a pending save) with the same saved state.
    act(() => tree!.update(createElement(JourneyCard)));
    act(() => tree!.update(createElement(JourneyCard)));
    expect(journey).toHaveBeenCalledTimes(1);
    expect(weeks).toHaveBeenCalledTimes(1);
    // A saved change is a new state: the figures are read again.
    mockCurrent.state = { ...mockCurrent.state };
    act(() => tree!.update(createElement(JourneyCard)));
    expect(journey).toHaveBeenCalledTimes(2);
    expect(weeks).toHaveBeenCalledTimes(2);
    act(() => tree!.unmount());
  });
});
