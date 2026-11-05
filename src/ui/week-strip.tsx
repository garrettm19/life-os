import { useState } from 'react';
import { Text, View } from 'react-native';
import { WeekDayMark } from '../domain/moments';
import { displayDate } from '../domain/model';
import { Tick } from './mission';
import { fonts, palette } from './theme';

const SPOKEN: Record<WeekDayMark['mark'], string> = {
  cleared: 'cleared',
  protected: 'protected, streak held',
  missed: 'not cleared',
  open: 'in progress',
  later: 'still to come',
  free: 'nothing due',
  none: 'nothing recorded',
};

/** The week as VoiceOver reads it: how many cleared, then each day and what it was. */
export function weekLabel(days: WeekDayMark[]): string {
  const cleared = days.filter((d) => d.mark === 'cleared').length;
  return `Last 7 days: ${cleared} cleared. ${days
    .map((d) => `${displayDate(d.date)} ${SPOKEN[d.mark]}`)
    .join('. ')}.`;
}

/**
 * The last seven days as a chain: a Fern disc with a tick for each cleared day, a Fern ring on its
 * tint for a protected one (the run is held), an Ember ring for today while it is open, a dashed
 * ring for days to come. A day not cleared, or with nothing recorded, is a faint dot, never a red
 * mark: the chain is something to build, not a record of failure. Today's letter is Ember while it
 * is open and Fern once cleared, and a cleared today wears a soft halo.
 */
export function WeekStrip({
  days,
  size = 34,
  standalone = true,
}: {
  days: WeekDayMark[];
  size?: number;
  /** False inside a button that already reads `weekLabel`. */
  standalone?: boolean;
}) {
  // On a narrow phone the discs shrink to their column, so the chain never touches.
  const [column, setColumn] = useState(0);
  const disc = column ? Math.max(22, Math.min(size, Math.floor(column) - 8)) : size;
  return (
    <View
      testID="week-strip"
      accessible={standalone}
      accessibilityLabel={standalone ? weekLabel(days) : undefined}
      onLayout={(e) => setColumn((e.nativeEvent.layout.width - 12) / 7)}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 2 }}>
      {days.map((d) => {
        const cleared = d.mark === 'cleared';
        const quiet = d.mark === 'missed' || d.mark === 'none' || d.mark === 'free';
        const ring =
          d.mark === 'protected'
            ? palette.done
            : d.mark === 'open'
              ? palette.accent
              : d.mark === 'later'
                ? palette.fillStrong
                : 'transparent';
        return (
          <View key={d.date} style={{ alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                ...fonts.semibold,
                fontSize: 12,
                lineHeight: 16,
                color: d.today ? (cleared ? palette.doneText : palette.accentText) : palette.label2,
              }}>
              {d.letter}
            </Text>
            {/* A cleared today sits in a soft Fern halo: the chain's newest link. */}
            <View
              style={{
                width: disc + 6,
                height: disc + 6,
                borderRadius: (disc + 6) / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: d.today && cleared ? palette.doneTint : 'transparent',
              }}>
              <View
                style={{
                  width: disc,
                  height: disc,
                  borderRadius: disc / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: cleared
                    ? palette.done
                    : d.mark === 'protected'
                      ? palette.doneTint
                      : 'transparent',
                  borderWidth: cleared || quiet ? 0 : 2,
                  borderColor: ring,
                  borderStyle: d.mark === 'later' ? 'dashed' : 'solid',
                }}>
                {cleared ? (
                  <Tick color={palette.onDone} small={disc < 30} />
                ) : quiet ? (
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: d.mark === 'missed' ? palette.checkEdge : palette.fillStrong,
                    }}
                  />
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
