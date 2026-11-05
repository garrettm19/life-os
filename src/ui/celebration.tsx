import { Fragment, useEffect } from 'react';
import { ColorValue, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { DayProgress } from '../domain/objectives';
import { Moment, WeekDayMark } from '../domain/moments';
import { Button } from './components';
import { feelCleared } from './feel';
import { FullScreen } from './full-screen';
import { drive, motion } from './motion';
import { Seal } from './seal';
import { MomentIcon } from './settings-icon';
import { WeekStrip } from './week-strip';
import { depth, fonts, palette, radius, type, useWash } from './theme';

// The moment a day is cleared on screen: the seal closes, a sparse confetti
// falls once, the streak rolls up from the run held into the day, the week fills in, and what the
// records say was achieved fills the lower part. It plays once, only when the day turns cleared on
// this screen after a save; under Reduce Motion it shows the final state without the confetti, the
// seal's closing or the roll.

const COLORS = [
  palette.done,
  palette.doneEdge,
  palette.accentSoft,
  palette.chart,
  palette.chartAlt,
];
const PIECES = 30;

/** Deterministic scatter for the confetti, so the burst looks lively but never random in tests. */
function piece(i: number) {
  const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
  const round = i % 3 === 0;
  return {
    x: r(1),
    drift: (r(2) - 0.5) * 90,
    delay: r(3) * 420,
    fall: 1500 + r(4) * 700,
    spin: (r(5) - 0.5) * 540,
    w: round ? 7 : 5 + r(6) * 4,
    h: round ? 7 : 9 + r(7) * 6,
    round,
    color: COLORS[i % COLORS.length],
  };
}

function ConfettiPiece({ i, width, height }: { i: number; width: number; height: number }) {
  const p = piece(i);
  const t = useSharedValue(0);
  useEffect(() => {
    drive(
      t,
      withDelay(
        p.delay,
        withTiming(1, { duration: p.fall, easing: Easing.out(Easing.quad) }),
      ) as never,
    );
  }, [t, p.delay, p.fall]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.7 ? 0.9 : 0.9 * (1 - (t.value - 0.7) / 0.3),
    transform: [
      { translateX: p.drift * t.value },
      { translateY: -30 + height * 0.62 * t.value },
      { rotate: `${p.spin * t.value}deg` },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: p.x * width,
          width: p.w,
          height: p.h,
          borderRadius: p.round ? p.w / 2 : 2,
          backgroundColor: p.color,
        },
        style,
      ]}
    />
  );
}

function Confetti() {
  const { width, height } = useWindowDimensions();
  return (
    <View
      testID="confetti"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {Array.from({ length: PIECES }, (_, i) => (
        <ConfettiPiece key={i} i={i} width={width} height={height} />
      ))}
    </View>
  );
}

const FIGURE = { size: 48, line: 54 };

/**
 * The streak figure rolling from the run held into the day up to the run through it: the old number
 * slides up and out as the new one arrives. A run that starts today shows its 1 at once, so the
 * figure never starts from 0.
 */
function StreakRoll({ from, to, play }: { from: number; to: number; play: boolean }) {
  const roll = from > 0 && from !== to && play;
  const y = useSharedValue(roll ? 0 : 1);
  useEffect(() => {
    if (roll) drive(y, withDelay(650, withSpring(1, motion.spring)) as never);
  }, [roll, y]);
  const column = useAnimatedStyle(() => ({ transform: [{ translateY: -FIGURE.line * y.value }] }));
  const figure = {
    ...fonts.figureHeavy,
    fontSize: FIGURE.size,
    lineHeight: FIGURE.line,
    height: FIGURE.line,
    color: palette.doneText,
  };
  return (
    <View
      accessible
      accessibilityLabel={`Streak ${to} ${to === 1 ? 'day' : 'days'}`}
      style={{ height: FIGURE.line, overflow: 'hidden' }}>
      <Animated.View style={column}>
        <Text maxFontSizeMultiplier={1} style={figure}>
          {from > 0 ? from : to}
        </Text>
        <Text maxFontSizeMultiplier={1} style={figure}>
          {to}
        </Text>
      </Animated.View>
    </View>
  );
}

type Icon = 'lift' | 'morning' | 'up' | 'down' | 'done';

/** Which symbol and tint a moment wears: Ember for a morning, Fern for a result. */
function momentLook(m: Moment): { icon: Icon; tint: ColorValue; ink: ColorValue } {
  if (m.kind === 'morning')
    return { icon: 'morning', tint: palette.accentTint, ink: palette.accentText };
  return {
    icon: m.kind === 'lift' ? 'lift' : m.direction === 'down' ? 'down' : 'up',
    tint: palette.doneTint,
    ink: palette.doneText,
  };
}

/** One line of what the day achieved: a symbol in a tinted tile, the headline and its detail. */
function Achievement({
  icon,
  tint,
  ink,
  title,
  detail,
}: {
  icon: Icon;
  tint: ColorValue;
  ink: ColorValue;
  title: string;
  detail?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <MomentIcon name={icon} color={ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={{ ...type.item, ...fonts.semibold }}>{title}</Text>
        {!!detail && <Text style={type.caption}>{detail}</Text>}
      </View>
    </View>
  );
}

/** At most this many lines fill the lower part when the day has few moments. */
const LINES = 4;

export function Celebration({
  progress,
  streak,
  week,
  moments,
  done,
  dateLabel,
  close,
}: {
  progress: DayProgress;
  streak: { before: number; after: number; bestBefore: number };
  week: WeekDayMark[];
  moments: Moment[];
  /** The titles of the required objectives done today (the ones `progress.done` counts), in order. */
  done: string[];
  /** "Monday, November 9". */
  dateLabel: string;
  close: () => void;
}) {
  const reduced = useReducedMotion();
  useEffect(() => {
    // A beat after the tap's own light haptic, so the two read as one tap, then the success.
    const timer = setTimeout(feelCleared, 220);
    return () => clearTimeout(timer);
  }, []);
  const enter = (delay: number) =>
    reduced ? undefined : FadeInDown.delay(delay).duration(motion.reveal).easing(motion.ease);
  const best = Math.max(streak.after, streak.bestBefore);
  const newBest = streak.after > streak.bestBefore && streak.bestBefore > 0;
  // What the figure grew from, said once: never a count from zero.
  const growth =
    streak.before > 0
      ? `Up from ${streak.before}`
      : streak.after === 1
        ? 'A new run starts today'
        : null;
  const wash = useWash(
    (c) => `radial-gradient(circle at 50% 18%, ${c.washMint} 0%, ${c.canvas} 60%)`,
    'canvas',
  );
  // When the records hold few moments, what was done fills the lower part instead.
  const doneShown = moments.length < 2 ? done.slice(0, Math.max(0, LINES - moments.length)) : [];
  const more = moments.length < 2 ? done.length - doneShown.length : 0;
  const rows = [
    ...moments.map((m) => ({ key: m.id, ...momentLook(m), title: m.title, detail: m.detail })),
    ...doneShown.map((title, i) => ({
      key: `done:${i}`,
      icon: 'done' as const,
      tint: palette.doneTint,
      ink: palette.doneText,
      title,
      detail: undefined,
    })),
  ];
  return (
    <FullScreen close={close} animated={!reduced}>
      <View testID="celebration" style={[{ flex: 1 }, wash]}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingHorizontal: 22,
            paddingTop: 28,
            paddingBottom: 24,
            gap: 20,
          }}>
          <View style={{ gap: 18 }}>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Seal play={!reduced} />
              <Animated.View entering={enter(120)} style={{ alignItems: 'center', gap: 4 }}>
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.5}
                  style={{ ...type.hero, textAlign: 'center' }}>
                  Day cleared
                </Text>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    ...type.callout,
                    ...fonts.regular,
                    color: palette.label2,
                    textAlign: 'center',
                  }}>
                  {progress.done > 1 ? 'All ' : ''}
                  <Text style={{ ...fonts.figureHeavy, color: palette.label }}>
                    {progress.done}
                  </Text>{' '}
                  done · {dateLabel}
                </Text>
              </Animated.View>
            </View>

            <Animated.View
              entering={enter(260)}
              style={[
                {
                  backgroundColor: palette.surface,
                  borderRadius: radius.card,
                  paddingHorizontal: 18,
                  paddingTop: 14,
                  paddingBottom: 16,
                  gap: 12,
                },
                depth.card,
              ]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <StreakRoll from={streak.before} to={streak.after} play={!reduced} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ ...type.heading, fontSize: 18 }}>
                    {streak.after === 1 ? 'day in a row' : 'days in a row'}
                  </Text>
                  {growth && (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ ...type.caption, ...fonts.semibold, color: palette.doneText }}>
                      {growth}
                    </Text>
                  )}
                </View>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    ...fonts.semibold,
                    fontSize: 15,
                    lineHeight: 20,
                    textAlign: 'right',
                    flexShrink: 1,
                    color: newBest ? palette.accentText : palette.label2,
                  }}>
                  {newBest ? 'Your best run yet' : 'Best '}
                  {!newBest && <Text style={fonts.figure}>{best}</Text>}
                </Text>
              </View>
              <WeekStrip days={week} size={32} />
            </Animated.View>

            {rows.length > 0 && (
              <Animated.View
                entering={enter(400)}
                style={[
                  {
                    backgroundColor: palette.surface,
                    borderRadius: radius.card,
                    paddingHorizontal: 16,
                    paddingVertical: 4,
                  },
                  depth.card,
                ]}>
                {rows.map((row, i) => (
                  <Fragment key={row.key}>
                    {i > 0 && (
                      <View
                        style={{
                          height: StyleSheet.hairlineWidth,
                          backgroundColor: palette.separator,
                          marginLeft: 54,
                          marginRight: -16,
                        }}
                      />
                    )}
                    <Achievement {...row} />
                  </Fragment>
                ))}
                {more > 0 && (
                  <Text style={{ ...type.caption, paddingLeft: 54, paddingBottom: 10 }}>
                    and {more} more
                  </Text>
                )}
              </Animated.View>
            )}
          </View>

          <Animated.View entering={enter(540)}>
            <Button title="Done" label="Close the celebration" onPress={close} />
          </Animated.View>
        </ScrollView>
        {!reduced && <Confetti />}
      </View>
    </FullScreen>
  );
}
