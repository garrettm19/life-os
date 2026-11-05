import { useState } from 'react';
import { Text, View } from 'react-native';
import { displayDate, localDate, shiftDate, weekdayShort } from '../domain/model';
import { applyCompanionMove, planCompanionMove } from '../domain/rotation';
import { useApp } from '../state/app-state';
import { Button, Chip, SectionLabel, Sheet, styles } from './components';
import { palette, type } from './theme';

export type CompanionMoveTarget = { date: string; routineId: string };

const HORIZON = 14;

/**
 * Preview of moving one companion to another day. The parent workout stays. Confirming saves the
 * whole move at once; a conflict saves nothing.
 */
export function CompanionMoveSheet({
  target,
  close,
}: {
  target: CompanionMoveTarget | null;
  close: () => void;
}) {
  return target ? (
    <Preview key={`${target.date}-${target.routineId}`} target={target} close={close} />
  ) : null;
}

function Preview({ target, close }: { target: CompanionMoveTarget; close: () => void }) {
  const { state, change } = useApp();
  const [today] = useState(() => localDate());
  const block = state.days[target.date]?.blocks.find((b) => b.routineId === target.routineId);
  const original = block?.movedFrom ?? target.date;
  const [to, setTo] = useState(() => shiftDate(target.date, 1));
  const plan = planCompanionMove(state, target.date, target.routineId, to, today);
  const days = Array.from({ length: HORIZON }, (_, i) => shiftDate(today, i));
  const blocked = !!plan.conflict;
  return (
    <Sheet title="Move companion" visible close={close}>
      <Text style={styles.muted}>
        {plan.title} moves to the day you pick. Workouts it follows stay on{' '}
        {displayDate(target.date)}.
      </Text>
      {plan.staying.length > 0 && (
        <Text style={styles.body}>
          Stays put: {plan.staying.join(', ')} · {displayDate(target.date)}
        </Text>
      )}
      <View accessibilityRole="radiogroup" accessibilityLabel="Move to" style={styles.row}>
        {days.map((date) => (
          <Chip
            key={date}
            role="radio"
            title={`${weekdayShort(date)} ${Number(date.slice(8))}`}
            on={to === date}
            onPress={() => setTo(date)}
          />
        ))}
      </View>
      <View style={{ gap: 4 }}>
        <SectionLabel title="Move" />
        <View
          accessible
          accessibilityLabel={`${plan.title}: ${displayDate(plan.from)} to ${displayDate(plan.to)}`}>
          <Text style={{ ...type.item }}>{plan.title}</Text>
          <Text style={{ ...type.meta, color: palette.label }}>
            {displayDate(plan.from).replace(', ', ' ')} → {displayDate(plan.to).replace(', ', ' ')}
          </Text>
        </View>
      </View>
      {blocked && (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={{ ...type.callout, color: palette.accent }}>Cannot move</Text>
          <Text style={styles.body}>{plan.conflict}</Text>
        </View>
      )}
      <Button
        title={`Move ${plan.title} to ${displayDate(plan.to)}`}
        disabled={blocked}
        onPress={() =>
          void change((s) => {
            const fresh = planCompanionMove(s, target.date, target.routineId, to, today);
            return applyCompanionMove(s, fresh, new Date().toISOString(), today);
          }).then((ok) => ok && close())
        }
      />
      {original !== target.date && original >= today && (
        <Button
          secondary
          title={`Return to ${displayDate(original)}`}
          onPress={() =>
            void change((s) => {
              const fresh = planCompanionMove(s, target.date, target.routineId, original, today);
              return applyCompanionMove(s, fresh, new Date().toISOString(), today);
            }).then((ok) => ok && close())
          }
        />
      )}
    </Sheet>
  );
}
