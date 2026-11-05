import { useCallback, useEffect, useState } from 'react';
import { DayOrderRow } from '../ui/day-order-sheet';
import { FocusRow } from '../ui/focus-row';
import { GoalMap } from '../ui/goal-map';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/app-state';
import {
  IntervalRoutine,
  Program,
  Routine,
  clock,
  displayDate,
  displayTime,
  localDate,
  parseTime,
  shortDate,
} from '../domain/model';
import { canCarryAnchor, currentUpBy, firstTick, withAnchorTime } from '../domain/anchor';
import {
  NO_DUE_DAYS,
  blankHabit,
  blankProgram,
  composeRoutine,
  needsDueDays,
  upsertProgram,
  upsertRoutine,
} from '../domain/routines';
import { Button, Chip, Field, Page, SectionLabel, Sheet, styles } from '../ui/components';
import { LinkButton, Segmented, Weekdays } from '../ui/controls';
import { RoutineRow, routineKind } from '../ui/routine-row';
import { ChoiceRow, Group, IconTile, SearchField, Toggle } from '../ui/list';
import { programArea } from '../ui/areas';
import { dayOrderEntries } from '../domain/day-order';
import { palette, type } from '../ui/theme';
import { useAnnouncement } from '../ui/announce';
import { TemplateEditor } from '../ui/template-editor';
import { CircuitEditor } from '../ui/circuit-editor';
import { RotationEditor } from '../ui/rotation-editor';
import { RuleBookEditor } from '../ui/rulebook-editor';
import { offersRotation, rotationProgram } from '../domain/rotation';
import { newId } from '../ui/ids';
import {
  CORE_CIRCUIT,
  clockText,
  newCircuit,
  removeCircuit,
  saveCircuit,
  totalSeconds,
} from '../domain/intervals';
import { removeTemplate } from '../domain/workouts';
import { linksText as formatLinks, parseLinks } from '../ui/links';
import { OBJECTIVE_ICONS, OBJECTIVE_TYPES, RecordKind } from '../ui/objective-types';
import { AccountSetRule } from '../ui/account-set';
import { StudyPlanEditor } from '../ui/study-plan-editor';
import { DSA_STUDY, copyStudyPlan, planMinutes } from '../domain/study';
import { inRepeatWeek } from '../domain/repeat';

export default function ProgramsScreen() {
  const { state, change, ready, clearError } = useApp();
  // Today's "Change days, privacy or pause" opens that routine's editor here.
  const linked = useLocalSearchParams<{ routine?: string }>().routine;
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<{
      program: Program;
      routine: Routine;
    } | null>(null),
    [draft, setDraft] = useState<Program | null>(null);
  const [name, setName] = useState(''),
    [routineName, setRoutineName] = useState(''),
    [group, setGroup] = useState(''),
    [duration, setDuration] = useState(''),
    [start, setStart] = useState(''),
    [thursday, setThursday] = useState(''),
    [earliest, setEarliest] = useState(''),
    [latest, setLatest] = useState(''),
    [steps, setSteps] = useState('');
  const [days, setDays] = useState<number[] | null>(null),
    [everyWeeks, setEveryWeeks] = useState('1'),
    [enabled, setEnabled] = useState(false),
    [fixed, setFixed] = useState(false),
    [checklist, setChecklist] = useState(true),
    [hidden, setHidden] = useState(false),
    [scheduleOpen, setScheduleOpen] = useState(false),
    [goals, setGoals] = useState<string[]>([]),
    [error, setError] = useState<string | null>(null),
    [daysError, setDaysError] = useState<string | null>(null),
    [records, setRecords] = useState<RecordKind>('none'),
    [pickingType, setPickingType] = useState(false),
    [advancedOpen, setAdvancedOpen] = useState(false),
    [activityChoices, setActivityChoices] = useState(''),
    [rulesFor, setRulesFor] = useState<Routine | null>(null),
    [planFor, setPlanFor] = useState<Routine | null>(null),
    [circuitOf, setCircuitOf] = useState<IntervalRoutine | null>(null),
    [studyOf, setStudyOf] = useState<string | null>(null),
    [follows, setFollows] = useState<string[]>([]),
    [optional, setOptional] = useState(false),
    // The morning anchor's Up by time as typed, and whether to count mornings since the first tick.
    [upBy, setUpBy] = useState(''),
    [countEarlier, setCountEarlier] = useState(false),
    [linksText, setLinksText] = useState(''),
    [alternating, setAlternating] = useState(false),
    [variants, setVariants] = useState({ a: '', aSteps: '', b: '', bSteps: '' }),
    [anchor, setAnchor] = useState<string | null>(null),
    [rotationFor, setRotationFor] = useState<Program | null>(null),
    // A routine joins one of the existing programs or a new one; it never renames its program.
    [newProgram, setNewProgram] = useState(false),
    [lastProgram, setLastProgram] = useState<string | null>(null),
    // The form as it opened, to ask before Close throws edits away; set once the type is chosen.
    [baseline, setBaseline] = useState<string | null>(null),
    [confirmDiscard, setConfirmDiscard] = useState(false),
    // Saving would end the morning anchor and its history: asked once before it does.
    [confirmEndAnchor, setConfirmEndAnchor] = useState(false);
  const plans = new Map(state.workoutTemplates.map((t) => [t.routineId, t.exercises.length]));
  const circuits = new Map(state.intervalRoutines.map((c) => [c.routineId, c]));
  useAnnouncement(error);
  useAnnouncement(daysError);
  const fill = (program: Program, routine: Routine) => {
    setEditing({ program, routine });
    setName(program.title);
    setRoutineName(routine.title);
    setGroup(program.group);
    setDuration(String(routine.duration ?? ''));
    setStart(routine.preferredStart === null ? '' : clock(routine.preferredStart));
    setThursday(routine.thursdayStart == null ? '' : clock(routine.thursdayStart));
    setEarliest(routine.windowStart == null ? '' : clock(routine.windowStart));
    setLatest(routine.windowEnd == null ? '' : clock(routine.windowEnd));
    setSteps(routine.steps.join('\n'));
    setDays(routine.weekdays);
    setEveryWeeks(String(routine.repeat?.everyWeeks ?? 1));
    setFollows(routine.follows ?? []);
    setOptional(!!routine.optional);
    setUpBy(routine.anchor ? clock(currentUpBy(routine)!) : '');
    setCountEarlier(false);
    setActivityChoices((routine.activities ?? []).join('\n'));
    setLinksText(formatLinks(routine.links ?? []));
    setAlternating(!!routine.alternate);
    setAnchor(routine.alternate?.anchor ?? null);
    const [va, vb] = routine.alternate?.variants ?? [];
    setVariants({
      a: va?.title ?? '',
      aSteps: va?.steps.join('\n') ?? '',
      b: vb?.title ?? '',
      bSteps: vb?.steps.join('\n') ?? '',
    });
    setEnabled(routine.enabled);
    setFixed(routine.fixed);
    setChecklist(!!routine.checklist);
    setHidden(!!routine.private);
    setRecords(
      state.workoutTemplates.some((t) => t.routineId === routine.id)
        ? 'workout'
        : state.intervalRoutines.some((c) => c.routineId === routine.id)
          ? 'circuit'
          : routine.study
            ? 'study'
            : (routine.capture ?? 'none'),
    );
    setScheduleOpen(
      routine.preferredStart != null ||
        routine.thursdayStart != null ||
        routine.windowStart != null ||
        routine.windowEnd != null ||
        routine.fixed,
    );
    setGoals(program.goalIds);
    setError(null);
    setDaysError(null);
    setAdvancedOpen(false);
    setPickingType(false);
    setNewProgram(false);
    setBaseline(null);
    setConfirmDiscard(false);
    setConfirmEndAnchor(false);
  };
  const applyType = (value: RecordKind, isNew: boolean, named: string) => {
    setRecords(value);
    setPickingType(false);
    if (value !== 'none') setChecklist(true);
    if (value === 'weight' || value === 'money' || value === 'rules') setHidden(true);
    else if (isNew) setHidden(false);
    if (value === 'weight' && isNew) {
      setOptional(true);
      setDays((current) => (current?.length ? current : [0, 1, 2, 3, 4, 5, 6]));
      setDaysError(null);
    } else if (isNew && value !== 'weight') setOptional(false);
    if (value === 'study' && isNew) {
      if (!named.trim()) setRoutineName('Daily study');
      setDays((current) => (current?.length ? current : [0, 1, 2, 3, 4, 5, 6]));
      setDaysError(null);
    }
    if (value === 'circuit' && isNew && !named.trim()) {
      setRoutineName('Ab Circuit');
      setDuration(String(Math.round(totalSeconds(CORE_CIRCUIT) / 60)));
    }
  };
  const open = (program?: Program, routine?: Routine) => {
    // From the top, a new objective goes into the program last saved to, or a new program when
    // there is none yet; otherwise it waits for a program to be chosen.
    const last = program ? undefined : state.programs.find((item) => item.id === lastProgram);
    const nextProgram = program ?? last ?? blankProgram(newId('custom'));
    setDraft(null);
    fill(nextProgram, routine ?? blankHabit(newId(nextProgram.id)));
    setNewProgram(!program && !last && !state.programs.length);
    if (!routine) setPickingType(true);
  };
  // Opened once per link, while rendering; the link is then cleared so the same one can come again.
  const [handled, setHandled] = useState<string | null>(null);
  if (ready && linked && linked !== handled) {
    setHandled(linked);
    const program = state.programs.find((p) => p.routines.some((r) => r.id === linked));
    const routine = program?.routines.find((r) => r.id === linked);
    if (program && routine) open(program, routine);
  } else if (!linked && handled) setHandled(null);
  useEffect(() => {
    if (linked) router.setParams({ routine: undefined });
  }, [linked]);
  /** Add program, or Edit program for `program`: its name, group and goals. */
  const openProgram = (program?: Program) => {
    setEditing(null);
    setDraft(program ?? blankProgram(newId('custom')));
    setName(program?.title ?? '');
    setGroup(program?.group ?? 'Personal');
    setGoals(program?.goalIds ?? []);
    setError(null);
  };
  const attach = (program: Program) => {
    if (!editing) return;
    setEditing({ program, routine: editing.routine });
    setNewProgram(false);
    // A blank routine name falls back to the chosen program's name, never the one before it.
    setName(program.title);
    setError(null);
  };
  const startProgram = () => {
    if (!editing) return;
    setEditing({ program: blankProgram(newId('custom')), routine: editing.routine });
    setNewProgram(true);
    setName('');
    setGroup('Personal');
    setGoals([]);
    setError(null);
  };
  // The morning anchor goes on a plain checklist item, by the one rule in the domain, read
  // for the routine as this form will save it: with no record type, saving drops any workout plan
  // or circuit. The first time it is set, the user can count the mornings already ticked, from the
  // first tick, against the new time.
  const anchorable =
    !!editing &&
    records === 'none' &&
    canCarryAnchor(
      { ...editing.routine, checklist, study: undefined, capture: undefined },
      { programs: state.programs, workoutTemplates: [], intervalRoutines: [] },
    );
  const upByMinutes = (() => {
    try {
      return upBy.trim() ? parseTime(upBy) : null;
    } catch {
      return null;
    }
  })();
  const earlierTick =
    editing && anchorable && !editing.routine.anchor
      ? firstTick(state, editing.routine.id, localDate())
      : null;
  const save = async () => {
    try {
      if (!editing) return;
      // One message above Save at a time: an earlier one never outlives its fix.
      setError(null);
      clearError();
      // Clearing the time, or a change that leaves the routine unable to carry it, ends the anchor
      // and its history; pausing keeps both. Asked first, since earlier mornings stop counting.
      if (editing.routine.anchor && !(anchorable && upBy.trim()) && !confirmEndAnchor) {
        setConfirmEndAnchor(true);
        return;
      }
      const routine = composeRoutine(editing.routine, {
        title: routineName.trim() || name.trim(),
        duration,
        start,
        thursday,
        earliest,
        latest,
        weekdays: days,
        enabled,
        fixed,
        steps,
        checklist,
        private: hidden,
        capture:
          records === 'weight' ||
          records === 'money' ||
          records === 'activity' ||
          records === 'rules'
            ? records
            : null,
      });
      // The morning anchor: a plain checklist item only. A change of time is added from today, so an
      // earlier morning is never judged again.
      if (anchorable && upBy.trim()) {
        let minutes: number;
        try {
          minutes = parseTime(upBy);
        } catch (e) {
          throw new Error(`Up by: ${e instanceof Error ? e.message : 'check this time.'}`);
        }
        const today = localDate();
        routine.anchor = withAnchorTime(
          routine,
          minutes,
          today,
          countEarlier && earlierTick ? earlierTick : today,
        ).anchor;
      } else delete routine.anchor;
      if (follows.length) routine.follows = follows.filter((id) => id !== routine.id);
      else delete routine.follows;
      // Optional applies to checklist objectives only: a timed session is placed by generation.
      if (optional && checklist) routine.optional = true;
      else delete routine.optional;
      const choices = activityChoices
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (records === 'activity' && choices.length) routine.activities = choices;
      else delete routine.activities;
      const links = parseLinks(linksText);
      if (links.length) routine.links = links;
      else delete routine.links;
      // A study objective keeps its plan; a new one starts from the 25 + 30 + 5 minute guide and
      // its streak starts today, so earlier days are never scored.
      if (records === 'study')
        routine.study = editing.routine.study ?? {
          ...copyStudyPlan(DSA_STUDY),
          trackFrom: localDate(),
        };
      else delete routine.study;
      // Every few weeks counts from this week, unless the same repeat was already set.
      const every = Number(everyWeeks);
      if (every > 1 && !routine.study && !routine.bundledInto)
        routine.repeat =
          editing.routine.repeat?.everyWeeks === every
            ? editing.routine.repeat
            : { everyWeeks: every, anchor: localDate() };
      else delete routine.repeat;
      if (alternating) {
        if (!variants.a.trim() || !variants.b.trim())
          throw new Error('Name both alternating variants, or turn alternating off.');
        const lines = (text: string) =>
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        routine.alternate = {
          // The first variant falls on the day alternating was turned on, unless it already was.
          anchor: anchor ?? localDate(),
          variants: [
            { title: variants.a.trim(), steps: lines(variants.aSteps) },
            { title: variants.b.trim(), steps: lines(variants.bSteps) },
          ],
        };
      } else delete routine.alternate;
      const hadPlan = state.workoutTemplates.some((t) => t.routineId === routine.id);
      const hadCircuit = state.intervalRoutines.some((c) => c.routineId === routine.id);
      if (hadPlan && records !== 'workout' && rotationProgram(state.programs, routine.id))
        throw new Error('Remove this workout from its rotation before changing what it records.');
      const isNew = !state.programs.some((item) =>
        item.routines.some((entry) => entry.id === routine.id),
      );
      if (!newProgram && !state.programs.some((item) => item.id === editing.program.id)) {
        setError('Choose a program for this objective, or a new one.');
        return;
      }
      if (newProgram && !name.trim()) {
        setError('Give the new program a name.');
        return;
      }
      // Keep the sheet and every entered field; nothing is written until a day is chosen.
      if (isNew && needsDueDays(routine)) {
        setDaysError(NO_DUE_DAYS);
        return;
      }
      const okay = await change((current) => {
        // An existing program is joined as it is; only a new one takes the name typed here.
        const target = current.programs.find((item) => item.id === editing.program.id) ?? {
          ...editing.program,
          title: name,
          group,
          goalIds: goals,
          routines: [],
        };
        const next = upsertRoutine(current, target, routine);
        // Choosing another record type retires the plan; logged workouts keep their own copy.
        const planned = records !== 'workout' && hadPlan ? removeTemplate(next, routine.id) : next;
        // Likewise a circuit; recorded circuit sessions stay.
        const timed =
          records !== 'circuit' && hadCircuit ? removeCircuit(planned, routine.id) : planned;
        // A new circuit starts from the preloaded 14-minute ab circuit, editable right away.
        return records === 'circuit' && !hadCircuit
          ? saveCircuit(
              timed,
              newCircuit(
                routine.id,
                routine.title,
                CORE_CIRCUIT,
                newId('circuit'),
                new Date().toISOString(),
              ),
            )
          : timed;
      });
      if (okay) {
        setEditing(null);
        setLastProgram(editing.program.id);
        // A new workout routine goes straight to its plan.
        if (records === 'workout' && !hadPlan) setPlanFor(routine);
        // A new study objective goes straight to its plan, time and reminders.
        if (records === 'study' && !editing.routine.study) setStudyOf(routine.id);
        // A new rule review goes straight to its rules.
        if (records === 'rules' && !state.ruleBooks.some((b) => b.routineId === routine.id))
          setRulesFor(routine);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the routine details.');
    }
  };
  const saveProgram = async () => {
    try {
      if (!draft) return;
      const okay = await change((current) =>
        upsertProgram(current, {
          ...draft,
          title: name,
          group,
          goalIds: goals,
          routines: [],
        }),
      );
      if (okay) setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the program details.');
    }
  };
  useFocusEffect(
    useCallback(() => {
      return () => {
        setEditing(null);
        setDraft(null);
        setPlanFor(null);
      };
    }, []),
  );
  const programs = state.programs.filter((p) =>
    `${p.title} ${p.group} ${p.routines.map((r) => r.title).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const bundled = !!editing?.routine.bundledInto;
  // Saving keeps the stored repeat and its anchor while the count is unchanged. A longer repeat
  // from a setup file is offered as a fifth choice, so it shows selected and saves unchanged.
  const storedRepeat = editing?.routine.repeat;
  const keptRepeat = storedRepeat?.everyWeeks === Number(everyWeeks) ? storedRepeat : null;
  const repeatOptions: (readonly [string, string])[] = [
    ['1', 'Weekly'],
    ['2', 'Every 2 wk'],
    ['3', 'Every 3 wk'],
    ['4', 'Every 4 wk'],
  ];
  if (storedRepeat && storedRepeat.everyWeeks > 4)
    repeatOptions.push([String(storedRepeat.everyWeeks), `Every ${storedRepeat.everyWeeks} wk`]);
  const repeatHint = keptRepeat
    ? `every ${everyWeeks} weeks, counted from the week of ${displayDate(keptRepeat.anchor)}; ` +
      `this week is ${inRepeatWeek({ repeat: keptRepeat }, localDate()) ? 'on' : 'off'}`
    : `every ${everyWeeks} weeks starting this week`;
  const creating =
    editing !== null &&
    !state.programs.some((item) =>
      item.routines.some((routine) => routine.id === editing.routine.id),
    );
  const inRotation = editing ? rotationProgram(state.programs, editing.routine.id) : null;
  // Bundled steps join their host's program, so a routine there stays put: moving it would leave
  // them with no session to sit in.
  const home = state.programs.find((p) => p.routines.some((r) => r.id === editing?.routine.id));
  const hosted =
    home && !editing?.routine.bundledInto
      ? state.programs.flatMap((p) => p.routines).filter((r) => r.bundledInto === home.id)
      : [];
  const typeTitle = OBJECTIVE_TYPES.find((item) => item.id === records)?.title;
  // The type's note says what saving adds only when the routine has none yet; otherwise where its
  // plan, circuit or rules are edited.
  const savedPlan = !!editing && plans.has(editing.routine.id);
  const savedCircuit = !!editing && circuits.has(editing.routine.id);
  const savedBook = editing && state.ruleBooks.find((b) => b.routineId === editing.routine.id);
  const form = JSON.stringify([
    editing?.program.id,
    newProgram,
    [routineName, name, group, duration, start, thursday, earliest, latest, steps],
    [days, everyWeeks, enabled, fixed, checklist, hidden, optional, goals, records],
    [upBy, countEarlier],
    [activityChoices, follows, linksText, alternating, variants],
  ]);
  // Set while rendering, so the form is compared from the values it opened with.
  if (editing && !pickingType && baseline === null) setBaseline(form);
  const changed = baseline !== null && baseline !== form;
  const closeEditor = () => (changed ? setConfirmDiscard(true) : setEditing(null));
  const editingProgram = draft !== null && state.programs.some((p) => p.id === draft.id);
  return (
    <Page hideError={editing !== null || draft !== null} title="Programs">
      {/* Admin actions stay quiet: two tonal capsules, so the programs themselves lead. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexGrow: 1, flexBasis: 130 }}>
          <Button secondary small title="Add objective" onPress={() => open()} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 130 }}>
          <Button secondary small title="Add program" onPress={() => openProgram()} />
        </View>
      </View>
      {state.programs.length > 0 && (
        <Group icons>
          <FocusRow />
          {dayOrderEntries(state.programs).length > 1 && <DayOrderRow />}
          {state.goals.length > 0 && <GoalMap />}
        </Group>
      )}
      {state.programs.length > 4 && (
        <SearchField
          label="Find a program"
          value={search}
          onChange={setSearch}
          placeholder="Find a program"
        />
      )}
      {[...new Set(programs.map((p) => p.group))].map((groupName) => {
        const inGroup = programs.filter((p) => p.group === groupName);
        return (
          <View key={groupName} style={styles.section}>
            {/* The group name only when it adds something beyond the program's own title. */}
            {(inGroup.length > 1 || inGroup[0].title !== groupName) && (
              <SectionLabel title={groupName} />
            )}
            {inGroup.map((p) => (
              <View key={p.id} style={[styles.card, { gap: 4, paddingTop: 16, paddingBottom: 4 }]}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 6 }}>
                  <IconTile name={programArea(p).symbol} tone={programArea(p).tone} size={40} />
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text accessibilityRole="header" style={styles.heading}>
                      {p.title}
                    </Text>
                    <Text style={type.caption}>
                      {p.goalIds
                        .map((id) => state.goals.find((g) => g.id === id)?.title)
                        .filter(Boolean)
                        .join(' · ') || 'Not linked to a goal'}
                    </Text>
                  </View>
                </View>
                {!p.routines.length && (
                  <Text style={[styles.muted, { paddingBottom: 6 }]}>
                    Nothing here yet. Add an objective when you are ready.
                  </Text>
                )}
                {p.routines.map((r) => (
                  <RoutineRow
                    key={r.id}
                    routine={r}
                    kind={routineKind(r, plans.has(r.id), circuits.has(r.id))}
                    parent={
                      r.bundledInto
                        ? (state.programs.find((parent) => parent.id === r.bundledInto)?.title ??
                          r.bundledInto)
                        : null
                    }
                    inRotation={!!p.rotation?.order.includes(r.id)}
                    onConfigure={() => open(p, r)}>
                    {r.study && (
                      <LinkButton
                        title={`Study plan · ${planMinutes(r.study)} min`}
                        label={`Edit study plan for ${r.title}`}
                        tone="pill"
                        onPress={() => setStudyOf(r.id)}
                      />
                    )}
                    {r.capture === 'rules' && (
                      <LinkButton
                        title={`Rules · ${
                          state.ruleBooks.find((b) => b.routineId === r.id)?.checkpoints.length ?? 0
                        } checkpoints`}
                        label={`Edit rules for ${r.title}`}
                        tone="pill"
                        onPress={() => setRulesFor(r)}
                      />
                    )}
                    {state.ruleBooks.some((b) => b.routineId === r.id && b.trading) && (
                      <LinkButton
                        title={`Trading cockpit${r.enabled ? '' : ' (paused)'}`}
                        label={`Open the trading cockpit for ${r.title}`}
                        tone="pill"
                        onPress={() => router.push('/trading')}
                      />
                    )}
                    {state.ruleBooks.some((b) => b.routineId === r.id && b.trading) && (
                      <LinkButton
                        title="My strategy"
                        label="Open My Trading Strategy"
                        tone="pill"
                        onPress={() => router.push('/strategy')}
                      />
                    )}
                    {state.ruleBooks
                      .filter((b) => b.routineId === r.id && b.trading)
                      .map((b) => (
                        <AccountSetRule key={b.id} book={b} />
                      ))}
                    {plans.has(r.id) && (
                      <LinkButton
                        title={`Workout plan · ${plans.get(r.id)} exercise${plans.get(r.id) === 1 ? '' : 's'}`}
                        label={`Edit workout plan for ${r.title}`}
                        tone="pill"
                        onPress={() => setPlanFor(r)}
                      />
                    )}
                    {circuits.has(r.id) && (
                      <LinkButton
                        title={`Timed circuit · ${clockText(totalSeconds(circuits.get(r.id)!))}`}
                        label={`Edit timed circuit for ${r.title}`}
                        tone="pill"
                        onPress={() => setCircuitOf(circuits.get(r.id)!)}
                      />
                    )}
                  </RoutineRow>
                ))}
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    columnGap: 20,
                    borderTopWidth: p.routines.length ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: palette.separator,
                  }}>
                  <LinkButton
                    title="+ Add objective here"
                    label="Add another objective"
                    onPress={() => open(p)}
                  />
                  <LinkButton
                    title="Edit program"
                    label={`Edit program ${p.title}`}
                    onPress={() => openProgram(p)}
                  />
                  {offersRotation(state, p) && (
                    <LinkButton
                      title={
                        p.rotation
                          ? `Rotation · ${p.rotation.order.length} workouts ›`
                          : 'Set up a rotation'
                      }
                      label={`Workout rotation for ${p.title}`}
                      onPress={() => setRotationFor(p)}
                    />
                  )}
                </View>
              </View>
            ))}
          </View>
        );
      })}
      {!programs.length &&
        (state.programs.length ? (
          <Text style={styles.muted}>No program matches “{search}”.</Text>
        ) : (
          <View style={[styles.card, { alignItems: 'flex-start', gap: 10 }]}>
            <IconTile name="stack" tone="sun" size={44} />
            <Text accessibilityRole="header" style={type.cardTitle}>
              Your programs live here
            </Text>
            <Text style={styles.muted}>
              A program groups the objectives of one part of your life: training, career, money.
              Import your setup in Settings, or add your first program.
            </Text>
            <Button
              title="Add program"
              label="Add your first program"
              onPress={() => openProgram()}
            />
          </View>
        ))}
      <Sheet
        title={
          pickingType ? 'Choose objective type' : creating ? 'New objective' : 'Configure a routine'
        }
        visible={editing !== null}
        close={closeEditor}
        page={pickingType ? 'type' : 'details'}
        footer={
          confirmEndAnchor ? (
            <>
              <Text accessibilityRole="alert" style={styles.body}>
                Saving this ends the morning anchor and its history, so earlier mornings stop
                counting. Pausing the routine keeps them.
              </Text>
              <View style={styles.row}>
                <View style={{ flexGrow: 1 }}>
                  <Button secondary title="End the anchor" onPress={() => void save()} />
                </View>
                <View style={{ flexGrow: 1 }}>
                  <Button title="Keep editing" onPress={() => setConfirmEndAnchor(false)} />
                </View>
              </View>
            </>
          ) : confirmDiscard ? (
            <>
              <Text accessibilityRole="alert" style={styles.body}>
                Discard your changes to this routine?
              </Text>
              <View style={styles.row}>
                <View style={{ flexGrow: 1 }}>
                  <Button secondary title="Discard changes" onPress={() => setEditing(null)} />
                </View>
                <View style={{ flexGrow: 1 }}>
                  <Button title="Keep editing" onPress={() => setConfirmDiscard(false)} />
                </View>
              </View>
            </>
          ) : pickingType ? undefined : (
            <>
              {(error || daysError) && (
                <Text accessibilityRole="alert" style={styles.alert}>
                  {error ?? daysError}
                </Text>
              )}
              <Button title="Save routine" onPress={() => void save()} />
            </>
          )
        }>
        {pickingType ? (
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>
              Pick what this objective records. You name and schedule it next; advanced options stay
              available.
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Objective type"
              style={typeList}>
              {OBJECTIVE_TYPES.map((item, i) => (
                <View
                  key={item.id}
                  style={
                    i > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: palette.separator,
                    }
                  }>
                  <ChoiceRow
                    title={item.title}
                    detail={item.hint}
                    icon={OBJECTIVE_ICONS[item.id].icon}
                    tone={OBJECTIVE_ICONS[item.id].tone}
                    on={!creating && records === item.id}
                    onPress={() => applyType(item.id, creating, routineName)}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : (
          <>
            <Field label="Routine name" value={routineName} onChange={setRoutineName} name />
            {editing && inRotation ? (
              <Text style={styles.muted}>
                Part of the {inRotation.title} rotation: the rotation decides its days.
              </Text>
            ) : home && hosted.length ? (
              <Text style={styles.muted}>
                Hosts the bundled steps {hosted.map((r) => r.title).join(', ')}: it stays in{' '}
                {home.title}.
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>Program</Text>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Program"
                  style={styles.row}>
                  {state.programs.map((item) => (
                    <Chip
                      key={item.id}
                      role="radio"
                      title={item.title}
                      on={!newProgram && editing?.program.id === item.id}
                      onPress={() => attach(item)}
                    />
                  ))}
                  <Chip role="radio" title="New program…" on={newProgram} onPress={startProgram} />
                </View>
                {newProgram ? (
                  <>
                    <Field label="Program name" value={name} onChange={setName} name />
                    <Field label="Group" value={group} onChange={setGroup} name />
                    {state.goals.length > 0 && (
                      <>
                        <Text style={styles.muted}>Goals the new program serves</Text>
                        <View style={styles.row}>
                          {state.goals.map((g) => (
                            <Chip
                              key={g.id}
                              role="checkbox"
                              title={g.title}
                              on={goals.includes(g.id)}
                              onPress={() =>
                                setGoals(
                                  goals.includes(g.id)
                                    ? goals.filter((id) => id !== g.id)
                                    : [...goals, g.id],
                                )
                              }
                            />
                          ))}
                        </View>
                      </>
                    )}
                  </>
                ) : (
                  <Text style={styles.muted}>
                    Choosing another program moves this routine there. Rename a program, change its
                    group or goals with Edit program on its card.
                  </Text>
                )}
              </View>
            )}
            {!bundled && checklist && (
              <Toggle
                title="Optional"
                detail={
                  optional ? 'Encouraged, never blocks Day Cleared' : 'Required for Day Cleared'
                }
                label="Optional, never required for Day Cleared"
                value={optional}
                onChange={setOptional}
              />
            )}
            {/* The anchor's time can still show on the widgets: private hides the title. */}
            <Toggle
              title="Private"
              detail={
                anchorable && upBy.trim()
                  ? hidden
                    ? 'The title stays off the widgets; they can still show the Up by time'
                    : 'The title can show on the widgets'
                  : hidden
                    ? 'Stays off the widget'
                    : 'Can show on the widget'
              }
              label={
                anchorable && upBy.trim()
                  ? 'Private, title hidden from the widgets; the Up by time can still show on them'
                  : 'Private, hidden from the Home Screen widget'
              }
              value={hidden}
              onChange={setHidden}
            />
            <Toggle
              title="Enabled"
              detail={enabled ? 'Comes up on its days' : 'Paused: off Today, history kept'}
              value={enabled}
              onChange={(on) => {
                setEnabled(on);
                setDaysError(null);
              }}
            />
            {anchorable && (
              <View style={{ gap: 8 }}>
                <Field
                  label="Up by · morning anchor (24-hour, optional)"
                  value={upBy}
                  onChange={setUpBy}
                  placeholder="07:10"
                  time
                  hint="Your own time. On time means ticked within 15 minutes of it."
                />
                {earlierTick && upByMinutes !== null && (
                  <Toggle
                    title={`Count mornings since ${shortDate(earlierTick)}`}
                    detail={
                      countEarlier
                        ? `Mornings since ${shortDate(earlierTick)} count against this time`
                        : 'Starting today'
                    }
                    label={`Count mornings since ${shortDate(earlierTick)} against ${displayTime(upByMinutes)}`}
                    value={countEarlier}
                    onChange={setCountEarlier}
                  />
                )}
                {earlierTick && upByMinutes !== null && countEarlier && (
                  <Text style={type.caption}>
                    Once saved, those mornings keep this time. To correct it later, clear the time,
                    end the anchor and set it again.
                  </Text>
                )}
              </View>
            )}
            {!bundled && (
              <View style={{ gap: 8 }}>
                <View style={styles.spread}>
                  <View style={{ gap: 2, flexShrink: 1 }}>
                    <Text style={styles.label}>Type</Text>
                    <Text style={type.item}>{typeTitle}</Text>
                  </View>
                  <LinkButton
                    title="Change"
                    label="Choose a different type"
                    onPress={() => setPickingType(true)}
                  />
                </View>
                {records === 'workout' && (
                  <Text style={styles.muted}>
                    Today opens this routine’s exercises to log sets.{' '}
                    {savedPlan
                      ? 'Its exercises are under Workout plan on its program’s card.'
                      : 'You add the exercises after saving.'}
                  </Text>
                )}
                {records === 'circuit' && (
                  <Text style={styles.muted}>
                    {savedCircuit
                      ? 'Its intervals are under Timed circuit on its program’s card.'
                      : 'Uses the 14-minute circuit preset. You can edit the intervals after saving.'}{' '}
                    The next due day appears on Today.
                  </Text>
                )}
                {records === 'study' && (
                  <Text style={styles.muted}>
                    Required every due day and shown first on Today. One tap marks it done and a
                    study streak starts today. The 25 + 30 + 5 minute stage timer, links, a study
                    time and reminders are optional.
                  </Text>
                )}
                {records === 'activity' && (
                  <>
                    <Text style={styles.muted}>
                      Today asks what you did and for how many minutes. Duration is the target per
                      day when set.
                    </Text>
                    <Field
                      label="Activity choices (one per line)"
                      value={activityChoices}
                      onChange={setActivityChoices}
                      multiline
                      placeholder={'Bike\nStairs\nOther'}
                    />
                  </>
                )}
                {records === 'rules' &&
                  (savedBook?.trading ? (
                    <Text style={styles.muted}>
                      Today opens the trading cockpit for this routine. Its rules and limits are on
                      the Trading page.
                    </Text>
                  ) : (
                    <Text style={styles.muted}>
                      Today asks each checkpoint Yes, No or Not applicable, or records a day without
                      the activity. Private by default.{' '}
                      {savedBook
                        ? 'Its checkpoints and rules are under Rules on its program’s card.'
                        : 'You add the rules after saving.'}
                    </Text>
                  ))}
                {records === 'weight' && (
                  <Text style={styles.muted}>
                    Today opens a one-number weight entry on the days below (every day by default;
                    pick one day for weekly). You can also add a weight for any day from Progress.
                    Optional: it never blocks Day Cleared.
                  </Text>
                )}
                {records === 'money' && (
                  <Text style={styles.muted}>
                    Today opens a money review. Amounts are what you report; blank is not reported,
                    not zero. Private by default.
                  </Text>
                )}
              </View>
            )}
            {records === 'activity' && checklist && (
              <Field
                label="Target minutes per day (blank = none)"
                value={duration}
                onChange={setDuration}
                numeric
              />
            )}
            <Weekdays
              value={days}
              onChange={(next) => {
                setDays(next);
                setDaysError(null);
              }}
            />
            <Button
              secondary
              small
              title="Every day"
              onPress={() => {
                setDays([0, 1, 2, 3, 4, 5, 6]);
                setDaysError(null);
              }}
            />
            {!bundled && records !== 'study' && editing && !inRotation && (
              <View style={{ gap: 6 }}>
                <Text style={styles.label}>Repeat</Text>
                <Segmented
                  label="Repeat"
                  options={repeatOptions}
                  value={everyWeeks}
                  onChange={setEveryWeeks}
                />
                {everyWeeks !== '1' && (
                  <Text style={styles.muted}>
                    On the days above, {repeatHint}. A missed one never shifts the pattern.
                  </Text>
                )}
              </View>
            )}
            {!bundled && editing && !inRotation && (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>Also due with · a companion objective</Text>
                <View style={styles.row}>
                  {state.programs
                    .flatMap((p) => p.routines)
                    .filter(
                      (r) =>
                        r.id !== editing.routine.id &&
                        (plans.has(r.id) || rotationProgram(state.programs, r.id)),
                    )
                    .map((r) => (
                      <Chip
                        key={r.id}
                        role="checkbox"
                        title={r.title}
                        on={follows.includes(r.id)}
                        onPress={() => {
                          setFollows(
                            follows.includes(r.id)
                              ? follows.filter((x) => x !== r.id)
                              : [...follows, r.id],
                          );
                          setDaysError(null);
                        }}
                      />
                    ))}
                </View>
                <Text style={styles.muted}>
                  Due on any day one of these workouts is on your plan, even after it moves. It is
                  its own objective: finishing the workout never completes it.
                </Text>
              </View>
            )}
            {!bundled && records === 'none' && (
              <Toggle
                title="Needs a time slot"
                detail={
                  checklist ? 'Done any time on its days' : 'Placed when you generate the day'
                }
                value={!checklist}
                onChange={(on) => setChecklist(!on)}
              />
            )}
            {bundled ? (
              <Text style={styles.muted}>
                This runs inside its parent session. Choose the matching session days; its time will
                not be allocated twice.
              </Text>
            ) : checklist ? (
              <Text style={styles.muted}>
                Due on the selected days. No start time or calendar block is required.
              </Text>
            ) : (
              <>
                <Field
                  label="Duration in minutes (blank = unknown)"
                  value={duration}
                  onChange={setDuration}
                  numeric
                />
                <Button
                  secondary
                  title={scheduleOpen ? 'Hide scheduling options' : 'Scheduling options'}
                  onPress={() => setScheduleOpen(!scheduleOpen)}
                />
                {scheduleOpen && (
                  <>
                    <Field
                      label="Preferred start (24-hour, optional)"
                      value={start}
                      onChange={setStart}
                      placeholder="14:30"
                      time
                    />
                    <Field
                      label="Thursday start override (optional)"
                      value={thursday}
                      onChange={setThursday}
                      placeholder="14:00"
                      time
                    />
                    <Field
                      label="Earliest start (optional)"
                      value={earliest}
                      onChange={setEarliest}
                      placeholder="18:00"
                      time
                    />
                    <Field
                      label="Latest finish (optional, 24:00 = midnight)"
                      value={latest}
                      onChange={setLatest}
                      placeholder="23:30"
                      time
                    />
                    <Toggle
                      title="Fixed time"
                      detail={
                        fixed ? 'Pinned at its start time' : 'Flexible: can move to fit the day'
                      }
                      value={fixed}
                      onChange={setFixed}
                    />
                  </>
                )}
              </>
            )}
            <Button
              secondary
              small
              title={advancedOpen ? 'Hide more options' : 'More options'}
              onPress={() => setAdvancedOpen(!advancedOpen)}
            />
            {advancedOpen && (
              <View style={{ gap: 8 }}>
                {!bundled && (
                  <>
                    <Toggle
                      title="Alternate two variants"
                      detail={
                        alternating ? 'Switches between them day by day' : 'The same every day'
                      }
                      label="Alternate daily between two variants"
                      value={alternating}
                      onChange={setAlternating}
                    />
                    {alternating && (
                      <>
                        <Field
                          label="First variant (today if new)"
                          value={variants.a}
                          onChange={(a) => setVariants({ ...variants, a })}
                          placeholder="Upper body"
                          name
                        />
                        <Field
                          label="First variant steps (one per line)"
                          value={variants.aSteps}
                          onChange={(aSteps) => setVariants({ ...variants, aSteps })}
                          multiline
                        />
                        <Field
                          label="Second variant"
                          value={variants.b}
                          onChange={(b) => setVariants({ ...variants, b })}
                          placeholder="Lower body"
                          name
                        />
                        <Field
                          label="Second variant steps (one per line)"
                          value={variants.bSteps}
                          onChange={(bSteps) => setVariants({ ...variants, bSteps })}
                          multiline
                        />
                        <Text style={styles.muted}>
                          The variants follow the calendar: a missed day never shifts them and
                          nothing is owed.
                          {anchor ? ` The first variant fell on ${displayDate(anchor)}.` : ''}
                        </Text>
                      </>
                    )}
                    <Field
                      label="Links (optional, one per line: Label | https://…)"
                      value={linksText}
                      onChange={setLinksText}
                      multiline
                    />
                  </>
                )}
                <Field
                  label="Routine steps (one per line)"
                  value={steps}
                  onChange={setSteps}
                  multiline
                />
              </View>
            )}
          </>
        )}
      </Sheet>
      <Sheet
        title={editingProgram ? 'Edit program' : 'Add a program'}
        visible={draft !== null}
        close={() => setDraft(null)}>
        <Field label="Program name" value={name} onChange={setName} name />
        <Field label="Group" value={group} onChange={setGroup} name />
        <Text style={styles.muted}>
          {editingProgram
            ? 'The name, group and goals apply to every routine in this program.'
            : 'This groups habits and timed sessions. Add those after you save. No calendar time is created here.'}
        </Text>
        <Text style={styles.muted}>Goals served</Text>
        <View style={styles.row}>
          {state.goals.map((g) => (
            <Chip
              key={g.id}
              role="checkbox"
              title={g.title}
              on={goals.includes(g.id)}
              onPress={() =>
                setGoals(
                  goals.includes(g.id) ? goals.filter((id) => id !== g.id) : [...goals, g.id],
                )
              }
            />
          ))}
        </View>
        {error && (
          <Text accessibilityRole="alert" style={styles.alert}>
            {error}
          </Text>
        )}
        <Button title="Save program" onPress={() => void saveProgram()} />
      </Sheet>
      <TemplateEditor routine={planFor} close={() => setPlanFor(null)} />
      <CircuitEditor circuit={circuitOf} close={() => setCircuitOf(null)} />
      <StudyPlanEditor routineId={studyOf} close={() => setStudyOf(null)} />
      <RotationEditor program={rotationFor} close={() => setRotationFor(null)} />
      <RuleBookEditor routine={rulesFor} close={() => setRulesFor(null)} />
    </Page>
  );
}

/** The objective types as one inset list on the sheet's card color: a ground of `fill`. */
const typeList = {
  borderRadius: 20,
  backgroundColor: palette.canvas,
  overflow: 'hidden',
} as const;
