import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import {
  cancelStageAlertsExcept,
  listenForNotifications,
  replaceStudyReminders,
  scheduledStageAlerts,
} from '../data/notifier';
import { loadStudyRun } from '../data/study-store';
import { studyReminders } from '../domain/reminders';
import { phaseAt } from '../domain/study';
import { useApp } from '../state/app-state';

/**
 * Keeps scheduled study reminders matching saved state: after a change is saved and whenever the
 * app returns to the foreground. It never asks for permission and schedules nothing without it.
 * Tapping a study notification opens Today, where the study row is.
 */
export function ReminderSync() {
  const { state, ready } = useApp();
  const router = useRouter();
  const [wake, setWake] = useState(0);
  const last = useRef<string | null>(null);
  // Opening a reminder goes to Today without stacking another copy of it.
  useEffect(() => listenForNotifications(() => router.dismissTo('/')), [router]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') setWake((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const list = studyReminders(state, Date.now());
    const key = JSON.stringify(list);
    if (key === last.current) return;
    last.current = key;
    // Not scheduled (no permission yet) or failed: try again on the next change or foreground.
    void replaceStudyReminders(list)
      .then((scheduled) => {
        if (!scheduled) last.current = null;
      })
      .catch(() => {
        last.current = null;
      });
  }, [state, ready, wake]);
  // A stage alert outlives its session only by mistake (a session ended elsewhere, Reset, restore).
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      const running = new Set<string>();
      for (const blockId of await scheduledStageAlerts()) {
        const run = await loadStudyRun(blockId);
        if (run && phaseAt(run, Date.now()) === 'running') running.add(blockId);
      }
      await cancelStageAlertsExcept(running);
    })().catch(() => {});
    // Also after every saved change, so Reset and restore (which clear the session) take its alert.
  }, [ready, wake, state]);
  return null;
}
