import { useState } from 'react';
import { Text, View } from 'react-native';
import { Program, displayDate } from '../domain/model';
import {
  leavingWorkouts,
  projectDraftRotation,
  rotationWorkouts,
  setRotation,
} from '../domain/rotation';
import { useApp } from '../state/app-state';
import { Button, Chip, Sheet, styles } from './components';
import { Weekdays } from './controls';
import { palette, type } from './theme';

/**
 * Sets up a program's workout rotation: which workouts, in what order, default rest days, and the
 * workout to start with when none has been done yet. The next workout always follows the last one
 * completed; rest days and missed days never advance it.
 */
export function RotationEditor({ program, close }: { program: Program | null; close: () => void }) {
  return program ? <Editor key={program.id} program={program} close={close} /> : null;
}

function Editor({ program, close }: { program: Program; close: () => void }) {
  const { state, change } = useApp();
  const live = state.programs.find((p) => p.id === program.id) ?? program;
  const workouts = rotationWorkouts(state, live);
  const [order, setOrder] = useState<string[]>(
    live.rotation?.order ?? workouts.filter((r) => r.enabled).map((r) => r.id),
  );
  const [rest, setRest] = useState<number[]>(live.rotation?.restDays ?? [0]);
  const [start, setStart] = useState<string | null>(live.rotation?.startWith ?? null);
  const [error, setError] = useState<string | null>(null);
  /** Days chosen for workouts leaving the rotation, by routine ID; null until a save needs them. */
  const [leavingDays, setLeavingDays] = useState<Record<string, number[]> | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  // Days confirmed for one change never carry over to another: any edit asks again.
  const [confirmedFor, setConfirmedFor] = useState('');
  const changeKey = JSON.stringify([order, rest, start]);
  if (leavingDays !== null && confirmedFor !== changeKey) {
    setLeavingDays(null);
    setConfirmedFor(changeKey);
  }
  const title = (id: string) => live.routines.find((r) => r.id === id)?.title ?? id;
  const move = (i: number, delta: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setOrder(next);
  };
  // What Save would place: today's planned workout it replaces is left out of the projection.
  const preview =
    order.length && rest.length < 7
      ? projectDraftRotation(
          state,
          live,
          { order, restDays: rest, startWith: start },
          new Date().toISOString(),
        )
      : [];
  const nextRotation = (off: boolean) =>
    off
      ? null
      : {
          order,
          restDays: [...rest].sort(),
          startWith: order.includes(start ?? '') ? start : null,
        };
  // Workouts leaving with days still to choose: an enabled one never leaves without days.
  const leaving = leavingDays ? leavingWorkouts(state, live.id, nextRotation(turningOff)) : [];
  const missing = leaving.filter(
    (w) =>
      live.routines.find((r) => r.id === w.routineId)?.enabled &&
      !(leavingDays?.[w.routineId] ?? []).length,
  );
  const save = async (off = false) => {
    setError(null);
    // Workouts leaving the rotation get their days back; confirm them first.
    const going = leavingWorkouts(state, live.id, nextRotation(off));
    if (going.length && leavingDays === null) {
      setConfirmedFor(changeKey);
      setTurningOff(off);
      setLeavingDays(Object.fromEntries(going.map((w) => [w.routineId, w.suggested ?? []])));
      return;
    }
    try {
      const ok = await change((s) =>
        setRotation(s, live.id, nextRotation(off), new Date().toISOString(), leavingDays ?? {}),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the rotation.');
    }
  };
  return (
    <Sheet title="Workout rotation" visible close={close}>
      <Text style={styles.muted}>
        One workout per training day, in this order, then back to the start. The next workout is
        always the one after your last completed workout, so a rest day or a missed day never skips
        one. Workouts in the rotation become checklist objectives without fixed weekdays.
      </Text>
      <Text style={styles.label}>Workouts · in order</Text>
      {order.map((id, i) => (
        <View key={id} style={[styles.spread, { flexWrap: 'nowrap', gap: 8 }]}>
          <Text style={[styles.body, { flex: 1 }]}>
            {i + 1}. {title(id)}
          </Text>
          <Button
            secondary
            small
            title="Up"
            label={`Move ${title(id)} earlier`}
            disabled={i === 0}
            onPress={() => move(i, -1)}
          />
          <Button
            secondary
            small
            title="Down"
            label={`Move ${title(id)} later`}
            disabled={i === order.length - 1}
            onPress={() => move(i, 1)}
          />
          <Button
            secondary
            small
            title="Remove"
            label={`Remove ${title(id)} from the rotation`}
            onPress={() => setOrder(order.filter((x) => x !== id))}
          />
        </View>
      ))}
      {workouts.some((r) => !order.includes(r.id)) && (
        <View style={styles.row}>
          {workouts
            .filter((r) => !order.includes(r.id))
            .map((r) => (
              <Chip
                key={r.id}
                role="checkbox"
                title={`Add ${r.title}`}
                on={false}
                onPress={() => setOrder([...order, r.id])}
              />
            ))}
        </View>
      )}
      <Text style={styles.label}>Default rest days</Text>
      <Weekdays value={rest} onChange={(days) => setRest(days)} />
      <Text style={styles.muted}>
        Any day can still be switched: rest on a training day from the workout, or train on a rest
        day from Today.
      </Text>
      <Text style={styles.label}>Start with · only until a workout is done</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Start with" style={styles.row}>
        {order.map((id) => (
          <Chip
            key={id}
            role="radio"
            title={title(id)}
            on={(start ?? order[0]) === id}
            onPress={() => setStart(id)}
          />
        ))}
      </View>
      {preview.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.label}>Coming days</Text>
          {preview.map((d) => (
            <Text
              key={d.date}
              style={{ ...type.meta, color: d.kind === 'rest' ? palette.label3 : palette.label2 }}>
              {displayDate(d.date)} · {d.routineId ? title(d.routineId) : 'Rest'}
              {d.kind === 'done' ? ' · done' : d.kind === 'skipped' ? ' · skipped' : ''}
            </Text>
          ))}
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      {leavingDays && (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={{ ...type.callout, color: palette.accent }}>
            {turningOff ? 'Back to weekly days' : 'Leaving the rotation'}
          </Text>
          <Text style={styles.body}>
            These workouts get their own days again. Days they had before the rotation are filled
            in; check them, then confirm. Recorded workouts never change.
          </Text>
          {leaving.map((w) => (
            <View key={w.routineId} style={{ gap: 6 }}>
              <Text style={styles.label}>
                {w.title}
                {w.suggested ? '' : ' · no earlier days remembered'}
              </Text>
              <Weekdays
                value={leavingDays[w.routineId] ?? []}
                onChange={(days) => setLeavingDays({ ...leavingDays, [w.routineId]: days })}
              />
            </View>
          ))}
          <View style={styles.row}>
            {/* Days missing are said under the button, where the tap was, never off screen. */}
            <Button
              title={turningOff ? 'Turn off with these days' : 'Save with these days'}
              disabled={missing.length > 0}
              needs={`Choose days for ${missing.map((w) => w.title).join(', ')} first.`}
              onPress={() => void save(turningOff)}
            />
            <Button secondary small title="Back" onPress={() => setLeavingDays(null)} />
          </View>
        </View>
      )}
      <Button
        title={live.rotation ? 'Save rotation' : 'Start rotation'}
        disabled={!order.length || rest.length === 7}
        needs={
          !order.length
            ? 'Add a workout to the rotation to save it.'
            : 'Leave at least one training day to save it.'
        }
        onPress={() => void save()}
      />
      {live.rotation && (
        <Button secondary small title="Turn the rotation off" onPress={() => void save(true)} />
      )}
      {live.rotation && (
        <Text style={styles.muted}>
          Turning it off keeps every recorded workout and gives each workout its earlier days back
          (you confirm them first).
        </Text>
      )}
    </Sheet>
  );
}
