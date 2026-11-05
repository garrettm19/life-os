import { Text, View } from 'react-native';
import { ThesisCard, displayTime } from '../domain/model';
import { NO_ADD_LINE } from '../domain/trading';
import { priceText } from '../domain/trading-prices';
import { regimeLabel } from '../domain/trading-regime';
import { BIAS_STRIP } from './bias-strip';
import { palette, radius, fonts, type } from './theme';

/** The thesis card's lines as shown once committed: the short label and the committed text. */
const CARD_ROWS: {
  key: Exclude<
    keyof ThesisCard,
    | 'committedAt'
    | 'direction'
    | 'objectivePrice'
    | 'invalidationPrice'
    | 'expansionPrice'
    | 'gex'
    | 'regime'
  >;
  label: string;
}[] = [
  { key: 'expectation', label: 'HTF expectation' },
  { key: 'gexReason', label: 'GEX reason' },
  { key: 'objective', label: 'Objective' },
  { key: 'zone', label: 'Entry zone' },
  { key: 'invalidation', label: 'Invalidation' },
  { key: 'addPlan', label: 'Adds' },
];

/**
 * The committed thesis card, read-only: on an earlier day's Trading page and in the review, so the
 * day is answered against what was committed. It is never editable once committed. A card locked on
 * the cockpit also shows its expansion target and the HTF candle's classification.
 */
export function ThesisCardView({ thesis, note }: { thesis: ThesisCard; note?: string }) {
  const d = new Date(thesis.committedAt);
  const at = displayTime(d.getHours() * 60 + d.getMinutes());
  return (
    <View
      testID="thesis-card"
      style={{
        gap: 6,
        padding: 14,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: palette.edge,
        backgroundColor: palette.canvas,
      }}>
      <Text style={type.meta}>Thesis · locked {at}</Text>
      {/* The direction first, in its market color; older cards were committed without it. */}
      {thesis.direction && (
        <View accessible accessibilityLabel={`Direction: ${thesis.direction}`}>
          <Text style={{ ...type.item, fontSize: 15, lineHeight: 21 }}>
            <Text style={{ ...type.caption, fontSize: 13 }}>Direction · </Text>
            <Text
              style={{
                ...fonts.bold,
                color: BIAS_STRIP[thesis.direction === 'long' ? 'bullish' : 'bearish'].color,
              }}>
              {thesis.direction === 'long' ? 'Long' : 'Short'}
            </Text>
          </Text>
        </View>
      )}
      {CARD_ROWS.map(({ key, label }) => {
        const value = thesis[key] ?? NO_ADD_LINE;
        return (
          <View key={key} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text style={{ ...type.item, fontSize: 15, lineHeight: 21 }}>
              <Text style={{ ...type.caption, fontSize: 13 }}>{label} · </Text>
              {value}
            </Text>
          </View>
        );
      })}
      {thesis.expansionPrice !== undefined && (
        <View
          accessible
          accessibilityLabel={`Expansion target: ${priceText(thesis.expansionPrice)}`}>
          <Text style={{ ...type.item, fontSize: 15, lineHeight: 21 }}>
            <Text style={{ ...type.caption, fontSize: 13 }}>Expansion target · </Text>
            {priceText(thesis.expansionPrice)}
          </Text>
        </View>
      )}
      {thesis.regime && (
        <View accessible accessibilityLabel={`HTF candle: ${regimeLabel(thesis.regime)}`}>
          <Text style={{ ...type.item, fontSize: 15, lineHeight: 21 }}>
            <Text style={{ ...type.caption, fontSize: 13 }}>HTF candle · </Text>
            {`${regimeLabel(thesis.regime)} · ${thesis.regime.context === 'daily' ? 'DAILY' : '4-DAY'}`}
          </Text>
        </View>
      )}
      {!!note && <Text style={type.caption}>{note}</Text>}
    </View>
  );
}
