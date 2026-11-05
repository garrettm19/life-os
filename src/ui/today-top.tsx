import { Text, View } from 'react-native';
import { displayDate, shiftDate } from '../domain/model';
import { Stepper } from './day-stepper';
import { Segments } from './mission';
import { PressableScale } from './motion';
import { palette, type } from './theme';

/**
 * The thin bar held at the foot of Today's header once the board has scrolled away, so the day's
 * progress stays in view without repeating the board on screen.
 */
export function PinnedProgress({
  done,
  total,
  cleared,
}: {
  /** The same counts as the board: done of the day's required objectives. */
  done: number;
  total: number;
  /** Day Cleared from `dayProgress`, the one rule: lights the bar. */
  cleared: boolean;
}) {
  return (
    <View testID="pinned-progress" accessible accessibilityLabel={`${done} of ${total} done`}>
      <Segments states={null} ratio={done / total} cleared={cleared} thin />
    </View>
  );
}

/**
 * The day shown, with the previous and next day, at the top of More for today: the header keeps
 * only the title, so the date is read here (and by VoiceOver with the title). Tapping the date on
 * another day returns to today.
 */
export function DayNav({
  date,
  isToday,
  onDate,
  onToday,
}: {
  date: string;
  isToday: boolean;
  onDate: (date: string) => void;
  onToday: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -14 }}>
      <Stepper label="Previous day" glyph={'‹'} onPress={() => onDate(shiftDate(date, -1))} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          isToday ? `${displayDate(date)}, today` : `${displayDate(date)}. Jump to today`
        }
        onPress={onToday}
        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 }}>
        <Text style={{ ...type.meta, color: isToday ? palette.label3 : palette.accent }}>
          {displayDate(date).replace(', ', ' · ')}
        </Text>
      </PressableScale>
      <Stepper label="Next day" glyph={'›'} onPress={() => onDate(shiftDate(date, 1))} />
    </View>
  );
}
