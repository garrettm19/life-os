import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDate } from '../domain/model';

/**
 * The phone's local date, kept current: read again just after each local midnight and whenever
 * the app returns to the foreground, so a screen left open (Week, Progress) moves to the new day
 * as Today does. It changes only when the date does, so nothing re-renders in between.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    // The same date string leaves the state as it is, so a check that finds no change renders nothing.
    const check = () => setToday(localDate());
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(
        () => {
          check();
          arm();
        },
        midnight.getTime() - now.getTime() + 1_000,
      );
    };
    arm();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') check();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}
