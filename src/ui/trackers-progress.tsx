import { Text, View } from 'react-native';
import { State, localDate, shiftDate } from '../domain/model';
import { adherence } from '../domain/rules';
import { useApp } from '../state/app-state';
import { styles } from './components';
import { fonts, palette, type } from './theme';

/**
 * Rulebooks with something recorded in the last 30 days. Trading's rulebook is left out: its
 * process has its own page, so its numbers are never shown a second way here.
 */
export function rulesInWindow(state: State, today: string) {
  return state.ruleBooks
    .filter((book) => !book.trading)
    .map((book) => ({
      book,
      result: adherence(state, book.routineId, shiftDate(today, -29), today),
    }))
    .filter(({ result }) => result.reviewed + result.daysWithout > 0);
}

/** Honest rule adherence for the last 30 days, from actual reviews. */
export function RulesProgress() {
  const { state } = useApp();
  const rows = rulesInWindow(state, localDate());
  if (!rows.length) return null;
  return (
    <>
      {rows.map(({ book, result }) => {
        return (
          <View key={book.id} style={{ gap: 6 }}>
            <Text style={type.item}>{`${book.title} · last 30 days`}</Text>
            <Text style={styles.body}>
              {result.reviewed} reviewed · {result.compliantDays} fully followed ·{' '}
              {result.daysWithout} without the activity
            </Text>
            <Text style={{ ...type.meta, color: palette.label2 }}>
              {result.percent === null
                ? 'No applicable checkpoints answered yet'
                : `${result.percent}% of applicable checkpoints kept`}
            </Text>
            {result.missed.slice(0, 5).map((m) => (
              <View key={m.label} style={[styles.spread, { minHeight: 28, flexWrap: 'nowrap' }]}>
                <Text style={[styles.muted, { flex: 1 }]}>{m.label}</Text>
                <Text style={{ ...fonts.semibold, fontSize: 12, color: palette.accent }}>
                  ×{m.count}
                </Text>
              </View>
            ))}
            <Text style={styles.muted}>
              Not applicable never counts against you, and a day without the activity is not a
              score. Nothing here measures results.
            </Text>
          </View>
        );
      })}
    </>
  );
}
