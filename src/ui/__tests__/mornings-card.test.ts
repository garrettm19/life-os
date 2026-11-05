import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { withDay } from '../../domain/data';
import { State, shiftDate } from '../../domain/model';
import { ensureChecklistDay, setStatus } from '../../domain/planner';
import { mornings } from '../../domain/progress';
import { anchorState } from '../../test-support/fixtures';
import { MorningsCard } from '../progress-cards';
import { palette } from '../theme';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../state/app-state', () => ({
  useApp: () => ({ busy: false, error: null }),
  useBusy: () => false,
  useSave: () => ({ change: async () => true, isSaving: () => false }),
}));

// Synthetic data only: two weeks of a synthetic 7:10 AM anchor, some mornings late, some not ticked.
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
};
function tick(state: State, date: string, hour: number | null): State {
  const opened = withDay(
    state,
    ensureChecklistDay(date, state.settings, state.programs, state.days[date], at(date, 5)),
  );
  if (hour === null) return opened;
  return withDay(
    opened,
    setStatus(opened.days[date], `${date}:routine:up`, 'done', at(date, hour, 4)),
  );
}
function history(): State {
  let s = anchorState();
  const hours = [7, 9, null, 7, 7, 8, 7, 7, null, 7, 9, 7, 7];
  hours.forEach((h, i) => (s = tick(s, shiftDate('2026-11-02', i), h)));
  return s;
}

const colors = (node: ReactTestInstance): string[] => {
  const out: string[] = [];
  const walk = (n: ReactTestInstance) => {
    const style = [n.props.style].flat(Infinity) as ({ color?: string } | undefined)[];
    for (const s of style)
      if (s && typeof s === 'object') out.push(...Object.values(s).map(String));
    for (const child of n.children) if (typeof child !== 'string') walk(child);
  };
  walk(node);
  return out;
};

describe('the Mornings card', () => {
  it('is one VoiceOver element that steps through each morning in words', () => {
    const card = mornings(history(), '2026-11-14')!;
    expect(card.state).toBe('chart');
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(createElement(MorningsCard, { card }));
    });
    const root = tree!.root.find(
      (n) => n.props.testID === 'card-mornings' && typeof n.type === 'string',
    );
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityRole).toBe('adjustable');
    expect(root.props.accessibilityLabel).toBe(card.summary);
    // Nothing inside it is its own element: the day squares are for the eye and touch only.
    const inner = root.findAll(
      (n) =>
        n !== root &&
        typeof n.type === 'string' &&
        (n.props.accessible === true || !!n.props.accessibilityRole),
    );
    expect(inner).toHaveLength(0);
    // A swipe up reads the latest morning, then each one before it.
    act(() => root.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(root.props.accessibilityValue.text).toBe('Sat, Nov 14: on time, ticked 7:04 AM');
    act(() => root.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(root.props.accessibilityValue.text).toBe('Fri, Nov 13: on time, ticked 7:04 AM');
    act(() => root.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(root.props.accessibilityValue.text).toBe(
      'Thu, Nov 12: ticked 9:04 AM, after the window',
    );
  });

  it('never uses the danger color, and never says missed or counts a zero', () => {
    const card = mornings(history(), '2026-11-14')!;
    let tree: ReactTestRenderer | null = null;
    act(() => {
      tree = create(createElement(MorningsCard, { card }));
    });
    const used = colors(tree!.root);
    expect(used).not.toContain(palette.danger);
    expect(used).not.toContain(palette.dangerTint);
    // Every word on the card (the symbol's fallback glyph is a prop, so the tree is not JSON).
    const text = tree!.root
      .findAll((n) => typeof n.type === 'string')
      .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'))
      .join(' ');
    expect(text).toContain('On time');
    expect(text).not.toMatch(/miss/i);
    expect(card.summary).not.toMatch(/(?<![\d:])0(?![\d:])/);
  });
});
