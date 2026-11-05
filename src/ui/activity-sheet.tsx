import { useState } from 'react';
import { Text, View } from 'react-native';
import { parseMinutes, recordActivity, weeklyMinutes } from '../domain/activity';
import { Block, displayDate, localDate } from '../domain/model';
import { routineOf } from '../domain/workouts';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
import { newId } from './ids';
import { type } from './theme';

export type ActivityTarget = { occurrence: { date: string; block: Block } };

/** Records a duration activity (what you did and for how long); Save also completes it. */
export function ActivitySheet({
  target,
  close,
}: {
  target: ActivityTarget | null;
  close: () => void;
}) {
  return target ? (
    <ActivityForm key={target.occurrence.block.id} target={target} close={close} />
  ) : null;
}

function ActivityForm({ target, close }: { target: ActivityTarget; close: () => void }) {
  const { state, change } = useApp();
  const { date, block } = target.occurrence;
  const routine = routineOf(state, block.routineId);
  const existing = state.activitySessions.find((a) => a.occurrenceId === block.id);
  const choices = routine?.activities?.length ? routine.activities : ['Other'];
  const [activity, setActivity] = useState(existing?.activity ?? choices[0]);
  const [other, setOther] = useState('');
  const [minutes, setMinutes] = useState(
    existing ? String(existing.minutes) : routine?.duration ? String(routine.duration) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => existing?.id ?? newId('activity'));
  const week = weeklyMinutes(state, localDate(), 1, block.routineId)[0];
  const save = async () => {
    try {
      const what = activity === 'Other' && other.trim() ? other.trim() : activity;
      const ok = await change((s) =>
        recordActivity(
          s,
          {
            id: existing?.id,
            date,
            activity: what,
            minutes: parseMinutes(minutes),
            note,
            routineId: block.routineId,
            occurrence: { date, blockId: block.id },
          },
          id,
          new Date().toISOString(),
        ),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the activity.');
    }
  };
  return (
    <Sheet title={block.title} visible close={close}>
      <Text style={styles.label}>{displayDate(date)}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Activity" style={styles.row}>
        {choices.map((c) => (
          <Chip key={c} role="radio" title={c} on={activity === c} onPress={() => setActivity(c)} />
        ))}
      </View>
      {activity === 'Other' && (
        <Field label="What did you do? (optional)" value={other} onChange={setOther} name />
      )}
      <Field label="Minutes" value={minutes} onChange={setMinutes} numeric large />
      <Field label="Note (optional)" value={note} onChange={setNote} />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title={existing ? 'Save changes' : 'Save and complete'} onPress={() => void save()} />
      <Text style={{ ...type.meta }}>
        This week: {week.minutes} min in {week.sessions} session{week.sessions === 1 ? '' : 's'}
        {routine?.duration && routine.weekdays?.length
          ? ` · target ${routine.duration * routine.weekdays.length} min`
          : ''}
      </Text>
    </Sheet>
  );
}
