import { useState } from 'react';
import { ColorValue, Text, View } from 'react-native';
import { displayDate } from '../domain/model';
import { CalendarMark, MARK_LABELS, StudyCalendar } from '../domain/study-calendar';
import { studyStreakLine } from '../domain/study-streak';
import { WEEKDAY_HEADINGS, weekRows } from './chart-scale';
import { styles } from './components';
import { PressableScale } from './motion';
import { fonts, palette, radius, type } from './theme';

/** Each state has its own symbol as well as its color. */
const CELL: Record<CalendarMark, CellLook> = {
  completed: { symbol: '✓', color: palette.onDone, border: palette.done, fill: palette.done },
  missed: {
    symbol: '×',
    color: palette.label2,
    border: palette.edge,
    fill: 'transparent',
  },
  held: { symbol: '–', color: palette.accent, border: palette.accentEdge, fill: 'transparent' },
  // A dot with no tile, in meta like the other small status marks.
  none: { symbol: '·', color: palette.label3, border: 'transparent', fill: 'transparent' },
  // Before tracking started there is nothing to show: a blank cell, not an empty box.
  before: { symbol: '', color: palette.placeholder, border: 'transparent', fill: 'transparent' },
  open: { symbol: '', color: palette.accent, border: palette.accent, fill: 'transparent' },
};

/**
 * How a day's mark looks: its symbol or its shape as well as its color, so neither carries meaning
 * alone. A `dot` is a small dot in `color` instead of a full circle; `edge` is the circle's border
 * width (1 by default); `mark` names the state for the browser tests (a `data-mark` attribute).
 */
export type CellLook = {
  symbol: string;
  color: ColorValue;
  border: ColorValue;
  fill: ColorValue;
  dot?: boolean;
  edge?: number;
  mark?: string;
};

/**
 * The weekday headings and the day squares, Monday to Sunday, oldest week first; the rest of this
 * week is left empty. Tapping a day selects it (again clears it). With `label`, each day is its own
 * VoiceOver button (the study calendar); without it the squares are only for the eye and touch, and
 * the grid is read by the one element around it (the Mornings card).
 */
export function DayGrid<T extends { date: string }>({
  days,
  look,
  selected,
  onSelect,
  testID,
  label,
  halo,
}: {
  days: T[];
  look: (day: T) => CellLook;
  selected: string | null;
  onSelect: (date: string | null) => void;
  testID: (day: T) => string;
  label?: (day: T) => string;
  /** A ring drawn around a day's mark, a little apart from it: today on the Mornings card. */
  halo?: (day: T) => ColorValue | null;
}) {
  const rows = weekRows(days);
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {WEEKDAY_HEADINGS.map((d) => (
          <Text
            key={d}
            accessibilityElementsHidden
            importantForAccessibility="no"
            aria-hidden
            maxFontSizeMultiplier={1.4}
            style={{ ...type.meta, flex: 1, textAlign: 'center', fontSize: 10 }}>
            {d}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        // No gaps between the touch areas: each day's button is its whole column, 44 pt tall,
        // and the compact square is drawn inside it.
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((d, i) => {
            // The rest of this week: an empty column, nothing to tap.
            if (!d) return <View key={`later-${i}`} style={{ flex: 1, minHeight: 44 }} />;
            const cell = look(d);
            const on = d.date === selected;
            const access = label
              ? {
                  accessibilityRole: 'button' as const,
                  accessibilityLabel: label(d),
                  accessibilityHint: on ? 'Selected. Tap again to clear.' : 'Shows this day below.',
                  accessibilityState: { selected: on },
                  'aria-selected': on,
                }
              : { accessible: false, focusable: false };
            return (
              <PressableScale
                key={d.date}
                testID={testID(d)}
                {...access}
                onPress={() => onSelect(on ? null : d.date)}
                containerStyle={{ flex: 1 }}
                style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Mark cell={cell} on={on} halo={halo?.(d) ?? null} />
              </PressableScale>
            );
          })}
        </View>
      ))}
    </>
  );
}

/** One day's mark: a circle with its symbol, or a small dot, ringed when selected or haloed. */
function Mark({ cell, on, halo }: { cell: CellLook; on: boolean; halo: ColorValue | null }) {
  const ring = on ? palette.label : halo;
  const circle = (
    <View
      {...{ dataSet: cell.mark ? { mark: cell.mark } : undefined }}
      style={{
        width: ring ? '100%' : '78%',
        maxWidth: ring ? 28 : 34,
        aspectRatio: 1,
        borderRadius: radius.check,
        borderWidth: cell.dot ? 0 : (cell.edge ?? 1),
        borderColor: cell.border,
        backgroundColor: cell.fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {cell.dot ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cell.color }} />
      ) : (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ ...fonts.figure, fontSize: 13, color: cell.color }}>
          {cell.symbol}
        </Text>
      )}
    </View>
  );
  if (!ring) return circle;
  // A ring 2 pt outside the mark, so a filled disc keeps its shape inside it.
  return (
    <View
      style={{
        width: '78%',
        maxWidth: 34,
        aspectRatio: 1,
        borderRadius: radius.check,
        borderWidth: 2,
        borderColor: ring,
        padding: 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {circle}
    </View>
  );
}

/**
 * Four weeks of study as a calendar, Monday to Sunday as on Week, oldest week first; the rest of
 * this week is left empty. Tapping a day says what it was; VoiceOver reads each day with its date
 * and status. The calendar's days start on a Monday (`calendarDays` in src/domain/model.ts).
 */
export function StudyCalendarView({
  title,
  calendar,
  streak = true,
}: {
  title: string;
  calendar: StudyCalendar;
  /** False where the streak is already on screen (the Study tile on Progress). */
  streak?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const pick = calendar.days.find((d) => d.date === selected);
  if (!calendar.streak.since)
    return (
      <View style={{ gap: 6 }}>
        <Text style={type.item}>{title}</Text>
        <Text style={styles.muted}>
          Study tracking starts when this objective is set up as a study session in Programs.
        </Text>
      </View>
    );
  // Until a study day is scored, a grid of blanks reads as failure: one quiet line instead.
  if (
    !calendar.days.some((d) => d.mark === 'completed' || d.mark === 'missed' || d.mark === 'held')
  )
    return (
      <View style={{ gap: 6 }}>
        <Text style={type.item}>{title}</Text>
        <Text style={styles.muted}>
          No study day scored yet. The calendar fills in from the first one.
        </Text>
      </View>
    );
  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.spread, { alignItems: 'flex-start' }]}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={type.item}>{title}</Text>
          <Text
            accessibilityLabel={`${calendar.completed} completed of ${calendar.eligible} eligible study days in the last 4 weeks`}
            style={type.caption}>
            <Text style={{ ...fonts.figure, color: palette.label }}>
              {calendar.completed} of {calendar.eligible}
            </Text>{' '}
            study days done · last 4 weeks
          </Text>
        </View>
        {streak && (
          <Text
            style={{
              ...type.caption,
              color: calendar.streak.current ? palette.doneText : palette.label3,
            }}>
            {studyStreakLine(calendar.streak)}
          </Text>
        )}
      </View>
      <DayGrid
        days={calendar.days}
        look={(d) => CELL[d.mark]}
        selected={selected}
        onSelect={setSelected}
        testID={(d) => `study-day:${d.date}`}
        label={(d) => `${displayDate(d.date)}: ${MARK_LABELS[d.mark]}`}
      />
      <Text
        accessibilityLiveRegion="polite"
        aria-live="polite"
        style={{ ...type.caption, color: palette.label2 }}>
        {pick
          ? `${displayDate(pick.date)} · ${MARK_LABELS[pick.mark]}`
          : '✓ completed  × missed  – held  · not a study day'}
      </Text>
    </View>
  );
}
