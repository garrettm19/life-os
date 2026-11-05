import {
  HeldRoutines,
  configuredOccurrences,
  coverageLine,
  programCoverage,
} from '../domain/bundles';
import { Link } from 'expo-router';
import { useMemo } from 'react';
import { ColorValue, Text, View } from 'react-native';
import { useApp } from '../state/app-state';
import { dateObject, displayDate, shiftDate, weekdayShort, weekStartOf } from '../domain/model';
import { AgendaDay, AgendaEntry, weekAgenda } from '../domain/week-agenda';
import { projectRotation } from '../domain/rotation';
import { loggedBlockIds } from '../domain/workouts';
import { shortDate } from '../ui/chart-scale';
import { Page, SectionLabel, styles } from '../ui/components';
import { Disclosure } from '../ui/controls';
import { PressableScale } from '../ui/motion';
import { fonts, palette, radius, type } from '../ui/theme';
import { useToday } from '../ui/use-today';

/**
 * The day's state: Cleared, Protected, Not opened or Before you started in words; a later day's
 * planned count; else the done count ("5 of 7"), read with the one Day Cleared count so it matches
 * Today.
 */
type DayState =
  | { kind: 'word'; text: string; color: ColorValue }
  | { kind: 'count'; done: number; total: number; cleared: boolean };

function dayState(d: AgendaDay, today: string): DayState {
  const { done, total } = d.progress;
  if (d.outcome === 'cleared') return { kind: 'count', done, total, cleared: true };
  if (d.outcome === 'protected') return { kind: 'word', text: 'Protected', color: palette.accent };
  // A day from before tracking started was never a day to open.
  if (d.beforeStart) return { kind: 'word', text: 'Before you started', color: palette.label3 };
  if (!d.saved && d.date < today)
    return { kind: 'word', text: 'Not opened', color: palette.label3 };
  const count = d.date > today ? d.planned : total;
  // Every objective skipped and nothing done: something was due, so not Nothing due.
  if (!count && d.outcome === 'open')
    return { kind: 'word', text: 'All skipped', color: palette.label3 };
  if (!count)
    return {
      kind: 'word',
      text: d.rest.length ? 'Rest day' : 'Nothing due',
      color: palette.label3,
    };
  if (d.date > today) return { kind: 'word', text: `Planned · ${count}`, color: palette.label3 };
  return { kind: 'count', done, total, cleared: false };
}

function stateWords(s: DayState): string {
  if (s.kind === 'word') return s.text;
  return `${s.cleared ? 'Cleared, ' : ''}${s.done} of ${s.total} done`;
}

/** "5 of 7" over a thin bar; Fern and marked once the day is cleared. */
function DayCount({ state }: { state: Extract<DayState, { kind: 'count' }> }) {
  const share = state.total ? state.done / state.total : 0;
  return (
    <View style={{ gap: 5 }}>
      {/* At large text sizes ✓ Cleared moves to its own line whole; the count never breaks. */}
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 0,
            ...fonts.figure,
            fontSize: 15,
            lineHeight: 20,
            color: state.cleared ? palette.done : palette.label,
          }}>
          {state.done} of {state.total}
        </Text>
        {state.cleared && (
          <Text
            numberOfLines={1}
            style={{ ...type.caption, ...fonts.semibold, color: palette.done }}>
            ✓ Cleared
          </Text>
        )}
      </View>
      <View
        testID="day-bar"
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: palette.fillStrong,
          overflow: 'hidden',
        }}>
        <View
          style={{
            width: `${Math.round(share * 100)}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: palette.done,
          }}
        />
      </View>
    </View>
  );
}

/**
 * A workout and its state; on a past day, one still planned says it was not done, or that its
 * logged sets are saved and can still be finished.
 */
function workoutLine(w: AgendaEntry, past: boolean, logged: Set<string>): string {
  const title = w.time ? `${w.time} ${w.title}` : w.title;
  if (w.projected) return `${title} · projected`;
  if (w.status === 'done') return `${title} · done`;
  if (w.status === 'skipped') return `${title} · skipped`;
  if (past) return `${title} · ${logged.has(w.id) ? 'sets saved, not finished' : 'not done'}`;
  if (w.movedFrom) return `${title} · moved from ${weekdayShort(w.movedFrom)}`;
  return title;
}

/** One day of the agenda: its workouts, timed commitments and the count of untimed habits. */
function AgendaRow({
  day,
  today,
  logged,
}: {
  day: AgendaDay;
  today: string;
  /** Occurrences with logged sets not yet finished. */
  logged: Set<string>;
}) {
  const status = dayState(day, today);
  const on = day.date === today;
  const past = day.date < today;
  const workouts = day.workouts.map((w) => workoutLine(w, past, logged));
  const timed = day.timed.map(
    (t) =>
      `${t.time} ${t.title}${t.status === 'done' ? ' · done' : t.status === 'skipped' ? ' · skipped' : past ? ' · not done' : ''}`,
  );
  // The habits and rest days in one quiet line: they repeat from day to day.
  const quiet = [
    ...(day.habits.due
      ? [
          `${day.habits.due} habit${day.habits.due === 1 ? '' : 's'} due${day.habits.done ? ` · ${day.habits.done} done` : ''}`,
        ]
      : []),
    ...day.rest.map((p) => `${p} · rest day`),
  ];
  const lines = [...workouts, ...timed, ...quiet];
  return (
    <Link href={{ pathname: '/', params: { date: day.date } }} asChild>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`${displayDate(day.date)}${on ? ', today' : ''}. ${stateWords(status)}. ${lines.join('. ')}${lines.length ? '. ' : ''}Open day`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 12,
          paddingLeft: 12,
          paddingRight: 10,
          borderRadius: radius.row,
          borderWidth: on ? 1 : 0,
          borderColor: palette.accentEdge,
          backgroundColor: on ? palette.accentTint : 'transparent',
        }}>
        <View style={{ width: 40, alignItems: 'center', alignSelf: 'flex-start' }}>
          <Text
            style={{
              ...type.caption,
              ...fonts.semibold,
              color: on ? palette.accentText : palette.label3,
            }}>
            {weekdayShort(day.date)}
          </Text>
          <Text
            style={{
              ...fonts.figureHeavy,
              fontSize: 22,
              lineHeight: 28,
              color: day.outcome === 'cleared' ? palette.doneText : palette.label,
            }}>
            {dateObject(day.date).getDate()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          {status.kind === 'count' ? (
            <View style={{ marginBottom: 2 }}>
              <DayCount state={status} />
            </View>
          ) : (
            <Text style={{ ...type.caption, ...fonts.semibold, color: status.color }}>
              {status.text}
            </Text>
          )}
          {[...workouts, ...timed].map((line, i) => (
            <Text key={i} style={{ ...type.item, fontSize: 15, lineHeight: 20 }}>
              {line}
            </Text>
          ))}
          {quiet.length > 0 && (
            <Text style={{ ...type.caption, color: palette.label2 }}>{quiet.join(' · ')}</Text>
          )}
        </View>
        <Text
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ ...fonts.semibold, fontSize: 20, color: palette.label3 }}>
          ›
        </Text>
      </PressableScale>
    </Link>
  );
}

const TRACK = 64;

/**
 * The week at a glance: a column per day, Monday to Sunday, filled by the share of its required
 * objectives done (the one Day Cleared count): Fern to the top once cleared, today in Ember, a
 * later day an empty track. One element for VoiceOver, in words; the day cards below open each day.
 */
function WeekGlance({ agenda, today }: { agenda: AgendaDay[]; today: string }) {
  const cleared = agenda.filter((d) => d.outcome === 'cleared').length;
  // Read as it is seen: with nothing cleared yet the title is the week at a glance, never a zero.
  const heading = cleared
    ? `This week: ${cleared} ${cleared === 1 ? 'day' : 'days'} cleared so far.`
    : 'Your week at a glance.';
  const label = `${heading} ${agenda
    .map((d) => `${weekdayShort(d.date)} ${stateWords(dayState(d, today))}`)
    .join('. ')}.`;
  return (
    <View
      testID="week-glance"
      accessible
      accessibilityLabel={label}
      style={[styles.card, { gap: 14 }]}>
      <Text maxFontSizeMultiplier={1.3} style={type.cardTitle}>
        {cleared > 0 ? (
          <>
            <Text style={{ ...fonts.figureHeavy, color: palette.doneText }}>{cleared}</Text>
            {` ${cleared === 1 ? 'day' : 'days'} cleared so far`}
          </>
        ) : (
          'Your week at a glance'
        )}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {agenda.map((d) => {
          const state = dayState(d, today);
          const on = d.date === today;
          const share =
            state.kind === 'count'
              ? state.cleared
                ? 1
                : state.total
                  ? state.done / state.total
                  : 0
              : 0;
          const fill =
            state.kind === 'count' && state.cleared
              ? palette.done
              : on
                ? palette.accent
                : palette.doneEdge;
          const protectedDay = d.outcome === 'protected';
          return (
            <View key={d.date} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  ...type.meta,
                  fontSize: 12,
                  lineHeight: 16,
                  color: on ? palette.accentText : palette.label3,
                }}>
                {weekdayShort(d.date).slice(0, 1)}
              </Text>
              <View
                testID={`glance:${d.date}`}
                style={{
                  width: 26,
                  height: TRACK,
                  borderRadius: 13,
                  justifyContent: 'flex-end',
                  overflow: 'hidden',
                  backgroundColor: protectedDay ? palette.accentTint : palette.fill,
                  borderWidth: on ? 2 : 0,
                  borderColor: palette.accent,
                }}>
                {share > 0 && (
                  <View
                    style={{
                      height: `${Math.max(14, Math.round(share * 100))}%`,
                      borderRadius: 13,
                      backgroundColor: fill,
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      paddingTop: 4,
                    }}>
                    {state.kind === 'count' && state.cleared && (
                      <Text
                        style={{
                          ...fonts.bold,
                          fontSize: 13,
                          lineHeight: 16,
                          color: palette.onDone,
                        }}>
                        ✓
                      </Text>
                    )}
                  </View>
                )}
              </View>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  ...fonts.figure,
                  fontSize: 14,
                  lineHeight: 18,
                  color:
                    d.outcome === 'cleared'
                      ? palette.doneText
                      : on
                        ? palette.accentText
                        : palette.label2,
                }}>
                {dateObject(d.date).getDate()}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function WeekScreen() {
  const { state } = useApp(),
    today = useToday(),
    monday = weekStartOf(today);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(monday, i)), [monday]);
  // Read-only: later days are computed on a copy, so looking never creates anything.
  const agenda = useMemo(
    () => weekAgenda(state, dates, today, new Date().toISOString()),
    [state, dates, today],
  );
  const logged = useMemo(() => loggedBlockIds(state), [state]);
  const days = dates.map((d) => state.days[d]);
  // What each day holds, so a companion counts on the days of the workouts it follows.
  const held = (date: string): HeldRoutines => {
    const ids = agenda.find((d) => d.date === date)?.routineIds;
    return { placed: new Set(ids?.placed), projected: new Set(ids?.projected) };
  };
  const coverageRows = state.programs
    .map((p) => {
      const coverage = programCoverage(p.id, days, today);
      const enabled = p.routines.filter((r) => r.enabled);
      const line = coverageLine(
        coverage,
        configuredOccurrences(p, state.programs, dates, held),
        configuredOccurrences(p, state.programs),
      );
      const active =
        enabled.length > 0 ||
        coverage.done > 0 ||
        coverage.planned > 0 ||
        coverage.missed > 0 ||
        coverage.skipped > 0;
      return { p, line, active };
    })
    .filter((row) => row.active);
  return (
    <Page
      title="This week"
      // Dates only after saved data loads: the static web render and the first client render must
      // match, and the build date is not today.
      top={<Text style={styles.label}>{`${shortDate(dates[0])} – ${shortDate(dates[6])}`}</Text>}>
      {!state.programs.length ? (
        <Text style={styles.muted}>Import your setup or add a program to plan the week.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          <WeekGlance agenda={agenda} today={today} />
          {/* Only over day cards: the title above already says This week. */}
          <Text testID="week-hint" style={{ ...type.caption, marginTop: 6, paddingHorizontal: 4 }}>
            Tap a day to open it
          </Text>
          <View style={[styles.card, { padding: 6, gap: 0 }]}>
            {agenda.map((d, i) => (
              <View key={d.date}>
                {/* A hairline between days, inset to the text, none beside today's tint. */}
                {i > 0 && d.date !== today && agenda[i - 1].date !== today && (
                  <View
                    style={{ height: 0.5, marginLeft: 66, backgroundColor: palette.separator }}
                  />
                )}
                <AgendaRow day={d} today={today} logged={logged} />
              </View>
            ))}
          </View>
          <Text style={{ ...type.footnote, paddingHorizontal: 4 }}>
            Times appear once a day is planned. Projected workouts follow the rotation and are set
            when their day opens.
          </Text>
        </View>
      )}
      {(state.programs.some((p) => p.rotation) || coverageRows.length > 0) && (
        <View style={styles.section}>
          <SectionLabel title="More" />
          {state.programs
            .filter((p) => p.rotation)
            .map((p) => (
              <Disclosure key={p.id} title={`${p.title} rotation · coming days`}>
                {projectRotation(state, p, today).map((d) => (
                  <View key={d.date} style={[styles.spread, { minHeight: 32 }]}>
                    <Text style={styles.body}>
                      {displayDate(d.date)}
                      {d.date === today ? ' · today' : ''}
                    </Text>
                    <Text
                      style={{
                        ...type.caption,
                        color:
                          d.kind === 'done'
                            ? palette.done
                            : d.kind === 'rest'
                              ? palette.label3
                              : palette.label2,
                      }}>
                      {d.routineId
                        ? (p.routines.find((r) => r.id === d.routineId)?.title ?? '')
                        : 'Rest'}
                      {d.kind === 'done' ? ' · done' : d.kind === 'skipped' ? ' · skipped' : ''}
                    </Text>
                  </View>
                ))}
                <Text style={styles.muted}>
                  A projection: each training day takes the next workout once the one before is
                  done.
                </Text>
              </Disclosure>
            ))}
          {coverageRows.length > 0 && (
            <Disclosure title="Program coverage">
              {coverageRows.map(({ p, line }) => (
                <View key={p.id} accessible style={{ gap: 2 }}>
                  <Text style={type.item}>{p.title}</Text>
                  <Text style={styles.muted}>{line}</Text>
                </View>
              ))}
            </Disclosure>
          )}
        </View>
      )}
    </Page>
  );
}
