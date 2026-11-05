import {
  ColorValue,
  DynamicColorIOS,
  Platform,
  TextStyle,
  useColorScheme,
  ViewStyle,
} from 'react-native';

/**
 * Calm premium (docs/DESIGN_SYSTEM.md): warm paper in light, warm charcoal in dark, following the
 * phone's appearance. Ember marks what is happening now, Fern what is done; the market colors stay
 * on trading. Type is the system's SF Pro, with SF Pro Rounded for every figure.
 *
 * Each token has a light and a dark value. `palette` and `market` hold one adaptive color per
 * token, so a style written once at module scope follows the appearance by itself: on iOS a
 * `DynamicColorIOS`, which UIKit resolves for the current appearance; on the web a CSS variable,
 * defined for both appearances in `src/app/+html.tsx`, so the static prerender is the same for
 * every visitor and the browser picks the colors from `prefers-color-scheme`. The raw values are in
 * `tokens`, for the contrast tests and the few places that need a concrete color (`useWash`).
 */
const light = {
  /** The page. */
  canvas: '#F7F4EF',
  /** Cards, sheets, tiles. */
  surface: '#FFFFFF',
  /** Control tracks, quiet buttons, a selected row's ground. */
  fill: '#EFEAE3',
  /** An empty segment or a day with nothing recorded: decorative, never the only signal. */
  fillStrong: '#E4DED5',
  /** The selected segment of a segmented control: lifted off its `fill` track. */
  raised: '#FFFFFF',
  /** A 0.5 pt hairline inside a card, never around one. */
  separator: '#E6E0D8',
  /** The outline of a field or an outline button. */
  edge: '#D3CCC2',
  /** The inner edge of a card: none in light, where the card has a shadow instead. */
  cardEdge: '#00000000',
  /** A card's two shadows, warm, never grey: none in dark. */
  shadowNear: '#3C28140D',
  shadowFar: '#3C28141A',
  /** Primary text, and the fill of a primary button. */
  label: '#1D1B18',
  /** Secondary text: captions and detail lines. */
  label2: '#5C564F',
  /** Tertiary text: small labels, weekday letters, chevrons. */
  label3: '#6B645C',
  /** Placeholders and large faint totals only: 3:1, below small-text contrast. */
  placeholder: '#8A8279',
  /** The outline of an open check: at least 3:1 on every surface a check sits on. */
  checkEdge: '#8C847B',
  /** Ink on a `label` fill (the primary button). */
  onLabel: '#FFFFFF',
  /**
   * Ember: now. The objective in progress, today's disc, the selected tab. In light it is the
   * text-safe step (4.5:1 on the page, cards and its tint), so a screen may set it on text too.
   * Its text step is a shade deeper, so it holds 4.5:1 on the sunrise and mint washes as well.
   */
  accent: '#AE4E18',
  accentText: '#994515',
  accentTint: '#FCEBDD',
  accentEdge: '#EDB892',
  /** Decoration only (washes, confetti): never text or an edge. */
  accentSoft: '#F59A5E',
  /** Fern: done, cleared, on time. Text-safe in light, as Ember is; its text step holds on washes. */
  done: '#1C7A50',
  doneText: '#196B46',
  doneTint: '#E2F3E9',
  doneEdge: '#9ED3B6',
  onDone: '#FFFFFF',
  /** Errors and a failed rule in the trading review only: never a missed habit. */
  danger: '#B3412E',
  dangerTint: '#FBE5E0',
  overlay: '#1D1B1866',
  /** Floating chrome (the tab bar), translucent over the page. */
  glass: '#FFFFFFD1',
  glassEdge: '#FFFFFF',
  /** Washes behind a title: sunrise on Today, mint on Day Cleared. Decoration only. */
  washWarm: '#FFD6B3',
  washRose: '#FAD0D3',
  washMint: '#CFEFDF',
  /**
   * The series color on Progress charts. Never done, a target or a broken rule, and never text.
   */
  chart: '#4A7FB8',
  /** The selected column or bar: a stronger step of `chart`. */
  chartLight: '#2F659E',
  /** The second series where a chart has two (savings beside debt). */
  chartAlt: '#C2702C',
  /** The knob of a switch, on its `checkEdge` track when off and its `label` track when on. */
  knob: '#FFFFFF',
  /**
   * A program's area: a symbol in a tinted tile beside its name (training, career, money…). An
   * identity, never a state: none of them means now, done or a market. Each ink is 4.5:1 on its
   * tint.
   */
  areaSunTint: '#FBF0D2',
  areaSun: '#86580A',
  areaSkyTint: '#E1ECF8',
  areaSky: '#2D5E94',
  areaPlumTint: '#EEE6F7',
  areaPlum: '#66479A',
  areaRoseTint: '#F9E4EA',
  areaRose: '#9A3D5A',
  areaSlateTint: '#ECE8E2',
  areaSlate: '#5C564F',
};

type Tokens = typeof light;

const dark: Tokens = {
  canvas: '#100F0E',
  surface: '#1C1A18',
  fill: '#2A2724',
  fillStrong: '#36322E',
  raised: '#3A3632',
  separator: '#2E2A26',
  edge: '#3D3833',
  cardEdge: '#FFFFFF0F',
  shadowNear: '#00000000',
  shadowFar: '#00000000',
  label: '#F5F1EB',
  label2: '#B8B0A6',
  label3: '#9A9187',
  placeholder: '#77706A',
  checkEdge: '#7E766D',
  onLabel: '#100F0E',
  accent: '#FF9A57',
  accentText: '#FFA86E',
  accentTint: '#3A2618',
  accentEdge: '#6A4126',
  accentSoft: '#FF9A57',
  done: '#5FD3A6',
  doneText: '#6FDCB1',
  doneTint: '#15302A',
  doneEdge: '#2B6B51',
  onDone: '#06201A',
  danger: '#E08A76',
  dangerTint: '#2E1814',
  overlay: '#000000B3',
  glass: '#2C2926D9',
  glassEdge: '#FFFFFF14',
  washWarm: '#5A2E14',
  washRose: '#46202A',
  washMint: '#133D2D',
  chart: '#6FA6DE',
  chartLight: '#93B8E0',
  chartAlt: '#D98A45',
  knob: '#F5F1EB',
  areaSunTint: '#33280F',
  areaSun: '#F2C14E',
  areaSkyTint: '#14263A',
  areaSky: '#86B6EA',
  areaPlumTint: '#2A2038',
  areaPlum: '#BCA4EA',
  areaRoseTint: '#36192A',
  areaRose: '#F29DB8',
  areaSlateTint: '#2A2724',
  areaSlate: '#B8B0A6',
};

/**
 * Trading's market colors: green bullish, red bearish, blue for a valid GEX range, amber for wait
 * and practice. Trading only, never done or in progress. Each has a tint to sit on and
 * an edge, and the arrow, the symbol or the word always goes with the color.
 */
const marketLight = {
  bull: '#0B7550',
  bullTint: '#DDF2E7',
  bullEdge: '#4FA582',
  bear: '#C4283F',
  bearTint: '#FBE3E6',
  bearEdge: '#E28A97',
  gex: '#1D67B0',
  gexTint: '#E0ECF8',
  gexEdge: '#7FA9D6',
  amber: '#9A5A00',
  amberTint: '#FBEFD6',
  amberEdge: '#B27B1A',
  /**
   * The cockpit's status band: a solid fill per family with dark ink, read like a road sign in
   * both appearances. Amber for a wait or a block, blue in position, coral for a stop,
   * stone once the checks are complete. Trading only, and never Fern or Ember.
   */
  bandWait: '#F2B13F',
  bandPosition: '#8CC3F7',
  bandStop: '#F7907E',
  bandReady: '#CFC6B8',
  /** The ink on every band fill, and the disc behind its symbol. */
  onBand: '#1A1611',
  bandMark: '#1A16111F',
};

type MarketTokens = typeof marketLight;

const marketDark: MarketTokens = {
  bull: '#2BE0A3',
  bullTint: '#0F2A22',
  bullEdge: '#178A63',
  bear: '#FF6B7E',
  bearTint: '#33161B',
  bearEdge: '#A33A4A',
  gex: '#6CBBFF',
  gexTint: '#11263A',
  gexEdge: '#2A5F8F',
  amber: '#F5B544',
  amberTint: '#2E2410',
  amberEdge: '#A87A2A',
  bandWait: '#F5B544',
  bandPosition: '#8EC5FF',
  bandStop: '#FF9582',
  bandReady: '#D6CFC5',
  onBand: '#1A1611',
  bandMark: '#1A16111F',
};

/** The raw values of every token in each appearance. */
export const tokens = {
  light: { ...light, ...marketLight },
  dark: { ...dark, ...marketDark },
};

const cssName = (key: string) => `--lo-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function adaptive<T extends Record<string, string>>(
  lightValues: T,
  darkValues: T,
): { [K in keyof T]: ColorValue } {
  const out = {} as { [K in keyof T]: ColorValue };
  for (const key of Object.keys(lightValues) as (keyof T & string)[])
    out[key] =
      Platform.OS === 'web'
        ? `var(${cssName(key)})`
        : Platform.OS === 'ios'
          ? DynamicColorIOS({ light: lightValues[key], dark: darkValues[key] })
          : darkValues[key];
  return out;
}

export const palette = adaptive(light, dark);
export const market = adaptive(marketLight, marketDark);

/**
 * The web's color variables for both appearances, written into the page head by
 * `src/app/+html.tsx`. Dark follows `prefers-color-scheme`, as the app follows the phone.
 */
export function themeCss(): string {
  const block = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([key, value]) => `${cssName(key)}:${value};`)
      .join('');
  return (
    `:root{color-scheme:light dark;${block(tokens.light)}}` +
    `@media (prefers-color-scheme: dark){:root{${block(tokens.dark)}}}` +
    `html,body{background-color:var(--lo-canvas);}`
  );
}

const CSS_VARS = Object.fromEntries(
  Object.keys(light).map((key) => [key, `var(${cssName(key)})`]),
) as Record<keyof Tokens, string>;

/**
 * A gradient built from tokens, with a solid fallback. The web takes it as one CSS string of
 * variables; iOS draws `experimental_backgroundImage`, which needs concrete colors, so there it is
 * built for the current appearance and rebuilt when the appearance changes.
 */
export function useWash(
  build: (c: Record<keyof Tokens, string>) => string,
  fallback: keyof Tokens,
): ViewStyle {
  // Read on every platform so the hooks never change order; the web never uses it, so its static
  // prerender matches every visitor's first render.
  const scheme = useColorScheme();
  if (Platform.OS === 'web')
    return { backgroundColor: palette[fallback], backgroundImage: build(CSS_VARS) } as ViewStyle;
  return {
    backgroundColor: palette[fallback],
    experimental_backgroundImage: build(scheme === 'light' ? light : dark),
  };
}

/**
 * System type: SF Pro for text and SF Pro Rounded for figures, so nothing is bundled or loaded and
 * Dynamic Type and Bold Text come from the system. React Native resolves `System` to SF Pro and
 * `ui-rounded` to SF Pro Rounded on iOS; the web build uses the browser's system font, with
 * `ui-rounded` where the browser has it (Safari).
 */
const SANS = 'System';
const ROUNDED = Platform.select({ ios: 'ui-rounded', default: 'ui-rounded, System' });

const face = (fontFamily: string, fontWeight: TextStyle['fontWeight']): TextStyle => ({
  fontFamily,
  fontWeight,
});

/** Weights of SF Pro, and SF Pro Rounded with tabular figures for every number. */
export const fonts = {
  regular: face(SANS, '400'),
  medium: face(SANS, '500'),
  semibold: face(SANS, '600'),
  bold: face(SANS, '700'),
  heavy: face(SANS, '800'),
  /** Counts, times and amounts in a line of text. */
  figure: { ...face(ROUNDED, '700'), fontVariant: ['tabular-nums'] } as TextStyle,
  /** Headline numbers: the streak, a tile, a total. */
  figureHeavy: { ...face(ROUNDED, '800'), fontVariant: ['tabular-nums'] } as TextStyle,
} satisfies Record<string, TextStyle>;

export const type = {
  /** Screen title, sentence case: "Today", "Progress". */
  title: { ...fonts.bold, fontSize: 34, lineHeight: 41, color: palette.label },
  /** Section and item headings. */
  heading: { ...fonts.semibold, fontSize: 17, lineHeight: 22, color: palette.label },
  /** A small label over a field or a group, sentence case. */
  meta: {
    ...fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.1,
    color: palette.label3,
  },
  /** Large count: 4/7. */
  count: { ...fonts.figureHeavy, fontSize: 28, lineHeight: 32, color: palette.label },
  /**
   * A short goal or status line: "3 to clear the day". Neutral by default; Fern only when it
   * reports something done, Ember when it is about now.
   */
  callout: { ...fonts.semibold, fontSize: 15, lineHeight: 20, color: palette.label },
  /** A sheet or full-screen view title. */
  sheetTitle: { ...fonts.bold, fontSize: 22, lineHeight: 28, color: palette.label },
  /** The title of a card that leads a screen. */
  cardTitle: { ...fonts.bold, fontSize: 20, lineHeight: 25, color: palette.label },
  /** A headline figure since the start: 21, $1,050. */
  figure: { ...fonts.figureHeavy, fontSize: 30, lineHeight: 34, color: palette.label },
  /** The one expressive line: "Day cleared". */
  hero: { ...fonts.figureHeavy, fontSize: 44, lineHeight: 50, color: palette.label },
  body: { ...fonts.regular, fontSize: 17, lineHeight: 23, color: palette.label },
  /** A row title. */
  item: { ...fonts.medium, fontSize: 17, lineHeight: 22, color: palette.label },
  /** A step under its objective. */
  small: { ...fonts.regular, fontSize: 15, lineHeight: 20, color: palette.label },
  muted: { ...fonts.regular, fontSize: 15, lineHeight: 21, color: palette.label2 },
  /** A status or detail line under a title, in sentence case: "Done · 8:00 AM". */
  caption: { ...fonts.regular, fontSize: 14, lineHeight: 19, color: palette.label2 },
  /** The smallest reading text: footnotes under a chart. */
  footnote: { ...fonts.regular, fontSize: 13, lineHeight: 18, color: palette.label2 },
  /** A recorded figure: $16,310, 181.7 lb. */
  value: { ...fonts.figureHeavy, fontSize: 21, lineHeight: 26, color: palette.label },
  /**
   * A word tag (PRACTICE, DEMO). One of the two places uppercase survives, with the cockpit's
   * status title; the source text stays sentence case.
   */
  tag: {
    ...fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: palette.label2,
  },
  /** The cockpit's status title, read like a road sign. */
  status: {
    ...fonts.heavy,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    color: palette.label,
  },
} satisfies Record<string, TextStyle>;

/** A soft glow around a mark, in a token color. */
export function glow(color: ColorValue, radius: number): ViewStyle {
  return { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: radius, color }] };
}

/** A card's depth: a warm shadow in light, an inner 0.5 pt edge in dark. */
export const depth: Record<'card' | 'float', ViewStyle> = {
  card: {
    borderWidth: 0.5,
    borderColor: palette.cardEdge,
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: palette.shadowNear },
      { offsetX: 0, offsetY: 8, blurRadius: 24, spreadDistance: -6, color: palette.shadowFar },
    ],
  },
  /** Chrome that floats: the tab bar. */
  float: {
    borderWidth: 0.5,
    borderColor: palette.glassEdge,
    boxShadow: [
      { offsetX: 0, offsetY: 2, blurRadius: 6, color: palette.shadowNear },
      { offsetX: 0, offsetY: 12, blurRadius: 32, spreadDistance: -8, color: palette.shadowFar },
    ],
  },
};

export const glows = {
  /** The objective in progress: a soft Ember light around its row. */
  active: glow(palette.accentEdge, 14),
  /** Day Cleared: a soft Fern light around its panel. */
  panel: glow(palette.doneEdge, 32),
};

/** The radii, concentric: a 24 pt card holds an 18 pt row at a 6 pt inset. */
export const radius = {
  /** Fields and small square-ish controls. */
  control: 14,
  /** Buttons, chips, tags, segments, the tab bar. */
  capsule: 999,
  card: 24,
  tile: 20,
  row: 18,
  sheet: 32,
  /** Checks and discs are circles. */
  check: 999,
  segment: 999,
};
