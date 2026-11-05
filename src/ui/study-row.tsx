import { useState } from 'react';
import { Text, View } from 'react-native';
import { Block, displayTime } from '../domain/model';
import { StudyRun, studyPlanFor, studyResources, studySessionFor } from '../domain/study';
import { routineOf } from '../domain/workouts';
import { useApp } from '../state/app-state';
import { InstructionLinks } from './instructions';
import { PressableScale } from './motion';
import { TrailingAction } from './objective-row';
import { StageLinks, openLink } from './study-parts';
import { RowActions, TodayRow } from './today-row';
import { fonts, palette, type } from './theme';

/** A quiet text action with a full 44 pt target. */
function TextLink({
  title,
  label,
  onPress,
  dim = false,
}: {
  title: string;
  label: string;
  onPress: () => void;
  dim?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // A long resource label wraps inside the row instead of running off the screen.
      containerStyle={{ flexShrink: 1, maxWidth: '100%' }}
      style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text
        style={{
          ...type.caption,
          flexShrink: 1,
          ...fonts.semibold,
          color: dim ? palette.label2 : palette.label,
        }}>
        {title}
      </Text>
    </PressableScale>
  );
}

const NO_LINKS: InstructionLinks = [];

/**
 * The study objective as a row at its place in the list, with the weight of any other row. The
 * check completes it with one tap (or opens a timer session in progress); the trailing Timer opens
 * the optional stage timer; the chevron holds the resource, Skip, the reminder and the plan's cue.
 */
export function StudyRow({
  block,
  date,
  sub,
  next,
  checkLabel,
  canMove,
  actions,
  run,
  onOpenTimer,
  onEditPlan,
}: {
  block: Block;
  date: string;
  sub: string | null;
  next: boolean;
  checkLabel: string;
  canMove: boolean;
  actions: RowActions;
  /** A timer session in progress on this device. */
  run: StudyRun | undefined;
  onOpenTimer: () => void;
  /** Opens the plan, time, links and reminder settings. */
  onEditPlan: () => void;
}) {
  const { state } = useApp();
  const [showLinks, setShowLinks] = useState(false);
  const plan = studyPlanFor(state, block.routineId);
  const routine = routineOf(state, block.routineId);
  const title = block.title;
  const recorded = !!studySessionFor(state, block.id)?.study;
  const resources = routine ? studyResources(routine) : [];
  const reminder = !!plan && plan.reminders.start && plan.at !== null;
  const details = plan && (
    <View style={{ gap: 2 }}>
      {!!plan.cue && !run && (
        <Text style={{ ...type.caption, color: palette.accent }}>Plan · {plan.cue}</Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 }}>
        <TextLink
          title={
            resources.length === 1
              ? `Open ${resources[0].label} ↗`
              : resources.length
                ? showLinks
                  ? 'Hide resources'
                  : 'Study resources'
                : 'Add study links'
          }
          label={
            resources.length === 1
              ? `Open ${resources[0].label} for ${title}`
              : resources.length
                ? `${showLinks ? 'Hide' : 'Show'} study resources for ${title}`
                : `Add study links for ${title}`
          }
          onPress={() => {
            // Opening a resource never marks anything done.
            if (resources.length === 1) openLink(resources[0].url);
            else if (resources.length) setShowLinks(!showLinks);
            else onEditPlan();
          }}
        />
        {/* Skip is never completion; once a timer session runs, it ends through the session. */}
        {block.status === 'planned' && !run && (
          <TextLink
            dim
            title="Skip today"
            label={`Skip ${title}`}
            onPress={() => void actions.skip(block)}
          />
        )}
        <TextLink
          dim
          title={reminder ? `Reminder ${displayTime(plan.at!)}` : 'Set a reminder'}
          label={
            reminder
              ? `Study reminder at ${displayTime(plan.at!)}. Change it`
              : 'Set a study reminder'
          }
          onPress={onEditPlan}
        />
      </View>
      {showLinks && resources.length > 1 && <StageLinks links={resources} />}
    </View>
  );
  return (
    <TodayRow
      block={block}
      date={date}
      sub={sub}
      active={false}
      next={next}
      editLabel={`Open the timer for ${title}`}
      checkLabel={checkLabel}
      tickOnTap={false}
      steps={false}
      links={NO_LINKS}
      canMove={canMove}
      actions={actions}
      trailing={
        <TrailingAction
          title="Timer"
          label={
            run
              ? `Open timer: ${title}`
              : recorded
                ? `Open the timed session for ${title}`
                : `Use the timer for ${title}`
          }
          onPress={onOpenTimer}
          raised={next && block.status === 'planned'}
        />
      }
      details={details ? { what: 'details', body: details } : undefined}
    />
  );
}
