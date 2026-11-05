import { PlannedReminder } from '../domain/reminders';

// Browser preview: there are no scheduled local notifications. Every call is a safe no-op and the
// settings say reminders work in the iPhone app.

export type NotifyPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function notificationPermission(): Promise<NotifyPermission> {
  return 'unsupported';
}
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  return 'unsupported';
}
export async function replaceStudyReminders(_list: PlannedReminder[]): Promise<boolean> {
  return false;
}
export async function setStageAlert(_id: string, _alert: PlannedReminder | null): Promise<void> {}
export async function cancelStageAlertsExcept(_running: Set<string>): Promise<void> {}
export async function scheduledStageAlerts(): Promise<string[]> {
  return [];
}
export function listenForNotifications(_onOpen: () => void): () => void {
  return () => {};
}
