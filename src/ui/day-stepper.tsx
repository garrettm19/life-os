import { Text } from 'react-native';
import { PressableScale } from './motion';
import { fonts, palette } from './theme';

/** The ‹ › day steppers beside the date on Today. */
export function Stepper({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...fonts.figure, fontSize: 18, lineHeight: 22, color: palette.label2 }}>
        {glyph}
      </Text>
    </PressableScale>
  );
}
