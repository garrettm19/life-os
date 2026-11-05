import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/app-state';
import { newSession } from '../domain/trading';
import { sessionUnreadable } from '../domain/trading-sessions';

/**
 * A daily candle's trading session, by its candle date, from the saved data: the same record on
 * every screen, as saved, for reading (the cockpit writes through `useLiveWrite`). A session that
 * could not be read when the device's earlier records were moved in is reported (`loadFailed`),
 * never taken for an empty day.
 */
export function useTradingSession(date: string) {
  const { state, ready } = useApp();
  const stored = state.tradingSessions[date];
  const session = useMemo(() => stored ?? newSession(date), [stored, date]);
  const loadFailed = sessionUnreadable(state, date);
  // A session that cannot be read is never shown as loaded, so nothing takes it for an empty day.
  return { session, loaded: ready && !loadFailed, loadFailed };
}

/** The current time, ticking every `ms` until `until` (a timestamp), or not at all when null. */
export function useNow(until: number | null, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(timer);
    };
    // The first tick comes at once: the clock is read, never counted.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [until, ms]);
  return now;
}
