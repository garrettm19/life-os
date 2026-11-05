import { useState } from 'react';
import { Text, View } from 'react-native';
import { PlannedExercise, Routine, WeightUnit, WorkoutTemplate } from '../domain/model';
import { exerciseLibrary, repsText, saveTemplate } from '../domain/workouts';
import { parseWhole } from '../domain/numbers';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, SectionLabel, Sheet, styles } from './components';
import { newId } from './ids';
import { palette, type } from './theme';

type Draft = {
  id: string;
  name: string;
  sets: string;
  repsMin: string;
  repsMax: string;
  load: string;
  unit: WeightUnit;
  rest: string;
  note: string;
  timed: boolean;
  seconds: string;
};

function toDraft(e: PlannedExercise): Draft {
  return {
    id: e.id,
    name: e.name,
    sets: String(e.sets),
    repsMin: String(e.repsMin),
    repsMax: e.repsMax === null ? '' : String(e.repsMax),
    load: e.load === null ? '' : String(e.load),
    unit: e.unit,
    rest: e.restSeconds === null ? '' : String(e.restSeconds),
    note: e.note,
    timed: e.kind === 'time',
    seconds: e.seconds == null ? '' : String(e.seconds),
  };
}

function whole(text: string, label: string, min: number, max: number): number {
  const value = parseWhole(text);
  if (value === null || !(value >= min && value <= max))
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function fromDraft(d: Draft, index: number): PlannedExercise {
  const name = d.name.trim();
  const where = name || `Exercise ${index + 1}`;
  if (!name) throw new Error(`Name exercise ${index + 1}.`);
  if (d.timed)
    return {
      id: d.id,
      name,
      sets: whole(d.sets, `${where}: sets`, 1, 20),
      repsMin: 1,
      repsMax: null,
      load: null,
      unit: d.unit,
      restSeconds: d.rest.trim() ? whole(d.rest, `${where}: rest`, 0, 3600) : null,
      note: d.note.trim(),
      kind: 'time',
      seconds: d.seconds.trim() ? whole(d.seconds, `${where}: seconds per set`, 1, 7200) : null,
    };
  const repsMin = whole(d.repsMin, `${where}: reps`, 1, 100);
  const repsMax = d.repsMax.trim()
    ? whole(d.repsMax, `${where}: top of the rep range`, repsMin, 100)
    : null;
  const load = d.load.trim().replace(',', '.');
  if (load && !/^\d{1,4}(\.\d{1,2})?$/.test(load))
    throw new Error(`${where}: use a load like 135 or 22.5.`);
  return {
    id: d.id,
    name,
    sets: whole(d.sets, `${where}: sets`, 1, 20),
    repsMin,
    repsMax: repsMax === repsMin ? null : repsMax,
    load: load ? Number(load) : null,
    unit: d.unit,
    restSeconds: d.rest.trim() ? whole(d.rest, `${where}: rest`, 0, 3600) : null,
    note: d.note.trim(),
  };
}

const blank = (unit: WeightUnit): Draft => ({
  id: newId('exercise'),
  name: '',
  sets: '3',
  repsMin: '8',
  repsMax: '',
  load: '',
  unit,
  rest: '',
  note: '',
  timed: false,
  seconds: '',
});

/**
 * The plan for one workout routine. Each exercise keeps its ID across edits, so previous
 * performance still lines up; recorded sessions keep their own copy and never change.
 */
export function TemplateEditor({ routine, close }: { routine: Routine | null; close: () => void }) {
  return routine ? <Editor key={routine.id} routine={routine} close={close} /> : null;
}

function Editor({ routine, close }: { routine: Routine; close: () => void }) {
  const { state, change } = useApp();
  const existing = state.workoutTemplates.find((t) => t.routineId === routine.id);
  const [title, setTitle] = useState(existing?.title ?? routine.title);
  const [note, setNote] = useState(existing?.note ?? '');
  const [exercises, setExercises] = useState<Draft[]>(
    existing?.exercises.map(toDraft) ?? [blank('lb')],
  );
  const [error, setError] = useState<string | null>(null);
  const edit = (index: number, patch: Partial<Draft>) => {
    setExercises((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
    setError(null);
  };
  const move = (index: number, by: -1 | 1) =>
    setExercises((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  // Exercises in the user's other workouts: the same exercise there shares its history here.
  const library = exerciseLibrary(state).filter(
    (e) => !existing || !existing.exercises.some((x) => x.id === e.id),
  );
  const known = new Set([
    ...state.workoutTemplates.flatMap((t) => t.exercises.map((e) => e.id)),
    ...state.workoutSessions.flatMap((s) => s.exercises.map((e) => e.exerciseId)),
  ]);
  const save = async () => {
    try {
      if (!title.trim()) throw new Error('Give the workout a name.');
      if (!exercises.length) throw new Error('Add at least one exercise.');
      // A new exercise named exactly like one in another workout (same unit and kind) is that
      // exercise, so it is linked to share its history.
      const linked = exercises.map((d) => {
        if (known.has(d.id)) return d;
        const match = library.find(
          (e) =>
            e.name.trim().toLowerCase() === d.name.trim().toLowerCase() &&
            e.unit === d.unit &&
            (e.kind === 'time') === d.timed,
        );
        return match ? { ...d, id: match.id } : d;
      });
      if (new Set(linked.map((d) => d.id)).size !== linked.length)
        throw new Error('This workout lists the same exercise twice. Remove one of them.');
      const template: WorkoutTemplate = {
        id: existing?.id ?? newId('workout'),
        routineId: routine.id,
        title: title.trim(),
        note: note.trim(),
        exercises: linked.map(fromDraft),
        updatedAt: new Date().toISOString(),
      };
      const ok = await change((s) => saveTemplate(s, template));
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the workout plan.');
    }
  };
  return (
    <Sheet title="Workout plan" visible close={close}>
      <Text style={styles.muted}>
        For {routine.title}. Targets are yours to set; Life OS does not prescribe training. Editing
        the plan never changes workouts already logged.
      </Text>
      <Field label="Workout name" value={title} onChange={setTitle} name />
      <Field label="Instructions (optional)" value={note} onChange={setNote} multiline />
      {exercises.map((d, i) => (
        <View key={d.id} style={styles.panel}>
          <SectionLabel
            title={`Exercise ${i + 1}`}
            count={
              d.timed
                ? `${d.sets} × ${d.seconds ? `${d.seconds} s` : 'timed'}`
                : d.repsMin
                  ? `${d.sets} × ${repsText({ repsMin: Number(d.repsMin) || 0, repsMax: Number(d.repsMax) || null })}`
                  : undefined
            }
          />
          <Field
            label="Exercise name"
            value={d.name}
            onChange={(v) => edit(i, { name: v })}
            placeholder="Bench press"
            name
          />
          {!known.has(d.id) && d.name.trim().length >= 2 && (
            <View style={styles.row}>
              {library
                .filter(
                  (e) =>
                    e.name.toLowerCase().includes(d.name.trim().toLowerCase()) &&
                    !exercises.some((x) => x.id === e.id),
                )
                .slice(0, 4)
                .map((e) => (
                  <Chip
                    key={e.id}
                    role="checkbox"
                    title={`Same as ${e.name} · ${e.workouts[0]}`}
                    on={false}
                    onPress={() =>
                      edit(i, {
                        id: e.id,
                        name: e.name,
                        unit: e.unit,
                        timed: e.kind === 'time',
                      })
                    }
                  />
                ))}
            </View>
          )}
          {known.has(d.id) && library.some((e) => e.id === d.id) && (
            <Text style={styles.muted}>
              Shared with {library.find((e) => e.id === d.id)!.workouts.join(', ')}: one history.
            </Text>
          )}
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={`Exercise ${i + 1} recorded as`}
            style={styles.row}>
            <Chip
              role="radio"
              title="Weight × reps"
              on={!d.timed}
              onPress={() => edit(i, { timed: false })}
            />
            <Chip role="radio" title="Time" on={d.timed} onPress={() => edit(i, { timed: true })} />
          </View>
          {d.timed ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Field label="Sets" value={d.sets} onChange={(v) => edit(i, { sets: v })} numeric />
              </View>
              <View style={{ flex: 2 }}>
                <Field
                  label="Seconds per set (optional)"
                  value={d.seconds}
                  onChange={(v) => edit(i, { seconds: v })}
                  numeric
                  placeholder="300"
                />
              </View>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Sets"
                    value={d.sets}
                    onChange={(v) => edit(i, { sets: v })}
                    numeric
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Reps"
                    value={d.repsMin}
                    onChange={(v) => edit(i, { repsMin: v })}
                    numeric
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="To (optional)"
                    value={d.repsMax}
                    onChange={(v) => edit(i, { repsMax: v })}
                    numeric
                    placeholder="—"
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={`Target load (${d.unit}, optional)`}
                    value={d.load}
                    onChange={(v) => edit(i, { load: v })}
                    decimal
                    placeholder="—"
                  />
                </View>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel={`Exercise ${i + 1} unit`}
                  style={{ flexDirection: 'row', gap: 6 }}>
                  {(['lb', 'kg'] as const).map((u) => (
                    <Chip
                      key={u}
                      role="radio"
                      title={u}
                      on={d.unit === u}
                      onPress={() => edit(i, { unit: u })}
                    />
                  ))}
                </View>
              </View>
            </>
          )}
          <Field
            label="Rest in seconds (optional)"
            value={d.rest}
            onChange={(v) => edit(i, { rest: v })}
            numeric
            placeholder="—"
          />
          <Field label="Notes (optional)" value={d.note} onChange={(v) => edit(i, { note: v })} />
          <View style={styles.row}>
            {i > 0 && (
              <Button
                secondary
                small
                title="Move up"
                label={`Move exercise ${i + 1} up`}
                onPress={() => move(i, -1)}
              />
            )}
            {i < exercises.length - 1 && (
              <Button
                secondary
                small
                title="Move down"
                label={`Move exercise ${i + 1} down`}
                onPress={() => move(i, 1)}
              />
            )}
            <Button
              secondary
              small
              title="Remove"
              label={`Remove exercise ${i + 1}`}
              onPress={() => setExercises((list) => list.filter((_, k) => k !== i))}
            />
          </View>
        </View>
      ))}
      {exercises.length < 50 && (
        <Button
          secondary
          title="Add exercise"
          onPress={() => setExercises((list) => [...list, blank(list.at(-1)?.unit ?? 'lb')])}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title="Save workout plan" onPress={() => void save()} />
      <Text style={{ ...type.muted, color: palette.label3 }}>
        Workout logs are private and never appear on the widget.
      </Text>
    </Sheet>
  );
}
