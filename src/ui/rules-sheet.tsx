import { useState } from 'react';
import { Text, View } from 'react-native';
import { Block, RuleAnswer, displayDate, shiftDate } from '../domain/model';
import { adherence, ruleBookFor, saveRuleReview } from '../domain/rules';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, SectionLabel, Sheet, styles } from './components';
import { newId } from './ids';
import { palette, type } from './theme';

export type RulesTarget = { occurrence: { date: string; block: Block } };

const ANSWERS: [RuleAnswer, string][] = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['na', 'N/A'],
];

/**
 * The rule-adherence review: each checkpoint Yes / No / Not applicable, any full rule broken, or
 * "No activity today". It records honesty, not results: there is no profit, balance or count of
 * activities anywhere here.
 */
export function RulesSheet({ target, close }: { target: RulesTarget | null; close: () => void }) {
  return target ? (
    <RulesForm key={target.occurrence.block.id} target={target} close={close} />
  ) : null;
}

function RulesForm({ target, close }: { target: RulesTarget; close: () => void }) {
  const { state, change } = useApp();
  const { date, block } = target.occurrence;
  const book = ruleBookFor(state, block.routineId);
  const existing = state.ruleReviews.find((r) => r.occurrenceId === block.id);
  const [answers, setAnswers] = useState<Record<string, RuleAnswer>>(
    Object.fromEntries((existing?.answers ?? []).map((a) => [a.checkpointId, a.answer])),
  );
  const [violations, setViolations] = useState<string[]>(existing?.violations ?? []);
  const [note, setNote] = useState(existing?.note ?? '');
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => existing?.id ?? newId('review'));
  if (!book)
    return (
      <Sheet title={block.title} visible close={close}>
        <Text style={styles.body}>Add your rules to this routine in Programs first.</Text>
      </Sheet>
    );
  const save = async (outcome: 'reviewed' | 'none') => {
    try {
      const ok = await change((s) =>
        saveRuleReview(
          s,
          {
            id: existing?.id,
            date,
            routineId: book.routineId,
            outcome,
            answers: Object.entries(answers).map(([checkpointId, answer]) => ({
              checkpointId,
              answer,
            })),
            violations,
            note,
            occurrence: { date, blockId: block.id },
          },
          id,
          new Date().toISOString(),
        ),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the review.');
    }
  };
  const recent = adherence(state, book.routineId, shiftDate(date, -29), date);
  const missingAnswers = book.checkpoints.filter((c) => !answers[c.id]).length;
  return (
    <Sheet title={block.title} visible close={close}>
      <Text style={styles.label}>{displayDate(date)}</Text>
      <Text style={styles.muted}>
        Answer honestly. Not applicable is never a failure, and a day without the activity is fine.
      </Text>
      <Button
        secondary
        title="No activity today"
        label="Record a day without the activity"
        onPress={() => void save('none')}
      />
      <SectionLabel
        title="Checkpoints"
        count={`${book.checkpoints.length - missingAnswers}/${book.checkpoints.length}`}
      />
      {book.checkpoints.map((c, i) => (
        <View key={c.id} style={{ gap: 6 }}>
          <Text style={styles.body}>
            {i + 1}. {c.text}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={c.text} style={styles.row}>
            {ANSWERS.map(([value, title]) => (
              <Chip
                key={value}
                role="radio"
                title={title}
                on={answers[c.id] === value}
                onPress={() => setAnswers({ ...answers, [c.id]: value })}
              />
            ))}
          </View>
        </View>
      ))}
      {book.rules.length > 0 && (
        <Button
          secondary
          small
          title={
            showRules
              ? 'Hide the full rules'
              : `Full rules${violations.length ? ` · ${violations.length} broken` : ''} · mark any broken`
          }
          onPress={() => setShowRules(!showRules)}
        />
      )}
      {showRules &&
        book.rules.map((r) => (
          <View key={r.id} style={{ gap: 4 }}>
            <Chip
              role="checkbox"
              title={`${r.id.replace('rule-', '')}. ${r.title}`}
              on={violations.includes(r.id)}
              onPress={() =>
                setViolations(
                  violations.includes(r.id)
                    ? violations.filter((v) => v !== r.id)
                    : [...violations, r.id],
                )
              }
            />
            {r.details ? <Text style={styles.muted}>{r.details}</Text> : null}
          </View>
        ))}
      <Field label="Note (optional)" value={note} onChange={setNote} multiline />
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button
        title="Save review"
        disabled={missingAnswers > 0}
        needs={`Answer ${missingAnswers === 1 ? 'the remaining checkpoint' : `the ${missingAnswers} open checkpoints`} to save.`}
        onPress={() => void save('reviewed')}
      />
      <Text style={{ ...type.meta, color: palette.label2 }}>
        Last 30 days: {recent.reviewed} reviewed · {recent.compliantDays} fully followed ·{' '}
        {recent.daysWithout} without the activity
        {recent.percent !== null ? ` · ${recent.percent}% of applicable checkpoints kept` : ''}
      </Text>
    </Sheet>
  );
}
