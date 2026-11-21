import { useCallback, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useApp } from '../state/app-state';
import { setupGaps } from '../domain/setup';
import { replaceAllState } from '../state/session-store';
import { sessionStore } from '../data/timer-store';
import {
  Goal,
  Settings,
  emptyState,
  parseTime,
  timeInput,
  validateSettings,
} from '../domain/model';
import { GoalEditor } from '../ui/goal-editor';
import { addGoal } from '../domain/goals';
import { useSetupImport } from '../ui/setup-import';
import { measureBackup } from '../ui/backup-size';
import { backupSizeWarning } from '../domain/housekeeping';
import { MAX_BACKUP_BYTES } from '../domain/backup';
import {
  Button,
  Field,
  Page,
  Sheet,
  StartTrackingSheet,
  TRACKING_STARTED,
  TimeField,
  styles,
} from '../ui/components';
import { Disclosure, LinkButton } from '../ui/controls';
import { fonts, palette, type } from '../ui/theme';
import { Group, GroupBody, IconTile, Row, Toggle } from '../ui/list';
import { useAnnouncement } from '../ui/announce';
import { newId } from '../ui/ids';
import { lastBackupText } from '../domain/backup-reminder';

const SCHEDULE_SAVED =
  'Saved. Existing blocks keep their history; generate or edit the day to apply changes.';

/** What a successful setup import left on the device, e.g. "11 programs and 25 routines". */
function importedText({ programs, routines }: { programs: number; routines: number }): string {
  return `This device now has ${programs} program${programs === 1 ? '' : 's'} and ${routines} routine${routines === 1 ? '' : 's'}.`;
}

const fields: {
  key: Exclude<keyof Settings, 'widgetDayStatus' | 'timerCue' | 'lastBackupAt'>;
  label: string;
  type: 'time' | 'duration';
  optional?: boolean;
  /** A line under the field. */
  hint?: string;
}[] = [
  // The start of the planning day only: the one "Up by" time lives on the morning anchor.
  {
    key: 'wake',
    label: 'Day starts (for planning)',
    type: 'time',
    hint: 'Not a goal. Your morning time lives on your anchor routine.',
  },
  { key: 'bedtime', label: 'Bedtime', type: 'time' },
  {
    key: 'workStart',
    label: 'Morning work starts',
    type: 'time',
    optional: true,
  },
  { key: 'workEnd', label: 'Morning work ends', type: 'time', optional: true },
  {
    key: 'scrumStart',
    label: 'Weekday scrum starts',
    type: 'time',
    optional: true,
  },
  {
    key: 'scrumDuration',
    label: 'Scrum duration (minutes)',
    type: 'duration',
    optional: true,
  },
  {
    key: 'thursdayMeetingStart',
    label: 'Thursday meeting starts',
    type: 'time',
    optional: true,
  },
  {
    key: 'thursdayMeetingDuration',
    label: 'Thursday meeting duration (minutes)',
    type: 'duration',
    optional: true,
  },
  {
    key: 'gymTravel',
    label: 'Gym travel/preparation total (minutes; 0 if included)',
    type: 'duration',
    optional: true,
  },
  {
    key: 'eveningWorkMinutes',
    label: 'Remaining work (minutes; flexible placement)',
    type: 'duration',
    optional: true,
  },
];
export default function SettingsScreen() {
  const router = useRouter();
  const { state, change, clearError } = useApp(),
    [edits, setValues] = useState<Record<string, string>>({}),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [raw, setRaw] = useState(''),
    [pasting, setPasting] = useState(false);
  // Measured when Settings opens, never on a save; Today's housekeeping line reads it too.
  const bytes = useMemo(() => measureBackup(state), [state]);
  // Feedback sits beside the control that caused it, never off screen at the top of the page.
  const [scheduleError, setScheduleError] = useState<string | null>(null),
    [scheduleSaved, setScheduleSaved] = useState(false),
    [imported, setImported] = useState<{
      programs: number;
      routines: number;
      /** The import was the first step on an empty device, so its card leads the page. */
      first: boolean;
    } | null>(null);
  const [goalName, setGoalName] = useState(''),
    [goalTarget, setGoalTarget] = useState(''),
    [confirmReset, setConfirmReset] = useState(false),
    [confirmStart, setConfirmStart] = useState(false),
    [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  useFocusEffect(
    useCallback(() => {
      return () => {
        setConfirmReset(false);
        setConfirmStart(false);
        setEditingGoal(null);
      };
    }, []),
  );
  useAnnouncement(error);
  useAnnouncement(notice);
  useAnnouncement(scheduleError);
  useAnnouncement(scheduleSaved ? SCHEDULE_SAVED : null);
  useAnnouncement(imported && importedText(imported));
  const values = {
    ...Object.fromEntries(
      fields.map((f) => [
        f.key,
        state.settings[f.key] === null
          ? ''
          : f.type === 'time'
            ? timeInput(state.settings[f.key]!)
            : String(state.settings[f.key]),
      ]),
    ),
    ...edits,
  };
  const save = async () => {
    try {
      const next = { ...state.settings };
      for (const f of fields) {
        const v = values[f.key]?.trim() ?? '';
        if (!v && !f.optional) throw new Error(`Enter ${f.label.toLowerCase()}.`);
        try {
          next[f.key] = !v
            ? (null as never)
            : f.type === 'time'
              ? parseTime(v, f.key === 'bedtime')
              : Number(v);
        } catch (e) {
          // Name the field: the message is shown by the Save button, far from most fields.
          throw new Error(`${f.label}: ${e instanceof Error ? e.message : 'check this time.'}`);
        }
      }
      validateSettings(next);
      if (await change((s) => ({ ...s, settings: next }))) {
        setValues({});
        setScheduleError(null);
        setScheduleSaved(true);
      }
    } catch (e) {
      setScheduleSaved(false);
      setScheduleError(e instanceof Error ? e.message : 'Check these settings.');
    }
  };
  const setup = useSetupImport({
    onError: setError,
    onImported: (result) => {
      setValues({});
      setRaw('');
      setImported(result);
      setError(null);
    },
  });
  const { choose, importText } = setup;
  const gaps = state.source !== 'demo' ? setupGaps(state) : [];
  // On an empty device the import is the next step, so it leads the page (Load my setup on Today
  // opens here); its result stays in that place.
  const importFirst = !state.programs.length || !!imported?.first;
  const importSection = (
    <>
      {imported && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconTile name="check" tone="done" size={40} />
            <Text accessibilityRole="header" style={[type.cardTitle, { flex: 1 }]}>
              Setup imported
            </Text>
          </View>
          <Text style={styles.body}>{importedText(imported)}</Text>
          {gaps.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={styles.heading}>Still to set up</Text>
              {gaps.map((gap) => (
                <Text key={gap} style={styles.muted}>
                  • {gap}
                </Text>
              ))}
            </View>
          )}
          <Button title="Open Today" onPress={() => router.dismissTo('/')} />
        </View>
      )}
      <Disclosure
        // Folded once an import succeeds; open on a first run, when importing is the next step.
        key={imported ? 'imported' : 'import'}
        title="Import a private setup"
        initiallyOpen={!imported && (!state.programs.length || state.source === 'demo')}>
        <Text style={styles.muted}>
          Import stays on this device. Programs merge by ID; importing into a demo replaces the
          demo.
        </Text>
        <Button title="Choose setup file" onPress={() => void choose()} />
        {/* Pasting is the rare path once a plan exists: one quiet link opens it. */}
        {state.programs.length > 0 && !pasting ? (
          <LinkButton title="Paste instead" onPress={() => setPasting(true)} />
        ) : (
          <>
            <Field label="Or paste setup JSON" value={raw} onChange={setRaw} multiline />
            <Button
              secondary
              title="Import pasted setup"
              disabled={!raw.trim()}
              onPress={() => void importText(raw)}
            />
          </>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.alert}>
            {error}
          </Text>
        )}
      </Disclosure>
    </>
  );
  return (
    <Page title="Settings" back hideError={confirmReset || confirmStart || editingGoal !== null}>
      {notice && (
        <View style={styles.card}>
          <Text style={styles.body}>{notice}</Text>
        </View>
      )}
      {importFirst && importSection}
      <Group
        title="Local data"
        icons
        footer="Everything stays on this phone: no cloud copy, and nothing is sent to analytics or AI.">
        <Row
          icon="backup"
          tone="sky"
          title="Backup and restore"
          detail={`Last backup: ${lastBackupText(state, new Date())}${
            bytes === null || !backupSizeWarning(bytes)
              ? ''
              : bytes > MAX_BACKUP_BYTES
                ? ' · over the 20 MB limit'
                : ` · ${Math.round((bytes / MAX_BACKUP_BYTES) * 100)}% of the 20 MB limit`
          }`}
          onPress={() => router.push('/backup')}
        />
        <Row
          icon="export"
          tone="plum"
          title="Export data for analysis"
          detail="A CSV or JSON file of what you choose"
          onPress={() => router.push('/export')}
        />
      </Group>
      <Group
        title="Home Screen widget"
        footer="Shows a check on the widget when the day is cleared. It counts private objectives too, and anyone who sees your Home Screen can see it.">
        <Toggle
          inset
          title="Show Day Cleared"
          detail={state.settings.widgetDayStatus ? 'Shown on the widget' : 'Hidden from the widget'}
          label="Show Day Cleared on the Home Screen widget"
          value={state.settings.widgetDayStatus === true}
          onChange={(on) =>
            void change((s) => ({
              ...s,
              settings: { ...s.settings, widgetDayStatus: on },
            }))
          }
        />
      </Group>
      <Disclosure title="About widgets">
        <Text style={styles.muted}>
          Small and medium show your next action; Large lists today&apos;s public objectives and
          ticks one-tap ones. Private objectives never appear. Day Cleared counts every objective,
          private ones too, and anyone who sees your Home Screen can see it; it never shows titles,
          counts or streaks.
        </Text>
      </Disclosure>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={groupHeading}>
          Plan
        </Text>
        <Disclosure title="Day boundaries and work schedule">
          <Text style={styles.muted}>
            Times use the phone’s timezone. Blank means unknown. Work reserves time; personal tasks
            use the free slots. Weekend work can be added by hand.
          </Text>
          {fields.map((f) =>
            f.type === 'time' ? (
              <TimeField
                key={f.key}
                label={f.label}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues({ ...edits, [f.key]: v })}
                optional={f.optional}
                midnight={f.key === 'bedtime'}
                hint={f.hint}
              />
            ) : (
              <Field
                key={f.key}
                label={f.label + (f.optional ? ' · optional' : '')}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues({ ...edits, [f.key]: v })}
                numeric
                placeholder="Minutes"
                hint={f.hint}
              />
            ),
          )}
          {scheduleError && (
            <Text accessibilityRole="alert" style={styles.alert}>
              {scheduleError}
            </Text>
          )}
          <Button title="Save schedule settings" onPress={() => void save()} />
          {scheduleSaved && !Object.keys(edits).length && (
            <Text style={styles.muted}>{SCHEDULE_SAVED}</Text>
          )}
        </Disclosure>
        <Disclosure title="Goals" summary={String(state.goals.length)}>
          {state.goals.map((g) => (
            <View key={g.id} style={goalRow}>
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Text style={type.item}>{g.title}</Text>
                <Text style={type.caption}>
                  {g.desiredState || 'Success criteria still to decide'}
                </Text>
              </View>
              <Button
                secondary
                small
                title="Edit"
                label={`Edit goal ${g.title}`}
                onPress={() => {
                  clearError();
                  setEditingGoal(g);
                }}
              />
            </View>
          ))}
          <View style={{ gap: 12, paddingTop: state.goals.length ? 6 : 0 }}>
            <Text accessibilityRole="header" style={styles.heading}>
              Add a goal
            </Text>
            <Field label="Goal name" value={goalName} onChange={setGoalName} name />
            <Field
              label="What would success look like?"
              value={goalTarget}
              onChange={setGoalTarget}
              multiline
            />
            <Button
              title="Save goal"
              disabled={!goalName.trim()}
              needs="Give the goal a name to save it."
              onPress={() =>
                void change((s) => addGoal(s, newId('goal'), goalName, goalTarget)).then((ok) => {
                  if (ok) {
                    setGoalName('');
                    setGoalTarget('');
                  }
                })
              }
            />
          </View>
        </Disclosure>
        {!importFirst && importSection}
      </View>
      {!imported && <SetupGaps gaps={gaps} />}
      {state.notes.length > 0 && (
        <Group title="Setup details to review">
          <GroupBody>
            {state.notes.map((note, i) => (
              <Text key={i} style={styles.muted}>
                • {note}
              </Text>
            ))}
          </GroupBody>
        </Group>
      )}
      <Group title="This phone" icons>
        {state.source === 'demo' && (
          <Row
            icon="play"
            tone="accent"
            title="Start tracking with these programs"
            detail="Keep these programs as your own and clear the fictional history"
            onPress={() => setConfirmStart(true)}
          />
        )}
        <Row
          icon="reset"
          tone="slate"
          title="Reset this device’s plan"
          detail="Clears the plan and records after you confirm. Back up first."
          onPress={() => setConfirmReset(true)}
        />
      </Group>
      {/* About: the version and where the data lives. */}
      <View
        testID="about"
        style={[styles.card, { alignItems: 'center', gap: 6, paddingVertical: 24 }]}>
        <IconTile name="sunrise" tone="accent" size={56} />
        <Text accessibilityRole="header" style={[type.cardTitle, { marginTop: 6 }]}>
          Life OS
        </Text>
        <Text style={[type.caption, fonts.figure, { fontSize: 14 }]}>
          Version {Constants.expoConfig?.version ?? ''}
        </Text>
        <Text style={[type.caption, { textAlign: 'center' }]}>
          Your plan and records live on this phone.
        </Text>
      </View>
      {editingGoal && (
        <GoalEditor key={editingGoal.id} goal={editingGoal} close={() => setEditingGoal(null)} />
      )}
      {setup.sheet}
      <StartTrackingSheet
        visible={confirmStart && state.source === 'demo'}
        close={() => setConfirmStart(false)}
        onStarted={() => {
          setError(null);
          setNotice(TRACKING_STARTED);
        }}
      />
      <Sheet title="Reset saved data?" visible={confirmReset} close={() => setConfirmReset(false)}>
        <Text style={styles.body}>
          This clears this device’s goals, routines, blocks and history. Your original setup file
          stays available for re-importing.
        </Text>
        <Button
          title="Clear this device’s plan"
          onPress={() =>
            // A whole-state replacement: in-progress circuits from the old data are cleared too.
            void replaceAllState(() => emptyState(), change, sessionStore).then((ok) => {
              if (ok) setConfirmReset(false);
            })
          }
        />
      </Sheet>
    </Page>
  );
}

/** What the current setup still needs, until each item is done; nothing when complete. */
function SetupGaps({ gaps }: { gaps: string[] }) {
  if (!gaps.length) return null;
  return (
    <View style={[styles.card, { gap: 6 }]}>
      <Text style={styles.heading}>Still to set up</Text>
      {gaps.map((gap) => (
        <Text key={gap} style={styles.muted}>
          • {gap}
        </Text>
      ))}
    </View>
  );
}

/** The heading over Settings' folded sections, as over a grouped list. */
const groupHeading: TextStyle = {
  ...fonts.semibold,
  fontSize: 15,
  lineHeight: 20,
  color: palette.label2,
  paddingHorizontal: 4,
};

/** A goal in the Goals section: its name and success line, with Edit at the trailing edge. */
const goalRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingVertical: 10,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: palette.separator,
};
