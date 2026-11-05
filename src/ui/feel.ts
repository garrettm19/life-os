import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Touch feedback for real progress only: a light tap when an objective is saved as done or a
// trading cockpit step is saved, and the success pattern when the day is cleared. iOS turns
// haptics off with System Haptics; the browser preview has none. A failure is never shown:
// feedback is a nicety, not part of the record.

export function feelDone(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A cockpit step saved: the same light tap, never for a tick or a choice that saves nothing. */
export function feelStep(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function feelCleared(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
