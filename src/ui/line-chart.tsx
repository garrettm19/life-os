import { useState } from 'react';
import { ColorValue, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { daysBetween } from '../domain/model';
import { ChartAccess, ChartEntry, Readout, Scrub } from './chart-card';
import { AXIS_TEXT_MAX, axisDates, axisLabel, axisLabelWidth, labeledScale } from './chart-scale';
import { fonts, palette } from './theme';

// A line chart drawn with plain views: no chart library. Points sit on a true time axis, so uneven
// spacing shows uneven dates. Consecutive points further apart than `maxGapDays` are not joined, so
// a long gap reads as a gap instead of a line implying values that were never measured.
//
// Lines are 2 pt; markers (8 pt, with a 2 pt ring in the surface color) appear only where they
// carry meaning: each line's first and last point, the selected position and any point the caller
// marks (a clean trading session). A touch anywhere on the plot height moves a crosshair to the
// nearest position (`Scrub`), which VoiceOver steps through as one adjustable element. Marks carry
// test IDs so browser tests can check they are drawn in the plot.

export type ChartLine = {
  points: { date: string; y: number }[];
  color: ColorValue;
  /** A short name drawn beside the line's last point when two lines share a chart. */
  label?: string;
};

type Props = {
  lines: ChartLine[];
  /** The selectable positions, oldest first: every date with a point on any line. */
  dates: string[];
  height?: number;
  maxGapDays: number;
  format: (y: number) => string;
  /** Index into `dates`. */
  selected: number | null;
  onSelect: (index: number) => void;
  /** The chart's one accessible element: its summary and the selected point. */
  access: ChartAccess;
  /** The selected entry, read out over the plot. */
  reading: ChartEntry | null;
  /** A fixed y range with its labeled lines (0 to 100%, 0 to 8), instead of fitting the data. */
  domain?: { lo: number; hi: number; ticks: number[] };
  /** The smallest range the y axis spans, so a small change does not look steep. */
  minSpan?: number;
  /** A marker's fill for a point of the first line that carries meaning, or null for none. */
  mark?: (index: number) => ColorValue | null;
  /** One point per week: the middle axis label is then a week's Monday, as the readout names it. */
  weekly?: boolean;
};

const GUTTER = 44;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const AXIS = 22;
const INSET = 8;
const MARK = 8;
const RING = 2;

function Marker({
  x,
  y,
  color,
  size = MARK,
}: {
  x: number;
  y: number;
  color: ColorValue;
  size?: number;
}) {
  const outer = size + RING * 2;
  return (
    <View
      testID="chart-mark"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - outer / 2,
        top: y - outer / 2,
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        backgroundColor: color,
        borderWidth: RING,
        borderColor: palette.surface,
      }}
    />
  );
}

export function LineChart({
  lines,
  dates,
  height = 176,
  maxGapDays,
  format,
  selected,
  onSelect,
  access,
  reading,
  domain,
  minSpan = 0,
  mark,
  weekly = false,
}: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const all = lines.flatMap((l) => l.points);
  if (!all.length || !dates.length) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const span = Math.max(1, daysBetween(first, last));
  const ys = all.map((p) => p.y);
  // The plot spans whole tick steps, so a labeled line sits at or above the highest value and at or
  // below the lowest, and every label sits on its line and names it.
  const scale =
    domain ??
    labeledScale(Math.min(...ys), Math.max(...ys), format, {
      minSpan,
      floor: Math.min(...ys) >= 0 ? 0 : undefined,
    });
  const { lo, hi } = scale;
  const plotW = Math.max(0, width - GUTTER - PAD_RIGHT - INSET * 2);
  const plotH = height - PAD_TOP - AXIS - 6;
  const single = first === last;
  const xOf = (date: string) =>
    GUTTER + INSET + (single ? plotW / 2 : (daysBetween(first, date) / span) * plotW);
  const yOf = (y: number) => PAD_TOP + (1 - (y - lo) / (hi - lo)) * plotH;
  const positions = dates.map(xOf);
  const indexOf = new Map(dates.map((d, i) => [d, i]));
  const at = (line: ChartLine, date: string) => line.points.find((p) => p.date === date);
  const pick = selected !== null ? dates[selected] : null;
  // Direct labels at the line ends only where they cannot collide; otherwise the keys carry them.
  const ends = lines.map((l) => l.points.at(-1)).filter((p) => p !== undefined);
  const labeled =
    lines.length > 1 &&
    lines.every((l) => l.label && l.points.length) &&
    ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(yOf(a.y) - yOf(b.y)) >= 18));
  return (
    <View
      testID="chart"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%' }}>
      {width > 0 && (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(260)} style={{ flex: 1 }}>
          {scale.ticks.map((t, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: PAD_RIGHT,
                top: yOf(t) - 7,
                flexDirection: 'row',
                alignItems: 'center',
              }}>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={AXIS_TEXT_MAX}
                style={{
                  width: GUTTER - 6,
                  ...fonts.semibold,
                  fontSize: 10,
                  lineHeight: 14,
                  color: palette.label3,
                  textAlign: 'right',
                  fontVariant: ['tabular-nums'],
                }}>
                {format(t)}
              </Text>
              <View
                style={{ flex: 1, height: 1, marginLeft: 6, backgroundColor: palette.separator }}
              />
            </View>
          ))}
          {axisDates(first, last, span, plotW, weekly).map((d, i, list) => {
            const label = axisLabel(d, last);
            const w = axisLabelWidth(label);
            return (
              <Text
                key={`${d}-${i}`}
                testID="chart-axis-date"
                pointerEvents="none"
                numberOfLines={1}
                maxFontSizeMultiplier={AXIS_TEXT_MAX}
                style={{
                  position: 'absolute',
                  top: PAD_TOP + plotH + 8,
                  width: w,
                  left: Math.min(Math.max(xOf(d) - w / 2, GUTTER - 8), width - w),
                  textAlign:
                    list.length > 1 && i === 0
                      ? 'left'
                      : list.length > 1 && i === list.length - 1
                        ? 'right'
                        : 'center',
                  ...fonts.semibold,
                  fontSize: 10,
                  lineHeight: 14,
                  color: palette.label3,
                }}>
                {label}
              </Text>
            );
          })}
          {pick !== null && (
            <View
              testID="chart-crosshair"
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: xOf(pick) - 0.5,
                top: PAD_TOP - 4,
                width: 1,
                height: plotH + 8,
                backgroundColor: palette.checkEdge,
              }}
            />
          )}
          {lines.map((line, li) =>
            line.points.slice(1).map((p, i) => {
              const a = line.points[i];
              if (daysBetween(a.date, p.date) > maxGapDays) return null;
              const x1 = xOf(a.date),
                y1 = yOf(a.y),
                x2 = xOf(p.date),
                y2 = yOf(p.y);
              // The true length: a longer segment would stick out past a sharp turn as a spur. The
              // joint below rounds the corner instead.
              const length = Math.hypot(x2 - x1, y2 - y1);
              return (
                <View
                  key={`${li}-${i}`}
                  testID="chart-line"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: (x1 + x2) / 2 - length / 2,
                    top: (y1 + y2) / 2 - 1,
                    width: length,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: line.color,
                    transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
                  }}
                />
              );
            }),
          )}
          {/* A round joint where two segments meet: a dot as wide as the line closes the corner. */}
          {lines.map((line, li) =>
            line.points.map((p, i) => {
              const before = line.points[i - 1];
              const after = line.points[i + 1];
              if (
                !before ||
                !after ||
                daysBetween(before.date, p.date) > maxGapDays ||
                daysBetween(p.date, after.date) > maxGapDays
              )
                return null;
              return (
                <View
                  key={`j-${li}-${p.date}`}
                  testID="chart-joint"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: xOf(p.date) - 1,
                    top: yOf(p.y) - 1,
                    width: 2,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: line.color,
                  }}
                />
              );
            }),
          )}
          {/* A point standing alone (no neighbor within the gap) still shows as a dot. */}
          {lines.map((line, li) =>
            line.points.map((p, i) => {
              const before = line.points[i - 1];
              const after = line.points[i + 1];
              const alone =
                (!before || daysBetween(before.date, p.date) > maxGapDays) &&
                (!after || daysBetween(p.date, after.date) > maxGapDays);
              const meaning = li === 0 && mark ? mark(indexOf.get(p.date) ?? -1) : null;
              const end = i === 0 || i === line.points.length - 1;
              if (!meaning && !end && !alone) return null;
              return (
                <Marker
                  key={`m-${li}-${p.date}`}
                  x={xOf(p.date)}
                  y={yOf(p.y)}
                  color={meaning ?? line.color}
                />
              );
            }),
          )}
          {pick !== null &&
            lines.map((line, li) => {
              const p = at(line, pick);
              const meaning = li === 0 && mark ? mark(selected!) : null;
              return p ? (
                <Marker
                  key={`s-${li}`}
                  x={xOf(p.date)}
                  y={yOf(p.y)}
                  color={meaning ?? line.color}
                  size={12}
                />
              ) : null;
            })}
          {labeled &&
            lines.map((line) => {
              const p = line.points.at(-1)!;
              const above = yOf(p.y) > PAD_TOP + 18;
              return (
                <Text
                  key={`label-${line.label}`}
                  pointerEvents="none"
                  numberOfLines={1}
                  maxFontSizeMultiplier={AXIS_TEXT_MAX}
                  style={{
                    position: 'absolute',
                    right: width - xOf(p.date) + 2,
                    top: above ? yOf(p.y) - 22 : yOf(p.y) + 8,
                    ...fonts.semibold,
                    fontSize: 10,
                    lineHeight: 14,
                    color: palette.label2,
                  }}>
                  {line.label}
                </Text>
              );
            })}
          <Readout entry={reading} x={pick === null ? 0 : xOf(pick)} width={width} />
          <Scrub
            left={GUTTER}
            width={plotW + INSET * 2 + PAD_RIGHT}
            height={PAD_TOP + plotH + 6}
            positions={positions}
            selected={selected}
            onSelect={onSelect}
            access={access}
          />
        </Animated.View>
      )}
    </View>
  );
}
