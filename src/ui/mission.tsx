import { ReactNode, useEffect, useRef } from 'react';
import { ColorValue, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSave } from '../state/app-state';
import Animated, {
  FadeInUp,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { feelDone } from './feel';
import { usePendingPress } from './pending-press';
import { drive, motion, PressableScale } from './motion';
import { SegmentState } from './segments';
import { glows, palette, radius, type, useWash } from './theme';

// The day's progress marks: the segments, the count, the round check, and the Day Cleared panel.

function Segment({
  state,
  index,
  sweep,
  height,
}: {
  state: SegmentState;
  index: number;
  sweep: boolean;
  height: number;
}) {
  const reduced = useReducedMotion();
  const on = state === 'done';
  // Segments open settled; only a live Day Cleared reveal sweeps them in.
  const fill = useSharedValue(on && (reduced || !sweep) ? 1 : 0);
  const mounted = useRef(false);
  useEffect(() => {
    if (reduced) {
      drive(fill, on ? 1 : 0);
      return;
    }
    const charge = withSpring(on ? 1 : 0, motion.spring);
    if (!mounted.current) {
      mounted.current = true;
      if (on && sweep) drive(fill, withDelay(index * motion.stagger, charge) as never);
      return;
    }
    drive(fill, charge as never);
  }, [on, index, reduced, sweep, fill]);
  // A segment fills from the left, the way the day goes.
  const charged = useAnimatedStyle(() => ({
    opacity: Math.min(1, fill.value * 2),
    transform: [{ scaleX: Math.max(0, fill.value) }],
  }));
  return (
    <View
      style={{
        flex: 1,
        height,
        borderRadius: radius.segment,
        backgroundColor: state === 'active' ? palette.accent : palette.fillStrong,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius.segment,
            backgroundColor: palette.done,
            transformOrigin: 'left',
          },
          charged,
        ]}
      />
    </View>
  );
}

/** One continuous bar: long days on the board, and the thin bar pinned under Today's header. */
function ChargeBar({ ratio, height }: { ratio: number; height: number }) {
  const reduced = useReducedMotion();
  const fill = useSharedValue(ratio);
  useEffect(() => {
    drive(
      fill,
      (reduced
        ? ratio
        : withTiming(ratio, { duration: motion.charge * 1.5, easing: motion.ease })) as never,
    );
  }, [ratio, reduced, fill]);
  const width = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  return (
    <View
      testID="charge-bar"
      style={{
        height,
        borderRadius: radius.segment,
        backgroundColor: palette.fillStrong,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius.segment,
            backgroundColor: palette.done,
            transformOrigin: 'left',
          },
          width,
        ]}
      />
    </View>
  );
}

export function Segments({
  states,
  ratio,
  cleared = false,
  sweep = false,
  thin = false,
  compact = false,
}: {
  /** One entry per objective, or null for a continuous bar. */
  states: SegmentState[] | null;
  ratio: number;
  cleared?: boolean;
  /** Fill the done segments left to right on mount (the Day Cleared reveal only). */
  sweep?: boolean;
  /** The 4 pt continuous bar pinned under Today's header, instead of 8 pt. */
  thin?: boolean;
  /** The compact board's 6 pt bar, so the list starts higher. */
  compact?: boolean;
}) {
  const height = thin ? 4 : compact ? 6 : 8;
  // Kept in the signature: the cleared board passes it, and every segment is Fern by then anyway.
  void cleared;
  if (!states) return <ChargeBar ratio={ratio} height={height} />;
  if (!states.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: states.length > 12 ? 3 : 5 }}>
      {states.map((state, index) => (
        <Segment key={index} state={state} index={index} sweep={sweep} height={height} />
      ))}
    </View>
  );
}

/**
 * 4/7: the done count rolls up when it changes, not when the board first appears. `compact` is the
 * smaller count on Today's one-line board.
 */
export function Count({
  done,
  total,
  compact = false,
}: {
  done: number;
  total: number;
  compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const size = compact ? { ...type.count, fontSize: 20, lineHeight: 24 } : type.count;
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', overflow: 'hidden' }}>
        <Animated.Text
          key={done}
          entering={reduced ? undefined : FadeInUp.duration(motion.enter).easing(motion.ease)}
          maxFontSizeMultiplier={1.6}
          style={size}>
          {done}
        </Animated.Text>
        {/* The placeholder tone reads only as large text: at the compact 20 pt the total needs
            label3's 4.5:1. */}
        <Text
          maxFontSizeMultiplier={1.6}
          style={[size, { color: compact ? palette.label3 : palette.placeholder }]}>
          /{total}
        </Text>
      </View>
    </LayoutAnimationConfig>
  );
}

/** The check mark, drawn with two strokes so it needs no font. `small` sits inside a chip. */
export function Tick({ color, small = false }: { color: ColorValue; small?: boolean }) {
  const [w, h, stroke] = small ? [5, 10, 2] : [7, 13, 2.5];
  return (
    <View
      style={{
        width: w,
        height: h,
        marginTop: small ? -2 : -3,
        borderRightWidth: stroke,
        borderBottomWidth: stroke,
        borderColor: color,
        borderBottomRightRadius: 1,
        transform: [{ rotate: '45deg' }],
      }}
    />
  );
}

export type CheckTone = 'open' | 'active';

/** The visible check: a 30 pt circle inside the 44 pt target. */
const CHECK = 30;

/**
 * The round objective check. Ticking fills it with Fern on a spring and the tick draws in; the
 * change only arrives after the save succeeds, so it never celebrates unsaved work. While a press's
 * save is pending (`onPress` returned its promise) the check shows a Fern ring on its tint with no
 * tick and says it is busy: the tap is seen at once, and only the saved change fills it.
 */
export function CheckSquare({
  status,
  tone = 'open',
  label,
  onPress,
  tappedAt = 0,
  pending: pendingProp = false,
}: {
  status: 'planned' | 'done' | 'skipped';
  tone?: CheckTone;
  label: string;
  /** Return the save's promise to show the pending look until it settles. */
  onPress: () => unknown;
  /** When the row around this check was tapped to tick it: that tap's save gets the haptic too. */
  tappedAt?: number;
  /** A save started from the row around this check is pending. */
  pending?: boolean;
}) {
  const { isSaving } = useSave();
  const own = usePendingPress(status);
  const pending = pendingProp || own.pending;
  const reduced = useReducedMotion();
  const fill = useSharedValue(1);
  const tick = useSharedValue(1);
  const previous = useRef(status);
  // When this check was last tapped: a save that lands within a few seconds is that tap's. Saves
  // run in order, so other checks stay tappable; only this one ignores a second tap while its own
  // save is still pending, so a double tap never ticks and unticks, and a failed save can retry.
  const pressed = useRef(0);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    const tapped = Date.now() - Math.max(pressed.current, tappedAt) < 5000;
    pressed.current = 0;
    if (was === status || status !== 'done') return;
    // Felt only for this check's own tap once its save lands (not for a change made elsewhere, like
    // a restore), and even under Reduce Motion: it is touch feedback, not motion.
    if (tapped) feelDone();
    if (reduced) return;
    drive(
      fill,
      withSequence(withTiming(0.55, { duration: 0 }), withSpring(1, motion.spring)) as never,
    );
    drive(
      tick,
      withSequence(
        withTiming(0, { duration: 0 }),
        withDelay(80, withTiming(1, { duration: 160, easing: motion.ease })),
      ) as never,
    );
  }, [status, reduced, fill, tick, tappedAt]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scale: fill.value }] }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: 0.6 + 0.4 * tick.value }],
  }));
  const done = status === 'done';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: pending }}
      aria-busy={pending}
      onPress={() => {
        if (pending || (isSaving() && Date.now() - pressed.current < 5000)) return;
        pressed.current = Date.now();
        own.run(onPress);
      }}
      containerStyle={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      style={[
        {
          width: CHECK,
          height: CHECK,
          borderRadius: radius.check,
          alignItems: 'center',
          justifyContent: 'center',
          // Done fills solid Fern with a tick, the same check as the Today list widget.
          backgroundColor: pending ? palette.doneTint : done ? palette.done : 'transparent',
          borderWidth: done && !pending ? 0 : 2,
          // An open circle is what makes undone work visible, so its edge keeps 3:1 everywhere.
          borderColor: pending
            ? palette.done
            : status !== 'skipped' && tone === 'active'
              ? palette.accent
              : palette.checkEdge,
          borderStyle: status === 'skipped' && !pending ? 'dashed' : 'solid',
        },
        fillStyle as ViewStyle,
      ]}>
      {done && !pending && (
        <Animated.View testID="check-tick" style={tickStyle}>
          <Tick color={palette.onDone} />
        </Animated.View>
      )}
      {status === 'skipped' && !pending && (
        <View style={{ width: 12, height: 2, borderRadius: 1, backgroundColor: palette.label3 }} />
      )}
    </PressableScale>
  );
}

/**
 * The Day Cleared panel on a mint wash. When the day was just cleared it settles in once and the
 * segments sweep Fern left to right; opened later, it appears settled. Nothing loops.
 */
export function ClearedFrame({ children, animate }: { children: ReactNode; animate: boolean }) {
  const reduced = useReducedMotion();
  const play = animate && !reduced;
  const enter = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play) drive(enter, withSpring(1, motion.spring) as never);
  }, [play, enter]);
  const panel = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value),
    transform: [{ scale: 0.96 + 0.04 * enter.value }],
  }));
  const wash = useWash(
    (c) => `radial-gradient(ellipse at top, ${c.washMint} 0%, ${c.surface} 75%)`,
    'surface',
  );
  return (
    <Animated.View
      style={[
        {
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: palette.doneEdge,
          paddingTop: 24,
          paddingBottom: 20,
          paddingHorizontal: 18,
          alignItems: 'center',
          gap: 14,
          overflow: 'hidden',
        },
        wash,
        glows.panel,
        panel,
      ]}>
      {children}
    </Animated.View>
  );
}

/**
 * "Day cleared" in rounded Fern; it rises in just after the panel. `left` is the smaller headline of
 * Today's hero card.
 */
export function ClearedTitle({
  children,
  animate,
  align = 'center',
}: {
  children: string;
  animate: boolean;
  align?: 'center' | 'left';
}) {
  const reduced = useReducedMotion();
  const play = animate && !reduced;
  const rise = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (play)
      drive(
        rise,
        withDelay(90, withTiming(1, { duration: motion.reveal, easing: motion.ease })) as never,
      );
  }, [play, rise]);
  const style = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: 8 * (1 - rise.value) }],
  }));
  return (
    <Animated.Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.5}
      style={[
        {
          ...type.hero,
          fontSize: align === 'left' ? 30 : 40,
          lineHeight: align === 'left' ? 36 : 46,
          color: palette.doneText,
          textAlign: align,
        },
        style,
      ]}>
      {children}
    </Animated.Text>
  );
}

/**
 * The Ember ground under the objective in progress, with a fine Ember edge and a soft glow, set 6 pt
 * inside its list card so the corners are concentric. It does not pulse.
 */
export function ActiveFrame({ children }: { children: ReactNode }) {
  return (
    <View
      style={[
        {
          backgroundColor: palette.accentTint,
          borderRadius: radius.row,
          borderWidth: 1,
          borderColor: palette.accentEdge,
          marginHorizontal: -8,
          paddingHorizontal: 7,
          marginVertical: 2,
        },
        glows.active,
      ]}>
      {children}
    </View>
  );
}
