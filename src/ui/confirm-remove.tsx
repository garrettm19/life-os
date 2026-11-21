import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { UndoEffect } from '../domain/objectives';
import { displayDate, localDate } from '../domain/model';
import { Button, styles, useReveal } from './components';
import { palette } from './theme';

export type RemoveChoice = { title: string; onPress: () => void };

/** What a confirm asks: its line and its ways to delete. */
export type RemoveQuestion = {
  message: string;
  remove: RemoveChoice;
  /** A second way to delete, for a record that completed an objective. */
  also?: RemoveChoice;
  /** Which of the two ways is the filled, recommended button. */
  prefer?: 'remove' | 'also';
};

/** Moves VoiceOver focus (keyboard focus on the web) to a view. */
function focus(node: View | null) {
  if (!node) return;
  if (Platform.OS === 'web')
    (node as unknown as { focus?: (options?: object) => void }).focus?.({ preventScroll: true });
  else AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
}

/**
 * The confirm for a record that completed an objective (`effect`, from `undoEffect`): it names the
 * objective and its day, and says when undoing the Done would leave that day not cleared. Undoing
 * is the recommended choice, except where `effect.keepDone` (a past day it would no longer clear),
 * so a past Day Cleared changes only when chosen with its cost in view.
 */
export function linkedQuestion(
  record: string,
  effect: UndoEffect,
  choices: { undo: () => void; keep: () => void },
  today = localDate(),
): RemoveQuestion {
  const day = effect.date === today ? 'Today' : displayDate(effect.date);
  const when = effect.date === today ? 'today' : `on ${day}`;
  return {
    message:
      `This ${record} completed ${effect.title} ${when}.` +
      (effect.unclears ? ` ${day} would no longer count as cleared.` : ''),
    remove: { title: 'Delete and undo Done', onPress: choices.undo },
    also: { title: 'Delete, keep Done', onPress: choices.keep },
    prefer: effect.keepDone ? 'also' : 'remove',
  };
}

/**
 * The one step between a Delete button and a saved record leaving, used for record deletions only,
 * never for a plan change. Closed, it is the `ask` button; open, a card in its place with one line
 * saying what happens, then the choice, on a danger edge. One filled button marks the recommended
 * choice: Keep it for a plain delete, the `prefer`red way for a record that completed an objective.
 * Opening brings the card into view and moves focus to its line; Keep it returns focus to `ask`.
 * It must sit directly in a sheet's or page's content, so its reveal measures the right place.
 */
export function ConfirmRemove({
  open,
  setOpen,
  ask,
  askLabel,
  small = false,
  message,
  remove,
  also,
  prefer = 'remove',
}: RemoveQuestion & {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The button that opens the confirm. */
  ask: string;
  askLabel?: string;
  /** A small `ask` button, where the delete is a side action (a recorded session). */
  small?: boolean;
}) {
  const reveal = useReveal();
  const askRef = useRef<View>(null);
  const messageRef = useRef<View>(null);
  const shown = useRef(false);
  const returning = useRef(false);
  useEffect(() => {
    if (open || !returning.current) return;
    returning.current = false;
    focus(askRef.current);
  }, [open]);
  if (!open)
    return (
      <Button
        ref={askRef}
        secondary
        small={small}
        title={ask}
        label={askLabel}
        onPress={() => {
          shown.current = false;
          setOpen(true);
        }}
      />
    );
  const keep = () => {
    returning.current = true;
    setOpen(false);
  };
  const [first, second] = also && prefer === 'also' ? [also, remove] : [remove, also];
  return (
    <View
      testID="confirm-remove"
      onLayout={(e) => {
        if (shown.current) return;
        shown.current = true;
        reveal?.(e.nativeEvent.layout.y, e.nativeEvent.layout.height);
        focus(messageRef.current);
      }}
      style={[styles.card, { gap: 10, borderWidth: 1, borderColor: palette.danger }]}>
      <View ref={messageRef} accessible tabIndex={-1}>
        <Text style={styles.body}>{message}</Text>
      </View>
      {second ? (
        <View style={{ gap: 8 }}>
          <Button title={first.title} onPress={first.onPress} />
          <Button secondary title={second.title} onPress={second.onPress} />
          <Button secondary title="Keep it" onPress={keep} />
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
