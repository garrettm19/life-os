import { useState } from 'react';
import { Text, View } from 'react-native';
import { StudyPlan, clock, parseTime } from '../domain/model';
import { DSA_STUDY, copyStudyPlan, planMinutes, saveStudyPlan } from '../domain/study';
import { routineOf } from '../domain/workouts';
import { useApp } from '../state/app-state';
import { Button, Field, Sheet, styles } from './components';
import { newId } from './ids';
import { linksText, parseLinks } from './links';
import { ReminderDraft, ReminderSettings } from './study-reminders';

type StageDraft = { id: string; title: string; minutes: string; links: string };

/** Edits a study objective's stages, links, preferred time and reminders. */
export function StudyPlanEditor({
  routineId,
  close,
}: {
  routineId: string | null;
  close: () => void;
}) {
  const { state } = useApp();
  const plan = routineId ? routineOf(state, routineId)?.study : undefined;
  if (!routineId || !plan) return null;
  return <Editor key={routineId} routineId={routineId} plan={plan} close={close} />;
}

function drafts(plan: StudyPlan): StageDraft[] {
  return plan.stages.map((s) => ({
    id: s.id,
    title: s.title,
    minutes: String(s.minutes),
    links: linksText(s.links),
  }));
}

function Editor({
  routineId,
  plan,
  close,
}: {
  routineId: string;
  plan: StudyPlan;
  close: () => void;
}) {
  const { change } = useApp();
  const [stages, setStages] = useState<StageDraft[]>(() => drafts(plan));
  const [time, setTime] = useState(plan.at === null ? '' : clock(plan.at));
  const [cue, setCue] = useState(plan.cue ?? '');
  const [reminders, setReminders] = useState<ReminderDraft>({
    start: plan.reminders.start,
    evening: plan.reminders.evening !== null,
    // No hour is suggested: the user chooses it.
    eveningText: plan.reminders.evening === null ? '' : clock(plan.reminders.evening),
    stageEnd: plan.reminders.stageEnd,
  });
  const [error, setError] = useState<string | null>(null);
  const edit = (id: string, patch: Partial<StageDraft>) => {
    setStages((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setError(null);
  };
  const build = (): StudyPlan => {
    const at = time.trim() ? parseTime(time) : null;
    if (reminders.start && at === null)
      throw new Error('Choose a study time for the reminder, or turn that reminder off.');
    let evening: number | null = null;
    if (reminders.evening) {
      try {
        evening = parseTime(reminders.eveningText);
      } catch {
        throw new Error('Enter the evening reminder time in 24-hour form (HH:MM).');
      }
    }
    if (cue.trim().length > 80) throw new Error('Keep the starting cue under 80 characters.');
    return {
      at,
      ...(cue.trim() && { cue: cue.trim() }),
      reminders: { start: reminders.start, evening, stageEnd: reminders.stageEnd },
      stages: stages.map((s, i) => {
        const minutes = Number(s.minutes.trim());
        if (!s.title.trim()) throw new Error(`Name stage ${i + 1}.`);
        if (!/^\d{1,3}$/.test(s.minutes.trim()) || minutes < 1 || minutes > 240)
          throw new Error(`Stage ${i + 1} needs 1–240 whole minutes.`);
        const links = parseLinks(s.links);
        if (links.length > 5) throw new Error(`Stage ${i + 1} can hold up to five links.`);
        return { id: s.id, title: s.title.trim(), minutes, links };
      }),
    };
  };
  let total: number | null = null;
  try {
    total = planMinutes(build());
  } catch {}
  const save = async () => {
    try {
      const next = build();
      const ok = await change((s) => saveStudyPlan(s, routineId, next));
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the study plan.');
    }
  };
  return (
    <Sheet title="Study plan" visible close={close}>
      <Text style={styles.muted}>
        {total !== null ? `${total} minutes in ${stages.length} stages. ` : ''}A session already
        running keeps the plan it started with; recorded sessions never change.
      </Text>
      {stages.map((s, i) => (
        <View key={s.id} style={styles.panel}>
          <Text style={styles.label}>Stage {i + 1}</Text>
          <Field
            label={`Stage ${i + 1} name`}
            value={s.title}
            onChange={(title) => edit(s.id, { title })}
            name
          />
          <Field
            label={`Stage ${i + 1} minutes`}
            value={s.minutes}
            onChange={(minutes) => edit(s.id, { minutes })}
            numeric
          />
          <Field
            label={`Stage ${i + 1} links (one per line: Label | https://…)`}
            value={s.links}
            onChange={(links) => edit(s.id, { links })}
            multiline
          />
          {stages.length > 1 && (
            <Button
              secondary
              small
              title="Remove stage"
              label={`Remove stage ${i + 1}, ${s.title || 'unnamed'}`}
              onPress={() => setStages((all) => all.filter((x) => x.id !== s.id))}
            />
          )}
        </View>
      ))}
      {stages.length < 8 && (
        <Button
          secondary
          small
          title="Add stage"
          onPress={() =>
            setStages((all) => [
              ...all,
              { id: newId('stage'), title: '', minutes: '10', links: '' },
            ])
          }
        />
      )}
      <Button
        secondary
        small
        title="Use the 25 + 30 + 5 DSA plan"
        onPress={() => setStages(drafts(copyStudyPlan(DSA_STUDY)))}
      />
      <Field
        label="Starting cue (optional)"
        value={cue}
        onChange={(v) => {
          setCue(v);
          setError(null);
        }}
        placeholder="After dinner"
        name
        hint={
          <Text style={styles.muted}>
            When study begins, in your words. Shown on Today as your plan; it is not a reminder.
          </Text>
        }
      />
      <Field
        label="Preferred study time (24-hour, optional)"
        value={time}
        onChange={(v) => {
          setTime(v);
          setError(null);
        }}
        placeholder="HH:MM"
        time
      />
      <ReminderSettings
        value={reminders}
        onChange={(next) => {
          setReminders(next);
          setError(null);
        }}
        hasTime={!!time.trim()}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title="Save study plan" onPress={() => void save()} />
    </Sheet>
  );
}
