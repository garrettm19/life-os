import { Text, View } from 'react-native';
import { CareerLine, DayMark, careerProgress } from '../domain/career';
import { calendarDays, localDate } from '../domain/model';
import { studyCalendar } from '../domain/study-calendar';
import { routineOf } from '../domain/workouts';
import { StudyCalendarView } from './study-calendar';
import { useApp } from '../state/app-state';
import { SectionLabel, styles } from './components';
import { fonts, palette, type } from './theme';

const CELL = 9;

function cellStyle(mark: DayMark) {
  if (mark === 'done') return { backgroundColor: palette.done, borderColor: palette.done };
  if (mark === 'skipped')
    return { backgroundColor: 'transparent', borderColor: palette.placeholder };
  if (mark === 'open') return { backgroundColor: palette.fillStrong, borderColor: palette.edge };
  // Not due or not recorded: a low dash, so it never looks like an empty box to fill.
  return {
    backgroundColor: palette.separator,
    borderColor: 'transparent',
    height: 3,
    alignSelf: 'center' as const,
  };
}

/**
 * The window as one row of small cells: done Fern, skipped outlined, open slot, and a low dash for
 * a day not due or not recorded.
 */
function DayStrip({ line }: { line: CareerLine }) {
  return (
    <View
      accessible
      accessibilityLabel={`${line.title}, last 4 weeks: ${line.done} done, ${line.skipped} skipped, ${line.open} left open, of ${line.due} recorded.`}
      style={{ flexDirection: 'row', gap: 2 }}>
      {/* One row that always fits: each day takes an equal share of the width. */}
      {line.marks.map((m) => (
        <View
          key={m.date}
          style={[
            { flex: 1, maxWidth: 12, height: CELL, borderRadius: 2, borderWidth: 1 },
            cellStyle(m.mark),
          ]}
        />
      ))}
    </View>
  );
}

function StudyLine({ line, streak }: { line: CareerLine; streak: boolean }) {
  const { state } = useApp();
  const s = line.study!;
  const routine = routineOf(state, line.routineId);
  const timed = [
    s.full ? `${s.full} full timed session${s.full === 1 ? '' : 's'}` : null,
    s.shorter ? `${s.shorter} shorter timed session${s.shorter === 1 ? '' : 's'}` : null,
    s.minutes ? `${s.minutes} min timed` : null,
  ].filter(Boolean);
  if (!routine) return null;
  return (
    <View style={{ gap: 8 }}>
      {/* The calendar follows the study streak's rules exactly (src/domain/study-calendar.ts). */}
      <StudyCalendarView
        title={line.title}
        calendar={studyCalendar(state, routine, localDate(), calendarDays(localDate()))}
        streak={streak}
      />
      {timed.length > 0 && <Text style={type.caption}>Optional timer: {timed.join(' · ')}</Text>}
    </View>
  );
}

function CheckLine({ line }: { line: CareerLine }) {
  // Until a day is recorded, a strip of blanks reads as failure: one quiet line instead.
  if (!line.due)
    return (
      <View style={{ gap: 6 }}>
        <Text style={type.item}>{line.title}</Text>
        <Text style={styles.muted}>
          No recorded day yet. The strip fills in as days are done or skipped.
        </Text>
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.spread, { alignItems: 'flex-start' }]}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={type.item}>{line.title}</Text>
          <Text style={type.caption}>
            <Text style={{ ...fonts.figure, color: palette.label }}>
              {line.done} of {line.due}
            </Text>{' '}
            recorded days done
          </Text>
        </View>
        {line.skipped > 0 && <Text style={type.caption}>{line.skipped} skipped</Text>}
      </View>
      <DayStrip line={line} />
      <Text style={{ ...type.caption, color: palette.label2 }}>
        Oldest day first: filled done, outlined skipped, gray left open, a dash when not due.
      </Text>
    </View>
  );
}

/**
 * Study and career, folded on Progress: the study calendar with its streak, and the career
 * objectives over the last four weeks, from recorded days only. A view of the existing objectives,
 * not a second tracker.
 */
export function CareerProgress({ bare = false }: { bare?: boolean }) {
  const { state } = useApp();
  // Whole Monday-to-Sunday weeks, so the days match the calendar above and Week.
  const lines = careerProgress(state, localDate(), calendarDays(localDate()));
  if (!lines.length) return null;
  // The Study tile above shows the first study objective's streak (studyDays in
  // src/domain/progress.ts), so its calendar leaves it out: each figure once.
  const onTile = lines.find((l) => l.study)?.routineId;
  const body = (
    <View style={bare ? { gap: 20 } : [styles.card, { gap: 20 }]}>
      {lines.map((line) =>
        line.study ? (
          <StudyLine key={line.routineId} line={line} streak={line.routineId !== onTile} />
        ) : (
          <CheckLine key={line.routineId} line={line} />
        ),
      )}
      <Text style={type.caption}>
        A scheduled study day you never opened counts as missed, from the day tracking started.
      </Text>
    </View>
  );
  // Folded on Progress, the section's frame is the fold around it.
  if (bare) return body;
  return (
    <View style={styles.section}>
      <SectionLabel title="Study and career" />
      {body}
    </View>
  );
}
