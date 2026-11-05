import { memo, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Block } from '../domain/model';
import { openObjective } from '../domain/objectives';
import { BundledRoutines } from './bundled-routines';
import { LinkButton } from './controls';
import { InstructionLinks } from './instructions';
import { CheckSquare } from './mission';
import { ObjectiveRow, TrailingAction } from './objective-row';
import { fonts, palette, type } from './theme';

/** What a row on Today can do. Kept in one stable object, so a row re-renders only for its own data. */
export type RowActions = {
  /** Returns the save's promise when the press saves, so the check can show it is saving. */
  check: (block: Block) => unknown;
  edit: (block: Block) => void;
  skip: (block: Block) => unknown;
  /** Opens the move to another day for a companion objective. */
  move: (block: Block) => void;
};

/**
 * What sits under a row on Today: its bundled steps and the companion move, indented to the row's
 * title so it reads as that objective's action.
 */
function RowExtras({
  block,
  date,
  canMove,
  onMove,
  nextStepId,
}: {
  block: Block;
  date: string;
  canMove: boolean;
  onMove: () => void;
  nextStepId?: string;
}) {
  return (
    <>
      <BundledRoutines block={block} date={date} nextStepId={nextStepId} />
      {canMove && (
        <View style={{ paddingLeft: 56, alignItems: 'flex-start' }}>
          <LinkButton
            title="Move to another day"
            label={`Move ${block.title} to another day`}
            tone="dim"
            onPress={onMove}
          />
        </View>
      )}
    </>
  );
}

/**
 * One objective on Today. Memoized: its props are the block (whose object changes only when the
 * block does), strings, flags and stable references, so a tick re-renders the ticked row only, and
 * the clock re-renders only rows whose time line changes.
 */
export const TodayRow = memo(function TodayRow({
  block,
  date,
  sub,
  caption,
  active,
  next = false,
  editLabel,
  checkLabel,
  tickOnTap,
  steps,
  links,
  canMove,
  actions,
  trailing,
  details,
}: {
  block: Block;
  date: string;
  sub: string | null;
  /** A caption drawn in more than one color, in place of `sub` (which VoiceOver still reads). */
  caption?: ReactNode;
  active: boolean;
  /** The next thing to do on the list: the Ember check outline. */
  next?: boolean;
  editLabel: string;
  checkLabel: string;
  tickOnTap: boolean;
  /** Shows the folded steps and links toggle. */
  steps: boolean;
  links: InstructionLinks;
  canMove: boolean;
  actions: RowActions;
  /** Replaces Skip while open (the study row's Timer). */
  trailing?: ReactNode;
  /**
   * Folded details: the study row's resources and reminder, or the morning anchor's correction
   * (after its steps).
   */
  details?: { what: string; body: ReactNode };
}) {
  // The Ember outline goes on the check that is next: the row's own while it is open, otherwise
  // (a workout recorded before its bundled steps) the first required step still open.
  const nextStepId = next && block.status !== 'planned' ? openObjective(block)?.id : undefined;
  return (
    <ObjectiveRow
      testID={`row:${block.title}`}
      title={block.title}
      status={block.status}
      sub={sub}
      caption={caption}
      active={active}
      next={next && block.status === 'planned'}
      editLabel={editLabel}
      checkLabel={checkLabel}
      skipLabel={`Skip ${block.title}`}
      onEdit={() => actions.edit(block)}
      onCheck={() => actions.check(block)}
      tickOnTap={tickOnTap}
      onSkip={() => void actions.skip(block)}
      instructions={steps ? { steps: block.steps, links } : undefined}
      trailing={trailing}
      details={details}>
      <RowExtras
        block={block}
        date={date}
        canMove={canMove}
        onMove={() => actions.move(block)}
        nextStepId={nextStepId}
      />
    </ObjectiveRow>
  );
});

/**
 * A rotation workout skipped on this day: its program rests, so the workout moved to the next
 * training day and is out of the day's count. It keeps its place in the list as a quiet row, like a
 * skipped one, and Undo (the dashed check or the word) trains this day again, which puts the
 * workout back.
 */
export function RestedWorkoutRow({
  title,
  isToday,
  onUndo,
}: {
  title: string;
  isToday: boolean;
  /** Return the save's promise, so the check shows it is saving. */
  onUndo: () => unknown;
}) {
  const undoLabel = `Undo: train ${title} ${isToday ? 'today' : 'this day'}`;
  return (
    <View testID={`rested:${title}`} style={{ paddingVertical: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
        <CheckSquare status="skipped" label={undoLabel} onPress={onUndo} />
        <View
          accessible
          accessibilityLabel={`${title}. Moved to the next training day`}
          style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 2 }}>
          <Text
            style={{
              ...type.item,
              ...fonts.regular,
              color: palette.label3,
            }}>
            {title}
          </Text>
          <Text style={{ ...type.caption, color: palette.label3 }}>Next training day</Text>
        </View>
        <View style={{ flexShrink: 0 }}>
          <TrailingAction title="Undo" label={undoLabel} onPress={() => void onUndo()} />
        </View>
      </View>
    </View>
  );
}
