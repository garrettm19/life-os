import { useState } from 'react';
import { Text, View } from 'react-native';
import type { HabitRow } from '../domain/progress';
import { LinkButton, styles } from './components';
import { fonts, palette, type } from './theme';

// Each routine's completion in the range as a horizontal bar: required habits most done first, so
// the habit the headline names is on top, then the optional ones. The bar is the share of recorded
// days done; the count beside it says the days.
// It is already a list, so every row reads in words and needs no separate list view.

const SHOWN = 6;

function Bar({ row }: { row: HabitRow }) {
  return (
    <View
      testID="habit-bar"
      accessible
      accessibilityLabel={`${row.title}${row.optional ? ', optional' : ''}: done on ${row.done} of ${row.due} day${row.due === 1 ? '' : 's'}, ${row.share}%`}
      style={{ gap: 6, paddingVertical: 4 }}>
      <View style={[styles.spread, { gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }]}>
        <Text style={{ ...type.item, fontSize: 14, lineHeight: 19, flexShrink: 1 }}>
          {row.title}
          {row.optional && (
            <Text style={{ ...type.caption, color: palette.label3 }}> · optional</Text>
          )}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 0,
            ...fonts.figure,
            fontSize: 13,
            lineHeight: 19,
            color: palette.label2,
            fontVariant: ['tabular-nums'],
          }}>
          {row.done} of {row.due}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: palette.fillStrong }}>
        {row.share > 0 && (
          <View
            testID="chart-mark"
            style={{
              width: `${row.share}%`,
              minWidth: 8,
              height: 8,
              borderRadius: 4,
              // An optional habit is quieter: encouraged, never required.
              backgroundColor: row.optional ? palette.checkEdge : palette.chart,
            }}
          />
        )}
      </View>
    </View>
  );
}

export function HabitBars({ rows }: { rows: HabitRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <View style={{ gap: 8 }}>
      {shown.map((row) => (
        <Bar key={row.routineId} row={row} />
      ))}
      {rows.length > SHOWN && (
        <View style={styles.row}>
          <LinkButton
            tone="dim"
            title={all ? 'Show fewer' : `Show all ${rows.length} habits`}
            onPress={() => setAll(!all)}
          />
        </View>
      )}
    </View>
  );
}
