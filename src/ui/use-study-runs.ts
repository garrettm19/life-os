import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { loadStudyRun } from '../data/study-store';
import { loadActiveCircuit } from '../data/timer-store';
import { ActiveCircuit } from '../domain/intervals';
import { StudyRun } from '../domain/study';

/**
 * The runs kept on this device for the given objectives, by block ID (`load` reads one), read
 * again when the screen gains focus, when the app returns to the foreground and whenever `version`
 * changes (for example after a timer screen closes). `load` is a module function, never remade.
 */
export function useSavedRuns<T>(
  load: (blockId: string) => Promise<T | null>,
  blockIds: string[],
  version: number,
): Record<string, T> {
  const [runs, setRuns] = useState<Record<string, T>>({});
  const [focus, setFocus] = useState(0);
  const key = blockIds.join('|');
  useFocusEffect(
    useCallback(() => {
      setFocus((n) => n + 1);
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') setFocus((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let live = true;
    const ids = key ? key.split('|') : [];
    void Promise.all(ids.map((id) => load(id))).then((loaded) => {
      if (!live) return;
      const next: Record<string, T> = {};
      loaded.forEach((run, i) => {
        if (run) next[ids[i]] = run;
      });
      setRuns(next);
    });
    return () => {
      live = false;
    };
  }, [load, key, version, focus]);
  return runs;
}

/** The study sessions in progress on this device for the given objectives (`useSavedRuns`). */
export function useStudyRuns(blockIds: string[], version: number): Record<string, StudyRun> {
  return useSavedRuns(loadStudyRun, blockIds, version);
}

/** The circuits in progress on this device for the given objectives (`useSavedRuns`). */
export function useCircuitRuns(blockIds: string[], version: number): Record<string, ActiveCircuit> {
  return useSavedRuns(loadActiveCircuit, blockIds, version);
}
