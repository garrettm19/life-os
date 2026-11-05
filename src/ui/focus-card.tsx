import { useState } from 'react';
import { Text, View } from 'react-native';
import { activeFocus, focusDay, nextAction, restartNote } from '../domain/focus';
import { Block, Focus } from '../domain/model';
import { studyResources } from '../domain/study';
import { useApp } from '../state/app-state';
import { Button } from './components';
import { LinkButton } from './controls';
import { PressableScale } from './motion';
import { openLink } from './study-parts';
import { FocusEditor } from './focus-editor';
import { palette, radius, type } from './theme';

/**
 * The 90-day focus on Today: its name, the next linked objective that is due, and the quickest way
 * to start it (its resource, its plan or its page). It adds nothing to the plan: the objective is
 * the same one listed below, done or skipped there as always. With nothing linked due today it
 * says so in one line instead of inventing an action.
 */
function FocusCard({
  focus,
  today,
  onEdit,
  canOpen,
  onOpen,
}: {
  focus: Focus;
  today: string;
  onEdit: () => void;
  /** Whether the objective opens its own form or page (workout, review, Trading…). */
  canOpen: (block: Block) => boolean;
  onOpen: (block: Block) => void;
}) {
  const { state } = useApp();
  const { day, of, due } = focusDay(focus, today);
  const next = nextAction(state, focus, today);
  const routine = next.kind === 'due' ? next.routine : null;
  // The quickest start is the objective's first resource, a study objective's included.
  const link = routine ? studyResources(routine)[0] : undefined;
  const restart = routine ? restartNote(state, routine, today) : null;
  return (
    <View
      style={{
        gap: 6,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: palette.accentEdge,
        backgroundColor: palette.accentTint,
      }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`90-day focus: ${focus.title}. Day ${day} of ${of}${due ? ', review due' : ''}. Edit focus`}
        onPress={onEdit}
        style={{ minHeight: 44, justifyContent: 'center', gap: 2 }}>
        <Text style={{ ...type.meta, color: palette.accent }}>
          {due ? `90-day focus · review due` : `90-day focus · day ${day} of ${of}`}
        </Text>
        <Text style={type.heading} numberOfLines={2}>
          {focus.title}
        </Text>
      </PressableScale>
      {next.kind === 'due' && (
        <View style={{ gap: 2 }}>
          <Text style={type.caption}>Next · {next.routine.title}</Text>
          {!!restart && <Text style={{ ...type.caption, color: palette.accent }}>{restart}</Text>}
          {link ? (
            <LinkButton
              title={`Open ${link.label}`}
              label={`Open ${link.label} for ${next.routine.title}`}
              onPress={() => openLink(link.url)}
            />
          ) : (
            canOpen(next.block) && (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  small
                  secondary
                  title={`Open ${next.routine.title}`}
                  onPress={() => onOpen(next.block)}
                />
              </View>
            )
          )}
        </View>
      )}
      {next.kind === 'done' && (
        <Text style={{ ...type.caption, color: palette.done }}>
          Today&apos;s focus objectives are done.
        </Text>
      )}
      {next.kind === 'none' && (
        <Text style={type.caption}>
          {focus.routineIds.length
            ? 'Nothing for this focus is due today.'
            : 'No routines linked yet: tap the title to link some.'}
        </Text>
      )}
      {!!focus.cue && next.kind === 'due' && (
        <Text style={{ ...type.caption, color: palette.label2 }}>Plan · {focus.cue}</Text>
      )}
    </View>
  );
}

/** Today's focus card with its editor, or nothing at all when no focus is active. */
export function TodayFocus({
  today,
  canOpen,
  onOpen,
}: {
  today: string;
  canOpen: (block: Block) => boolean;
  onOpen: (block: Block) => void;
}) {
  const { state } = useApp();
  const [editing, setEditing] = useState(false);
  const focus = activeFocus(state);
  if (!focus) return null;
  return (
    <>
      <FocusCard
        focus={focus}
        today={today}
        onEdit={() => setEditing(true)}
        canOpen={canOpen}
        onOpen={onOpen}
      />
      {editing && <FocusEditor visible close={() => setEditing(false)} />}
    </>
  );
}
