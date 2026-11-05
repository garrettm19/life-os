import { Text, View } from 'react-native';
import { MorningMark, morningOn } from '../domain/anchor';
import { Routine, State, shiftDate } from '../domain/model';
import { fonts, palette, type } from './theme';

/**
 * The last seven mornings before today, oldest first, read by the one anchor rule: the
 * window "on time N of the last 7" counts while today is still open.
 */
export function morningTrail(state: State, routine: Routine, today: string): MorningMark[] {
  return Array.from(
    { length: 7 },
    (_, i) => morningOn(state, routine, shiftDate(today, i - 7), today).mark,
  );
}

/**
 * The morning anchor's caption while today's morning is open: the anchor's own words ("On time 5
 * of the last 7", the count in Fern) beside a trail of the last seven mornings. A Fern dot is an
 * on-time morning, a ring one ticked after the window, and a faint dot a morning not judged on
 * time; the words carry the meaning, so the trail is decoration for VoiceOver.
 */
export function MorningCaption({ text, trail }: { text: string; trail: MorningMark[] }) {
  // The count is the last figure but one: "On time 5 of the last 7".
  const parts = /^(.*?)(\d+)( of the last \d+)$/.exec(text);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 10,
        rowGap: 4,
      }}>
      <Text style={{ ...type.caption, color: palette.label2 }}>
        {parts ? (
          <>
            {parts[1]}
            <Text style={{ ...fonts.figureHeavy, color: palette.doneText }}>{parts[2]}</Text>
            {parts[3]}
          </>
        ) : (
          text
        )}
      </Text>
      <View
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {trail.map((mark, i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor:
                mark === 'on-time'
                  ? palette.done
                  : mark === 'late'
                    ? 'transparent'
                    : palette.fillStrong,
              borderWidth: mark === 'late' ? 1.5 : 0,
              borderColor: palette.checkEdge,
            }}
          />
        ))}
      </View>
    </View>
  );
}
