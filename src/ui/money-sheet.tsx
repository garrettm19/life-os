import { useState } from 'react';
import { Text, View } from 'react-native';
import { withDay } from '../domain/data';
import { Block, MoneyReview, displayDate, localDate } from '../domain/model';
import {
  MEASURED,
  MONEY_LABELS,
  MoneyTotal,
  amountText,
  changeTone,
  deleteMoneyReview,
  formatMoney,
  lastReported,
  parseAmount,
  previousReview,
  saveMoneyReview,
} from '../domain/money';
import { setStatus } from '../domain/planner';
import { useApp } from '../state/app-state';
import { Button, Chip, Field, Sheet, styles } from './components';
import { Disclosure, LinkButton } from './controls';
import { newId } from './ids';
import { palette, type } from './theme';

export type MoneyTarget = {
  occurrence?: { date: string; block: Block };
  review?: MoneyReview;
};

const CURRENCY = 'USD';

/**
 * The weekly money review: cash, total savings and total debt (blank means not reported), each
 * against the review that last reported it, and one optional priority for the coming week. Saving
 * from the objective marks it Done. Fields an older review may hold (upcoming expenses, amount
 * saved, a savings target) are kept as they were and never asked for.
 */
export function MoneySheet({ target, close }: { target: MoneyTarget | null; close: () => void }) {
  return target ? (
    <MoneyForm
      key={target.review?.id ?? target.occurrence?.block.id ?? 'new'}
      target={target}
      close={close}
    />
  ) : null;
}

type Texts = Record<MoneyTotal, string>;

function signed(cents: number): string {
  return `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${formatMoney(Math.abs(cents), CURRENCY)}`;
}

function MoneyForm({ target, close }: { target: MoneyTarget; close: () => void }) {
  const { state, change } = useApp();
  const date = target.review?.date ?? target.occurrence?.date ?? localDate();
  const existing =
    target.review ??
    state.moneyReviews.find(
      (r) => r.occurrenceId && r.occurrenceId === target.occurrence?.block.id,
    );
  const previous = previousReview(state, date, existing?.id);
  const [texts, setTexts] = useState<Texts>({
    cash: amountText(existing?.cash ?? null),
    savings: amountText(existing?.savings ?? null),
    debt: amountText(existing?.debt ?? null),
  });
  // Where this review sits in time, for "since" comparisons; a new review comes after every other.
  const point = existing ?? { date, at: '9999-12-31T23:59:59.999Z' };
  const [nextAction, setNextAction] = useState(existing?.nextAction ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [goalId, setGoalId] = useState(existing?.goalId ?? previous?.goalId ?? null);
  const [error, setError] = useState<string | null>(null);
  // One ID per open form: a repeated Save corrects the same review instead of adding another.
  const [id] = useState(() => existing?.id ?? newId('money'));
  const set = (field: keyof Texts, value: string) => {
    setTexts((t) => ({ ...t, [field]: value }));
    setError(null);
  };
  const parsed = (field: keyof Texts): number | null => {
    try {
      return parseAmount(texts[field]);
    } catch {
      return null;
    }
  };
  const save = async () => {
    try {
      const amounts = {
        cash: parseAmount(texts.cash),
        savings: parseAmount(texts.savings),
        debt: parseAmount(texts.debt),
        // Kept exactly as an older review recorded them; never asked for again.
        upcoming: existing?.upcoming ?? null,
        contributed: existing?.contributed ?? null,
        savingsTarget: existing?.savingsTarget ?? null,
      };
      const now = new Date().toISOString();
      const occurrence = target.occurrence
        ? { date: target.occurrence.date, blockId: target.occurrence.block.id }
        : undefined;
      const ok = await change((s) =>
        saveMoneyReview(
          s,
          {
            ...amounts,
            id: s.moneyReviews.some((r) => r.id === id) ? id : undefined,
            date,
            // A correction keeps the review's own currency.
            currency: existing?.currency ?? CURRENCY,
            nextAction,
            note,
            goalId,
            occurrence,
          },
          id,
          now,
        ),
      );
      if (ok) close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the amounts.');
    }
  };
  const planned = target.occurrence?.block.status === 'planned';
  // Goals linked to a program with a money review, and the one already chosen.
  const [allGoals, setAllGoals] = useState(false);
  const linked = new Set(
    state.programs
      .filter((p) => p.routines.some((r) => r.capture === 'money'))
      .flatMap((p) => p.goalIds),
  );
  const shownGoals =
    allGoals || !linked.size
      ? state.goals
      : state.goals.filter((g) => linked.has(g.id) || g.id === goalId);
  return (
    <Sheet title="Money review" visible close={close}>
      <Text style={styles.label}>
        {displayDate(date)}
        {previous ? ' · Each figure vs. its last report' : ' · First review'}
      </Text>
      {MEASURED.map((field) => {
        const last = lastReported(state, field, CURRENCY, point, existing?.id);
        const before = last?.value ?? null;
        const now = parsed(field);
        const delta = now !== null && before !== null ? now - before : null;
        return (
          <Field
            key={field}
            label={`${MONEY_LABELS[field]} ($)`}
            value={texts[field]}
            onChange={(v) => set(field, v)}
            placeholder="Not reported"
            decimal
            hint={
              before !== null ? (
                <View style={[styles.spread, { minHeight: 44 }]}>
                  <Text
                    style={{
                      ...type.meta,
                      flexShrink: 1,
                      color:
                        changeTone(field, delta) === 'good'
                          ? palette.done
                          : changeTone(field, delta) === 'watch'
                            ? palette.accent
                            : palette.label3,
                    }}>
                    {displayDate(last!.date)}: {formatMoney(before!, CURRENCY)}
                    {delta !== null ? `  ·  ${signed(delta)} since then` : ''}
                  </Text>
                  {texts[field] === '' && (
                    // An action, so it reads as one: sentence case with its 44 pt target in layout.
                    <LinkButton
                      title={`Use ${formatMoney(before!, CURRENCY)}`}
                      label={`Use last ${MONEY_LABELS[field]}, ${formatMoney(before!, CURRENCY)}`}
                      onPress={() => set(field, amountText(before))}
                    />
                  )}
                </View>
              ) : null
            }
          />
        );
      })}
      <Field
        label="This week's priority (optional)"
        value={nextAction}
        onChange={setNextAction}
        placeholder="One concrete step you choose"
        name
        hint={
          <Text style={{ ...type.muted, color: palette.label3 }}>
            One step in your own words. It shows on Today this week, where you can mark it done.
          </Text>
        }
      />
      {existing &&
        (existing.upcoming !== null ||
          existing.contributed !== null ||
          existing.savingsTarget !== null) && (
          <Text style={{ ...type.muted, color: palette.label3 }}>
            This older review also recorded{' '}
            {[
              existing.upcoming !== null
                ? `upcoming expenses ${formatMoney(existing.upcoming, existing.currency)}`
                : null,
              existing.contributed !== null
                ? `saved ${formatMoney(existing.contributed, existing.currency)}`
                : null,
              existing.savingsTarget !== null
                ? `a savings target of ${formatMoney(existing.savingsTarget, existing.currency)}`
                : null,
            ]
              .filter(Boolean)
              .join(', ')}
            . Those stay as they were.
          </Text>
        )}
      {/* The goal and note are optional and folded, so Save stays close to the figures. The goals
          the money program serves come first; the rest wait behind one more tap. The summary only
          says a goal is chosen: a goal's title beside the row's would wrap it at phone widths. */}
      <Disclosure
        title="Goal and note (optional)"
        summary={state.goals.some((g) => g.id === goalId) ? 'Goal set' : undefined}
        initiallyOpen={!!existing?.note}>
        {state.goals.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Goal</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Goal" style={styles.row}>
              {shownGoals.map((g) => (
                <Chip
                  key={g.id}
                  role="radio"
                  title={g.title}
                  on={goalId === g.id}
                  onPress={() => setGoalId(goalId === g.id ? null : g.id)}
                />
              ))}
            </View>
            {shownGoals.length < state.goals.length && (
              <LinkButton title="Link to another goal" onPress={() => setAllGoals(true)} />
            )}
          </View>
        )}
        <Field label="Note (optional)" value={note} onChange={setNote} multiline />
      </Disclosure>
      {error && (
        <Text accessibilityRole="alert" style={styles.alert}>
          {error}
        </Text>
      )}
      <Button title={existing ? 'Save correction' : 'Save review'} onPress={() => void save()} />
      {planned && (
        <Button
          secondary
          title="Done without a review"
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
        <Button
          secondary
          title="Delete this review"
          onPress={() =>
            void change((s) => deleteMoneyReview(s, existing.id)).then((ok) => ok && close())
          }
        />
      )}
      <Text style={{ ...type.muted, color: palette.label3 }}>
        Blank means not reported, not zero. These totals cover only what you enter here, so they are
        not a full net worth. Private: never on the widget, never sent anywhere.
      </Text>
    </Sheet>
  );
}
