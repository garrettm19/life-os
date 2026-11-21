import { useState } from 'react';
import { Text, View } from 'react-native';
import { withDay } from '../domain/data';
import { Block, Measurement, WeightUnit, displayDate, localDate, shiftDate } from '../domain/model';
import {
  convertWeight,
  deleteMeasurement,
  parseWeight,
  recordWeight,
  weightIn,
} from '../domain/measurements';
import { undoEffect } from '../domain/objectives';
import { setStatus } from '../domain/planner';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
import { ConfirmRemove, linkedQuestion } from './confirm-remove';
import { newId } from './ids';
import { palette, type } from './theme';

export type WeightTarget = {
  /** The weekly objective being completed, when opened from Today. */
  occurrence?: { date: string; block: Block };
  /** An existing measurement being corrected. */
  measurement?: Measurement;
};

function lastWeight(measurements: Measurement[], excludeId?: string): Measurement | undefined {
  return [...measurements]
    .filter((m) => m.kind === 'body-weight' && m.id !== excludeId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))[0];
}

/**
 * Fast weight entry: one number, the unit, Save. Saving from the weekly objective marks it Done in
 * the same save. A date already holding a weight opens that entry for correction instead.
 */
export function WeightSheet({ target, close }: { target: WeightTarget | null; close: () => void }) {
  return target ? <WeightForm key={formKey(target)} target={target} close={close} /> : null;
}

function formKey(target: WeightTarget) {
  return target.measurement?.id ?? target.occurrence?.block.id ?? 'new';
}

function WeightForm({ target, close }: { target: WeightTarget; close: () => void }) {
  const { state, change } = useApp();
  const [today] = useState(() => localDate());
  // A weight added on its own can be for any day up to today, scheduled or not.
  const [chosen, setChosen] = useState(today);
  const standalone = !target.measurement && !target.occurrence;
  const date = target.measurement?.date ?? target.occurrence?.date ?? chosen;
  // Opening the objective on a date that already has a weight corrects that weight. A weight
  // added on its own never silently replaces one: the one-per-date rule explains instead.
  const existing =
    target.measurement ??
    (target.occurrence
      ? state.measurements.find(
          (m) =>
            m.kind === 'body-weight' &&
            (m.occurrenceId === target.occurrence?.block.id || m.date === date),
        )
      : undefined);
  // A weight that completed its weigh-in, still Done: deleting it asks what happens to the Done.
  const undoing = existing?.occurrenceId ? undoEffect(state, existing.occurrenceId, today) : null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = (undoObjective: boolean) => {
    if (!existing) return;
    void change((s) => deleteMeasurement(s, existing.id, { undoObjective })).then(
      (ok) => ok && close(),
    );
  };
  const last = lastWeight(state.measurements, existing?.id);
  const [unit, setUnit] = useState<WeightUnit>(
    existing?.entered.unit ?? last?.entered.unit ?? 'lb',
  );
  const [value, setValue] = useState(existing ? String(weightIn(existing, unit)) : '');
  // What the number in the field stands for while only the unit changes: the saved weight being
  // corrected, or the number as first typed in its unit. Each switch converts from it, so the
  // field keeps meaning the same weight and toggling back and forth never drifts. Typing resets it.
  const [origin, setOrigin] = useState<{ value: number; unit: WeightUnit } | 'saved' | null>(
    existing ? 'saved' : null,
  );
  const switchUnit = (next: WeightUnit) => {
    if (next === unit) return;
    setUnit(next);
    if (origin === 'saved' && existing) {
      setValue(String(weightIn(existing, next)));
      setError(null);
      return;
    }
    let from = origin === 'saved' ? null : origin;
    if (!from) {
      try {
        from = { value: parseWeight(value, unit), unit };
      } catch {
        // A blank or invalid number is left as it is, for its own message on Save.
        return;
      }
      setOrigin(from);
    }
    setValue(String(convertWeight(from.value, from.unit, next)));
    setError(null);
  };
  // The number the field was converted from, shown under it so a switch never looks like an edit.
  const from = origin === 'saved' ? (existing?.entered ?? null) : origin;
  const converted =
    from && from.unit !== unit ? `${from.value} ${from.unit} = ${value} ${unit}` : null;
  const [fasted, setFasted] = useState(existing?.fasted ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  // One ID per open form: a repeated Save corrects the same weight instead of failing on a duplicate.
  const [id] = useState(() => existing?.id ?? newId('weight'));
  const planned = target.occurrence?.block.status === 'planned';
  const save = async () => {
    try {
      // A saved weight whose number was not edited (only its unit shown in the other one) keeps the
      // weight exactly as first entered, so looking at it in lb or kg never moves it by a rounding.
      const kept = origin === 'saved' && existing ? existing.entered : null;
      const parsed = kept ? kept.value : parseWeight(value, unit);
      const now = new Date().toISOString();
      const occurrence = target.occurrence
        ? { date: target.occurrence.date, blockId: target.occurrence.block.id }
        : undefined;
      const ok = await change((s) =>
        recordWeight(
          s,
          {
            id: s.measurements.some((m) => m.id === id) ? id : undefined,
            value: parsed,
            unit: kept ? kept.unit : unit,
            date,
            fasted,
            note,
            occurrence,
          },
          id,
          now,
        ),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the weight.');
    }
  };
  return (
    <Sheet title="Body weight" visible close={close}>
      {standalone && (
        <View style={styles.row}>
          <Button
            secondary
            small
            title="Earlier day"
            onPress={() => setChosen(shiftDate(chosen, -1))}
          />
          <Text style={{ ...type.meta, color: palette.label, minWidth: 110, textAlign: 'center' }}>
            {chosen === today ? 'Today' : displayDate(chosen)}
          </Text>
          <Button
            secondary
            small
            title="Later day"
            disabled={chosen >= today}
            onPress={() => setChosen(shiftDate(chosen, 1))}
          />
        </View>
      )}
      <Text style={styles.label}>
        {displayDate(date)}
        {last ? ` · Last ${weightIn(last, unit)} ${unit} on ${displayDate(last.date)}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field
            label={`Weight in ${unit}`}
            value={value}
            onChange={(next) => {
              setValue(next);
              setOrigin(null);
              setError(null);
            }}
            placeholder={last ? String(weightIn(last, unit)) : unit === 'lb' ? '180.4' : '81.8'}
            decimal
            large
          />
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Unit"
          style={{ flexDirection: 'row', gap: 6 }}>
          {(['lb', 'kg'] as const).map((u) => (
            <Chip key={u} role="radio" title={u} on={unit === u} onPress={() => switchUnit(u)} />
          ))}
        </View>
      </View>
      {converted && <Text style={type.caption}>{converted}</Text>}
      <View style={styles.row}>
        <Chip
          role="checkbox"
          title="Fasted"
          on={fasted === true}
          onPress={() => setFasted(fasted === true ? null : true)}
        />
      </View>
      <Field label="Note (optional)" value={note} onChange={setNote} name />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      {/* While a delete is being confirmed, the card is the only decision on screen. */}
      {!confirmDelete && (
        <Button title={existing ? 'Save correction' : 'Save weight'} onPress={() => void save()} />
      )}
      {planned && (
        <Button
          secondary
          title="Done without a measurement"
          onPress={() =>
            void change((s) =>
              withDay(
                s,
                setStatus(s.days[target.occurrence!.date], target.occurrence!.block.id, 'done'),
              ),
            ).then((ok) => ok && close())
          }
        />
      )}
      {existing && (
        <ConfirmRemove
          open={confirmDelete}
          setOpen={setConfirmDelete}
          ask="Delete this weight"
          {...(undoing
            ? linkedQuestion(
                'weight',
                undoing,
                { undo: () => remove(true), keep: () => remove(false) },
                today,
              )
            : {
                message: 'Delete this weight? It leaves your history and Progress.',
                remove: { title: 'Delete weight', onPress: () => remove(false) },
              })}
        />
      )}
      <Text style={{ ...type.muted, color: palette.label3 }}>
        Private. Stays on this device and off the Home Screen widget. One weight per date.
      </Text>
    </Sheet>
  );
}
