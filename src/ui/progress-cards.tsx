import { useMemo, useState } from 'react';
import { Platform, Text, View, ViewStyle } from 'react-native';
import { localDate, shiftDate } from '../domain/model';
import { formatMoney, sortedReviews } from '../domain/money';
import {
  CardioCard as CardioData,
  ConsistencyCard as ConsistencyData,
  HabitsCard as HabitsData,
  JobsCard as JobsData,
  MoneyCard as MoneyData,
  MonthLine,
  MorningsCard as MorningsData,
  RangeWindow,
  StrengthCard as StrengthData,
  StudyCard as StudyData,
  TradingCard as TradingData,
  WeekPoint,
  WeightCard as WeightData,
  cardioCard,
  dateText,
  dayText,
  morningWords,
} from '../domain/progress';
import { MorningMark } from '../domain/anchor';
import { tradingBook } from '../domain/trading';
import { setsText, unfinishedSessions } from '../domain/workouts';
import { useApp } from '../state/app-state';
import { BarChart } from './bar-chart';
import { ChartCard, ChartEntry, Key, Keys } from './chart-card';
import { fromFirstRecord, stepIndex } from './chart-scale';
import { Chip, LinkButton, styles } from './components';
import { HabitBars } from './habit-bars';
import { LineChart } from './line-chart';
import { CellLook, DayGrid } from './study-calendar';
import { MomentIcon } from './settings-icon';
import { fonts, palette, radius, type, useWash } from './theme';
import { TradingReviewLink } from './trading-card';

// The Progress tab's chart cards, in order: mornings (with a morning anchor), consistency, body
// weight, strength, study, cardio, career, money, trading and habits. Every figure comes
// from `src/domain/progress.ts`, which reads each with the rule that defines it; these components
// only draw and word them. One series per chart in the chart color (two on one dollar scale for
// money), Fern only for a week that hit its target or a clean session, Ember only for a target,
// danger only for a rule-broken session.

/** A choice of lift or activity: chips that wrap, never a row cut at the card's edge. */
const CHIPS: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 };
/** Lifts shown before All lifts opens the rest. */
const LIFTS_SHOWN = 4;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Week of Sep 28" ("Week of Oct 20, 2025" in another year), or "This week so far". */
function weekLabel(w: WeekPoint): string {
  return w.inProgress ? 'This week so far' : `Week of ${dateText(w.weekStart, localDate())}`;
}

/** "Wed, Oct 7", with the year for a date in another year. */
const dayLabel = (date: string) => dayText(date, localDate());

/** Compact axis label for an amount in cents: $950, $4.8k, $12k. */
export function moneyTick(cents: number, currency: string): string {
  const units = cents / 100;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  if (Math.abs(units) >= 10_000) return `${symbol}${Math.round(units / 1000)}k`;
  if (Math.abs(units) >= 1000) return `${symbol}${(units / 1000).toFixed(1)}k`;
  return `${symbol}${Math.round(units)}`;
}

/** The percentage axis: labeled lines at 0, 50 and 100%. */
const PERCENT = { lo: 0, hi: 100, ticks: [0, 50, 100] };

export function ConsistencyCard({ card }: { card: ConsistencyData }) {
  const weeks = card.weeks.filter((w) => w.value !== null);
  const entries: ChartEntry[] = weeks.map((w) => ({
    key: w.weekStart,
    value: `${w.value}%`,
    label: weekLabel(w),
    detail: [`${w.done} of ${plural(w.total, 'required objective')} done`],
  }));
  return (
    <ChartCard
      testID="card-consistency"
      title="Consistency"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      plot={(selected, onSelect, access, reading) => (
        <LineChart
          lines={[
            {
              points: weeks.map((w) => ({ date: w.weekStart, y: w.value! })),
              color: palette.chart,
            },
          ]}
          dates={weeks.map((w) => w.weekStart)}
          // Neighboring weeks join; a week with nothing due breaks the line.
          maxGapDays={7}
          weekly
          domain={PERCENT}
          format={(y) => `${y}%`}
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      caption="Required objectives done each week, from each day's plan. Optional ones never count."
    />
  );
}

export function WeightCard({ card }: { card: WeightData }) {
  const average = new Map(card.average.map((p) => [p.date, p.y]));
  const entries: ChartEntry[] = card.points.map((p) => ({
    key: p.date,
    value: `${p.y} ${card.unit}`,
    label: dayLabel(p.date),
    detail: average.has(p.date)
      ? [`Seven-day average ${average.get(p.date)} ${card.unit}`]
      : undefined,
  }));
  return (
    <ChartCard
      testID="card-weight"
      title="Body weight"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      plot={(selected, onSelect, access, reading) => (
        <LineChart
          lines={[{ points: card.points, color: palette.chart }]}
          dates={card.points.map((p) => p.date)}
          maxGapDays={10}
          minSpan={2}
          format={(y) => y.toFixed(1)}
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      caption="Weigh-ins as recorded. Single weigh-ins vary day to day; read the direction over weeks."
    />
  );
}

export function StrengthCard({ card }: { card: StrengthData }) {
  const { state } = useApp();
  const [key, setKey] = useState<string | null>(null);
  const lift = card.lifts.find((l) => l.key === key) ?? card.lifts[0];
  // Logged sets never finished are not in the chart, so the card says how many there are.
  const unfinished = unfinishedSessions(state, localDate()).length;
  // A lift's unit only tells the chips apart when the lifts use more than one.
  const units = new Set(card.lifts.map((l) => l.unit)).size > 1;
  // A long list of lifts shows the first few (and the chosen one) until it is opened, so the card
  // stays short; none is ever cut at the edge.
  const [allLifts, setAllLifts] = useState(false);
  const folds = card.lifts.length > LIFTS_SHOWN + 1;
  const shownLifts =
    !folds || allLifts
      ? card.lifts
      : card.lifts.filter((l, i) => i < LIFTS_SHOWN || l.key === lift?.key);
  const sessions = lift
    ? lift.measure === 'load'
      ? lift.sessions.filter((s) => s.load !== null)
      : lift.sessions
    : [];
  const entries: ChartEntry[] = sessions.map((s, i) => ({
    key: `${s.date}-${i}`,
    value: s.load === null ? plural(s.reps, 'rep') : `${s.load} ${lift!.unit} × ${s.reps}`,
    label: dayLabel(s.date),
    detail: [`All working sets: ${setsText(s.sets, lift!.unit)}`],
  }));
  return (
    <ChartCard
      testID="card-strength"
      title="Strength"
      headline={lift?.headline ?? card.headline}
      summary={lift?.summary ?? card.summary}
      state={lift?.state ?? card.state}
      note={lift?.note ?? card.note}
      entries={entries}
      controls={
        card.lifts.length > 1 && (
          // The lifts wrap onto as many lines as they need, so none is cut at the card's edge; one
          // lift's line at a time.
          <View style={{ gap: 4 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel="Lift" style={CHIPS}>
              {shownLifts.map((l) => (
                <Chip
                  key={l.key}
                  role="radio"
                  title={units ? `${l.name} · ${l.unit}` : l.name}
                  on={l.key === lift!.key}
                  onPress={() => setKey(l.key)}
                />
              ))}
            </View>
            {folds && (
              <View style={styles.row}>
                <LinkButton
                  tone="dim"
                  title={allLifts ? 'Fewer lifts' : `All ${card.lifts.length} lifts`}
                  expanded={allLifts}
                  onPress={() => setAllLifts(!allLifts)}
                />
              </View>
            )}
          </View>
        )
      }
      plot={(selected, onSelect, access, reading) =>
        lift && (
          <LineChart
            lines={[{ points: lift.points, color: palette.chart }]}
            dates={lift.points.map((p) => p.date)}
            maxGapDays={35}
            minSpan={lift.measure === 'load' ? 10 : 4}
            format={(y) => `${Math.round(y * 10) / 10}`}
            selected={selected}
            onSelect={onSelect}
            access={access}
            reading={reading}
          />
        )
      }
      caption={
        lift &&
        (lift.measure === 'load'
          ? `Heaviest working set of each finished workout, in ${lift.unit}.`
          : 'Most reps in a working set of each finished workout.')
      }
      footer={
        <>
          {unfinished > 0 && (
            <Text testID="unfinished-workouts" style={{ ...type.callout, color: palette.accent }}>
              {unfinished === 1
                ? '1 workout log with saved sets was never finished, so it does not count as a finished workout. Open its day on Today to finish it.'
                : `${unfinished} workout logs with saved sets were never finished, so they do not count as finished workouts. Open their days on Today to finish them.`}
            </Text>
          )}
        </>
      }
    />
  );
}

export function StudyCard({ card }: { card: StudyData }) {
  const weeks = fromFirstRecord(card.weeks);
  const entries: ChartEntry[] = weeks.map((w) => ({
    key: w.weekStart,
    value: w.value === null ? 'No study day scored' : plural(w.kept, 'study day'),
    label: weekLabel(w),
    gap: w.value === null,
    detail:
      w.value === null
        ? undefined
        : [
            `${w.kept} of ${plural(w.eligible, 'scored day')} kept`,
            ...(w.minutes ? [`${w.minutes} min timed`] : []),
          ],
  }));
  return (
    <ChartCard
      testID="card-study"
      title="Study"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      plot={(selected, onSelect, access, reading) => (
        <BarChart
          weeks={weeks}
          target={null}
          whole
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      caption="Study days kept each week, by the study streak's rules: a scheduled day never opened counts as missed."
    />
  );
}

export function CardioCard({ card, window }: { card: CardioData; window: RangeWindow }) {
  const { state } = useApp();
  const routines = state.programs
    .flatMap((p) => p.routines)
    .filter((r) => r.capture === 'activity');
  const [routineId, setRoutineId] = useState<string | null>(null);
  const option = routines.some((r) => r.id === routineId) ? routineId : null;
  // One activity's own sessions and target; every activity is the tab's card as computed.
  const shown = useMemo(
    () => (option === null ? card : cardioCard(state, window, option)),
    [card, state, window, option],
  );
  const weeks = fromFirstRecord(shown.weeks);
  const entries: ChartEntry[] = weeks.map((w) => ({
    key: w.weekStart,
    value: w.value === null ? 'No cardio' : `${w.minutes} min`,
    label: weekLabel(w),
    gap: w.value === null,
    detail: [
      ...(w.value === null ? [] : [plural(w.sessions, 'session')]),
      ...(w.target === null
        ? []
        : [`Target ${w.target} min${w.hit ? ' · hit' : w.inProgress ? ' · in progress' : ''}`]),
    ],
  }));
  return (
    <ChartCard
      testID="card-cardio"
      title="Cardio"
      headline={shown.headline}
      summary={shown.summary}
      state={shown.state}
      note={shown.note}
      entries={entries}
      controls={
        routines.length > 1 && (
          <View accessibilityRole="radiogroup" accessibilityLabel="Activity" style={CHIPS}>
            {[
              ['all', 'All activities'] as const,
              ...routines.map((r) => [r.id, r.title] as const),
            ].map(([id, title]) => (
              <Chip
                key={id}
                role="radio"
                title={title}
                on={(option ?? 'all') === id}
                onPress={() => setRoutineId(id === 'all' ? null : id)}
              />
            ))}
          </View>
        )
      }
      keys={
        shown.weeks.some((w) => w.target !== null) && (
          // A key only for a color the chart draws.
          <Keys>
            {shown.weeks.some((w) => w.value !== null && w.hit === true) && (
              <Key shape="square" color={palette.done} title="Hit the target" />
            )}
            {shown.weeks.some((w) => w.value !== null && w.hit !== true) && (
              <Key
                shape="square"
                color={palette.chart}
                title={shown.weeks.some((w) => w.hit === true) ? 'Below it' : 'Below the target'}
              />
            )}
            {shown.target !== null && (
              <Key color={palette.accent} title="Weekly target" value={`${shown.target} min`} />
            )}
          </Keys>
        )
      }
      plot={(selected, onSelect, access, reading) => (
        <BarChart
          weeks={weeks.map((w) => ({ ...w, done: w.hit === true }))}
          target={shown.target}
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      caption="Recorded minutes per week. A week without a session has no column; this week is drawn lighter until it ends."
    />
  );
}

export function JobsCard({ card }: { card: JobsData }) {
  const weeks = fromFirstRecord(card.weeks);
  const entries: ChartEntry[] = weeks.map((w) => ({
    key: w.weekStart,
    value: w.value === null ? 'No day recorded' : plural(w.done, 'action'),
    label: weekLabel(w),
    gap: w.value === null,
    // Counted per objective and day, so with two career objectives a day is due twice.
    detail: w.value === null ? undefined : [`Done ${w.done} of ${plural(w.due, 'time')} due`],
  }));
  return (
    <ChartCard
      testID="card-jobs"
      title="Career"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      plot={(selected, onSelect, access, reading) => (
        <BarChart
          weeks={weeks.map((w) => ({ ...w, done: false }))}
          target={null}
          whole
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      caption="Career objectives done each week, of the times one was due on a recorded day."
    />
  );
}

export function MoneyCard({ card }: { card: MoneyData }) {
  const { state } = useApp();
  const today = localDate();
  const latest = sortedReviews(state).at(-1);
  const dates = [...new Set([...card.debt, ...card.savings].map((p) => p.date))].sort();
  const debtOn = new Map(card.debt.map((p) => [p.date, p.y]));
  const savingsOn = new Map(card.savings.map((p) => [p.date, p.y]));
  const money = (cents: number) => formatMoney(cents, card.currency);
  const lines = [
    ...(card.debt.length ? [{ points: card.debt, color: palette.chart, label: 'Debt' }] : []),
    ...(card.savings.length
      ? [{ points: card.savings, color: palette.chartAlt, label: 'Savings' }]
      : []),
  ];
  const entries: ChartEntry[] = dates.map((d) => {
    const debt = debtOn.get(d);
    const savings = savingsOn.get(d);
    return {
      key: d,
      // Debt first: becoming debt-free is the money goal. A blank is not reported, never zero.
      value: [
        card.debt.length ? `Debt ${debt === undefined ? 'not reported' : money(debt)}` : null,
        card.savings.length
          ? `Savings ${savings === undefined ? 'not reported' : money(savings)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      label: dayLabel(d),
    };
  });
  const stale = latest && latest.date < shiftDate(today, -6);
  return (
    <ChartCard
      testID="card-money"
      title="Money"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      keys={
        <Keys>
          {card.debt.length > 0 && (
            <Key color={palette.chart} title="Debt" value={money(card.debt.at(-1)!.y)} />
          )}
          {card.savings.length > 0 && (
            <Key color={palette.chartAlt} title="Savings" value={money(card.savings.at(-1)!.y)} />
          )}
        </Keys>
      }
      plot={(selected, onSelect, access, reading) => (
        <LineChart
          lines={lines}
          dates={dates}
          maxGapDays={21}
          format={(y) => moneyTick(y, card.currency)}
          selected={selected}
          onSelect={onSelect}
          access={access}
          reading={reading}
        />
      )}
      footer={
        <>
          {!!card.latest && (
            <Text testID="money-latest" style={type.caption}>
              {card.latest}
            </Text>
          )}
          {stale && (
            <Text style={{ ...type.caption, color: palette.accent }}>
              {`Not updated this week · last check-in ${dayLabel(latest.date)}`}
            </Text>
          )}
          {!!card.otherCurrency && (
            <Text style={type.caption}>
              {card.otherCurrency} check-in{card.otherCurrency === 1 ? '' : 's'} in another currency{' '}
              {card.otherCurrency === 1 ? 'is' : 'are'} not shown.
            </Text>
          )}
        </>
      }
      caption="Balances you reported, on one scale. A change is not a specific payment; there is no payoff date or advice here."
    />
  );
}

export function TradingCard({ card }: { card: TradingData }) {
  const { state } = useApp();
  const book = tradingBook(state);
  const entries: ChartEntry[] = card.points.map((p) => ({
    key: p.date,
    value: `${p.y} of ${card.total}`,
    label: dayLabel(p.date),
    detail: [
      p.clean ? 'Rule-clean session' : 'Rule-broken session',
      ...(p.violations ? [plural(p.violations, 'hard violation')] : []),
    ],
  }));
  return (
    <ChartCard
      testID="card-trading"
      title="Trading"
      headline={card.headline}
      summary={card.summary}
      state={card.state}
      note={card.note}
      entries={entries}
      keys={
        <Keys>
          <Key shape="dot" color={palette.done} title="Rule-clean" />
          <Key shape="dot" color={palette.danger} title="Rule-broken" />
        </Keys>
      }
      plot={(selected, onSelect, access, reading) => (
        <LineChart
          lines={[{ points: card.points, color: palette.chart }]}
          dates={card.points.map((p) => p.date)}
          maxGapDays={14}
          domain={{ lo: 0, hi: card.total, ticks: [0, card.total / 2, card.total] }}
          format={(y) => `${y}`}
          selected={selected}
          onSelect={onSelect}
          mark={(i) =>
            card.points[i] ? (card.points[i].clean ? palette.done : palette.danger) : null
          }
          access={access}
          reading={reading}
        />
      )}
      caption={`Process score per reviewed session, out of ${card.total}.`}
      footer={
        <>
          {/* Holds with or without a chart: before two reviews it is the only word on them. */}
          {card.missed > 0 && (
            <Text testID="trading-missed" style={type.caption}>
              {`${plural(card.missed, 'trading day')} left without a review, never clean.`}
            </Text>
          )}
          {book && <TradingReviewLink book={book} today={localDate()} />}
        </>
      }
    />
  );
}

export function HabitsCard({ card }: { card: HabitsData }) {
  const [about, setAbout] = useState(false);
  return (
    <View testID="card-habits" style={[styles.card, { gap: 12 }]}>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.meta, color: palette.label2 }}>
        Habits
      </Text>
      <Text
        accessibilityRole="header"
        accessibilityLabel={card.summary}
        style={{ ...type.heading, marginTop: -6 }}>
        {card.headline}
      </Text>
      {card.state === 'empty' ? (
        <Text style={styles.muted}>{card.note}</Text>
      ) : (
        <>
          <HabitBars rows={card.rows} />
          <View style={styles.row}>
            <LinkButton
              tone="dim"
              title={about ? 'Hide note' : 'About this chart'}
              label={`${about ? 'Hide note' : 'About this chart'}: Habits`}
              expanded={about}
              onPress={() => setAbout(!about)}
            />
          </View>
          {about && (
            <Text testID="chart-note" style={type.footnote}>
              Share of each habit&apos;s recorded days done, most first. Optional habits follow in
              gray and never count toward Day Cleared.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

/**
 * Each morning has its own shape as well as its color: a filled disc on time, a ring after the
 * window, a small dot not ticked; a day not recorded stays blank. Nothing is red.
 */
const MORNING_CELL: Record<MorningMark, CellLook> = {
  'on-time': {
    symbol: '',
    color: palette.onDone,
    border: palette.done,
    fill: palette.done,
    mark: 'on-time',
  },
  late: {
    symbol: '',
    color: palette.done,
    border: palette.done,
    fill: 'transparent',
    edge: 2,
    mark: 'late',
  },
  'not-ticked': {
    symbol: '',
    color: palette.label3,
    border: 'transparent',
    fill: 'transparent',
    dot: true,
    mark: 'not-ticked',
  },
  open: {
    symbol: '',
    color: palette.accent,
    border: palette.accent,
    fill: 'transparent',
    edge: 2,
    mark: 'open',
  },
  skipped: { symbol: '', color: palette.placeholder, border: 'transparent', fill: 'transparent' },
  free: { symbol: '', color: palette.placeholder, border: 'transparent', fill: 'transparent' },
  none: { symbol: '', color: palette.placeholder, border: 'transparent', fill: 'transparent' },
  before: { symbol: '', color: palette.placeholder, border: 'transparent', fill: 'transparent' },
};

const MORNING_KEYS: Record<string, 'next' | 'previous' | 'first' | 'last'> = {
  ArrowRight: 'next',
  ArrowUp: 'next',
  ArrowLeft: 'previous',
  ArrowDown: 'previous',
  Home: 'first',
  End: 'last',
};

/** "On time 5 of the last 7" with the count in Fern; any other headline as it is. */
function MorningsHeadline({ text }: { text: string }) {
  const parts = /^On time (\d+) of the last (\d+)$/.exec(text);
  const style = { ...type.sheetTitle, flexShrink: 1 };
  if (!parts)
    return (
      <Text maxFontSizeMultiplier={1.3} style={style}>
        {text}
      </Text>
    );
  return (
    <Text maxFontSizeMultiplier={1.3} style={style}>
      On time <Text style={{ ...fonts.figureHeavy, color: palette.doneText }}>{parts[1]}</Text> of
      the last <Text style={fonts.figureHeavy}>{parts[2]}</Text>
    </Text>
  );
}

/** One side of the month scoreboard: a small label over a large rounded figure. */
function MonthFigure({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <View style={{ gap: 0 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.meta, color: palette.label2 }}>
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={1.6}
        style={{
          ...fonts.figureHeavy,
          fontSize: 34,
          lineHeight: 40,
          color: dim ? palette.label3 : palette.label,
        }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * This month against the same days of last month, as two figures side by side with the change in a
 * pill: Fern for a rise, the quiet fill for the same or a fall, never red and never the size of a
 * fall. With nothing to compare, this month alone.
 */
function MonthScore({ month }: { month: MonthLine }) {
  const up = month.direction === 'up';
  return (
    <View
      testID="mornings-month"
      style={{
        borderRadius: radius.tile,
        backgroundColor: palette.fill,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 14,
        gap: 8,
      }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28, rowGap: 8 }}>
        {month.now > 0 && <MonthFigure label="This month" value={month.now} />}
        {month.before !== null && <MonthFigure label="Last month" value={month.before} dim />}
      </View>
      {(!!month.change || !!month.span) && (
        <View style={[styles.row, { columnGap: 10, rowGap: 4 }]}>
          {!!month.change && (
            <View
              style={{
                borderRadius: radius.capsule,
                paddingHorizontal: 12,
                paddingVertical: 4,
                backgroundColor: up ? palette.doneTint : palette.surface,
              }}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  ...fonts.figure,
                  fontSize: 15,
                  lineHeight: 20,
                  color: up ? palette.doneText : palette.label2,
                }}>
                {month.change}
              </Text>
            </View>
          )}
          {!!month.span && (
            <Text style={{ ...type.caption, color: palette.label2, flexShrink: 1 }}>
              {month.span}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** The calendar's key, drawn with the marks themselves. */
function MorningKey() {
  const item = (look: CellLook, title: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          borderWidth: look.dot ? 0 : (look.edge ?? 1) > 1 ? 1.5 : 0,
          borderColor: look.border,
          backgroundColor: look.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {look.dot && (
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: look.color }} />
        )}
      </View>
      <Text style={{ ...type.caption, color: palette.label2 }}>{title}</Text>
    </View>
  );
  return (
    <View style={[styles.row, { columnGap: 14, rowGap: 4 }]}>
      {item(MORNING_CELL['on-time'], 'On time')}
      {item(MORNING_CELL.late, 'After the window')}
      {item(MORNING_CELL['not-ticked'], 'Not ticked')}
    </View>
  );
}

/**
 * Mornings, first on Progress while a routine is the morning anchor: the rolling count as
 * the headline, this month against the same days of last month as a scoreboard, the usual tick
 * time and five weeks of mornings. The card is one VoiceOver element: its summary, then the
 * selected morning as its value, stepped with a swipe up or down (the arrow keys in the browser).
 * Nothing on it is red, and a morning that was not on time is never counted out loud.
 */
export function MorningsCard({ card }: { card: MorningsData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const days = card.days;
  const index = days.findIndex((d) => d.date === selected);
  const pick = index < 0 ? null : days[index];
  const step = (to: 'next' | 'previous' | 'first' | 'last') =>
    setSelected(days[stepIndex(index < 0 ? null : index, days.length, to)].date);
  const keys =
    Platform.OS === 'web'
      ? {
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            const to = MORNING_KEYS[e.key];
            if (!to) return;
            e.preventDefault();
            step(to);
          },
        }
      : {};
  const readout = pick ? `${dayLabel(pick.date)}: ${morningWords(pick)}` : null;
  const chart = card.state === 'chart';
  const last = days.at(-1)?.date;
  // A soft sunrise in the card's corner: the morning's own color, decoration only.
  const wash = useWash(
    (c) => `radial-gradient(ellipse at 100% 0%, ${c.washWarm} 0%, ${c.surface} 42%)`,
    'surface',
  );
  return (
    <View
      testID="card-mornings"
      accessible
      focusable
      accessibilityRole={chart ? 'adjustable' : undefined}
      accessibilityLabel={card.summary}
      accessibilityValue={chart ? { text: readout ?? 'No morning selected' } : undefined}
      aria-valuetext={chart ? (readout ?? 'No morning selected') : undefined}
      accessibilityHint={chart ? 'Swipe up or down to read each morning.' : undefined}
      accessibilityActions={chart ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) =>
        chart && step(e.nativeEvent.actionName === 'increment' ? 'next' : 'previous')
      }
      {...(chart ? keys : {})}
      style={[styles.card, { gap: 14, overflow: 'hidden' }, wash]}>
      <View style={[styles.spread, { columnGap: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              backgroundColor: palette.accentTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MomentIcon name="morning" color={palette.accentText} />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={{ ...type.heading, flexShrink: 1 }}>
            Mornings
          </Text>
        </View>
        {card.headline !== card.upBy && (
          <Text maxFontSizeMultiplier={1.3} style={{ ...type.caption, color: palette.label2 }}>
            {card.upBy}
          </Text>
        )}
      </View>
      <View style={{ gap: 2 }}>
        <MorningsHeadline text={card.headline} />
        {/* The median only: the middle half stays in the card's spoken summary. */}
        {chart && card.usual && (
          <Text testID="mornings-usual" style={{ ...type.caption, color: palette.label2 }}>
            {card.usual.split(' · ')[0]}
          </Text>
        )}
      </View>
      {!chart ? (
        !!card.note && <Text style={styles.muted}>{card.note}</Text>
      ) : (
        <>
          {card.month && <MonthScore month={card.month} />}
          <View>
            <DayGrid
              days={days}
              look={(d) => MORNING_CELL[d.mark]}
              selected={selected}
              onSelect={setSelected}
              testID={(d) => `morning:${d.date}`}
              halo={(d) => (d.date === last && d.mark !== 'open' ? palette.accent : null)}
            />
          </View>
          <View testID="mornings-readout" style={{ minHeight: 20, justifyContent: 'center' }}>
            {readout ? (
              <Text style={{ ...type.caption, color: palette.label }}>{readout}</Text>
            ) : (
              <MorningKey />
            )}
          </View>
        </>
      )}
    </View>
  );
}
