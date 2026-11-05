// A .ts test has no JSX, and createElement's typing needs children among the props.
/* eslint-disable react/no-children-prop */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createElement, useEffect } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { State } from '../../domain/model';
import { AppProvider, SAVE_FAILED, useApp, useBusy, useSave } from '../app-state';

// Storage resolves on a later task, like a native SQLite round trip, so the provider re-renders for
// busy before the save finishes.
const mockStorage = {
  saves: [] as State[],
  fail: false,
  loadFail: false,
  // Saves in flight at once, and the most seen together.
  active: 0,
  mostActive: 0,
};
jest.mock('../../data/storage', () => ({
  loadState: async () => {
    if (mockStorage.loadFail) throw new Error('Synthetic load failure');
    return jest
      .requireActual<typeof import('../../domain/model')>('../../domain/model')
      .emptyState();
  },
  saveState: (state: State) => {
    mockStorage.saves.push(state);
    mockStorage.active++;
    mockStorage.mostActive = Math.max(mockStorage.mostActive, mockStorage.active);
    return new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        mockStorage.active--;
        if (mockStorage.fail) reject(new Error('Synthetic save failure'));
        else resolve();
      }, 5),
    );
  },
}));
const mockWidgets = { fail: false, published: [] as State[] };
jest.mock('../../data/study-store', () => ({ loadStudyRun: async () => null }));
jest.mock('../../widget/today-list-widget', () => ({
  publishTodayList: async () => {},
  readWidgetTicks: async () => [],
}));
jest.mock('../../widget/today-widget', () => ({
  publishTodayWidget: async (state: State) => {
    mockWidgets.published.push(state);
    if (mockWidgets.fail) throw new Error('Synthetic widget failure');
  },
}));
const DATE = '2026-11-09';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Render = { change: unknown; busy: boolean; ready: boolean };
const renders: Render[] = [];
let operations = 0;

/** Opens a day once it is missing, the way Today ensures a day: it reads state and calls change. */
function EnsureDay() {
  const { state, change, ready, busy } = useApp();
  renders.push({ change, busy, ready });
  useEffect(() => {
    if (!ready || state.days[DATE]) return;
    void change((s) => {
      operations++;
      return { ...s, days: { ...s.days, [DATE]: { date: DATE, blocks: [], revisions: [] } } };
    });
  }, [ready, state, change]);
  return null;
}

async function mount(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | null = null;
  await act(async () => {
    tree = create(createElement(AppProvider, { children: createElement(EnsureDay) }));
  });
  await act(async () => {
    await wait(100);
  });
  return tree!;
}

const saves = mockStorage.saves;
afterEach(() => {
  saves.length = 0;
  mockStorage.fail = false;
  mockStorage.loadFail = false;
  mockStorage.active = 0;
  mockStorage.mostActive = 0;
  mockWidgets.fail = false;
  mockWidgets.published.length = 0;
  renders.length = 0;
  operations = 0;
});

describe('AppProvider', () => {
  it('keeps one change function while the data stays loaded, through busy and back', async () => {
    const tree = await mount();
    const loaded = renders.filter((entry) => entry.ready);
    expect(loaded.some((entry) => entry.busy)).toBe(true);
    expect(new Set(loaded.map((entry) => entry.change)).size).toBe(1);
    act(() => tree.unmount());
  });

  it('saves a day opened by an effect once, not again when the save toggles busy', async () => {
    const tree = await mount();
    expect(operations).toBe(1);
    expect(saves).toHaveLength(1);
    expect(saves[0].days[DATE]).toEqual({ date: DATE, blocks: [], revisions: [] });
    act(() => tree.unmount());
  });

  it('does not retry a failing save on every busy or error change', async () => {
    mockStorage.fail = true;
    const tree = await mount();
    // The effect re-runs only when its own inputs change; a refused save changes none of them.
    expect(saves).toHaveLength(1);
    expect(operations).toBe(1);
    act(() => tree.unmount());
  });
});

describe('a change and the frame before it', () => {
  type Change = (operation: (current: State) => State) => Promise<boolean>;
  const captured: { change: Change; busy: boolean }[] = [];
  const latest = () => captured[captured.length - 1];
  function Capture() {
    const { change } = useSave();
    captured.push({ change, busy: useBusy() });
    return null;
  }
  async function mountCapture(): Promise<ReactTestRenderer> {
    let tree: ReactTestRenderer | null = null;
    await act(async () => {
      tree = create(createElement(AppProvider, { children: createElement(Capture) }));
    });
    await act(async () => {
      await wait(20);
    });
    return tree!;
  }
  const raf = globalThis.requestAnimationFrame;
  afterEach(() => {
    globalThis.requestAnimationFrame = raf;
  });

  it('runs the operation only after a frame has painted, so a pending check shows first', async () => {
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    const tree = await mountCapture();
    let ran = 0;
    let result: Promise<boolean> | null = null;
    await act(async () => {
      result = latest().change((s) => {
        ran++;
        return s;
      });
      await wait(10);
    });
    // Busy at once, nothing run or saved until the frame.
    expect(latest().busy).toBe(true);
    expect(ran).toBe(0);
    expect(saves).toHaveLength(0);
    await act(async () => {
      frames.splice(0).forEach((callback) => callback(0));
      await expect(result!).resolves.toBe(true);
    });
    expect(ran).toBe(1);
    expect(saves).toHaveLength(1);
    act(() => tree.unmount());
  });

  it('still saves when no frame comes, as in a hidden tab or a backgrounded app', async () => {
    globalThis.requestAnimationFrame = () => 0;
    const tree = await mountCapture();
    let saved: boolean | null = null;
    await act(async () => {
      saved = await latest().change((s) => s);
    });
    expect(saved).toBe(true);
    expect(saves).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe('a change the device cannot save', () => {
  type Seen = {
    change: (operation: (current: State) => State) => Promise<boolean>;
    error: string | null;
  };
  const seen: Seen[] = [];
  function Watch() {
    const { change, error } = useApp();
    seen.push({ change, error });
    return null;
  }
  async function mountWatch(): Promise<ReactTestRenderer> {
    let tree: ReactTestRenderer | null = null;
    await act(async () => {
      tree = create(createElement(AppProvider, { children: createElement(Watch) }));
    });
    await act(async () => {
      await wait(20);
    });
    return tree!;
  }
  afterEach(() => {
    seen.length = 0;
  });

  it("says plainly that nothing was saved, never the storage's own error", async () => {
    const tree = await mountWatch();
    mockStorage.fail = true;
    let result: boolean | null = null;
    await act(async () => {
      result = await seen.at(-1)!.change((s) => ({ ...s, notes: ['Example note'] }));
    });
    expect(result).toBe(false);
    expect(seen.at(-1)!.error).toBe(SAVE_FAILED);
    expect(seen.at(-1)!.error).not.toMatch(/Synthetic save failure/);
    act(() => tree.unmount());
  });

  it("keeps an operation's own refusal, which is written for the user", async () => {
    const tree = await mountWatch();
    await act(async () => {
      await seen.at(-1)!.change(() => {
        throw new Error('Enter the minutes you did, from 1 to 1440.');
      });
    });
    expect(seen.at(-1)!.error).toBe('Enter the minutes you did, from 1 to 1440.');
    act(() => tree.unmount());
  });
});

describe('the change queue', () => {
  type App = ReturnType<typeof useApp>;
  const views: App[] = [];
  const view = () => views[views.length - 1];
  function Everything() {
    views.push(useApp());
    return null;
  }
  async function mountApp(): Promise<ReactTestRenderer> {
    let tree: ReactTestRenderer | null = null;
    await act(async () => {
      tree = create(createElement(AppProvider, { children: createElement(Everything) }));
    });
    await act(async () => {
      await wait(20);
    });
    return tree!;
  }
  const note = (text: string) => (s: State) => ({ ...s, notes: [...s.notes, text] });
  afterEach(() => {
    views.length = 0;
  });

  it('runs changes made together one at a time, each on the state the one before saved', async () => {
    const tree = await mountApp();
    let results: boolean[] = [];
    await act(async () => {
      // Two taps before either save finishes: neither waits for the other in the caller.
      const first = view().change(note('First'));
      const second = view().change(note('Second'));
      results = await Promise.all([first, second]);
    });
    expect(results).toEqual([true, true]);
    expect(mockStorage.mostActive).toBe(1);
    expect(saves.map((s) => s.notes)).toEqual([['First'], ['First', 'Second']]);
    expect(view().state.notes).toEqual(['First', 'Second']);
    act(() => tree.unmount());
  });

  it('gives the change after a refused save the state from before it', async () => {
    const tree = await mountApp();
    mockStorage.fail = true;
    let refused: boolean | null = null;
    await act(async () => {
      refused = await view().change(note('Not saved'));
    });
    expect(refused).toBe(false);
    expect(view().state.notes).toEqual([]);
    mockStorage.fail = false;
    let before: string[] | null = null;
    let saved: boolean | null = null;
    await act(async () => {
      saved = await view().change((s) => {
        before = s.notes;
        return note('Saved')(s);
      });
    });
    expect(saved).toBe(true);
    expect(before).toEqual([]);
    expect(view().state.notes).toEqual(['Saved']);
    // The saved change clears the earlier error.
    expect(view().error).toBeNull();
    act(() => tree.unmount());
  });

  it('shows a load failure without saving anything, and loads again on retry', async () => {
    mockStorage.loadFail = true;
    const tree = await mountApp();
    expect(view().ready).toBe(false);
    expect(view().error).toBe(
      'Could not read saved data. Nothing has been overwritten. Retry loading.',
    );
    // A change before the data loads is refused, so it can never overwrite the unread data.
    let early: boolean | null = null;
    await act(async () => {
      early = await view().change(note('Too early'));
    });
    expect(early).toBe(false);
    expect(saves).toHaveLength(0);
    mockStorage.loadFail = false;
    await act(async () => {
      view().retry();
      await wait(20);
    });
    expect(view().ready).toBe(true);
    expect(view().error).toBeNull();
    let saved: boolean | null = null;
    await act(async () => {
      saved = await view().change(note('After retry'));
    });
    expect(saved).toBe(true);
    expect(saves.map((s) => s.notes)).toEqual([['After retry']]);
    act(() => tree.unmount());
  });

  it('keeps a saved change when publishing to the widgets fails', async () => {
    const tree = await mountApp();
    mockWidgets.fail = true;
    let saved: boolean | null = null;
    await act(async () => {
      saved = await view().change(note('Saved anyway'));
      await wait(10);
    });
    expect(saved).toBe(true);
    expect(mockWidgets.published.at(-1)!.notes).toEqual(['Saved anyway']);
    expect(view().state.notes).toEqual(['Saved anyway']);
    expect(view().error).toBeNull();
    act(() => tree.unmount());
  });
});
