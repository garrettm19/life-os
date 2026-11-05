import { Linking, Platform, Text, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { PressableScale } from './motion';
import { fonts, palette, type } from './theme';

export type InstructionLinks = { label: string; url: string }[];

/**
 * The trailing chevron that folds a row's details away until wanted: an objective's ordered steps
 * and links, or the study row's resources and reminder. Steps are reading material, not
 * checkboxes; the objective keeps one Done. The chevron is a fixed 44 × 44 button at the row's end,
 * so it never shares a line with the title, and VoiceOver hears what it holds ("Show 3 steps for
 * Get ready").
 */
export function FoldToggle({
  title,
  what,
  open,
  onPress,
  narrow = false,
}: {
  title: string;
  /** What opening shows: "3 steps", "2 links", "details". */
  what: string;
  open: boolean;
  onPress: () => void;
  /**
   * Below 375 pt the chevron takes a 32 pt column: its 44 pt target reaches back over the 12 pt gap
   * before it, which no other target uses.
   */
  narrow?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Hide' : 'Show'} ${what} for ${title}`}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={onPress}
      containerStyle={narrow ? { marginLeft: -12 } : undefined}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      {/* Drawn, not a glyph, so it looks the same in every font and at every text size. */}
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
    </PressableScale>
  );
}

/**
 * The opened instructions, under the row and aligned with its title. Each step hangs from its
 * number: the number keeps its own column and a wrapped line lines up with the step's first line.
 */
export function InstructionsBody({ steps, links }: { steps: string[]; links: InstructionLinks }) {
  const numberWidth = steps.length >= 10 ? 26 : 18;
  return (
    <View style={{ gap: 4 }}>
      {steps.map((step, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 4 }}>
          <Text
            style={{
              ...type.muted,
              minWidth: numberWidth,
              ...fonts.figure,
              color: palette.label3,
            }}>
            {i + 1}.
          </Text>
          <Text style={{ ...type.muted, flex: 1, color: palette.label }}>{step}</Text>
        </View>
      ))}
      {links.map((link, i) => (
        <PressableScale
          key={`${i}-${link.url}`}
          accessibilityRole="link"
          accessibilityLabel={`Open ${link.label}`}
          onPress={() =>
            void (
              Platform.OS === 'web' ? Linking.openURL(link.url) : openBrowserAsync(link.url)
            ).catch(() => {})
          }
          style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text style={{ ...fonts.semibold, fontSize: 14, color: palette.label }}>
            {link.label} ↗
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}
