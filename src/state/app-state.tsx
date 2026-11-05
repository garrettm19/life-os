import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { State, emptyState } from '../domain/model';
import { loadState, saveState } from '../data/storage';
import { loadStudyRun } from '../data/study-store';
import { readDeviceSessions } from '../data/trading-store';
import { applyWidgetTicks } from '../domain/widget-list';
import { publishTodayList, readWidgetTicks } from '../widget/today-list-widget';
import { publishTodayWidget } from '../widget/today-widget';
import { saveThenPublish } from './persist';
import { importSessionsOnLoad } from './session-store';

// The app's one state and its single writer. `AppProvider` loads the saved state at start and on
// Retry (moving in any trading sessions earlier builds kept on the device), and refuses changes
// until a load succeeds. Every change then goes through `change`: a pure operation, queued behind
// the one before, run on the last saved state, saved, and only then shown, so a refused save
// leaves everything as it was. The widgets are published after each save without holding it up,
// and ticks made on the list widget come back through the same queue when the app opens or becomes
// active again. Rows read `useSave` and `useBusy` rather than the whole context, so a save does not
// re-render every row.
// Tests: __tests__/app-state.test.ts.

// Publishes run one after another: the list widget reads its stored ticks before writing, so two
// overlapping publishes could otherwise carry a tick forward that the app had already recorded.
let widgetQueue: Promise<unknown> = Promise.resolve();
const publishWidgets = (state: State): Promise<void> => {
  const run = widgetQueue.then(() =>
    Promise.all([publishTodayWidget(state), publishTodayList(state)]).then(() => undefined),
  );
  widgetQueue = run.catch(() => {});
  return run;
};
const refreshWidget = (state: State) => void publishWidgets(state).catch(() => {});

/** Shown when the device refuses a save: nothing changed, and the storage's own error stays out. */
export const SAVE_FAILED =
  'Could not save on this device, so that change was not made. Try again; if it keeps failing, free up storage.';

// A save of a long history can hold the screen for a moment. Each change waits one painted frame
// first, so a check's pending look shows before the save starts; the timeout keeps a save from
// waiting while frames are paused (a hidden tab or a backgrounded app).
const afterPaint = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50);
    const done = () => {
      clearTimeout(timer);
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
    else done();
  });

type Context = {
  state: State;
  ready: boolean;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  retry: () => void;
  change: (operation: (current: State) => State) => Promise<boolean>;
};
const AppContext = createContext<Context | null>(null);
type Save = { change: Context['change']; isSaving: () => boolean };
// Rows read these instead of the whole context, so a saved change or a busy toggle re-renders only
// the parts that show it, not every row on Today.
const SaveContext = createContext<Save | null>(null);
const BusyContext = createContext(false);
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(emptyState),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const current = useRef(state),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    alive = useRef(true),
    pending = useRef(0),
    syncWidgets = useRef<() => Promise<void>>(async () => {});
  const load = useCallback(() => {
    void loadState()
      // Trading sessions earlier builds kept on this device are moved in before anything shows.
      .then((loaded) => importSessionsOnLoad(loaded, readDeviceSessions, saveState))
      .then((value) => {
        if (alive.current) {
          current.current = value;
          setState(value);
          // The widgets are published by the sync below, after any ticks made on them are read.
          setReady(true);
        }
      })
      .catch(() => {
        if (alive.current)
          setError('Could not read saved data. Nothing has been overwritten. Retry loading.');
      });
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    // A widget left on the midnight "load today" entry is refreshed if the app is still open.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 1, 0);
      timer = setTimeout(() => {
        void syncWidgets.current();
        schedule();
      }, midnight.getTime() - Date.now());
    };
    schedule();
    return () => clearTimeout(timer);
  }, [ready]);
  // `change` keeps one identity while the data stays loaded, so an effect that depends on it re-runs
  // when its own inputs change, not each time a save toggles busy or error.
  const change = useCallback<Context['change']>(
    (operation) => {
      pending.current++;
      setBusy(true);
      const action = queue.current.then(async () => {
        try {
          if (!ready) throw new Error('Wait for your saved data to load.');
          await afterPaint();
          // An operation's own refusal is written for the user and is shown as it is.
          const next = operation(current.current);
          try {
            await saveThenPublish(next, saveState, publishWidgets);
          } catch (cause) {
            // A storage failure's own text (a browser quota, a SQLite error) is never shown.
            throw new Error(SAVE_FAILED, { cause });
          }
          current.current = next;
          if (alive.current) {
            setState(next);
            setError(null);
          }
          return true;
        } catch (e) {
          if (alive.current)
            setError(e instanceof Error ? e.message : 'Could not save the change. Try again.');
          return false;
        } finally {
          pending.current--;
          if (alive.current) setBusy(pending.current > 0);
        }
      });
      queue.current = action;
      return action;
    },
    [ready],
  );
  useEffect(() => {
    if (!ready) return;
    // Ticks made on the Large widget are recorded as Done when the app opens or returns, then the
    // widgets are published again. A study timer in progress keeps its own screen: not ticked here.
    const sync = async () => {
      // Wait for any publish in progress, so its write never races this read of the ticks.
      await widgetQueue;
      const ticks = await readWidgetTicks().catch(() => []);
      const running = new Set<string>();
      for (const tick of ticks) if (await loadStudyRun(tick.id)) running.add(tick.id);
      const { applied } = applyWidgetTicks(current.current, ticks, new Date(), running);
      if (!applied.length) return refreshWidget(current.current);
      await change((s) => applyWidgetTicks(s, ticks, new Date(), running).state);
    };
    syncWidgets.current = sync;
    void sync();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void sync();
    });
    return () => subscription.remove();
  }, [ready, change]);
  const clearError = useCallback(() => setError(null), []);
  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    load();
  }, [load]);
  const value = useMemo(
    () => ({ state, ready, busy, error, clearError, retry, change }),
    [state, ready, busy, error, clearError, retry, change],
  );
  const isSaving = useCallback(() => pending.current > 0, []);
  const save = useMemo(() => ({ change, isSaving }), [change, isSaving]);
  return (
    <AppContext.Provider value={value}>
      <SaveContext.Provider value={save}>
        <BusyContext.Provider value={busy}>{children}</BusyContext.Provider>
      </SaveContext.Provider>
    </AppContext.Provider>
  );
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('AppProvider is missing.');
  return context;
}

/** `change`, and whether any save is still pending, without re-rendering on every saved change. */
export function useSave() {
  const context = useContext(SaveContext);
  if (!context) throw new Error('AppProvider is missing.');
  return context;
}
/** True while a save is pending. Re-renders only when that flips. */
export function useBusy() {
  return useContext(BusyContext);
}
