// A .ts test has no JSX, and createElement's typing needs children among the props.
/* eslint-disable react/no-children-prop */
import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { Modal, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { FullScreen } from '../full-screen';
import { Sheet } from '../components';

// Reanimated's own mocks: the native worklets runtime does not exist under Jest.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
}));

// A native Modal is its own view hierarchy, so a SafeAreaView inside it finds no SafeAreaProvider
// and its content (the circuit timer's Close, for one) sits under the status bar. Every modal
// carries its own provider inside the Modal, not only the app root's provider outside it.

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

describe('safe area in modals', () => {
  it('the full-screen timer modal has its own SafeAreaProvider inside the Modal', () => {
    const tree = render(
      createElement(FullScreen, {
        close: () => {},
        children: createElement(Text, null, 'Timer'),
      }),
    );
    const modal = tree.root.findByType(Modal);
    expect(modal.props.presentationStyle).toBe('fullScreen');
    expect(modal.findAllByType(SafeAreaProvider)).toHaveLength(1);
  });

  it('every sheet has its own SafeAreaProvider inside its Modal', () => {
    const tree = render(
      createElement(Sheet, {
        title: 'Edit circuit',
        visible: true,
        close: () => {},
        children: createElement(Text, null, 'Body'),
      }),
    );
    expect(tree.root.findByType(Modal).findAllByType(SafeAreaProvider)).toHaveLength(1);
  });
});
