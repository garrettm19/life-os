// A .ts test has no JSX, and createElement's typing needs children among the props.
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Field } from '../components';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
}));

// Native refuses a bare string inside a View (the browser renders it), so a plain-text hint must
// be wrapped in a Text or the field cannot render on the phone.

describe('Field hint', () => {
  it('wraps a plain-text hint in a Text', () => {
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(
        createElement(Field, {
          label: 'Target',
          value: '',
          onChange: () => {},
          hint: 'A short hint.',
        }),
      );
    });
    const texts = tree!.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain('A short hint.');
  });
});
