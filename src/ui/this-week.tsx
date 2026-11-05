import { memo, useState } from 'react';
import { Text, View } from 'react-native';
import { calendarDays, displayDate, localDate } from '../domain/model';
import { withDay } from '../domain/data';
import { careerProgress } from '../domain/career';
import { currentPriority, formatMoney, sortedReviews } from '../domain/money';
import { editBlock, findSlot, generateDay, makeBlock, unconfirmedFixed } from '../domain/planner';
import { planKeep } from '../domain/rotation';
import { useApp } from '../state/app-state';
import { CareerProgress } from './career-progress';
import { Button, SectionLabel, styles } from './components';
import { Disclosure } from './controls';
import { CourseCorrection } from './course-correction';
import { PriorityLine } from './money-priority';
import { MoneySheet, MoneyTarget } from './money-sheet';
import { PressableScale } from './motion';
import { LATEST, RecentLog, WeighIns } from './progress';
import { SkillCheckpoints } from './skill-checkpoints';
import { type } from './theme';
import { RulesProgress, rulesInWindow } from './trackers-progress';
import { WeeklyReview } from './weekly-review';
import { WeightSheet, WeightTarget } from './weight-sheet';

// Under the Progress charts and How far you've come: the last seven days (the same days the course
// correction reads, so it is titled for them, never "This week", which is Week's Monday-to-Sunday)
// and the ways to record what the charts read (a weigh-in, a money check-in, a skill checkpoint),
// then everything else Review held, folded: the study calendar and career strips, the history
// lists and the suggested extra tasks. Nothing here repeats a chart above it.

const proposals = [
  {
    programs: ['career-pipeline', 'study', 'interview-study', 'career-weekly'],
    title: 'Review one target role',
    minutes: 30,
    why: 'Clarify fit before spending time on an application.',
  },
  {
    programs: ['money'],
    title: 'Update your money overview',
    minutes: 20,
    why: 'Give your next money decision a current baseline.',
  },
  {
    programs: ['move'],
    title: 'Compare one housing option',
    minutes: 30,
    why: 'Turn a broad move goal into a concrete option.',
  },
  {
    programs: ['nutrition'],
    title: 'Plan your next meals',
    minutes: 20,
    why: 'Reduce friction around an existing training goal.',
  },
  {
    programs: ['life-admin'],
    title: 'Clear one admin task',
    minutes: 20,
    why: 'Keep weekly admin from becoming a pile.',
  },
];

function matchProgram(ids: string[], programs: { id: string }[]) {
  return ids.find((id) => programs.some((program) => program.id === id));
}

const BALANCES = [
  ['debt', 'Debt'],
  ['savings', 'Savings'],
  ['cash', 'Cash'],
] as const;

/** Every money check-in, newest first, each one tap from its editor. */
function MoneyCheckIns({ edit }: { edit: (target: MoneyTarget) => void }) {
  const { state } = useApp();
  return (
    <>
      {[...sortedReviews(state)].reverse().map((r) => (
        <PressableScale
          key={r.id}
          accessibilityRole="button"
          accessibilityLabel={`Edit money check-in for ${displayDate(r.date)}`}
          onPress={() => edit({ review: r })}
          style={{ minHeight: 44, justifyContent: 'center', gap: 2 }}>
          <Text style={type.item}>{displayDate(r.date)}</Text>
          <Text style={type.caption}>
            {BALANCES.map(([f, label]) =>
              r[f] !== null ? `${label} ${formatMoney(r[f]!, r.currency)}` : null,
            )
              .filter(Boolean)
              .join(' · ') || 'No balances'}
          </Text>
        </PressableScale>
      ))}
    </>
  );
}

/**
 * Memoized: it reads only the saved state and `today`, so changing the range above re-renders the
 * charts and never this.
 */
export const ThisWeek = memo(function ThisWeek({ today }: { today: string }) {
  const { state, change } = useApp();
  const [weight, setWeight] = useState<WeightTarget | null>(null);
  const [money, setMoney] = useState<MoneyTarget | null>(null);
  const candidates = proposals
    .map((proposal) => {
      const program = matchProgram(proposal.programs, state.programs);
      return program ? { ...proposal, program } : null;
    })
    .filter((proposal): proposal is NonNullable<typeof proposal> => proposal !== null);
  const add = (proposal: (typeof candidates)[number]) =>
    void change((s) => {
      const date = localDate(),
        day = generateDay(date, s.settings, s.programs, s.days[date], undefined, planKeep(s, date));
      if (day.blocks.some(unconfirmedFixed))
        throw new Error('Confirm meeting lengths before placing an extra task.');
      const id = `${date}:proposal:${proposal.program}`;
      if (day.blocks.some((b) => b.id === id))
        throw new Error('This proposal is already in today’s plan.');
      const now = new Date(),
        from = Math.max(s.settings.wake, now.getHours() * 60 + now.getMinutes());
      const start = findSlot(day.blocks, proposal.minutes, from, s.settings.bedtime);
      const block = makeBlock(id, proposal.title, start, proposal.minutes);
      block.programId = proposal.program;
      // A suggestion is extra: it never counts toward Day Cleared, so adding one cannot undo a clear.
      block.optional = true;
      block.reason =
        start === null ? 'No available slot before bedtime. Choose another time.' : null;
      return withDay(s, editBlock(day, block, s.settings));
    });
  const reviews = sortedReviews(state);
  const hasMoney =
    reviews.length > 0 || state.programs.some((p) => p.routines.some((r) => r.capture === 'money'));
  const priority = currentPriority(state, today);
  const weighIns = state.measurements.filter((m) => m.kind === 'body-weight').length;
  const rules = rulesInWindow(state, today).length > 0;
  // Whole Monday-to-Sunday weeks, so the days match Week.
  const career = careerProgress(state, today, calendarDays(today)).length > 0;
  const details =
    career ||
    state.measurements.length > 0 ||
    reviews.length > 0 ||
    rules ||
    state.lifeLog.length > 0 ||
    candidates.length > 0;
  return (
    <View testID="this-week" style={{ gap: 16 }}>
      <View style={[styles.section, { marginTop: 14 }]}>
        <Text accessibilityRole="header" style={type.cardTitle}>
          Last 7 days
        </Text>
      </View>
      <WeeklyReview />
      <CourseCorrection />
      <View style={styles.section}>
        <SectionLabel title="Record" />
        <View style={styles.card}>
          {priority && (
            <View style={{ gap: 8 }}>
              <Text style={type.caption}>This week&apos;s money priority</Text>
              <PriorityLine review={priority} />
            </View>
          )}
          <View style={styles.row}>
            <Button secondary small title="Add weigh-in" onPress={() => setWeight({})} />
            {hasMoney && (
              <Button secondary small title="Add money check-in" onPress={() => setMoney({})} />
            )}
          </View>
          <Text style={type.caption}>What you record here starts or extends the charts above.</Text>
        </View>
      </View>
      <SkillCheckpoints />
      {details && (
        <View style={styles.section}>
          <SectionLabel title="History and details" />
          {career && (
            <Disclosure title="Study calendar and career" summary="last 4 weeks">
              <CareerProgress bare />
            </Disclosure>
          )}
          {weighIns > 0 && (
            <Disclosure
              title="Weigh-ins"
              summary={weighIns > LATEST ? `last ${LATEST}` : String(weighIns)}>
              <WeighIns />
            </Disclosure>
          )}
          {reviews.length > 0 && (
            <Disclosure title="Money check-ins" summary={String(reviews.length)}>
              <MoneyCheckIns edit={setMoney} />
            </Disclosure>
          )}
          {rules && (
            <Disclosure title="Rules">
              <RulesProgress />
            </Disclosure>
          )}
          {state.lifeLog.length > 0 && (
            <Disclosure title="Life log" summary={String(state.lifeLog.length)}>
              <RecentLog />
            </Disclosure>
          )}
          {candidates.length > 0 && (
            <Disclosure title="Suggested extra tasks" summary={String(candidates.length)}>
              <Text style={styles.muted}>
                Optional proposals tied to your programs. Adding one places it on today&apos;s plan;
                durations are estimates you can edit.
              </Text>
              {candidates.map((p) => (
                <View key={p.program} style={{ gap: 6 }}>
                  <Text style={type.item}>{p.title}</Text>
                  <Text style={styles.muted}>
                    {p.why} {p.minutes} min ·{' '}
                    {state.programs.find((x) => x.id === p.program)?.title}
                  </Text>
                  <View style={styles.row}>
                    <Button small secondary title={`Add ${p.title}`} onPress={() => add(p)} />
                  </View>
                </View>
              ))}
            </Disclosure>
          )}
        </View>
      )}
      <WeightSheet target={weight} close={() => setWeight(null)} />
      <MoneySheet target={money} close={() => setMoney(null)} />
    </View>
  );
});
