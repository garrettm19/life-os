import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import {
  afterRestore,
  MAX_BACKUP_BYTES,
  ParsedBackup,
  parseBackup,
  restoredState,
} from '../domain/backup';
import { changeLine, restorePreview } from '../domain/restore-preview';
import { pickJson } from '../data/pick-json';
import { sessionStore } from '../data/timer-store';
import { useApp } from '../state/app-state';
import { replaceAllState } from '../state/session-store';
import { useAnnouncement } from './announce';
import { Button, Sheet, styles } from './components';
import { IconTile } from './list';
import { fonts, palette, type } from './theme';

/** Said once a backup is restored, above what is still to do on this phone. */
export const RESTORED_LINE =
  'Backup restored on this device. Goals, programs and recorded history are available.';

export type Restore = {
  /** The backup chosen and read, waiting for Restore and replace; null while none is. */
  pending: ParsedBackup | null;
  working: boolean;
  /** Why the chosen file could not be read; the saved data has not changed. */
  error: string | null;
  /** What to do on this phone after the restore just saved; null until one has. */
  steps: string[] | null;
  /** Opens the file picker at once, then reads and checks the file chosen. */
  choose: () => Promise<void>;
  /** Replaces the whole saved state with the pending backup, after its own confirmation. */
  restore: () => Promise<void>;
  /** Closes the preview without changing anything, and clears any notice. */
  dismiss: () => void;
};

/**
 * Choosing, previewing and restoring a backup, from Backup and restore or from the empty Today.
 * The restore itself goes through `replaceAllState`, the one path for replacing the whole state.
 */
export function useRestore(onStart?: () => void): Restore {
  const { change, clearError } = useApp();
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[] | null>(null);
  useAnnouncement(error);
  useAnnouncement(steps ? RESTORED_LINE : null);
  const choose = async () => {
    setWorking(true);
    setError(null);
    setSteps(null);
    clearError();
    onStart?.();
    try {
      const raw = await pickJson(MAX_BACKUP_BYTES, 'backup');
      if (raw !== null) setPending(parseBackup(raw));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not read the backup. Your saved data has not changed.',
      );
    } finally {
      setWorking(false);
    }
  };
  const restore = async () => {
    if (!pending) return;
    const next = restoredState(pending);
    // Restore replaces everything, including in-progress circuits that belonged to the old data.
    // A refused or failed save puts them back and changes nothing.
    if (await replaceAllState(() => next, change, sessionStore)) {
      setPending(null);
      setError(null);
      setSteps(afterRestore(next));
    }
  };
  const dismiss = useCallback(() => {
    setPending(null);
    setSteps(null);
  }, []);
  return { pending, working, error, steps, choose, restore, dismiss };
}

/** What a restore cannot bring back, listed once it has saved: one plain notice. */
export function RestoreDone({ steps, close }: { steps: string[]; close?: () => void }) {
  return (
    <View testID="restore-done" style={[styles.card, { gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile name="check" tone="done" size={40} />
        <Text style={[styles.body, { flex: 1 }]}>{RESTORED_LINE}</Text>
      </View>
      <Text style={{ ...type.callout, color: palette.accent }}>Still to do on this phone</Text>
      {steps.map((step) => (
        <Text key={step} style={styles.body}>
          • {step}
        </Text>
      ))}
      {close && <Button secondary small title="OK" label="Hide this notice" onPress={close} />}
    </View>
  );
}

/** The preview of the chosen backup and its Restore and replace confirmation. */
export function RestoreSheet({ restore }: { restore: Restore }) {
  const { state } = useApp();
  const { pending } = restore;
  // What restoring would change, compared before anything is replaced (counts only, no values).
  // It compares every record on both sides, so it reruns only when either side changes.
  const preview = useMemo(
    () => (pending ? restorePreview(state, pending.state) : null),
    [state, pending],
  );
  return (
    <Sheet
      title="Replace this device’s saved data?"
      visible={pending !== null}
      close={restore.dismiss}>
      {pending && (
        <>
          <View style={panel}>
            <IconTile name="backup" tone="sky" size={40} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={{ ...type.item, ...fonts.semibold }}>
                Backup created {new Date(pending.createdAt).toLocaleString()}.
              </Text>
              <Text style={type.caption}>
                {pending.state.goals.length} goals · {pending.state.programs.length} programs ·{' '}
                {Object.keys(pending.state.days).length} planned{' '}
                {Object.keys(pending.state.days).length === 1 ? 'day' : 'days'}
              </Text>
              <Text style={type.caption}>
                {pending.state.measurements.length} weights · {pending.state.workoutSessions.length}{' '}
                workouts · {pending.state.moneyReviews.length} money reviews ·{' '}
                {pending.state.lifeLog.length} log entries · {pending.state.intervalSessions.length}{' '}
                circuits
              </Text>
            </View>
          </View>
          {pending.sourceVersion === 1 && (
            <Text style={styles.body}>
              This backup was made by an older version of Life OS, before weights, workout logs,
              money reviews and log entries existed. It contains none of them.
            </Text>
          )}
          {pending.sourceVersion === 2 && (
            <Text style={styles.body}>
              This backup was made by an older version of Life OS, before timed circuits existed. It
              contains no circuits or circuit sessions.
            </Text>
          )}
          {pending.sourceVersion === 3 && (
            <Text style={styles.body}>
              This backup was made by an earlier version of Life OS, before the 90-day focus, weekly
              reviews and skill checkpoints existed. It contains none of them.
            </Text>
          )}
          {pending.sourceVersion < 5 && Object.keys(state.tradingSessions).length > 0 && (
            <Text style={styles.body}>
              This backup was made before trading sessions were kept in backups. Restoring it
              replaces this device&apos;s trading sessions, their limits and how they ended, with
              none.
            </Text>
          )}
          {preview && !preview.unchanged && (
            <View accessibilityRole="alert" style={[styles.notice, { gap: 6 }]}>
              <Text style={{ ...type.callout, color: palette.accent }}>
                What restoring changes on this device
              </Text>
              {preview.changes.map((change) => (
                <Text key={change.label} style={styles.body}>
                  {changeLine(change)}
                </Text>
              ))}
              {preview.settingsChanged && (
                <Text style={styles.body}>Settings: the backup&apos;s settings replace yours</Text>
              )}
              {preview.notesChanged && (
                <Text style={styles.body}>Setup notes: the backup&apos;s notes replace yours</Text>
              )}
              <Text style={styles.muted}>
                Nothing is merged. Export your current data first if you want to keep it.
              </Text>
            </View>
          )}
          {preview?.unchanged && (
            <Text style={styles.body}>This backup holds exactly the data on this device.</Text>
          )}
          {preview?.widgetTurnsOff && (
            <Text style={styles.muted}>
              The Home Screen day status turns off: backups never carry it. Turn it on again in
              Settings if you want it.
            </Text>
          )}
          {preview?.liveTurnsOff && (
            <Text style={styles.muted}>
              Live trading turns off: backups never carry it. Turn it on again in Your limits, where
              it asks the money question again.
            </Text>
          )}
          <Text style={styles.body}>
            Restoring replaces all current goals, programs, settings, history, weights, workouts,
            money reviews and log entries with this backup.
          </Text>
          <Text style={styles.muted}>
            Closing leaves everything as it is. No data is replaced until you confirm.
          </Text>
          <Button title="Restore and replace saved data" onPress={() => void restore.restore()} />
        </>
      )}
    </Sheet>
  );
}

/** A panel inside the sheet: the page's color under the sheet's card color, 20 pt corners. */
const panel = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 14,
  padding: 16,
  borderRadius: 20,
  backgroundColor: palette.canvas,
} as const;
