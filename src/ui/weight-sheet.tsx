import { useState } from 'react';
import { Text, View } from 'react-native';
import { withDay } from '../domain/data';
import { Block, Measurement, WeightUnit, displayDate, localDate, shiftDate } from '../domain/model';
import { deleteMeasurement, parseWeight, recordWeight, weightIn } from '../domain/measurements';
import { setStatus } from '../domain/planner';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
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
  const linkedDone = existing?.occurrenceId
    ? Object.values(state.days)
        .flatMap((d) => d.blocks)
        .some((b) => b.id === existing.occurrenceId && b.status === 'done')
    : false;
  const last = lastWeight(state.measurements, existing?.id);
  const [unit, setUnit] = useState<WeightUnit>(
    existing?.entered.unit ?? last?.entered.unit ?? 'lb',
  );
  const [value, setValue] = useState(existing ? String(weightIn(existing, unit)) : '');
  const [fasted, setFasted] = useState(existing?.fasted ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  // One ID per open form: a repeated Save corrects the same weight instead of failing on a duplicate.
  const [id] = useState(() => existing?.id ?? newId('weight'));
  const planned = target.occurrence?.block.status === 'planned';
  const save = async () => {
    try {
      const parsed = parseWeight(value, unit);
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
            unit,
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
            <Chip key={u} role="radio" title={u} on={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>
      </View>
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
      <Button title={existing ? 'Save correction' : 'Save weight'} onPress={() => void save()} />
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
      {existing && !linkedDone && (
        <Button
          secondary
          title="Delete this weight"
          onPress={() =>
            void change((s) => deleteMeasurement(s, existing.id)).then((ok) => ok && close())
          }
        />
      )}
      {existing && linkedDone && (
        <View style={{ gap: 8 }}>
          <Text style={styles.muted}>
            This weight completed a weigh-in. Deleting it removes it from your history and progress;
            choose what happens to the weigh-in.
          </Text>
          <Button
            secondary
            title="Delete weight, keep weigh-in done"
            onPress={() =>
              void change((s) => deleteMeasurement(s, existing.id)).then((ok) => ok && close())
            }
          />
          <Button
            secondary
            title="Delete weight and undo the weigh-in"
            onPress={() =>
              void change((s) => deleteMeasurement(s, existing.id, { undoObjective: true })).then(
                (ok) => ok && close(),
              )
            }
          />
        </View>
      )}
      <Text style={{ ...type.muted, color: palette.label3 }}>
        Private. Stays on this device and off the Home Screen widget. One weight per date.
      </Text>
    </Sheet>
  );
}
