import { useState } from 'react';
import { Text, View } from 'react-native';
import { CATEGORY_LABELS, deleteLog, saveLog } from '../domain/lifelog';
import { LOG_CATEGORIES, LifeLogEntry, LogCategory, displayDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
import { newId } from './ids';
import { palette, type } from './theme';

export type LogTarget = { date: string; entry?: LifeLogEntry };

/** A short private note about the day. Everything but the words is optional. */
export function LogSheet({ target, close }: { target: LogTarget | null; close: () => void }) {
  return target ? (
    <LogForm key={target.entry?.id ?? `new-${target.date}`} target={target} close={close} />
  ) : null;
}

function Rating({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip
            key={n}
            role="radio"
            title={String(n)}
            on={value === n}
            onPress={() => onChange(value === n ? null : n)}
          />
        ))}
      </View>
    </View>
  );
}

function LogForm({ target, close }: { target: LogTarget; close: () => void }) {
  const { state, change } = useApp();
  const entry = target.entry;
  const [text, setText] = useState(entry?.text ?? '');
  const [category, setCategory] = useState<LogCategory | null>(entry?.category ?? null);
  const [energy, setEnergy] = useState(entry?.energy ?? null);
  const [mood, setMood] = useState(entry?.mood ?? null);
  const [goalId, setGoalId] = useState(entry?.goalId ?? null);
  const [error, setError] = useState<string | null>(null);
  // One ID per open form: a repeated Save updates the same entry instead of adding another.
  const [id] = useState(() => entry?.id ?? newId('log'));
  const [details, setDetails] = useState(
    !!(entry?.category || entry?.energy || entry?.mood || entry?.goalId),
  );
  const save = async () => {
    try {
      const now = new Date().toISOString();
      const input = { text, date: target.date, category, energy, mood, goalId };
      const ok = await change((s) =>
        saveLog(s, input, id, now, s.lifeLog.some((e) => e.id === id) ? id : undefined),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the entry.');
    }
  };
  return (
    <Sheet title={entry ? 'Edit log entry' : 'Log'} visible close={close}>
      <Text style={styles.label}>{displayDate(target.date)}</Text>
      <Field
        label="What happened?"
        value={text}
        onChange={(next) => {
          setText(next);
          setError(null);
        }}
        placeholder="Productive coding session"
        multiline
        name
      />
      {!details ? (
        <Button secondary small title="Add category or rating" onPress={() => setDetails(true)} />
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Category (optional)</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={styles.row}>
              {LOG_CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  role="radio"
                  title={CATEGORY_LABELS[c]}
                  on={category === c}
                  onPress={() => setCategory(category === c ? null : c)}
                />
              ))}
            </View>
          </View>
          <Rating label="Energy, self-reported (optional)" value={energy} onChange={setEnergy} />
          <Rating label="Mood, self-reported (optional)" value={mood} onChange={setMood} />
          {state.goals.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Related goal (optional)</Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Related goal"
                style={styles.row}>
                {state.goals.map((g) => (
                  <Chip
                    key={g.id}
                    role="radio"
                    title={g.title}
                    on={goalId === g.id}
                    onPress={() => setGoalId(goalId === g.id ? null : g.id)}
                  />
                ))}
              </View>
            </View>
          )}
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title={entry ? 'Save entry' : 'Save to log'} onPress={() => void save()} />
      {entry && (
        <Button
          secondary
          title="Delete this entry"
          onPress={() => void change((s) => deleteLog(s, entry.id)).then((ok) => ok && close())}
        />
      )}
      <Text style={{ ...type.muted, color: palette.label3 }}>
        Private. Ratings are your own impressions, not measurements. Logging never affects Day
        Cleared.
      </Text>
    </Sheet>
  );
}
