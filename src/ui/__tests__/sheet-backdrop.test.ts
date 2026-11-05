// A .ts test has no JSX, and createElement's typing needs children among the props.
/* eslint-disable react/no-children-prop */
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Sheet } from '../components';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// Reanimated's mock leaves out useReducedMotion, which the sheet's Close reads.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
// The library's own mock gives the sheet insets at once, so its content renders under Jest.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
}));

// The backdrop behind every sheet closes it on a tap. It must never be the first thing VoiceOver
// or the keyboard reaches, or the first activation in a sheet would close it.

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

describe('the sheet backdrop', () => {
  it('closes the sheet on a tap but is hidden from VoiceOver and is no control', () => {
    const close = jest.fn();
    const tree = render(
      createElement(Sheet, {
        title: 'Example sheet',
        visible: true,
        close,
        children: createElement(Text, null, 'Body'),
      }),
    );
    const backdrop = tree.root.find(
      (node) => node.props.testID === 'sheet-backdrop' && typeof node.type !== 'string',
    );
    expect(backdrop.props['aria-hidden']).toBe(true);
    expect(backdrop.props.accessibilityRole).toBeUndefined();
    expect(backdrop.props.accessibilityLabel).toBeUndefined();
    expect(backdrop.props.accessible).not.toBe(true);
    // Nothing in the sheet is named Dismiss: Close is its one accessible way out.
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Dismiss')).toHaveLength(
      0,
    );
    act(() => backdrop.props.onResponderRelease());
    expect(close).toHaveBeenCalledTimes(1);
  });
});
