import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Block } from '../domain/model';
import { StudyRun, phaseAt, stageSpentMs } from '../domain/study';
import { Button } from './components';
import { StageBar, runStages } from './study-parts';
import { fonts, glows, palette, radius, type } from './theme';

/** What the card says about a timer session in progress. */
function runText(run: StudyRun, now: number): { label: string; line: string; action: string } {
  const phase = phaseAt(run, now);
  const step = `Stage ${Math.min(run.index + 1, run.stages.length)} of ${run.stages.length}`;
  if (phase === 'review')
    return {
      label: 'Timer · every stage behind',
      line: 'Review the timed session and confirm it.',
      action: 'Review and confirm',
    };
  const stage = run.stages[run.index];
  if (phase === 'timeUp') {
    const next = run.stages[run.index + 1];
    return {
      label: `Timer · ${step}`,
      line: `Time is up for ${stage.title}.${next ? ` Next: ${next.title}.` : ''}`,
      action: 'Continue timer',
    };
  }
  const left = Math.ceil((stage.plannedSeconds * 1000 - stageSpentMs(run, now)) / 60_000);
  return {
    label: `Timer ${phase === 'paused' ? 'paused' : 'running'} · ${step}`,
    line: `${stage.title} · ${left} min left`,
    // Opening shows the session as it is; a paused stage resumes there with one tap.
    action: 'Open timer',
  };
}

/**
 * A study timer session started on an earlier day and still open (it crossed midnight). Today's
 * own study is a row in the list; this card keeps the earlier session reachable until it is
 * confirmed on its own day, and is the only study card Today shows.
 */
export function CarriedStudyCard({
  block,
  run,
  from,
  onOpenTimer,
}: {
  block: Block;
  run: StudyRun;
  /** The earlier day the session belongs to. */
  from: string;
  onOpenTimer: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = phaseAt(run, now) === 'running';
  useEffect(() => {
    // Read the clock again whenever the run changes, then every 15 s while a stage is running.
    const refresh = setTimeout(() => setNow(Date.now()), 0);
    const timer = running ? setInterval(() => setNow(Date.now()), 15_000) : undefined;
    return () => {
      clearTimeout(refresh);
      if (timer) clearInterval(timer);
    };
  }, [running, run]);
  const text = runText(run, now);
  return (
    <View
      testID="study-card"
      style={[
        {
          backgroundColor: palette.accentTint,
          borderWidth: 1,
          borderColor: palette.accentEdge,
          borderRadius: radius.card,
          padding: 16,
          gap: 10,
        },
        glows.active,
      ]}>
      <View style={{ gap: 2 }}>
        <Text style={{ ...type.caption, ...fonts.semibold, color: palette.accent }}>
          {from} · {text.label}
        </Text>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.5}
          style={{ ...type.cardTitle, color: palette.label }}>
          {block.title}
        </Text>
        <Text style={type.caption}>{text.line}</Text>
      </View>
      <StageBar stages={runStages(run, now)} height={8} />
      <Button title={text.action} label={`${text.action}: ${block.title}`} onPress={onOpenTimer} />
    </View>
  );
}
