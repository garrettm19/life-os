import { Text, View } from 'react-native';
import { activeFocus, focusRoutines } from '../domain/focus';
import { localDate } from '../domain/model';
import { weeklySummary } from '../domain/weekly';
import { useApp } from '../state/app-state';
import { allWorkouts } from './progress';
import { shortDate } from './chart-scale';
import { SectionLabel, styles } from './components';
import { palette, radius, type } from './theme';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}
      style={{
        flexGrow: 1,
        flexBasis: 96,
        gap: 2,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: radius.control,
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.separator,
      }}>
      <Text style={type.caption} numberOfLines={2}>
        {label}
      </Text>
      <Text style={{ ...type.value, fontSize: 20, lineHeight: 26 }} numberOfLines={1}>
        {value}
      </Text>
      {!!note && <Text style={type.caption}>{note}</Text>}
    </View>
  );
}

/**
 * The last seven days at a glance: study days, career objectives and workouts done. Money, weight
 * and the study calendar have their own sections below, so nothing here repeats them. A routine the
 * focus covers is left out, because the course correction just below shows its days, and so is a
 * tile with nothing due yet: no "0 of 0".
 */
export function WeeklyReview() {
  const { state } = useApp();
  const today = localDate();
  const week = weeklySummary(state, today);
  const focus = state.programs.length ? activeFocus(state) : undefined;
  const covered = new Set(focus ? focusRoutines(state, focus).map((r) => r.id) : []);
  const study = week.study.filter((s) => s.eligible > 0 && !covered.has(s.routineId));
  const jobs = week.jobs.filter((j) => j.opportunities > 0 && !covered.has(j.routineId));
  const workouts =
    focus?.evidence === 'training'
      ? []
      : allWorkouts(state, week.from, week.to, today).filter(
          (o) => o.date < today || o.status !== 'planned',
        );
  if (!study.length && !jobs.length && !workouts.length) return null;
  return (
    <View style={styles.section}>
      {/* Under the "Last 7 days" heading: the dates alone. */}
      <SectionLabel title={`${shortDate(week.from)} – ${shortDate(week.to)}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {study.map((s) => (
          <Tile
            key={s.title}
            label={`${s.title} · days`}
            value={`${s.completed} of ${s.eligible}`}
          />
        ))}
        {jobs.map((j) => (
          <Tile
            key={j.title}
            label={`${j.title} · days`}
            value={`${j.done} of ${j.opportunities}`}
          />
        ))}
        {workouts.length > 0 && (
          <Tile
            label="Workouts done"
            value={`${workouts.filter((o) => o.status === 'done').length} of ${workouts.length}`}
          />
        )}
      </View>
    </View>
  );
}
