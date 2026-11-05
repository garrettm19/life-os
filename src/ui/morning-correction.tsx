import { useState } from 'react';
import { Text, View } from 'react-native';
import { correctMorning } from '../domain/anchor';
import { withDay } from '../domain/data';
import { Block, clock, displayTime, parseTime } from '../domain/model';
import { useApp } from '../state/app-state';
import { Button, Field, styles } from './components';
import { LinkButton } from './controls';
import { palette, type } from './theme';

/**
 * "I was up at…", in the morning anchor's details on the day it was ticked: a forgotten tick is not
 * a late morning. The time is judged in place of the tick and Progress marks the morning
 * corrected. Only a time before the tick is taken, and removing it goes back to the tick time.
 */
export function MorningCorrection({ block, date }: { block: Block; date: string }) {
  const { state, change } = useApp();
  const [value, setValue] = useState(block.upAt === undefined ? '' : clock(block.upAt));
  const [error, setError] = useState<string | null>(null);
  const save = async (upAt: number | null) => {
    try {
      const day = state.days[date];
      // Checked here first, so a time after the tick is said beside the field.
      correctMorning(day, block.id, upAt);
      setError(null);
      await change((s) => withDay(s, correctMorning(s.days[date], block.id, upAt)));
      if (upAt === null) setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the time.');
    }
  };
  return (
    <View testID="morning-correction" style={{ gap: 8, paddingTop: 4 }}>
      <Text style={styles.muted}>
        {block.upAt === undefined
          ? 'Forgot to tick? Say when you were up. It counts in place of the tick time.'
          : `Counted as up at ${displayTime(block.upAt)}, marked corrected on Progress.`}
      </Text>
      <Field
        label="I was up at (24-hour)"
        value={value}
        onChange={(v) => {
          setValue(v);
          setError(null);
        }}
        placeholder="07:05"
        time
      />
      {!!error && (
        // A form note, never the danger color: nothing about the anchor is shown in red.
        <Text accessibilityRole="alert" style={{ ...type.caption, color: palette.label }}>
          {error}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Button
          secondary
          small
          title="Save time"
          label="Save the time you were up"
          onPress={() => {
            try {
              void save(parseTime(value));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Check the time.');
            }
          }}
        />
        {block.upAt !== undefined && (
          <LinkButton
            title="Use the tick time"
            label="Remove the correction and use the tick time"
            tone="dim"
            onPress={() => void save(null)}
          />
        )}
      </View>
    </View>
  );
}
