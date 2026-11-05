import { forwardRef, ReactNode } from 'react';
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Calm motion: every movement follows a real change of state and settles once, nothing loops, and
// Reduce Motion keeps the final state without the movement.
export const motion = {
  enter: 220,
  press: 90,
  snap: { damping: 26, stiffness: 480, mass: 0.32 },
  /** A check filling, a segment, the tab pill: one soft spring, about 280 ms. */
  spring: { damping: 18, stiffness: 260 },
  ease: Easing.bezier(0.22, 1, 0.36, 1),
  pressScale: 0.97,
  /** A segment filling with Fern. */
  charge: 380,
  /** Delay between segments in a left-to-right sweep. */
  stagger: 45,
  /** The Day Cleared panel settling. */
  reveal: 520,
};

export const fadeUp = FadeInUp.duration(motion.enter).easing(motion.ease);

export function drive(sv: SharedValue<number>, next: number) {
  sv.set(next);
}

export const PressableScale = forwardRef<
  View,
  PressableProps & {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    containerStyle?: StyleProp<ViewStyle>;
  }
>(function PressableScale(
  { children, disabled, style, containerStyle, onPressIn, onPressOut, ...props },
  ref,
) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      style={containerStyle}
      onPressIn={(e) => {
        if (!reduced && !disabled) {
          drive(scale, withTiming(motion.pressScale, { duration: motion.press }) as never);
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        drive(
          scale,
          (reduced
            ? withTiming(1, { duration: motion.press })
            : withSpring(1, motion.snap)) as never,
        );
        onPressOut?.(e);
      }}
      {...props}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
});
