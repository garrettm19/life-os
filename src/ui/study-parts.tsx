import { Linking, Platform, Text, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { clockText } from '../domain/intervals';
import { StudyLink, StudyPlan, StudyRecord } from '../domain/model';
import { StudyRun, phaseAt, spentAt } from '../domain/study';
import { PressableScale } from './motion';
import { fonts, glows, palette, radius, type } from './theme';

/** One stage as the bar and list draw it. */
export type StageView = {
  id: string;
  title: string;
  plannedSeconds: number;
  /** Seconds on the stage clock (never above plan). */
  seconds: number;
  state: 'done' | 'current' | 'up' | 'next';
};

/** Minutes, rounded down, so a part-minute never reads as a whole one. */
const wholeMinutes = (seconds: number) => Math.floor(seconds / 60);

export function planStages(plan: StudyPlan): StageView[] {
  return plan.stages.map((s) => ({
    id: s.id,
    title: s.title,
    plannedSeconds: s.minutes * 60,
    seconds: 0,
    state: 'next',
  }));
}

export function runStages(run: StudyRun, now: number): StageView[] {
  const spent = spentAt(run, now);
  const up = phaseAt(run, now) === 'timeUp';
  return run.stages.map((s, i) => ({
    id: s.id,
    title: s.title,
    plannedSeconds: s.plannedSeconds,
    seconds: Math.floor(spent[i] / 1000),
    state: i < run.index ? 'done' : i === run.index ? (up ? 'up' : 'current') : 'next',
  }));
}

export function recordStages(record: StudyRecord): StageView[] {
  return record.stages.map((s) => ({
    id: s.id,
    title: s.title,
    plannedSeconds: s.plannedSeconds,
    seconds: s.seconds,
    state: s.done ? 'done' : 'next',
  }));
}

/**
 * The session as one bar, a segment per stage sized by its plan: Fern where a stage is behind or its
 * time is up, Ember for the stage running now, an empty slot for what is next.
 */
export function StageBar({ stages, height = 6 }: { stages: StageView[]; height?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{ flexDirection: 'row', gap: 4 }}>
      {stages.map((s) => {
        const fraction = s.plannedSeconds ? Math.min(1, s.seconds / s.plannedSeconds) : 0;
        const color = s.state === 'current' ? palette.accent : palette.done;
        return (
          <View
            key={s.id}
            style={{
              flex: s.plannedSeconds,
              height,
              borderRadius: radius.segment,
              backgroundColor: palette.fillStrong,
              overflow: 'hidden',
            }}>
            <View
              style={[
                {
                  height,
                  backgroundColor: color,
                  transformOrigin: 'left',
                  transform: [{ scaleX: fraction }],
                },
                fraction > 0 && s.state === 'current' && glows.active,
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function stageStatus(s: StageView): string {
  if (s.state === 'done')
    return s.seconds >= s.plannedSeconds
      ? `${wholeMinutes(s.plannedSeconds)} min · done`
      : `${clockText(s.seconds)} of ${wholeMinutes(s.plannedSeconds)} min · finished early`;
  if (s.state === 'up') return `${wholeMinutes(s.plannedSeconds)} min · time is up`;
  if (s.state === 'current')
    return `${clockText(s.seconds)} of ${wholeMinutes(s.plannedSeconds)} min · now`;
  return s.seconds > 0
    ? `${clockText(s.seconds)} of ${wholeMinutes(s.plannedSeconds)} min · not finished`
    : `${wholeMinutes(s.plannedSeconds)} min`;
}

/**
 * The stages in order, without decorative index numbers (the order is the list's); each row is read
 * as one line by VoiceOver, with its stage number.
 */
export function StageList({ stages }: { stages: StageView[] }) {
  return (
    <View style={{ gap: 2 }}>
      {stages.map((s, i) => {
        const done = s.state === 'done' || s.state === 'up';
        const status = stageStatus(s);
        return (
          <View
            key={s.id}
            accessible
            accessibilityLabel={`Stage ${i + 1}, ${s.title}. ${status}.`}
            style={{ minHeight: 44 }}>
            <View style={{ gap: 2, paddingBottom: 6 }}>
              <Text
                style={{
                  ...type.item,
                  color: s.state === 'next' ? palette.label : done ? palette.label2 : palette.label,
                }}>
                {s.title}
              </Text>
              <Text
                style={{
                  ...type.meta,
                  color:
                    s.state === 'current'
                      ? palette.accent
                      : done
                        ? palette.doneText
                        : palette.label3,
                }}>
                {status}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Opens a configured https link in the system (Safari, or the app that handles it), so a study
 * clock keeps running there; if the system cannot, it opens in the in-app browser instead.
 */
export function openLink(url: string): void {
  if (!/^https:\/\/\S+$/i.test(url)) return;
  void Linking.openURL(url).catch(() =>
    Platform.OS === 'web' ? undefined : openBrowserAsync(url).catch(() => {}),
  );
}

/**
 * A stage's resources. They open in the system (Safari or the matching app), so the study clock
 * keeps running while you work there.
 */
export function StageLinks({ links }: { links: StudyLink[] }) {
  if (!links.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {links.map((link, i) => (
        <PressableScale
          key={`${i}-${link.url}`}
          accessibilityRole="link"
          accessibilityLabel={`Open ${link.label}`}
          onPress={() => openLink(link.url)}
          style={{
            minHeight: 44,
            paddingHorizontal: 14,
            justifyContent: 'center',
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: palette.edge,
            backgroundColor: palette.canvas,
          }}>
          <Text style={{ ...fonts.semibold, fontSize: 14, color: palette.label }}>
            {link.label} ↗
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}
