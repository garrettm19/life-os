import { Text, View } from 'react-native';
import { DayOutcome, DayProgress } from '../domain/objectives';
import { DayProtection } from '../domain/model';
import { WeekDayMark } from '../domain/moments';
import { styles } from './components';
import { ClearedTitle } from './mission';
import { PressableScale } from './motion';
import { DayProgressBody } from './objective-board';
import { WeekStrip, weekLabel } from './week-strip';
import { depth, fonts, palette, radius, type, useWash } from './theme';

/** What the hero card leads with. */
export type Lead = {
  /** The headline: always good news or a fresh start, never a loss. */
  title: string;
  /** The Day Clear streak as a large figure under the headline, or null when no run is going. */
  figure: number | null;
  /** The words after the figure: "days in a row". */
  unit: string;
  /** The best run, beside the headline, once there is one. */
  best: number | null;
  /** The current run is the best one. */
  atBest: boolean;
  /** A quiet line under the headline when there is no figure. */
  note: string | null;
};

/**
 * Today's headline, read from the Day Clear streak and the last seven days (the one rule,
 * `dayOutcome`). It opens on what went well: yesterday cleared, or a run still going. When no run
 * is going it says the day is a fresh start and counts what was cleared, never what was missed:
 * a broken run is never the headline. The streak figure sits under the headline, never as it.
 */
export function heroLead(
  streak: { current: number; best: number },
  week: WeekDayMark[],
  cleared: boolean,
): Lead {
  const best = streak.best > 0 ? streak.best : null;
  const unit = (n: number) => (n === 1 ? 'day in a row' : 'days in a row');
  const atBest = streak.current > 1 && streak.current >= streak.best;
  if (cleared)
    return {
      title: 'Day cleared',
      figure: streak.current,
      unit: unit(streak.current),
      best,
      atBest,
      note: null,
    };
  if (streak.current > 0) {
    // Today is the last of the seven, so yesterday is the one before it.
    const yesterday = week.at(-2)?.mark;
    return {
      title:
        yesterday === 'cleared'
          ? 'Yesterday was cleared'
          : yesterday === 'protected'
            ? 'Yesterday was protected'
            : 'Your run is still going',
      figure: streak.current,
      unit: unit(streak.current),
      best,
      atBest,
      note: null,
    };
  }
  const recent = week.filter((d) => d.mark === 'cleared').length;
  return {
    title: 'A fresh start today',
    figure: null,
    unit: '',
    best,
    atBest: false,
    note:
      recent > 0
        ? `${recent} cleared in the last 7 days`
        : best
          ? null
          : 'Clear today to start a run',
  };
}

/** The headline, the figure and the best run, read as one sentence. */
export function leadLabel(lead: Lead): string {
  return [
    lead.title,
    lead.figure !== null ? `${lead.figure} ${lead.unit}` : null,
    lead.note,
    lead.best !== null ? (lead.atBest ? 'Your best run' : `Best ${lead.best}`) : null,
  ]
    .filter(Boolean)
    .join('. ')
    .concat('.');
}

/**
 * Today's hero card: the good news first, the Day Clear streak as a large rounded figure under it,
 * the last seven days as a chain (a tap opens the streak details), then how far today is. It sits
 * on a soft sunrise wash; once the day is cleared the wash turns mint and the headline says so.
 */
export function TodayHero({
  progress,
  streak,
  week,
  outcome,
  protection,
  hasActive,
  celebrate,
  onOpenStreak,
}: {
  progress: DayProgress;
  /** The Day Clear streak through today: an open today holds the run into it. */
  streak: { current: number; best: number };
  week: WeekDayMark[];
  outcome: DayOutcome;
  protection?: DayProtection;
  hasActive: boolean;
  /** The day was just cleared on this screen: the headline rises in once. */
  celebrate: boolean;
  onOpenStreak: () => void;
}) {
  const cleared = progress.cleared;
  const lead = heroLead(streak, week, cleared);
  const sunrise = useWash(
    (c) =>
      `radial-gradient(ellipse at 0% 0%, ${c.washWarm} 0%, ${c.washRose} 30%, ${c.surface} 72%)`,
    'surface',
  );
  const mint = useWash(
    (c) => `radial-gradient(ellipse at 50% 0%, ${c.washMint} 0%, ${c.surface} 70%)`,
    'surface',
  );
  // Nothing counted and nothing skipped (only optional objectives): no progress line.
  const counts = progress.total > 0 || progress.skipped > 0 || progress.protected;
  return (
    <View
      testID="today-hero"
      style={[
        {
          borderRadius: radius.card,
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 16,
          gap: 12,
          overflow: 'hidden',
        },
        depth.card,
        cleared ? mint : sunrise,
      ]}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={leadLabel(lead)}
        style={{ gap: 2 }}>
        {cleared ? (
          <View style={{ alignItems: 'flex-start' }}>
            <ClearedTitle animate={celebrate} align="left">
              Day cleared
            </ClearedTitle>
          </View>
        ) : (
          <Text maxFontSizeMultiplier={1.3} style={type.cardTitle}>
            {lead.title}
          </Text>
        )}
        {/* The figure under the headline, never as it, with the best run at the line's end. */}
        {(lead.figure !== null || lead.note || lead.best !== null) && (
          <View style={[styles.spread, { alignItems: 'baseline', columnGap: 8, rowGap: 0 }]}>
            {lead.figure !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 }}>
                <Text
                  maxFontSizeMultiplier={1.6}
                  style={{
                    ...fonts.figureHeavy,
                    fontSize: 44,
                    lineHeight: 50,
                    color: palette.doneText,
                  }}>
                  {lead.figure}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    ...fonts.semibold,
                    fontSize: 17,
                    lineHeight: 22,
                    color: palette.label2,
                    flexShrink: 1,
                  }}>
                  {lead.unit}
                </Text>
              </View>
            ) : (
              <Text style={{ ...type.muted, color: palette.label2, flexShrink: 1 }}>
                {lead.note ?? ''}
              </Text>
            )}
            {lead.best !== null && (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  ...fonts.semibold,
                  fontSize: 15,
                  lineHeight: 20,
                  color: lead.atBest ? palette.doneText : palette.label2,
                }}>
                {lead.atBest ? 'Your best' : 'Best '}
                {!lead.atBest && <Text style={fonts.figure}>{lead.best}</Text>}
              </Text>
            )}
          </View>
        )}
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${weekLabel(week)} Streak details.`}
        onPress={onOpenStreak}
        style={{ paddingVertical: 2 }}>
        <WeekStrip days={week} size={32} standalone={false} />
      </PressableScale>
      {counts && !cleared && (
        <View
          style={{
            borderTopWidth: 0.5,
            borderTopColor: palette.separator,
            paddingTop: 12,
          }}>
          <DayProgressBody
            progress={progress}
            protection={protection}
            isToday
            notPast
            hasActive={hasActive}
          />
        </View>
      )}
      {cleared && (
        <Text
          accessibilityLabel={`${progress.done} of ${progress.total} objectives complete`}
          style={{ ...type.caption, ...fonts.semibold, color: palette.doneText }}>
          All <Text style={fonts.figure}>{progress.done}</Text> done
        </Text>
      )}
      {(outcome === 'empty' || outcome === 'absent') && !counts && (
        <Text style={type.caption}>Nothing due today.</Text>
      )}
    </View>
  );
}
