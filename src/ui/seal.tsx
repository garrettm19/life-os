import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { drive, motion } from './motion';
import { glow, palette } from './theme';

// The Day Cleared seal: a Fern disc with a tick inside a ring of six arcs. Drawn with Views only (no
// SVG): each arc is a ring clipped to a sector by two half-plane masks, with round caps.

const SEGMENTS = 6;
const GAP = 12;

/** One arc of the ring, from `start` degrees clockwise from the top, `sweep` degrees long. */
function Arc({
  size,
  width,
  start,
  sweep,
}: {
  size: number;
  width: number;
  start: number;
  sweep: number;
}) {
  const half = size / 2;
  const r = half - width / 2;
  const cap = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return {
      position: 'absolute' as const,
      left: half + r * Math.sin(a) - width / 2,
      top: half - r * Math.cos(a) - width / 2,
      width,
      height: width,
      borderRadius: width / 2,
      backgroundColor: palette.done,
    };
  };
  return (
    <View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        transform: [{ rotate: `${start}deg` }],
      }}>
      {/* The right half of the circle… */}
      <View
        style={{
          position: 'absolute',
          left: half,
          top: 0,
          width: half,
          height: size,
          overflow: 'hidden',
        }}>
        {/* …meets the left half turned by the sweep: their overlap is the arc. */}
        <View
          style={{
            position: 'absolute',
            left: -half,
            top: 0,
            width: size,
            height: size,
            transform: [{ rotate: `${sweep}deg` }],
          }}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: half,
              height: size,
              overflow: 'hidden',
            }}>
            <View
              style={{
                width: size,
                height: size,
                borderRadius: half,
                borderWidth: width,
                borderColor: palette.done,
              }}
            />
          </View>
        </View>
      </View>
      <View style={cap(0)} />
      <View style={cap(sweep)} />
    </View>
  );
}

/**
 * The seal at the top of Day Cleared. When `play`, the six arcs close in turn over about 600 ms and
 * the disc settles from 0.92; otherwise (Reduce Motion) it is drawn whole. Decorative: the heading
 * under it says Day cleared.
 */
export function Seal({ size = 148, play }: { size?: number; play: boolean }) {
  const ring = Math.round(size * 0.065);
  const disc = Math.round(size * 0.68);
  const settle = useSharedValue(play ? 0.92 : 1);
  useEffect(() => {
    if (play) drive(settle, withDelay(560, withSpring(1, motion.spring)) as never);
  }, [play, settle]);
  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));
  const sweep = 360 / SEGMENTS - GAP;
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <Animated.View
          key={i}
          entering={play ? FadeIn.delay(80 + i * 90).duration(220) : undefined}
          style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
          <Arc size={size} width={ring} start={i * (360 / SEGMENTS) + GAP / 2} sweep={sweep} />
        </Animated.View>
      ))}
      <Animated.View
        style={[
          {
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            backgroundColor: palette.done,
            alignItems: 'center',
            justifyContent: 'center',
          },
          glow(palette.doneEdge, 36),
          discStyle,
        ]}>
        {/* The tick, drawn with two strokes. */}
        <View
          style={{
            width: disc * 0.24,
            height: disc * 0.46,
            marginTop: -disc * 0.1,
            borderRightWidth: disc * 0.09,
            borderBottomWidth: disc * 0.09,
            borderColor: palette.onDone,
            borderBottomRightRadius: disc * 0.03,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </Animated.View>
    </View>
  );
}
