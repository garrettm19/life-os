import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { housekeepingLine } from '../domain/housekeeping';
import { useApp } from '../state/app-state';
import { useAnnouncement } from './announce';
import { measuredBackupBytes } from './backup-size';
import { Button, LinkButton, styles } from './components';
import { useBackupExport } from './use-backup-export';

/** Not now on a backup line hides it until the app is next launched; it is never saved. */
let backupDeferred = false;

/**
 * The one housekeeping line on Today (`housekeepingLine`): the weekly review, a backup that is due,
 * or a backup nearing its size limit, never more than one. The backup line exports in one tap; on
 * iPhone the share sheet cannot say whether the file was saved, so Saved it records the backup and
 * Not now hides the line for now.
 */
export function HousekeepingLine({ now }: { now: Date }) {
  const { state } = useApp();
  const backup = useBackupExport();
  const [, setDeferred] = useState(backupDeferred);
  useAnnouncement(backup.error);
  const line = housekeepingLine(state, now, measuredBackupBytes());
  // While an export waits for its answer, the line stays, even as the reminder's own copy changes.
  if (backup.unconfirmed)
    return (
      <View testID="housekeeping" style={{ gap: 8 }}>
        <Text style={styles.muted}>Did you save the backup to Files or iCloud Drive?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Button
            small
            title="Saved it"
            label="I saved the backup"
            disabled={backup.working}
            onPress={() => void backup.confirmSaved()}
          />
          <LinkButton
            title="Not now"
            tone="dim"
            onPress={() => {
              backupDeferred = true;
              backup.reset();
              setDeferred(true);
            }}
          />
        </View>
      </View>
    );
  if (!line || (line.kind === 'backup' && backupDeferred)) return null;
  return (
    <View testID="housekeeping" style={{ gap: 4 }}>
      {line.kind === 'review' ? (
        <LinkButton
          title={line.text}
          label="Two minutes on your week? Open the weekly review."
          tone="dim"
          onPress={() => router.push({ pathname: '/review', params: { review: line.week } })}
        />
      ) : line.kind === 'backup' ? (
        <LinkButton
          title={line.text}
          label={`${line.text} Export a backup now.`}
          tone="dim"
          onPress={() => void backup.save()}
        />
      ) : (
        <LinkButton
          title={line.text}
          label={`${line.text} Open Backup and restore.`}
          tone="dim"
          onPress={() => router.push('/backup')}
        />
      )}
      {backup.error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {backup.error}
        </Text>
      )}
    </View>
  );
}
