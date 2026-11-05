import { ReactNode } from 'react';
import { ColorValue, Pressable, Text, View } from 'react-native';
import { DailyBias } from '../domain/trading';
import { useBusy } from '../state/app-state';
import { Tick } from './mission';
import { PressableScale } from './motion';
import { fonts, market, palette, radius, type } from './theme';

// The trading screens' shared parts: the cockpit's buttons, choices and panels, and the reference
// page's panels. Inside the cockpit a selection or a primary never takes Fern or Ember: Fern means
// done and Ember means now everywhere else in the app, and the bull green sits close to Fern.
// Selections are neutral (a ring with a check) and the primary is a solid capsule in the text color.

/** A trading surface's color, its deep tint and its edge. */
export type Look = { color: ColorValue; deep: ColorValue; edge: ColorValue };

/** The bias's look: green bullish, red bearish, slate while unclear or not set. */
export const BIAS_LOOK: Record<DailyBias | 'none', Look> = {
  bullish: { color: market.bull, deep: market.bullTint, edge: market.bullEdge },
  bearish: { color: market.bear, deep: market.bearTint, edge: market.bearEdge },
  unclear: { color: palette.label, deep: palette.fill, edge: palette.edge },
  none: { color: palette.label, deep: palette.fill, edge: palette.edge },
};

/** Study and GEX timing: the GEX blue. */
export const GEX_LOOK: Look = { color: market.gex, deep: market.gexTint, edge: market.gexEdge };

/** A short bold label or rule of a few words, in sentence case: it wraps, never breaks a word. */
export function Bold({
  text,
  color,
  size = 15,
  center = false,
}: {
  text: string;
  color: ColorValue;
  size?: number;
  center?: boolean;
}) {
  return (
    <Text
      style={{
        ...fonts.semibold,
        fontSize: size,
        lineHeight: Math.round(size * 1.3),
        textAlign: center ? 'center' : undefined,
        color,
      }}>
      {text}
    </Text>
  );
}

/** A colored panel: a block, a summary or a rule group. */
export function Panel({
  look,
  children,
  testID,
  alert = false,
}: {
  look: Look;
  children: ReactNode;
  testID?: string;
  /** Read out when it appears (a block, a stop). */
  alert?: boolean;
}) {
  return (
    <View
      testID={testID}
      accessibilityRole={alert ? 'alert' : undefined}
      style={{
        gap: 8,
        padding: 16,
        borderRadius: radius.tile,
        borderWidth: 1.5,
        borderColor: look.edge,
        backgroundColor: look.deep,
      }}>
      {children}
    </View>
  );
}

/**
 * The cockpit's primary: action-labelled, at least 56 pt, a capsule filled in the look's color
 * with page ink. Disabled, it is an outline (never a filled slab that reads as enabled) and says
 * what enables it (`needs`) right under it.
 */
export function CockpitButton({
  title,
  label,
  look,
  onPress,
  disabled = false,
  needs,
  testID,
}: {
  title: string;
  label?: string;
  look: Look;
  onPress: () => void;
  disabled?: boolean;
  needs?: string | null;
  testID?: string;
}) {
  const busy = useBusy();
  const inactive = disabled || busy;
  return (
    <View style={{ gap: 6 }}>
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label ?? title}
        accessibilityState={{ disabled: inactive }}
        aria-disabled={inactive}
        disabled={inactive}
        onPress={onPress}
        style={{
          minHeight: 56,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderRadius: radius.capsule,
          borderWidth: 1.5,
          borderColor: disabled ? palette.edge : look.color,
          backgroundColor: disabled ? 'transparent' : look.color,
          opacity: busy && !disabled ? 0.55 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Bold text={title} color={disabled ? palette.label3 : palette.canvas} size={17} center />
      </PressableScale>
      {disabled && !!needs && <Text style={type.caption}>{needs}</Text>}
    </View>
  );
}

/** A secondary cockpit action in the look's outline: an outcome, Change, Cancel. */
export function OutlineButton({
  title,
  label,
  look,
  onPress,
  disabled = false,
  testID,
}: {
  title: string;
  label?: string;
  look: Look;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const busy = useBusy();
  const inactive = disabled || busy;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: inactive }}
      aria-disabled={inactive}
      disabled={inactive}
      onPress={onPress}
      style={{
        minHeight: 52,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: radius.capsule,
        borderWidth: 1.5,
        borderColor: disabled ? palette.edge : look.edge,
        backgroundColor: 'transparent',
        opacity: busy && !disabled ? 0.55 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Bold text={title} color={disabled ? palette.label3 : look.color} size={16} center />
    </PressableScale>
  );
}

/** A failed thesis, a stop-out or an invalidation: unmistakable, never in a completed rule's color. */
export function StopButton({
  title,
  label,
  onPress,
}: {
  title: string;
  label?: string;
  onPress: () => void;
}) {
  const busy = useBusy();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: busy }}
      aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: radius.capsule,
        borderWidth: 1.5,
        borderColor: palette.danger,
        backgroundColor: pressed ? palette.dangerTint : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      })}>
      <Bold text={title} color={palette.danger} size={16} center />
    </Pressable>
  );
}

/**
 * One large choice of a radio group: at least 52 pt. Chosen, it takes the look's tint inside a
 * 2 pt ring in the look's color, so it never reads as the filled primary; `neutral` keeps the ring
 * in the text color on the card, for a choice that must never read as buy or sell.
 */
export function BigChoice({
  label,
  on,
  look,
  onPress,
  children,
  testID,
  minHeight = 64,
  neutral = false,
}: {
  label: string;
  on: boolean;
  look: Look;
  onPress: () => void;
  children: ReactNode;
  testID?: string;
  minHeight?: number;
  neutral?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight,
        paddingHorizontal: 6,
        paddingVertical: 8,
        borderRadius: radius.row,
        borderWidth: on ? 2 : 1.5,
        borderColor: on ? (neutral ? palette.label : look.color) : palette.edge,
        backgroundColor: on
          ? neutral
            ? palette.surface
            : look.deep
          : pressed
            ? palette.fill
            : palette.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      })}>
      {children}
    </Pressable>
  );
}

/**
 * A compact single choice in one row (5 minute / 15 minute, Daily / 4-day, Long / Short): radio
 * capsules at least 48 pt tall. The chosen one is a ring in the look's color with a check, so it
 * never looks like the filled primary. An option marked `blocked` is an outline with dim words
 * (`aria-disabled`) and calls `onBlocked` instead of being chosen.
 */
export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  look,
  onChange,
  onBlocked,
}: {
  label: string;
  options: { id: T; title: string; label?: string; blocked?: boolean }[];
  value: T | null;
  look: Look;
  onChange: (value: T) => void;
  onBlocked?: (value: T) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = o.id === value;
        const style = {
          flexGrow: 1,
          flexBasis: 90,
          minHeight: 48,
          paddingHorizontal: 10,
          borderRadius: radius.capsule,
          borderWidth: 2,
          borderColor: on ? look.color : o.blocked ? palette.edge : palette.fill,
          backgroundColor: o.blocked ? 'transparent' : on ? palette.surface : palette.fill,
          flexDirection: 'row' as const,
          gap: 6,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
        };
        const title = (
          <>
            {on && <Tick color={look.color} small />}
            <Bold
              text={o.title}
              color={o.blocked ? palette.label3 : palette.label}
              size={15}
              center
            />
          </>
        );
        // A blocked option is announced as dimmed and still answers a tap with why: a pressable
        // marked disabled would take no tap at all.
        return o.blocked ? (
          <View
            key={o.id}
            accessible
            accessibilityRole="radio"
            accessibilityLabel={o.label ?? o.title}
            accessibilityState={{ checked: on, disabled: true }}
            aria-checked={on}
            aria-disabled
            onStartShouldSetResponder={() => true}
            onResponderRelease={() => onBlocked?.(o.id)}
            style={style}>
            {title}
          </View>
        ) : (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityLabel={o.label ?? o.title}
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => onChange(o.id)}
            style={style}>
            {title}
          </Pressable>
        );
      })}
    </View>
  );
}
