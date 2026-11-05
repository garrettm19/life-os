import { useState } from 'react';
import { ColorValue, Text, View } from 'react-native';
import { RuleBook, calendarDays, displayDate } from '../domain/model';
import {
  DayStatus,
  TradingDay,
  cleanStreak,
  reviewEditedText,
  tradingPaused,
  tradingSummary,
} from '../domain/trading';
import { useApp } from '../state/app-state';
import { WEEKDAY_HEADINGS, weekRows } from './chart-scale';
import { SectionLabel, styles } from './components';
import { Disclosure, LinkButton } from './controls';
import { PressableScale } from './motion';
import { fonts, palette, radius, type } from './theme';

const LOOK: Record<
  DayStatus,
  { symbol: string; fill: ColorValue; border: ColorValue; color: ColorValue; words: string }
> = {
  clean: {
    symbol: '✓',
    fill: palette.done,
    border: palette.done,
    color: palette.onDone,
    words: 'clean session',
  },
  broken: {
    symbol: '×',
    fill: 'transparent',
    border: palette.danger,
    color: palette.danger,
    words: 'rule-broken session',
  },
  missed: {
    symbol: '?',
    fill: 'transparent',
    border: palette.edge,
    color: palette.label2,
    words: 'trading day not reviewed',
  },
  away: {
    symbol: '–',
    fill: 'transparent',
    border: palette.accentEdge,
    color: palette.accent,
    words: 'planned day away',
  },
  held: {
    symbol: '–',
    fill: 'transparent',
    border: palette.accentEdge,
    color: palette.accent,
    words: 'protected day',
  },
  open: {
    symbol: '',
    fill: 'transparent',
    border: palette.accent,
    color: palette.accent,
    words: 'today, not reviewed yet',
  },
  older: {
    symbol: '·',
    fill: palette.fillStrong,
    border: 'transparent',
    color: palette.label2,
    words: 'earlier rule review, not scored',
  },
  before: {
    symbol: '',
    fill: 'transparent',
    border: 'transparent',
    color: palette.placeholder,
    words: 'before trading tracking started',
  },
  // A dot in meta, as on the study calendar, unlike an earlier review's dot on a slot. The reader
  // cannot tell a day without trading on its plan from a day never opened, so the words cover both.
  none: {
    symbol: '·',
    fill: 'transparent',
    border: 'transparent',
    color: palette.label3,
    words: 'not a trading day or not opened, nothing recorded',
  },
};

function label(d: TradingDay): string {
  const score = d.score !== undefined ? ` · ${d.score}/8` : '';
  const broke =
    d.review?.violations.length && d.status === 'broken'
      ? ` · ${d.review.violations.length} hard violation${d.review.violations.length === 1 ? '' : 's'}`
      : '';
  const edited = d.review ? reviewEditedText(d.review) : null;
  return `${displayDate(d.date)}${score} · ${LOOK[d.status].words}${broke}${edited ? ` · ${edited}` : ''}`;
}

/**
 * Trading progress, honesty first: rule-clean days of those reviewed and the hard violations
 * recorded lead; the latest score and the clean-session streak follow, smaller. Then the last four
 * Monday-to-Sunday weeks as a small calendar, the most often failed item, and the violations by
 * kind folded away. With nothing recorded in those weeks it is one line instead. Process only: no
 * P&L.
 */
export function TradingProgress({
  book,
  today,
  onReview,
}: {
  book: RuleBook;
  today: string;
  /** Opens the review of a day (to record or correct it). */
  onReview: (date: string) => void;
}) {
  const { state } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  // Whole weeks from a Monday, as on Week; the rest of this week is drawn empty.
  const summary = tradingSummary(state, book, today, calendarDays(today));
  const streak = cleanStreak(state, book, today);
  const pick = summary.days.find((d) => d.date === selected);
  const rows = weekRows(summary.days);
  const latest = summary.latest;
  const recorded = summary.days.some(
    (d) => d.status !== 'none' && d.status !== 'before' && d.status !== 'open',
  );
  if (!recorded)
    return (
      <View style={styles.section}>
        <SectionLabel title="Progress · last 4 weeks" />
        <View testID="trading-progress-empty" style={[styles.card, { gap: 4 }]}>
          <Text style={styles.muted}>
            No reviewed sessions in the last 4 weeks.
            {tradingPaused(state, book) ? ' Live trading is paused.' : ''}
            {streak.best ? ` Best clean streak ${streak.best}.` : ''}
          </Text>
        </View>
      </View>
    );
  return (
    <View style={styles.section}>
      <SectionLabel title="Progress · last 4 weeks" />
      <View style={[styles.card, { gap: 14 }]}>
        <View style={[styles.spread, { alignItems: 'flex-start' }]}>
          <View
            accessible
            accessibilityLabel={`Rule-clean days: ${summary.clean} of ${summary.reviewed} reviewed`}
            style={{ gap: 2, flexShrink: 1 }}>
            <Text style={type.caption}>Rule-clean days</Text>
            <Text style={{ ...type.value, color: summary.clean ? palette.done : palette.label }}>
              {summary.clean}
            </Text>
            <Text style={type.caption}>of {summary.reviewed} reviewed</Text>
          </View>
          <View
            accessible
            accessibilityLabel={`Hard violations recorded: ${summary.violationsRecorded}`}
            style={{ gap: 2, alignItems: 'flex-end', flexShrink: 1 }}>
            <Text style={[type.caption, { textAlign: 'right' }]}>Hard violations recorded</Text>
            <Text
              style={{
                ...type.value,
                color: summary.violationsRecorded ? palette.danger : palette.label,
              }}>
              {summary.violationsRecorded}
            </Text>
          </View>
        </View>
        <Text style={type.caption}>Recording every violation is what keeps this useful.</Text>
        <View style={[styles.spread, { alignItems: 'baseline' }]}>
          <Text style={[type.caption, { flexShrink: 1 }]}>
            {latest
              ? `Latest ${latest.score}/8 · ${displayDate(latest.date)} · ${latest.status === 'clean' ? 'clean' : 'rule-broken'}`
              : 'No scored session yet'}
            {summary.missed ? ` · ${summary.missed} not reviewed` : ''}
          </Text>
          <View
            accessible
            accessibilityLabel={`Clean-session streak ${streak.current}, best ${streak.best}`}>
            <Text style={type.caption}>
              Clean streak{' '}
              <Text
                style={{
                  ...fonts.figure,
                  color: streak.current ? palette.done : palette.label,
                }}>
                {streak.current}
              </Text>{' '}
              · best {streak.best}
            </Text>
          </View>
        </View>
        <View>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAY_HEADINGS.map((d) => (
              <Text
                key={d}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no"
                maxFontSizeMultiplier={1.3}
                style={{ ...type.caption, fontSize: 11, flex: 1, textAlign: 'center' }}>
                {d}
              </Text>
            ))}
          </View>
          {rows.map((row, r) => (
            <View key={r} style={{ flexDirection: 'row' }}>
              {row.map((d, i) => {
                // The rest of this week: an empty column, nothing to tap.
                if (!d) return <View key={`later-${i}`} style={{ flex: 1, minHeight: 44 }} />;
                const look = LOOK[d.status];
                const on = d.date === selected;
                // Today always has its Ember outline, even when it is not a trading day.
                const edge = on ? palette.label : d.date === today ? palette.accent : look.border;
                return (
                  <PressableScale
                    key={d.date}
                    testID={`trading-day:${d.date}`}
                    accessibilityRole="button"
                    accessibilityLabel={label(d)}
                    accessibilityState={{ selected: on }}
                    aria-selected={on}
                    onPress={() => setSelected(on ? null : d.date)}
                    containerStyle={{ flex: 1 }}
                    style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <View
                      style={{
                        width: '78%',
                        maxWidth: 34,
                        aspectRatio: 1,
                        borderRadius: radius.check,
                        borderWidth: on ? 2 : 1,
                        borderColor: edge,
                        backgroundColor: look.fill,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Text
                        maxFontSizeMultiplier={1.2}
                        style={{ ...fonts.figure, fontSize: 13, color: look.color }}>
                        {look.symbol}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          ))}
        </View>
        <View accessibilityLiveRegion="polite" aria-live="polite" style={{ gap: 0 }}>
          <Text style={{ ...type.caption, color: palette.label2 }}>
            {pick
              ? label(pick)
              : '✓ clean  × rule-broken  ? not reviewed  – away or protected  · nothing to review'}
          </Text>
          {pick && pick.date <= today && pick.status !== 'older' && (
            <LinkButton
              title={pick.review ? 'Correct this review' : 'Review this day'}
              onPress={() => onReview(pick.date)}
            />
          )}
        </View>
        {summary.failed[0] && (
          <Text style={type.caption}>
            Most frequently failed:{' '}
            <Text style={{ color: palette.label, ...fonts.semibold }}>
              {summary.failed[0].item.title}
            </Text>{' '}
            ({summary.failed[0].count})
          </Text>
        )}
        {summary.violations.length > 0 && (
          <Disclosure plain title="Hard violations by kind">
            {summary.violations.map((v) => (
              <View key={v.item.id} style={styles.spread}>
                <Text style={{ ...type.item, flexShrink: 1 }}>{v.item.title}</Text>
                <Text style={{ ...type.caption, ...fonts.figure }}>×{v.count}</Text>
              </View>
            ))}
          </Disclosure>
        )}
      </View>
    </View>
  );
}
