import { useState } from 'react';
import { ColorValue, Text, View } from 'react-native';
import { CATEGORY_LABELS, recentLog } from '../domain/lifelog';
import { changeSince, weightHistory } from '../domain/measurements';
import { WeightUnit, displayDate } from '../domain/model';
import { isPlanWorkout, workoutOccurrences } from '../domain/sequence';
import { useApp } from '../state/app-state';
import { Chip, styles } from './components';
import { LogSheet, LogTarget } from './log-sheet';
import { PressableScale } from './motion';
import { palette, type } from './theme';
import { WeightSheet, WeightTarget } from './weight-sheet';

/** Workout occurrences of every program with a workout plan or a rotation, between two dates. */
export function allWorkouts(
  state: ReturnType<typeof useApp>['state'],
  from: string,
  to: string,
  today: string,
) {
  const programs = state.programs.filter((p) => p.routines.some((r) => isPlanWorkout(state, r.id)));
  return programs
    .flatMap((p) => workoutOccurrences(state, p.id, from, to, today))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function Row({
  left,
  right,
  tone,
  onPress,
  label,
}: {
  left: string;
  right: string;
  tone?: ColorValue;
  onPress?: () => void;
  label?: string;
}) {
  const body = (
    <View style={[styles.spread, { minHeight: 36 }]}>
      <Text style={{ ...type.item, fontSize: 14, flexShrink: 1 }}>{left}</Text>
      <Text style={{ ...type.meta, color: tone ?? palette.label2 }}>{right}</Text>
    </View>
  );
  return onPress ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label ?? `${left}, ${right}`}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      {body}
    </PressableScale>
  ) : (
    <View accessible accessibilityLabel={`${left}, ${right}`}>
      {body}
    </View>
  );
}

/** How many of the latest weigh-ins the fold lists. */
export const LATEST = 8;

/**
 * The latest weigh-ins, each one tap from its editor, with the change since the one before. The
 * change over the range and its caveat are the Body weight card's, so they are not repeated here.
 */
export function WeighIns() {
  const { state } = useApp();
  const last = [...state.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  const [unit, setUnit] = useState<WeightUnit>(last?.entered.unit ?? 'lb');
  const [target, setTarget] = useState<WeightTarget | null>(null);
  const points = weightHistory(state, unit).slice(-LATEST);
  if (!points.length) return null;
  return (
    <>
      {[...points].reverse().map((p) => (
        <Row
          key={p.id}
          left={displayDate(p.date)}
          right={`${p.value} ${unit}${p.change === null ? '' : `  ${changeSince(p, unit)}`}`}
          label={`Edit weight for ${displayDate(p.date)}: ${p.value} ${unit}`}
          onPress={() => setTarget({ measurement: state.measurements.find((m) => m.id === p.id) })}
        />
      ))}
      <View style={styles.row}>
        {(['lb', 'kg'] as const).map((u) => (
          <Chip key={u} role="radio" title={u} on={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <WeightSheet target={target} close={() => setTarget(null)} />
    </>
  );
}

/** The latest notes from the life log. */
export function RecentLog() {
  const { state } = useApp();
  const [target, setTarget] = useState<LogTarget | null>(null);
  const entries = recentLog(state, 5);
  if (!entries.length) return null;
  return (
    <>
      {entries.map((e) => (
        <PressableScale
          key={e.id}
          accessibilityRole="button"
          accessibilityLabel={`Edit log entry from ${displayDate(e.date)}: ${e.text}`}
          onPress={() => setTarget({ date: e.date, entry: e })}
          style={{ minHeight: 44, justifyContent: 'center', gap: 2, paddingVertical: 4 }}>
          <Text style={styles.body} numberOfLines={2}>
            {e.text}
          </Text>
          <Text style={{ ...type.meta }}>
            {displayDate(e.date)}
            {e.category ? ` · ${CATEGORY_LABELS[e.category]}` : ''}
            {e.energy ? ` · self-rated energy ${e.energy}/5` : ''}
            {e.mood ? ` · self-rated mood ${e.mood}/5` : ''}
          </Text>
        </PressableScale>
      ))}
      <LogSheet target={target} close={() => setTarget(null)} />
    </>
  );
}
