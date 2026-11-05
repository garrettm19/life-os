import { Children, Fragment, ReactNode, isValidElement } from 'react';
import { ColorValue, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from 'react-native-reanimated';
import { useBusy } from '../state/app-state';
import { motion, PressableScale } from './motion';
import { Glyph, GlyphName } from './settings-icon';
import { depth, fonts, palette, radius, type } from './theme';

// Inset grouped lists, as in iOS Settings: one card holds a section's rows, hairlines between them
// inset to the text, a short heading above the card and a caption under it. Settings, Backup,
// Export, the objective types and the empty Today are built from these.

/** The tones of a symbol tile: the program areas, and Ember or Fern where they mean now or done. */
export type Tone = 'sun' | 'sky' | 'plum' | 'rose' | 'slate' | 'accent' | 'done';

const TONES: Record<Tone, { tint: ColorValue; ink: ColorValue }> = {
  sun: { tint: palette.areaSunTint, ink: palette.areaSun },
  sky: { tint: palette.areaSkyTint, ink: palette.areaSky },
  plum: { tint: palette.areaPlumTint, ink: palette.areaPlum },
  rose: { tint: palette.areaRoseTint, ink: palette.areaRose },
  slate: { tint: palette.areaSlateTint, ink: palette.areaSlate },
  accent: { tint: palette.accentTint, ink: palette.accentText },
  done: { tint: palette.doneTint, ink: palette.doneText },
};

/** A symbol in a tinted rounded tile. Decorative: the row or card it leads is named in words. */
export function IconTile({
  name,
  tone = 'slate',
  size = 32,
}: {
  name: GlyphName;
  tone?: Tone;
  size?: number;
}) {
  const { tint, ink } = TONES[tone];
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Glyph name={name} color={ink} size={Math.round(size * 0.5)} />
    </View>
  );
}

/**
 * One section of an inset grouped list: an optional heading, the card of rows with hairlines
 * between them, and an optional caption under the card.
 */
export function Group({
  title,
  footer,
  children,
  testID,
  icons = false,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  testID?: string;
  /** The rows lead with a symbol tile: the hairlines start at the text, past the tile. */
  icons?: boolean;
}) {
  // Rows that render nothing (a condition left false) take no place and no separator.
  const rows = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View testID={testID} style={{ gap: 8 }}>
      {title !== undefined && (
        <Text accessibilityRole="header" style={groupTitle}>
          {title}
        </Text>
      )}
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: radius.card,
          overflow: 'hidden',
          ...depth.card,
        }}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={[separator, icons && { marginLeft: 64 }]} />}
            {row}
          </Fragment>
        ))}
      </View>
      {typeof footer === 'string' ? <Text style={groupFooter}>{footer}</Text> : footer}
    </View>
  );
}

/** Text or content inside a group, padded like a row: a paragraph, a form, a list of lines. */
export function GroupBody({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: 18, paddingVertical: 14, gap: 12 }}>{children}</View>;
}

/**
 * A row that opens something: an optional symbol tile, its title, a detail line under it, a value
 * at the trailing edge and a chevron. The whole row is the 44 pt (here 56 pt) target.
 */
export function Row({
  title,
  detail,
  value,
  icon,
  tone,
  onPress,
  label,
  chevron = true,
  role = 'button',
}: {
  title: string;
  detail?: string;
  /** A short value at the trailing edge, e.g. a count. */
  value?: string;
  icon?: GlyphName;
  tone?: Tone;
  onPress: () => void;
  /** The spoken name, when it says more than the title. */
  label?: string;
  chevron?: boolean;
  role?: 'button' | 'link';
}) {
  const busy = useBusy();
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: busy }}
      aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      style={rowStyle}>
      {icon && <IconTile name={icon} tone={tone} />}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={type.item}>{title}</Text>
        {!!detail && <Text style={type.caption}>{detail}</Text>}
      </View>
      {!!value && (
        <Text style={[type.caption, fonts.figure, { color: palette.label3 }]}>{value}</Text>
      )}
      {chevron && <Glyph name="chevron" color={palette.label3} size={15} />}
    </PressableScale>
  );
}

/**
 * An on/off setting: its name, what the current state means under it, and a switch at the trailing
 * edge. Exposed as a switch with its state, so VoiceOver reads "on" or "off"; the words under the
 * name change with it, so the state never rests on the knob's position alone.
 */
export function Toggle({
  title,
  detail,
  label,
  value,
  onChange,
  inset = false,
}: {
  title: string;
  /** What the current state means, e.g. "Stays off the Home Screen widget". */
  detail?: string;
  /** The spoken name, when it says more than the title. */
  label?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  /** Inside a group: padded like its other rows. */
  inset?: boolean;
}) {
  const busy = useBusy();
  return (
    <PressableScale
      accessibilityRole="switch"
      accessibilityLabel={label ?? title}
      accessibilityState={{ checked: value, disabled: busy }}
      aria-checked={value}
      aria-disabled={busy}
      disabled={busy}
      onPress={() => onChange(!value)}
      style={[
        { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
        inset && { paddingHorizontal: 18 },
      ]}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={type.item}>{title}</Text>
        {!!detail && <Text style={type.caption}>{detail}</Text>}
      </View>
      <Switch on={value} />
    </PressableScale>
  );
}

const TRACK = { width: 51, height: 31, knob: 27 };

/** The drawn switch: a `checkEdge` track when off, a `label` track when on, the knob sliding. */
function Switch({ on }: { on: boolean }) {
  // Reduce Motion: the knob is where it ends, with no slide.
  const reduced = useReducedMotion();
  const knob = useAnimatedStyle(() => {
    const x = on ? TRACK.width - TRACK.knob - 4 : 0;
    return { transform: [{ translateX: reduced ? x : (withSpring(x, motion.spring) as number) }] };
  });
  return (
    <View
      style={{
        width: TRACK.width,
        height: TRACK.height,
        borderRadius: radius.capsule,
        padding: 2,
        backgroundColor: on ? palette.label : palette.checkEdge,
        justifyContent: 'center',
      }}>
      <Animated.View
        style={[
          {
            width: TRACK.knob,
            height: TRACK.knob,
            borderRadius: radius.capsule,
            backgroundColor: on ? palette.onLabel : palette.knob,
            boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 4, color: '#0000002E' }],
          },
          knob,
        ]}
      />
    </View>
  );
}

const rowStyle = {
  minHeight: 56,
  paddingHorizontal: 18,
  paddingVertical: 10,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
} as const;

const separator = {
  height: StyleSheet.hairlineWidth,
  backgroundColor: palette.separator,
  marginLeft: 18,
};

const groupTitle = {
  ...fonts.semibold,
  fontSize: 15,
  lineHeight: 20,
  color: palette.label2,
  paddingHorizontal: 4,
};

const groupFooter = { ...type.footnote, paddingHorizontal: 4 };

/** A search capsule: the magnifier, then the text. Its label is spoken, and shown as placeholder. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: radius.capsule,
        backgroundColor: palette.fill,
      }}>
      <Glyph name="search" color={palette.label3} size={17} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? label}
        placeholderTextColor={palette.label3}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        selectionColor={palette.accent}
        style={{ flex: 1, minHeight: 44, ...fonts.regular, fontSize: 17, color: palette.label }}
      />
    </View>
  );
}

/**
 * One choice of a radio group drawn as a list row: a symbol tile, the name, what it means, and a
 * check at the trailing edge when chosen. The group around it carries the radiogroup role.
 */
export function ChoiceRow({
  title,
  detail,
  icon,
  tone,
  on,
  onPress,
}: {
  title: string;
  detail?: string;
  icon?: GlyphName;
  tone?: Tone;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      onPress={onPress}
      style={rowStyle}>
      {icon && <IconTile name={icon} tone={tone} size={36} />}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={type.item}>{title}</Text>
        {!!detail && <Text style={type.caption}>{detail}</Text>}
      </View>
      <View style={{ width: 22, alignItems: 'center' }}>
        {on && <Glyph name="check" color={palette.label} size={20} />}
      </View>
    </PressableScale>
  );
}
