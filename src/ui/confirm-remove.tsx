import { Text, View } from 'react-native';
import { Button, styles } from './components';
import { palette } from './theme';

export type RemoveChoice = { title: string; onPress: () => void };

/**
 * The one step between a Delete button and a record leaving: one line saying what happens, then the
 * choice, on a card with a danger edge. Used for deleting a saved record only, never for a plan
 * change. With one way to delete, keeping the record is the primary button. A record that completed
 * an objective offers two ways (`also`): `remove`, the primary, also undoes the objective, and
 * `also` keeps it Done.
 */
export function ConfirmRemove({
  message,
  remove,
  also,
  keep,
}: {
  message: string;
  remove: RemoveChoice;
  also?: RemoveChoice;
  keep: () => void;
}) {
  return (
    <View
      testID="confirm-remove"
      style={[styles.card, { gap: 10, borderWidth: 1, borderColor: palette.danger }]}>
      <Text style={styles.body}>{message}</Text>
      {also ? (
        <View style={{ gap: 8 }}>
          <Button title={remove.title} onPress={remove.onPress} />
          <Button secondary title={also.title} onPress={also.onPress} />
          <Button quiet small title="Keep it" onPress={keep} />
        </View>
      ) : (
        <View style={styles.row}>
          <Button secondary small title={remove.title} onPress={remove.onPress} />
          <Button small title="Keep it" onPress={keep} />
        </View>
      )}
    </View>
  );
}
