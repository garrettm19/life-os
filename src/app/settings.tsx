import { useCallback, useState } from 'react';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useApp } from '../state/app-state';
import {
  SetupPreview,
  TradingUpdate,
  importSetup,
  keptRecordsText,
  previewSetup,
  setupGaps,
} from '../domain/setup';
import { MAX_VIOLATIONS } from '../domain/records';
import { replaceAllState } from '../state/session-store';
import { sessionStore } from '../data/timer-store';
import { Goal, Settings, clock, emptyState, parseTime, validateSettings } from '../domain/model';
import { GoalEditor } from '../ui/goal-editor';
import { pickSetup } from '../data/pick-setup';
import {
  Button,
  Field,
  Page,
  Sheet,
  StartTrackingSheet,
  TRACKING_STARTED,
  styles,
} from '../ui/components';
import { Disclosure } from '../ui/controls';
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
  { key: 'bedtime', label: 'Bedtime (24:00 = midnight)', type: 'time' },
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
    [raw, setRaw] = useState('');
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
            ? clock(state.settings[f.key]!)
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
  // Importing shows what it would change first; nothing is saved until it is confirmed.
  const [preview, setPreview] = useState<{ text: string; summary: SetupPreview } | null>(null);
  const importText = async (text: string) => {
    try {
      setPreview({ text, summary: previewSetup(text, state, new Date().toISOString()) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that setup.');
    }
  };
  const confirmImport = async (pauseSameNamed: boolean) => {
    if (!preview) return;
    const text = preview.text;
    // Counted from the imported state itself, inside the save.
    const result = { programs: 0, routines: 0, first: !state.programs.length };
    const okay = await change((s) => {
      const next = importSetup(text, s, new Date().toISOString(), { pauseSameNamed });
      result.programs = next.programs.length;
      result.routines = next.programs.reduce((sum, p) => sum + p.routines.length, 0);
      return next;
    });
    if (okay) {
      setPreview(null);
      setValues({});
      setRaw('');
      setImported(result);
      setError(null);
    }
  };
  const choose = async () => {
    try {
      const text = await pickSetup();
      if (text !== null) await importText(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };
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
        <Field label="Or paste setup JSON" value={raw} onChange={setRaw} multiline />
        <Button
          secondary
          title="Import pasted setup"
          disabled={!raw.trim()}
          onPress={() => void importText(raw)}
        />
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
          detail={`Last backup: ${lastBackupText(state, new Date())}`}
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
        footer="Small and medium show your next action; Large lists today's public objectives and ticks one-tap ones. Private objectives never appear. Day Cleared counts every objective, private ones too, and anyone who sees your Home Screen can see it; it never shows titles, counts or streaks.">
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
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={groupHeading}>
          Plan
        </Text>
        <Disclosure title="Day boundaries and work schedule">
          <Text style={styles.muted}>
            Times use the phone’s timezone. Blank means unknown. Work reserves time; personal tasks
            use the free slots. Weekend work can be added by hand.
          </Text>
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label + (f.optional ? ' · optional' : '')}
              value={values[f.key] ?? ''}
              onChange={(v) => setValues({ ...edits, [f.key]: v })}
              numeric={f.type === 'duration'}
              time={f.type === 'time'}
              placeholder={f.type === 'time' ? '14:30' : 'Minutes'}
              hint={f.hint}
            />
          ))}
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
                void change((s) => ({
                  ...s,
                  source: 'personal',
                  goals: [
                    ...s.goals,
                    {
                      id: newId('goal'),
                      title: goalName.trim(),
                      desiredState: goalTarget.trim(),
                    },
                  ],
                })).then((ok) => {
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
      <Sheet title="Import this setup?" visible={preview !== null} close={() => setPreview(null)}>
        {preview && <SetupSummary summary={preview.summary} />}
        {preview?.summary.conflicts.length ? (
          <>
            <Button
              title={`Import and pause ${new Set(preview.summary.conflicts.map((c) => c.existing.id)).size} same-named`}
              label="Import and pause the existing routines with the same names"
              onPress={() => void confirmImport(true)}
            />
            <Button
              secondary
              title="Import and keep both"
              label="Import and keep the existing same-named routines active too"
              onPress={() => void confirmImport(false)}
            />
          </>
        ) : (
          <Button
            title="Import"
            label="Import this setup"
            onPress={() => void confirmImport(false)}
          />
        )}
        <Text style={styles.muted}>
          Closing imports nothing. Importing never changes recorded history, and pausing a routine
          keeps its history.
        </Text>
      </Sheet>
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

const RISK_NAMES: Record<TradingUpdate['risk'][number], string> = {
  maxContracts: 'contract',
  thesisRisk: 'thesis-risk',
  dailyLoss: 'daily loss',
};

/** "Updates Trading discipline: 2 items reworded and 6 hard violations added. …" */
function tradingUpdateText(update: TradingUpdate): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [
    update.reworded > 0 && `${plural(update.reworded, 'item')} reworded`,
    update.violationsAdded > 0 && `${plural(update.violationsAdded, 'hard violation')} added`,
    update.maxEntries !== null && `the entry limit set to ${update.maxEntries}`,
    update.instrument !== null && `the instrument set to ${update.instrument}`,
    update.risk.length > 0 &&
      `the ${update.risk.map((k) => RISK_NAMES[k]).join(', ')} limit${update.risk.length === 1 ? '' : 's'} set`,
  ].filter((p): p is string => !!p);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Updates Trading discipline${list ? `: ${list}` : ''}. Earlier reviews keep their answers and stay scored as they were.`;
}

/** What a setup import would change, in plain lists. */
function SetupSummary({ summary }: { summary: SetupPreview }) {
  const line = (label: string, items: string[]) =>
    items.length ? (
      <Text style={styles.body}>
        {label} ({items.length}): {items.join(', ')}
      </Text>
    ) : null;
  return (
    <View style={{ gap: 8 }}>
      {line('New programs', summary.programsAdded)}
      {line('Programs replaced by the file', summary.programsReplaced)}
      {line('Already the same', summary.programsUnchanged)}
      {line('New routines', summary.routinesAdded)}
      {line('Routines replaced by the file', summary.routinesReplaced)}
      {line('Optional (never block Day Cleared)', summary.optionalRoutines)}
      {line('Placed in the order of the day', summary.orderSet)}
      {summary.plansAdded + summary.circuitsAdded + summary.rulebooksAdded > 0 && (
        <Text style={styles.body}>
          Adds {summary.plansAdded} workout plan{summary.plansAdded === 1 ? '' : 's'},{' '}
          {summary.circuitsAdded} timed circuit{summary.circuitsAdded === 1 ? '' : 's'} and{' '}
          {summary.rulebooksAdded} rulebook{summary.rulebooksAdded === 1 ? '' : 's'}
          {summary.rulebooksWithTrading > 0 &&
            (summary.rulebooksAdded === 1
              ? ' with Trading discipline, starting today'
              : `, ${summary.rulebooksWithTrading} with Trading discipline, starting today`)}
          .
        </Text>
      )}
      {summary.tradingAdded > 0 && (
        <Text style={styles.body}>
          Adds Trading discipline to your trading rulebook, starting today. Its rules and earlier
          reviews stay exactly as they are.
        </Text>
      )}
      {summary.tradingUpdated && (
        <Text testID="trading-updated" style={styles.body}>
          {tradingUpdateText(summary.tradingUpdated)}
        </Text>
      )}
      {line(
        `Hard violations left out: Trading discipline holds at most ${MAX_VIOLATIONS}`,
        summary.violationsLeftOut,
      )}
      {keptRecordsText(summary.recordsKept) && (
        <Text style={styles.muted}>
          {keptRecordsText(summary.recordsKept)} in the file left alone: those routines already have
          one.
        </Text>
      )}
      {line('Kept as set on this device', summary.keptOnDevice)}
      <Text style={styles.body}>
        {summary.historyKept.days + summary.historyKept.records > 0
          ? `Keeps your history: ${summary.historyKept.days} recorded day${summary.historyKept.days === 1 ? '' : 's'} and ${summary.historyKept.records} record${summary.historyKept.records === 1 ? '' : 's'}, unchanged. `
          : ''}
        Nothing new starts before today.
      </Text>
      <Text style={styles.muted}>
        {summary.settingsReplaced ? 'Replaces your schedule settings. ' : 'Keeps your settings. '}
        {summary.notesReplaced ? 'Replaces your notes.' : 'Keeps your notes.'}
      </Text>
      {summary.gaps.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>Still to set up after importing</Text>
          {summary.gaps.map((gap) => (
            <Text key={gap} style={styles.muted}>
              • {gap}
            </Text>
          ))}
        </View>
      )}
      {summary.conflicts.length > 0 && (
        <View accessibilityRole="alert" style={[styles.notice, { gap: 6 }]}>
          <Text style={styles.heading}>Same names as your routines</Text>
          {summary.conflicts.map((c) => (
            <Text key={`${c.existing.id}-${c.incoming.id}`} style={styles.muted}>
              {c.title}: yours in {c.existing.program}, the file&apos;s in {c.incoming.program}
            </Text>
          ))}
          <Text style={styles.muted}>
            Pause yours to avoid doing the same thing twice, or keep both.
          </Text>
        </View>
      )}
    </View>
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
