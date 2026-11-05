import { ColorValue, Pressable, Text, View } from 'react-native';
import { displayDate } from '../domain/model';
import { DailyBias } from '../domain/trading';
import { fonts, market, palette, radius, type } from './theme';

/** A caption on a market tint: the secondary text color, which keeps 4.5:1 on every tint. */
export const TINT_CAPTION = { ...type.caption, color: palette.label2 };

type Strip = {
  text: string;
  /** The compact form, in sentence case, for the caption of Today's trading row. */
  short: string;
  spoken: string;
  color: ColorValue;
  deep: ColorValue;
  edge: ColorValue;
};

/**
 * The daily bias as one line in sentence case (uppercase is kept for word tags and the cockpit's
 * status title), compactly, and as the one sentence VoiceOver reads.
 */
export const BIAS_STRIP: Record<DailyBias | 'none', Strip> = {
  bullish: {
    text: '▲ Bullish day · longs only',
    short: '▲ Bullish · longs only',
    spoken: 'Daily bias: bullish. Longs only.',
    color: market.bull,
    deep: market.bullTint,
    edge: market.bullEdge,
  },
  bearish: {
    text: '▼ Bearish day · shorts only',
    short: '▼ Bearish · shorts only',
    spoken: 'Daily bias: bearish. Shorts only.',
    color: market.bear,
    deep: market.bearTint,
    edge: market.bearEdge,
  },
  unclear: {
    text: '? Unclear · no trade today',
    short: '? Unclear · no trade today',
    spoken: 'Daily bias: unclear. No trade today.',
    color: palette.label2,
    deep: palette.fill,
    edge: palette.edge,
  },
  none: {
    text: "Set today's daily bias",
    short: "Set today's daily bias",
    spoken: "Daily bias not set. Set today's daily bias.",
    color: market.amber,
    deep: market.amberTint,
    edge: market.amberEdge,
  },
};

/**
 * The strip for a bias, naming its daily candle when `candle` is given: on the evening of a day
 * never labeled, the bias shown is the next candle's, so it is never read as the day's own.
 */
export function biasStrip(bias: DailyBias | null, candle?: string | null): Strip {
  const strip = BIAS_STRIP[bias ?? 'none'];
  if (!candle) return strip;
  const day = displayDate(candle);
  return bias
    ? {
        ...strip,
        short: `For ${day} · ${strip.short}`,
        spoken: `Daily candle of ${day}. ${strip.spoken}`,
      }
    : {
        ...strip,
        text: `Set the bias for ${day}`,
        short: `Set the bias for ${day}`,
        spoken: `Daily bias for ${day} not set. Set the bias for ${day}.`,
      };
}

/** The strip's sizes: on its own, inside a card (one line at 375 pt), and in a sheet. */
const SIZES = {
  board: { font: 20, height: 52, padding: 12 },
  card: { font: 17, height: 44, padding: 10 },
  compact: { font: 15, height: 40, padding: 8 },
};

/**
 * A day's bias as one line, in its market color: on an earlier day's Trading page (the cockpit has
 * its own header, and Today's trading row shows it compactly, from `short`). With `onPress` it is
 * a button that opens Trading; `size` sets it smaller inside a card (where it stays one line at
 * 375 pt and a 44 pt target) or a sheet.
 */
export function BiasStrip({
  bias,
  candle,
  onPress,
  size = 'board',
}: {
  bias: DailyBias | null;
  /** A later candle than the day's own, named on the strip (`biasStrip`). */
  candle?: string | null;
  onPress?: () => void;
  size?: keyof typeof SIZES;
}) {
  const strip = biasStrip(bias, candle);
  const look = SIZES[size];
  const body = (
    <Text
      style={{
        ...fonts.bold,
        fontSize: look.font,
        lineHeight: Math.round(look.font * 1.3),
        color: strip.color,
      }}>
      {strip.text}
    </Text>
  );
  const box = {
    minHeight: look.height,
    paddingHorizontal: size === 'board' ? 14 : 12,
    paddingVertical: look.padding,
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: strip.edge,
    backgroundColor: strip.deep,
    justifyContent: 'center' as const,
  };
  return onPress ? (
    <Pressable
      testID="bias-strip"
      accessibilityRole="button"
      accessibilityLabel={strip.spoken}
      accessibilityHint="Opens Trading"
      onPress={onPress}
      style={({ pressed }) => ({ ...box, opacity: pressed ? 0.8 : 1 })}>
      {body}
    </Pressable>
  ) : (
    <View testID="bias-strip" accessible accessibilityLabel={strip.spoken} style={box}>
      {body}
    </View>
  );
}
