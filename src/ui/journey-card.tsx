import { useMemo, useState } from 'react';
import { ColorValue, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Highlight, clearedByWeek, journey, startedOn, weekHeadline } from '../domain/moments';
import { displayDate, localDate } from '../domain/model';
import { useApp } from '../state/app-state';
import { shortDate } from './chart-scale';
import { styles } from './components';
import { fonts, palette, radius, type } from './theme';

/**
 * "How far you've come": the long view as a scoreboard of big, plain numbers from the records (days
 * cleared, workouts, debt paid down, savings added, body weight), the lift that grew most as "185 →
 * 205 lb" with its gain, a headline that sets last week only against the user's own earlier weeks
 * and, once two weeks have a cleared day, the last six weeks of cleared days as bars. Open on
 * Progress right after Mornings. Nothing is estimated or scored; a kind with no records is left
 * out, and with none it is not shown.
 */
export function JourneyCard() {
  const { state } = useApp();
  const today = localDate();
  // Each reads the whole history, so they are worked out once per saved state and day, not again
  // when Progress re-renders for a range or a pending save.
  const items = useMemo(() => journey(state, today), [state, today]);
  const weeks = useMemo(() => clearedByWeek(state, today), [state, today]);
  const headline = useMemo(() => weekHeadline(state, today), [state, today]);
  const since = useMemo(() => startedOn(state, today), [state, today]);
  const reduced = useReducedMotion();
  if (!items.length) return null;
  const peak = Math.max(7, ...weeks.map((w) => w.cleared));
  const lift = items.find((h) => h.id === 'workouts')?.lift;
  return (
    <View testID="journey" style={[styles.card, { gap: 16, paddingVertical: 20 }]}>
      <View style={{ gap: 4 }}>
        <View style={[styles.spread, { alignItems: 'baseline', rowGap: 0 }]}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={type.cardTitle}>
            How far you&apos;ve come
          </Text>
          {since && (
            <Text style={{ ...type.caption, color: palette.label2 }}>
              {`Since ${shortDate(since)}`}
            </Text>
          )}
        </View>
        {headline && (
          <Text testID="journey-headline" style={{ ...type.callout, fontSize: 16, lineHeight: 22 }}>
            {headline}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 18, columnGap: 14 }}>
        {items.map((h) => (
          <Cell key={h.id} item={h} plain={!!lift && h.id === 'workouts'} />
        ))}
      </View>
      {lift && (
        <View
          testID="journey-lift"
          accessible
          accessibilityLabel={`${lift.name}, the lift that grew most: ${lift.from} to ${lift.to} ${lift.unit}, up ${gain(lift)} ${lift.unit}.`}
          style={{
            gap: 4,
            borderTopWidth: 0.5,
            borderTopColor: palette.separator,
            paddingTop: 14,
          }}>
          <View style={[styles.spread, { alignItems: 'center', rowGap: 6 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 }}>
              <Text
                maxFontSizeMultiplier={1.5}
                style={{
                  ...fonts.figureHeavy,
                  fontSize: 22,
                  lineHeight: 28,
                  color: palette.label3,
                }}>
                {lift.from}
              </Text>
              <Text style={{ ...fonts.semibold, fontSize: 17, color: palette.label3 }}>→</Text>
              <Text
                maxFontSizeMultiplier={1.5}
                style={{
                  ...fonts.figureHeavy,
                  fontSize: 30,
                  lineHeight: 34,
                  color: palette.label,
                }}>
                {lift.to}
              </Text>
              <Text style={{ ...type.caption, color: palette.label2 }}>{lift.unit}</Text>
            </View>
            <View
              style={{
                borderRadius: radius.capsule,
                paddingHorizontal: 12,
                paddingVertical: 5,
                backgroundColor: palette.doneTint,
              }}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ ...fonts.figure, fontSize: 15, lineHeight: 20, color: palette.doneText }}>
                {`+${gain(lift)} ${lift.unit}`}
              </Text>
            </View>
          </View>
          <Text style={{ ...type.caption, color: palette.label2 }}>
            {`${lift.name}, the lift that grew most`}
          </Text>
        </View>
      )}
      {/* The bars wait for two weeks with a cleared day: one bar among empty ones says nothing. */}
      {weeks.filter((w) => w.cleared > 0).length > 1 && (
        <View
          testID="journey-weeks"
          accessible
          accessibilityLabel={`Cleared days by week: ${weeks
            .map(
              (w) =>
                `${w.current ? 'this week' : `week of ${displayDate(w.weekStart)}`} ${w.cleared}`,
            )
            .join(', ')}.`}
          style={{
            gap: 8,
            borderTopWidth: 0.5,
            borderTopColor: palette.separator,
            paddingTop: 14,
          }}>
          <Text style={{ ...type.meta, color: palette.label2 }}>Cleared days · last 6 weeks</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 64 }}>
            {weeks.map((w, i) => (
              <View key={w.weekStart} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Text style={{ ...fonts.figure, fontSize: 12, color: palette.label2 }}>
                  {w.cleared || ''}
                </Text>
                <Animated.View
                  entering={reduced ? undefined : FadeIn.delay(i * 60).duration(320)}
                  style={{
                    alignSelf: 'stretch',
                    height: Math.max(4, (w.cleared / peak) * 44),
                    borderRadius: 6,
                    backgroundColor: w.cleared ? palette.done : palette.fillStrong,
                    // This week is still being written: a lighter fill.
                    opacity: w.current ? 0.55 : 1,
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const gain = (lift: NonNullable<Highlight['lift']>) =>
  Math.round((lift.to - lift.from) * 100) / 100;

/**
 * One figure of the scoreboard: the number large, what it counts under it and a quiet detail.
 * Days cleared is in Fern, the done color; body weight is never judged either way, so it and the
 * rest stay in the text color.
 */
function Cell({ item, plain }: { item: Highlight; plain: boolean }) {
  // Workouts leave their lift to its own row below.
  const detail = plain ? null : item.detail;
  return (
    <View
      accessible
      accessibilityLabel={`${item.label}, ${item.value}${detail ? `. ${detail}` : ''}`}
      style={{ flexBasis: '44%', flexGrow: 1, gap: 2 }}>
      <Figure
        // Whole dollars read as a score: "$1,050", never "$1,050.00"; cents stay when there are any.
        value={item.value.replace(/^(\$[\d,]+)\.00$/, '$1')}
        color={item.id === 'cleared' ? palette.doneText : palette.label}
      />
      <Text style={{ ...type.caption, ...fonts.semibold, color: palette.label }}>{item.label}</Text>
      {detail && <Text style={{ ...type.footnote, color: palette.label2 }}>{detail}</Text>}
    </View>
  );
}

/** A little more than the advance of one SF Pro Rounded Heavy tabular figure, in em. */
const FIGURE_EM = 0.62;
const FIGURE_SCALE = 1.5;
const FIGURE_SIZE = 34;

/**
 * A headline figure that steps down to fit its cell, so a long amount is never cut to an ellipsis
 * (the browser preview has no `adjustsFontSizeToFit`), and wraps as a last resort.
 */
function Figure({ value, color }: { value: string; color: ColorValue }) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const scale = Math.min(fontScale || 1, FIGURE_SCALE);
  const fontSize = width
    ? Math.max(16, Math.min(FIGURE_SIZE, Math.floor(width / (value.length * FIGURE_EM * scale))))
    : FIGURE_SIZE;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text
        testID="journey-figure"
        maxFontSizeMultiplier={FIGURE_SCALE}
        style={{ ...type.figure, fontSize, lineHeight: Math.round(fontSize * 1.2), color }}>
        {value}
      </Text>
    </View>
  );
}
