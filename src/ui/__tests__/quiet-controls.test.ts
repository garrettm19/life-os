// A .ts test has no JSX, and createElement's typing needs children among the props.
import { describe, expect, it, jest } from '@jest/globals';
import { createElement, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Button, LinkButton } from '../components';
import { CheckSquare } from '../mission';
import { StageList } from '../study-parts';
import { palette } from '../theme';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// The mock lacks the reduced-motion hook the pressable controls read.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useSave: () => ({ change: async () => true, isSaving: () => false }),
  useBusy: () => false,
}));

function render(element: ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((t) => t.props.children)
    .filter((c): c is string => typeof c === 'string');

/** The outline of the check: the first host view that carries a border width. */
function checkEdge(status: 'planned' | 'done' | 'skipped', tone?: 'active') {
  const tree = render(
    createElement(CheckSquare, { status, tone, label: 'Mark Read done', onPress: () => {} }),
  );
  const framed = tree.root
    .findAllByType(View)
    .map((v) => StyleSheet.flatten(v.props.style))
    .find((s) => s && s.borderWidth !== undefined);
  return framed!;
}

describe('CheckSquare outline', () => {
  it('draws an open check with the 3:1 check edge, not the faint line', () => {
    expect(checkEdge('planned').borderColor).toBe(palette.checkEdge);
    expect(checkEdge('skipped').borderColor).toBe(palette.checkEdge);
  });

  it('keeps Ember for the objective in progress and no outline once done', () => {
    expect(checkEdge('planned', 'active').borderColor).toBe(palette.accent);
    expect(checkEdge('done').borderWidth).toBe(0);
  });
});

describe('LinkButton', () => {
  it('reads in plain text, never Fern, since nothing is done yet', () => {
    const tree = render(
      createElement(LinkButton, { title: 'Add objective here', onPress: () => {} }),
    );
    const label = tree.root
      .findAllByType(Text)
      .find((t) => t.props.children === 'Add objective here')!;
    expect(StyleSheet.flatten(label.props.style).color).toBe(palette.label);
  });
});

describe('Button needs', () => {
  const needs = 'Tick at least one set to finish the workout.';
  const button = (disabled: boolean, reason = needs) =>
    texts(
      render(
        createElement(Button, {
          title: 'Finish workout',
          onPress: () => {},
          disabled,
          needs: reason,
        }),
      ),
    );

  it('says once under a disabled primary what enables it', () => {
    expect(button(true).filter((t) => t === needs)).toHaveLength(1);
  });

  it('shows nothing once the button is enabled, or when nothing the user can change holds it', () => {
    expect(button(false)).not.toContain(needs);
    expect(button(true, '')).toEqual(['Finish workout']);
  });
});

describe('StageList', () => {
  it('lists stages without decorative index numbers, and still reads each stage number', () => {
    const tree = render(
      createElement(StageList, {
        stages: [
          { id: 'a', title: 'Warm up', plannedSeconds: 600, seconds: 0, state: 'next' },
          { id: 'b', title: 'New problem', plannedSeconds: 1500, seconds: 0, state: 'next' },
        ],
      }),
    );
    expect(texts(tree).filter((t) => /^\d+$/.test(t))).toEqual([]);
    expect(texts(tree)).toEqual(['Warm up', '10 min', 'New problem', '25 min']);
    const labels = tree.root
      .findAllByType(View)
      .map((v) => v.props.accessibilityLabel)
      .filter(Boolean);
    expect(labels).toEqual(['Stage 1, Warm up. 10 min.', 'Stage 2, New problem. 25 min.']);
  });
});
