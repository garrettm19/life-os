import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { MonthDay, calendarMonths, monthOutcomes } from '../domain/objectives';
import { State, dateObject } from '../domain/model';
import { styles } from './components';
import { PressableScale } from './motion';
import { Glyph } from './settings-icon';
import { CellLook, DayGrid } from './study-calendar';
import { fonts, palette, type } from './theme';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "November" for "2026-11". */
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

/**
 * How a day reads on the month calendar. A cleared day is a Fern seal with a check, and a protected
 * one a ring around its date; a past day not cleared shows its date in faint text, never red, and a
 * day never opened, with nothing due or still to come is fainter still: never a miss. Today is
 * ringed in Ember (the halo).
 */
function look(day: MonthDay): CellLook {
  const date = String(dateObject(day.date).getDate());
  const plain = { border: 'transparent', fill: 'transparent', mark: day.outcome };
  if (day.outcome === 'cleared')
    return {
      symbol: '✓',
      color: palette.onDone,
      border: palette.done,
      fill: palette.done,
      mark: 'cleared',
    };
  if (day.outcome === 'protected')
    return { ...plain, symbol: date, color: palette.label2, border: palette.accentEdge, edge: 2 };
  if (day.outcome === 'open')
    return { ...plain, symbol: date, color: day.today ? palette.label : palette.label3 };
  return { ...plain, symbol: date, color: day.today ? palette.label : palette.placeholder };
}

const WORDS: Record<MonthDay['outcome'], string> = {
  cleared: 'cleared',
  protected: 'protected',
  open: 'not cleared',
  absent: 'not recorded',
  empty: 'nothing due',
  later: 'still to come',
};

/** "November 3, cleared": one VoiceOver label per day. */
export function monthDayLabel(day: MonthDay): string {
  const d = dateObject(day.date);
  const words = day.today && day.outcome === 'open' ? 'today, in progress' : WORDS[day.outcome];
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${words}`;
}

/** The month's days as Monday-first weeks: empty columns before the 1st. */
function padded(days: MonthDay[]): (MonthDay | null)[] {
  const lead = (dateObject(days[0].date).getDay() + 6) % 7;
  return [...Array<null>(lead).fill(null), ...days];
}

/**
 * The Day Clear streak as a month of days, Monday to Sunday: every day read with `dayOutcome`, the
 * one rule. One line says how many days were cleared in the month, never a miss count, percentage
 * or comparison. The arrows move a month at a time, back to the first recorded day's month; it
 * opens on this month. Tapping a day opens it.
 */
export function MonthCalendar({
  state,
  today,
  onOpenDay,
}: {
  state: State;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const months = useMemo(() => calendarMonths(state, today), [state, today]);
  const [index, setIndex] = useState(months.length - 1);
  const month = months[Math.min(index, months.length - 1)];
  const view = useMemo(() => monthOutcomes(state, month, today), [state, month, today]);
  const name = monthName(month);
  const year = month.slice(0, 4);
  const sameYear = year === today.slice(0, 4);
  const at = Math.min(index, months.length - 1);
  const clearedLine =
    view.cleared > 0
      ? `${view.cleared} ${view.cleared === 1 ? 'day' : 'days'} cleared in ${name}`
      : `No cleared days in ${name} yet`;
  return (
    <View testID="month-calendar" style={{ gap: 8 }}>
      <View style={[styles.spread, { alignItems: 'center' }]}>
        <Arrow
          label={at > 0 ? `Show ${monthName(months[at - 1])}` : 'No earlier month'}
          disabled={at === 0}
          flip
          onPress={() => setIndex(at - 1)}
        />
        <View style={{ alignItems: 'center', flexShrink: 1 }}>
          <Text accessibilityRole="header" style={type.item}>
            {sameYear ? name : `${name} ${year}`}
          </Text>
          <Text
            accessibilityLabel={clearedLine}
            style={{ ...type.caption, color: palette.label2, textAlign: 'center' }}>
            {view.cleared > 0 ? (
              <>
                <Text style={{ ...fonts.figure, color: palette.doneText }}>{view.cleared}</Text>
                {view.cleared === 1 ? ' day' : ' days'} cleared in {name}
              </>
            ) : (
              `No cleared days in ${name} yet`
            )}
          </Text>
        </View>
        <Arrow
          label={at < months.length - 1 ? `Show ${monthName(months[at + 1])}` : 'No later month'}
          disabled={at >= months.length - 1}
          onPress={() => setIndex(at + 1)}
        />
      </View>
      <DayGrid
        days={padded(view.days)}
        look={look}
        selected={null}
        onSelect={(date) => {
          if (date && date <= today) onOpenDay(date);
        }}
        testID={(d) => `month-day:${d.date}`}
        label={monthDayLabel}
        halo={(d) => (d.today ? palette.accent : null)}
        hint="Opens this day."
      />
      <Text style={{ ...type.caption, color: palette.label3 }}>
        ✓ cleared · ringed date protected
      </Text>
    </View>
  );
}

function Arrow({
  label,
  disabled,
  flip,
  onPress,
}: {
  label: string;
  disabled: boolean;
  flip?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : 1,
      }}>
      <View style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
        <Glyph name="chevron" color={palette.label2} size={14} />
      </View>
    </PressableScale>
  );
}
