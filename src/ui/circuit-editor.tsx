import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  addStep,
  clockText,
  moveStep,
  removeStep,
  restoreOriginal,
  saveCircuit,
  totalSeconds,
  updateStep,
} from '../domain/intervals';
import { IntervalRoutine } from '../domain/model';
import { useApp } from '../state/app-state';
import { Button, Field, Sheet, styles } from './components';
import { newId } from './ids';
import { fonts, palette, radius, type } from './theme';

/**
 * Edits one timed circuit: names, each interval's length, the rest after it (zero allowed), order,
 * additions and removals, and the preparation countdown. The total updates as you type. Saving
 * never changes circuits already recorded.
 */
export function CircuitEditor({
  circuit,
  close,
}: {
  circuit: IntervalRoutine | null;
  close: () => void;
}) {
  return circuit ? <Editor key={circuit.id} circuit={circuit} close={close} /> : null;
}

/** Whole seconds typed as text; anything else reads as NaN so the total says it is invalid. */
function seconds(text: string): number {
  return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : NaN;
}

function Editor({ circuit, close }: { circuit: IntervalRoutine; close: () => void }) {
  const { change } = useApp();
  const [draft, setDraft] = useState(circuit);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const text = (key: string, value: number) => texts[key] ?? String(value);
  const setNumber = (key: string, value: string, apply: (n: number) => IntervalRoutine) => {
    setTexts((t) => ({ ...t, [key]: value }));
    const n = seconds(value);
    if (!Number.isNaN(n)) setDraft(apply(n));
  };
  // Only fields still on screen count: a removed interval's text never holds Save back.
  const fields = ['prep', ...draft.steps.flatMap((s) => [`${s.id}:s`, `${s.id}:r`])];
  const invalid = fields.some((k) => k in texts && Number.isNaN(seconds(texts[k])));
  const total = totalSeconds(draft);
  const save = async () => {
    setError(null);
    if (invalid) {
      setError('Use whole seconds for every length and rest.');
      return;
    }
    try {
      const next = { ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() };
      if (!next.title) throw new Error('Give the circuit a name.');
      const ok = await change((s) => saveCircuit(s, next));
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the circuit.');
    }
  };
  return (
    <Sheet title="Edit circuit" visible close={close}>
      <Field
        label="Circuit name"
        value={draft.title}
        onChange={(title) => setDraft({ ...draft, title })}
        name
      />
      <View style={[styles.spread, { alignItems: 'baseline' }]}>
        <Text style={styles.label}>Total</Text>
        <Text style={{ ...type.count, fontSize: 22 }}>{invalid ? '—' : clockText(total)}</Text>
      </View>
      <SecondsBox
        label="Get ready (seconds)"
        value={text('prep', draft.prepSeconds)}
        onChange={(v) => setNumber('prep', v, (n) => ({ ...draft, prepSeconds: n }))}
      />
      {draft.steps.map((step, i) => {
        const last = i === draft.steps.length - 1;
        return (
          <View key={step.id} style={[styles.panel, { gap: 8 }]}>
            <View style={[styles.spread, { flexWrap: 'nowrap' }]}>
              <Text style={{ ...fonts.figure, color: palette.label3, minWidth: 24 }}>{i + 1}</Text>
              <TextInput
                accessibilityLabel={`Interval ${i + 1} name`}
                value={step.name}
                onChangeText={(name) => setDraft(updateStep(draft, step.id, { name }))}
                autoCapitalize="words"
                selectionColor={palette.done}
                style={[styles.input, { flex: 1, minWidth: 0 }]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SecondsBox
                label={`${step.name || `Interval ${i + 1}`} length in seconds`}
                short="Work s"
                value={text(`${step.id}:s`, step.seconds)}
                onChange={(v) =>
                  setNumber(`${step.id}:s`, v, (n) => updateStep(draft, step.id, { seconds: n }))
                }
              />
              <SecondsBox
                label={`Rest after ${step.name || `interval ${i + 1}`} in seconds`}
                short={last ? 'Rest s · not used' : 'Rest s'}
                value={text(`${step.id}:r`, step.restAfter)}
                onChange={(v) =>
                  setNumber(`${step.id}:r`, v, (n) => updateStep(draft, step.id, { restAfter: n }))
                }
              />
            </View>
            <View style={styles.row}>
              <Button
                secondary
                small
                title="Up"
                label={`Move ${step.name} up`}
                disabled={i === 0}
                onPress={() => setDraft(moveStep(draft, step.id, -1))}
              />
              <Button
                secondary
                small
                title="Down"
                label={`Move ${step.name} down`}
                disabled={last}
                onPress={() => setDraft(moveStep(draft, step.id, 1))}
              />
              <Button
                secondary
                small
                title="Remove"
                label={`Remove ${step.name}`}
                disabled={draft.steps.length === 1}
                onPress={() => setDraft(removeStep(draft, step.id))}
              />
            </View>
          </View>
        );
      })}
      <Button
        secondary
        small
        title="Add interval"
        disabled={draft.steps.length >= 60}
        onPress={() => setDraft(addStep(draft, newId('interval')))}
      />
      <Text style={styles.muted}>
        A left and right side are two intervals with no rest between them. The rest after the last
        interval is never used.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title="Save circuit" onPress={() => void save()} />
      {confirmRestore ? (
        <View style={styles.panel}>
          <Text style={styles.body}>
            Restore the original {clockText(totalSeconds(circuit.original))} circuit? Your edits
            here are replaced once you save.
          </Text>
          <View style={styles.row}>
            <Button
              secondary
              small
              title="Restore original"
              onPress={() => {
                setDraft(restoreOriginal(draft, new Date().toISOString()));
                setTexts({});
                setConfirmRestore(false);
              }}
            />
            <Button small title="Keep my edits" onPress={() => setConfirmRestore(false)} />
          </View>
        </View>
      ) : (
        <Button secondary small title="Restore original…" onPress={() => setConfirmRestore(true)} />
      )}
    </Sheet>
  );
}

function SecondsBox({
  label,
  short,
  value,
  onChange,
}: {
  label: string;
  short?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.label}>{short ?? label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        selectionColor={palette.done}
        style={{
          ...styles.input,
          ...fonts.figure,
          borderRadius: radius.control,
          borderColor: Number.isNaN(seconds(value)) ? palette.danger : palette.separator,
        }}
      />
    </View>
  );
}
