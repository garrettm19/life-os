import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { RuleBook, StrategyStep, TradingStrategy } from '../domain/model';
import { tradingBook } from '../domain/trading';
import { SETUPS } from '../domain/trading-rules';
import {
  CISD_CHOICES,
  CISD_RULE,
  RETAKE_RULE_MISSING,
  saveStrategy,
  strategyOf,
} from '../domain/trading-strategy';
import { useApp } from '../state/app-state';
import { Button, Field, Page, PageFooter, SectionLabel, styles } from '../ui/components';
import { LinkButton } from '../ui/controls';
import { depth, fonts, market, palette, radius, type } from '../ui/theme';

// My Trading Strategy: the permanent reference, one tap from the cockpit and from Programs. The
// steps as short cards, each opening to its full wording; My Key, the trader's own notes; and
// the setups with Setup B's retake rule and the CISD rule. Everything here is wording, editable in
// place: what the cockpit allows comes from the plan, the setup chips and the limits, never from
// this text, except whether Setup B's retake rule is written.

export default function StrategyScreen() {
  const { state } = useApp();
  const book = tradingBook(state);
  if (!book)
    return (
      <Page title="Strategy" back="/trading">
        <Text style={styles.muted}>Set up Trading discipline first, on the Trading page.</Text>
        <LinkButton title="Open Trading" onPress={() => router.replace('/trading')} />
      </Page>
    );
  return <Strategy book={book} />;
}

function Strategy({ book }: { book: RuleBook }) {
  const strategy = strategyOf(book.trading!);
  const [editing, setEditing] = useState(false);
  return editing ? (
    <StrategyForm book={book} strategy={strategy} done={() => setEditing(false)} />
  ) : (
    <Page
      title="Strategy"
      back="/trading"
      top={<Text style={styles.label}>My trading strategy</Text>}>
      <Text style={type.caption}>
        Wording only: the cockpit acts on your plan, the setup chips and your limits, never on this
        text. Only whether Setup B&apos;s retake rule is written counts.
      </Text>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          secondary
          small
          title="Edit"
          label="Edit my trading strategy"
          onPress={() => setEditing(true)}
        />
      </View>
      <View testID="strategy-steps" style={{ gap: 8 }}>
        {strategy.steps.map((step, i) => (
          <StepCard key={i} n={i + 1} step={step} />
        ))}
      </View>
      <View style={styles.section}>
        <SectionLabel title="My key" />
        <Text testID="my-key" style={strategy.key ? type.body : type.muted}>
          {strategy.key || 'Not written yet: your own notes on reading the HTF candles.'}
        </Text>
      </View>
      <View style={styles.section}>
        <SectionLabel title="Setups · 5m / 15m" />
        {SETUPS.map((s) => (
          <View key={s.id} style={{ gap: 2 }}>
            <Text style={{ ...type.item, ...fonts.semibold }}>
              {s.letter} · {s.name}
            </Text>
            <Text style={type.caption}>{s.long}</Text>
            {s.note && <Text style={type.caption}>{s.note.long}</Text>}
            {s.id === 'sweep-retake' && (
              <Text
                testID="retake-rule"
                style={{
                  ...type.caption,
                  ...fonts.semibold,
                  color: strategy.retakeRule ? palette.label : market.amber,
                }}>
                {strategy.retakeRule ? `Retake rule: ${strategy.retakeRule}` : RETAKE_RULE_MISSING}
              </Text>
            )}
          </View>
        ))}
        <Text style={{ ...type.item, ...fonts.semibold }}>The CISD rule</Text>
        <Text style={type.caption}>{CISD_RULE}</Text>
        <Text style={type.caption}>
          {CISD_CHOICES.map((c) =>
            c.enough ? c.label : `${c.label.split(' —')[0]} (not enough)`,
          ).join(' · ')}
        </Text>
      </View>
    </Page>
  );
}

/**
 * One step: its title and summary, opening to the full wording. The wording sits outside the
 * button, so VoiceOver reads it on its own once open.
 */
function StepCard({ n, step }: { n: number; step: StrategyStep }) {
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        borderRadius: radius.tile,
        backgroundColor: palette.surface,
        ...depth.card,
      }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${n}. ${step.title}. ${step.summary}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: 'row', gap: 12, minHeight: 44, padding: 14 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.capsule,
            backgroundColor: palette.fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ ...fonts.figure, fontSize: 15, lineHeight: 18, color: palette.label2 }}>
            {n}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.item, ...fonts.semibold }}>{step.title}</Text>
          <Text style={type.caption}>{step.summary}</Text>
        </View>
        <Text
          aria-hidden
          style={{ ...fonts.semibold, fontSize: 17, lineHeight: 28, color: palette.label3 }}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open && !!step.detail && (
        <Text style={{ ...type.small, paddingLeft: 54, paddingRight: 16, paddingBottom: 14 }}>
          {step.detail}
        </Text>
      )}
    </View>
  );
}

/** Every card, My Key and the retake rule in place, saved together. */
function StrategyForm({
  book,
  strategy,
  done,
}: {
  book: RuleBook;
  strategy: TradingStrategy;
  done: () => void;
}) {
  const { change } = useApp();
  const [steps, setSteps] = useState(strategy.steps.map((s) => ({ ...s })));
  const [key, setKey] = useState(strategy.key);
  const [retake, setRetake] = useState(strategy.retakeRule ?? '');
  const edit = (i: number, patch: Partial<StrategyStep>) =>
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const save = () =>
    void change((s) =>
      saveStrategy(s, book.routineId, { steps, key, retakeRule: retake }, new Date().toISOString()),
    ).then((ok) => ok && done());
  return (
    <Page
      title="Strategy"
      back="/trading"
      keyboardInsets
      top={<Text style={styles.label}>Editing · nothing changes until saved</Text>}
      footer={
        <PageFooter>
          <Button title="Save strategy" onPress={save} />
          <LinkButton title="Cancel" onPress={done} />
        </PageFooter>
      }>
      <Field
        label="Setup B · retake rule"
        value={retake}
        onChange={setRetake}
        wrap
        name
        maxLength={300}
        hint="Until it is written, Setup B cannot complete."
      />
      <Field label="My key" value={key} onChange={setKey} multiline name maxLength={8000} />
      {steps.map((step, i) => (
        <View
          key={i}
          style={{ gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: palette.separator }}>
          <Field
            label={`Step ${i + 1} · title`}
            value={step.title}
            onChange={(v) => edit(i, { title: v })}
            name
            maxLength={120}
          />
          <Field
            label={`Step ${i + 1} · summary`}
            value={step.summary}
            onChange={(v) => edit(i, { summary: v })}
            wrap
            name
            maxLength={300}
          />
          <Field
            label={`Step ${i + 1} · in full`}
            value={step.detail}
            onChange={(v) => edit(i, { detail: v })}
            multiline
            name
            maxLength={4000}
          />
        </View>
      ))}
    </Page>
  );
}
