import { describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Block } from '../../domain/model';
import { makeBlock } from '../../domain/planner';
import { CheckSquare, Tick } from '../mission';
import { FoldToggle, InstructionsBody } from '../instructions';
import { ObjectiveRow } from '../objective-row';
import { RowActions, TodayRow } from '../today-row';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// Reanimated's mock leaves out useReducedMotion, which the check reads.
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
// Counts renders of the check, which renders once each time its row renders.
const renders = { check: 0 };
jest.mock('../mission', () => {
  const actual = jest.requireActual<typeof import('../mission')>('../mission');
  return {
    ...actual,
    CheckSquare: (props: Parameters<typeof actual.CheckSquare>[0]) => {
      renders.check++;
      return actual.CheckSquare(props);
    },
  };
});
const DATE = '2026-11-09';
const walk = (status: Block['status'] = 'planned'): Block => ({
  ...makeBlock(`${DATE}:manual:walk`, 'Walk', null, 20),
  checklist: true,
  status,
});

/** A save the test settles itself. */
function deferred() {
  let settle: (saved: boolean) => void = () => {};
  const promise = new Promise<boolean>((resolve) => (settle = resolve));
  return { promise, settle };
}

const row = (status: Block['status'], onCheck: () => unknown, tickOnTap = false) =>
  createElement(ObjectiveRow, {
    title: 'Walk',
    status,
    editLabel: 'Edit Walk',
    checkLabel: status === 'planned' ? 'Mark Walk done' : 'Undo Walk',
    skipLabel: 'Skip Walk',
    onEdit: () => {},
    onCheck,
    onSkip: () => {},
    tickOnTap,
  });

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  return tree!;
}
const check = (tree: ReactTestRenderer): ReactTestInstance =>
  tree.root.findByType(CheckSquare).findByProps({ accessibilityRole: 'button' });
const busy = (tree: ReactTestRenderer) => check(tree).props['aria-busy'];
const press = async (node: ReactTestInstance) => {
  await act(async () => node.props.onPress());
};

describe('a check whose save is pending', () => {
  it('shows the tap at once without the saved look, then the saved status once saved', async () => {
    const save = deferred();
    const onCheck = jest.fn(() => save.promise);
    const tree = render(row('planned', onCheck));
    await press(check(tree));
    expect(onCheck).toHaveBeenCalledTimes(1);
    // Pending: busy, still labelled as open, and no tick: nothing claims the change was saved.
    expect(busy(tree)).toBe(true);
    expect(check(tree).props.accessibilityState).toEqual({ busy: true });
    expect(check(tree).props.accessibilityLabel).toBe('Mark Walk done');
    expect(tree.root.findAllByType(Tick)).toHaveLength(0);
    // The save lands: the screen passes the saved status, which replaces the pending look.
    act(() => tree.update(row('done', onCheck)));
    expect(busy(tree)).toBe(false);
    expect(tree.root.findAllByType(Tick)).toHaveLength(1);
    await act(async () => save.settle(true));
    expect(busy(tree)).toBe(false);
  });

  it('returns to the saved status when the save is refused', async () => {
    const save = deferred();
    const tree = render(row('planned', () => save.promise));
    await press(check(tree));
    expect(busy(tree)).toBe(true);
    await act(async () => save.settle(false));
    expect(busy(tree)).toBe(false);
    expect(check(tree).props.accessibilityLabel).toBe('Mark Walk done');
    expect(tree.root.findAllByType(Tick)).toHaveLength(0);
  });

  it('ignores a second tap on the same check while its save is pending', async () => {
    const save = deferred();
    const onCheck = jest.fn(() => save.promise);
    const tree = render(row('planned', onCheck));
    await press(check(tree));
    await press(check(tree));
    expect(onCheck).toHaveBeenCalledTimes(1);
    await act(async () => save.settle(true));
  });

  it('shows no pending look for a press that saves nothing, such as opening a form', async () => {
    const tree = render(row('planned', () => undefined));
    await press(check(tree));
    expect(busy(tree)).toBe(false);
  });

  it('shows the pending look on the check when the row itself is tapped', async () => {
    const save = deferred();
    const tree = render(row('planned', () => save.promise, true));
    const rowButton = tree.root.findByProps({ accessibilityLabel: 'Walk' });
    await press(rowButton);
    expect(busy(tree)).toBe(true);
    await act(async () => save.settle(true));
  });
});

describe('a row on Today', () => {
  const actions: RowActions = {
    check: jest.fn(),
    edit: jest.fn(),
    skip: jest.fn(),
    move: jest.fn(),
  };
  const props = (block: Block) => ({
    block,
    date: DATE,
    sub: null,
    active: false,
    editLabel: 'Edit Walk',
    checkLabel: 'Mark Walk done',
    tickOnTap: true,
    steps: false,
    links: [],
    canMove: false,
    actions,
  });

  it('does not re-render when Today re-renders with the same block and labels', () => {
    const block = walk();
    const same = props(block);
    const tree = render(createElement(TodayRow, same));
    const before = renders.check;
    // A tick elsewhere or the clock re-renders Today; this row's props are equal.
    act(() => tree.update(createElement(TodayRow, { ...same })));
    act(() => tree.update(createElement(TodayRow, { ...same })));
    expect(renders.check).toBe(before);
    // Its own block changed: it renders again.
    act(() => tree.update(createElement(TodayRow, props(walk('done')))));
    expect(renders.check).toBe(before + 1);
  });

  it('passes its block to the shared actions', async () => {
    const block = walk();
    const tree = render(createElement(TodayRow, props(block)));
    await press(check(tree));
    expect(actions.check).toHaveBeenCalledWith(block);
  });
});

describe('a row in three columns', () => {
  const steps = ['Glass of water', 'Open the blinds', 'Five slow breaths'];
  const withSteps = (status: Block['status'], next = false) =>
    createElement(ObjectiveRow, {
      title: 'Get ready',
      status,
      editLabel: 'Edit Get ready',
      checkLabel: status === 'planned' ? 'Mark Get ready done' : 'Undo Get ready',
      skipLabel: 'Skip Get ready',
      onEdit: () => {},
      onCheck: () => {},
      onSkip: () => {},
      tickOnTap: true,
      next,
      instructions: { steps, links: [] },
    });
  /** The labels of the buttons in the row's trailing column, in order. */
  const trailing = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((n) => typeof n.type === 'string' && n.props.style?.flexShrink === 0)[0]
      .findAll((n) => n.props.accessibilityRole === 'button' && typeof n.type !== 'string')
      .map((n) => n.props.accessibilityLabel as string)
      .filter((label, i, all) => all.indexOf(label) === i);

  it('holds the chevron, named with the step count, then Skip, in a column that never shrinks', () => {
    const tree = render(withSteps('planned'));
    expect(trailing(tree)).toEqual(['Show 3 steps for Get ready', 'Skip Get ready']);
    const toggle = tree.root.findByType(FoldToggle).findByProps({ accessibilityRole: 'button' });
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(toggle.props.style).toMatchObject({ width: 44, height: 44 });
  });

  it('opens the steps below the row from the chevron, and closes them with it', async () => {
    const tree = render(withSteps('planned'));
    expect(tree.root.findAllByType(InstructionsBody)).toHaveLength(0);
    const toggle = () =>
      tree.root.findByType(FoldToggle).findByProps({ accessibilityRole: 'button' });
    await press(toggle());
    expect(toggle().props.accessibilityLabel).toBe('Hide 3 steps for Get ready');
    expect(toggle().props['aria-expanded']).toBe(true);
    expect(tree.root.findAllByType(InstructionsBody)).toHaveLength(1);
    await press(toggle());
    expect(tree.root.findAllByType(InstructionsBody)).toHaveLength(0);
  });

  it('keeps the chevron in place once done, and says Undo once skipped', () => {
    expect(trailing(render(withSteps('done')))).toEqual(['Show 3 steps for Get ready']);
    expect(trailing(render(withSteps('skipped')))).toEqual([
      'Show 3 steps for Get ready',
      'Undo skipping Get ready',
    ]);
  });

  it('gives the next thing to do the active check tone, and only that', () => {
    const tone = (tree: ReactTestRenderer) => tree.root.findByType(CheckSquare).props.tone;
    expect(tone(render(withSteps('planned', true)))).toBe('active');
    expect(tone(render(withSteps('planned')))).toBe('open');
  });
});
