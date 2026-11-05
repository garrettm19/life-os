import { ColorValue, Text } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { fonts, palette } from './theme';

// The header and tab bar glyphs: SF Symbols, with text glyphs where symbols are unavailable. The
// web build has its own versions (settings-icon.web.tsx).

/** The Settings gear. */
export function SettingsIcon() {
  return (
    <SymbolView
      name="gearshape"
      size={20}
      tintColor={palette.label}
      fallback={<Text style={{ ...fonts.regular, fontSize: 19, color: palette.label }}>{'⚙︎'}</Text>}
    />
  );
}

/** Back, on a page opened over a tab. */
export function BackIcon() {
  return (
    <SymbolView
      name="chevron.backward"
      size={18}
      weight="semibold"
      tintColor={palette.label}
      fallback={<Text style={{ ...fonts.semibold, fontSize: 22, color: palette.label }}>‹</Text>}
    />
  );
}

const TAB_SYMBOLS: Record<'today' | 'week' | 'programs' | 'progress', SFSymbol> = {
  today: 'sun.max',
  week: 'calendar',
  programs: 'square.stack',
  progress: 'chart.line.uptrend.xyaxis',
};

/** A tab's symbol, Ember when selected. Decorative: the tab's label is its name. */
export function TabIcon({ name, on }: { name: keyof typeof TAB_SYMBOLS; on: boolean }) {
  return (
    <SymbolView
      name={TAB_SYMBOLS[name]}
      size={22}
      weight={on ? 'semibold' : 'regular'}
      tintColor={on ? palette.accent : palette.label2}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const MOMENT_SYMBOLS: Record<'lift' | 'morning' | 'up' | 'down' | 'done', SFSymbol> = {
  lift: 'dumbbell.fill',
  morning: 'sunrise.fill',
  up: 'arrow.up',
  down: 'arrow.down',
  done: 'checkmark',
};

const MOMENT_GLYPHS: Record<keyof typeof MOMENT_SYMBOLS, string> = {
  lift: '▲',
  morning: '☀︎',
  up: '↑',
  down: '↓',
  done: '✓',
};

/** A moment's symbol on Day Cleared, in its tile's color. Decorative: the words say it. */
export function MomentIcon({
  name,
  color,
}: {
  name: keyof typeof MOMENT_SYMBOLS;
  color: ColorValue;
}) {
  return (
    <SymbolView
      name={MOMENT_SYMBOLS[name]}
      size={20}
      weight="semibold"
      tintColor={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
      fallback={<Text style={{ ...fonts.bold, fontSize: 18, color }}>{MOMENT_GLYPHS[name]}</Text>}
    />
  );
}

/**
 * The symbols of lists and tiles (Programs, Settings, the objective types, the empty Today), with
 * the text glyph each shows where symbols are unavailable (the web).
 */
export const GLYPHS = {
  sunrise: ['sunrise.fill', '☀︎'],
  dumbbell: ['dumbbell.fill', '▲'],
  run: ['figure.run', '➚'],
  briefcase: ['briefcase.fill', '■'],
  book: ['book.fill', '✎'],
  dollar: ['dollarsign', '$'],
  chart: ['chart.line.uptrend.xyaxis', '↗'],
  house: ['house.fill', '⌂'],
  heart: ['heart.fill', '♥︎'],
  people: ['person.2.fill', '●'],
  sparkles: ['sparkles', '✦'],
  stack: ['square.stack.fill', '▤'],
  check: ['checkmark.circle.fill', '✓'],
  timer: ['timer', '◷'],
  scale: ['scalemass.fill', '◒'],
  rules: ['list.bullet.clipboard.fill', '☰'],
  backup: ['externaldrive.fill', '⇩'],
  export: ['square.and.arrow.up', '⇪'],
  widget: ['square.grid.2x2.fill', '▦'],
  clock: ['clock.fill', '◷'],
  target: ['target', '◎'],
  doc: ['doc.text.fill', '❏'],
  play: ['play.fill', '▶︎'],
  reset: ['arrow.counterclockwise', '↺'],
  plus: ['plus', '+'],
  close: ['xmark', '✕'],
  search: ['magnifyingglass', '⌕'],
  order: ['list.number', '⇅'],
  scope: ['scope', '◎'],
  chevron: ['chevron.right', '›'],
  // The cockpit's status families: a wait, a block, a stop, checks complete, a position.
  wait: ['clock', '◷'],
  block: ['nosign', '⊘'],
  stop: ['xmark.octagon', '✕'],
  ready: ['scope', '◇'],
  position: ['record.circle', '◉'],
  flag: ['flag.checkered', '⚑'],
  pencil: ['square.and.pencil', '✎'],
} as const satisfies Record<string, readonly [SFSymbol, string]>;

export type GlyphName = keyof typeof GLYPHS;

/** A list or tile symbol in `color`. Decorative: the words beside it say what it is. */
export function Glyph({
  name,
  color,
  size = 17,
}: {
  name: GlyphName;
  color: ColorValue;
  size?: number;
}) {
  const [symbol, text] = GLYPHS[name];
  return (
    <SymbolView
      name={symbol}
      size={size}
      weight="semibold"
      tintColor={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
      fallback={
        <Text style={{ ...fonts.bold, fontSize: size, lineHeight: size * 1.25, color }}>
          {text}
        </Text>
      }
    />
  );
}
