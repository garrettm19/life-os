import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PressableScale } from './motion';
import { styles } from './components';
import { depth, fonts, palette, radius, type } from './theme';

// Compact controls: a segmented choice, a folded section and a quiet text action. Each keeps a
// 44 pt target. The quiet text action is defined with the page frame, which shows it beside the
// demo marker.
export { LinkButton } from './components';

/**
 * A compact single choice (graph, range, balance): one row of equal segments with 44pt targets.
 * Exposed as a radio group, each segment a radio with its state.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  /** Null when nothing is chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 3,
        borderRadius: radius.capsule,
        backgroundColor: palette.fill,
      }}>
      {options.map(([v, title]) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={title}
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => onChange(v)}
            style={[
              {
                flex: 1,
                minHeight: 44,
                paddingHorizontal: 4,
                borderRadius: radius.capsule,
                backgroundColor: on ? palette.raised : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              },
              // The shadow alone: a border would shift the chosen segment off the row.
              on && { boxShadow: depth.card.boxShadow },
            ]}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.4}
              style={{
                ...fonts.semibold,
                fontSize: 14,
                lineHeight: 19,
                color: on ? palette.label : palette.label2,
              }}>
              {title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A quiet folded section for detail that is useful but not part of the everyday view. */
export function Disclosure({
  title,
  summary,
  children,
  initiallyOpen = false,
  plain = false,
}: {
  title: string;
  /** A short note beside the title, e.g. a count. */
  summary?: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  /** Inside a card already: no frame of its own, only a divider above. */
  plain?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View
      style={
        plain
          ? {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.separator,
              marginHorizontal: -18,
            }
          : { borderRadius: radius.card, backgroundColor: palette.surface, ...depth.card }
      }>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}. ${open ? 'Hide' : 'Show'}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={{
          minHeight: 52,
          paddingHorizontal: 18,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
        {/* The summary goes under the title, so a long one never squeezes the title into a
            column of single words. */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.heading}>{title}</Text>
          {!!summary && <Text style={type.caption}>{summary}</Text>}
        </View>
        <Chevron open={open} />
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 18, paddingBottom: 18, gap: 12 }}>{children}</View>
      )}
    </View>
  );
}

/** A chevron drawn with two strokes: down while folded, up while open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <View
      style={{
        width: 9,
        height: 9,
        marginTop: open ? 4 : -4,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderColor: palette.label3,
        transform: [{ rotate: open ? '-135deg' : '45deg' }],
      }}
    />
  );
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const DAY_TARGET = 44;
const DAY_GAP = 6;

/** Seven across only when every cell keeps a 44pt target at normal text size; else rows of four. */
function weekdayColumns(width: number, fontScale: number): 4 | 7 {
  return width >= 7 * DAY_TARGET + 6 * DAY_GAP && fontScale <= 1.3 ? 7 : 4;
}

export function Weekdays({
  value,
  onChange,
}: {
  value: number[] | null;
  onChange: (days: number[]) => void;
}) {
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const columns = weekdayColumns(width, fontScale);
  // Until the row is measured, cells hold their minimum size and wrap.
  const cell = width ? (width - (columns - 1) * DAY_GAP) / columns : DAY_TARGET;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Days · tap to choose</Text>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: DAY_GAP }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => {
          const on = value?.includes(i) ?? false;
          return (
            <PressableScale
              key={d}
              accessibilityRole="checkbox"
              accessibilityLabel={WEEKDAY_NAMES[i]}
              aria-checked={on}
              onPress={() => onChange(on ? value!.filter((x) => x !== i) : [...(value ?? []), i])}
              containerStyle={{ width: cell }}
              style={{
                minHeight: DAY_TARGET,
                minWidth: DAY_TARGET,
                paddingVertical: 8,
                borderRadius: radius.capsule,
                // Chosen is a ring in the text color, as on every chip: never color alone.
                borderWidth: 2,
                borderColor: on ? palette.label : palette.fill,
                backgroundColor: on ? palette.surface : palette.fill,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
              <Text
                style={{
                  ...(on ? fonts.bold : fonts.medium),
                  fontSize: 15,
                  color: on ? palette.label : palette.label2,
                }}>
                {d}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
