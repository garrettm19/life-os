import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  DIFFICULTIES,
  compareCheckpoints,
  comparisonLine,
  conditions,
  deleteCheckpoint,
  resultText,
  saveCheckpoint,
  sortedCheckpoints,
} from '../domain/checkpoints';
import { CheckpointDifficulty, SkillCheckpoint, displayDate, localDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, SectionLabel, Sheet, styles } from './components';
import { Disclosure, LinkButton } from './controls';
import { newId } from './ids';
import { type } from './theme';

const whole = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : NaN);

function CheckpointSheet({
  existing,
  previous,
  close,
}: {
  existing?: SkillCheckpoint;
  previous?: SkillCheckpoint;
  close: () => void;
}) {
  const { change } = useApp();
  // A new checkpoint repeats the last one's conditions, so a comparable result takes a few taps.
  const from = existing ?? previous;
  const [date, setDate] = useState(existing?.date ?? localDate());
  const [method, setMethod] = useState(from?.method ?? '');
  const [difficulty, setDifficulty] = useState<CheckpointDifficulty>(from?.difficulty ?? 'medium');
  const [attempted, setAttempted] = useState(from ? String(from.attempted) : '');
  const [solved, setSolved] = useState(existing ? String(existing.solved) : '');
  const [minutes, setMinutes] = useState(from?.minutes ? String(from.minutes) : '');
  const [fresh, setFresh] = useState(from?.fresh ?? true);
  const [topics, setTopics] = useState(existing?.topics ?? '');
  const [next, setNext] = useState(existing?.next ?? '');
  const done = (ok: boolean) => ok && close();
  const save = () =>
    void change((s) => {
      const limit = minutes.trim() ? whole(minutes) : null;
      if (Number.isNaN(limit) || limit === 0) throw new Error('Enter the time limit in minutes.');
      return saveCheckpoint(
        s,
        {
          id: existing?.id,
          date,
          method,
          difficulty,
          attempted: whole(attempted),
          solved: whole(solved),
          minutes: limit,
          fresh,
          topics,
          next,
        },
        newId('checkpoint'),
        new Date().toISOString(),
      );
    }).then(done);
  return (
    <Sheet title={existing ? 'Skill checkpoint' : 'Record a checkpoint'} visible close={close}>
      <Text style={styles.muted}>
        Done outside Life OS, for example a set of interview-style problems. A result, not a skill
        score.
      </Text>
      <Field
        label="Where and how"
        value={method}
        onChange={setMethod}
        placeholder="Course site, new problems"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {DIFFICULTIES.map(([value, label]) => (
          <Chip
            key={value}
            title={label}
            role="radio"
            on={difficulty === value}
            onPress={() => setDifficulty(value)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flexGrow: 1, flexBasis: 120 }}>
          <Field label="Attempted" value={attempted} onChange={setAttempted} numeric />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 120 }}>
          <Field label="Solved on your own" value={solved} onChange={setSolved} numeric />
        </View>
      </View>
      <Field
        label="Time limit in minutes (blank = untimed)"
        value={minutes}
        onChange={setMinutes}
        numeric
      />
      <Chip
        title="All problems were new to me"
        role="checkbox"
        on={fresh}
        onPress={() => setFresh(!fresh)}
      />
      <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} />
      <Disclosure title="Topics and next practice area" plain>
        <Field label="Topics (optional)" value={topics} onChange={setTopics} multiline />
        <Field label="Next practice area (optional)" value={next} onChange={setNext} />
      </Disclosure>
      <Button
        title="Save checkpoint"
        disabled={!method.trim() || !attempted.trim() || !solved.trim()}
        needs="Fill in where and how, attempted and solved to save it."
        onPress={save}
      />
      {existing && (
        <Button
          secondary
          title="Delete this checkpoint"
          onPress={() => void change((s) => deleteCheckpoint(s, existing.id)).then(done)}
        />
      )}
    </Sheet>
  );
}

function CheckpointRow({ c, onEdit }: { c: SkillCheckpoint; onEdit: () => void }) {
  return (
    <View style={{ gap: 0 }}>
      <Text style={type.item}>
        {displayDate(c.date)} · {resultText(c)}
      </Text>
      <Text style={type.caption}>
        {c.method} · {conditions(c)}
        {c.next ? ` · next: ${c.next}` : ''}
      </Text>
      <LinkButton
        title="Edit"
        tone="dim"
        label={`Edit the checkpoint of ${displayDate(c.date)}`}
        onPress={onEdit}
      />
    </View>
  );
}

/**
 * Skill checkpoints on Progress, under This week: the latest result against the earliest one under the same
 * conditions (when there is one), the recent results, and a way to record the next. Optional and
 * roughly monthly; daily study stays one tap.
 */
export function SkillCheckpoints() {
  const { state } = useApp();
  const [editing, setEditing] = useState<SkillCheckpoint | 'new' | null>(null);
  const all = sortedCheckpoints(state);
  const hasStudy = state.programs.some((p) => p.routines.some((r) => r.study));
  if (!all.length && !hasStudy) return null;
  const recent = [...all].reverse();
  return (
    <View style={styles.section}>
      <SectionLabel title="Skill checkpoints" />
      <View style={styles.card}>
        <Text style={styles.body}>{comparisonLine(compareCheckpoints(state))}</Text>
        {recent.slice(0, 1).map((c) => (
          <CheckpointRow key={c.id} c={c} onEdit={() => setEditing(c)} />
        ))}
        {recent.length > 1 && (
          <Disclosure title="Earlier checkpoints" summary={String(recent.length - 1)} plain>
            {recent.slice(1).map((c) => (
              <CheckpointRow key={c.id} c={c} onEdit={() => setEditing(c)} />
            ))}
          </Disclosure>
        )}
        <View style={{ alignSelf: 'flex-start' }}>
          <Button small secondary title="Record a checkpoint" onPress={() => setEditing('new')} />
        </View>
      </View>
      {editing && (
        <CheckpointSheet
          existing={editing === 'new' ? undefined : editing}
          previous={all.at(-1)}
          close={() => setEditing(null)}
        />
      )}
    </View>
  );
}
