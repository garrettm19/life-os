import { Text, View } from 'react-native';
import { LinkButton, styles } from './components';
import { PressableScale } from './motion';
import { Glyph } from './settings-icon';
import { palette, radius, type } from './theme';

/**
 * Dates whose Finish yesterday line was closed. Kept for this run of the app only, never saved: it
 * survives switching tabs and backgrounding, and a cold launch offers the line again while
 * yesterday can still be finished.
 */
const dismissed = new Set<string>();

export function finishDismissed(date: string): boolean {
  return dismissed.has(date);
}

export function dismissFinish(date: string): void {
  dismissed.add(date);
}

/**
 * One quiet line under Today's hero while yesterday can still be finished: "Yesterday · 2 still
 * open", with Finish yesterday to open that day, where ticks and Skip work as on Today, and an x
 * that hides the line for that date. Ticking yesterday is honest: the streak is read from the days,
 * so a cleared yesterday keeps the run with no other step.
 */
export function FinishYesterday({
  remaining,
  onOpen,
  onDismiss,
}: {
  remaining: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <View
      testID="finish-yesterday"
      style={[
        styles.spread,
        {
          backgroundColor: palette.surface,
          borderRadius: radius.card,
          paddingLeft: 16,
          paddingRight: 4,
          columnGap: 8,
          rowGap: 0,
          flexWrap: 'wrap',
        },
      ]}>
      <Text style={{ ...type.meta, color: palette.label2, flexGrow: 1, flexShrink: 1 }}>
        Yesterday · {remaining} still open
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <LinkButton
          title="Finish yesterday ›"
          label={`Finish yesterday: ${remaining} still open`}
          onPress={onOpen}
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Hide Finish yesterday"
          onPress={onDismiss}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name="close" color={palette.label3} size={12} />
        </PressableScale>
      </View>
    </View>
  );
}
