import type * as NotificationsModule from 'expo-notifications';
import { PlannedReminder, REMINDER_PREFIX, STAGE_PREFIX } from '../domain/reminders';

// Local notifications for study reminders. Nothing here asks for permission except
// `requestNotificationPermission`, which runs only when the user switches a reminder on. Without
// permission, scheduling is skipped silently: reminders are a convenience, never a requirement.
// The module is loaded lazily so a client without its native code reports "unsupported" instead
// of failing to start.

export type NotifyPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

let loaded: Promise<typeof NotificationsModule | null> | undefined;
function notifications(): Promise<typeof NotificationsModule | null> {
  loaded ??= import('expo-notifications').catch(() => null);
  return loaded;
}

/** Tests only: replaces the native module with a stand-in (Jest cannot run a lazy import). */
export function setNotificationsModuleForTesting(module: unknown): void {
  loaded = Promise.resolve(module as typeof NotificationsModule);
}

// Every scheduling call runs after the previous one, so a newer schedule can never be overtaken by
// an older one still canceling and re-adding.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function permissionOf(status: { granted: boolean; canAskAgain: boolean }): NotifyPermission {
  if (status.granted) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

export async function notificationPermission(): Promise<NotifyPermission> {
  try {
    const N = await notifications();
    return N ? permissionOf(await N.getPermissionsAsync()) : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Shows the system prompt if iOS still allows asking; otherwise reports the current answer. */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  try {
    const N = await notifications();
    if (!N) return 'unsupported';
    const current = await N.getPermissionsAsync();
    if (current.granted || !current.canAskAgain) return permissionOf(current);
    return permissionOf(
      await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } }),
    );
  } catch {
    return 'unsupported';
  }
}

async function schedule(N: typeof NotificationsModule, reminder: PlannedReminder) {
  await N.scheduleNotificationAsync({
    identifier: reminder.id,
    content: { title: reminder.title, body: reminder.body, sound: 'default' },
    // A weekly calendar repeat follows the device's local time (time zones, clock changes); iOS
    // numbers weekdays 1–7 from Sunday.
    trigger: reminder.weekly
      ? {
          type: N.SchedulableTriggerInputTypes.WEEKLY,
          weekday: reminder.weekly.weekday + 1,
          hour: reminder.weekly.hour,
          minute: reminder.weekly.minute,
        }
      : { type: N.SchedulableTriggerInputTypes.DATE, date: reminder.at! },
  });
}

/**
 * Replaces every scheduled study reminder with `list`. Without permission it does nothing and
 * returns false, so the caller tries again later (for example after permission is granted in iOS
 * Settings).
 */
export function replaceStudyReminders(list: PlannedReminder[]): Promise<boolean> {
  return serial(async () => {
    const N = await notifications();
    if (!N) return false;
    // Cancelling needs no permission, so reminders turned off are removed even while
    // notifications are off in iOS Settings; only adding new ones waits for permission.
    const scheduled = await N.getAllScheduledNotificationsAsync();
    for (const n of scheduled)
      if (n.identifier.startsWith(REMINDER_PREFIX))
        await N.cancelScheduledNotificationAsync(n.identifier);
    if (!list.length) return true;
    if (!(await N.getPermissionsAsync()).granted) return false;
    // Each request on its own: a one-off already due (planned a moment ago) is left out, and one
    // refused request never stops the others; any failure reports false so the next sync retries.
    let complete = true;
    for (const reminder of list) {
      if (reminder.at !== null && reminder.at <= Date.now() + 1000) continue;
      try {
        await schedule(N, reminder);
      } catch {
        complete = false;
      }
    }
    return complete;
  });
}

/** Schedules (or with null, cancels) the alert for one session's running stage. */
export function setStageAlert(blockId: string, alert: PlannedReminder | null): Promise<void> {
  return serial(async () => {
    const N = await notifications();
    if (!N) return;
    await N.cancelScheduledNotificationAsync(`${STAGE_PREFIX}${blockId}`);
    if (alert && (await N.getPermissionsAsync()).granted) await schedule(N, alert);
  });
}

/** Cancels stage alerts whose session is no longer running (ended elsewhere, Reset, restore). */
export function cancelStageAlertsExcept(running: Set<string>): Promise<void> {
  return serial(async () => {
    const N = await notifications();
    if (!N) return;
    for (const n of await N.getAllScheduledNotificationsAsync())
      if (
        n.identifier.startsWith(STAGE_PREFIX) &&
        !running.has(n.identifier.slice(STAGE_PREFIX.length))
      )
        await N.cancelScheduledNotificationAsync(n.identifier);
  });
}

/** The stage alert ids still scheduled, as occurrence ids. */
export async function scheduledStageAlerts(): Promise<string[]> {
  const N = await notifications();
  if (!N) return [];
  return (await N.getAllScheduledNotificationsAsync())
    .map((n) => n.identifier)
    .filter((id) => id.startsWith(STAGE_PREFIX))
    .map((id) => id.slice(STAGE_PREFIX.length));
}

/**
 * Shows study notifications that arrive while Life OS is open (iOS hides them by default), and
 * calls `onOpen` when one is tapped. Returns a cleanup function.
 */
export function listenForNotifications(onOpen: () => void): () => void {
  let remove = () => {};
  let live = true;
  void notifications().then((N) => {
    if (!N || !live) return;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    const isStudy = (id: string) => id.startsWith(REMINDER_PREFIX) || id.startsWith(STAGE_PREFIX);
    const subscription = N.addNotificationResponseReceivedListener((response) => {
      if (isStudy(response.notification.request.identifier)) onOpen();
    });
    remove = () => subscription.remove();
    // A tap that launched the app arrives before this listener; it is read once here instead.
    void N.getLastNotificationResponseAsync()
      .then((response) => {
        if (live && response && isStudy(response.notification.request.identifier)) onOpen();
      })
      .catch(() => {});
  });
  return () => {
    live = false;
    remove();
  };
}
