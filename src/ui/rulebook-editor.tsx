import { useState } from 'react';
import { Text } from 'react-native';
import { Routine } from '../domain/model';
import {
  parseCheckpoints,
  parseRules,
  ruleBookFor,
  rulesText,
  saveRuleBook,
} from '../domain/rules';
import { useApp } from '../state/app-state';
import { Button, Field, Sheet, styles } from './components';
import { newId } from './ids';

/**
 * The rules behind a rule review: short checkpoints answered after each session, and the full
 * numbered rulebook for reference. Pasting a numbered list works; each "N." starts a rule.
 */
export function RuleBookEditor({ routine, close }: { routine: Routine | null; close: () => void }) {
  return routine ? <Editor key={routine.id} routine={routine} close={close} /> : null;
}

function Editor({ routine, close }: { routine: Routine; close: () => void }) {
  const { state, change } = useApp();
  const existing = ruleBookFor(state, routine.id);
  const [title, setTitle] = useState(existing?.title ?? routine.title);
  const [checkpoints, setCheckpoints] = useState(
    existing?.checkpoints.map((c) => c.text).join('\n') ?? '',
  );
  const [rules, setRules] = useState(existing ? rulesText(existing.rules) : '');
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => existing?.id ?? newId('rulebook'));
  const parsedRules = parseRules(rules);
  const parsedCheckpoints = parseCheckpoints(checkpoints, existing?.checkpoints);
  const save = async () => {
    try {
      if (!title.trim()) throw new Error('Name the rulebook.');
      if (!parsedCheckpoints.length && !parsedRules.length)
        throw new Error('Add at least one checkpoint or rule.');
      const ok = await change((s) =>
        saveRuleBook(s, {
          id,
          routineId: routine.id,
          title: title.trim(),
          checkpoints: parsedCheckpoints,
          rules: parsedRules,
          updatedAt: new Date().toISOString(),
        }),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the rules.');
    }
  };
  return (
    <Sheet title="Rules" visible close={close}>
      <Text style={styles.muted}>
        Private. Kept only on this device and in your own backups; never on the widget.
      </Text>
      <Field label="Rulebook name" value={title} onChange={setTitle} name />
      <Field
        label={`Checkpoints, one per line · ${parsedCheckpoints.length}`}
        value={checkpoints}
        onChange={setCheckpoints}
        multiline
      />
      <Field
        label={`Full rules · ${parsedRules.length} · each starts "1." on its own line`}
        value={rules}
        onChange={setRules}
        multiline
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title="Save rules" onPress={() => void save()} />
      <Text style={styles.muted}>
        Rule numbers are their identity: keep a rule&apos;s number when you edit its wording so its
        history stays with it.
      </Text>
    </Sheet>
  );
}
