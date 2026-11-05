import { Fragment, ReactNode, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Block, displayTime } from '../domain/model';
import { useBusy, useSave } from '../state/app-state';
import { FoldToggle, InstructionLinks, InstructionsBody } from './instructions';
import { ActiveFrame, CheckSquare } from './mission';
import { PressableScale } from './motion';
import { usePendingPress } from './pending-press';
import { instructionsCaption, rowLabel, tickHint } from './row-label';
import { depth, fonts, palette, radius, type } from './theme';

type Status = Block['status'];

/**
 * The time a completion was recorded, in the same format as planned times, joined to its AM or PM
 * with a no-break space so a wrapped caption never splits the time.
 */
export function doneAt(actualAt: string | null): string | null {
  if (!actualAt) return null;
  const at = new Date(actualAt);
  return Number.isNaN(at.getTime())
    ? null
    : displayTime(at.getHours() * 60 + at.getMinutes()).replace(' ', '\u00a0');
}

/**
 * Below 375 pt (a 320 pt phone) the rows give the title more room: the card's side padding narrows,
 * the chevron's 44 pt target reaches back over the gap before it so it takes a 32 pt column, and a
 * done row with nothing at its edge drops the Skip column.
 */
export function useNarrowRows(): boolean {
  return useWindowDimensions().width < 375;
}

/**
 * The one quiet trailing action at a row's edge: Skip while open, Undo once skipped, or the study
 * row's Timer. A word in `label2` with a full 44 pt target that never shrinks; on the row in
 * progress it sits in a capsule on the row's Ember tint, so the next step's way out is clear.
 */
export function TrailingAction({
  title = 'Skip',
  label,
  onPress,
  raised = false,
}: {
  title?: string;
  label: string;
  onPress: () => void;
  /** On the row in progress: drawn as a capsule on its tint. */
  raised?: boolean;
}) {
  const busy = useBusy();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
      <Text
        style={[
          { ...fonts.medium, fontSize: 15, lineHeight: 20, color: palette.label2 },
          raised && {
            ...fonts.semibold,
            color: palette.label,
            backgroundColor: palette.surface,
            borderRadius: radius.capsule,
            overflow: 'hidden',
            paddingHorizontal: 14,
            paddingVertical: 7,
          },
        ]}>
        {title}
      </Text>
    </PressableScale>
  );
}

/**
 * One objective on Today, in three columns that never overlap at any width or text size: the 44 pt
 * square check; the title and its caption, which take the rest of the line and wrap; and the
 * trailing actions, fixed and never shrinking (the chevron when the row has something folded, then
 * Skip while open or Undo once skipped). What the chevron folds opens below the row, indented to the
 * title and inside the row's own space, so it pushes the next row down instead of covering it.
 */
export function ObjectiveRow({
  title,
  status,
  sub,
  caption,
  active = false,
  next = false,
  editLabel,
  checkLabel,
  skipLabel,
  onEdit,
  onCheck,
  onSkip,
  testID,
  children,
  tickOnTap = false,
  instructions,
  trailing,
  details,
}: {
  title: string;
  status: Status;
  /** One line under the title: a time, Now, Done at 7:12 AM. VoiceOver reads it with the title. */
  sub?: string | null;
  /** Drawn in place of `sub` when the caption needs more than one color; `sub` is still read. */
  caption?: ReactNode;
  /** Happening now: the Ember frame. */
  active?: boolean;
  /** The next thing to do: the Ember check outline. */
  next?: boolean;
  editLabel: string;
  checkLabel: string;
  skipLabel: string;
  onEdit: () => void;
  /** Return the save's promise, so the check shows the tap at once while it saves. */
  onCheck: () => unknown;
  onSkip: () => void;
  testID?: string;
  /** Bundled steps and the companion move, indented under the row. */
  children?: ReactNode;
  /**
   * A plain checklist item: a tap anywhere on the row ticks it, like the widget, and a long press
   * opens the editor.
   */
  tickOnTap?: boolean;
  /** Folded steps and links, behind the chevron. */
  instructions?: { steps: string[]; links: InstructionLinks };
  /** Replaces Skip while the objective is open, like the study row's Timer. */
  trailing?: ReactNode;
  /** Other folded details behind the chevron, after the instructions when there are any. */
  details?: { what: string; body: ReactNode };
}) {
  // A repeat tap on the row is ignored while the first one's save is pending.
  const { isSaving } = useSave();
  const { pending, run } = usePendingPress(status);
  const lastTap = useRef(0);
  const [tappedAt, setTappedAt] = useState(0);
  const [open, setOpen] = useState(false);
  const narrow = useNarrowRows();
  const tap = () => {
    const now = Date.now();
    if (pending || (isSaving() && now - lastTap.current < 5000)) return;
    lastTap.current = now;
    setTappedAt(now);
    run(onCheck);
  };
  const done = status === 'done';
  const skipped = status === 'skipped';
  // The row in progress (happening now, or the next thing to do) sits on the Ember tint.
  const framed = active || (next && status === 'planned');
  const counted = instructions
    ? instructionsCaption(instructions.steps.length, instructions.links.length)
    : null;
  // Steps and links fold with any other details below them (the morning anchor's correction).
  const fold =
    instructions && counted
      ? {
          what: counted,
          body: (
            <View style={{ gap: 8 }}>
              <InstructionsBody steps={instructions.steps} links={instructions.links} />
              {details?.body}
            </View>
          ),
        }
      : details;
  const heading = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={rowLabel(tickOnTap ? title : editLabel, status, sub)}
      accessibilityHint={tickOnTap ? tickHint(status) : undefined}
      accessibilityActions={tickOnTap ? [{ name: 'longpress', label: editLabel }] : undefined}
      onAccessibilityAction={tickOnTap ? onEdit : undefined}
      onPress={tickOnTap ? tap : onEdit}
      onLongPress={tickOnTap ? onEdit : undefined}
      containerStyle={{ flex: 1, minWidth: 0, alignSelf: 'stretch' }}
      style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 6, gap: 2 }}>
      {/* Done dims the title and lets the Fern check and caption say it; nothing is crossed out
          and nothing moves. */}
      <Text
        style={{
          ...type.item,
          ...(framed ? fonts.semibold : done || skipped ? fonts.regular : fonts.medium),
          color: done ? palette.label2 : skipped ? palette.label3 : palette.label,
        }}>
        {title}
      </Text>
      {caption ??
        (!!sub && (
          <Text
            style={{
              ...type.caption,
              color: active ? palette.accentText : done ? palette.doneText : palette.label2,
            }}>
            {sub}
          </Text>
        ))}
    </PressableScale>
  );
  const end =
    status === 'planned' ? (
      (trailing ?? <TrailingAction label={skipLabel} onPress={onSkip} raised={framed} />)
    ) : skipped ? (
      // Undo is the same as tapping the dashed check, said in words.
      <TrailingAction title="Undo" label={`Undo skipping ${title}`} onPress={onCheck} />
    ) : null;
  const row = (
    <View testID={testID} style={{ paddingVertical: framed ? 6 : 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
        <CheckSquare
          status={status}
          tone={active || next ? 'active' : 'open'}
          label={checkLabel}
          onPress={() => run(onCheck)}
          tappedAt={tappedAt}
          pending={pending}
        />
        {heading}
        {(end || fold) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            {fold && (
              <FoldToggle
                title={title}
                what={fold.what}
                open={open}
                onPress={() => setOpen(!open)}
                narrow={narrow}
              />
            )}
            {/* Skip stays at the edge on every row; once done its column stays, so the chevron
                never moves under a quick second tap. Below 375 pt the title needs that room more. */}
            {end ?? (narrow ? null : <View style={{ width: 44 }} />)}
          </View>
        )}
      </View>
      {fold && open && <View style={{ paddingLeft: 56, paddingBottom: 8 }}>{fold.body}</View>}
      {children}
    </View>
  );
  return framed ? <ActiveFrame>{row}</ActiveFrame> : row;
}

/** A bundled step under its parent session, with the same check and Skip. */
export function StepRow({
  title,
  status,
  onCheck,
  onSkip,
  next = false,
}: {
  title: string;
  status: Status;
  /** Return the save's promise, so the check shows the tap at once while it saves. */
  onCheck: () => unknown;
  onSkip: () => void;
  /** The next thing to do on the list: the Ember check outline. */
  next?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        marginLeft: 22,
        paddingLeft: 12,
        borderLeftWidth: 1,
        borderLeftColor: palette.separator,
      }}>
      <CheckSquare
        status={status}
        tone={next ? 'active' : 'open'}
        label={status === 'planned' ? `Mark ${title} done` : `Undo ${title}`}
        onPress={onCheck}
      />
      <Text
        style={{
          ...type.small,
          flex: 1,
          minWidth: 0,
          color:
            status === 'planned'
              ? palette.label
              : status === 'done'
                ? palette.label2
                : palette.label3,
        }}>
        {title}
      </Text>
      {status === 'planned' && <TrailingAction label={`Skip ${title}`} onPress={onSkip} />}
    </View>
  );
}

/**
 * Rows grouped in one card, inset grouped: a hairline between rows, inset to the titles, and none
 * beside the row in progress, whose tint already sets it apart.
 */
export function RowList({
  items,
  testID,
}: {
  items: { key: string; framed: boolean; node: ReactNode }[];
  testID?: string;
}) {
  const pad = useNarrowRows() ? 8 : 14;
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: palette.surface,
        borderRadius: radius.card,
        paddingHorizontal: pad,
        paddingVertical: 6,
        ...depth.card,
      }}>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {i > 0 && !item.framed && !items[i - 1].framed && (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: palette.separator,
                marginLeft: 56,
                marginRight: -pad,
              }}
            />
          )}
          {item.node}
        </Fragment>
      ))}
    </View>
  );
}
