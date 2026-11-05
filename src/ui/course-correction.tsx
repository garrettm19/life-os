import { useState } from 'react';
import { Text, View } from 'react-native';
import { activeFocus } from '../domain/focus';
import { focusEvidence } from '../domain/focus-evidence';
import { localDate, shiftDate, weekStartOf } from '../domain/model';
import {
  deleteWeeklyReview,
  lastAdjustment,
  pastReviews,
  reviewFor,
  saveWeeklyReview,
} from '../domain/weekly-reviews';
import { useApp } from '../state/app-state';
import { shortDate } from './chart-scale';
import { Button, Chip, Field, SectionLabel, Sheet, styles } from './components';
import { Disclosure, LinkButton } from './controls';
import { newId } from './ids';
import { palette, type } from './theme';

/** Starting points the user can edit; choosing one changes nothing on the plan. */
const IDEAS = [
  'Start study earlier in the day',
  'Make the first step smaller',
  'Move one workout to a better day',
  'Practice a weaker topic',
];

function WeeklySheet({ weekStart, close }: { weekStart: string; close: () => void }) {
  const { state, change } = useApp();
  const saved = reviewFor(state, weekStart);
  const [obstacle, setObstacle] = useState(saved?.obstacle ?? '');
  const [adjustment, setAdjustment] = useState(saved?.adjustment ?? '');
  const [noChange, setNoChange] = useState(saved?.noChange ?? false);
  const done = (ok: boolean) => ok && close();
  return (
    <Sheet title={`Week of ${shortDate(weekStart)}`} visible close={close}>
      <Field
        label="What was the biggest obstacle? (optional)"
        value={obstacle}
        onChange={setObstacle}
        multiline
      />
      <Chip
        title="No adjustment needed"
        role="checkbox"
        on={noChange}
        onPress={() => setNoChange(!noChange)}
      />
      {!noChange && (
        <>
          <Field
            label="One adjustment for the week ahead"
            value={adjustment}
            onChange={setAdjustment}
            multiline
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {IDEAS.map((idea) => (
              <Chip
                key={idea}
                title={idea}
                role="radio"
                on={adjustment === idea}
                onPress={() => setAdjustment(idea)}
              />
            ))}
          </View>
        </>
      )}
      <Text style={styles.muted}>
        Nothing on your plan changes by itself. If the adjustment needs a new time or day, change it
        in Programs.
      </Text>
      <Button
        title="Save review"
        disabled={!obstacle.trim() && !adjustment.trim() && !noChange}
        needs="Write the obstacle or one adjustment, or choose No adjustment needed, to save."
        onPress={() =>
          void change((s) =>
            saveWeeklyReview(
              s,
              { weekStart, obstacle, adjustment, noChange },
              newId('week'),
              new Date().toISOString(),
            ),
          ).then(done)
        }
      />
      {saved && (
        <Button
          secondary
          title="Remove this review"
          onPress={() => void change((s) => deleteWeeklyReview(s, weekStart)).then(done)}
        />
      )}
    </Sheet>
  );
}

/**
 * The two-minute weekly course correction on Progress, under This week: the focus's recorded evidence for the last
 * seven days, last week's adjustment, and two optional questions. One review per week; earlier
 * weeks stay readable and editable. It never changes the plan and never blocks Day Cleared.
 */
export function CourseCorrection() {
  const { state } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  if (!state.programs.length) return null;
  const today = localDate();
  // On a Monday the week has just begun: the review is for the week that ended, unless that one
  // is already reviewed (or this one already started).
  const thisWeek = weekStartOf(today);
  const lastWeek = shiftDate(thisWeek, -7);
  const week =
    today === thisWeek && !reviewFor(state, lastWeek) && !reviewFor(state, thisWeek)
      ? lastWeek
      : thisWeek;
  const weekLabel = week === thisWeek ? 'this week' : `the week of ${shortDate(week)}`;
  const focus = activeFocus(state);
  const saved = reviewFor(state, week);
  const previous = lastAdjustment(state, week);
  // The evidence covers the week being reviewed: last week in full on a Monday, else the last
  // seven days.
  const past = week !== thisWeek;
  const from = past ? week : shiftDate(today, -6);
  const to = past ? shiftDate(week, 6) : today;
  // Checkpoints have their own section below, so their line is not repeated here.
  const evidence = focus
    ? focusEvidence(
        state,
        focus,
        today,
        focus.startDate > from ? focus.startDate : from,
        to,
      ).filter((line) => line.label !== 'Skill checkpoints')
    : [];
  const earlier = pastReviews(state).filter((r) => r.weekStart !== week);
  const focusTitle = (id: string | null) => state.focuses.find((f) => f.id === id)?.title;
  return (
    <View style={styles.section}>
      <SectionLabel title="Weekly course correction" />
      <View style={styles.card}>
        {focus && (
          <Text style={{ ...type.meta, color: palette.accent }}>
            Focus · {focus.title} · {past ? `week of ${shortDate(week)}` : 'last 7 days'}
          </Text>
        )}
        {evidence.map((line, i) => (
          <View key={i} style={{ gap: 0 }}>
            <Text style={type.item}>{line.label}</Text>
            <Text style={type.caption}>{line.value}</Text>
          </View>
        ))}
        {previous && (
          <Text style={type.caption}>
            Adjustment from the week of {shortDate(previous.weekStart)}: {previous.adjustment}
          </Text>
        )}
        {saved ? (
          <View style={{ gap: 2 }}>
            <Text style={type.item}>Week of {shortDate(week)}</Text>
            {!!saved.obstacle && <Text style={styles.body}>Obstacle: {saved.obstacle}</Text>}
            <Text style={styles.body}>
              {saved.noChange ? 'No adjustment needed' : `Adjustment: ${saved.adjustment || '—'}`}
            </Text>
            <LinkButton
              title="Edit this review"
              label={`Edit the review for the week of ${shortDate(week)}`}
              onPress={() => setEditing(week)}
            />
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>
              Optional: what got in the way {weekLabel}, and one change for the week ahead.
            </Text>
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                small
                secondary
                title={
                  week === thisWeek ? 'Review this week' : `Review the week of ${shortDate(week)}`
                }
                onPress={() => setEditing(week)}
              />
            </View>
          </View>
        )}
        {earlier.length > 0 && (
          <Disclosure title="Earlier weeks" summary={String(earlier.length)} plain>
            {earlier.map((r) => (
              <View key={r.id} style={{ gap: 2 }}>
                <Text style={type.item}>
                  Week of {shortDate(r.weekStart)}
                  {focusTitle(r.focusId) ? ` · ${focusTitle(r.focusId)}` : ''}
                </Text>
                {!!r.obstacle && <Text style={type.caption}>Obstacle: {r.obstacle}</Text>}
                <Text style={type.caption}>
                  {r.noChange ? 'No adjustment needed' : `Adjustment: ${r.adjustment || '—'}`}
                </Text>
                <LinkButton
                  title="Edit"
                  label={`Edit the review for the week of ${shortDate(r.weekStart)}`}
                  tone="dim"
                  onPress={() => setEditing(r.weekStart)}
                />
              </View>
            ))}
          </Disclosure>
        )}
      </View>
      {editing && <WeeklySheet weekStart={editing} close={() => setEditing(null)} />}
    </View>
  );
}
