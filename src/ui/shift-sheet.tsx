import { useState } from 'react';
import { Text, View } from 'react-native';
import { displayDate, localDate, shiftDate } from '../domain/model';
import { applyShift, planShift, SHIFT_WINDOW_DAYS } from '../domain/sequence';
import { useApp } from '../state/app-state';
import { Button, SectionLabel, Sheet, styles } from './components';
import { Toggle } from './list';
import { palette, type } from './theme';

export type ShiftTarget = { date: string; routineId: string; mode: 'forward' | 'restore' };

/**
 * Previews a sequence shift before anything changes: what moves (old and new dates), what stays,
 * and any conflict. Confirming saves the whole shift at once; a conflict saves nothing.
 */
export function ShiftSheet({ target, close }: { target: ShiftTarget | null; close: () => void }) {
  return target ? (
    <ShiftPreview
      key={`${target.date}-${target.routineId}-${target.mode}`}
      target={target}
      close={close}
    />
  ) : null;
}

function ShiftPreview({ target, close }: { target: ShiftTarget; close: () => void }) {
  const { state, change } = useApp();
  const [today] = useState(() => localDate());
  const [withoutTime, setWithoutTime] = useState(false);
  const plan = planShift(
    state,
    { date: target.date, routineId: target.routineId },
    target.mode,
    today,
  );
  const blocked = plan.conflicts.length > 0;
  const needsChoice = plan.slotConflicts.length > 0 && !withoutTime;
  return (
    <Sheet
      title={target.mode === 'forward' ? 'Move workouts +1 day' : 'Return to original days'}
      visible
      close={close}>
      <Text style={styles.muted}>
        {target.mode === 'forward'
          ? `This workout and this program’s planned workouts through ${displayDate(shiftDate(target.date, SHIFT_WINDOW_DAYS - 1))} move one day later, keeping their order and spacing. Workouts after that stay where they are, as do completed workouts, other plans and appointments.`
          : `Moved workouts from here through ${displayDate(shiftDate(target.date, SHIFT_WINDOW_DAYS))} go back to the days they were first planned on.`}
      </Text>
      {plan.moves.length > 0 && (
        <View style={{ gap: 4 }}>
          <SectionLabel title="Moves" count={String(plan.moves.length)} />
          {plan.moves.map((m) => (
            <View
              key={`${m.occurrence.date}-${m.occurrence.routineId}`}
              accessible
              accessibilityLabel={`${m.occurrence.title}: ${displayDate(m.occurrence.date)} to ${displayDate(m.to)}${m.note ? `. ${m.note}` : ''}`}
              style={{ paddingVertical: 6, gap: 2 }}>
              <View style={styles.spread}>
                <Text style={{ ...type.item, flexShrink: 1 }}>{m.occurrence.title}</Text>
                <Text style={{ ...type.meta, color: palette.label }}>
                  {displayDate(m.occurrence.date).replace(', ', ' ')} →{' '}
                  {displayDate(m.to).replace(', ', ' ')}
                </Text>
              </View>
              {m.note && <Text style={{ ...type.muted, color: palette.accent }}>{m.note}</Text>}
            </View>
          ))}
        </View>
      )}
      {plan.unchanged.length > 0 && (
        <View style={{ gap: 4 }}>
          <SectionLabel title="Stays" count={String(plan.unchanged.length)} />
          {plan.unchanged.map((o) => (
            <Text key={`${o.date}-${o.routineId}`} style={styles.muted}>
              {o.title} · {displayDate(o.date)}
              {o.status !== 'planned' ? ` · ${o.status === 'done' ? 'done' : 'skipped'}` : ''}
            </Text>
          ))}
        </View>
      )}
      {(blocked || plan.slotConflicts.length > 0) && (
        <View accessibilityRole="alert" style={styles.notice}>
          <Text style={{ ...type.callout, color: palette.accent }}>
            {blocked ? 'Cannot move — nothing changed' : 'Needs your decision'}
          </Text>
          {[...plan.conflicts, ...plan.slotConflicts].map((c) => (
            <Text key={c} style={styles.body}>
              {c}
            </Text>
          ))}
          {!blocked && plan.slotConflicts.length > 0 && (
            <Toggle
              title="Move them without a time"
              detail={withoutTime ? 'On' : 'Off'}
              label="Move fixed sessions without a time"
              value={withoutTime}
              onChange={setWithoutTime}
            />
          )}
        </View>
      )}
      <Button
        title={
          target.mode === 'forward'
            ? `Move ${plan.moves.length} workout${plan.moves.length === 1 ? '' : 's'}`
            : 'Return them'
        }
        disabled={blocked || needsChoice || !plan.moves.length}
        onPress={() =>
          void change((s) => {
            // Re-plan on the saved state; if anything differs from the preview shown, save nothing.
            const fresh = planShift(
              s,
              { date: target.date, routineId: target.routineId },
              target.mode,
              today,
            );
            if (JSON.stringify(fresh) !== JSON.stringify(plan))
              throw new Error('The plan changed since this preview. Check it again before moving.');
            return applyShift(s, fresh, withoutTime, new Date().toISOString(), today);
          }).then((ok) => ok && close())
        }
      />
    </Sheet>
  );
}
