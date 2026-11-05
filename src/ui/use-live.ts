import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { RuleBook, State } from '../domain/model';
import { LiveContext, liveContext } from '../domain/trading-live';
import { TradeStatus, tradeStatus } from '../domain/trading-status';
import { useApp, useSave } from '../state/app-state';
import { feelStep } from './feel';

/** How often the live cockpit reads the clock. Cooldowns show an end time, so nothing counts down. */
export const LIVE_TICK = 30_000;

/**
 * The clock the live cockpit reads: every 30 seconds, and at once when the app comes back to the
 * front, so a status never waits a tick after the phone was put away.
 */
export function useLiveClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, LIVE_TICK);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return now;
}

/**
 * The trading cockpit's context and its one status (`tradeStatus`), read from the saved data and
 * the clock in one memo: every screen that shows the status reads it here.
 */
export function useLiveStatus(book: RuleBook): { ctx: LiveContext; status: TradeStatus } {
  const { state } = useApp();
  const now = useLiveClock();
  const ctx = useMemo(() => liveContext(state, book, now), [state, book, now]);
  const status = useMemo(() => tradeStatus(ctx), [ctx]);
  return { ctx, status };
}

/** A live write, at the time of the tap: saved, or refused with its own message. */
export type LiveWrite = (write: (state: State, at: string) => State) => Promise<boolean>;

/**
 * Runs a trading write through the saved data's `change`: it is saved, or nothing changes and the
 * refusal is shown and spoken as the app's error. The identity never changes, so controls that
 * take it re-render only for their own values.
 */
export function useLiveWrite(): LiveWrite {
  const { change } = useSave();
  return useCallback(
    async (write) => {
      // The time of the tap, not of the save a frame later.
      const at = new Date().toISOString();
      const ok = await change((s) => write(s, at));
      if (ok) feelStep();
      return ok;
    },
    [change],
  );
}
