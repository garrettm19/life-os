import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import {
  DEFAULT_PROGRESS_RANGE,
  PROGRESS_RANGES,
  ProgressRange,
  progressOf,
} from '../domain/progress';
import { useApp } from '../state/app-state';
import { Page } from '../ui/components';
import { Segmented } from '../ui/controls';
import { JourneyCard } from '../ui/journey-card';
import {
  CardioCard,
  ConsistencyCard,
  HabitsCard,
  JobsCard,
  MoneyCard,
  MorningsCard,
  StrengthCard,
  StudyCard,
  TradingCard,
  WeightCard,
} from '../ui/progress-cards';
import { StatTile } from '../ui/stat-tile';
import { palette, type } from '../ui/theme';
import { ThisWeek } from '../ui/this-week';
import { useToday } from '../ui/use-today';

const RANGE_OPTIONS = PROGRESS_RANGES.map((r) => [r.value, r.label] as const);

/**
 * Progress answers "am I improving?" at a glance: the Mornings card first while a routine is the
 * morning anchor, How far you've come as a scoreboard right under it, then one range for everything
 * below it, the KPI row with each change against the range before, and one chart card per
 * question, each with a plain sentence above its chart. The last seven days and the ways to record
 * follow, with the rest of the history folded.
 * The route stays /review.
 */
export default function ProgressScreen() {
  const { state } = useApp();
  const [range, setRange] = useState<ProgressRange>(DEFAULT_PROGRESS_RANGE);
  // Kept current across midnight, so a screen left open moves to the new day.
  const today = useToday();
  // Pure and cached per saved state, range and day: switching ranges back and forth is free.
  const data = useMemo(() => progressOf(state, range, today), [state, range, today]);
  const { window } = data;
  // How to read a chart is said once, above the first chart, not on every card.
  const charted = [
    data.consistency,
    data.weight,
    data.strength,
    data.study,
    data.cardio,
    data.jobs,
    data.money,
    data.trading,
  ].some((card) => card?.state === 'chart');
  return (
    <Page title="Progress">
      {/* The morning anchor's card leads, then how far you've come: their spans are their own (the
          last seven mornings, this month, since the start), so they sit above the range that
          scopes everything below. */}
      {data.mornings && <MorningsCard card={data.mornings} />}
      <JourneyCard />
      <View style={{ gap: 6, marginTop: 8 }}>
        <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
        <Text testID="range-text" style={type.caption}>
          {`${window.text} · vs the ${window.words.previous}`}
        </Text>
      </View>
      <View testID="kpi-row" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {data.tiles.map((tile) => (
          <StatTile key={tile.id} tile={tile} />
        ))}
      </View>
      {charted && (
        <Text testID="chart-hint" style={{ ...type.caption, color: palette.label2 }}>
          Touch and drag along a chart to read each point or week.
        </Text>
      )}
      {data.consistency && <ConsistencyCard card={data.consistency} />}
      {data.weight && <WeightCard card={data.weight} />}
      {data.strength && <StrengthCard card={data.strength} />}
      {data.study && <StudyCard card={data.study} />}
      {data.cardio && <CardioCard card={data.cardio} window={window} />}
      {data.jobs && <JobsCard card={data.jobs} />}
      {data.money && <MoneyCard card={data.money} />}
      {data.trading && <TradingCard card={data.trading} />}
      {data.habits && <HabitsCard card={data.habits} />}
      <ThisWeek today={today} />
    </Page>
  );
}
