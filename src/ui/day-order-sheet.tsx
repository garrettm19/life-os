import { useState } from 'react';
import { Text, View } from 'react-native';
import { DayOrderEntry, dayOrderEntries, moveEntryTo, withDayOrder } from '../domain/day-order';
import { useApp } from '../state/app-state';
import { announce } from './announce';
import { Button, Sheet, styles } from './components';
import { PressableScale } from './motion';
import { Row } from './list';
import { fonts, palette, radius, type } from './theme';

/**
 * The Order of the day: every routine that can come up on a day, one entry per rotation, moved
 * earlier or later one place at a time, or to the top or the bottom in one tap after tapping its
 * name. Save writes the order to each listed routine; Today's list and the Large widget
 * follow it. Closing with changes asks before discarding them.
 */
export function DayOrderSheet({ visible, close }: { visible: boolean; close: () => void }) {
  if (!visible) return null;
  return <DayOrderBody close={close} />;
}

function DayOrderBody({ close }: { close: () => void }) {
  const { state, change } = useApp();
  const [entries, setEntries] = useState<DayOrderEntry[]>(() => dayOrderEntries(state.programs));
  const [baseline] = useState(() => entries.map((e) => e.key).join());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The entry whose Move to top and Move to bottom are showing, by key. */
  const [picked, setPicked] = useState<string | null>(null);
  const changed = entries.map((e) => e.key).join() !== baseline;
  const move = (index: number, to: number) => {
    setEntries(moveEntryTo(entries, index, to));
    announce(`${entries[index].title}, ${to + 1} of ${entries.length}`);
  };
  const save = () =>
    void change((s) => withDayOrder(s, entries)).then((saved) => {
      if (!saved) return;
      announce('Order of the day saved.');
      close();
    });
  return (
    <Sheet
      title="Order of the day"
      visible
      close={() => (changed ? setConfirmDiscard(true) : close())}
      footer={
        confirmDiscard ? (
          <>
            <Text accessibilityRole="alert" style={styles.body}>
              Discard your changes to the order?
            </Text>
            <View style={styles.row}>
              <View style={{ flexGrow: 1 }}>
                <Button secondary title="Discard changes" onPress={close} />
              </View>
              <View style={{ flexGrow: 1 }}>
                <Button title="Keep editing" onPress={() => setConfirmDiscard(false)} />
              </View>
            </View>
          </>
        ) : entries.length ? (
          <Button title="Save order" onPress={save} />
        ) : undefined
      }>
      <Text style={styles.muted}>
        Today and the Today list widget show your objectives in this order, top to bottom. A new
        objective starts at the end. Tap a name to move it to the top or the bottom.
      </Text>
      {!entries.length && (
        <Text style={styles.body}>Nothing to order yet. Add objectives in Programs.</Text>
      )}
      <View accessibilityRole="list">
        {entries.map((entry, index) => {
          const open = picked === entry.key;
          const last = entries.length - 1;
          return (
            <View
              key={entry.key}
              style={{ borderTopWidth: index ? 1 : 0, borderTopColor: palette.separator }}>
              <View
                testID="day-order-entry"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <Text
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                  style={{
                    ...type.caption,
                    ...fonts.figure,
                    width: 28,
                    textAlign: 'right',
                  }}>
                  {index + 1}
                </Text>
                <PressableScale
                  testID="day-order-text"
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.title}, ${entry.detail}, ${index + 1} of ${entries.length}`}
                  accessibilityHint="Shows Move to top and Move to bottom."
                  accessibilityState={{ expanded: open }}
                  aria-expanded={open}
                  onPress={() => setPicked(open ? null : entry.key)}
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  style={{ minHeight: 44, justifyContent: 'center', gap: 2 }}>
                  <Text testID="day-order-title" style={type.item}>
                    {entry.title}
                  </Text>
                  <Text style={type.caption}>{entry.detail}</Text>
                </PressableScale>
                <MoveButton
                  glyph="↑"
                  label={`Move ${entry.title} earlier`}
                  disabled={index === 0}
                  onPress={() => move(index, index - 1)}
                />
                <MoveButton
                  glyph="↓"
                  label={`Move ${entry.title} later`}
                  disabled={index === last}
                  onPress={() => move(index, index + 1)}
                />
              </View>
              {/* One tap to either end, however far: the entry stays picked where it lands. */}
              {open && (
                <View style={[styles.row, { paddingLeft: 36, paddingBottom: 8 }]}>
                  <Button
                    secondary
                    small
                    title="Move to top"
                    label={`Move ${entry.title} to the top`}
                    disabled={index === 0}
                    onPress={() => move(index, 0)}
                  />
                  <Button
                    secondary
                    small
                    title="Move to bottom"
                    label={`Move ${entry.title} to the bottom`}
                    disabled={index === last}
                    onPress={() => move(index, last)}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

function MoveButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: palette.edge,
        opacity: disabled ? 0.38 : 1,
      }}>
      <Text
        maxFontSizeMultiplier={1.4}
        style={{ ...fonts.figure, fontSize: 18, lineHeight: 22, color: palette.label }}>
        {glyph}
      </Text>
    </PressableScale>
  );
}

/** The row near the top of Programs that opens the Order of the day, with its first few places. */
export function DayOrderRow() {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const entries = dayOrderEntries(state.programs);
  if (entries.length < 2) return null;
  const first = entries
    .slice(0, 3)
    .map((e) => e.title)
    .join(' · ');
  return (
    <>
      <Row
        icon="order"
        title="Order of the day"
        detail={`${first}${entries.length > 3 ? ' · …' : ''}`}
        label={`Order of the day: ${first}${entries.length > 3 ? ', and more' : ''}. Change the order`}
        onPress={() => setOpen(true)}
      />
      <DayOrderSheet visible={open} close={() => setOpen(false)} />
    </>
  );
}
