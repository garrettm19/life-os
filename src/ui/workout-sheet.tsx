import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  Block,
  LoggedSet,
  SessionExercise,
  State,
  WeightUnit,
  WorkoutSession,
  displayDate,
  localDate,
} from '../domain/model';
import {
  LibraryExercise,
  exerciseLibrary,
  substituteExercise,
  doneSets,
  finishSession,
  markDoneWithoutLog,
  planText,
  previousPerformance,
  saveSession,
  sessionFor,
  setSuggestion,
  setsText,
  startSession,
  templateFor,
} from '../domain/workouts';
import { useApp } from '../state/app-state';
import { restDay, rotationProgram } from '../domain/rotation';
import { Button, Chip, Sheet, styles } from './components';
import { Toggle } from './list';
import { newId } from './ids';
import { CheckSquare } from './mission';
import { palette, radius, type, fonts } from './theme';

export type WorkoutTarget = { date: string; block: Block };

type SessionEdit = (session: WorkoutSession) => WorkoutSession;

function editSet(exerciseIndex: number, setIndex: number, patch: Partial<LoggedSet>): SessionEdit {
  return (session) => ({
    ...session,
    exercises: session.exercises.map((e, i) =>
      i === exerciseIndex
        ? { ...e, sets: e.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
        : e,
    ),
  });
}

function addSet(exerciseIndex: number): SessionEdit {
  return (session) => ({
    ...session,
    exercises: session.exercises.map((e, i) =>
      i === exerciseIndex && e.sets.length < 30
        ? {
            ...e,
            sets: [
              ...e.sets,
              e.kind === 'time'
                ? { reps: null, load: null, done: false, seconds: null }
                : { reps: null, load: null, done: false },
            ],
          }
        : e,
    ),
  });
}

/**
 * The session to show: the saved one, or a fresh draft from the plan (not saved until a set is).
 */
function sessionOrDraft(state: State, target: WorkoutTarget): WorkoutSession | null {
  const saved = sessionFor(state, target.block.id);
  if (saved) return saved;
  if (!templateFor(state, target.block.routineId)) return null;
  return sessionFor(
    startSession(state, target.date, target.block, new Date(0).toISOString()),
    target.block.id,
  )!;
}

export function WorkoutSheet({
  target,
  close,
  onShift,
  onEditTime,
}: {
  target: WorkoutTarget | null;
  close: () => void;
  onShift: (mode: 'forward' | 'restore') => void;
  onEditTime: () => void;
}) {
  return target ? (
    <WorkoutLogger
      key={target.block.id}
      target={target}
      close={close}
      onShift={onShift}
      onEditTime={onEditTime}
    />
  ) : null;
}

function WorkoutLogger({
  target,
  close,
  onShift,
  onEditTime,
}: {
  target: WorkoutTarget;
  close: () => void;
  onShift: (mode: 'forward' | 'restore') => void;
  onEditTime: () => void;
}) {
  const { state, change } = useApp();
  const block =
    state.days[target.date]?.blocks.find((b) => b.id === target.block.id) ?? target.block;
  const saved = sessionFor(state, block.id);
  const [draft, setDraft] = useState<WorkoutSession | null>(() => sessionOrDraft(state, target));
  const template = templateFor(state, block.routineId);
  const rotation = rotationProgram(state.programs, block.routineId);
  const finished = saved?.status === 'completed';
  const planned = block.status === 'planned';

  /**
   * Saves one edit now. It is applied to the latest saved session inside the save queue, so two
   * quick taps can never save a stale copy over each other; the first logged set also starts the
   * session in the same save. A failed save drops the draft back to what is actually saved.
   */
  const persist = async (edit: SessionEdit) => {
    setDraft((d) => d && edit(d));
    const now = new Date().toISOString();
    const ok = await change((s) => {
      const started = sessionFor(s, block.id) ? s : startSession(s, target.date, block, now);
      return saveSession(started, edit(sessionFor(started, block.id)!));
    });
    if (!ok) setDraft(null);
    return ok;
  };
  /** Swaps an exercise for this session (and optionally the plan); the sheet then shows the save. */
  const swap = async (index: number, replacement: Replacement, alsoPlan: boolean) => {
    const now = new Date().toISOString();
    const ok = await change((s) => {
      const started = sessionFor(s, block.id) ? s : startSession(s, target.date, block, now);
      return substituteExercise(started, `session:${block.id}`, index, replacement, alsoPlan, now);
    });
    if (ok) setDraft(null);
    return ok;
  };
  const finish = async (shown: WorkoutSession) => {
    const now = new Date().toISOString();
    const ok = await change((s) => {
      const started = sessionFor(s, block.id) ? s : startSession(s, target.date, block, now);
      const current = sessionFor(started, block.id)!;
      // What is on screen (including typed but unticked values) is what finishes.
      const merged = { ...shown, id: current.id, startedAt: current.startedAt };
      return finishSession(saveSession(started, merged), target.date, block.id, merged, now);
    });
    if (ok) close();
  };

  if (!template && !saved)
    return (
      <Sheet title={block.title} visible close={close}>
        <Text style={styles.body}>This workout has no plan yet. Add exercises in Programs.</Text>
        {planned && <DoneWithoutLog block={block} date={target.date} close={close} />}
      </Sheet>
    );

  const session = draft ?? saved ?? sessionOrDraft(state, target)!;
  const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <Sheet title={template?.title ?? block.title} visible close={close}>
      <View style={styles.spread}>
        <Text style={styles.label}>
          {displayDate(target.date)}
          {block.movedFrom ? ` · Moved from ${displayDate(block.movedFrom)}` : ''}
        </Text>
        <Text style={{ ...type.meta, color: finished ? palette.done : palette.accent }}>
          {finished ? 'Completed' : `${doneSets(session)} of ${total} sets`}
        </Text>
      </View>
      {template?.note ? <Text style={styles.muted}>{template.note}</Text> : null}
      {session.exercises.map((exercise, i) => (
        <ExerciseCard
          key={exercise.exerciseId}
          exercise={exercise}
          previous={previousPerformance(state, exercise, session)}
          readOnly={finished}
          note={template?.exercises.find((e) => e.id === exercise.exerciseId)?.note ?? ''}
          onSet={(j, patch) => void persist(editSet(i, j, patch))}
          onDraft={(j, patch) => setDraft((d) => editSet(i, j, patch)(d ?? session))}
          onAddSet={() => void persist(addSet(i))}
          library={exerciseLibrary(state)}
          onSwap={(replacement, alsoPlan) => swap(i, replacement, alsoPlan)}
        />
      ))}
      {finished ? (
        <Text style={styles.muted}>
          Finished{' '}
          {saved?.finishedAt
            ? new Date(saved.finishedAt).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })
            : ''}
          . Undo it on Today to change it.
        </Text>
      ) : (
        <>
          {block.status === 'done' && doneSets(session) > 0 && (
            <Text accessibilityRole="alert" style={{ ...type.callout, color: palette.accent }}>
              This objective is done, but its workout log was never finished. Finish it to keep
              these sets as a completed workout.
            </Text>
          )}
          <Button
            title="Finish workout"
            disabled={doneSets(session) === 0}
            needs="Tick at least one set to finish the workout."
            onPress={() => void finish(session)}
          />
          {planned && doneSets(session) === 0 && (
            <DoneWithoutLog block={block} date={target.date} close={close} />
          )}
          {planned && doneSets(session) > 0 && (
            <Text style={styles.muted}>
              {doneSets(session)} logged set{doneSets(session) === 1 ? ' is' : 's are'} saved.
              Finish workout keeps them with this objective; Close keeps them for later.
            </Text>
          )}
          {planned &&
            rotation &&
            !block.movedFrom &&
            doneSets(session) === 0 &&
            target.date >= localDate() && (
              <Button
                secondary
                title="Rest today instead"
                label={`Rest today; ${block.title} stays next in the rotation`}
                onPress={() =>
                  void change((s) =>
                    restDay(s, rotation.id, target.date, new Date().toISOString()),
                  ).then((ok) => ok && close())
                }
              />
            )}
          {planned && !rotation && (
            <Button
              secondary
              title="Move this and later workouts in the next 7 days +1 day"
              onPress={() => onShift('forward')}
            />
          )}
          {planned && !rotation && block.movedFrom && (
            <Button
              secondary
              small
              title="Return moved workouts to their original days"
              onPress={() => onShift('restore')}
            />
          )}
          <Button secondary small title="Change time or details" onPress={onEditTime} />
        </>
      )}
    </Sheet>
  );
}

function DoneWithoutLog({ block, date, close }: { block: Block; date: string; close: () => void }) {
  const { change } = useApp();
  return (
    <Button
      secondary
      title="Done without a log"
      label={`Mark ${block.title} done without logging sets`}
      onPress={() =>
        void change((s) => markDoneWithoutLog(s, date, block.id, new Date().toISOString())).then(
          (ok) => ok && close(),
        )
      }
    />
  );
}

type Replacement = { exerciseId: string; name: string; unit: WeightUnit; kind?: 'time' };

/** Pick another exercise for today: one from your plans (its own history) or a new one. */
function SwapPanel({
  exercise,
  library,
  onSwap,
  close,
}: {
  exercise: SessionExercise;
  library: LibraryExercise[];
  onSwap: (replacement: Replacement, alsoPlan: boolean) => Promise<boolean>;
  close: () => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<WeightUnit>(exercise.unit);
  const [alsoPlan, setAlsoPlan] = useState(false);
  const [chosen, setChosen] = useState<LibraryExercise | null>(null);
  const query = name.trim().toLowerCase();
  const original = exercise.substitutedFor;
  const matches = library
    .filter(
      (e) =>
        e.id !== exercise.exerciseId &&
        e.id !== original?.exerciseId &&
        (!query || e.name.toLowerCase().includes(query)),
    )
    .slice(0, 6);
  const replacement: Replacement | null = chosen
    ? {
        exerciseId: chosen.id,
        name: chosen.name,
        unit: chosen.unit,
        ...(chosen.kind && { kind: chosen.kind }),
      }
    : name.trim()
      ? {
          // A new exercise gets its ID when Swap is pressed.
          exerciseId: '',
          name: name.trim(),
          unit,
          ...(exercise.kind && { kind: exercise.kind }),
        }
      : null;
  return (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <Text style={styles.label}>Instead of {original?.name ?? exercise.name}, today</Text>
      <View style={styles.row}>
        {original && (
          <Chip
            role="radio"
            title={`Back to ${original.name}`}
            on={chosen?.id === original.exerciseId}
            onPress={() =>
              setChosen(
                library.find((e) => e.id === original.exerciseId) ?? {
                  id: original.exerciseId,
                  name: original.name,
                  unit: exercise.unit,
                  workouts: [],
                },
              )
            }
          />
        )}
        {matches.map((e) => (
          <Chip
            key={e.id}
            role="radio"
            title={e.name}
            on={chosen?.id === e.id}
            onPress={() => setChosen(e)}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel="Or name another exercise"
        placeholder="Or name another exercise"
        placeholderTextColor={palette.placeholder}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setChosen(null);
        }}
        autoCapitalize="words"
        selectionColor={palette.done}
        style={styles.input}
      />
      {!chosen && name.trim() !== '' && !exercise.kind && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Unit" style={styles.row}>
          {(['lb', 'kg'] as const).map((u) => (
            <Chip key={u} role="radio" title={u} on={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>
      )}
      <Toggle
        title="Also change the plan"
        detail={alsoPlan ? 'The plan changes too' : 'Today only'}
        label="Also change the workout plan"
        value={alsoPlan}
        onChange={setAlsoPlan}
      />
      <View style={styles.row}>
        <Button
          small
          title="Swap"
          label="Swap the exercise"
          disabled={!replacement}
          onPress={() =>
            replacement &&
            void onSwap(
              { ...replacement, exerciseId: replacement.exerciseId || newId('exercise') },
              alsoPlan,
            ).then((ok) => ok && close())
          }
        />
        <Button secondary small title="Cancel" label="Cancel the swap" onPress={close} />
      </View>
    </View>
  );
}

function ExerciseCard({
  exercise,
  previous,
  readOnly,
  note,
  onSet,
  onDraft,
  onAddSet,
  library,
  onSwap,
}: {
  exercise: SessionExercise;
  previous: { date: string; sets: LoggedSet[]; unit: string } | null;
  readOnly: boolean;
  note: string;
  onSet: (index: number, patch: Partial<LoggedSet>) => void;
  onDraft: (index: number, patch: Partial<LoggedSet>) => void;
  onAddSet: () => void;
  library: LibraryExercise[];
  onSwap: (replacement: Replacement, alsoPlan: boolean) => Promise<boolean>;
}) {
  const [swapping, setSwapping] = useState(false);
  const timed = exercise.kind === 'time';
  const canSwap = !readOnly && !exercise.sets.some((set) => set.done);
  return (
    <View style={[styles.panel, { gap: 6 }]}>
      {exercise.substitutedFor && (
        <Text style={{ ...type.meta, color: palette.accent }}>
          Today instead of {exercise.substitutedFor.name}
        </Text>
      )}
      <View style={styles.spread}>
        <Text style={{ ...type.heading, flexShrink: 1 }}>{exercise.name}</Text>
        <Text style={{ ...type.meta, color: palette.label2 }}>{planText(exercise)}</Text>
      </View>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
      <Text style={{ ...type.meta }}>
        {previous
          ? `Last ${displayDate(previous.date)}: ${setsText(previous.sets, previous.unit)}`
          : 'No earlier session'}
      </Text>
      {exercise.sets.map((set, j) => {
        const hint = setSuggestion(exercise, previous?.sets, j);
        const label = `${exercise.name} set ${j + 1}`;
        return (
          <View
            key={j}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 }}>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                ...fonts.semibold,
                fontSize: 12,
                color: set.done ? palette.done : palette.label3,
                minWidth: 22,
              }}>
              {j + 1}
            </Text>
            {timed ? (
              <NumberBox
                label={`${label} time in seconds`}
                value={set.seconds ?? null}
                placeholder={hint.seconds === null ? '—' : String(hint.seconds)}
                suffix="sec"
                integer
                editable={!readOnly && !set.done}
                onChange={(seconds) => onDraft(j, { seconds })}
              />
            ) : (
              <>
                <NumberBox
                  label={`${label} load in ${exercise.unit}`}
                  value={set.load}
                  placeholder={hint.load === null ? '—' : String(hint.load)}
                  suffix={exercise.unit}
                  editable={!readOnly && !set.done}
                  onChange={(load) => onDraft(j, { load })}
                />
                <NumberBox
                  label={`${label} reps`}
                  value={set.reps}
                  placeholder={String(hint.reps)}
                  suffix="reps"
                  integer
                  editable={!readOnly && !set.done}
                  onChange={(reps) => onDraft(j, { reps })}
                />
              </>
            )}
            {readOnly ? (
              <Text
                style={{
                  ...type.meta,
                  color: set.done ? palette.done : palette.label3,
                  minWidth: 44,
                  textAlign: 'center',
                }}>
                {set.done ? 'Done' : '—'}
              </Text>
            ) : (
              <CheckSquare
                status={set.done ? 'done' : 'planned'}
                label={set.done ? `Undo ${label}` : `Log ${label}`}
                onPress={() =>
                  onSet(
                    j,
                    set.done
                      ? { done: false }
                      : timed
                        ? { done: true, seconds: set.seconds ?? hint.seconds }
                        : // Logging takes what was typed, or the shown suggestion: a deliberate tap.
                          { done: true, reps: set.reps ?? hint.reps, load: set.load ?? hint.load },
                  )
                }
              />
            )}
          </View>
        );
      })}
      {canSwap &&
        (swapping ? (
          <SwapPanel
            exercise={exercise}
            library={library}
            onSwap={onSwap}
            close={() => setSwapping(false)}
          />
        ) : (
          <Button
            secondary
            small
            title="Swap for today"
            label={`Swap ${exercise.name} for another exercise today`}
            onPress={() => setSwapping(true)}
          />
        ))}
      {!readOnly && exercise.sets.length < 30 && (
        <Button
          secondary
          small
          title="Add set"
          label={`Add a set to ${exercise.name}`}
          onPress={onAddSet}
        />
      )}
    </View>
  );
}

function NumberBox({
  label,
  value,
  placeholder,
  suffix,
  integer = false,
  editable,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder: string;
  suffix: string;
  integer?: boolean;
  editable: boolean;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: palette.separator,
        backgroundColor: editable ? palette.canvas : palette.surface,
        paddingHorizontal: 10,
        gap: 4,
      }}>
      <TextInput
        accessibilityLabel={label}
        value={editable ? text : value === null ? '' : String(value)}
        editable={editable}
        onChangeText={(next) => {
          const cleaned = next.replace(',', '.');
          // Keystrokes that would make an invalid or out-of-range value are ignored, so what is
          // shown is always exactly what gets logged (reps 0–1000, loads 0–2000 with two decimals).
          const pattern = integer ? /^\d{0,4}$/ : /^\d{0,4}(\.\d{0,2})?$/;
          if (!pattern.test(cleaned) || Number(cleaned) > (integer ? 1000 : 2000)) return;
          setText(cleaned);
          onChange(cleaned === '' || cleaned === '.' ? null : Number(cleaned));
        }}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        selectionColor={palette.done}
        style={{
          flex: 1,
          // Without this the web input keeps its default width and pushes the unit out of the box.
          minWidth: 0,
          width: '100%',
          ...fonts.figure,
          fontSize: 17,
          color: palette.label,
          minHeight: 42,
        }}
      />
      <Text style={{ ...type.meta }}>{suffix}</Text>
    </View>
  );
}
