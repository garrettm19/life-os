import { ColorValue, Text, View } from 'react-native';
import { fonts, palette } from './theme';

// The web's header and tab bar glyphs. expo-symbols draws a web fallback with a 966 KB icon font,
// which every page would download for these few glyphs, so the web uses text glyphs and its tabs
// show their labels alone.

/** The Settings gear: the text gear that iPhone uses as its fallback. */
export function SettingsIcon() {
  return <Text style={{ ...fonts.regular, fontSize: 19, color: palette.label }}>{'⚙︎'}</Text>;
}

/** Back, on a page opened over a tab. */
export function BackIcon() {
  return (
    <Text style={{ ...fonts.semibold, fontSize: 24, lineHeight: 28, color: palette.label }}>‹</Text>
  );
}

/** No symbol on the web: the tab's label carries it. */
export function TabIcon(_: { name: 'today' | 'week' | 'programs' | 'progress'; on: boolean }) {
  return null;
}

const MOMENT_GLYPHS = {
  lift: '▲',
  morning: '☀︎',
  up: '↑',
  down: '↓',
  done: '✓',
};

/** A moment's glyph on Day Cleared, in its tile's color. Decorative: the words say it. */
export function MomentIcon({
  name,
  color,
}: {
  name: keyof typeof MOMENT_GLYPHS;
  color: ColorValue;
}) {
  return (
    <Text aria-hidden style={{ ...fonts.bold, fontSize: 18, lineHeight: 22, color }}>
      {MOMENT_GLYPHS[name]}
    </Text>
  );
}

/**
 * The text glyphs that stand in for the list and tile symbols on the web. None borrows a market or
 * warning shape: Training is a diamond, not the bearish or warning triangle.
 */
const GLYPHS = {
  sunrise: '☀︎',
  dumbbell: '◆',
  run: '➚',
  briefcase: '▣',
  book: '✎',
  dollar: '$',
  chart: '↗',
  house: '⌂',
  heart: '♥︎',
  people: '●',
  sparkles: '✦',
  stack: '▤',
  check: '✓',
  timer: '◷',
  scale: '◒',
  rules: '☰',
  backup: '⇩',
  export: '⇪',
  widget: '▦',
  clock: '◷',
  target: '◎',
  doc: '❏',
  play: '▶︎',
  reset: '↺',
  plus: '+',
  close: '✕',
  // Drawn instead (below): the text glyph is small and sits under the baseline in most fonts.
  search: '',
  order: '⇅',
  scope: '◎',
  chevron: '›',
  wait: '◷',
  block: '⊘',
  stop: '✕',
  ready: '◇',
  position: '◉',
  flag: '⚑',
  pencil: '✎',
};

export type GlyphName = keyof typeof GLYPHS;

/** A list or tile glyph in `color`. Decorative: the words beside it say what it is. */
export function Glyph({
  name,
  color,
  size = 17,
}: {
  name: GlyphName;
  color: ColorValue;
  size?: number;
}) {
  if (name === 'search') return <SearchMark color={color} size={size} />;
  return (
    <Text
      aria-hidden
      style={{
        ...fonts.bold,
        fontSize: size,
        lineHeight: Math.round(size * 1.25),
        color,
        textAlign: 'center',
      }}>
      {GLYPHS[name]}
    </Text>
  );
}

/** A magnifier drawn as a ring and a handle, centered on the line like the text beside it. */
function SearchMark({ color, size }: { color: ColorValue; size: number }) {
  const ring = Math.round(size * 0.7);
  const stroke = Math.max(1.5, Math.round(size / 9));
  const handle = size * 0.38;
  // The handle leaves the ring at 45 degrees; it rotates about its own center.
  const out = (ring / 2) * (1 + Math.SQRT1_2) + (handle / 2) * Math.SQRT1_2;
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: out - handle / 2 - stroke / 4,
          top: out - stroke / 2 - stroke / 4,
          width: handle,
          height: stroke,
          borderRadius: stroke,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}
