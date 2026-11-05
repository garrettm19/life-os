import { useEffect } from 'react';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state/app-state';
import { ErrorAnnouncer, NavTabs, styles } from '../ui/components';
import { fonts, palette, radius } from '../ui/theme';
import { ReminderSync } from '../ui/reminder-sync';

// The splash stays up until the first frame is ready to draw. The type is the system's own, so
// there is nothing to load first.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const fade = {
  animation: 'fade' as const,
  animationDuration: 220,
};

// Replaces the whole tree, outside AppProvider, so it uses plain controls. It never shows the
// error text, which could contain details from the plan.
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.canvas,
        justifyContent: 'center',
        padding: 24,
        gap: 12,
      }}>
      <Text accessibilityRole="header" style={styles.title}>
        Something went wrong
      </Text>
      <Text style={styles.body}>
        Life OS hit an unexpected problem showing this screen. Changes that finished saving are
        kept.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry().catch(() => {})}
        style={{
          alignSelf: 'flex-start',
          minHeight: 50,
          justifyContent: 'center',
          paddingHorizontal: 22,
          borderRadius: radius.capsule,
          backgroundColor: palette.label,
        }}>
        <Text style={{ ...fonts.semibold, fontSize: 17, color: palette.onLabel }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="auto" />
          <ErrorAnnouncer />
          <ReminderSync />
          <View style={{ flex: 1, backgroundColor: palette.canvas }}>
            <Stack
              screenOptions={{
                headerShown: false,
                ...fade,
                contentStyle: { backgroundColor: palette.canvas },
              }}>
              <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="backup" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="export" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="trading" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="bias-board" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="strategy" options={{ animation: 'slide_from_right' }} />
            </Stack>
            <NavTabs />
          </View>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
