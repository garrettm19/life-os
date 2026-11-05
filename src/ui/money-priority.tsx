import { Text, View } from 'react-native';
import { MoneyReview, displayDate, localDate } from '../domain/model';
import { setPriorityDone } from '../domain/money';
import { useApp } from '../state/app-state';
import { doneAt } from './objective-row';
import { CheckSquare } from './mission';
import { palette, radius, type } from './theme';

/**
 * The week's money priority with its own check. Marking it done records only that; it is not an
 * objective and never affects Day Cleared.
 */
export function PriorityLine({ review }: { review: MoneyReview }) {
  const { change } = useApp();
  const done = !!review.priorityDoneAt;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <CheckSquare
        status={done ? 'done' : 'planned'}
        label={
          done
            ? `Reopen money priority: ${review.nextAction}`
            : `Mark money priority done: ${review.nextAction}`
        }
        onPress={() =>
          void change((s) => setPriorityDone(s, review.id, done ? null : new Date().toISOString()))
        }
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            ...type.item,
            color: done ? palette.label2 : palette.label,
          }}>
          {review.nextAction}
        </Text>
        <Text style={{ ...type.caption, color: done ? palette.doneText : palette.label3 }}>
          {done && review.priorityDoneAt
            ? `Done · ${displayDate(localDate(new Date(review.priorityDoneAt)))} · ${doneAt(review.priorityDoneAt)}`
            : `Set ${displayDate(review.date)} · open`}
        </Text>
      </View>
    </View>
  );
}

/** Today's reminder of the week's money priority, below the board. */
export function MoneyPriorityCard({ review }: { review: MoneyReview }) {
  return (
    <View
      testID="money-priority"
      style={{
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.separator,
        borderRadius: radius.card,
        padding: 14,
        gap: 10,
      }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
        <Text style={{ ...type.meta, color: palette.accent }}>Money priority · this week</Text>
        <Text style={type.meta}>Not part of Day Cleared</Text>
      </View>
      <PriorityLine review={review} />
    </View>
  );
}
