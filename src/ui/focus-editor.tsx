import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  FocusInput,
  activeFocus,
  defaultReviewDate,
  editFocus,
  endFocus,
  pastFocuses,
  startFocus,
} from '../domain/focus';
import { Focus, FocusEvidence, displayDate, localDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
import { Disclosure } from './controls';
import { newId } from './ids';
import { type } from './theme';

const EVIDENCE: [FocusEvidence | 'none', string][] = [
  ['career', 'Career and study'],
  ['money', 'Money'],
  ['training', 'Training'],
  ['trading', 'Trading process'],
  ['none', 'Routines only'],
];

const blank = (today: string): FocusInput => ({
  title: '',
  goalId: null,
  outcome: '',
  evidence: null,
  routineIds: [],
  leadRoutineId: null,
  cue: '',
  baseline: '',
  target: '',
  reviewDate: defaultReviewDate(today),
});

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/**
 * Choose or edit the one 90-day focus: the priority, what progress looks like, which existing
 * routines serve it and when to review it. Everything but the title is optional; nothing is created
 * on the plan. With a focus active, starting another one archives it (its records stay).
 */
export function FocusEditor({ visible, close }: { visible: boolean; close: () => void }) {
  const { state, change } = useApp();
  const today = localDate();
  const current = activeFocus(state);
  const [fresh, setFresh] = useState(false);
  const editing: Focus | undefined = fresh ? undefined : current;
  const [form, setForm] = useState<FocusInput>(() => (current ? { ...current } : blank(today)));
  const set = (patch: Partial<FocusInput>) => setForm((f) => ({ ...f, ...patch }));
  const routines = state.programs
    .flatMap((p) => p.routines)
    .filter((r) => r.enabled || form.routineIds.includes(r.id));
  const toggle = (id: string) =>
    set({
      routineIds: form.routineIds.includes(id)
        ? form.routineIds.filter((x) => x !== id)
        : [...form.routineIds, id],
      leadRoutineId: form.leadRoutineId === id ? null : form.leadRoutineId,
    });
  const done = (ok: boolean) => ok && close();
  const save = () => {
    const at = new Date().toISOString();
    void change((s) =>
      editing
        ? editFocus(s, editing.id, form, at)
        : startFocus(s, form, newId('focus'), at, { replace: !!current }),
    ).then(done);
  };
  const finish = (status: 'completed' | 'archived') =>
    editing &&
    void change((s) => endFocus(s, editing.id, status, new Date().toISOString())).then(done);
  const startOver = () => {
    setFresh(true);
    setForm(blank(today));
  };
  const linked = form.routineIds.map((id) => routines.find((r) => r.id === id)).filter((r) => !!r);
  const past = pastFocuses(state);
  return (
    <Sheet
      title={editing ? '90-day focus' : 'Choose a 90-day focus'}
      visible={visible}
      close={close}
      page={editing ? 'edit' : 'new'}>
      {!editing && current && (
        <Text style={styles.muted}>
          Saving starts this focus today and archives “{current.title}”. Its records and weekly
          reviews stay readable.
        </Text>
      )}
      {editing && (
        <Text style={type.caption}>
          Started {displayDate(editing.startDate)} · review {displayDate(editing.reviewDate)}
        </Text>
      )}
      <Field
        label="What is the priority?"
        value={form.title}
        onChange={(title) => set({ title })}
        placeholder="Interview readiness"
        name
      />
      <Field
        label="What would meaningful progress look like? (optional)"
        value={form.outcome}
        onChange={(outcome) => set({ outcome })}
        placeholder="Solve new medium problems within the time limit"
        multiline
      />
      <Text style={type.caption}>Evidence to show on Progress</Text>
      <Row>
        {EVIDENCE.map(([value, label]) => (
          <Chip
            key={value}
            title={label}
            role="radio"
            on={(form.evidence ?? 'none') === value}
            onPress={() => set({ evidence: value === 'none' ? null : value })}
          />
        ))}
      </Row>
      <Text style={type.caption}>Which existing routines support it? (optional)</Text>
      <Row>
        {routines.map((r) => (
          <Chip
            key={r.id}
            title={r.enabled ? r.title : `${r.title} (paused)`}
            role="checkbox"
            on={form.routineIds.includes(r.id)}
            onPress={() => toggle(r.id)}
          />
        ))}
      </Row>
      {linked.length > 1 && (
        <>
          <Text style={type.caption}>Today offers first</Text>
          <Row>
            {linked.map((r) => (
              <Chip
                key={r.id}
                title={r.title}
                role="radio"
                on={(form.leadRoutineId ?? form.routineIds[0]) === r.id}
                onPress={() => set({ leadRoutineId: r.id })}
              />
            ))}
          </Row>
        </>
      )}
      {state.goals.length > 0 && (
        <>
          <Text style={type.caption}>Goal it serves (optional)</Text>
          <Row>
            {state.goals.map((g) => (
              <Chip
                key={g.id}
                title={g.title}
                role="radio"
                on={form.goalId === g.id}
                onPress={() => set({ goalId: form.goalId === g.id ? null : g.id })}
              />
            ))}
          </Row>
        </>
      )}
      <Field
        label="Review on (YYYY-MM-DD)"
        value={form.reviewDate}
        onChange={(reviewDate) => set({ reviewDate })}
      />
      <Disclosure title="Starting cue, baseline and target" plain>
        <Field
          label="If–then cue (optional, your words)"
          value={form.cue}
          onChange={(cue) => set({ cue })}
          placeholder="If I put it off after dinner, I open the course and start one problem."
          multiline
        />
        <Field
          label="Where it stands now (optional)"
          value={form.baseline}
          onChange={(baseline) => set({ baseline })}
          multiline
        />
        <Field
          label="Target or milestone (optional)"
          value={form.target}
          onChange={(target) => set({ target })}
          multiline
        />
      </Disclosure>
      <Button
        title={
          editing ? 'Save focus' : current ? 'Start and archive the current one' : 'Start focus'
        }
        disabled={!form.title.trim()}
        needs="Name the priority to save it."
        onPress={save}
      />
      {editing && (
        <View style={{ gap: 8 }}>
          <Button secondary title="Mark it complete" onPress={() => finish('completed')} />
          <Button secondary title="Archive without completing" onPress={() => finish('archived')} />
          <Button secondary title="Start a different focus" onPress={startOver} />
        </View>
      )}
      {past.length > 0 && (
        <Disclosure title="Earlier focus periods" summary={String(past.length)} plain>
          {past.map((f) => (
            <Text key={f.id} style={styles.muted}>
              {f.title} · {displayDate(f.startDate)} to{' '}
              {f.endedAt ? displayDate(localDate(new Date(f.endedAt))) : '—'} ·{' '}
              {f.status === 'completed' ? 'completed' : 'archived'}
            </Text>
          ))}
        </Disclosure>
      )}
    </Sheet>
  );
}
