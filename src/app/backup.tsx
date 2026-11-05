import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { encodeBackup } from '../domain/backup';
import { exportBackup } from '../data/export-backup';
import { useApp } from '../state/app-state';
import { Button, Page, styles } from '../ui/components';
import { Group, GroupBody, IconTile } from '../ui/list';
import { type } from '../ui/theme';
import { lastBackupText } from '../domain/backup-reminder';
import { useAnnouncement } from '../ui/announce';
import { RestoreDone, RestoreSheet, useRestore } from '../ui/restore-sheet';

export default function BackupScreen() {
  const { state, change, clearError } = useApp();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A share-sheet export the user has not yet confirmed saving; only that confirmation records it.
  const [unconfirmed, setUnconfirmed] = useState(false);
  // Choosing a backup clears what an export said; the restore keeps its own notice and error.
  const restore = useRestore(() => {
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
  });
  const { dismiss } = restore;
  useAnnouncement(error);
  useAnnouncement(notice);
  // Only the time of the export is kept, for the backup reminder; it never travels in a backup.
  const recordBackup = () => {
    const at = new Date().toISOString();
    return change((s) => ({ ...s, settings: { ...s.settings, lastBackupAt: at } }));
  };
  const save = async () => {
    setWorking(true);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    dismiss();
    clearError();
    try {
      const result = await exportBackup(encodeBackup(state));
      setNotice(result.notice);
      if (result.confirmed) await recordBackup();
      else setUnconfirmed(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not export the backup. Your saved data has not changed.',
      );
    } finally {
      setWorking(false);
    }
  };
  const confirmSaved = async () => {
    setWorking(true);
    try {
      if (await recordBackup()) {
        setUnconfirmed(false);
        setNotice('Backup time recorded.');
      }
    } finally {
      setWorking(false);
    }
  };
  useFocusEffect(
    useCallback(() => {
      return () => {
        dismiss();
        // Leaving without confirming an export records nothing.
        setUnconfirmed(false);
        setNotice(null);
      };
    }, [dismiss]),
  );
  return (
    <Page title="Backup" back hideError={restore.pending !== null}>
      {(error ?? restore.error) && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error ?? restore.error}
        </Text>
      )}
      {notice && <Text style={styles.body}>{notice}</Text>}
      {restore.steps && <RestoreDone steps={restore.steps} />}
      {unconfirmed && (
        <Button
          secondary
          title="I saved the backup"
          onPress={() => void confirmSaved()}
          disabled={working}
        />
      )}
      <View style={[styles.card, { gap: 14 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconTile name="backup" tone="sky" size={44} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text accessibilityRole="header" style={type.cardTitle}>
              Back up
            </Text>
            <Text style={type.caption}>Last backup: {lastBackupText(state, new Date())}</Text>
          </View>
        </View>
        <Text style={styles.body}>
          One file with everything: goals, programs, records and history, workouts, weights, money,
          the log and your trading rules and sessions.
        </Text>
        <Button
          title="Export backup"
          onPress={() => void save()}
          disabled={working || restore.working}
        />
      </View>
      <Group
        title="Keeping it safe"
        footer="This file is not encrypted: it holds your body weight, money figures and private notes. Life OS uploads it nowhere; iCloud Drive keeps it in your own account.">
        <GroupBody>
          <Text style={type.caption}>
            Keep every backup in one iCloud Drive folder, such as Files → iCloud Drive → Life OS
            Backups, so a reinstall or a new phone finds the latest one. Each file is named with the
            date and time it was made.
          </Text>
          <Text style={type.caption}>
            A restore is only as fresh as the last backup: anything recorded after it is lost.
          </Text>
        </GroupBody>
      </Group>
      <View style={[styles.card, { gap: 14 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconTile name="reset" tone="plum" size={44} />
          <Text accessibilityRole="header" style={[type.cardTitle, { flex: 1 }]}>
            Restore
          </Text>
        </View>
        <Text style={styles.body}>
          Choose your latest backup and see what it holds before anything on this phone is replaced.
        </Text>
        <Text style={type.caption}>
          Everything comes back except the widget&apos;s Day Cleared status and live trading, which
          stay off until you turn them on again. Setup imports stay in Settings.
        </Text>
        <Button
          secondary
          title="Choose backup to restore"
          onPress={() => void restore.choose()}
          disabled={working || restore.working}
        />
      </View>
      <RestoreSheet restore={restore} />
    </Page>
  );
}
