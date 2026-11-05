import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { RuleBook, State, emptyState } from '../../domain/model';
import { defaultTradingProfile } from '../../domain/trading';
import { announce } from '../announce';
import { ResetActions, StatusBand } from '../cockpit';
import { Glyph } from '../settings-icon';
import { TradingReviewSheet } from '../trading-review';
import { LiveWrite, useLiveWrite } from '../use-live';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
// Sheets carry their own safe area provider; its mock lays them out at once.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../announce', () => ({ announce: jest.fn(), useAnnouncement: jest.fn() }));
jest.mock('../feel', () => ({ feelStep: jest.fn() }));
// The saved data's `change`, which every trading write goes through: it saves, or refuses.
const mockChange = jest.fn(async (_: unknown): Promise<boolean> => true);
jest.mock('../../state/app-state', () => ({
  useApp: () => ({
    busy: false,
    error: null,
    ready: true,
    state: {
      programs: [],
      ruleBooks: [],
      ruleReviews: [],
      days: {},
      tradingSessions: {},
      source: 'synthetic',
    },
    change: mockChange,
  }),
  useBusy: () => false,
  useSave: () => ({ change: mockChange, isSaving: () => false }),
}));

// Synthetic data only: no account, instrument, price or amount. On iOS a Text with the alert
// role is never read out, so what must be heard is announced.
const DAY = '2026-11-09';
const profile = defaultTradingProfile(DAY);
const spoken = announce as jest.MockedFunction<typeof announce>;

// Every tree is unmounted after its test, so no clock keeps ticking past it.
const mounted: ReactTestRenderer[] = [];

function render(element: ReturnType<typeof createElement>): ReactTestRenderer {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

const byLabel = (tree: ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.find((n) => n.props.accessibilityLabel === label && !!n.props.onPress);

beforeEach(() => {
  spoken.mockClear();
});
afterEach(() => {
  act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
});

describe('trading announcements', () => {
  it('says the status in words: practice, the title, why, what next and what it rests on', () => {
    const tree = render(
      createElement(StatusBand, {
        title: 'COOLDOWN — STEP AWAY',
        reason: 'Step away. Back after 10:05 AM New York.',
        next: 'Stand up, drink water, no charts.',
        tone: 'wait',
        basis: 'app',
        practice: true,
      }),
    );
    const band = tree.root.find((n) => n.props.testID === 'trade-status');
    expect(band.props.accessibilityLabel).toBe(
      'Practice. COOLDOWN — STEP AWAY. Step away. Back after 10:05 AM New York. Next: Stand up, drink water, no charts. App-level.',
    );
    // The family's symbol beside the title (a clock for a wait), so the status never rests on
    // its color alone.
    const title = tree.root.find((n) => n.props.testID === 'trade-status-title');
    expect(title.props.children).toBe('COOLDOWN — STEP AWAY');
    expect(tree.root.findAll((n) => n.type === Glyph).map((n) => n.props.name)).toEqual(['wait']);
  });

  it('runs a live write through the saved data at the time of the tap, or refuses it', async () => {
    let write: LiveWrite | null = null;
    function Probe() {
      write = useLiveWrite();
      return null;
    }
    render(createElement(Probe));
    mockChange.mockClear();
    const seen: string[] = [];
    let ok = false;
    await act(async () => {
      ok = await write!((s, at) => {
        seen.push(at);
        return s;
      });
    });
    expect(ok).toBe(true);
    (mockChange.mock.calls[0][0] as (s: State) => State)(emptyState());
    expect(Number.isNaN(Date.parse(seen[0]))).toBe(false);
    // A refusal changes nothing; the app says its message at the root.
    mockChange.mockResolvedValueOnce(false);
    await act(async () => {
      ok = await write!((s) => s);
    });
    expect(ok).toBe(false);
  });

  it('answers the reset No through the rule, with no second question', () => {
    const write = jest.fn<LiveWrite>(async () => true);
    const tree = render(
      createElement(ResetActions, { routineId: 'trade-rules', thesisId: 't1', write }),
    );
    act(() => byLabel(tree, 'No longer valid: retire this thesis').props.onPress());
    expect(write).toHaveBeenCalledTimes(1);
    act(() => byLabel(tree, 'Still valid').props.onPress());
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe('the review items', () => {
  it('expose whether their details are shown', async () => {
    const book: RuleBook = {
      id: 'book',
      routineId: 'trade-rules',
      title: 'Trading rules',
      trading: profile,
    } as RuleBook;
    let tree: ReactTestRenderer | null = null;
    await act(async () => {
      tree = create(
        createElement(TradingReviewSheet, { book, date: DAY, visible: true, close: () => {} }),
      );
    });
    mounted.push(tree!);
    const item = profile.checklist[0];
    const toggle = () => byLabel(tree!, `${item.title}. Show details`);
    expect(toggle().props['aria-expanded']).toBe(false);
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    act(() => toggle().props.onPress());
    const open = byLabel(tree!, `${item.title}. Hide details`);
    expect(open.props['aria-expanded']).toBe(true);
    expect(open.props.accessibilityState).toEqual({ expanded: true });
  });
});
