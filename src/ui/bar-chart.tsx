import { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { ChartAccess, ChartEntry, Readout, Scrub } from './chart-card';
import {
  AXIS_TEXT_MAX,
  OUTLINE_MIN,
  axisLabel,
  axisLabelWidth,
  columnLayout,
  columnLeft,
  niceScale,
} from './chart-scale';
import { fonts, palette } from './theme';

// Weekly columns from zero, one slot per week of the range: a week with nothing recorded has no
// column (an empty slot), never a column of zero. Columns are at most 24 pt wide with a 4 pt
// rounded end, square at the baseline, and never touch; widths and edges are whole points, so a
// year of narrow columns renders evenly. The week still in progress is an outline, or a lighter
// fill (still 3:1 on the card) when a column is too narrow for an outline to read.
// An optional target is a solid Ember line, its value on the axis. A touch anywhere on the plot
// height selects the nearest week (`Scrub`), which VoiceOver steps through as one element.

export type WeekColumn = {
  weekStart: string;
  /** Null for a week with nothing recorded: no column. */
  value: number | null;
  inProgress: boolean;
  /** Fern for a column that reports something done (a week that hit its target). */
  done?: boolean;
};

type Props = {
  weeks: WeekColumn[];
  target: number | null;
  height?: number;
  selected: number | null;
  onSelect: (index: number) => void;
  /** The chart's one accessible element: its summary and the selected week. */
  access: ChartAccess;
  /** The selected entry, read out over the plot. */
  reading: ChartEntry | null;
  /** A count (study days, actions): the axis is labeled on whole numbers only. */
  whole?: boolean;
};

const GUTTER = 36;
const PAD_RIGHT = 4;
const PAD_TOP = 14;
const AXIS = 22;
const END = 4;

export function BarChart({
  weeks,
  target,
  height = 170,
  selected,
  onSelect,
  access,
  reading,
  whole = false,
}: Props) {
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  if (!weeks.length) return null;
  const values = weeks.map((w) => w.value ?? 0);
  // The plot runs from zero to the round tick at or above the highest column (or the target), so
  // the top of every column sits under a labeled line.
  const { hi, ticks } = niceScale(0, Math.max(...values, target ?? 0, 1), { whole });
  const plotW = Math.max(0, width - GUTTER - PAD_RIGHT);
  const plotH = height - PAD_TOP - AXIS - 4;
  const { slot, column } = columnLayout(weeks.length, plotW);
  const yOf = (v: number) => PAD_TOP + (1 - v / hi) * plotH;
  const centerOf = (i: number) => GUTTER + slot * (i + 0.5);
  const labeled = weeks.length === 1 ? [0] : [0, weeks.length - 1];
  const lastWeek = weeks[weeks.length - 1].weekStart;
  const outline = column >= OUTLINE_MIN;
  return (
    <View
      testID="chart"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%' }}>
      {width > 0 && (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(260)} style={{ flex: 1 }}>
          {/* A tick too close to the target's label gives way to it. */}
          {ticks
            .filter((t) => target === null || Math.abs(yOf(t) - yOf(target)) >= 14)
            .map((t) => (
              <View
                key={t}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
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
                  {t}
                </Text>
                <View
                  style={{ flex: 1, height: 1, marginLeft: 6, backgroundColor: palette.separator }}
                />
              </View>
            ))}
          {labeled.map((i) => {
            const label = axisLabel(weeks[i].weekStart, lastWeek);
            const w = axisLabelWidth(label);
            return (
              <Text
                key={i}
                testID="chart-axis-date"
                pointerEvents="none"
                numberOfLines={1}
                maxFontSizeMultiplier={AXIS_TEXT_MAX}
                style={{
                  position: 'absolute',
                  top: PAD_TOP + plotH + 8,
                  width: w,
                  left: Math.min(Math.max(centerOf(i) - w / 2, GUTTER - 8), width - w),
                  textAlign:
                    weeks.length > 1 && i === 0 ? 'left' : weeks.length > 1 ? 'right' : 'center',
                  ...fonts.semibold,
                  fontSize: 10,
                  lineHeight: 14,
                  color: palette.label3,
                }}>
                {label}
              </Text>
            );
          })}
          {selected !== null && weeks[selected] && (
            // The selected week's slot, lightly lifted, so an empty week reads as selected too.
            <View
              testID="chart-crosshair"
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: centerOf(selected) - Math.max(column, 6) / 2 - 2,
                width: Math.max(column, 6) + 4,
                top: PAD_TOP - 4,
                height: plotH + 4,
                borderRadius: 4,
                backgroundColor: palette.fillStrong,
              }}
            />
          )}
          {weeks.map((w, i) => {
            if (w.value === null) return null;
            const on = selected === i;
            const color = w.done
              ? on
                ? palette.doneText
                : palette.done
              : on
                ? palette.chartLight
                : palette.chart;
            const h = Math.max(2, PAD_TOP + plotH - yOf(w.value));
            const end = Math.min(END, column / 2);
            return (
              <View
                key={w.weekStart}
                testID="chart-mark"
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: columnLeft(centerOf(i), column),
                  top: PAD_TOP + plotH - h,
                  width: column,
                  height: h,
                  borderTopLeftRadius: end,
                  borderTopRightRadius: end,
                  borderWidth: w.inProgress && outline ? 1.5 : 0,
                  borderColor: color,
                  backgroundColor: w.inProgress && outline ? 'transparent' : color,
                  // Lighter, but still 3:1 on the card: 0.65 of the chart color is 3.15:1.
                  opacity: w.inProgress && !outline ? 0.65 : 1,
                }}
              />
            );
          })}
          {target !== null && (
            <>
              <View
                testID="chart-target-line"
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: GUTTER,
                  right: PAD_RIGHT,
                  top: yOf(target) - 0.75,
                  height: 1.5,
                  backgroundColor: palette.accent,
                }}
              />
              <Text
                testID="chart-target"
                pointerEvents="none"
                numberOfLines={1}
                maxFontSizeMultiplier={AXIS_TEXT_MAX}
                style={{
                  position: 'absolute',
                  left: 0,
                  width: GUTTER - 6,
                  top: yOf(target) - 7,
                  textAlign: 'right',
                  ...fonts.figure,
                  fontSize: 10,
                  lineHeight: 14,
                  color: palette.label,
                  fontVariant: ['tabular-nums'],
                }}>
                {target}
              </Text>
            </>
          )}
          <Readout entry={reading} x={selected === null ? 0 : centerOf(selected)} width={width} />
          <Scrub
            left={GUTTER}
            width={plotW + PAD_RIGHT}
            height={PAD_TOP + plotH + 4}
            positions={weeks.map((_, i) => centerOf(i))}
            selected={selected}
            onSelect={onSelect}
            access={access}
          />
        </Animated.View>
      )}
    </View>
  );
}
