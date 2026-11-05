import { router } from 'expo-router';
import { ColorValue, Text, View } from 'react-native';
import { Block, RuleBook, localDate } from '../domain/model';
import { candleReview, cleanStreak, tradingPaused, tradingSummary } from '../domain/trading';
import { Tone } from '../domain/trading-status';
import { useApp } from '../state/app-state';
import { PressableScale } from './motion';
import { biasStrip } from './bias-strip';
import { statusWords } from './status-words';
import { RowActions, TodayRow } from './today-row';
import { useLiveStatus } from './use-live';
import { useNow } from './use-trading-session';
import { fonts, market, palette, radius, type } from './theme';

/** One row card with a chevron: the whole row opens Trading. */
function Row({
  label,
  title,
  line,
  tone,
  onPress,
  testID,
}: {
  label: string;
  title: string;
  line: string;
  tone: ColorValue;
  onPress: () => void;
  testID: string;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: palette.edge,
        backgroundColor: palette.surface,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.meta, color: palette.done }}>Process &gt; P&amp;L</Text>
        <Text style={type.heading}>{title}</Text>
        <Text style={{ ...type.caption, color: tone, ...fonts.semibold }}>{line}</Text>
      </View>
      <Text style={{ ...fonts.figure, fontSize: 20, color: palette.label3 }}>›</Text>
    </PressableScale>
  );
}

const NO_LINKS: never[] = [];

/**
 * The status's color on the row: a stop in the danger color, a restriction or a wait in the
 * market's amber (the hue of an unset bias beside it), never Fern, and never Ember, which on Today
 * marks only the row in progress.
 */
const TONE_COLOR: Record<Tone, ColorValue> = {
  stop: palette.danger,
  block: market.amber,
  wait: market.amber,
  ready: palette.label,
  position: market.gex,
};

type RowProps = {
  book: RuleBook;
  block: Block;
  date: string;
  next: boolean;
  checkLabel: string;
  canMove: boolean;
  actions: RowActions;
};

/**
 * Today's open trading objective as a row at its place in the list, with the weight of any other
 * row. Its caption gives the candle's bias compactly, in its market color, and the cockpit's one
 * status (`tradeStatus`), the same title the cockpit shows, in sentence case: capitals stay the
 * cockpit band's, never a calm list's. Another day's row says only whether it is reviewed. The row and its check open Trading; the objective completes through the review.
 */
export function TradingRow(props: RowProps) {
  const today = localDate(new Date(useNow(Number.POSITIVE_INFINITY, 60_000)));
  return props.date === today ? <LiveRow {...props} /> : <DayRow {...props} />;
}

function LiveRow({ book, block, date, next, checkLabel, canMove, actions }: RowProps) {
  const { ctx, status } = useLiveStatus(book);
  // The candle is named when it is not the row's own day (the evening, before it is labeled).
  const bias = biasStrip(status.facts.bias, ctx.candle !== date ? ctx.candle : null);
  const words = statusWords(status.title);
  return (
    <TodayRow
      block={block}
      date={date}
      // What VoiceOver reads after the row's name: the caption, in words.
      sub={`${bias.spoken} ${words}.${status.practice ? ' Practice only.' : ''}`}
      caption={
        // The bias over the status, each on its own line, so a wrapped status never starts a
        // line with a separator or sits inside the bias.
        <View testID="trading-caption" style={{ gap: 2 }}>
          <Text style={{ ...type.caption, ...fonts.semibold, color: bias.color }}>
            {bias.short}
          </Text>
          <Text style={{ ...type.caption, color: TONE_COLOR[status.tone] }}>{words}</Text>
        </View>
      }
      active={false}
      next={next}
      editLabel={`Open ${block.title}`}
      checkLabel={checkLabel}
      tickOnTap={false}
      steps={false}
      links={NO_LINKS}
      canMove={canMove}
      actions={actions}
    />
  );
}

function DayRow({ book, block, date, next, checkLabel, canMove, actions }: RowProps) {
  const { state } = useApp();
  const session = state.tradingSessions[date];
  const reviewed = !!candleReview(state, book.routineId, date);
  const bias = biasStrip(session?.bias ?? null);
  const words = reviewed
    ? 'Review complete'
    : session?.startedAt
      ? 'Session ran · review it'
      : 'Not reviewed';
  return (
    <TodayRow
      block={block}
      date={date}
      sub={`${bias.spoken} ${words}.`}
      caption={
        <View
          testID="trading-caption"
          style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 4 }}>
          <Text style={{ ...type.caption, ...fonts.semibold, color: bias.color }}>
            {bias.short}
          </Text>
          <Text style={{ ...type.caption, color: palette.label2 }}>· {words}</Text>
        </View>
      }
      active={false}
      next={next}
      editLabel={`Open ${block.title}`}
      checkLabel={checkLabel}
      tickOnTap={false}
      steps={false}
      links={NO_LINKS}
      canMove={canMove}
      actions={actions}
    />
  );
}

/**
 * Progress: the way into Trading under its chart. The rule-clean sessions and hard violations lead
 * in the tile and the scores are in the chart, so neither is repeated here; the clean streak comes
 * last, never first.
 */
export function TradingReviewLink({ book, today }: { book: RuleBook; today: string }) {
  const { state } = useApp();
  const latest = tradingSummary(state, book, today).latest;
  const streak = cleanStreak(state, book, today);
  const paused = tradingPaused(state, book);
  const line = paused
    ? `Paused · cockpit and history · clean streak ${streak.current}`
    : latest
      ? `Cockpit and history · clean streak ${streak.current}`
      : `No session reviewed yet · clean streak ${streak.current}`;
  return (
    <Row
      testID="trading-review-link"
      title="Open Trading"
      line={line}
      // A pause is the user's own choice: Ember, never the danger color.
      tone={paused ? palette.accent : palette.label2}
      label={`Open Trading progress. ${line}`}
      onPress={() => router.push('/trading')}
    />
  );
}
