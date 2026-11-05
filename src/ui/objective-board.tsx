import { Text, View } from 'react-native';
import {
  DayOutcome,
  DayProgress,
  PROTECTION_REASONS,
  StreakDay,
  outcomeLabel,
  protectionLabel,
  streakCaption,
} from '../domain/objectives';
import { DayProtection, ProtectionReason, displayDate } from '../domain/model';
import { Button, styles } from './components';
import { ClearedFrame, ClearedTitle, Count, Segments } from './mission';
import { PressableScale } from './motion';
import { Callout, callout, progressLabel, segmentStates } from './segments';
import { fonts, palette, radius, type } from './theme';

/** "1 day", "3 days". */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

export function streakDetailsLabel(streak: { current: number; best: number }): string {
  return `Streak details. ${streakCaption(streak.current, streak.best)}. Best ${days(streak.best)}.`;
}

/** STREAK 12 · BEST 21 on the header line, or the plain caption before a run starts. */
export function streakLine(streak: { current: number; best: number }): string {
  return streak.current > 0
    ? `Streak ${streak.current} · Best ${streak.best}`
    : streakCaption(streak.current, streak.best);
}

export function ObjectiveBoard({
  progress,
  streak,
  outcome,
  protection,
  onOpenStreak,
  isToday,
  notPast,
  hasActive,
  celebrate,
}: {
  isToday: boolean;
  /** The day shown is today or later. */
  notPast: boolean;
  progress: DayProgress;
  streak: { current: number; best: number };
  outcome: DayOutcome;
  protection?: DayProtection;
  onOpenStreak: () => void;
  /** An objective is happening now; its segment is Ember. */
  hasActive: boolean;
  /** The day was just cleared on this screen: play the reveal once. Otherwise it appears settled. */
  celebrate: boolean;
}) {
  if (outcome === 'absent') {
    // Today and later days are saved as soon as something is due, so an unsaved one has nothing
    // due. Only past days can be Not recorded.
    if (notPast)
      return (
        <View style={styles.card}>
          <Text style={styles.body}>
            {isToday ? 'Nothing due today.' : 'Nothing due this day.'}
          </Text>
        </View>
      );
    return (
      <View style={[styles.card, { gap: 10 }]}>
        <Text
          accessibilityRole="header"
          accessibilityLabel="Not recorded. This day was never opened. It does not break or advance the streak."
          style={{ ...type.heading, color: palette.label }}>
          Not recorded
        </Text>
        <Text style={styles.body}>
          This day was never opened. It does not break or advance the streak.
        </Text>
        <Text style={styles.muted}>
          That is different from a protected day, which is an explicit excuse and stays in history.
        </Text>
      </View>
    );
  }
  if (progress.cleared)
    return (
      <Cleared
        progress={progress}
        streak={streak}
        celebrate={celebrate}
        onOpenStreak={onOpenStreak}
      />
    );
  // Nothing counted and nothing skipped: no board. A day whose every objective was skipped still
  // says it is not cleared.
  if (progress.total === 0 && progress.skipped === 0 && !progress.protected) return null;
  return (
    <View style={[styles.card, { paddingHorizontal: 16, paddingVertical: 14, gap: 10 }]}>
      <DayProgressBody
        progress={progress}
        protection={protection}
        isToday={isToday}
        notPast={notPast}
        hasActive={hasActive}
      />
    </View>
  );
}

/**
 * How far the day is: a protected day's note, the count with its goal line over the segments, and
 * what still has to be placed before the day can clear. Shared by the board on another day and
 * Today's hero card.
 */
export function DayProgressBody({
  progress,
  protection,
  isToday,
  notPast,
  hasActive,
}: {
  progress: DayProgress;
  protection?: DayProtection;
  isToday: boolean;
  notPast: boolean;
  hasActive: boolean;
}) {
  const line = callout(progress, !notPast);
  return (
    <View style={{ gap: 10 }}>
      {progress.protected && protection && (
        <View style={{ gap: 4 }}>
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Protected day. ${protectionLabel(protection)}. The streak is held. Protection marks nothing done.`}
            style={{ ...type.callout, color: palette.label }}>
            Protected · {protectionLabel(protection)}
          </Text>
          <Text style={type.caption}>
            The streak is held. Protection marks nothing done. This is an explicit excuse, not a
            missing record.
          </Text>
        </View>
      )}
      {progress.total > 0 && (
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={progressLabel(progress, isToday, !notPast)}
          style={{ gap: 10 }}>
          {/* One line, the count and the goal as a small chip, over a thin bar. */}
          <View style={[styles.spread, { rowGap: 6 }]}>
            <Count compact done={progress.done} total={progress.total} />
            {line && <GoalChip text={line.text} tone={line.tone} />}
          </View>
          <Segments
            compact
            states={segmentStates(progress, hasActive)}
            ratio={progress.done / progress.total}
          />
        </View>
      )}
      {progress.total === 0 && line && (
        <View accessibilityRole="header" style={{ alignItems: 'flex-start' }}>
          <GoalChip text={line.text} tone={line.tone} />
        </View>
      )}
      {progress.missingTimed > 0 && (
        // Not an error: something due is simply not on the list yet, and one tap places it.
        <Text style={type.caption}>
          {progress.missingTimedTitles.join(', ')}
          {progress.missingTimed === 1 ? ' is' : ' are'} due and not on the list yet. Generate day
          in {isToday ? 'More for today' : 'More for this day'} places{' '}
          {progress.missingTimed === 1 ? 'it' : 'them'}.
        </Text>
      )}
    </View>
  );
}

/** The goal line as a small capsule: "3 to clear the day", Ember when something stands in the way. */
function GoalChip({ text, tone }: { text: string; tone: Callout['tone'] }) {
  const warm = tone === 'now';
  return (
    <View
      style={{
        backgroundColor: warm ? palette.accentTint : palette.fill,
        borderRadius: radius.capsule,
        paddingHorizontal: 12,
        paddingVertical: 5,
        flexShrink: 1,
      }}>
      <Text
        style={{
          ...type.callout,
          fontSize: 14,
          lineHeight: 19,
          color: warm ? palette.accentText : palette.label,
        }}>
        {text}
      </Text>
    </View>
  );
}

function Cleared({
  progress,
  streak,
  celebrate,
  onOpenStreak,
}: {
  progress: DayProgress;
  streak: { current: number; best: number };
  celebrate: boolean;
  onOpenStreak: () => void;
}) {
  return (
    <ClearedFrame animate={celebrate}>
      <Text
        accessibilityLabel={`${progress.done} of ${progress.total} objectives complete`}
        style={{
          ...type.meta,
          ...fonts.figure,
          fontSize: 12,
          color: palette.doneText,
        }}>
        {progress.done} / {progress.total} complete
      </Text>
      <ClearedTitle animate={celebrate}>Day cleared</ClearedTitle>
      <View style={{ alignSelf: 'stretch' }}>
        <Segments states={segmentStates(progress, false)} ratio={1} cleared sweep={celebrate} />
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={streakDetailsLabel(streak)}
        onPress={onOpenStreak}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          columnGap: 22,
        }}>
        <Text style={{ ...type.meta, fontSize: 12, color: palette.doneText }}>
          Streak <Text style={{ ...fonts.figure, color: palette.label }}>{streak.current}</Text>
          {streak.current > 0 && <Text style={{ color: palette.done }}> +1</Text>}
        </Text>
        <Text style={{ ...type.meta, fontSize: 12, color: palette.doneText }}>
          Best <Text style={{ ...fonts.figure, color: palette.label }}>{streak.best}</Text>
        </Text>
      </PressableScale>
    </ClearedFrame>
  );
}

export function StreakSheetBody({
  streak,
  protection,
  history,
  onProtect,
  onClearProtection,
}: {
  streak: { current: number; best: number };
  protection?: DayProtection;
  history: StreakDay[];
  onProtect: (reason: ProtectionReason) => void;
  onClearProtection: () => void;
}) {
  return (
    <>
      <View style={[styles.card, { flexDirection: 'row', gap: 0, padding: 0 }]}>
        <View style={{ flex: 1, padding: 16, gap: 4 }}>
          <Text style={styles.label}>Current</Text>
          <Text style={{ ...type.count, color: streak.current > 0 ? palette.done : palette.label }}>
            {streak.current}
          </Text>
          <Text style={styles.muted}>{streakCaption(streak.current, streak.best)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: palette.separator }} />
        <View style={{ flex: 1, padding: 16, gap: 4 }}>
          <Text style={styles.label}>Best</Text>
          <Text style={type.count}>{streak.best}</Text>
          <Text style={styles.muted}>Best · {days(streak.best)}</Text>
        </View>
      </View>
      <Text style={styles.muted}>
        Not recorded means the day was never opened. It stays out of history and does not break or
        advance the streak. Protected is an explicit excuse: the streak is held and nothing is
        marked done.
      </Text>
      {history.length > 0 && (
        <View style={{ gap: 2 }}>
          <Text style={[styles.label, { paddingBottom: 6 }]}>Recent days</Text>
          {history.map((entry) => (
            <View
              key={entry.date}
              accessible
              accessibilityLabel={`${displayDate(entry.date)}: ${outcomeLabel(entry)}`}
              style={[styles.spread, { minHeight: 32 }]}>
              <Text style={{ ...type.meta, color: palette.label2 }}>{displayDate(entry.date)}</Text>
              <Text
                style={{
                  ...type.meta,
                  color:
                    entry.outcome === 'cleared'
                      ? palette.done
                      : entry.outcome === 'protected'
                        ? palette.accent
                        : palette.label,
                }}>
                {outcomeLabel(entry)}
              </Text>
            </View>
          ))}
        </View>
      )}
      {protection ? (
        <>
          <Text style={styles.body}>
            This day is protected for {protectionLabel(protection).toLowerCase()}. Completions were
            not invented.
          </Text>
          <Button secondary title="Remove protection" onPress={onClearProtection} />
        </>
      ) : (
        <>
          <Text style={styles.body}>
            Protect this day if illness, travel, recovery, or a technical issue should not break the
            streak. This does not mark anything done.
          </Text>
          {PROTECTION_REASONS.map((reason) => (
            <Button
              key={reason}
              secondary
              title={protectionLabel({ reason, at: '' })}
              label={`Protect this day: ${protectionLabel({ reason, at: '' })}`}
              onPress={() => onProtect(reason)}
            />
          ))}
        </>
      )}
    </>
  );
}
