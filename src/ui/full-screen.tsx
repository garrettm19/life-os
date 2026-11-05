import { ReactNode } from 'react';
import { Modal, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './components';
import { palette, type } from './theme';

/**
 * A full-screen modal (the circuit timer, the study session) that keeps its content inside the
 * device's safe area.
 *
 * A native Modal is presented in its own view hierarchy, so the app's root SafeAreaProvider is not
 * one of its native ancestors. A SafeAreaView inside it would find no provider, fall back to its
 * own insets (zero before the modal is on screen) and never be told when they change, leaving the
 * content at the very top with Close under the status bar and the Dynamic Island. The provider's
 * documentation asks for a SafeAreaProvider at the root of each modal; this is that provider.
 * Nothing here is a fixed offset for one phone.
 */
export function FullScreen({
  close,
  children,
  overlay,
  animated = true,
}: {
  close: () => void;
  children: ReactNode;
  /** False under Reduce Motion: the screen appears without the fade. */
  animated?: boolean;
  /** Presented above the screen from inside this modal, e.g. an editor sheet. */
  overlay?: ReactNode;
}) {
  return (
    <Modal
      visible
      animationType={animated ? 'fade' : 'none'}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={close}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: palette.canvas }}>
        <SafeAreaView
          testID="full-screen"
          edges={['top', 'bottom', 'left', 'right']}
          style={{ flex: 1, backgroundColor: palette.canvas }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            {children}
          </View>
        </SafeAreaView>
        {overlay}
      </SafeAreaProvider>
    </Modal>
  );
}

/**
 * The header of a full-screen view: a small line and a title that wraps, with Close fixed at the
 * top right as a full 44 pt target. Kept outside the scrolling content so Close never scrolls away.
 */
export function ScreenHeader({
  title,
  sub,
  close,
  closeLabel,
}: {
  title: string;
  sub: string;
  close: () => void;
  closeLabel: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 4,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.callout, color: palette.label2 }}>{sub}</Text>
        {/* Sentence case and at most three lines, so a long name never fills the screen; the full
            name is still the heading VoiceOver reads. */}
        <Text
          accessibilityRole="header"
          accessibilityLabel={title}
          numberOfLines={3}
          maxFontSizeMultiplier={1.3}
          style={type.sheetTitle}>
          {title}
        </Text>
      </View>
      <Button secondary small title="Close" label={closeLabel} onPress={close} />
    </View>
  );
}
