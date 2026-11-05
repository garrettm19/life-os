import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Speak a status change through VoiceOver/TalkBack. A no-op where no screen reader API exists. */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility?.(message);
}

/** Announce a message each time it appears or changes; callers set it only after a save settles. */
export function useAnnouncement(message: string | null | undefined): void {
  useEffect(() => {
    if (message) announce(message);
  }, [message]);
}
