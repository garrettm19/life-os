import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ColorValue,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Href, Link, router, usePathname } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useApp, useBusy } from '../state/app-state';
import { replaceAllState } from '../state/session-store';
import { sessionStore } from '../data/timer-store';
import { localDate } from '../domain/model';
import { startTracking } from '../domain/start-tracking';
import { announce, useAnnouncement } from './announce';
import { drive, fadeUp, motion, PressableScale } from './motion';
import { Tick } from './mission';
import { BackIcon, Glyph, SettingsIcon, TabIcon } from './settings-icon';
import { depth, fonts, palette, radius, type } from './theme';

export { fonts, palette, type } from './theme';

export const styles = StyleSheet.create({
  // Wrapping rows center their lines too: by default a wrapped line packs to the top, which leaves
  // text stuck to the top edge of taller rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    // Larger text sizes wrap the trailing item instead of pushing it off screen.
    flexWrap: 'wrap',
    alignContent: 'center',
  },
  /** A card: white or warm charcoal, 24 pt corners, a soft shadow in light and no hairline. */
  card: {
    padding: 18,
    backgroundColor: palette.surface,
    borderRadius: radius.card,
    gap: 12,
    ...depth.card,
  },
  title: type.title,
  heading: type.heading,
  body: type.body,
  muted: type.muted,
  label: type.meta,
  input: {
    borderWidth: 1,
    borderColor: palette.edge,
    borderRadius: radius.control,
    backgroundColor: palette.canvas,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...fonts.regular,
    fontSize: 17,
    color: palette.label,
    minHeight: 50,
  },
  /**
   * A panel inside a sheet: the page's color under the sheet's card color, 20 pt corners and no
   * shadow, so a sheet never holds a card that floats.
   */
  panel: {
    padding: 16,
    backgroundColor: palette.canvas,
    borderRadius: radius.tile,
    gap: 10,
  },
  /** A panel that asks for attention: a choice to make, or what a change would do. */
  notice: {
    padding: 16,
    backgroundColor: palette.accentTint,
    borderRadius: radius.tile,
    gap: 8,
  },
  section: { gap: 10, marginTop: 6 },
  alert: { ...fonts.semibold, fontSize: 15, lineHeight: 20, color: palette.danger },
});

/**
 * A button's three looks: solid, tonal and quiet; disabled is always the outline. An on/off setting
 * is a `Toggle` (src/ui/list.tsx), never a button.
 */
function buttonLook(
  kind: 'primary' | 'secondary' | 'quiet',
  disabled: boolean,
): { fill: ColorValue; edge: ColorValue; ink: ColorValue } {
  // Disabled reads as not available: an outline with dim ink, never a filled slab.
  if (disabled) return { fill: 'transparent', edge: palette.edge, ink: palette.label3 };
  if (kind === 'primary') return { fill: palette.label, edge: palette.label, ink: palette.onLabel };
  if (kind === 'secondary') return { fill: palette.fill, edge: palette.fill, ink: palette.label };
  return { fill: 'transparent', edge: 'transparent', ink: palette.label2 };
}

export function Button({
  title,
  onPress,
  secondary = false,
  quiet = false,
  disabled = false,
  small = false,
  label,
  needs,
}: {
  title: string;
  onPress: () => void;
  /** The tonal capsule: a choice beside the primary, or one of several equal actions. */
  secondary?: boolean;
  /** Text only, for an action that should not compete: Skip, Undo, Show as list. */
  quiet?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Spoken name when the visible title alone is ambiguous, e.g. which objective a Done acts on. */
  label?: string;
  /**
   * What enables the button, shown as one caption under it while it is disabled; empty while
   * nothing the user can change holds it back.
   */
  needs?: string;
}) {
  const busy = useBusy();
  const inactive = disabled || busy;
  const look = buttonLook(quiet ? 'quiet' : secondary ? 'secondary' : 'primary', disabled);
  const button = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: inactive }}
      aria-disabled={inactive}
      disabled={inactive}
      onPress={onPress}
      style={{
        backgroundColor: look.fill,
        borderWidth: 1.5,
        borderColor: look.edge,
        borderRadius: radius.capsule,
        paddingHorizontal: small ? 16 : 22,
        paddingVertical: small ? 10 : 13,
        minHeight: small ? 44 : 50,
        minWidth: 44,
        justifyContent: 'center',
        // A save in progress dims every action for its moment; a disabled one keeps its outline.
        opacity: busy && !disabled ? 0.55 : 1,
      }}>
      <Text
        style={{
          ...fonts.semibold,
          color: look.ink,
          fontSize: small ? 15 : 17,
          lineHeight: small ? 20 : 22,
          textAlign: 'center',
        }}>
        {title}
      </Text>
    </PressableScale>
  );
  if (needs === undefined) return button;
  // Always wrapped, so the button keeps its place in the tree when the caption comes and goes.
  return (
    <View style={{ gap: 6 }}>
      {button}
      {disabled && !!needs && <Text style={type.caption}>{needs}</Text>}
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  numeric = false,
  time = false,
  name = false,
  multiline = false,
  wrap = false,
  decimal = false,
  large = false,
  hint,
  maxLength,
  tint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  /** 24-hour HH:MM entry: the iOS keyboard needs the colon. */
  time?: boolean;
  /** A title the user reads back later, so it starts with a capital. */
  name?: boolean;
  multiline?: boolean;
  /**
   * One line of text shown wrapped, so it can be read back in full: Return finishes it, and a
   * pasted line break becomes a space.
   */
  wrap?: boolean;
  /** Numbers with a decimal point: weights, loads and money. */
  decimal?: boolean;
  /** A measurement entered on its own: a big tabular number. */
  large?: boolean;
  /** A line under the field, e.g. the previous value. */
  hint?: ReactNode;
  /** The most characters the field takes. */
  maxLength?: number;
  /** The focus edge and the selection, where Ember would read as now (the trading cockpit). */
  tint?: ColorValue;
}) {
  const [focused, setFocused] = useState(false);
  // A wrapped line grows to show all of itself: iOS sizes a multiline input to its text, while a
  // web textarea keeps its height and scrolls, so there it takes the content height it reports
  // (plus the border).
  const [grown, setGrown] = useState(0);
  const grow = wrap && Platform.OS === 'web';
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        maxLength={maxLength}
        onChangeText={wrap ? (v) => onChange(v.replace(/[\r\n]+/g, ' ')) : onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={
          decimal
            ? 'decimal-pad'
            : numeric
              ? 'number-pad'
              : time
                ? 'numbers-and-punctuation'
                : 'default'
        }
        autoCapitalize={name ? 'sentences' : 'none'}
        multiline={multiline || wrap}
        // Return ends a wrapped line on iOS (`submitBehavior`) and on the web (`blurOnSubmit`).
        submitBehavior={wrap ? 'blurAndSubmit' : undefined}
        blurOnSubmit={wrap || undefined}
        onSubmitEditing={wrap ? () => {} : undefined}
        returnKeyType={wrap ? 'done' : undefined}
        onContentSizeChange={
          grow ? (e) => setGrown(Math.ceil(e.nativeEvent.contentSize.height) + 2) : undefined
        }
        selectionColor={tint ?? palette.accent}
        style={[
          styles.input,
          large && { ...fonts.figure, fontSize: 30, minHeight: 64 },
          focused && { borderColor: tint ?? palette.accent, borderWidth: 1.5 },
          multiline && { minHeight: 100, textAlignVertical: 'top' },
          wrap && { minHeight: 72, textAlignVertical: 'top' },
          grow && grown > 72 && { height: grown },
        ]}
      />
      {/* A plain-text hint needs its own Text: native refuses a bare string inside a View. */}
      {typeof hint === 'string' ? <Text style={type.caption}>{hint}</Text> : hint}
    </View>
  );
}

/**
 * A quiet text action (secondary to a card's main one) with a full 44pt target. Never Fern: Fern
 * means done, so an action that has not happened reads in plain text.
 */
export function LinkButton({
  title,
  label,
  onPress,
  tone = 'text',
  expanded,
}: {
  title: string;
  label?: string;
  onPress: () => void;
  /**
   * `pill`: a small tonal capsule with a chevron, for a detail editor under a row (a workout plan,
   * a circuit, rules); the 44 pt target stays around it.
   */
  tone?: 'text' | 'dim' | 'pill';
  /** For a link that shows or hides something below it. */
  expanded?: boolean;
}) {
  const busy = useBusy();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: busy, expanded }}
      aria-disabled={busy}
      aria-expanded={expanded}
      disabled={busy}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      {tone === 'pill' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            minHeight: 32,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: radius.capsule,
            backgroundColor: palette.fill,
          }}>
          <Text style={{ ...fonts.semibold, fontSize: 14, lineHeight: 19, color: palette.label }}>
            {title}
          </Text>
          <Glyph name="chevron" color={palette.label3} size={12} />
        </View>
      ) : (
        <Text
          style={{
            ...type.caption,
            ...fonts.semibold,
            fontSize: 15,
            lineHeight: 20,
            color: tone === 'text' ? palette.label : palette.label2,
          }}>
          {title}
        </Text>
      )}
    </PressableScale>
  );
}

/** A small word tag in a quiet capsule, e.g. the demo marker under a page title. */
function Tag({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        ...type.tag,
        backgroundColor: palette.fill,
        borderRadius: radius.capsule,
        paddingVertical: 4,
        paddingHorizontal: 9,
        alignSelf: 'flex-start',
        overflow: 'hidden',
      }}>
      {children}
    </Text>
  );
}

const TABS = [
  { href: '/' as const, title: 'Today', icon: 'today' as const },
  { href: '/week' as const, title: 'Week', icon: 'week' as const },
  { href: '/programs' as const, title: 'Programs', icon: 'programs' as const },
  { href: '/review' as const, title: 'Progress', icon: 'progress' as const },
];

/**
 * The tab bar: a floating capsule of glass over the page's foot, with an Ember pill under the
 * selected tab. It sits below the content rather than over it, so nothing scrolls under it.
 */
export function NavTabs() {
  const path = usePathname();
  // Settings, Backup and Export are pages on top of a tab: no tab reads as selected there.
  const selected = TABS.findIndex((l) => path === l.href);
  const width = useSharedValue(0);
  const index = useSharedValue(Math.max(0, selected));
  useEffect(() => {
    if (selected < 0) return;
    drive(index, withSpring(selected, motion.spring) as never);
  }, [selected, index]);
  // The pill slides under the selected tab; it is hidden until the bar has a width (the web
  // prerender has none) and on pages that are not a tab.
  const pill = useAnimatedStyle(() => ({
    width: width.value / TABS.length,
    transform: [{ translateX: (index.value * width.value) / TABS.length }],
    opacity: width.value && selected >= 0 ? 1 : 0,
  }));
  // The trading cockpit is a working screen: it takes the whole height, and Back leaves it, so I
  // FEEL RUSHED never shares the bottom edge with the tabs.
  if (path === '/trading') return null;
  return (
    <SafeAreaView
      testID="tab-bar"
      edges={['bottom']}
      style={{ backgroundColor: palette.canvas, paddingHorizontal: 16, paddingTop: 2 }}>
      <View
        style={{
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
          marginBottom: 6,
          padding: 3,
          borderRadius: radius.capsule,
          backgroundColor: palette.glass,
          ...depth.float,
        }}>
        <View
          onLayout={(e) => drive(width, e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row' }}>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                borderRadius: radius.capsule,
                backgroundColor: palette.accentTint,
              },
              pill,
            ]}
          />
          {TABS.map((l, i) => {
            const on = i === selected;
            return (
              // A tab is a destination, not a history entry: go back to it if it is already in the
              // stack, otherwise replace the current screen, so tab taps never pile up copies.
              <Link
                key={l.href}
                href={l.href}
                dismissTo
                asChild
                accessibilityLabel={l.title}
                style={{ flex: 1 }}>
                <Pressable
                  accessibilityRole="link"
                  accessibilityState={{ selected: on }}
                  aria-current={on ? 'page' : undefined}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    paddingVertical: 5,
                    paddingHorizontal: 2,
                    minHeight: 46,
                  }}>
                  <TabIcon name={l.icon} on={on} />
                  {/* Four labels share the width: they shrink rather than run into each other. */}
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    maxFontSizeMultiplier={1.3}
                    style={{
                      // One weight for every tab, so the selected label fits as the idle one does;
                      // selection shows in its color and the pill under it.
                      ...fonts.semibold,
                      color: on ? palette.accentText : palette.label2,
                      fontSize: 12,
                      lineHeight: 16,
                    }}>
                    {l.title}
                  </Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

/** Rendered once at the root: stacked pages stay mounted, so each must not repeat the message. */
export function ErrorAnnouncer() {
  const { error } = useApp();
  // A failed save or load is spoken, not only shown, so a VoiceOver user knows nothing changed.
  useAnnouncement(error);
  return null;
}

/** A round header control: Back or Settings, a 44 pt circle on the page. */
const ROUND = {
  width: 44,
  height: 44,
  borderRadius: radius.capsule,
  backgroundColor: palette.surface,
  alignItems: 'center',
  justifyContent: 'center',
  ...depth.card,
} as const;

/** Leaves a page opened on top of a tab (Settings, Backup, Export). */
function BackButton({ fallback = '/' }: { fallback?: Href }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      style={ROUND}>
      <BackIcon />
    </PressableScale>
  );
}

function SettingsLink() {
  return (
    <Link href="/settings" asChild>
      <PressableScale accessibilityRole="link" accessibilityLabel="Settings" style={ROUND}>
        <SettingsIcon />
      </PressableScale>
    </Link>
  );
}

/** Brings a span of the page's content (`y`, `height`) into view, scrolling as little as needed. */
const PageReveal = createContext<((y: number, height: number) => void) | null>(null);

/**
 * Content that comes into view when `when` changes, as the next step after a tap: the trading
 * cockpit's entry and stop once the setup is confirmed. Never on opening the page. It must sit
 * directly in the page's content.
 */
export function Reveal({ when, children }: { when: string; children: ReactNode }) {
  const reveal = useContext(PageReveal);
  const [shown, setShown] = useState(when);
  return (
    <View
      style={{ gap: 16 }}
      onLayout={(e) => {
        if (when === shown) return;
        setShown(when);
        reveal?.(e.nativeEvent.layout.y, e.nativeEvent.layout.height);
      }}>
      {children}
    </View>
  );
}

export function Page({
  title,
  subtitle,
  top,
  accessory,
  children,
  hideError = false,
  back = false,
  titleLabel,
  pinned,
  onScroll,
  header,
  footer,
  keyboardInsets = false,
  scrollKey,
  compact = false,
  fit = false,
  wash,
}: {
  /** A long title (Today's greeting) steps down a size on a narrow phone, so it stays one line. */
  fit?: boolean;
  title: string;
  /** A soft wash behind the header and the top of the content: Today's sunrise. Decoration only. */
  wash?: ViewStyle;
  /** What VoiceOver reads for the title, when it says more than the title shows (Today's date). */
  titleLabel?: string;
  /**
   * A thin line held at the header's foot, inside its padding, so showing or hiding it never moves
   * the page: Today's progress bar once the board has scrolled away.
   */
  pinned?: ReactNode;
  /** The content's scroll offset, as it changes. */
  onScroll?: (y: number) => void;
  /**
   * Held under the title, outside the scrolling content, once saved data has loaded (never in the
   * static prerender): the trading cockpit's directional header.
   */
  header?: ReactNode;
  /**
   * Pinned under the scrolling content, once saved data has loaded (in a `PageFooter`): the
   * trading cockpit's one primary action, always on screen. It stays above the keyboard on iOS.
   */
  footer?: ReactNode;
  /** The content makes room for the keyboard, so a focused field is scrolled into view (iOS). */
  keyboardInsets?: boolean;
  /** A new value starts the content at the top again: a new step on the trading cockpit. */
  scrollKey?: string;
  /**
   * A smaller title, for a working screen where the content needs the height (the trading
   * cockpit): its status and tiles stay on the first screen on the smallest phones.
   */
  compact?: boolean;
  /** Small tracked line above the title; leave it out when the title says enough. */
  subtitle?: string;
  /** Replaces the subtitle line, e.g. Trading's date or Today's Back to today on another day. */
  top?: ReactNode;
  /** A control beside the title, before Settings; shown once saved data has loaded. */
  accessory?: ReactNode;
  children: ReactNode;
  hideError?: boolean;
  /**
   * A page on top of a tab: shows Back instead of Settings. A route is where Back goes when there
   * is nothing to go back to (the page was reloaded or opened directly); Today otherwise.
   */
  back?: boolean | Href;
}) {
  const { ready, error, clearError, retry, state } = useApp();
  const [startOpen, setStartOpen] = useState(false);
  // Once the page scrolls, a hairline marks where the header ends and content passes under it.
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const narrow = useWindowDimensions().width < 375;
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (scrollKey !== undefined) scroller.current?.scrollTo({ y: 0, animated: false });
  }, [scrollKey]);
  const offset = useRef(0);
  const viewport = useRef(0);
  const reveal = useCallback((y: number, height: number) => {
    const top = offset.current;
    const bottom = top + viewport.current;
    if (!viewport.current || (y >= top && y + height <= bottom)) return;
    const to = y + height > bottom ? Math.min(y - 8, y + height - viewport.current + 8) : y - 8;
    scroller.current?.scrollTo({ y: Math.max(0, to), animated: false });
  }, []);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: palette.canvas }}>
      {wash && (
        <View
          pointerEvents="none"
          aria-hidden
          style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }, wash]}
        />
      )}
      <View
        testID="page-header"
        style={{
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 10,
          gap: 4,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: scrolled ? palette.separator : 'transparent',
        }}>
        {/* Until saved data loads, the static web render and the first client render must match. */}
        {ready && top ? top : !!subtitle && <Text style={pageSubtitle}>{subtitle}</Text>}
        <View style={[styles.spread, { flexWrap: 'nowrap', alignItems: 'center' }]}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={titleLabel}
            maxFontSizeMultiplier={1.3}
            style={[
              styles.title,
              ready && fit && narrow && fitTitle,
              compact && compactTitle,
              { flex: 1 },
            ]}>
            {title}
          </Text>
          {ready && accessory}
          {back ? <BackButton fallback={back === true ? undefined : back} /> : <SettingsLink />}
        </View>
        {state.source === 'demo' && (
          <View style={[styles.row, { columnGap: 12, rowGap: 0 }]}>
            <Tag>DEMO · fictional person and records</Tag>
            <LinkButton
              title="Start tracking"
              label="Start tracking with the demo programs"
              tone="pill"
              onPress={() => setStartOpen(true)}
            />
          </View>
        )}
        {error && !hideError && !startOpen && (
          <View
            accessibilityRole="alert"
            style={[styles.card, { borderWidth: 1, borderColor: palette.danger }]}>
            <Text style={styles.alert}>{error}</Text>
            <Button
              secondary
              title={ready ? 'Dismiss' : 'Retry loading'}
              onPress={ready ? clearError : retry}
            />
          </View>
        )}
        {!ready && (
          <View style={[styles.card, { alignItems: 'flex-start' }]}>
            <ActivityIndicator color={palette.accent} />
            <Text style={styles.muted}>Opening your saved plan…</Text>
          </View>
        )}
        {ready && header}
        {ready && pinned && (
          <View style={{ position: 'absolute', left: 20, right: 20, bottom: 2 }}>{pinned}</View>
        )}
      </View>
      {ready && (
        <KeyboardAvoidingView
          enabled={!!footer && Platform.OS === 'ios'}
          behavior="padding"
          style={{ flex: 1 }}>
          <ScrollView
            ref={scroller}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={keyboardInsets}
            scrollEventThrottle={32}
            onLayout={(e) => {
              viewport.current = e.nativeEvent.layout.height;
            }}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              offset.current = y;
              if (y > 0 !== scrolled) setScrolled(y > 0);
              onScroll?.(y);
            }}
            contentContainerStyle={{
              width: '100%',
              maxWidth: 720,
              alignSelf: 'center',
              paddingHorizontal: 20,
              // With the header's own bottom padding, the first content starts where it always did.
              paddingTop: 3,
              paddingBottom: 40,
              gap: 16,
            }}>
            <PageReveal.Provider value={reveal}>{children}</PageReveal.Provider>
          </ScrollView>
          {footer}
        </KeyboardAvoidingView>
      )}
      <StartTrackingSheet
        visible={startOpen && state.source === 'demo'}
        close={() => setStartOpen(false)}
        onStarted={() => {
          announce(TRACKING_STARTED);
          // Today is where the fresh plan starts; any other screen still holds the demo's view.
          if (pathname !== '/') router.dismissTo('/');
        }}
      />
    </SafeAreaView>
  );
}

/** The bar a page's `footer` sits in: under the content, the width of the page. */
export function PageFooter({ children }: { children: ReactNode }) {
  return (
    <View
      testID="page-footer"
      style={{
        width: '100%',
        maxWidth: 720,
        alignSelf: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 10,
        gap: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.separator,
        backgroundColor: palette.canvas,
      }}>
      {children}
    </View>
  );
}

export const TRACKING_STARTED = 'Tracking started. Today starts fresh with these programs.';

/**
 * Confirms Start tracking: the demo's programs become this device's own plan and its fictional
 * history is cleared (`src/domain/start-tracking.ts`). A whole-state replacement, so in-progress
 * circuits, study sessions and the trading session from the demo are cleared too.
 */
export function StartTrackingSheet({
  visible,
  close,
  onStarted,
}: {
  visible: boolean;
  close: () => void;
  onStarted?: () => void;
}) {
  const { change } = useApp();
  const start = () => {
    const now = new Date();
    void replaceAllState(
      (current) => startTracking(current, localDate(now), now.toISOString()),
      change,
      sessionStore,
    ).then((ok) => {
      if (!ok) return;
      close();
      onStarted?.();
    });
  };
  return (
    <Sheet title="Start tracking with these programs?" visible={visible} close={close}>
      <Text style={styles.body}>
        This keeps the programs, goals, workouts, circuit and trading rules, and clears the
        demo&apos;s six weeks of fictional history. Today starts fresh, with no records or streaks
        yet.
      </Text>
      <Text style={styles.muted}>
        Everything stays editable in Programs. Closing changes nothing.
      </Text>
      <Button title="Start tracking" onPress={start} />
    </Sheet>
  );
}

export function Sheet({
  title,
  visible,
  close,
  children,
  page,
  footer,
}: {
  title: string;
  visible: boolean;
  close: () => void;
  children: ReactNode;
  /**
   * Which step a multi-step sheet shows. A new step starts scrolled to the top, so its title and
   * Close are never left above the screen by the previous step's scroll position.
   */
  page?: string;
  /** Pinned under the scrolling content, e.g. a long form's Save and its error: always on screen. */
  footer?: ReactNode;
}) {
  if (!visible) return null;
  // A native modal is its own view hierarchy: it needs its own provider for real safe-area insets.
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={close}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: 'transparent' }}>
        <SheetFrame title={title} close={close} page={page} footer={footer}>
          {children}
        </SheetFrame>
      </SafeAreaProvider>
    </Modal>
  );
}

/** The sheet itself, inside its modal's provider: never under the status bar or home indicator. */
function SheetFrame({
  title,
  close,
  children,
  page,
  footer,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  page?: string;
  footer?: ReactNode;
}) {
  const { error } = useApp();
  const insets = useSafeAreaInsets();
  const bottom = 20 + Math.max(insets.bottom, 16);
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top + 8 }}>
      {/* A tap on the backdrop closes the sheet. It is hidden from VoiceOver and never takes
          focus (a responder view, not a button), so the first focus lands in the sheet and not on
          a full-screen close; Close and the VoiceOver escape gesture are the accessible ways out. */}
      <View
        testID="sheet-backdrop"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onStartShouldSetResponder={() => true}
        onResponderRelease={close}
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]}
      />
      {/* The cap lives here, inside a full-screen parent, so a percentage resolves; the panel
            shrinks to fit (above the keyboard too) and its content scrolls instead of overflowing. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ width: '100%', maxWidth: 650, alignSelf: 'center', maxHeight: '92%' }}>
        <Animated.View
          entering={fadeUp}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={{
            backgroundColor: palette.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            flexShrink: 1,
            borderWidth: 0.5,
            borderBottomWidth: 0,
            borderColor: palette.cardEdge,
          }}>
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 5,
              borderRadius: radius.capsule,
              backgroundColor: palette.fillStrong,
              marginTop: 8,
            }}
          />
          <ScrollView
            key={page}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 20,
              paddingBottom: footer ? 20 : bottom,
              gap: 14,
            }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.4}
                style={{ ...type.sheetTitle, paddingTop: 7, flex: 1 }}>
                {title}
              </Text>
              <CloseButton close={close} />
            </View>
            {error && !footer && (
              <Text accessibilityRole="alert" style={styles.alert}>
                {error}
              </Text>
            )}
            {children}
          </ScrollView>
          {footer && (
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: bottom,
                gap: 10,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: palette.separator,
              }}>
              {/* A failed save shows by the button that made it, not above the scrolled form. */}
              {error && (
                <Text accessibilityRole="alert" style={styles.alert}>
                  {error}
                </Text>
              )}
              {footer}
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A sheet's way out: a small round x in a 44 pt target, named Close. */
function CloseButton({ close }: { close: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={close}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.capsule,
          backgroundColor: palette.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Glyph name="close" color={palette.label2} size={14} />
      </View>
    </PressableScale>
  );
}

/** A selectable choice: one of a radio group, or one of several checkboxes. */
export function Chip({
  title,
  on,
  role,
  onPress,
}: {
  title: string;
  on: boolean;
  role: 'radio' | 'checkbox';
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityLabel={title}
      aria-checked={on}
      onPress={onPress}
      style={[chipStyle(on), { paddingHorizontal: 16 }]}>
      {on && <Tick color={palette.label} small />}
      <Text style={{ ...fonts.semibold, fontSize: 15, lineHeight: 20, color: palette.label }}>
        {title}
      </Text>
    </PressableScale>
  );
}

/**
 * A choice's capsule. Chosen is a 2 pt ring in the text color with a check beside the words, so a
 * chosen chip never looks like the filled primary and never relies on color alone.
 */
export function chipStyle(on: boolean): ViewStyle {
  return {
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: radius.capsule,
    borderWidth: 2,
    borderColor: on ? palette.label : palette.fill,
    backgroundColor: on ? palette.surface : palette.fill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  };
}

/**
 * A section heading with an optional count, e.g. "Daily essentials 2/4". The title is a heading,
 * so VoiceOver's headings rotor moves between sections.
 */
export function SectionLabel({
  title,
  count,
  label,
}: {
  title: string;
  count?: string;
  label?: string;
}) {
  return (
    <View style={[styles.spread, { paddingHorizontal: 4 }]}>
      <Text accessibilityRole="header" style={sectionTitle}>
        {title}
      </Text>
      {count !== undefined && (
        <Text accessibilityLabel={label} style={[sectionTitle, fonts.figure]}>
          {count}
        </Text>
      )}
    </View>
  );
}

const sectionTitle: TextStyle = {
  ...fonts.semibold,
  fontSize: 15,
  lineHeight: 20,
  color: palette.label2,
};

const compactTitle: TextStyle = { fontSize: 24, lineHeight: 30 };
const fitTitle: TextStyle = { fontSize: 27, lineHeight: 33 };

/** The line over a page title: a date, or where the page sits. */
const pageSubtitle: TextStyle = {
  ...fonts.semibold,
  fontSize: 15,
  lineHeight: 20,
  color: palette.label2,
};
