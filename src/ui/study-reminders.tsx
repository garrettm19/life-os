import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import {
  NotifyPermission,
  notificationPermission,
  requestNotificationPermission,
} from '../data/notifier';
import { REMINDER_DAYS } from '../domain/reminders';
import { Button, Field, styles } from './components';
import { Toggle } from './list';

export type ReminderDraft = {
  start: boolean;
  evening: boolean;
  eveningText: string;
  stageEnd: boolean;
};

function permissionLine(permission: NotifyPermission | null, anyOn: boolean): string | null {
  if (permission === 'unsupported')
    return 'Reminders work in the iPhone app. This preview cannot schedule notifications.';
  if (permission === 'denied')
    return 'Notifications are off for Life OS in iOS Settings, so these reminders cannot appear.';
  if (permission === 'granted') return anyOn ? 'Notifications are allowed for Life OS.' : null;
  return 'Life OS asks for notification permission only when you turn a reminder on.';
}

/**
 * Study reminder choices. Turning one on is the only moment Life OS asks iOS for notification
 * permission; a refusal leaves the choice saved and says how to allow it later.
 */
export function ReminderSettings({
  value,
  onChange,
  hasTime,
}: {
  value: ReminderDraft;
  onChange: (next: ReminderDraft) => void;
  hasTime: boolean;
}) {
  const [permission, setPermission] = useState<NotifyPermission | null>(null);
  useEffect(() => {
    let live = true;
    void notificationPermission().then((p) => live && setPermission(p));
    return () => {
      live = false;
    };
  }, []);
  const toggle = (patch: Partial<ReminderDraft>, turningOn: boolean) => {
    onChange({ ...value, ...patch });
    if (turningOn) void requestNotificationPermission().then(setPermission);
  };
  const anyOn = value.start || value.evening || value.stageEnd;
  const line = permissionLine(permission, anyOn);
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.label}>Reminders</Text>
      <Toggle
        title="Daily study reminder"
        detail={value.start ? 'On, at your study time on each study day' : 'Off'}
        label="Remind me at my study time"
        value={value.start}
        onChange={(on) => toggle({ start: on }, on)}
      />
      {value.start && !hasTime && (
        <Text style={styles.muted}>Choose a study time above; the reminder uses it.</Text>
      )}
      <Text style={styles.muted}>
        Repeats on each study day at your study time, for as long as it is on, even if you do not
        open Life OS. It is a general reminder, so it also arrives on a day you have already
        studied. Turn it off to pause; your time is kept.
      </Text>
      <Toggle
        title="Evening reminder"
        detail={value.evening ? 'On, only while the study is still open' : 'Off'}
        label="Evening reminder if the study is still open"
        value={value.evening}
        onChange={(on) => toggle({ evening: on }, on)}
      />
      {value.evening && (
        <Text style={styles.muted}>
          Only for days still open, so it is planned a week ahead each time Life OS runs. If the app
          is not opened for {REMINDER_DAYS} days, it stops until you open it again.
        </Text>
      )}
      {value.evening && (
        <Field
          label="Evening reminder time (24-hour)"
          value={value.eveningText}
          onChange={(eveningText) => onChange({ ...value, eveningText })}
          placeholder="HH:MM"
          time
        />
      )}
      <Toggle
        title="Alert when a stage ends"
        detail={value.stageEnd ? "On, when a timed stage's time is up" : 'Off'}
        label="Alert when a stage's time is up"
        value={value.stageEnd}
        onChange={(on) => toggle({ stageEnd: on }, on)}
      />
      {line && <Text style={styles.muted}>{line}</Text>}
      {permission === 'denied' && (
        <Button
          secondary
          small
          title="Open iOS Settings"
          onPress={() => void Linking.openSettings().catch(() => {})}
        />
      )}
      <Text style={styles.muted}>
        Tapping a reminder opens Today; it never marks anything done. Notification text can show on
        the lock screen, so a private objective is never named.
      </Text>
    </View>
  );
}
