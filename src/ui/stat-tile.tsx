import { useState } from 'react';
import { Text, View } from 'react-native';
import { daysBetween } from '../domain/model';
import type { Tile } from '../domain/progress';
import { styles } from './components';
import { fonts, palette, radius, type } from './theme';

// The KPI row's stat tile: the label, the figure, one detail line, the change against the previous
// range in words and a small sparkline. A tile with nothing to show says what will fill it.

type Point = { date: string; y: number };

const SPARK_H = 26;

/**
 * A trend in a few points: a thin line in a quiet tone with the latest point in the chart color.
 * No axis or labels; the figure above it is the value.
 */
export function Sparkline({ points }: { points: Point[] }) {
  const [width, setWidth] = useState(0);
  // One point is not a trend.
  if (points.length < 2) return null;
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = Math.max(1, daysBetween(points[0].date, points[points.length - 1].date));
  const pad = 4;
  const xOf = (p: Point) =>
    points.length === 1
      ? width / 2
      : pad + (daysBetween(points[0].date, p.date) / span) * (width - pad * 2);
  const yOf = (y: number) =>
    hi === lo ? SPARK_H / 2 : pad + (1 - (y - lo) / (hi - lo)) * (SPARK_H - pad * 2);
  const last = points[points.length - 1];
  return (
    <View
      testID="sparkline"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: SPARK_H, width: '100%' }}>
      {width > 0 &&
        points.slice(1).map((p, i) => {
          const a = points[i];
          const x1 = xOf(a),
            y1 = yOf(a.y),
            x2 = xOf(p),
            y2 = yOf(p.y);
          // The true length, with a round joint below: a longer segment spurs at a sharp turn.
          const length = Math.hypot(x2 - x1, y2 - y1);
          return (
            <View
              key={p.date}
              style={{
                position: 'absolute',
                left: (x1 + x2) / 2 - length / 2,
                top: (y1 + y2) / 2 - 0.75,
                width: length,
                height: 1.5,
                borderRadius: 1,
                backgroundColor: palette.chart,
                opacity: 0.45,
                transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
              }}
            />
          );
        })}
      {width > 0 &&
        points.slice(1, -1).map((p) => (
          <View
            key={`j-${p.date}`}
            style={{
              position: 'absolute',
              left: xOf(p) - 0.75,
              top: yOf(p.y) - 0.75,
              width: 1.5,
              height: 1.5,
              borderRadius: 0.75,
              backgroundColor: palette.chart,
              opacity: 0.45,
            }}
          />
        ))}
      {width > 0 && (
        <View
          style={{
            position: 'absolute',
            left: xOf(last) - 3.5,
            top: yOf(last.y) - 3.5,
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: palette.chart,
          }}
        />
      )}
    </View>
  );
}

/**
 * The change against the previous range as a pill and the words it is set against: "+3" in Fern
 * for a rise, a fall or no change in the quiet fill, never red. The text reads as one line ("+3 vs
 * previous 4 weeks"), so what VoiceOver and the browser read is the domain's own words.
 */
function Change({ tile }: { tile: Tile }) {
  const change = tile.change!;
  const at = change.indexOf(' vs ');
  if (tile.delta === null || tile.delta === 0 || at < 0)
    return <Text style={{ ...type.footnote, color: palette.label2 }}>{change}</Text>;
  const up = tile.delta > 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 2,
      }}>
      <View
        style={{
          borderRadius: radius.capsule,
          paddingLeft: 9,
          paddingRight: 5,
          paddingVertical: 2,
          backgroundColor: up ? palette.doneTint : palette.fill,
        }}>
        <Text
          maxFontSizeMultiplier={1.4}
          style={{
            ...fonts.figureHeavy,
            fontSize: 15,
            lineHeight: 20,
            color: up ? palette.doneText : palette.label2,
          }}>
          {/* The space ends the pill's words, so a wrapped line never starts with one. */}
          {`${change.slice(0, at)} `}
        </Text>
      </View>
      <Text style={{ ...type.footnote, color: palette.label2 }}>{change.slice(at + 1)}</Text>
    </View>
  );
}

/** "15 of 20" as a large "15" and a smaller " of 20"; "1 day" as "1" and " day". */
function Value({ value }: { value: string }) {
  const at = value.indexOf(' ');
  const head = at < 0 ? value : value.slice(0, at);
  const rest = at < 0 ? '' : value.slice(at);
  return (
    <Text
      testID="tile-value"
      maxFontSizeMultiplier={1.6}
      // A long figure ("135 of 312") is set smaller so it stays on one line at 320 pt; the line
      // height stays, so the tiles side by side keep their rows level.
      style={{ ...type.figure, fontSize: head.length > 3 ? 26 : 32, lineHeight: 38 }}>
      {head}
      {!!rest && (
        <Text style={{ ...fonts.figure, fontSize: 16, color: palette.label2 }}>{rest}</Text>
      )}
    </Text>
  );
}

export function StatTile({ tile }: { tile: Tile }) {
  const words = tile.value
    ? [tile.value, tile.detail, tile.change].filter(Boolean).join('. ')
    : (tile.empty ?? '');
  return (
    <View
      testID={`tile-${tile.id}`}
      accessible
      accessibilityLabel={`${tile.label}: ${words}`}
      style={[
        styles.card,
        {
          flexGrow: 1,
          flexBasis: '40%',
          minWidth: 136,
          gap: 4,
          padding: 14,
          borderRadius: radius.tile,
        },
      ]}>
      <Text style={{ ...type.caption, ...fonts.semibold, color: palette.label2 }} numberOfLines={2}>
        {tile.label}
      </Text>
      {tile.value ? (
        <>
          <Value value={tile.value} />
          {!!tile.change && <Change tile={tile} />}
          {!!tile.detail && (
            <Text style={{ ...type.footnote, color: palette.label2 }}>{tile.detail}</Text>
          )}
          <View style={{ marginTop: 6 }}>
            <Sparkline points={tile.spark} />
          </View>
        </>
      ) : (
        <Text style={{ ...type.caption, color: palette.label2 }}>{tile.empty}</Text>
      )}
    </View>
  );
}
